import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { isOversized } from "./sourceData";

// FIX (1MiB document limit): project docs can exceed Convex's 1MiB per-value
// cap once a large PDF is parsed (pageData coordinates / fullText). Mutations
// cannot write to Storage, so createProject accepts optional storage refs
// (pageDataStorageId / fullTextStorageId) from the ACTIONS that hold the bytes
// and swaps in empty stubs on the row. Values under the cap behave identically
// to before.

/** FIX (1MiB limit): mint a direct-to-Storage upload URL (no bytes in args). */
export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

export const createProject = mutation({
  args: {
    sessionId: v.optional(v.string()),
    fileName: v.string(),
    pageCount: v.number(),
    wordCount: v.number(),
    pdfStorageId: v.optional(v.string()),
    pageData: v.any(),
    fullText: v.string(),
    parsedPages: v.number(),
    status: v.string(),
    // FIX (1MiB limit): refs written by the calling action for values too big
    // to inline (additive only — never required).
    pageDataStorageId: v.optional(v.id("_storage")),
    fullTextStorageId: v.optional(v.id("_storage")),
    // ADAPTIVE PIPELINE (additive): "legacy" | "adaptive_parallel" feature flag
    translationMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { pageDataStorageId, fullTextStorageId, ...rest } = args;
    return await ctx.db.insert("projects", {
      ...rest,
      // Oversized values ride in Storage; the row keeps harmless stubs so every
      // existing reader still sees a valid pageData/fullText shape.
      pageData: isOversized(args.pageData) ? [] : args.pageData,
      fullText: isOversized(args.fullText) ? "" : args.fullText,
      pageDataStorageId: pageDataStorageId,
      fullTextStorageId: fullTextStorageId,
      createdAt: Date.now(),
    });
  },
});

export const updateProject = mutation({
  args: {
    projectId: v.id("projects"),
    fileName: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    pdfStorageId: v.optional(v.string()),
    pageData: v.optional(v.any()),
    fullText: v.optional(v.string()),
    parsedPages: v.optional(v.number()),
    status: v.optional(v.string()),
    zipStorageId: v.optional(v.string()),
    zipUrl: v.optional(v.string()),
    // ADAPTIVE PIPELINE (additive): pipeline identity + governor fields
    translationMode: v.optional(v.string()),
    pipelineVersion: v.optional(v.string()),
    governorState: v.optional(v.string()),
    governorResumeAt: v.optional(v.number()),
    activeWorkerCount: v.optional(v.number()),
    lastDispatcherAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { projectId, ...updates } = args;
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) filtered[k] = v;
    }
    await ctx.db.patch(projectId, filtered);
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    // Delete all chunks for this project
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_project_status", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    // Delete all translations for this project
    const translations = await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const t of translations) {
      await ctx.db.delete(t._id);
    }

    // Delete all jobs for this project
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const job of jobs) {
      await ctx.db.delete(job._id);
    }

    // Delete the project itself
    await ctx.db.delete(args.projectId);
  },
});

export const upsertChunk = mutation({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    chunkIndex: v.number(),
    sourceText: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chunks")
      .withIndex("by_project_lang", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("langCode", args.langCode)
          .eq("chunkIndex", args.chunkIndex)
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("chunks", {
      ...args,
      status: "pending",
    });
  },
});

export const updateChunk = mutation({
  args: {
    chunkId: v.id("chunks"),
    translatedText: v.optional(v.string()),
    status: v.optional(v.string()),
    model: v.optional(v.string()),
    usage: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { chunkId, ...updates } = args;
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) filtered[k] = v;
    }
    await ctx.db.patch(chunkId, filtered);
  },
});

export const upsertTranslation = mutation({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    totalChunks: v.number(),
    status: v.optional(v.string()),
    completedChunks: v.optional(v.number()),
    mergedText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode)
      )
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("translations", {
      projectId: args.projectId,
      langCode: args.langCode,
      totalChunks: args.totalChunks,
      status: args.status || "pending",
      completedChunks: args.completedChunks ?? 0,
      mergedText: args.mergedText,
    });
  },
});

export const updateTranslation = mutation({
  args: {
    translationId: v.id("translations"),
    status: v.optional(v.string()),
    completedChunks: v.optional(v.number()),
    mergedText: v.optional(v.string()),
    pdfStorageId: v.optional(v.string()),
    pdfUrl: v.optional(v.string()),
    pdfGenerating: v.optional(v.boolean()),
    pdfProgress: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    lastChunkAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { translationId, ...updates } = args;
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) filtered[k] = v;
    }
    await ctx.db.patch(translationId, filtered);
  },
});

export const deleteChunksForLang = mutation({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
  },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("by_project_lang", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("langCode", args.langCode)
      )
      .collect();
    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }
  },
});

export const createJob = mutation({
  args: {
    projectId: v.id("projects"),
    type: v.string(),
    langCode: v.optional(v.string()),
    chunkIndex: v.optional(v.number()),
    status: v.string(),
    scheduledFor: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("jobs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const saveImageTranslation = mutation({
  args: {
    imageBase64: v.string(),
    extractedText: v.optional(v.string()),
    translatedText: v.optional(v.string()),
    langCode: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("imageTranslations", {
      imageBase64: args.imageBase64,
      extractedText: args.extractedText,
      translatedText: args.translatedText,
      targetLangCode: args.langCode,
      status: args.status,
      createdAt: Date.now(),
    });
  },
});
