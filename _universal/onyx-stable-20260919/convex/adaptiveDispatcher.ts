"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import {
  TRANSLATION_CONFIG,
  computeBackoffDelayMs,
  buildPairUserContent,
  extractPairSection,
  looksLikeEnglishEcho,
  isLatinTarget,
} from "./translationConfig";
// Thin Motherboard Phase 1: dispatcher uses THE canonical prompt builder
// (Phase 3 flag decides plain vs JSON contract per job).
import { buildTranslationPrompt } from "./buildTranslationPrompt";
// Thin Motherboard Phase 2: the minimal ECC layer — parse + validate, never rewrite.
import {
  parseContractResponse,
  validateChunkResponse,
  validatePairItems,
  lockedTermsForChunk,
} from "./translationContract";
import {
  applyBiblePassForTest as applyBiblePassServer,
  postProcessTranslationForTest,
} from "./translateContent";
import { runQA } from "../src/lib/translator/qa";
import { evaluateLanguageQA } from "./languageRules";

/**
 * convex/adaptiveDispatcher.ts — ADAPTIVE PIPELINE (dispatcher)
 *
 * Self-rescheduling bounded tick. Per tick:
 *   1. honor cancellation / daily governor (with midnight-Pacific auto-resume)
 *   2. promote retryable jobs + reclaim stale claims (expired heartbeats)
 *   3. claim up to the configured job budget, ONE Gemini request per claim
 *      (adjacent chunks pair-merged when the safe token estimate fits)
 *      — Bible Pass locks glossary terms BEFORE the request; placeholders
 *        are restored in post-processing, identical to the legacy path
 *   4. commit every result immediately (completeJobs → flushJobResults)
 *   5. schedule the next tick and EXIT before the action safety deadline
 *
 * The full decision ladder: RPM refusal (re-tick), daily governor, 429
 * (backoff+jitter → worker reduction → waiting_retry), 5xx/timeout retries,
 * 401/403 key rotation, malformed pairs (raw saved → split → circuit-break),
 * cancellation/pause, ZIP finalization when all languages are terminal.
 */

type JobLite = {
  _id: string;
  langCode: string;
  chunkIndex: number;
  chunkCount?: number;
  sourceText: string;
  claimToken?: string;
  // Thin Motherboard Phase 2: strict-retry budget already spent?
  contractRetried?: boolean;
  translationIntelligenceMode?: string;
};

type Claimed =
  | { kind: "single"; job: JobLite }
  | { kind: "pair"; jobs: [JobLite, JobLite]; requestGroupId: string };

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Latin-script targets (English-echo check is meaningless for these).
const LATIN_TARGETS = new Set([
  "fr", "es", "tr", "de", "ro", "sw", "it", "la", "id", "pt",
]);

function getKeys(): string[] {
  return [
    process.env.Gemini_API_Key_1,
    process.env.Gemini_API_Key_2,
    process.env.Gemini_API_Key_3,
    process.env.Gemini_API_Key_4,
    process.env.Gemini_API_Key_5,
  ].filter((k): k is string => !!k);
}

/** Latin-ratio heuristic: catches untranslated English echo fast. */

/**
 * Thin Motherboard Phase 2 — strict retry: ONE re-ask with harder
 * instructions, then needs_review. Never a silent rewrite of the failed
 * output; the original raw reply is preserved as diagnostics.
 */
async function strictRetry(
  keys: string[],
  langCode: string,
  sourceText: string,
  chunkIndex: number,
  totalChunks: number,
  deadline: number,
): Promise<string | null> {
  const built = buildTranslationPrompt({
    sourceLanguage: "en",
    targetLanguage: langCode,
    langCode,
    marketContext: "standard",
    contract: "json",
    sourceText,
    chunkIndex,
    totalChunks,
    strict: true,
  });
  const resp = await callWithKeyRotation(keys, built.system, built.user, deadline);
  return resp.ok ? resp.text : null;
}

