import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/probes.ts — on-demand verification entry points (P2 evidence).
 * Runs a single watchdog tick and returns its raw report.
 */
export const runWatchdogOnce = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.runAction(api.adaptiveWatchdog.watchdogTick, {});
  },
});

/** T1/T3 diagnostic: one real Gemini round-trip, raw status + body sample (never logs the key). */
export const runGeminiProbe = action({
  args: { model: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.forensicProbe.probeGeminiOnce, { model: args.model });
  },
});

/** Direct-call the pasted-text PDF renderer so its errors surface synchronously (scheduled action died silently). */
export const runTextPdfDirect = action({
  args: { projectId: v.id("projects"), langCode: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const trans = (await ctx.runQuery(api.queries.getTranslationsRaw, {
      projectId: args.projectId,
    })) as Array<{ langCode: string; _id: string }>;
    const row = trans.find((t) => t.langCode === args.langCode);
    if (!row) return { error: "no_translation_row" };
    return await ctx.runAction(api.textPdf.generateTextPdf, {
      projectId: args.projectId,
      translationId: row._id as never,
      langCode: args.langCode,
    } as never);
  },
});

/** Probe all 5 keys; 429 bodies reveal retryDelay/limit semantics (no quota cost). */
export const runAllKeysProbe = action({
  args: { model: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.forensicProbe.probeAllKeys, { model: args.model });
  },
});
