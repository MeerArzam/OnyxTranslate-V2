import { v } from "convex/values";
import { query } from "./_generated/server";

export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
  },
});

export const getAllProjects = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("projects").collect();
  },
});

export const getProjectTranslations = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getChunkProgress = query({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_project_lang", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("langCode", args.langCode)
      )
      .collect();
    const done = chunks.filter((c) => c.status === "done").length;
    return { total: chunks.length, completed: done };
  },
});

export const getChunksForLang = query({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chunks")
      .withIndex("by_project_lang", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("langCode", args.langCode)
      )
      .collect();
  },
});

export const getAllJobs = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getLatestProject = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db
      .query("projects")
      .order("desc")
      .take(1);
    return projects[0] ?? null;
  },
});
