import { v } from "convex/values";
import { mutation } from "./_generated/server";

/**
 * convex/jobMutations.ts — PHASE 2: small server-side mutations used by the
 * processing pipeline and the client identity layer. Kept separate from
 * mutations.ts (whose surface the frozen baseline documents) to avoid any
 * accidental contract change there.
 */

/** PHASE 2: bind durable identity to a project (set or adopt). */
export const setProjectIdentity = mutation({
  args: {
    projectId: v.id("projects"),
    clientId: v.optional(v.string()),
    tabSessionId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, ...updates } = args;
    const filtered: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(updates)) {
      if (val !== undefined) filtered[k] = val;
    }
    await ctx.db.patch(projectId, filtered);
    return { ok: true as const };
  },
});

/**
 * PHASE 2: overwrite-safe project updater for server processing stages
 * (parsed → ready → translating → generating_pdf → assembling_zip → complete).
 * Also mirrors status transitions onto the owning uploadJob.
 */
export const setProjectStatus = mutation({
  args: {
    projectId: v.id("projects"),
    status: v.string(),
    uploadJobId: v.optional(v.id("uploadJobs")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, { status: args.status });
    if (args.uploadJobId) {
      const job = await ctx.db.get(args.uploadJobId);
      if (job && job.status !== "cancelled" && job.status !== "error") {
        await ctx.db.patch(args.uploadJobId, {
          status: args.status,
          processStage: args.status,
          heartbeatAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    }
    return { ok: true as const };
  },
});
