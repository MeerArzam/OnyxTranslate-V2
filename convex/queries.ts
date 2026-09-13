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

// Phase E3: Recent jobs — compact session-scoped project cards.
export const getSessionProjects = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(10);
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

// FIX 5a: Watchdog query — languages that were in_progress but whose last
// chunk heartbeat is older than STALL_THRESHOLD_MS are considered stalled
// (browser closed / action crashed / timeout). "complete" languages and
// recently-active ones are excluded.
export const getStalledLanguages = query({
  args: { projectId: v.id("projects"), sessionId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.sessionId !== args.sessionId) return [];

    const STALL_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes without a heartbeat
    const now = Date.now();

    const translations = await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
      .collect();

    return translations
      .filter((t) => {
        if (t.status === "complete" || t.status === "generating_pdf") return false;
        const lastActivity = t.lastChunkAt ?? t.startedAt ?? 0;
        return now - lastActivity > STALL_THRESHOLD_MS;
      })
      .map((t) => t.langCode);
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
// Watchdog: find all projects that might be stalled
export const getAllProjectsForWatchdog = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("projects")
      .collect();
  },
});

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
