import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { api } from "./_generated/api";
import { TRANSLATION_CONFIG, pacificDateKey } from "./translationConfig";

/**
 * convex/adaptiveWatchdog.ts — PHASE 2: watchdog as PRIMARY safety driver.
 *
 * Runs every 3 minutes (cron) and is the mechanism that keeps the pipeline
 * alive even when the `ctx.scheduler.runAfter` chain dies. Covers BOTH
 * pipeline modes (the incident project ran legacy and was invisible to the
 * old adaptive-only watchdog):
 *
 *   1. every unfinished project gets a governor/Pacific-date check
 *   2. adaptive projects: promote retryables + reclaim expired claims
 *   3. adaptive projects with open jobs and a dead/missing dispatcher lease
 *      (no tick for 2× interval, or no successful activity for 10 min) get a
 *      fresh dispatcher tick
 *   4. legacy projects (translationMode unset) get the same revival via
 *      translateContent.translateLanguage for their first unfinished language
 *      — the legacy chain has no self-healing of its own
 *   5. every project is processed in its own try/catch: one broken project
 *      can never stop the others
 *   6. watchdogLastRunAt/RecoveredAt/RecoveryCount/LastError persisted per
 *      project — never silently terminate
 *
 * Platform honesty: while the deployment is PAUSED this cron is SKIPPED
 * entirely (docs.convex.dev/production/pause-deployment.md) — nothing here
 * can run then; the UI must show the hosting-paused state (P5).
 */

type ProjectLite = {
  _id: string;
  status?: string;
  translationMode?: string;
  governorState?: string;
  governorResumeAt?: number;
  requestsToday?: number;
  requestDayPacific?: string;
  lastDispatcherAt?: number;
  lastSuccessfulActivityAt?: number;
  watchdogRecoveryCount?: number;
};

export const watchdogTick = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let revivedDispatchers = 0;
    let reclaimedJobs = 0;
    let promotedJobs = 0;
    let recoveredBatches = 0;
    let legacyRevived = 0;
    let recoveredProjects = 0;
    const touchedProjects: string[] = [];
    const errors: Array<{ projectId: string; error: string }> = [];

    // Unfinished projects of BOTH modes (the incident gap: legacy rows were
    // invisible here before). Cancelled/complete/all_translated excluded.
    const projects = (await ctx.runQuery(
      api.adaptiveWatchdog.listUnfinishedProjects,
      {},
    )) as ProjectLite[];

    for (const p of projects) {
      try {
        // ── Governor: Pacific-date rollover + expired pause release ──────
        const todayKey = pacificDateKey(now);
        if (p.requestDayPacific && p.requestDayPacific !== todayKey) {
          await ctx.runMutation(
            api.adaptiveWatchdog.resetDailyCounterIfDayChanged,
            { projectId: p._id as never },
          );
        }
        if (p.governorState === "daily_paused") {
          const resumeAt = p.governorResumeAt ?? 0;
          if (now < resumeAt) {
            // Still inside a valid quota pause — do NOT bypass. Just stamp.
            await ctx.runMutation(api.adaptiveWatchdog.stampWatchdogRun, {
              projectId: p._id as never,
              error: undefined,
            });
            continue;
          }
          await ctx.runMutation(api.adaptiveJobs.resumeFromDailyPause, {
            projectId: p._id as never,
          });
        }

        if (p.translationMode === "adaptive_parallel") {
          // ── Adaptive maintenance ────────────────────────────────────────
          const maint = (await ctx.runMutation(
            api.adaptiveJobs.promoteRetryableJobs,
            { projectId: p._id as never },
          )) as { promoted: number };
          promotedJobs += maint.promoted;
          const rec = (await ctx.runMutation(api.adaptiveJobs.reclaimStaleJobs, {
            projectId: p._id as never,
          })) as { reclaimed: number };
          reclaimedJobs += rec.reclaimed;
          const bat = (await ctx.runMutation(api.adaptivePdf.recoverStuckBatches, {
            projectId: p._id as never,
          })) as { recovered: number };
          recoveredBatches += bat.recovered;

          // ── Dead/missing dispatcher lease → force a fresh tick ─────────
          if (p.status === "translating") {
            const leaseExpired =
              now - (p.lastDispatcherAt ?? 0) >
              TRANSLATION_CONFIG.watchdogIntervalMs * 2;
            const noActivity =
              now - (p.lastSuccessfulActivityAt ?? 0) >
              TRANSLATION_CONFIG.staleProjectThresholdMs;
            const hasOpen = (await ctx.runQuery(
              api.adaptiveWatchdog.projectHasOpenJobs,
              { projectId: p._id as never },
            )) as boolean;
            if ((leaseExpired || noActivity) && hasOpen) {
              await ctx.scheduler.runAfter(0, api.adaptiveDispatcher.dispatcherTick, {
                projectId: p._id as never,
              });
              await ctx.runMutation(api.adaptiveWatchdog.stampWatchdogRun, {
                projectId: p._id as never,
                error: undefined,
                revived: true,
              });
              revivedDispatchers++;
              recoveredProjects++;
              touchedProjects.push(String(p._id));
            } else {
              await ctx.runMutation(api.adaptiveWatchdog.stampWatchdogRun, {
                projectId: p._id as never,
                error: undefined,
              });
            }
          } else {
            await ctx.runMutation(api.adaptiveWatchdog.stampWatchdogRun, {
              projectId: p._id as never,
              error: undefined,
            });
          }
        } else {
          // ── LEGACY revival (the incident gap) ───────────────────────────
          // Legacy has no dispatcher; its chain is translateLanguage per
          // language. Revive only when stalled and the project is mid-run.
          const stalling =
            now - (p.lastSuccessfulActivityAt ?? 0) >
            TRANSLATION_CONFIG.staleProjectThresholdMs;
          if (stalling && (p.status === "translating" || p.status === "paused")) {
            const next = (await ctx.runQuery(
              api.adaptiveWatchdog.firstUnfinishedLegacyLang,
              { projectId: p._id as never },
            )) as { langCode: string } | null;
            if (next) {
              await ctx.scheduler.runAfter(
                0,
                api.translateContent.translateLanguage,
                {
                  projectId: p._id as never,
                  langCode: next.langCode,
                },
              );
              legacyRevived++;
              recoveredProjects++;
              touchedProjects.push(`legacy:${String(p._id)}`);
              await ctx.runMutation(api.adaptiveWatchdog.stampWatchdogRun, {
                projectId: p._id as never,
                error: undefined,
                revived: true,
              });
            } else {
              await ctx.runMutation(api.adaptiveWatchdog.stampWatchdogRun, {
                projectId: p._id as never,
                error: undefined,
              });
            }
          } else {
            await ctx.runMutation(api.adaptiveWatchdog.stampWatchdogRun, {
              projectId: p._id as never,
              error: undefined,
            });
          }
        }
      } catch (e) {
        // One broken project never stops the others (spec Phase 2.9/2.10).
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ projectId: String(p._id), error: msg.slice(0, 400) });
        try {
          await ctx.runMutation(api.adaptiveWatchdog.recordWatchdogError, {
            projectId: p._id as never,
            error: msg,
          });
        } catch {
          // Even telemetry failing must not abort the sweep.
        }
      }
    }

    return {
      scanned: projects.length,
      promotedJobs,
      reclaimedJobs,
      recoveredBatches,
      revivedDispatchers,
      legacyRevived,
      recoveredProjects,
      touchedProjects,
      errors,
      at: now,
    };
  },
});

