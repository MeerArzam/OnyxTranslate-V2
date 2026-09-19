"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { isOversized } from "./sourceData";

/**
 * convex/importJob.ts — PHASE 2 server-side import.
 *
 * Called by the /uploadAndImport HTTP endpoint with ALREADY-VALIDATED data.
 * Restores the full project server-side: project row (identity = current
 * device, fresh tab session), fullText, pageData (coordinates), parsedPages,
 * chunks, translations (mergedText + statuses), langCodes — then returns a
 * jobId. The browser may close immediately; the imported job shows up in
 * getResumableJobs and in any open tab's "Your jobs" list.
 */

const IMPORTED_STATUSES = new Set([
  "pending",
  "in_progress",
  "complete",
  "generating_pdf",
]);

interface ImportPayload {
  langCodes?: string[];
  project: {
    fileName?: string;
    pageCount?: number;
    wordCount?: number;
    fullText: string;
    parsedPages?: number;
    status?: string;
    pageData?: unknown;
  };
  chunks?: Array<{
    langCode: string;
    chunkIndex: number;
    sourceText: string;
    translatedText?: string | null;
    status?: string;
  }>;
  translations?: Array<{
    langCode: string;
    status?: string;
    totalChunks?: number;
    completedChunks?: number;
    mergedText?: string | null;
  }>;
}

export const uploadAndImportFromData = action({
  args: {
    clientId: v.string(),
    sessionId: v.string(),
    data: v.any(),
  },
  handler: async (ctx, args) => {
    const d = args.data as ImportPayload;
    const p = d.project;

    // ── Validation (defense in depth — HTTP layer already checked the basics).
    // Any failure here throws BEFORE the first write, so a bad file can never
    // produce a partial import.
    if (!p || typeof p.fullText !== "string" || p.fullText.length === 0) {
      throw new Error("Import failed: project payload missing or has no fullText");
    }
    if (p.pageData !== undefined && !Array.isArray(p.pageData)) {
      throw new Error("Import failed: pageData must be an array");
    }
    const translations = Array.isArray(d.translations) ? d.translations : [];
    const chunks = Array.isArray(d.chunks) ? d.chunks : [];
    for (const t of translations) {
      if (!t || typeof t.langCode !== "string") {
        throw new Error("Import failed: malformed translations[] entry");
      }
    }
    for (const c of chunks) {
      if (!c || typeof c.langCode !== "string" || typeof c.chunkIndex !== "number" || typeof c.sourceText !== "string") {
        throw new Error("Import failed: malformed chunks[] entry");
      }
    }

    // ── Project row (identity = current device + NEW tab session) ──
    // FIX (1MiB limit): oversized pageData/fullText are stored in Blob Storage
    // here (the action holds the bytes) and only their refs ride the mutation.
    const pageDataVal = (p.pageData as never) ?? [];
    const pageDataStorageId = isOversized(pageDataVal)
      ? await ctx.storage.store(new Blob([JSON.stringify(pageDataVal)], { type: "application/json" }))
      : undefined;
    const fullTextStorageId = isOversized(p.fullText)
      ? await ctx.storage.store(new Blob([JSON.stringify(p.fullText)], { type: "application/json" }))
      : undefined;
    const projectId = await ctx.runMutation(api.mutations.createProject, {
      sessionId: args.sessionId,
      fileName: typeof p.fileName === "string" && p.fileName ? p.fileName : "Imported project",
      pageCount: typeof p.pageCount === "number" ? p.pageCount : 1,
      wordCount:
        typeof p.wordCount === "number"
          ? p.wordCount
          : p.fullText.split(/\s+/).filter(Boolean).length,
      // FIX (1MiB limit): when offloaded, the row gets stubs — nothing
      // oversized crosses the mutation-argument boundary either.
      pageData: pageDataStorageId ? [] : pageDataVal,
      fullText: fullTextStorageId ? "" : p.fullText,
      parsedPages: typeof p.parsedPages === "number" ? p.parsedPages : 1,
      // Preserve the exported pipeline state; "ready" for untouched exports.
      status:
        typeof p.status === "string" && p.status.length > 0
          ? p.status === "complete"
            ? "all_translated"
            : p.status
          : "ready",
      pageDataStorageId: pageDataStorageId as string | undefined,
      fullTextStorageId: fullTextStorageId as string | undefined,
    });

    await ctx.runMutation(api.jobMutations.setProjectIdentity, {
      projectId,
      clientId: args.clientId,
      tabSessionId: args.sessionId,
      sessionId: args.sessionId,
    });

    // ── Chunks ──
    for (const c of chunks) {
      const chunkId = await ctx.runMutation(api.mutations.upsertChunk, {
        projectId,
        langCode: c.langCode,
        chunkIndex: c.chunkIndex,
        sourceText: c.sourceText,
      });
      if (c.translatedText) {
        await ctx.runMutation(api.mutations.updateChunk, {
          chunkId,
          translatedText: c.translatedText,
          status: c.status === "done" ? "done" : (c.status ?? "done"),
        });
      }
    }

    // ── Translations (per-language rollups) ──
    const importedLangCodes: string[] = [];
    for (const t of translations) {
      await ctx.runMutation(api.mutations.upsertTranslation, {
        projectId,
        langCode: t.langCode,
        totalChunks:
          typeof t.totalChunks === "number"
            ? t.totalChunks
            : chunks.filter((c) => c.langCode === t.langCode).length || 1,
        status: IMPORTED_STATUSES.has(t.status ?? "") ? t.status : "complete",
        completedChunks:
          typeof t.completedChunks === "number"
            ? t.completedChunks
            : chunks.filter((c) => c.langCode === t.langCode && c.status === "done").length,
        mergedText: t.mergedText ?? undefined,
      });
      importedLangCodes.push(t.langCode);
    }

    const langCodes =
      d.langCodes && d.langCodes.length > 0 ? d.langCodes : importedLangCodes;

    return { ok: true as const, jobId: projectId, importedLangCodes: langCodes };
  },
});
