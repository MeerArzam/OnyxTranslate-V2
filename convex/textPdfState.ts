import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/textPdfState.ts — DB state helpers for the pasted-text PDF renderer
 * (convex/textPdf.ts, Node runtime). Convex requires queries/mutations to live
 * on the default runtime, so these are split out; the renderer calls them via
 * ctx.runQuery / ctx.runMutation.
 */

export const getTranslationInternal = internalQuery({
  args: { translationId: v.id("translations") },
  handler: async (ctx, args) => {
    return (await ctx.db.get(args.translationId)) as
      | { mergedText?: string; status: string }
      | null;
  },
});

/** Mark the artifact on the translation row and resume ZIP finalization. */
export const markPdfComplete = internalMutation({
  args: {
    projectId: v.id("projects"),
    translationId: v.id("translations"),
    storageId: v.string(),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.translationId, {
      pdfStorageId: args.storageId,
      pdfUrl: args.url,
      status: "complete",
      pdfGenerating: false,
      completedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, api.adaptiveJobs.zipFinalizeIfDone, {
      projectId: args.projectId,
    });
  },
});

export const markPdfError = internalMutation({
  args: {
    translationId: v.id("translations"),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.translationId, {
      status: "error",
      pdfGenerating: false,
      pdfProgress: `pdf_render_failed: ${args.message.slice(0, 300)}`,
      completedAt: Date.now(),
    });
  },
});
