import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { api } from "./_generated/api";
import { TRANSLATION_CONFIG, pacificDateKey } from "./translationConfig";

/**
 * convex/resumeServerProject.ts — PHASE 1: SAFE RECOVERY of a stalled job.
 *
 * resumeServerProject preserves every completed chunk/translation exactly,
 * converts retryable jobs to pending, reclaims ONLY expired-heartbeat claims,
 * resets the daily governor ONLY when the Pacific date has changed, never
 * bypasses a still-valid quota pause, takes one transactional dispatcher
 * lease, and schedules exactly one fresh dispatcher tick. It never creates
 * duplicate idempotency keys, never re-sends completed jobs, and never
 * overwrites a completed result with an empty/failed one.
 */

type JobRow = {
  _id: string;
  langCode: string;
  status: string;
  heartbeatAt?: number;
  nextRetryAt?: number;
  claimToken?: string;
  reclaimCount?: number;
  idempotencyKey: string;
};

/** Lease acquisition inside a transaction: expired-lease takeover only. */
export const acquireDispatcherLease = internalMutation({
  args: { projectId: v.id("projects"), force: v.boolean() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const p = (await ctx.db.get(args.projectId)) as
      | { lastDispatcherAt?: number; governorState?: string; status?: string }
      | null;
    if (!p) return { ok: false as const, reason: "no_project" };
    if (p.status === "cancelled" || p.status === "complete" || p.status === "all_translated") {
      return { ok: false as const, reason: `project_${p.status}` };
    }
    // Never bypass a still-valid daily pause.
    if (p.governorState === "daily_paused") {
      const resumeAt = (p as { governorResumeAt?: number }).governorResumeAt ?? 0;
      if (now < resumeAt) {
        return { ok: false as const, reason: "daily_paused", resumeAt };
      }
      await ctx.db.patch(args.projectId, { governorState: "running", governorResumeAt: undefined });
    }
    // Reset the governor ONLY when the Pacific date has actually changed.
    const todayKey = pacificDateKey(now);
    const storedDay = (p as { requestDayPacific?: string }).requestDayPacific;
    if (storedDay && storedDay !== todayKey) {
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
    }
    // Take the lease unless another dispatcher tick is provably fresh.
    const last = p.lastDispatcherAt ?? 0;
    const leaseFresh = now - last < TRANSLATION_CONFIG.dispatcherIntervalMs * 2;
    if (leaseFresh && !args.force) {
      return { ok: false as const, reason: "fresh_lease_exists" };
    }
    await ctx.db.patch(args.projectId, { lastDispatcherAt: now });
    return { ok: true as const, leaseTakenAt: now };
  },
});

/** One tick = promote retryables, reclaim expired claims, reschedule. */
export const recoveryTick = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const promoted = await ctx.runMutation(api.adaptiveJobs.promoteRetryableJobs, {
      projectId: args.projectId,
    });
    const reclaimed = await ctx.runMutation(api.adaptiveJobs.reclaimStaleJobs, {
      projectId: args.projectId,
    });
    return { promoted: promoted.promoted, reclaimed: reclaimed.reclaimed };
  },
});

