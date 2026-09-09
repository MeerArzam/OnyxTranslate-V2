"use node";
/**
 * convex/liveTest.ts — LIVE per-language verification.
 *
 * For every one of the 20 target languages this action makes a REAL Gemini
 * round-trip with the exact production system prompt (23 phases + glossary
 * lock + name map), translates the locked baseline sentence, applies the
 * production post-processing pipeline, runs the full QA engine, and stores a
 * scored result row. The /#/overview dashboard renders these rows live.
 *
 * This is a REAL test of the live pipeline — not a static offline report:
 *  - same buildSystemPrompt() as the real translation flow
 *  - same Bible Pass (glossary placeholders) + restore
 *  - same Gemini 3.6 Flash endpoint with 5-key rotation
 *  - same post-processing (dictionary normalization, meta strip, cultural
 *    filters, dragon telepathy, RTL marker)
 *  - same runQA() 23-phase engine, scored per language
 *
 * runAllLiveTests: batch orchestrator that runs ALL 20 languages by chaining
 * the per-language action on the Convex scheduler (survives page closes,
 * action timeouts, and rate limits — same resilience pattern as translate).
 */
import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

import {
  LIVE_TEST_SOURCE,
  buildSystemPromptForTest,
  applyBiblePassForTest,
  postProcessTranslationForTest,
  callGeminiForTest,
} from "./translateContent";
import { runQA } from "../src/lib/translator/qa";
import { getLocalizationConfig } from "../src/data/localization";

/** The exact order the dashboard displays (matches liveTestStore). */
export const LIVE_TEST_LANGUAGES = [
  "ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
  "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
] as const;

/** Names that must appear in the localized spelling (P2 spot check). */
const TEST_NAMES = ["Violet", "Xaden", "Aretia"] as const;

/** Ranges covering the scripts used by the 20 target languages. */
const SCRIPT_RANGES: Array<[RegExp, string]> = [
  [/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/, "Arabic script"],
  [/[\u3040-\u30FF\u3400-\u9FFF]/, "CJK/Japanese script"],
  [/[\u0400-\u04FF]/, "Cyrillic script"],
  [/[\uAC00-\uD7AF]/, "Hangul script"],
  [/[\u0900-\u097F]/, "Devanagari script"],
  [/[\u0980-\u09FF]/, "Bengali script"],
];

function detectScript(text: string): string | null {
  for (const [range, label] of SCRIPT_RANGES) {
    if (range.test(text)) return label;
  }
  return null;
}

// ──────────────────────────────────────────────
// Action: run one language through the REAL pipeline
// ──────────────────────────────────────────────

