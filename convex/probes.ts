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
