import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/forensicProbe.ts — PHASE 0 forensic diagnosis (read-only).
 *
 * Extracts the EXACT incident evidence required by the P0 acceptance gate:
 * project/governor state, job status counts, last completed job, first
 * incomplete job, watchdog/dispatcher activity, and pair-boundary evidence.
 * READ-ONLY — never mutates anything.
 */

type JobRow = {
  _id: string;
  langCode: string;
  chunkIndex: number;
  status: string;
  attempts: number;
  reclaimCount?: number;
  lastError?: string;
  lastHttpStatus?: number;
  claimedAt?: number;
  startedAt?: number;
  completedAt?: number;
  heartbeatAt?: number;
  nextRetryAt?: number;
  requestGroupId?: string;
  mergedWithChunkIndex?: number;
  idempotencyKey: string;
  claimToken?: string;
};

export const diagnoseProject = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const p = await ctx.db.get(args.projectId);
    if (!p) return { found: false };

    const jobs = (await ctx.db
      .query("translationJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect()) as unknown as JobRow[];

    const counts: Record<string, number> = {
      pending: 0, claimed: 0, running: 0, done: 0, retry_wait: 0, failed: 0,
    };
    for (const j of jobs) counts[j.status] = (counts[j.status] ?? 0) + 1;

    // Last completed job (max completedAt among done)
    const doneJobs = jobs.filter((j) => j.status === "done" && j.completedAt);
    const lastDone = doneJobs.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];

    // First incomplete job: lowest chunkIndex in the lowest langCode with
    // non-done status, deterministic ordering.
    const statusRank: Record<string, number> = {
      running: 0, claimed: 1, retry_wait: 2, pending: 3, failed: 4,
    };
    const incomplete = jobs
      .filter((j) => j.status !== "done")
      .sort((a, b) =>
        a.langCode < b.langCode ? -1
        : a.langCode > b.langCode ? 1
        : (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
          a.chunkIndex - b.chunkIndex,
      )[0];

    // Pair-boundary evidence around the freeze point
    const pairRows = jobs
      .filter((j) => j.requestGroupId || j.mergedWithChunkIndex !== undefined)
      .slice(0, 10)
      .map((j) => ({
        idempotencyKey: j.idempotencyKey,
        status: j.status,
        requestGroupId: j.requestGroupId,
        mergedWithChunkIndex: j.mergedWithChunkIndex,
        lastError: j.lastError?.slice(0, 200),
      }));

    // Distinct langs present in jobs + per-lang done counts
    const perLang: Record<string, { total: number; done: number }> = {};
    for (const j of jobs) {
      perLang[j.langCode] ??= { total: 0, done: 0 };
      perLang[j.langCode].total++;
      if (j.status === "done") perLang[j.langCode].done++;
    }

    // Selected languages live in the translations table (one row per language).
    const translations = (await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
      .collect()) as unknown as Array<{
      targetLangCode?: string;
      status?: string;
      mergedText?: string;
    }>;
    const selectedLangCodes = translations.map((t) => t.targetLangCode ?? "?");
    const translationsWithText = translations.filter(
      (t) => (t.mergedText ?? "").length > 0,
    ).length;

    const rateRow = await ctx.db
      .query("rateLimits")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();

    return {
      found: true,
      project: {
        _id: String(p._id),
        clientId: p.clientId ?? null,
        sessionId: p.sessionId ?? null,
        status: p.status ?? null,
        translationMode: p.translationMode ?? "(unset — legacy)",
        governorState: p.governorState ?? null,
        governorResumeAt: p.governorResumeAt ?? null,
        requestsToday: p.requestsToday ?? null,
        requestDayPacific: p.requestDayPacific ?? null,
        activeWorkerCount: p.activeWorkerCount ?? null,
        lastDispatcherAt: p.lastDispatcherAt ?? null,
        lastSuccessfulActivityAt: p.lastSuccessfulActivityAt ?? null,
        selectedLangCodes,
        translationsRows: translations.length,
        translationsWithMergedText: translationsWithText,
        pipelineVersion: (p as { pipelineVersion?: string }).pipelineVersion ?? null,
      },
      jobCounts: counts,
      totalJobs: jobs.length,
      perLangDone: perLang,
      lastDoneJob: lastDone
        ? {
            langCode: lastDone.langCode,
            chunkIndex: lastDone.chunkIndex,
            completedAt: lastDone.completedAt,
            requestGroupId: lastDone.requestGroupId ?? null,
            idempotencyKey: lastDone.idempotencyKey,
          }
        : null,
      firstIncomplete: incomplete
        ? {
            langCode: incomplete.langCode,
            chunkIndex: incomplete.chunkIndex,
            status: incomplete.status,
            attempts: incomplete.attempts,
            reclaimCount: incomplete.reclaimCount ?? 0,
            lastError: incomplete.lastError?.slice(0, 300) ?? null,
            lastHttpStatus: incomplete.lastHttpStatus ?? null,
            claimedAt: incomplete.claimedAt ?? null,
            heartbeatAt: incomplete.heartbeatAt ?? null,
            nextRetryAt: incomplete.nextRetryAt ?? null,
            hasClaimToken: !!incomplete.claimToken,
            idempotencyKey: incomplete.idempotencyKey,
          }
        : null,
      pairEvidence: pairRows,
      rateLimitsRow: rateRow
        ? {
            requestsToday: rateRow.requestsToday,
            requestDayPacific: rateRow.requestDayPacific,
            consecutive429Count: rateRow.consecutive429Count,
            workerLimit: rateRow.workerLimit,
            windowTimestampCount: rateRow.requestTimestamps.length,
            pairMergeDisabledLangs: rateRow.pairMergeDisabledLangs ?? [],
            lastUpdatedAt: rateRow.lastUpdatedAt,
          }
        : null,
    };
  },
});

/** Watchdog run evidence across ALL projects (cron liveness). */
export const watchdogEvidence = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query("projects").collect()) as unknown as Array<{
      _id: string;
      status?: string;
      translationMode?: string;
      lastDispatcherAt?: number;
      lastSuccessfulActivityAt?: number;
      updatedAt?: number;
      governorState?: string;
    }>;
    return rows
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 12)
      .map((p) => ({
        projectId: String(p._id),
        status: p.status ?? null,
        translationMode: p.translationMode ?? "(unset)",
        governorState: p.governorState ?? null,
        lastDispatcherAt: p.lastDispatcherAt ?? null,
        lastSuccessfulActivityAt: p.lastSuccessfulActivityAt ?? null,
        updatedAt: p.updatedAt ?? null,
      }));
  },
});
void api;
