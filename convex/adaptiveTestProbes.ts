import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  action,
} from "./_generated/server";
import { api } from "./_generated/api";
import {
  TRANSLATION_CONFIG,
  pacificDateKey,
  estimateSafePairTokens,
  extractPairSection,
  buildPairUserContent,
  looksLikeEnglishEcho,
  computeBackoffDelayMs,
} from "./translationConfig";

/** Read-only per-job evidence for gate harnesses (T2/T8 attempts/reclaimCount assertions). */
export const probeJobsByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return {
      jobs: jobs.map((j) => ({
        _id: j._id,
        langCode: j.langCode,
        chunkIndex: j.chunkIndex,
        status: j.status,
        attempts: j.attempts,
        reclaimCount: j.reclaimCount,
        idempotencyKey: j.idempotencyKey,
        requestGroupId: j.requestGroupId,
      })),
    };
  },
});

/** T1: claim the same chunk twice inside one transaction — the 2nd claim must be refused. */
export const probeDoubleClaim = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const cand = (await ctx.runQuery(api.adaptiveJobs.findNextClaimable, {
      projectId: args.projectId,
    })) as { jobId: unknown; langCode: string; chunkIndex: number } | null;
    if (!cand) return { first: null, second: null, skipped: true };
    const claimArgs = {
      projectId: args.projectId,
      langCode: cand.langCode,
      chunkIndex: cand.chunkIndex,
      promptOverheadChars: 8000,
    };
    const first = (await ctx.runMutation(api.adaptiveJobs.claimJobPair, claimArgs)) as { kind: string } | null;
    const second = (await ctx.runMutation(api.adaptiveJobs.claimJobPair, claimArgs)) as { kind: string } | null;
    return { first: first ? first.kind : null, second: second ? second.kind : null, skipped: false };
  },
});

/** T8: claim a job, age its heartbeat past TTL (simulated pause), then run the REAL reclaim. */
export const probeExpireLease = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const cand = (await ctx.runQuery(api.adaptiveJobs.findNextClaimable, {
      projectId: args.projectId,
    })) as { jobId: unknown; langCode: string; chunkIndex: number } | null;
    if (!cand) return { skipped: true };
    const claim = (await ctx.runMutation(api.adaptiveJobs.claimJobPair, {
      projectId: args.projectId,
      langCode: cand.langCode,
      chunkIndex: cand.chunkIndex,
      promptOverheadChars: 8000,
    })) as { kind: string } | null;
    if (!claim) return { skipped: true, reason: "claim-refused" };
    const claimed = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project_lang_chunk", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", cand.langCode).eq("chunkIndex", cand.chunkIndex),
      )
      .first()) as { _id: unknown; attempts: number } | null;
    if (!claimed) return { skipped: true, reason: "row-not-found" };
    const attemptsBefore = claimed.attempts;
    // Simulated pause: expire the lease while claimed.
    await ctx.db.patch(claimed._id as never, {
      heartbeatAt: Date.now() - TRANSLATION_CONFIG.heartbeatTtlMs - 1000,
    });
    const reclaimed = (await ctx.runMutation(api.adaptiveJobs.reclaimStaleJobs, {
      projectId: args.projectId,
    })) as { reclaimed: number };
    const after = (await ctx.db.get(claimed._id as never)) as { status: string; attempts: number; reclaimCount?: number };
    return {
      skipped: false,
      claimKind: claim.kind,
      statusAfter: after.status,
      attemptsBefore,
      attemptsAfter: after.attempts,
      reclaimCount: after.reclaimCount ?? 0,
      reclaimed: reclaimed.reclaimed,
    };
  },
});

/** T2 helper: age ALL claimed jobs past the heartbeat TTL (simulated worker death clock). */
export const probeAgeHeartbeat = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const claimed = await ctx.db
      .query("translationJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "claimed"),
      )
      .collect();
    let aged = 0;
    for (const j of claimed) {
      await ctx.db.patch(j._id, {
        heartbeatAt: Date.now() - TRANSLATION_CONFIG.heartbeatTtlMs - 1000,
      });
      aged++;
    }
    return { aged };
  },
});

/**
 * convex/adaptiveTestProbes.ts — P13 verification probes.
 *
 * Forced-fault tests for the adaptive pipeline that do NOT burn Gemini quota
 * (except where explicitly noted). Each probe returns structured evidence;
 * scripts/verifyAdaptivePipeline.mjs drives them and reports PASS/FAIL.
 */

// ── Probe 7 (T4 KILL TEST): claim a job then abandon it (simulated worker
// death) → the watchdog must reclaim it within the heartbeat TTL. ─────────