// ─── Internal queries/mutations (transaction-light helpers) ────────────────

/** All projects with work that is neither complete nor cancelled. */
export const listUnfinishedProjects = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query("projects").collect()) as Array<{
      _id: string;
      status?: string;
      translationMode?: string;
      governorState?: string;
      governorResumeAt?: number;
      requestsToday?: number;
      requestDayPacific?: string;
      lastDispatcherAt?: number;
      lastSuccessfulActivityAt?: number;
      watchdogRecoveryCount?: number;
    }>;
    return rows.filter(
      (p) =>
        p.status !== "cancelled" &&
        p.status !== "complete" &&
        p.status !== "all_translated",
    );
  },
});

/** Does the project still have non-terminal translation jobs? */
export const projectHasOpenJobs = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    for (const status of ["pending", "retry_wait", "claimed", "running"]) {
      const row = await ctx.db
        .query("translationJobs")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", args.projectId).eq("status", status),
        )
        .first();
      if (row) return true;
    }
    return false;
  },
});

/** First unfinished legacy language (translation row not complete/error). */
export const firstUnfinishedLegacyLang = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const rows = (await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
      .collect()) as unknown as Array<{
      langCode?: string;
      targetLangCode?: string;
      status?: string;
    }>;
    const open = rows
      .filter((t) => t.status !== "complete" && t.status !== "error")
      .map((t) => t.langCode ?? t.targetLangCode ?? "")
      .filter(Boolean)
      .sort();
    if (open.length === 0) return null;
    return { langCode: open[0] };
  },
});

/** Reset requestsToday when the Pacific date has actually changed. */
export const resetDailyCounterIfDayChanged = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const todayKey = pacificDateKey(now);
    const p = (await ctx.db.get(args.projectId)) as {
      requestDayPacific?: string;
    } | null;
    if (!p || p.requestDayPacific === todayKey) return { reset: false };
    await ctx.db.patch(args.projectId, {
      requestsToday: 0,
      requestDayPacific: todayKey,
    });
    const rate = await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    if (rate) {
      await ctx.db.patch(rate._id, {
        requestsToday: 0,
        requestDayPacific: todayKey,
        requestTimestamps: [],
        lastUpdatedAt: now,
      });
    }
    return { reset: true };
  },
});

/** Stamp a successful sweep (telemetry the UI can trust). */
export const stampWatchdogRun = internalMutation({
  args: {
    projectId: v.id("projects"),
    error: v.optional(v.string()),
    revived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const p = (await ctx.db.get(args.projectId)) as {
      watchdogRecoveryCount?: number;
    } | null;
    if (!p) return;
    const patch: Record<string, unknown> = {
      watchdogLastRunAt: now,
      watchdogLastError: args.error,
    };
    if (args.revived) {
      patch.watchdogRecoveredAt = now;
      patch.watchdogRecoveryCount = (p.watchdogRecoveryCount ?? 0) + 1;
    }
    await ctx.db.patch(args.projectId, patch);
  },
});

/** Persist a watchdog error — never silently swallowed. */
export const recordWatchdogError = internalMutation({
  args: { projectId: v.id("projects"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      watchdogLastRunAt: Date.now(),
      watchdogLastError: args.error.slice(0, 500),
    });
  },
});