/**
 * QA gate (decision ladder: wrong-language / garbage / empty output).
 * Returns null when the output is acceptable, else a rejection reason.
 * Uses the SAME runQA engine as the legacy pipeline (P1–P23).
 */
function qaRejectReason(
  langCode: string,
  sourceText: string,
  translated: string,
): string | null {
  if (!translated.trim()) return "empty output";
  if (!isLatinTarget(langCode) && looksLikeEnglishEcho(translated)) {
    return "untranslated English echo";
  }
  // P4.3: language-quality gate — script ratio, English echo, artifacts,
  // delimiter leakage, replacement glyphs, paragraph parity.
  try {
    const lqa = evaluateLanguageQA(langCode, sourceText, translated);
    if (!lqa.ok) {
      // needs_review-grade failures never silently pass; retry carries the reason.
      return `language QA: ${lqa.failures.slice(0, 3).join("; ")}`;
    }
  } catch {
    // QA layer itself failed → fall through to the legacy gate below
  }
  try {
    const qa = runQA(sourceText, translated, langCode, []);
    if (qa.overall === "fail") {
      return `QA fail (${qa.score}/100): ${qa.summary?.[0] ?? "quality gate"}`;
    }
  } catch {
    // QA engine itself failed → do not block the translation on it
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; status?: number; error: string; retryAfterMs?: number };

function callGeminiOnce(
  key: string,
  systemPrompt: string,
  userContent: string,
  timeoutMs: number,
): Promise<GeminiResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
    signal: ctrl.signal,
  })
    .then(async (res): Promise<GeminiResult> => {
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const text = data.choices?.[0]?.message?.content;
        if (!text) return { ok: false, status: 502, error: "Empty model response" };
        const cleaned = text
          .replace(/^```[a-z]*\n?/i, "")
          .replace(/\n?```$/i, "")
          .trim();
        return { ok: true, text: cleaned };
      }
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : undefined;
      let errText = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) errText = body.error.message.slice(0, 300);
      } catch {
        /* keep status text */
      }
      return { ok: false, status: res.status, error: errText, retryAfterMs };
    })
    .catch((e: unknown): GeminiResult => {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: /abort/i.test(msg) ? "timeout" : msg };
    });
}

async function callWithKeyRotation(
  keys: string[],
  systemPrompt: string,
  userContent: string,
  deadlineAt: number,
): Promise<GeminiResult> {
  let last: GeminiResult | null = null;
  for (const key of keys) {
    if (Date.now() > deadlineAt - 3000) break;
    const r = await callGeminiOnce(
      key,
      systemPrompt,
      userContent,
      Math.max(5000, Math.min(60_000, deadlineAt - Date.now())),
    );
    if (r.ok) return r;
    last = r;
    // 401/403 = invalid key → rotate to the next key immediately
    if (r.status === 401 || r.status === 403) continue;
    // 429/5xx/timeout → short backoff, then next key. The job-level retry
    // state persists regardless (failJobForRetry below).
    await sleep(Math.min(computeBackoffDelayMs(0, r.retryAfterMs), 8000));
    if (Date.now() > deadlineAt - 3000) break;
  }
  return last ?? { ok: false, error: "No Gemini keys configured" };
}

/**
 * Hardened wrapper (P2): ANY crash inside a tick is persisted and the chain
 * self-reschedules — one malformed response or thrown error can never kill
 * the pipeline. The real tick body lives in dispatcherTickInner.
 */
export const dispatcherTick = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    try {
      return await ctx.runAction(api.adaptiveDispatcher.dispatcherTickInner, {
        projectId: args.projectId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await ctx.runMutation(api.adaptiveJobs.recordDispatcherError, {
          projectId: args.projectId,
          error: msg,
        });
      } catch {
        /* telemetry must never throw */
      }
      try {
        const p = (await ctx.runQuery(api.queries.getProjectRaw, {
          projectId: args.projectId,
        })) as { status?: string } | null;
        if (
          p &&
          p.status !== "cancelled" &&
          p.status !== "complete" &&
          p.status !== "all_translated"
        ) {
          await ctx.scheduler.runAfter(
            TRANSLATION_CONFIG.dispatcherIntervalMs,
            api.adaptiveDispatcher.dispatcherTick,
            { projectId: args.projectId },
          );
        }
      } catch {
        /* the recovery path itself must never throw */
      }
      return { crashed: true as const, error: msg.slice(0, 300) };
    }
  },
});

