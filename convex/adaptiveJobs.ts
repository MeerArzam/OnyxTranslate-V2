// NO "use node" here: this module is mutations/queries only (DB-only) and
// Convex requires actions for the Node runtime. The dispatcher (real fetches)
// is the Node action; everything here runs on the default V8 runtime.
import { v } from "convex/values";
import { internalMutation, internalQuery, action, internalAction, mutation } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assembleWithBoundaryRepair, filterGeneratedArtifacts } from "./languageRules";
import { PROMPT_VERSION } from "./buildTranslationPrompt";
// Thin Motherboard Phase 2: the ONE upsert used by both contract modes.
import { upsertTranslationResult, assembleContractChunks } from "./translationContractMutation";
import {
  TRANSLATION_CONFIG,
  TREAT_KEYS_AS_ONE_POOL,
  translationJobIdempotencyKey,
  computeBackoffDelayMs,
  pacificDateKey,
  msUntilNextPacificMidnight,
} from "./translationConfig";

/**
 * convex/adaptiveJobs.ts — ADAPTIVE PARALLEL PIPELINE (job layer)
 *
 * Durable per-unit translation jobs + transactional claiming + the ONE
 * project-level rate limiter. Results are written back into the EXISTING
 * chunks/translations tables so merge, PDF generation, ZIP, export, preview
 * and the UI keep working unchanged.
 *
 * Identity laws honored here:
 *  - idempotencyKey = projectId:langCode:chunkIndex (never duplicate jobs)
 *  - claim tokens: a worker may only write with a still-valid token
 *  - stale claims (heartbeat expired) are reclaimed transactionally
 *  - the five Gemini keys are ONE quota pool (shared Google project) —
 *    TREAT_KEYS_AS_ONE_POOL guards against per-key pooling unless the user
 *    explicitly verifies separate projects later.
 */

type JobDoc = {
  _id: Id<"translationJobs">;
  projectId: Id<"projects">;
  langCode: string;
  chunkIndex: number;
  chunkCount: number;
  sourceText: string;
  status: string;
  attempts: number;
  reclaimCount?: number;
  claimToken?: string;
  claimedAt?: number;
  heartbeatAt?: number;
  nextRetryAt?: number;
  lastError?: string;
  lastHttpStatus?: number;
  requestGroupId?: string;
  mergedWithChunkIndex?: number;
  // Thin Motherboard Phase 2: contract state (needs_review / strict-retry)
  needsReview?: boolean;
  reviewReason?: string;
  contractRetried?: boolean;
  rawModelOutput?: string;
  pairFailureCount?: number;
  translationIntelligenceMode?: string;
  idempotencyKey: string;
};

type RateDoc = {
  _id: Id<"rateLimits">;
  projectId: Id<"projects">;
  windowStartMs: number;
  requestTimestamps: number[];
  requestsToday: number;
  requestDayPacific: string;
  consecutive429Count: number;
  workerLimit: number;
  pairMergeDisabledLangs?: string[];
  lastUpdatedAt: number;
};

// ─── Internal query: load rate row ────────────────────────────────────────

export const getRateRowInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args): Promise<RateDoc | null> => {
    return (await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()) as RateDoc | null;
  },
});

// ─── Enqueue (idempotent) ─────────────────────────────────────────────────
// Creates translationJobs rows for every (lang, chunk) that has no row yet.
// NEVER duplicates: keyed by idempotencyKey. Legacy rows for already-done
// chunks are skipped (existing chunk status done → job pre-marked done so
// completed chunks are never translated again).

export const enqueueAdaptiveJobs = internalMutation({
  args: {
    projectId: v.id("projects"),
    langCodes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as
      | {
          fullText: string;
          status: string;
          clientId?: string;
          tabSessionId?: string;
          translationIntelligenceMode?: string;
        }
      | null;
    if (!project) throw new Error("Project not found");
    // Thin Motherboard Phase 3: resolve ONCE per enqueue. Existing projects
    // keep whatever mode they carry (undefined → legacy_postprocess); NEW
    // projects default to gemini_contract at creation (mutations.ts).
    const intelMode = project.translationIntelligenceMode ?? "legacy_postprocess";

    const sourceChunks = chunkTextForAdaptive(project.fullText);
    const chunkCount = sourceChunks.length;
    const now = Date.now();
    let created = 0;
    let skippedDone = 0;

    for (const langCode of args.langCodes) {
      // Skip languages already fully complete (resume support)
      const doneChunks = new Set<number>();
      const existingChunks = await ctx.db
        .query("chunks")
        .withIndex("by_project_lang", (q) =>
          q.eq("projectId", args.projectId).eq("langCode", langCode),
        )
        .collect();
      let maxIndex = -1;
      for (const c of existingChunks) {
        maxIndex = Math.max(maxIndex, c.chunkIndex);
        if (c.status === "done" && c.translatedText) doneChunks.add(c.chunkIndex);
      }

      // Ensure a translation row exists for progress UI (existing behavior)
      const translations = await ctx.db
        .query("translations")
        .withIndex("by_project_lang", (q) =>
          q.eq("projectId", args.projectId).eq("langCode", langCode),
        )
        .collect();
      if (translations.length === 0) {
        await ctx.db.insert("translations", {
          projectId: args.projectId,
          langCode,
          status: "in_progress",
          totalChunks: chunkCount,
          completedChunks: doneChunks.size,
          startedAt: now,
        });
      }

      for (let i = 0; i < chunkCount; i++) {
        const idem = translationJobIdempotencyKey(args.projectId, langCode, i);
        const dup = await ctx.db
          .query("translationJobs")
          .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idem))
          .first();
        if (dup) continue;
        const preDone = doneChunks.has(i);
        if (preDone) skippedDone++;
        await ctx.db.insert("translationJobs", {
          projectId: args.projectId,
          clientId: project.clientId,
          tabSessionId: project.tabSessionId,
          langCode,
          chunkIndex: i,
          chunkCount,
          sourceText: sourceChunks[i] ?? "",
          status: preDone ? "done" : "pending",
          attempts: 0,
          completedAt: preDone ? now : undefined,
          idempotencyKey: idem,
          pipelineVersion: TRANSLATION_CONFIG.pipelineVersion,
          // Thin Motherboard Phase 1: stamp the canonical prompt version per job.
          promptVersion: PROMPT_VERSION,
          // Thin Motherboard Phase 3: every NEW job inherits the project's
          // translation-intelligence mode at enqueue time. The 14/92 Urdu job
          // has existing rows (dup-continue) → never re-stamped → untouched.
          translationIntelligenceMode: intelMode,
        });
        if (!preDone) created++;
      }
    }

    // Job counters on the project (progress UI)
    const allJobs = await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const totalJobs = allJobs.length;
    const completedJobs = allJobs.filter((j) => j.status === "done").length;
    const failedJobs = allJobs.filter((j) => j.status === "failed").length;
    await ctx.db.patch(args.projectId, {
      totalTranslationJobs: totalJobs,
      completedTranslationJobs: completedJobs,
      failedTranslationJobs: failedJobs,
      translationMode: "adaptive_parallel",
      pipelineVersion: TRANSLATION_CONFIG.pipelineVersion,
    });

    return { created, skippedDone, chunkCount, totalJobs };
  },
});