export const probeClaimAndAbandon = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const candidate = (await ctx.runQuery(api.adaptiveJobs.findNextClaimable, {
      projectId: args.projectId,
    })) as { jobId: never; langCode: string; chunkIndex: number } | null;
    if (!candidate) return { claimed: false };
    const claimed = (await ctx.runMutation(api.adaptiveJobs.claimJobPair, {
      projectId: args.projectId,
      langCode: candidate.langCode,
      chunkIndex: candidate.chunkIndex,
      promptOverheadChars: 8000,
    })) as { kind: string } | null;
    if (!claimed) return { claimed: false };
    // ABANDON: no completion, no heartbeat renewal — the claim goes stale.
    return { claimed: true, kind: claimed.kind, langCode: candidate.langCode, chunkIndex: candidate.chunkIndex };
  },
});

// ── Probe 8 (T5 PDF BATCHES): force one batch into a stuck/failed state the
// watchdog recovery path handles (attempts≥2 + expired heartbeat → shrink). ─

export const probeForceBatchFailure = mutation({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    // Stage the exact precondition of the production fallback: a batch stuck
    // "running" past its heartbeat TTL with attempts=2 (watchdog split case).
    const batch = await ctx.db.insert("pdfBatches", {
      projectId: args.projectId,
      langCode: args.langCode,
      batchIndex: 0,
      pageStart: 1,
      pageEnd: 50,
      batchSize: 50,
      status: "running",
      attempts: 2,
      heartbeatAt: Date.now() - TRANSLATION_CONFIG.heartbeatTtlMs - 1000,
      createdAt: Date.now(),
      idempotencyKey: `probe-stuck-${args.projectId}-${args.langCode}`, // idempotent: rerun replaces the doc
    });
    // Drive the REAL recovery path (no re-implementation): the watchdog's own
    // recoverStuckBatches decides requeue-vs-split from live row state.
    const recovery = (await ctx.runMutation(api.adaptivePdf.recoverStuckBatches, {
      projectId: args.projectId,
    })) as { recovered?: number } | null;
    return { forced: true, probeBatchId: batch, recovery };
  },
});

// ── Probe 8b (T5 driver): run the REAL processAllBatches fallback on a
// project (public wrapper — the underlying function is internalAction). The
// action itself loops claim→render→complete/shrink until the plan settles.
export const probeDriveBatches = action({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const r = (await ctx.runAction(api.adaptivePdf.processAllBatches, args)) as {
      status?: string;
      rendered?: number;
      failed?: number;
    };
    return r;
  },
});

// ── Probe 9 (T5): verify completed batches are skipped on restart ────────

export const probeBatchCounts = query({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const batches = await ctx.db
      .query("pdfBatches")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode),
      )
      .collect();
    return {
      total: batches.length,
      done: batches.filter((b) => b.status === "done").length,
      pending: batches.filter((b) => b.status === "pending").length,
      running: batches.filter((b) => b.status === "running").length,
      failed: batches.filter((b) => b.status === "failed").length,
      sizes: batches.sort((a, b) => a.batchIndex - b.batchIndex).map((b) => b.batchSize),
    };
  },
});

// ── Probe 10 (T1): request log — read the rate row timestamps + counters ──

export const probeRateSnapshot = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const rate = await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    const project = (await ctx.db.get(args.projectId)) as {
      requestsToday?: number;
      lastRequestAt?: number;
      consecutive429Count?: number;
      activeWorkerCount?: number;
      governorState?: string;
    } | null;
    const jobs = await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return {
      windowTimestamps: rate?.requestTimestamps ?? [],
      requestsToday: project?.requestsToday ?? 0,
      lastRequestAt: project?.lastRequestAt ?? null,
      consecutive429Count: project?.consecutive429Count ?? 0,
      activeWorkerCount: project?.activeWorkerCount ?? null,
      governorState: project?.governorState ?? null,
      workerLimit: rate?.workerLimit ?? null,
      pairsClaimed: jobs.filter((j) => j.requestGroupId).length,
      jobsDone: jobs.filter((j) => j.status === "done").length,
      jobsFailed: jobs.filter((j) => j.status === "failed").length,
      jobsRetryWait: jobs.filter((j) => j.status === "retry_wait").length,
      durationsMs: jobs
        .filter((j) => j.startedAt && j.completedAt)
        .map((j) => (j.completedAt as number) - (j.startedAt as number))
        .slice(0, 200),
    };
  },
});

// ── Probe 11 (T2 GOVERNOR real): 1199→tick allowed; 1200→pause+resume time;
// Pacific date change→reset+resume. Returns raw state transitions. ─────────

