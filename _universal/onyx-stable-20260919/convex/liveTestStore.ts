/**
 * convex/liveTestStore.ts — persistence for live per-language test results.
 *
 * Plain Convex functions (no "use node"): a reactive query for the /#/overview
 * dashboard plus upsert/clear mutations. The heavy Gemini round-trip lives in
 * liveTest.ts (Node action) and calls these via ctx.runMutation.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

import { getLocalizationConfig } from "../src/data/localization";

const LIVE_TEST_LANGUAGES = [
  "ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
  "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
] as const;

export const getLiveTests = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("liveTests").collect();
    // Deterministic order: same as LIVE_TEST_LANGUAGES
    const order = new Map<string, number>(LIVE_TEST_LANGUAGES.map((c, i) => [c as string, i]));
    return rows.sort(
      (a, b) =>
        (order.get(a.langCode) ?? 99) - (order.get(b.langCode) ?? 99)
    );
  },
});

export const upsertLiveTestPending = mutation({
  args: {
    langCode: v.string(),
    status: v.string(), // "pending" | "running"
  },
  handler: async (ctx, args) => {
    const cfg = getLocalizationConfig(args.langCode);
    const existing = await ctx.db
      .query("liveTests")
      .withIndex("by_lang", (q) => q.eq("langCode", args.langCode))
      .first();
    const fields = {
      langCode: args.langCode,
      langName: cfg?.name ?? args.langCode,
      nativeName: cfg?.nativeName ?? "",
      script: cfg?.script ?? "Latin",
      rtl: cfg?.rtl ?? false,
      status: args.status,
      testedAt: Date.now(),
      // Reset result fields when (re)starting
      score: undefined,
      output: undefined,
      qaSummary: undefined,
      issueCount: undefined,
      missingNames: undefined,
      scriptIssues: undefined,
      model: undefined,
      durationMs: undefined,
      error: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("liveTests", fields);
    }
  },
});

export const saveLiveTestResult = mutation({
  args: {
    langCode: v.string(),
    status: v.string(), // pass | warn | fail
    score: v.optional(v.number()),
    output: v.optional(v.string()),
    qaSummary: v.optional(v.array(v.string())),
    issueCount: v.optional(v.number()),
    missingNames: v.optional(v.array(v.string())),
    scriptIssues: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cfg = getLocalizationConfig(args.langCode);
    const existing = await ctx.db
      .query("liveTests")
      .withIndex("by_lang", (q) => q.eq("langCode", args.langCode))
      .first();
    const fields = {
      langCode: args.langCode,
      langName: cfg?.name ?? args.langCode,
      nativeName: cfg?.nativeName ?? "",
      script: cfg?.script ?? "Latin",
      rtl: cfg?.rtl ?? false,
      status: args.status,
      score: args.score,
      output: args.output,
      qaSummary: args.qaSummary,
      issueCount: args.issueCount,
      missingNames: args.missingNames,
      scriptIssues: args.scriptIssues,
      model: args.model,
      durationMs: args.durationMs,
      error: args.error,
      testedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("liveTests", fields);
    }
  },
});

export const clearLiveTests = mutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("liveTests").collect();
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});
