import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const saveToHistory = mutation({
  args: {
    sessionId: v.string(),
    projectId: v.id("projects"),
    fileName: v.string(),
    pageCount: v.number(),
    wordCount: v.number(),
    status: v.string(),
    languagesCompleted: v.number(),
    zipUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("history")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("projectId"), args.projectId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        languagesCompleted: args.languagesCompleted,
        zipUrl: args.zipUrl,
        completedAt: args.status === "complete" ? Date.now() : undefined,
      });
    } else {
      await ctx.db.insert("history", {
        ...args,
        createdAt: Date.now(),
      });
    }
  },
});

export const deleteHistory = mutation({
  args: {
    historyId: v.id("history"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.historyId);
  },
});