export const resumeServerProject = action({
  args: {
    projectId: v.id("projects"),
    langCodes: v.array(v.string()),
    force: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    reason: v.optional(v.string()),
    leaseTaken: v.boolean(),
    promoted: v.number(),
    reclaimed: v.number(),
    jobsCreated: v.optional(v.number()),
    jobsAlreadyDone: v.optional(v.number()),
    scheduledId: v.optional(v.string()),
    status: v.optional(v.string()),
    governorState: v.optional(v.string()),
    pending: v.number(),
    running: v.number(),
    done: v.number(),
    lastError: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const project = (await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    })) as { status?: string; governorState?: string; translationMode?: string } | null;
    if (!project) {
      return {
        ok: false, reason: "Project not found", leaseTaken: false,
        promoted: 0, reclaimed: 0, pending: 0, running: 0, done: 0,
      };
    }

    // 1. Transactional lease + governor/Pacific-date handling.
    const lease = (await ctx.runMutation(api.resumeServerProjectInternal.acquireDispatcherLease, {
      projectId: args.projectId,
      force: args.force ?? false,
    })) as { ok: boolean; reason?: string; resumeAt?: number; leaseTakenAt?: number };
    if (!lease.ok) {
      const counts = (await ctx.runQuery(api.resumeServerProjectInternal.jobCounts, {
        projectId: args.projectId,
      })) as { pending: number; running: number; done: number };
      return {
        ok: false, reason: lease.reason, leaseTaken: false,
        promoted: 0, reclaimed: 0,
        pending: counts.pending, running: counts.running, done: counts.done,
        status: project.status, governorState: project.governorState,
      };
    }

    // 2. Recovery mutations: promote + reclaim (never touches done rows).
    const tick = await ctx.runMutation(api.resumeServerProjectInternal.recoveryTick, {
      projectId: args.projectId,
    });

    // 3. Job rows must exist for adaptive processing; enqueue is idempotent —
    //    existing rows are reused, completed chunks are stamped done, and no
    //    duplicate idempotency keys can be created (unique-key check first).
    const enq = (await ctx.runMutation(api.adaptiveJobs.enqueueAdaptiveJobs, {
      projectId: args.projectId,
      langCodes: args.langCodes,
    })) as { created: number; skippedDone: number };

    // 4. Ensure the project row moves forward (never backward).
    if (project.status !== "translating" && project.status !== "paused") {
      await ctx.runMutation(api.mutations.updateProject, {
        projectId: args.projectId,
        status: "translating",
      });
    }

    // 5. One fresh dispatcher tick (chain re-established from the DB).
    const scheduledId = await ctx.scheduler.runAfter(
      0,
      api.adaptiveDispatcher.dispatcherTick,
      { projectId: args.projectId },
    );

    // 6. Post-recovery snapshot for the UI.
    const after = (await ctx.runQuery(api.resumeServerProjectInternal.jobCounts, {
      projectId: args.projectId,
    })) as { pending: number; running: number; done: number; governorState?: string; lastError?: string };

    return {
      ok: true,
      leaseTaken: true,
      promoted: tick.promoted,
      reclaimed: tick.reclaimed,
      jobsCreated: enq.created,
      jobsAlreadyDone: enq.skippedDone,
      scheduledId: String(scheduledId),
      status: "translating",
      governorState: after.governorState ?? project.governorState,
      pending: after.pending,
      running: after.running,
      done: after.done,
      lastError: after.lastError,
    } as {
      ok: boolean; reason?: string; leaseTaken: boolean;
      promoted: number; reclaimed: number;
      jobsCreated: number; jobsAlreadyDone: number;
      scheduledId: string; status: string; governorState?: string;
      pending: number; running: number; done: number; lastError?: string;
    };
  },
});