// Local copy of the production chunker (same algorithm as translateQueue
// chunkText: paragraph-aware accumulation). Imported copy would create a
// module-load cycle for actions; algorithm kept in lockstep.
function chunkTextForAdaptive(text: string): string[] {
  const maxWords = 2500;
  if (!text || !text.trim()) return [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;
  const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
  for (const para of paragraphs) {
    const w = wordCount(para);
    if (w > maxWords) {
      if (current) {
        chunks.push(current);
        current = "";
        currentWords = 0;
      }
      const sentences = para.split(/(?<=[.!?。！？])\s+/);
      let sentenceBuf = "";
      for (const s of sentences) {
        if (wordCount(sentenceBuf) + wordCount(s) > maxWords && sentenceBuf) {
          chunks.push(sentenceBuf);
          sentenceBuf = s;
        } else {
          sentenceBuf = sentenceBuf ? `${sentenceBuf} ${s}` : s;
        }
      }
      if (sentenceBuf) chunks.push(sentenceBuf);
      continue;
    }
    if (currentWords + w > maxWords && current) {
      chunks.push(current);
      current = para;
      currentWords = w;
    } else {
      current = current ? `${current}\n\n${para}` : para;
      currentWords += w;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ─── Claims ───────────────────────────────────────────────────────────────

/**
 * Find the next claimable candidate (pending, sorted by lang+chunk) plus
 * whether its right neighbor is also pending (pair eligibility) and the
 * current rate-row worker limit. Read-only — the claim mutation re-checks
 * everything inside its own transaction (never trust a stale read).
 */
/** Thin Motherboard Phase 3: per-job intelligence mode (job → project fallback). */
function intelModeOf(job: {
  translationIntelligenceMode?: string;
  projectId: Id<"projects">;
}): "legacy_postprocess" | "gemini_contract" {
  // Per-job stamp is authoritative; the dispatcher passes the project default.
  return (job.translationIntelligenceMode === "gemini_contract"
    ? "gemini_contract"
    : "legacy_postprocess");
}
export const findNextClaimable = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | null
    | {
        jobId: Id<"translationJobs">;
        langCode: string;
        chunkIndex: number;
        neighborPending: boolean;
        intelMode: "legacy_postprocess" | "gemini_contract";
        sourceLenA: number;
        sourceLenB: number;
        workerLimit: number;
        remainingJobs: number;
      }
  > => {
    const pending = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "pending"),
      )
      .collect()) as JobDoc[];
    if (pending.length === 0) return null;
    pending.sort((a, b) => {
      if (a.langCode !== b.langCode) return a.langCode < b.langCode ? -1 : 1;
      return a.chunkIndex - b.chunkIndex;
    });    const first = pending[0];
    const neighbor = pending.find(
      (j) => j.langCode === first.langCode && j.chunkIndex === first.chunkIndex + 1,
    );
    const rate = (await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()) as RateDoc | null;
    // Thin Motherboard Phase 3: pairing only within one intelligence mode —
    // a contract job never pairs with a legacy job (different prompt and
    // response envelope). Mixed flag states fall back to singles.
    const contractMode = intelModeOf(first);
    const neighborEligible =
      !!neighbor && intelModeOf(neighbor) === contractMode;
    const inFlight = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "claimed"),
      )
      .collect()) as JobDoc[];
    return {
      jobId: first._id,
      langCode: first.langCode,
      chunkIndex: first.chunkIndex,
      neighborPending: neighborEligible,
      intelMode: contractMode,
      sourceLenA: first.sourceText.length,
      sourceLenB: neighborEligible ? neighbor.sourceText.length : 0,
      workerLimit: rate?.workerLimit ?? TRANSLATION_CONFIG.workerCount,
      remainingJobs: pending.length + inFlight.length,
    };
  },
});

/** Dispatcher heartbeat (tick start) — powers honest liveness UI. */
export const recordDispatcherHeartbeat = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, { lastDispatcherAt: Date.now() });
  },
});

/** Persist a dispatcher error — never silently swallowed (P2 hardening). */
export const recordDispatcherError = internalMutation({
  args: { projectId: v.id("projects"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      lastDispatcherError: args.error.slice(0, 500),
      lastDispatcherAt: Date.now(),
    });
  },
});

/** Clear a daily-pause when midnight Pacific has passed. */
export const resumeFromDailyPause = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      governorState: "running",
      governorResumeAt: undefined,
    });
  },
});