export const runLiveTestLanguage = action({
  args: {
    langCode: v.string(),
    marketContext: v.optional(v.string()),
    remaining: v.optional(v.array(v.string())), // batch chaining
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    ok: boolean;
    langCode: string;
    status?: string;
    score?: number;
    error?: string;
  }> => {
    const startedAt = Date.now();

    // Mark running so the dashboard shows progress
    await ctx.runMutation(api.liveTestStore.upsertLiveTestPending, {
      langCode: args.langCode,
      status: "running",
    });

    const finish = async (payload: {
      ok: boolean;
      status?: string;
      score?: number;
      output?: string;
      qaSummary?: string[];
      issueCount?: number;
      missingNames?: string[];
      scriptIssues?: string[];
      model?: string;
      error?: string;
    }) => {
      const durationMs = Date.now() - startedAt;
      await ctx.runMutation(api.liveTestStore.saveLiveTestResult, {
        langCode: args.langCode,
        status: payload.status ?? "fail",
        score: payload.score,
        output: payload.output,
        qaSummary: payload.qaSummary,
        issueCount: payload.issueCount,
        missingNames: payload.missingNames,
        scriptIssues: payload.scriptIssues,
        model: payload.model,
        durationMs,
        error: payload.error,
      });

      // ── Batch chaining: schedule the next language in the remaining list ──
      if (args.remaining && args.remaining.length > 0) {
        await ctx.scheduler.runAfter(2_000, api.liveTest.runLiveTestLanguage, {
          langCode: args.remaining[0],
          marketContext: args.marketContext,
          remaining: args.remaining.slice(1),
        });
      }

      return {
        ok: payload.ok,
        langCode: args.langCode,
        status: payload.status,
        score: payload.score,
        error: payload.error,
      };
    };

    try {
      const keys = [
        process.env.Gemini_API_Key_1,
        process.env.Gemini_API_Key_2,
        process.env.Gemini_API_Key_3,
        process.env.Gemini_API_Key_4,
        process.env.Gemini_API_Key_5,
      ].filter((k): k is string => !!k);
      if (keys.length === 0) {
        return finish({ ok: false, error: "No Gemini API keys configured" });
      }

      const marketContext = args.marketContext || "standard";

      // 1. EXACT production system prompt (23 phases + glossary + names)
      const systemPrompt = buildSystemPromptForTest(args.langCode, marketContext);

      // 2. Bible Pass — lock glossary terms with placeholders
      const { lockedText, placeholders } = applyBiblePassForTest(
        LIVE_TEST_SOURCE,
        args.langCode
      );

      const userContent =
        `${lockedText}\n\n` +
        `Translate ALL of the text above as one continuous piece of prose in ${args.langCode}. ` +
        `Begin your reply with the first translated word — no preamble, no self-checks, no notes. ` +
        `NEVER output a numbered list, NEVER output "English:"/"${args.langCode}:" pairs, ` +
        `NEVER a dictionary/line-by-line format — only the translated prose.`;

      // 3. REAL Gemini round-trip (5-key rotation, 3 attempts per key)
      const gemini = await callGeminiForTest(keys, systemPrompt, userContent);

      // 4. EXACT production post-processing
      const processed = postProcessTranslationForTest(
        gemini.text,
        args.langCode,
        marketContext,
        placeholders
      );

      // 5. QA engine — full 23-phase check against the source
      const qa = runQA(LIVE_TEST_SOURCE, processed, args.langCode, []);

      // 6. Baseline-style spot checks (P2 names + script/RTL)
      const cfg = getLocalizationConfig(args.langCode);
      const missingNames: string[] = [];
      if (cfg) {
        for (const name of TEST_NAMES) {
          const localized = cfg.names[name];
          if (localized && !processed.includes(localized)) {
            missingNames.push(`${name} (${localized})`);
          }
        }
      }

      const scriptIssues: string[] = [];
      const detectedScript = detectScript(processed);
      if (cfg) {
        if (cfg.rtl && !/[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(processed)) {
          scriptIssues.push("RTL script characters missing");
        }
        if (cfg.script !== "Latin" && !detectedScript) {
          scriptIssues.push(`${cfg.script} script characters missing`);
        }
      }

      // Compose the final score: QA score minus hard-failure penalties
      let score = qa.score;
      if (missingNames.length > 0) score -= missingNames.length * 8;
      if (scriptIssues.length > 0) score -= scriptIssues.length * 5;
      score = Math.max(0, Math.min(100, score));

      let overall: "pass" | "warn" | "fail";
      if (score < 60) overall = "fail";
      else if (missingNames.length > 0 || scriptIssues.length > 0 || qa.overall !== "pass") {
        overall = "warn";
      } else {
        overall = "pass";
      }

      const qaSummary = [
        `${score}/100 — ${qa.checks.filter((c) => c.status === "pass").length}/23 phases pass`,
        ...qa.checks
          .filter((c) => c.status !== "pass")
          .map((c) => `${c.label} ${c.status === "fail" ? "✗" : "⚠"} ${c.detail}`),
        ...missingNames.map((n) => `P2 ✗ locked name missing: ${n}`),
        ...scriptIssues.map((s) => `P8 ⚠ ${s}`),
      ];

      return finish({
        ok: true,
        status: overall,
        score,
        output: processed,
        qaSummary,
        issueCount: qaSummary.length - 1,
        missingNames,
        scriptIssues,
        model: gemini.model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[liveTest] ${args.langCode} failed:`, message);
      return finish({ ok: false, error: message });
    }
  },
});

// ──────────────────────────────────────────────
// Action: run ALL 20 languages (batch orchestrator)
//
// Kicks off the first language immediately; each per-language run chains the
// next via ctx.scheduler.runAfter, so the whole suite survives page closes,
// action timeouts, and per-key rate limits (2s spacing between languages).
// ──────────────────────────────────────────────

export const runAllLiveTests = action({
  args: {
    marketContext: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; total: number; firstLang: string }> => {
    const langs = [...LIVE_TEST_LANGUAGES];
    const first = langs.shift()!;

    await ctx.scheduler.runAfter(0, api.liveTest.runLiveTestLanguage, {
      langCode: first,
      marketContext: args.marketContext,
      remaining: langs,
    });

    return { ok: true, total: langs.length + 1, firstLang: first };
  },
});
