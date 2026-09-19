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

/** Probe all 5 keys; 429 bodies reveal retryDelay/limit semantics (no quota cost). */
export const runAllKeysProbe = action({
  args: { model: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.forensicProbe.probeAllKeys, { model: args.model });
  },
});
