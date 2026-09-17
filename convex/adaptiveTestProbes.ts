import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
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

/**
 * convex/adaptiveTestProbes.ts — P13 verification probes.
 *
 * Forced-fault tests for the adaptive pipeline that do NOT burn Gemini quota
 * (except where explicitly noted). Each probe returns structured evidence;
 * scripts/verifyAdaptivePipeline.mjs drives them and reports PASS/FAIL.
 */

// ── Probe 7 (T4 KILL TEST): claim a job then abandon it (simulated worker
// death) → the watchdog must reclaim it within the heartbeat TTL. ─────────

export const probeClaimAndAbandon = internalMutation({
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

export const probeForceBatchFailure = internalMutation({
  args: { batchId: v.id("pdfBatches") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.batchId, {
      status: "running",
      attempts: 2,
      heartbeatAt: Date.now() - TRANSLATION_CONFIG.heartbeatTtlMs - 1000,
    });
    const r = (await ctx.runMutation(api.adaptivePdf.recoverStuckBatches, {
      projectId: (await ctx.db.get(args.batchId)) as never,
      // recoverStuckBatches filters by its own project — we call the real path
      // from the harness with the right project id; this probe patches state.
    }).catch(() => null)) as unknown;
    void r;
    return { forced: true };
  },
});

// ── Probe 9 (T5): verify completed batches are skipped on restart ────────

export const probeBatchCounts = internalQuery({
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

export const probeRateSnapshot = internalQuery({
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

export const probeGovernorLadder = internalMutation({
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

export const probeEstimator = internalMutation({
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

export const probePairParser = internalMutation({
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

export const probeRateLimiter = internalMutation({
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

export const probeDailyGovernor = internalMutation({
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

export const probeEnqueueIdempotent = internalMutation({
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

export const probeBackoff = internalMutation({
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
