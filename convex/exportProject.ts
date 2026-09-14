"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import JSZip from "jszip";

/**
 * convex/exportProject.ts — PHASE 2 server-side export.
 *
 * The FULL JSON backup is assembled server-side (project metadata, fullText,
 * pageData with coordinates, parsedPages, chunks, translations incl.
 * mergedText + statuses, langCodes) and stored in Convex Storage. The browser
 * only triggers the anchor-click download from the returned URL.
 *
 * Works when idle, paused, mid-translation, or complete — never gated on any
 * client view state. Idempotent per project+kind: repeated calls replace the
 * previous artifact row.
 */

export const EXPORT_KIND = "onyx-translate-project";

export const buildExportArtifact = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");

    const [chunks, translations] = await Promise.all([
      ctx.runQuery(api.queries.getChunksForProjectRaw, { projectId: args.projectId }),
      ctx.runQuery(api.queries.getTranslationsRaw, { projectId: args.projectId }),
    ]);

    const payload = {
      type: EXPORT_KIND,
      version: 2,
      exportedAt: new Date().toISOString(),
      langCodes: translations.map((t: { langCode: string }) => t.langCode),
      project: {
        projectId: project._id,
        fileName: project.fileName,
        pageCount: project.pageCount,
        wordCount: project.wordCount,
        status: project.status,
        fullText: project.fullText,
        parsedPages: project.parsedPages,
        pageData: project.pageData, // coordinates — required for PDF re-render
        pdfStorageId: project.pdfStorageId ?? null,
      },
      chunks: (chunks as Array<{
        langCode: string;
        chunkIndex: number;
        sourceText: string;
        translatedText?: string;
        status: string;
      }>).map((c) => ({
        langCode: c.langCode,
        chunkIndex: c.chunkIndex,
        sourceText: c.sourceText,
        translatedText: c.translatedText ?? null,
        status: c.status,
      })),
      translations: (translations as Array<{
        langCode: string;
        status: string;
        totalChunks: number;
        completedChunks: number;
        mergedText?: string;
      }>).map((t) => ({
        langCode: t.langCode,
        status: t.status,
        totalChunks: t.totalChunks,
        completedChunks: t.completedChunks,
        mergedText: t.mergedText ?? null,
      })),
    };

    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/json" });
    const storageId = await ctx.storage.store(blob);
    const url = (await ctx.storage.getUrl(storageId)) ?? undefined;

    // Idempotent upsert: one artifact row per project+kind (replace old).
    const saved = await ctx.runMutation(api.artifactMutations.upsertExportArtifact, {
      projectId: args.projectId,
      storageId,
      kind: EXPORT_KIND,
      sizeBytes: bytes.length,
    });
    void saved;

    return { ok: true, url, sizeBytes: bytes.length };
  },
});

/**
 * Server-side assembly of the per-project data ZIP (all language PDFs +
 * translated .txt + report) for projects that are still mid-flight. The
 * autonomous pipeline already builds this at completion (zipAssembly.buildZip);
 * this action lets the user grab the ZIP early, from any state.
 */
export const buildZipNow = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.runAction(api.zipAssembly.buildZip, { projectId: args.projectId });
    const project = await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    });
    return { ok: true, url: project?.zipUrl ?? undefined };
  },
});