export const probeGovernorLadder = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const projectId = args.projectId;
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.patch(projectId, { governorState: "running", governorResumeAt: undefined });

    // 1199 → tick must be allowed
    await ctx.db.insert("rateLimits", {
      projectId,
      windowStartMs: Date.now(),
      requestTimestamps: [],
      requestsToday: 1199,
      requestDayPacific: pacificDateKey(Date.now()),
      consecutive429Count: 0,
      workerLimit: TRANSLATION_CONFIG.workerCount,
      lastUpdatedAt: Date.now(),
    });
    const at1199 = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, { projectId })) as { ok: boolean };

    // 1200 → tick must pause with a resume time
    const at1200 = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, { projectId })) as { ok: boolean; code?: string };
    const paused = (await ctx.db.get(projectId)) as { governorState?: string; governorResumeAt?: number } | null;

    // Pacific date change → reset + resume
    const rate = await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (rate) await ctx.db.patch(rate._id, { requestDayPacific: "2000-01-01", requestsToday: 1200 });
    await ctx.db.patch(projectId, { governorResumeAt: Date.now() - 1000 }); // midnight passed
    const afterMidnight = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, { projectId })) as { ok: boolean };
    const resumed = (await ctx.db.get(projectId)) as { governorState?: string; requestsToday?: number } | null;

    // cleanup: honest zeroed state
    if (rate) await ctx.db.patch(rate._id, { requestsToday: 0, requestDayPacific: pacificDateKey(Date.now()) });
    await ctx.db.patch(projectId, { governorState: "running", governorResumeAt: undefined, requestsToday: 0 });

    return {
      allowedAt1199: at1199.ok,
      pausedAt1200: !at1200.ok && at1200.code === "daily",
      pauseStateSet: paused?.governorState === "daily_paused",
      resumeTimeSet: (paused?.governorResumeAt ?? 0) > Date.now() - 2000,
      resetAfterMidnight: afterMidnight.ok,
      resumedState: resumed?.governorState,
      pass:
        at1199.ok &&
        !at1200.ok &&
        paused?.governorState === "daily_paused" &&
        (paused?.governorResumeAt ?? 0) > Date.now() - 2000 &&
        afterMidnight.ok,
    };
  },
});

export const probeEstimator = mutation({
  args: {},
  handler: async () => {
    const small = estimateSafePairTokens(8000, 8000, 60, 8000);
    const tiny = estimateSafePairTokens(1200, 1200, 60, 800);
    const oversizedSentSingle = small > TRANSLATION_CONFIG.pairMergeMaxEstimatedInputTokens;
    const tinyAccepted = tiny <= TRANSLATION_CONFIG.pairMergeMaxEstimatedInputTokens;
    return {
      small,
      tiny,
      oversizedSentSingle,
      tinyAccepted,
      pass: oversizedSentSingle && tinyAccepted,
    };
  },
});

// ── Probe 2: pair parser (pure) ──────────────────────────────────────────

export const probePairParser = mutation({
  args: {},
  handler: async () => {
    const good = buildPairUserContent("alpha text", "beta text");
    const a = extractPairSection(
      `noise\n<<<ONYX_TRANSLATION_A_START>>>\ntraduction A ici\n<<<ONYX_TRANSLATION_A_END>>>\n<<<ONYX_TRANSLATION_B_START>>>\ntraduction B ici\n<<<ONYX_TRANSLATION_B_END>>>`,
      "A",
    );
    const b = extractPairSection(
      `<<<ONYX_TRANSLATION_A_START>>>x<<<ONYX_TRANSLATION_A_END>>>`,
      "B",
    ); // missing B → null
    const emptySection = extractPairSection(
      `<<<ONYX_TRANSLATION_A_START>>>   <<<ONYX_TRANSLATION_A_END>>>`,
      "A",
    ); // empty → null
    const echo = looksLikeEnglishEcho("This is plain untranslated English text!");
    const echoOk = looksLikeEnglishEcho("Ceci est du texte français traduit, voilà.");
    return {
      markersInPrompt: good.includes("<<<ONYX_CHUNK_A_START>>>"),
      sectionA: a === "traduction A ici",
      missingB: b === null,
      emptyRejected: emptySection === null,
      echoDetected: echo === true,
      foreignAccepted: echoOk === false,
      pass:
        good.includes("<<<ONYX_CHUNK_A_START>>>") &&
        a === "traduction A ici" &&
        b === null &&
        emptySection === null &&
        echo === true &&
        echoOk === false,
    };
  },
});

// ── Probe 3: rate limiter — rolling window refuses past target ───────────