export const dispatcherTickInner = internalAction({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const deadline = startedAt + TRANSLATION_CONFIG.actionSafetyDeadlineMs;
    const schedule = (delayMs: number) =>
      ctx.scheduler.runAfter(delayMs, api.adaptiveDispatcher.dispatcherTick, {
        projectId: args.projectId,
      });

    // ── 1. Governor / cancellation gates ─────────────────────────────────
    const project = (await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    })) as {
      status?: string;
      governorState?: string;
      governorResumeAt?: number;
      activeWorkerCount?: number;
    } | null;
    if (!project) return { stopped: "no_project" };
    await ctx.runMutation(api.adaptiveJobs.recordDispatcherHeartbeat, {
      projectId: args.projectId,
    });
    if (project.status === "cancelled" || project.status === "paused") {
      return { stopped: project.status };
    }

    if (project.governorState === "daily_paused") {
      const resumeAt = project.governorResumeAt ?? 0;
      if (Date.now() < resumeAt) {
        await schedule(Math.min(600_000, Math.max(1000, resumeAt - Date.now())));
        return { stopped: "daily_paused", resumeAt };
      }
      // Midnight Pacific passed → resume automatically
      await ctx.runMutation(api.adaptiveJobs.resumeFromDailyPause, {
        projectId: args.projectId,
      });
    }

    // ── 2. Maintenance: retryables + stale reclaims ──────────────────────
    await ctx.runMutation(api.adaptiveJobs.promoteRetryableJobs, {
      projectId: args.projectId,
    });
    await ctx.runMutation(api.adaptiveJobs.reclaimStaleJobs, {
      projectId: args.projectId,
    });

    const keys = getKeys();
    if (keys.length === 0) {
      // Never throw: record + retry later so adding keys recovers automatically.
      await ctx.runMutation(api.adaptiveJobs.recordDispatcherError, {
        projectId: args.projectId,
        error: "No Gemini keys configured (Gemini_API_Key_1..5)",
      });
      await schedule(60_000);
      return { stopped: "no_keys" };
    }

    const results: Array<{
      langCode: string;
      chunkIndex: number;
      sourceText: string;
      translatedText: string;
      model: string;
    }> = [];
    const completions: Array<{
      jobId: string;
      claimToken: string;
      resultText: string;
    }> = [];
    let saw429 = 0;
    let sawOtherError = 0;
    let pairCalls = 0;
    let singleCalls = 0;
    let malformedPairs = 0;
    // Thin Motherboard Phase 2 telemetry (returned per tick for /overview)
    let contractAccepted = 0;
    let contractStrictRetries = 0;
    let contractNeedsReview = 0;
    let nextTickDelay = TRANSLATION_CONFIG.dispatcherIntervalMs;

    // ── 3. Claim-and-translate loop (bounded by deadline AND job budget) ──
    while (
      Date.now() < deadline - 4000 &&
      pairCalls + singleCalls < TRANSLATION_CONFIG.maxJobsClaimedPerDispatch
    ) {
      const candidate = (await ctx.runQuery(api.adaptiveJobs.findNextClaimable, {
        projectId: args.projectId,
      })) as {
        jobId: string;
        langCode: string;
        chunkIndex: number;
        neighborPending: boolean;
        sourceLenA: number;
        sourceLenB: number;
        workerLimit: number;
        remainingJobs: number;
      } | null;
      if (!candidate) break;

      // Rate slot BEFORE claiming — a request is about to be sent.
      const slot = (await ctx.runMutation(api.adaptiveJobs.acquireRequestSlot, {
        projectId: args.projectId,
        workerLimit: candidate.workerLimit,
      })) as
        | { ok: true }
        | { ok: false; code: "rpm" | "daily"; resumeAt?: number };
      if (!slot.ok) {
        if (slot.code === "daily") {
          const resumeAt = slot.resumeAt ?? Date.now();
          await schedule(Math.min(600_000, Math.max(1000, resumeAt - Date.now())));
          return { stopped: "daily_paused", resumeAt, results: results.length };
        }
        nextTickDelay = 2000; // RPM window full → re-tick shortly
        break;
      }

      const claimed = (await ctx.runMutation(api.adaptiveJobs.claimJobPair, {
        projectId: args.projectId,
        langCode: candidate.langCode,
        chunkIndex: candidate.chunkIndex,
        promptOverheadChars: 8000,
      })) as Claimed | null;

      if (!claimed) {
        // Lost the race → release the unused slot so the limiter stays honest.
        await ctx.runMutation(api.adaptiveJobs.releaseUnprocessedSlot, {
          projectId: args.projectId,
        });
        continue;
      }

      const jobs = claimed.kind === "pair" ? claimed.jobs : [claimed.job];
      if (claimed.kind === "pair") pairCalls++;
      else singleCalls++;

      const langCode = jobs[0].langCode;
      // Thin Motherboard Phase 3: per-job contract — legacy rows produced
      // before the migration carry no stamp → legacy_postprocess. Both
      // branches use the SAME canonical prompt builder (Phase 1).
      const geminiContractMode =
        (jobs[0] as { translationIntelligenceMode?: string })
          .translationIntelligenceMode === "gemini_contract";
      const contractMode: "plain" | "json" = geminiContractMode ? "json" : "plain";
      const systemPrompt = buildTranslationPrompt({
        sourceLanguage: "en",
        targetLanguage: langCode,
        langCode,
        marketContext: "standard",
        contract: contractMode,
        sourceText: "",
      }).system;

      // ── Bible Pass BEFORE the request (production flow, same as legacy):
      // lock glossary terms → send locked text → restore placeholders after.
      const locked = jobs.map((j) => applyBiblePassServer(j.sourceText, langCode));
      const userContent =
        claimed.kind === "pair"
          ? buildPairUserContent(locked[0].lockedText, locked[1].lockedText)
          : locked[0].lockedText;

      const resp = await callWithKeyRotation(keys, systemPrompt, userContent, deadline);

      if (resp.ok) {
        await ctx.runMutation(api.adaptiveJobs.recordRequestSuccess, {
          projectId: args.projectId,
        });

        if (claimed.kind === "single") {
          const job = claimed.job;
          if (geminiContractMode) {
            // ═══ Thin Motherboard Phase 2: CONTRACT PATH ═══
            // Validate → strict retry ONCE → needs_review. No rewriting.
            const parse = parseContractResponse(resp.text);
            const verdict = validateChunkResponse({
              parse,
              langCode,
              sourceText: job.sourceText,
              lockedTerms: lockedTermsForChunk(langCode, job.sourceText),
              alreadyRetried: job.contractRetried === true,
            });
            if (verdict.action === "accept") {
              contractAccepted++;
              completions.push({
                jobId: job._id,
                claimToken: job.claimToken ?? "",
                resultText: verdict.translation,
              });
              results.push({
                langCode,
                chunkIndex: job.chunkIndex,
                sourceText: job.sourceText,
                translatedText: verdict.translation,
                model: GEMINI_MODEL,
              });
            } else if (verdict.action === "retry_strict" && job.contractRetried !== true) {
              contractStrictRetries++;
              await ctx.runMutation(api.adaptiveJobs.recordContractRetry, {
                jobId: job._id as never,
                claimToken: job.claimToken ?? "",
                reason: verdict.reason,
                diagnostics: verdict.diagnostics,
              });
              const strictText = await strictRetry(
                keys, langCode, job.sourceText, job.chunkIndex,
                job.chunkCount ?? 1, deadline,
              );
              if (strictText) {
                const strictParse = parseContractResponse(strictText);
                const strictVerdict = validateChunkResponse({
                  parse: strictParse,
                  langCode,
                  sourceText: job.sourceText,
                  lockedTerms: lockedTermsForChunk(langCode, job.sourceText),
                  alreadyRetried: true,
                });
                if (strictVerdict.action === "accept") {
                  contractAccepted++;
                  completions.push({
                    jobId: job._id,
                    claimToken: job.claimToken ?? "",
                    resultText: strictVerdict.translation,
                  });
                  results.push({
                    langCode,
                    chunkIndex: job.chunkIndex,
                    sourceText: job.sourceText,
                    translatedText: strictVerdict.translation,
                    model: GEMINI_MODEL,
                  });
                } else {
                  contractNeedsReview++;
                  await ctx.runMutation(api.adaptiveJobs.markNeedsReview, {
                    jobId: job._id as never,
                    claimToken: job.claimToken ?? "",
                    reason: strictVerdict.reason,
                    diagnostics: strictVerdict.diagnostics,
                  });
                }
              } else {
                // Strict retry request itself failed (network/5xx) →
                // ordinary transport retry; contract state stays armed.
                sawOtherError++;
                await ctx.runMutation(api.adaptiveJobs.failJobForRetry, {
                  jobId: job._id as never,
                  claimToken: job.claimToken ?? "",
                  error: "strict retry transport failure",
                });
                nextTickDelay = Math.max(nextTickDelay, 5000);
              }
            } else if (verdict.action === "needs_review") {
              contractNeedsReview++;
              await ctx.runMutation(api.adaptiveJobs.markNeedsReview, {
                jobId: job._id as never,
                claimToken: job.claimToken ?? "",
                reason: verdict.reason,
                diagnostics: verdict.diagnostics,
              });
            } else {
              // retry_strict but the single bounded retry already spent →
              // straight to needs_review (never an unbounded retry loop).
              contractNeedsReview++;
              await ctx.runMutation(api.adaptiveJobs.markNeedsReview, {
                jobId: job._id as never,
                claimToken: job.claimToken ?? "",
                reason: verdict.reason,
                diagnostics: verdict.diagnostics,
              });
            }
          } else {
            // ═══ LEGACY PATH (byte-compatible pre-migration behavior) ═══
            const translated = postProcessTranslationForTest(
              resp.text,
              langCode,
              "standard",
              locked[0].placeholders,
            );
            const reject = qaRejectReason(langCode, job.sourceText, translated);
            if (reject) {
              sawOtherError++;
              await ctx.runMutation(api.adaptiveJobs.failJobForRetry, {
                jobId: job._id as never,
                claimToken: job.claimToken ?? "",
                error: `quality gate — ${reject}`.slice(0, 500),
              });
              nextTickDelay = Math.max(nextTickDelay, 5000);
              continue;
            }
            completions.push({
              jobId: job._id,
              claimToken: job.claimToken ?? "",
              resultText: translated,
            });
            results.push({
              langCode,
              chunkIndex: job.chunkIndex,
              sourceText: job.sourceText,
              translatedText: translated,
              model: GEMINI_MODEL,
            });
          }
        } else {
          const [a, b] = claimed.jobs;
          if (geminiContractMode) {
            // ═══ Thin Motherboard Phase 2: CONTRACT PAIR PATH ═══
            // Strict JSON items[] envelope. Parse/validate failure → ONE
            // strict retry → split into singles (never kills the dispatcher).
            const pairSources = a.sourceText + "\n" + b.sourceText;
            const lockedTerms = lockedTermsForChunk(langCode, pairSources);
            const tryPair = (raw: string) => {
              const p = parseContractResponse(raw);
              if (!(p.ok && p.kind === "pair")) return null;
              const vr = validatePairItems({
                pair: p.value,
                expectedIndexes: [a.chunkIndex, b.chunkIndex],
                sources: [a.sourceText, b.sourceText],
                langCode,
                lockedTerms,
              });
              return vr;
            };
            const first = tryPair(resp.text);
            if (first?.ok) {
              contractAccepted += 2;
              completions.push(
                { jobId: a._id, claimToken: a.claimToken ?? "", resultText: first.translations[0] },
                { jobId: b._id, claimToken: b.claimToken ?? "", resultText: first.translations[1] },
              );
              results.push(
                { langCode, chunkIndex: a.chunkIndex, sourceText: a.sourceText, translatedText: first.translations[0], model: GEMINI_MODEL },
                { langCode, chunkIndex: b.chunkIndex, sourceText: b.sourceText, translatedText: first.translations[1], model: GEMINI_MODEL },
              );
            } else if (a.contractRetried === true) {
              malformedPairs++;
              await ctx.runMutation(api.adaptiveJobs.markPairSplit, {
                jobIdA: a._id as never,
                jobIdB: b._id as never,
                claimTokenA: a.claimToken ?? "",
                claimTokenB: b.claimToken ?? "",
                rawOutput: `contract pair: ${first && !first.ok ? first.reason : "not_pair_envelope"}`.slice(0, 20_000),
              });
            } else {
              contractStrictRetries++;
              const strictText = await strictRetry(
                keys, langCode, a.sourceText + "\n\n" + b.sourceText, a.chunkIndex, b.chunkIndex + 1, deadline,
              );
              const second = strictText ? tryPair(strictText) : null;
              if (second?.ok) {
                contractAccepted += 2;
                completions.push(
                  { jobId: a._id, claimToken: a.claimToken ?? "", resultText: second.translations[0] },
                  { jobId: b._id, claimToken: b.claimToken ?? "", resultText: second.translations[1] },
                );
                results.push(
                  { langCode, chunkIndex: a.chunkIndex, sourceText: a.sourceText, translatedText: second.translations[0], model: GEMINI_MODEL },
                  { langCode, chunkIndex: b.chunkIndex, sourceText: b.sourceText, translatedText: second.translations[1], model: GEMINI_MODEL },
                );
              } else {
                malformedPairs++;
                await ctx.runMutation(api.adaptiveJobs.markPairSplit, {
                  jobIdA: a._id as never,
                  jobIdB: b._id as never,
                  claimTokenA: a.claimToken ?? "",
                  claimTokenB: b.claimToken ?? "",
                  rawOutput: (strictText ?? resp.text).slice(0, 20_000),
                });
              }
            }
          } else {
          const textA = extractPairSection(resp.text, "A");
          const textB = extractPairSection(resp.text, "B");
          const echoA = !isLatinTarget(langCode) && looksLikeEnglishEcho(textA ?? "");
          const echoB = !isLatinTarget(langCode) && looksLikeEnglishEcho(textB ?? "");
          if (textA && textB && !echoA && !echoB) {
            const procA = postProcessTranslationForTest(
              textA,
              langCode,
              "standard",
              locked[0].placeholders,
            );
            const procB = postProcessTranslationForTest(
              textB,
              langCode,
              "standard",
              locked[1].placeholders,
            );
            const rejectA = qaRejectReason(langCode, a.sourceText, procA);
            const rejectB = qaRejectReason(langCode, b.sourceText, procB);
            if (rejectA || rejectB) {
              // One bad half poisons the pair → requeue BOTH as singles.
              sawOtherError++;
              await ctx.runMutation(api.adaptiveJobs.markPairSplit, {
                jobIdA: a._id as never,
                jobIdB: b._id as never,
                claimTokenA: a.claimToken ?? "",
                claimTokenB: b.claimToken ?? "",
                rawOutput: `qa: ${rejectA ?? "ok"} | ${rejectB ?? "ok"}`.slice(0, 20_000),
              });
              nextTickDelay = Math.max(nextTickDelay, 5000);
              continue;
            }
            completions.push(
              { jobId: a._id, claimToken: a.claimToken ?? "", resultText: procA },
              { jobId: b._id, claimToken: b.claimToken ?? "", resultText: procB },
            );
            results.push(
              {
                langCode,
                chunkIndex: a.chunkIndex,
                sourceText: a.sourceText,
                translatedText: procA,
                model: GEMINI_MODEL,
              },
              {
                langCode,
                chunkIndex: b.chunkIndex,
                sourceText: b.sourceText,
                translatedText: procB,
                model: GEMINI_MODEL,
              },
            );
          } else {
            // Malformed pair → save raw output, requeue both as singles.
            malformedPairs++;
            await ctx.runMutation(api.adaptiveJobs.markPairSplit, {
              jobIdA: a._id as never,
              jobIdB: b._id as never,
              claimTokenA: a.claimToken ?? "",
              claimTokenB: b.claimToken ?? "",
              rawOutput: resp.text.slice(0, 20_000),
            });
            // The pair request DID hit Gemini → keep the slot counted.
          }
          }
        }
      } else if (resp.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(resp.error)) {
        // ── 429 ladder: never an immediate retry; backoff with jitter ────
        saw429++;
        await ctx.runMutation(api.adaptiveJobs.record429, {
          projectId: args.projectId,
          retryAfterMs: resp.retryAfterMs,
        });
        for (const job of jobs) {
          await ctx.runMutation(api.adaptiveJobs.failJobForRetry, {
            jobId: job._id as never,
            claimToken: job.claimToken ?? "",
            error: `429: ${resp.error}`.slice(0, 500),
            httpStatus: 429,
            retryAfterMs: resp.retryAfterMs,
          });
        }
        nextTickDelay = Math.max(
          nextTickDelay,
          Math.min(120_000, computeBackoffDelayMs(saw429, resp.retryAfterMs)),
        );
      } else {
        // 5xx / timeout / empty / other → job-level retry with backoff
        sawOtherError++;
        for (const job of jobs) {
          await ctx.runMutation(api.adaptiveJobs.failJobForRetry, {
            jobId: job._id as never,
            claimToken: job.claimToken ?? "",
            error: resp.error.slice(0, 500),
            httpStatus: resp.status,
          });
        }
        nextTickDelay = Math.max(nextTickDelay, 5000);
      }
    }

    // ── 4. Commit everything this tick produced (immediately) ────────────
    if (completions.length > 0) {
      await ctx.runMutation(api.adaptiveJobs.completeJobs, {
        results: completions.map((c) => ({
          jobId: c.jobId as never,
          claimToken: c.claimToken,
          resultText: c.resultText,
        })),
      });
      await ctx.runMutation(api.adaptiveJobs.flushJobResults, {
        projectId: args.projectId,
        results: results.map((r) => ({
          langCode: r.langCode,
          chunkIndex: r.chunkIndex,
          sourceText: r.sourceText,
          translatedText: r.translatedText,
          model: r.model,
        })),
      });
      // A language may have just finished → check ZIP finalization.
      await ctx.runMutation(api.adaptiveJobs.zipFinalizeIfDone, {
        projectId: args.projectId,
      });
    }

    // ── 5. Self-schedule (pipeline never depends on the browser) ─────────
    const remaining = (await ctx.runQuery(api.adaptiveJobs.findNextClaimable, {
      projectId: args.projectId,
    })) as { remainingJobs: number } | null;
    if (remaining) {
      await schedule(nextTickDelay);
    } else {
      // Nothing pending → final ZIP check (all jobs terminal).
      await ctx.runMutation(api.adaptiveJobs.zipFinalizeIfDone, {
        projectId: args.projectId,
      });
    }

    return {
      committed: completions.length,
      pairCalls,
      singleCalls,
      malformedPairs,
      saw429,
      sawOtherError,
      // Thin Motherboard Phase 2 telemetry (per-tick, surfaced in /overview)
      contractAccepted,
      contractStrictRetries,
      contractNeedsReview,
      nextTickDelay,
    };
  },
});
