import { v } from "convex/values";
import { query } from "./_generated/server";

// ─── Client-facing queries (require sessionId) ───

export const getProject = query({
  args: { projectId: v.id("projects"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.sessionId !== args.sessionId) return null;
    return project;
  },
});

export const getLatestProject = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    return projects[0] ?? null;
  },
});

export const getProjectTranslations = query({
  args: { projectId: v.id("projects"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.sessionId !== args.sessionId) return [];
    return await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

// ─── Server-side queries (no session check — used by actions) ───

export const getProjectRaw = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
  },
});

export const getTranslationsRaw = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

// ─── Unfiltered queries (for any use) ───

export const getChunkProgress = query({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode)
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
        q.eq("projectId", args.projectId).eq("langCode", args.langCode)
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

// ─── History ───

export const getHistory = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("history")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .collect();
  },
});

// C2: Real-time chunk progress for a specific language
export const getTranslationProgress = query({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode)
      )
      .collect();
    const completed = chunks.filter((c) => c.status === "done").length;
    return {
      total: chunks.length,
      completed,
      percentage:
        chunks.length > 0
          ? Math.round((completed / chunks.length) * 100)
          : 0,
    };
  },
});

// C3: Live preview — concatenates completed chunk translations in order
export const getLivePreviewText = query({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode)
      )
      .order("asc")
      .collect();
    const completed = chunks.filter(
      (c) => c.status === "done" && c.translatedText
    );
    return completed.map((c) => c.translatedText).join("\n\n");
  },
});