/** Claim a PAIR of adjacent pending chunks for one Gemini request. */
export const claimJobPair = internalMutation({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    chunkIndex: v.number(),
    promptOverheadChars: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | null
    | { kind: "single"; job: JobDoc }
    | { kind: "pair"; jobs: [JobDoc, JobDoc]; requestGroupId: string }
  > => {
    const now = Date.now();
    const idemA = translationJobIdempotencyKey(args.projectId, args.langCode, args.chunkIndex);
    const jobA = (await ctx.db
      .query("translationJobs")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idemA))
      .first()) as JobDoc | null;
    if (!jobA || jobA.status !== "pending") return null;

    const rate = (await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()) as RateDoc | null;
    const pairDisabled = rate?.pairMergeDisabledLangs?.includes(args.langCode) ?? false;

    const tokenA = `claim_${jobA._id}_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const claimA = () =>
      ctx.db.patch(jobA._id, {
        status: "claimed",
        claimedAt: now,
        heartbeatAt: now,
        claimToken: tokenA,
      });

    if (pairDisabled || !TRANSLATION_CONFIG.pairMergeEnabled) {
      await claimA();
      return { kind: "single", job: { ...jobA, status: "claimed" } };
    }

    // B exists and is pending AND the safe estimate fits → claim as a pair
    const idemB = translationJobIdempotencyKey(
      args.projectId,
      args.langCode,
      args.chunkIndex + 1,
    );
    const jobB = (await ctx.db
      .query("translationJobs")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idemB))
      .first()) as JobDoc | null;

    const sepLen = 60; // ONYX_CHUNK marker separator length
    const safeTokens = estimateSafePairTokens(
      jobA.sourceText.length,
      jobB?.sourceText?.length ?? 0,
      sepLen,
      args.promptOverheadChars,
    );
    if (
      jobB &&
      jobB.status === "pending" &&
      // Thin Motherboard Phase 3: never pair across intelligence modes —
      // contract and legacy jobs use different prompts and response envelopes.
      intelModeOf(jobB) === intelModeOf(jobA) &&
      safeTokens <= TRANSLATION_CONFIG.pairMergeMaxEstimatedInputTokens
    ) {
      const tokenB = `claim_${jobB._id}_${now}_${Math.random().toString(36).slice(2, 10)}`;
      const requestGroupId = `pair_${jobA._id}_${jobB._id}`;
      await claimA();
      await ctx.db.patch(jobB._id, {
        status: "claimed",
        claimedAt: now,
        heartbeatAt: now,
        claimToken: tokenB,
        requestGroupId,
      });
      await ctx.db.patch(jobA._id, { requestGroupId });
      return {
        kind: "pair",
        jobs: [
          { ...jobA, status: "claimed", requestGroupId },
          { ...jobB, status: "claimed", requestGroupId },
        ],
        requestGroupId,
      };
    }

    await claimA();
    return { kind: "single", job: { ...jobA, status: "claimed" } };
  },
});

function estimateSafePairTokens(
  lenA: number,
  lenB: number,
  sepLen: number,
  promptOverhead: number,
): number {
  const raw = (lenA + sepLen + lenB + promptOverhead) / TRANSLATION_CONFIG.estimatedCharsPerToken;
  return Math.ceil(Math.ceil(raw) * (1 + TRANSLATION_CONFIG.pairMergeHeadroomRatio));
}

// ─── Heartbeat ────────────────────────────────────────────────────────────

export const heartbeat = internalMutation({
  args: { jobId: v.id("translationJobs"), claimToken: v.string() },
  handler: async (ctx, args) => {
    const job = (await ctx.db.get(args.jobId)) as JobDoc | null;
    if (!job || job.claimToken !== args.claimToken) return false;
    await ctx.db.patch(args.jobId, { heartbeatAt: Date.now() });
    return true;
  },
});

// ─── Rate limiting (ONE project-level pool) ───────────────────────────────

/** Throws { code: "rpm" | "daily" } when the next request is not allowed. */
export const acquireRequestSlot = internalMutation({
  args: {
    projectId: v.id("projects"),
    workerLimit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: true; dayKey: string } | { ok: false; code: "rpm" | "daily"; resumeAt?: number }> => {
    const now = Date.now();
    let rate = (await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()) as RateDoc | null;

    if (!rate) {
      const id = await ctx.db.insert("rateLimits", {
        projectId: args.projectId,
        windowStartMs: now,
        requestTimestamps: [],
        requestsToday: 0,
        requestDayPacific: pacificDateKey(now),
        consecutive429Count: 0,
        workerLimit: args.workerLimit ?? TRANSLATION_CONFIG.workerCount,
        lastUpdatedAt: now,
      });
      rate = (await ctx.db.get(id)) as RateDoc;
    }

    let stamps = rate.requestTimestamps;
    let requestsToday = rate.requestsToday;
    let dayKey = rate.requestDayPacific;
    const todayKey = pacificDateKey(now);

    // Midnight-Pacific rollover: reset the daily counter automatically.
    if (dayKey !== todayKey) {
      requestsToday = 0;
      dayKey = todayKey;
    }

    // Rolling 60s window
    stamps = stamps.filter((t) => now - t < 60_000);
    if (stamps.length >= TRANSLATION_CONFIG.targetRpm) {
      await ctx.db.patch(rate._id, {
        requestTimestamps: stamps,
        requestsToday,
        requestDayPacific: dayKey,
        lastUpdatedAt: now,
      });
      return { ok: false, code: "rpm" };
    }

    // Daily governor
    if (requestsToday >= TRANSLATION_CONFIG.dailyRequestBudget) {
      const resumeAt = now + msUntilNextPacificMidnight(now);
      await ctx.db.patch(rate._id, {
        requestTimestamps: stamps,
        requestsToday,
        requestDayPacific: dayKey,
        lastUpdatedAt: now,
      });
      await ctx.db.patch(args.projectId, {
        governorState: "daily_paused",
        governorResumeAt: resumeAt,
      });
      // (project patch above keeps the UI honest: daily_paused + resume time)
      return { ok: false, code: "daily", resumeAt };
    }

    // Commit the slot (a request WILL be sent)
    stamps.push(now);
    await ctx.db.patch(rate._id, {
      requestTimestamps: stamps,
      requestsToday: requestsToday + 1,
      requestDayPacific: dayKey,
      lastUpdatedAt: now,
    });
    await ctx.db.patch(args.projectId, {
      requestsToday: requestsToday + 1,
      requestDayPacific: dayKey,
      lastRequestAt: now,
    });
    return { ok: true, dayKey };
  },
});

export const record429 = internalMutation({
  args: { projectId: v.id("projects"), retryAfterMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rate = (await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()) as RateDoc | null;
    const consecutive = (rate?.consecutive429Count ?? 0) + 1;
    // Repeated 429 → reduce workers (min 1); 2+ consecutive → halve further
    let workerLimit = rate?.workerLimit ?? TRANSLATION_CONFIG.workerCount;
    if (consecutive >= TRANSLATION_CONFIG.max429AttemptsBeforeWorkerReduction) {
      workerLimit = Math.max(1, workerLimit - 1);
    }
    if (consecutive >= TRANSLATION_CONFIG.maxConsecutive429TicksBeforeHalvingWorkers * 2) {
      workerLimit = Math.max(1, Math.floor(workerLimit / 2));
    }
    if (rate) {
      await ctx.db.patch(rate._id, {
        consecutive429Count: consecutive,
        workerLimit,
        lastUpdatedAt: now,
      });
    }
    await ctx.db.patch(args.projectId, {
      consecutive429Count: consecutive,
      activeWorkerCount: workerLimit,
      governorState: "waiting_retry",
    });
  },
});

export const recordRequestSuccess = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rate = (await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()) as RateDoc | null;
    if (rate && rate.consecutive429Count > 0) {
      await ctx.db.patch(rate._id, { consecutive429Count: 0, lastUpdatedAt: now });
    }
    const project = (await ctx.db.get(args.projectId)) as { governorState?: string } | null;
    if (project?.governorState === "waiting_retry") {
      await ctx.db.patch(args.projectId, {
        governorState: "running",
        consecutive429Count: 0,
        lastSuccessfulActivityAt: now,
      });
    } else {
      await ctx.db.patch(args.projectId, { lastSuccessfulActivityAt: now });
    }
  },
});

export const releaseUnprocessedSlot = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    // A claimed slot whose request was never sent (e.g. pair overflow fallback)
    const rate = (await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first()) as RateDoc | null;
    if (!rate) return;
    const stamps = [...rate.requestTimestamps];
    if (stamps.length > 0) {
      stamps.pop();
      const project = (await ctx.db.get(args.projectId)) as
        | { requestsToday?: number }
        | null;
      await ctx.db.patch(rate._id, {
        requestTimestamps: stamps,
        requestsToday: Math.max(0, rate.requestsToday - 1),
        lastUpdatedAt: Date.now(),
      });
      if (project && (project.requestsToday ?? 0) > 0) {
        await ctx.db.patch(args.projectId, {
          requestsToday: (project.requestsToday ?? 1) - 1,
        });
      }
    }
  },
});

// ─── Job completion / failure paths ──────────────────────────────────────

export const completeJobs = internalMutation({
  args: {
    results: v.array(
      v.object({
        jobId: v.id("translationJobs"),
        claimToken: v.string(),
        resultText: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let committed = 0;
    for (const r of args.results) {
      const job = (await ctx.db.get(r.jobId)) as JobDoc | null;
      if (!job) continue;
      if (job.claimToken !== r.claimToken) continue; // late worker: stale claim loses
      await ctx.db.patch(r.jobId, {
        status: "done",
        resultText: r.resultText,
        completedAt: Date.now(),
        claimToken: undefined,
        lastError: undefined,
      });
      committed++;
    }
    return { committed };
  },
});

/**
 * Thin Motherboard Phase 2 — arm the strict-retry state on a job whose first
 * response failed contract validation. Keeps the claim alive; the dispatcher
 * immediately re-asks with the strict prompt. Never overwrites done text.
 */
export const recordContractRetry = internalMutation({
  args: {
    jobId: v.id("translationJobs"),
    claimToken: v.string(),
    reason: v.string(),
    diagnostics: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = (await ctx.db.get(args.jobId)) as JobDoc | null;
    if (!job || job.claimToken !== args.claimToken) return { armed: false };
    await ctx.db.patch(args.jobId, {
      contractRetried: true,
      lastError: `contract retry: ${args.reason}`.slice(0, 500),
      rawModelOutput: args.diagnostics?.slice(0, 20_000) ?? job.rawModelOutput,
    });
    return { armed: true };
  },
});

/**
 * Thin Motherboard Phase 2 — terminal-but-flagged outcome for a chunk whose
 * response failed contract validation twice (initial + strict retry).
 * NEVER claimed by the dispatcher, NEVER overwritten (claimToken already
 * cleared), visible in the job UI. Diagnostics preserved on the job.
 */
export const markNeedsReview = internalMutation({
  args: {
    jobId: v.id("translationJobs"),
    claimToken: v.string(),
    reason: v.string(),
    diagnostics: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = (await ctx.db.get(args.jobId)) as JobDoc | null;
    if (!job || job.claimToken !== args.claimToken) return { flagged: false };
    await ctx.db.patch(args.jobId, {
      status: "needs_review",
      needsReview: true,
      reviewReason: args.reason.slice(0, 500),
      rawModelOutput: args.diagnostics?.slice(0, 20_000) ?? job.rawModelOutput,
      claimToken: undefined,
      lastError: `needs_review: ${args.reason}`.slice(0, 500),
    });
    return { flagged: true };
  },
});

/**
 * Thin Motherboard Phase 2 — clear a needs_review flag after a human or the
 * QA-requeue path has reviewed/re-translated the chunk. Only needs_review
 * rows are affected; done rows can never be touched by this.
 */
export const resolveNeedsReview = internalMutation({
  args: {
    jobId: v.id("translationJobs"),
    resolvedText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = (await ctx.db.get(args.jobId)) as JobDoc | null;
    if (!job || job.status !== "needs_review") return { requeued: false };
    if (args.resolvedText && args.resolvedText.trim().length > 0) {
      await upsertTranslationResult(ctx, {
        projectId: job.projectId,
        langCode: job.langCode,
        chunkIndex: job.chunkIndex,
        sourceText: job.sourceText,
        translatedText: args.resolvedText,
        model: "manual_resolution",
      });
      await ctx.db.patch(args.jobId, {
        status: "done",
        needsReview: false,
        reviewReason: undefined,
        resultText: args.resolvedText,
        completedAt: Date.now(),
      });
    } else {
      // Requeue WITHOUT incrementing contract retries (fresh validation cycle).
      await ctx.db.patch(args.jobId, {
        status: "pending",
        needsReview: false,
        reviewReason: undefined,
        contractRetried: false,
        nextRetryAt: undefined,
      });
    }
    return { requeued: true };
  },
});

export const failJobForRetry = internalMutation({
  args: {
    jobId: v.id("translationJobs"),
    claimToken: v.string(),
    error: v.string(),
    httpStatus: v.optional(v.number()),
    attemptOverride: v.optional(v.number()),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = (await ctx.db.get(args.jobId)) as JobDoc | null;
    if (!job || job.claimToken !== args.claimToken) return { rescheduled: false };
    const attempts = args.attemptOverride ?? job.attempts + 1;
    if (attempts >= TRANSLATION_CONFIG.maxAttempts) {
      await ctx.db.patch(args.jobId, {
        status: "failed",
        attempts,
        lastError: args.error.slice(0, 500),
        lastHttpStatus: args.httpStatus,
        claimToken: undefined,
      });
      const project = (await ctx.db.get(job.projectId)) as
        | { failedTranslationJobs?: number }
        | null;
      await ctx.db.patch(job.projectId, {
        failedTranslationJobs: (project?.failedTranslationJobs ?? 0) + 1,
      });
      return { rescheduled: false, failed: true };
    }
    const delay = computeBackoffDelayMs(attempts, args.httpStatus === 429 ? args.retryAfterMs : undefined);
    await ctx.db.patch(args.jobId, {
      status: "retry_wait",
      attempts,
      lastError: args.error.slice(0, 500),
      lastHttpStatus: args.httpStatus,
      nextRetryAt: Date.now() + delay,
      claimToken: undefined,
    });
    return { rescheduled: true, delayMs: delay };
  },
});
void failJobForRetry;

export const markPairSplit = internalMutation({
  args: {
    jobIdA: v.id("translationJobs"),
    jobIdB: v.id("translationJobs"),
    claimTokenA: v.string(),
    claimTokenB: v.string(),
    rawOutput: v.string(),
  },
  handler: async (ctx, args) => {
    const jobA = (await ctx.db.get(args.jobIdA)) as JobDoc | null;
    const jobB = (await ctx.db.get(args.jobIdB)) as JobDoc | null;
    if (!jobA || jobA.claimToken !== args.claimTokenA) return { split: false };
    const failures = (jobA.pairFailureCount ?? 0) + 1;
    await ctx.db.patch(args.jobIdA, {
      status: "pending",
      requestGroupId: undefined,
      claimToken: undefined,
      pairFailureCount: failures,
      rawModelOutput: args.rawOutput.slice(0, 20_000),
    });
    if (jobB && jobB.claimToken === args.claimTokenB) {
      await ctx.db.patch(args.jobIdB, {
        status: "pending",
        requestGroupId: undefined,
        claimToken: undefined,
      });
    }
    // Repeated malformed pairs → circuit-break pairing for this language
    if (failures >= 2) {
      const rate = (await ctx.db
        .query("rateLimits")
        .withIndex("by_project", (q) => q.eq("projectId", jobA.projectId))
        .first()) as RateDoc | null;
      if (rate) {
        const langs = new Set(rate.pairMergeDisabledLangs ?? []);
        langs.add(jobA.langCode);
        await ctx.db.patch(rate._id, {
          pairMergeDisabledLangs: [...langs],
          lastUpdatedAt: Date.now(),
        });
      }
    }
    return { split: true };
  },
});

/** Requeue a stale claim (worker crashed / heartbeat expired). */
export const reclaimStaleJobs = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttl = TRANSLATION_CONFIG.heartbeatTtlMs;
    const stale = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "claimed"),
      )
      .collect()) as JobDoc[];
    let reclaimed = 0;
    for (const job of stale) {
      if (job.heartbeatAt && now - job.heartbeatAt < ttl) continue;
      if (job.status === "running") continue; // running rows handled by dispatcher
      await ctx.db.patch(job._id, {
        status: "pending",
        claimToken: undefined,
        reclaimCount: (job.reclaimCount ?? 0) + 1,
        nextRetryAt: now,
      });
      reclaimed++;
    }
    return { reclaimed };
  },
});

/** Promote retry_wait jobs whose nextRetryAt has arrived. */
export const promoteRetryableJobs = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const waiting = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "retry_wait"),
      )
      .collect()) as JobDoc[];
    let promoted = 0;
    for (const job of waiting) {
      if ((job.nextRetryAt ?? 0) > now) continue;
      await ctx.db.patch(job._id, { status: "pending", nextRetryAt: undefined });
      promoted++;
    }
    return { promoted };
  },
});

/** Write results into the existing chunks/translations tables (progress). */
export const flushJobResults = internalMutation({
  args: {
    results: v.array(
      v.object({
        langCode: v.string(),
        chunkIndex: v.number(),
        sourceText: v.string(),
        translatedText: v.string(),
        model: v.string(),
      }),
    ),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    // Thin Motherboard Phase 3: the project's contract flag decides the
    // assembly law. gemini_contract → code NEVER rewrites saved prose
    // (pure concatenation); legacy_postprocess → pre-migration behavior.
    const proj = (await ctx.db.get(args.projectId)) as
      | { translationIntelligenceMode?: string }
      | null;
    const contractMode = proj?.translationIntelligenceMode === "gemini_contract";
    let writes = 0;
    const BUDGET = TRANSLATION_CONFIG.maxDatabaseWritesPerAction;
    // Thin Motherboard Phase 2: flagged jobs per language (used for the
    // per-language completion gate below; one needs_review chunk must not
    // freeze its language's assembly).
    const allJobs = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()) as JobDoc[];
    for (const r of args.results) {
      if (writes >= BUDGET) break;
      await upsertTranslationResult(ctx, {
        projectId: args.projectId,
        langCode: r.langCode,
        chunkIndex: r.chunkIndex,
        sourceText: r.sourceText,
        translatedText: r.translatedText,
        model: r.model,
        intelMode: contractMode ? "gemini_contract" : undefined,
      });
      writes++;
    }

    // Per-language progress + completion detection
    const langs = [...new Set(args.results.map((r) => r.langCode))];
    for (const langCode of langs) {
      const allChunks = await ctx.db
        .query("chunks")
        .withIndex("by_project_lang", (q) =>
          q.eq("projectId", args.projectId).eq("langCode", langCode),
        )
        .collect();
      const doneCount = allChunks.filter(
        (c: { status: string }) => c.status === "done",
      ).length;
      // Thin Motherboard Phase 2: needs_review jobs count toward completion
      // (their chunk is intentionally absent from the assembly until a human
      // resolves the flag) — one flagged chunk must not freeze the language.
      const flaggedCount = allJobs.filter(
        (j) =>
          j.status === "needs_review" &&
          j.langCode === langCode,
      ).length;
      const translations = await ctx.db
        .query("translations")
        .withIndex("by_project_lang", (q) =>
          q.eq("projectId", args.projectId).eq("langCode", langCode),
        )
        .collect();
      const translation = translations[0];
      if (!translation) continue;
      const total = Math.max(translation.totalChunks, allChunks.length);
      if (doneCount + flaggedCount >= total && total > 0) {
        // Language complete → merge (with P4.4 boundary repair) + enqueue PDF.
        const ordered = allChunks.sort(
          (a: { chunkIndex: number }, b: { chunkIndex: number }) =>
            a.chunkIndex - b.chunkIndex,
        );
        // Thin Motherboard Phase 3: contract chunks assemble via PURE
        // concatenation (Gemini owns sentence/paragraph integrity, verified
        // by the contract validators); legacy keeps boundary repair + sweep.
        const mergedText = contractMode
          ? assembleContractChunks(
              ordered.map((c: { translatedText?: string }) => c.translatedText || ""),
            )
          : assembleWithBoundaryRepair(
              ordered.map((c: { translatedText?: string }) => c.translatedText || ""),
            );
        // P4: final artifact sweep at language assembly — LEGACY ONLY.
        // Contract output is saved verbatim (code verifies, never rewrites).
        let finalText = mergedText;
        if (!contractMode) {
          const swept = filterGeneratedArtifacts(mergedText);
          if (swept.removals.length > 0) {
            console.log(
              `[languageRules] ${langCode} FINAL: removed ${swept.removals.length} artifact(s)`,
            );
          }
          finalText = swept.text;
        }
        await ctx.db.patch(translation._id, {
          status: "generating_pdf",
          completedChunks: doneCount,
          totalChunks: total,
          mergedText: finalText,
          pdfGenerating: true,
          lastChunkAt: Date.now(),
        });
        await ctx.scheduler.runAfter(0, api.adaptiveJobs.generateLanguagePdf, {
          projectId: args.projectId,
          langCode,
          translationId: translation._id,
          mergedText: finalText,
        });
        // (PDF render failure is caught inside generateTranslatedPdf and marks
        // the translation row error — the chain never dies silently here.)
      } else {
        await ctx.db.patch(translation._id, {
          status: "in_progress",
          completedChunks: doneCount,
          totalChunks: total,
          lastChunkAt: Date.now(),
        });
      }
    }

    // Project-level progress counters (reuses allJobs loaded above)
    const doneJobs = allJobs.filter((j) => j.status === "done").length;
    const flaggedJobs = allJobs.filter((j) => j.status === "needs_review").length;
    const failedJobs = allJobs.filter((j) => j.status === "failed").length;
    await ctx.db.patch(args.projectId, {
      completedTranslationJobs: doneJobs,
      failedTranslationJobs: failedJobs,
      totalTranslationJobs: Math.max(allJobs.length, doneJobs),
      lastSuccessfulActivityAt: Date.now(),
    });

    return { writes };
  },
});

/**
 * Crash-race reconcile: a job whose chunk is ALREADY done in the chunks table
 * must never be re-translated. The worker path (flush → complete) can lose the
 * claimToken race against reclaimStaleJobs (flush persists the chunk, reclaim
 * re-pends the job, then completeJobs drops the late result as stale). This
 * mutation heals that state with ZERO Gemini calls: any in-flight job whose
 * chunk row is done is marked done verbatim, then the SAME completion
 * detection / assembly / PDF scheduling from flushJobResults runs for every
 * affected language. Idempotent — safe to call repeatedly.
 */
export const reconcileDoneChunks = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const proj = (await ctx.db.get(args.projectId)) as
      | { translationIntelligenceMode?: string; pdfStorageId?: string }
      | null;
    if (!proj) throw new Error("Project not found");
    const contractMode = proj.translationIntelligenceMode === "gemini_contract";

    const allJobs = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()) as JobDoc[];

    // 1) Heal jobs whose chunk is already done (the flush/reclaim race).
    let reconciled = 0;
    const healedLangs = new Set<string>();
    for (const job of allJobs) {
      if (job.status === "done" || job.status === "failed" || job.status === "needs_review") continue;
      const chunk = (await ctx.db
        .query("chunks")
        .withIndex("by_project_lang", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("langCode", job.langCode)
            .eq("chunkIndex", job.chunkIndex),
        )
        .first()) as { status: string; translatedText?: string } | null;
      if (!chunk || chunk.status !== "done" || !chunk.translatedText) continue;
      await ctx.db.patch(job._id, {
        status: "done",
        resultText: chunk.translatedText,
        completedAt: now,
        claimToken: undefined,
        lastError: undefined,
        nextRetryAt: undefined,
      });
      reconciled++;
      healedLangs.add(job.langCode);
    }

    // 2) Re-run flushJobResults' completion detection for healed languages.
    const pdfScheduled: string[] = [];
    for (const langCode of healedLangs) {
      const allChunks = await ctx.db
        .query("chunks")
        .withIndex("by_project_lang", (q) =>
          q.eq("projectId", args.projectId).eq("langCode", langCode),
        )
        .collect();
      const doneCount = allChunks.filter(
        (c: { status: string }) => c.status === "done",
      ).length;
      const flaggedCount = allJobs.filter(
        (j) => j.status === "needs_review" && j.langCode === langCode,
      ).length;
      const translations = await ctx.db
        .query("translations")
        .withIndex("by_project_lang", (q) =>
          q.eq("projectId", args.projectId).eq("langCode", langCode),
        )
        .collect();
      const translation = translations[0];
      if (!translation) continue;
      const total = Math.max(translation.totalChunks, allChunks.length);
      if (doneCount + flaggedCount >= total && total > 0) {
        const ordered = allChunks.sort(
          (a: { chunkIndex: number }, b: { chunkIndex: number }) =>
            a.chunkIndex - b.chunkIndex,
        );
        const mergedText = contractMode
          ? assembleContractChunks(
              ordered.map((c: { translatedText?: string }) => c.translatedText || ""),
            )
          : assembleWithBoundaryRepair(
              ordered.map((c: { translatedText?: string }) => c.translatedText || ""),
            );
        let finalText = mergedText;
        if (!contractMode) {
          finalText = filterGeneratedArtifacts(mergedText).text;
        }
        await ctx.db.patch(translation._id, {
          status: "generating_pdf",
          completedChunks: doneCount,
          totalChunks: total,
          mergedText: finalText,
          pdfGenerating: true,
          lastChunkAt: now,
        });
        await ctx.scheduler.runAfter(0, api.adaptiveJobs.generateLanguagePdf, {
          projectId: args.projectId,
          langCode,
          translationId: translation._id,
          mergedText: finalText,
        });
        pdfScheduled.push(langCode);
      } else {
        await ctx.db.patch(translation._id, {
          status: "in_progress",
          completedChunks: doneCount,
          totalChunks: total,
          lastChunkAt: now,
        });
      }
    }

    // 2.5) Pasted-text recovery: the overlay renderer skips projects with no
    // source PDF (complete, no artifact). Render the text PDF itself so the
    // pipeline always ends in a downloadable artifact.
    const scheduledTextPdf: string[] = [];
    if (!proj.pdfStorageId) {
      const allTranslations = (await ctx.db
        .query("translations")
        .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
        .collect()) as Array<{
        _id: Id<"translations">;
        langCode: string;
        status: string;
        pdfUrl?: string;
        pdfGenerating?: boolean;
      }>;
      for (const t of allTranslations) {
        if (t.status !== "complete" || t.pdfUrl || t.pdfGenerating) continue;
        await ctx.db.patch(t._id, { pdfGenerating: true });
        await ctx.scheduler.runAfter(0, api.textPdf.generateTextPdf, {
          projectId: args.projectId,
          translationId: t._id,
          langCode: t.langCode,
        });
        scheduledTextPdf.push(t.langCode);
      }
    }

    // 3) Refresh project-level counters (same law as flushJobResults).
    const freshJobs = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()) as JobDoc[];
    const doneJobs = freshJobs.filter((j) => j.status === "done").length;
    const flaggedJobs = freshJobs.filter((j) => j.status === "needs_review").length;
    const failedJobs = freshJobs.filter((j) => j.status === "failed").length;
    await ctx.db.patch(args.projectId, {
      completedTranslationJobs: doneJobs,
      failedTranslationJobs: failedJobs,
      totalTranslationJobs: Math.max(freshJobs.length, doneJobs),
      lastSuccessfulActivityAt: now,
    });

    return { reconciled, pdfScheduled, scheduledTextPdf };
  },
});

/**
 * Pasted-text projects have no source PDF to overlay; the overlay renderer
 * short-circuits (complete, no artifact). This schedules the text renderer
 * (convex/textPdf.ts) for a language whose translation row is complete with
 * no artifact yet. Called from generateTranslatedPdf's adaptive pasted-text
 * branch and from reconcileDoneChunks' pasted-text recovery step.
 */
export const scheduleTextPdfIfPasted = internalMutation({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || (project as { pdfStorageId?: string }).pdfStorageId) {
      return { scheduled: false, reason: "not_pasted_or_missing" };
    }
    const translations = (await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode),
      )
      .collect()) as Array<{
      _id: Id<"translations">;
      status: string;
      pdfUrl?: string;
      pdfGenerating?: boolean;
    }>;
    const row = translations[0];
    if (!row || row.status !== "complete") return { scheduled: false, reason: "not_complete" };
    if (row.pdfUrl || row.pdfGenerating) return { scheduled: false, reason: "already_has_or_inflight" };
    await ctx.db.patch(row._id, { pdfGenerating: true });
    await ctx.scheduler.runAfter(0, api.textPdf.generateTextPdf, {
      projectId: args.projectId,
      translationId: row._id,
      langCode: args.langCode,
    });
    return { scheduled: true };
  },
});

// ─── Per-language PDF after adaptive completion ──────────────────────────
// The adaptive path intentionally does NOT pass nextLangCode/remainingLangs
// (the dispatcher owns the language chain now); zipFinalize runs when the
// project's translations are all terminal, so legacy zipAssembly.buildZip is
// never fired early or twice.

export const generateLanguagePdf = internalAction({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    translationId: v.id("translations"),
    mergedText: v.string(),
  },
  handler: async (ctx, args) => {
    // Delegate to the PRODUCTION whole-book renderer first (proven fidelity).
    // finalizeChain:false → the legacy finalize (premature all_translated +
    // buildZip) does NOT run; zipFinalizeIfDone owns the end state.
    await ctx.runAction(api.generatePdf.generateTranslatedPdf, {
      projectId: args.projectId,
      langCode: args.langCode,
      translationId: args.translationId,
      mergedText: args.mergedText,
      nextLangCode: undefined,
      remainingLangs: undefined,
      finalizeChain: false,
    });
    // generatePdf without nextLangCode finalizes the project + builds ZIP —
    // for the adaptive path that is wrong (other languages may still run), so
    // reconcile: if any translation is still in flight, restore "translating"
    // and let the dispatcher/zipFinalize decide the real end state.
    await ctx.runMutation(api.adaptiveJobs.reconcileProjectAfterLanguagePdf, {
      projectId: args.projectId,
    });
    // FALLBACK (spec Phase 8): if the whole-book render failed (timeout/oom —
    // common on 600+ page books), rescue via idempotent 50→25→10 page batches
    // WITHOUT re-rendering what already succeeded.
    const row = (await ctx.runQuery(api.queries.getTranslationsRaw, {
      projectId: args.projectId,
    })) as Array<{ langCode: string; status: string; _id: Id<"translations"> }>;
    const lang = row.find((t) => t.langCode === args.langCode);
    if (lang && lang.status === "error") {
      const project = (await ctx.runQuery(api.queries.getProjectRaw, {
        projectId: args.projectId,
      })) as { pageCount?: number } | null;
      await ctx.runMutation(api.adaptivePdf.planLanguageBatches, {
        projectId: args.projectId,
        langCode: args.langCode,
        translationId: lang._id,
        pageCount: project?.pageCount ?? 0,
      });
      await ctx.scheduler.runAfter(0, api.adaptivePdf.processAllBatches, {
        projectId: args.projectId,
        langCode: args.langCode,
      });
    }
  },
});

export const reconcileProjectAfterLanguagePdf = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as { status?: string } | null;
    if (!project) return;
    const translations = await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId).eq("langCode", ""))
      .collect();
    void translations;
    const all = await ctx.db
      .query("translations")
      .filter((q) => q.eq(q.field("projectId"), args.projectId))
      .collect() as Array<{ status: string; langCode: string }>;
    const pending = all.filter(
      (t) => t.status === "in_progress" || t.status === "pending" || t.status === "generating_pdf",
    );
    if (pending.length > 0) {
      // More work in flight → keep the project translating (never complete early)
      if (project.status === "all_translated" || project.status === "complete") {
        await ctx.db.patch(args.projectId, { status: "translating" });
      }
      await ctx.db.patch(args.projectId, { zipState: "pending" });
    }
  },
});

// ─── ZIP finalization for the adaptive path ──────────────────────────────

export const zipFinalizeIfDone = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as { status?: string; zipState?: string } | null;
    if (!project) return { zipped: false };
    if (project.status === "cancelled" || project.status === "complete") {
      return { zipped: false };
    }
    const all = (await ctx.db
      .query("translations")
      .filter((q) => q.eq(q.field("projectId"), args.projectId))
      .collect()) as Array<{ status: string }>;
    if (all.length === 0) return { zipped: false };
    const terminal = all.every(
      (t) => t.status === "complete" || t.status === "error",
    );
    if (!terminal) return { zipped: false };
    // Thin Motherboard Phase 2: needs_review is TERMINAL-but-flagged — a
    // flagged chunk must never deadlock the whole book's ZIP. The flag row
    // stays visible/resolvable (resolveNeedsReview); the book ships without
    // the flagged chunk rather than stalling forever.
    const anyInFlightJobs = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect() as JobDoc[]).some(
      (j) =>
        j.status !== "done" &&
        j.status !== "failed" &&
        j.status !== "needs_review",
    );
    if (anyInFlightJobs) return { zipped: false };
    await ctx.db.patch(args.projectId, { status: "all_translated", zipState: "assembling" });
    await ctx.scheduler.runAfter(0, api.zipAssembly.buildZip, {
      projectId: args.projectId,
    });
    return { zipped: true };
  },
});

// ─── Public kick-off action (client-facing, replaces nothing) ────────────

export const startAdaptiveTranslation = action({
  args: {
    projectId: v.id("projects"),
    langCodes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");
    if ((project as { status?: string }).status === "translating") {
      return { started: false as const, reason: "already_translating" as const };
    }

    await ctx.runMutation(api.mutations.updateProject, {
      projectId: args.projectId,
      status: "translating",
    });
    const enq = await ctx.runMutation(api.adaptiveJobs.enqueueAdaptiveJobs, {
      projectId: args.projectId,
      langCodes: args.langCodes,
    });
    await ctx.runMutation(api.adaptiveJobs.initGovernor, {
      projectId: args.projectId,
    });
    // First dispatcher tick (self-rescheduling thereafter)
    await ctx.scheduler.runAfter(0, api.adaptiveDispatcher.dispatcherTick, {
      projectId: args.projectId,
    });
    return { started: true as const, ...enq };
  },
});

export const initGovernor = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as
      | { activeWorkerCount?: number; governorState?: string }
      | null;
    if (!project) return;
    await ctx.db.patch(args.projectId, {
      governorState: project.governorState === "daily_paused" ? "daily_paused" : "running",
      activeWorkerCount: project.activeWorkerCount ?? TRANSLATION_CONFIG.workerCount,
      lastDispatcherAt: Date.now(),
    });
  },
});