export const probeRateLimiter = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const projectId = args.projectId;
    // Reset the row for a deterministic test
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (existing) await ctx.db.delete(existing._id);

    const target = TRANSLATION_CONFIG.targetRpm;
    let okCount = 0;
    let firstRefusal: unknown = null;
    for (let i = 0; i < target + 2; i++) {
      const r = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, {
        projectId,
      })) as { ok: boolean; code?: string };
      if (r.ok) okCount++;
      else if (!firstRefusal) firstRefusal = r;
    }
    // Release the two phantom slots so the project limiter is not left skewed
    await ctx.runMutation(api.adaptiveJobs.releaseUnprocessedSlot, { projectId });
    await ctx.runMutation(api.adaptiveJobs.releaseUnprocessedSlot, { projectId });
    await ctx.runMutation(api.adaptiveJobs.recordRequestSuccess, { projectId });
    return {
      target,
      okCount,
      refusedAfterTarget: okCount === target && firstRefusal !== null,
      pass: okCount === target,
    };
  },
});

// ── Probe 4: daily governor stops at budget + midnight resume math ───────

export const probeDailyGovernor = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const projectId = args.projectId;
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    const budget = TRANSLATION_CONFIG.dailyRequestBudget;

    // Fast-forward: pre-fill the counter to budget-1 via direct rows
    const id = await ctx.db.insert("rateLimits", {
      projectId,
      windowStartMs: Date.now(),
      requestTimestamps: [],
      requestsToday: budget - 1,
      requestDayPacific: pacificDateKey(Date.now()),
      consecutive429Count: 0,
      workerLimit: TRANSLATION_CONFIG.workerCount,
      lastUpdatedAt: Date.now(),
    });
    const r1 = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, {
      projectId,
    })) as { ok: boolean };
    const atBudgetAllowed = r1.ok; // request #1200 must pass

    const r2 = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, {
      projectId,
    })) as { ok: boolean; code?: string; resumeAt?: number };
    const stoppedAtBudget = !r2.ok && r2.code === "daily";

    const project = (await ctx.db.get(projectId)) as { governorState?: string; governorResumeAt?: number } | null;
    const governorPaused = project?.governorState === "daily_paused";
    const resumeAt = project?.governorResumeAt ?? 0;
    const resumeIsFuture = resumeAt > Date.now();
    const resumeUnder24h = resumeAt - Date.now() <= 24.5 * 3600 * 1000;

    // Midnight rollover simulation: age the day key → next acquire resets
    const rate = (await ctx.db.get(id)) as { requestDayPacific: string; requestsToday: number } | null;
    if (rate) {
      await ctx.db.patch(id, { requestDayPacific: "2000-01-01" });
    }
    const r3 = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, {
      projectId,
    })) as { ok: boolean };
    const midnightResetWorks = r3.ok;

    // Cleanup: restore honest counters
    if (rate) {
      await ctx.db.patch(id, {
        requestsToday: 0,
        requestDayPacific: pacificDateKey(Date.now()),
        lastUpdatedAt: Date.now(),
      });
    }
    await ctx.db.patch(projectId, {
      governorState: "running",
      governorResumeAt: undefined,
      requestsToday: 0,
    });

    return {
      budget,
      atBudgetAllowed,
      stoppedAtBudget,
      governorPaused,
      resumeIsFuture,
      resumeUnder24h,
      midnightResetWorks,
      pass:
        atBudgetAllowed &&
        stoppedAtBudget &&
        governorPaused &&
        resumeIsFuture &&
        resumeUnder24h &&
        midnightResetWorks,
    };
  },
});

// ── Probe 5: idempotent enqueue — duplicate start never duplicates jobs ──

export const probeEnqueueIdempotent = mutation({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const first = (await ctx.runMutation(api.adaptiveJobs.enqueueAdaptiveJobs, {
      projectId: args.projectId,
      langCodes: [args.langCode],
    })) as { created: number; totalJobs: number };
    const second = (await ctx.runMutation(api.adaptiveJobs.enqueueAdaptiveJobs, {
      projectId: args.projectId,
      langCodes: [args.langCode],
    })) as { created: number; totalJobs: number };
    return {
      firstCreated: first.created,
      secondCreated: second.created,
      pass: second.created === 0 && second.totalJobs === first.totalJobs,
    };
  },
});

// ── Probe 6: backoff math — exponential, jittered, capped, Retry-After ──

export const probeBackoff = mutation({
  args: {},
  handler: async () => {
    const d0 = computeBackoffDelayMs(0);
    const d3 = computeBackoffDelayMs(3);
    const d20 = computeBackoffDelayMs(20);
    const ra = computeBackoffDelayMs(0, 300_000);
    return {
      d0,
      d3,
      d20,
      ra,
      monotonic: d3 > d0,
      capped: d20 <= TRANSLATION_CONFIG.backoffMaxMs + 1000,
      retryAfterHonored: ra >= 300_000,
      pass: d3 > d0 && d20 <= TRANSLATION_CONFIG.backoffMaxMs + 1000 && ra >= 300_000,
    };
  },
});