/** Honest server-state snapshot (P5 UI truth — no fake progress). */
export const getServerJobStatus = query({
  args: { projectId: v.id("projects") },
  returns: v.object({
    found: v.boolean(),
    status: v.optional(v.string()),
    governorState: v.optional(v.string()),
    governorResumeAt: v.optional(v.number()),
    translationMode: v.optional(v.string()),
    // Thin Motherboard Phase 3: which intelligence contract the project uses.
    translationIntelligenceMode: v.optional(v.string()),
    totalJobs: v.number(),
    doneJobs: v.number(),
    pendingJobs: v.number(),
    claimedJobs: v.number(),
    retryWaitJobs: v.number(),
    failedJobs: v.number(),
    // Thin Motherboard Phase 2: chunks flagged needs_review (visible, never hidden).
    needsReviewJobs: v.number(),
    perLangDone: v.array(v.object({
      langCode: v.string(),
      done: v.number(),
      total: v.number(),
    })),
    requestsToday: v.number(),
    dailyBudget: v.number(),
    workerCount: v.number(),
    lastDispatcherAt: v.optional(v.number()),
    lastSuccessfulActivityAt: v.optional(v.number()),
    watchdogLastRunAt: v.optional(v.number()),
    watchdogLastError: v.optional(v.string()),
    lastDispatcherError: v.optional(v.string()),
    heartbeatAgeMs: v.optional(v.number()),
    serverAlive: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.projectId);
    if (!p) {
      return {
        found: false, status: undefined, governorState: undefined,
        governorResumeAt: undefined, translationMode: undefined,
        totalJobs: 0, doneJobs: 0, pendingJobs: 0, claimedJobs: 0,
        retryWaitJobs: 0, failedJobs: 0, needsReviewJobs: 0, perLangDone: [],
        requestsToday: 0, dailyBudget: TRANSLATION_CONFIG.dailyRequestBudget,
        workerCount: TRANSLATION_CONFIG.workerCount,
        lastDispatcherAt: undefined, lastSuccessfulActivityAt: undefined,
        watchdogLastRunAt: undefined, watchdogLastError: undefined,
        lastDispatcherError: undefined, heartbeatAgeMs: undefined,
        serverAlive: false,
      };
    }
    const proj = p as {
      status?: string; governorState?: string; governorResumeAt?: number;
      translationMode?: string; translationIntelligenceMode?: string;
      requestsToday?: number;
      lastDispatcherAt?: number; lastSuccessfulActivityAt?: number;
      watchdogLastRunAt?: number; watchdogLastError?: string;
      lastDispatcherError?: string; activeWorkerCount?: number;
    };
    const jobs = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()) as JobRow[];
    const counts = {
      done: 0, pending: 0, claimed: 0, retry_wait: 0, failed: 0, running: 0,
      needs_review: 0,
    };
    const perLang = new Map<string, { done: number; total: number }>();
    for (const j of jobs) {
      counts[j.status] = (counts[j.status] ?? 0) + 1;
      const e = perLang.get(j.langCode) ?? { done: 0, total: 0 };
      e.total++;
      if (j.status === "done") e.done++;
      perLang.set(j.langCode, e);
    }
    const now = Date.now();
    const lastBeat = Math.max(
      proj.lastDispatcherAt ?? 0,
      proj.lastSuccessfulActivityAt ?? 0,
      proj.watchdogLastRunAt ?? 0,
    );
    const heartbeatAgeMs = lastBeat ? now - lastBeat : undefined;
    const serverAlive =
      !!heartbeatAgeMs &&
      heartbeatAgeMs < TRANSLATION_CONFIG.watchdogIntervalMs * 4;
    return {
      found: true,
      status: proj.status,
      governorState: proj.governorState,
      governorResumeAt: proj.governorResumeAt,
      translationMode: proj.translationMode,
      translationIntelligenceMode: proj.translationIntelligenceMode,
      totalJobs: jobs.length,
      doneJobs: counts.done,
      pendingJobs: counts.pending,
      claimedJobs: counts.claimed,
      retryWaitJobs: counts.retry_wait,
      failedJobs: counts.failed,
      needsReviewJobs: counts.needs_review,
      perLangDone: [...perLang.entries()].map(([langCode, v]) => ({
        langCode, ...v,
      })),
      requestsToday: proj.requestsToday ?? 0,
      dailyBudget: TRANSLATION_CONFIG.dailyRequestBudget,
      workerCount: proj.activeWorkerCount ?? TRANSLATION_CONFIG.workerCount,
      lastDispatcherAt: proj.lastDispatcherAt,
      lastSuccessfulActivityAt: proj.lastSuccessfulActivityAt,
      watchdogLastRunAt: proj.watchdogLastRunAt,
      watchdogLastError: proj.watchdogLastError,
      lastDispatcherError: proj.lastDispatcherError,
      heartbeatAgeMs,
      serverAlive,
    };
  },
});

// Internal namespace helpers (kept beside the public action for cohesion).

export const jobCounts = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const p = (await ctx.db.get(args.projectId)) as
      | { governorState?: string; lastDispatcherError?: string }
      | null;
    const jobs = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()) as JobRow[];
    return {
      pending: jobs.filter((j) => j.status === "pending").length,
      running: jobs.filter((j) => j.status === "claimed" || j.status === "running").length,
      done: jobs.filter((j) => j.status === "done").length,
      governorState: p?.governorState,
      lastError: p?.lastDispatcherError,
    };
  },
});

export const resumeServerProjectInternal = {
  acquireDispatcherLease,
  recoveryTick,
  jobCounts,
};
