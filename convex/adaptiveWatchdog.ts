import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { api } from "./_generated/api";
import { TRANSLATION_CONFIG } from "./translationConfig";

/**
 * convex/adaptiveWatchdog.ts — PHASE 9: cron watchdog (every 3 minutes)
 *
 * Recovers the adaptive pipeline without human intervention:
 *   1. promote retry_wait jobs whose nextRetryAt has arrived
 *   2. reclaim claims whose heartbeat expired (worker crash)
 *   3. recover PDF batches stuck "running" past the heartbeat TTL
 *   4. detect a MISSING DISPATCHER LEASE (no tick for 2× interval while jobs
 *      remain) and re-kick the dispatcher — the chain can never die silently
 *   5. never duplicate completed results (claims/idempotency keys enforce it)
 *
 * Stage progression stays monotonic: a retry never moves a project backward
 * from a completed stage (statuses are only patched forward by the pipeline).
 */

type ProjectLite = {
  _id: string;
  status?: string;
  translationMode?: string;
  governorState?: string;
  lastDispatcherAt?: number;
  lastSuccessfulActivityAt?: number;
};

export const watchdogTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let revivedDispatchers = 0;
    let reclaimedJobs = 0;
    let promotedJobs = 0;
    let recoveredBatches = 0;
    const touchedProjects: string[] = [];

    // Adaptive projects with work that is neither complete nor cancelled.
    const projects = (await ctx.db
      .query("projects")
      .filter((q) =>
        q.and(
          q.eq(q.field("translationMode"), "adaptive_parallel"),
          q.neq(q.field("status"), "cancelled"),
          q.neq(q.field("status"), "complete"),
        ),
      )
      .collect()) as ProjectLite[];

    for (const p of projects) {
      const maint = (await ctx.runMutation(api.adaptiveJobs.promoteRetryableJobs, {
        projectId: p._id as never,
      })) as { promoted: number };
      promotedJobs += maint.promoted;
      const rec = (await ctx.runMutation(api.adaptiveJobs.reclaimStaleJobs, {
        projectId: p._id as never,
      })) as { reclaimed: number };
      reclaimedJobs += rec.reclaimed;
      const bat = (await ctx.runMutation(api.adaptivePdf.recoverStuckBatches, {
        projectId: p._id as never,
      })) as { recovered: number };
      recoveredBatches += bat.recovered;

      // Missing dispatcher lease: jobs still open but no tick recently.
      if (p.status === "translating") {
        const last = p.lastDispatcherAt ?? 0;
        const leaseExpired = now - last > TRANSLATION_CONFIG.watchdogIntervalMs * 2;
        const dailyPaused = p.governorState === "daily_paused";
        const pending = (await ctx.db
          .query("translationJobs")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", p._id as never).eq("status", "pending"),
          )
          .first());
        const waiting = (await ctx.db
          .query("translationJobs")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", p._id as never).eq("status", "retry_wait"),
          )
          .first());
        const claimed = (await ctx.db
          .query("translationJobs")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", p._id as never).eq("status", "claimed"),
          )
          .first());
        const hasOpenJobs = !!(pending || waiting || claimed);
        if (leaseExpired && hasOpenJobs && !dailyPaused) {
          await ctx.scheduler.runAfter(0, api.adaptiveJobs.dispatcherTick, {
            projectId: p._id as never,
          });
          await ctx.db.patch(p._id as never, {
            lastDispatcherAt: now,
          });
          revivedDispatchers++;
          touchedProjects.push(String(p._id));
        }
      }
    }

    return {
      scanned: projects.length,
      promotedJobs,
      reclaimedJobs,
      recoveredBatches,
      revivedDispatchers,
      touchedProjects,
      at: now,
    };
  },
});
