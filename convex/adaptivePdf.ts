import { v } from "convex/values";
import { internalMutation, internalAction, internalQuery } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  TRANSLATION_CONFIG,
  pdfBatchIdempotencyKey,
} from "./translationConfig";

/**
 * convex/adaptivePdf.ts — ADAPTIVE PIPELINE (Phase 8: PDF batching)
 *
 * The legacy path renders one language's whole PDF in a single action. For a
 * 672-page book that is timeout-bait. Here the page range is split into
 * batches (50 → 25 → 10 pages on repeated failure), each batch is an
 * idempotent pdfBatches row, and a failed 10-page batch fails ONLY that batch
 * (exact page range + error) — never the whole language or project.
 *
 * Final language PDFs are assembled from the per-language records produced by
 * the existing render core; ZIP assembly stays in zipAssembly.buildZip.
 */

type BatchDoc = {
  _id: Id<"pdfBatches">;
  projectId: Id<"projects">;
  langCode: string;
  translationId?: Id<"translations">;
  batchIndex: number;
  pageStart: number;
  pageEnd: number;
  batchSize: number;
  status: string; // pending | running | done | failed
  storageId?: Id<"_storage">;
  attempts: number;
  error?: string;
  heartbeatAt?: number;
  idempotencyKey: string;
};

// ─── Query: batches summary for a language ────────────────────────────────

export const getLanguageBatches = internalQuery({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const batches = (await ctx.db
      .query("pdfBatches")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode),
      )
      .collect()) as BatchDoc[];
    return {
      total: batches.length,
      done: batches.filter((b) => b.status === "done").length,
      failed: batches.filter((b) => b.status === "failed").length,
      batches: batches.sort((a, b) => a.batchIndex - b.batchIndex),
    };
  },
});

// ─── Mutation: create the idempotent batch plan (50-page default) ─────────

export const planLanguageBatches = internalMutation({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    translationId: v.id("translations"),
    pageCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = (await ctx.db
      .query("pdfBatches")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode),
      )
      .collect()) as BatchDoc[];
    if (existing.length > 0) {
      // Plan already exists — never duplicate (restart-skip guarantee).
      return { planned: 0, existing: existing.length };
    }

    const size = TRANSLATION_CONFIG.pdfInitialBatchPages;
    const now = Date.now();
    let index = 0;
    for (let start = 1; start <= args.pageCount; start += size) {
      const end = Math.min(start + size - 1, args.pageCount);
      await ctx.db.insert("pdfBatches", {
        projectId: args.projectId,
        langCode: args.langCode,
        translationId: args.translationId,
        batchIndex: index,
        pageStart: start,
        pageEnd: end,
        batchSize: end - start + 1,
        status: "pending",
        attempts: 0,
        idempotencyKey: pdfBatchIdempotencyKey(args.projectId, args.langCode, index),
        createdAt: now,
      });
      index++;
    }
    await ctx.db.patch(args.translationId, {
      pdfGenerating: true,
      pdfProgress: `planned ${index} batches of ${size}p`,
    });
    return { planned: index, existing: 0 };
  },
});

// ─── Mutation: claim the next pending batch (transactional) ───────────────

export const claimNextBatch = internalMutation({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args): Promise<BatchDoc | null> => {
    const batches = (await ctx.db
      .query("pdfBatches")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode),
      )
      .collect()) as BatchDoc[];
    const pending = batches
      .filter((b) => b.status === "pending")
      .sort((a, b) => a.batchIndex - b.batchIndex);
    if (pending.length === 0) return null;
    const batch = pending[0];
    await ctx.db.patch(batch._id as never, {
      status: "running",
      attempts: batch.attempts + 1,
      heartbeatAt: Date.now(),
    });
    return { ...batch, status: "running" };
  },
});

// ─── Mutation: shrink a failed batch 50 → 25 → 10 ─────────────────────────

export const shrinkOrSplitBatch = internalMutation({
  args: { batchId: v.id("pdfBatches"), error: v.string() },
  handler: async (ctx, args) => {
    const batch = (await ctx.db.get(args.batchId)) as BatchDoc | null;
    if (!batch) return { action: "missing" };
    const min = TRANSLATION_CONFIG.pdfMinimumBatchPages;
    const shrink = TRANSLATION_CONFIG.pdfBatchShrinkFactor;

    if (batch.batchSize <= min) {
      // Minimum batch failed → ONLY this batch fails (exact range + error).
      await ctx.db.patch(batch._id as never, {
        status: "failed",
        error: args.error.slice(0, 500),
        heartbeatAt: undefined,
      });
      return { action: "failed_batch", pageStart: batch.pageStart, pageEnd: batch.pageEnd };
    }

    const newSize = Math.max(min, Math.floor(batch.batchSize * shrink));
    const now = Date.now();
    let index = batch.batchIndex;
    for (let start = batch.pageStart; start <= batch.pageEnd; start += newSize) {
      const end = Math.min(start + newSize - 1, batch.pageEnd);
      await ctx.db.insert("pdfBatches", {
        projectId: batch.projectId,
        langCode: batch.langCode,
        translationId: batch.translationId,
        batchIndex: index,
        pageStart: start,
        pageEnd: end,
        batchSize: end - start + 1,
        status: "pending",
        attempts: 0,
        idempotencyKey: pdfBatchIdempotencyKey(batch.projectId, batch.langCode, index),
        createdAt: now,
      });
      index++;
    }
    // Remove the failed parent (its ranges are covered by the children).
    await ctx.db.delete(batch._id as never);
    return { action: "split", newSize, children: index - batch.batchIndex };
  },
});

// ─── Mutation: mark batch done with its stored PDF slice ─────────────────

export const completeBatch = internalMutation({
  args: {
    batchId: v.id("pdfBatches"),
    storageId: v.id("_storage"),
    checksum: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.batchId, {
      status: "done",
      storageId: args.storageId,
      checksum: args.checksum,
      error: undefined,
      heartbeatAt: undefined,
    });
    return { ok: true };
  },
});

// ─── Mutation: recover batches stuck "running" (watchdog helper) ──────────

export const recoverStuckBatches = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttl = TRANSLATION_CONFIG.heartbeatTtlMs;
    const batches = (await ctx.db
      .query("pdfBatches")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect()) as BatchDoc[];
    let recovered = 0;
    for (const b of batches) {
      if (b.projectId !== args.projectId) continue;
      if (b.heartbeatAt && now - b.heartbeatAt < ttl) continue;
      // Requeue as pending (or split if it already failed twice at this size)
      const willSplit = b.attempts >= 2 && b.batchSize > TRANSLATION_CONFIG.pdfMinimumBatchPages;
      if (willSplit) {
        await ctx.scheduler.runAfter(0, api.adaptivePdf.shrinkOrSplitFromWatchdog, {
          batchId: b._id as never,
          error: "watchdog: batch stuck running past heartbeat TTL",
        });
      } else {
        await ctx.db.patch(b._id as never, {
          status: "pending",
          error: "watchdog: requeued after heartbeat expiry",
        });
      }
      recovered++;
    }
    return { recovered };
  },
});

export const shrinkOrSplitFromWatchdog = internalMutation({
  args: { batchId: v.id("pdfBatches"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(api.adaptivePdf.shrinkOrSplitBatch, args);
  },
});

// ─── Batch paragraph slice: EXACT mirror of the renderer's greedy walk ───
// renderPdfCore distributes translatedParagraphs across pages by positional
// word share (srcWordsPerPage[i] / totalSrcWords × totalWords), draining all
// remaining paragraphs on the LAST page. Mirroring it here guarantees a
// per-batch render is identical to the whole-book render for those pages.
type PageDataLite = { num?: number; text?: string; textItems?: Array<{ str: string }> };

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

export function computeBatchParagraphSlice(
  pageData: PageDataLite[],
  mergedText: string,
  pageStart: number,
  pageEnd: number,
  totalPages: number,
): string {
  const paragraphs = mergedText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const totalWords = wordCount(mergedText);
  const wordsPerPage = pageData.map((p) => {
    const text = p.text ?? (p.textItems || []).map((it) => it.str).join(" ");
    return Math.max(wordCount(text), 1);
  });
  const totalSrcWords = Math.max(wordsPerPage.reduce((a, b) => a + b, 0), 1);

  const ranges: Array<[number, number]> = [];
  let paraIdx = 0;
  for (let i = 0; i < totalPages; i++) {
    const share = (wordsPerPage[i] ?? 1) / totalSrcWords;
    const targetWords = Math.floor(share * totalWords);
    const startIdx = paraIdx;
    let pageParaWords = 0;
    while (
      paraIdx < paragraphs.length &&
      (pageParaWords + wordCount(paragraphs[paraIdx]) <= targetWords || i === totalPages - 1)
    ) {
      pageParaWords += wordCount(paragraphs[paraIdx]);
      paraIdx++;
      if (i < totalPages - 1 && pageParaWords >= targetWords) break;
    }
    ranges.push([startIdx, paraIdx]);
  }
  const first = ranges[Math.min(pageStart - 1, ranges.length - 1)] ?? [0, paragraphs.length];
  const last = ranges[Math.min(pageEnd - 1, ranges.length - 1)] ?? [0, paragraphs.length];
  return paragraphs.slice(first[0], Math.max(last[1], first[1])).join("\n\n");
}

// ─── Action: render one batch through the PRODUCTION render core ─────────

export const renderNextBatch = internalAction({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const project = (await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    })) as
      | { pageCount: number; pdfStorageId?: string; pageData?: unknown; pageDataStorageId?: string }
      | null;
    if (!project) return { done: "no_project" };

    const batch = (await ctx.runMutation(api.adaptivePdf.claimNextBatch, {
      projectId: args.projectId,
      langCode: args.langCode,
    })) as BatchDoc | null;
    if (!batch) return { done: "no_pending_batch" };

    try {
      if (!project.pdfStorageId) throw new Error("Original PDF missing");
      const pdfBlob = await ctx.storage.get(project.pdfStorageId);
      if (!pdfBlob) throw new Error("Original PDF blob not found");

      // pageData resolution (same 1MiB-offload fallback as generatePdf.ts)
      let pageDataRaw: unknown = project.pageData;
      if (
        Array.isArray(pageDataRaw) &&
        pageDataRaw.length === 0 &&
        project.pageDataStorageId
      ) {
        const blob = await ctx.storage.get(project.pageDataStorageId);
        if (blob) pageDataRaw = JSON.parse(await blob.text());
      }
      const pageData = (pageDataRaw || []) as never;

      // Import the shared pure render core + production font loader.
      const { renderTranslatedPdf } = await import("./renderPdfCore");
      const fontCache = new Map<string, ArrayBuffer>();
      const getFontBytes = async (url: string): Promise<ArrayBuffer> => {
        const cached = fontCache.get(url);
        if (cached) return cached;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Font download failed (HTTP ${resp.status}): ${url}`);
        const bytes = await resp.arrayBuffer();
        fontCache.set(url, bytes);
        return bytes;
      };      // Load merged text for this language, then slice BOTH the text and the
      // source pages to this batch using the renderer's own distribution walk
      // (computeBatchParagraphSlice mirrors renderPdfCore exactly).
      const translation = (await ctx.runQuery(api.queries.getTranslationsRaw, {
        projectId: args.projectId,
      })) as Array<{ langCode: string; mergedText?: string }>;
      const merged = translation.find((t) => t.langCode === args.langCode)?.mergedText ?? "";
      const pages = pageData as PageDataLite[];
      const sliceText = computeBatchParagraphSlice(
        pages,
        merged,
        batch.pageStart,
        batch.pageEnd,
        project.pageCount,
      );
      const slicePageData = pages.slice(batch.pageStart - 1, batch.pageEnd);

      // Per-batch source slice: renumber pages 1..N so the renderer's
      // pageData.num lookups resolve inside this batch.
      const { PDFDocument: PDFDocCls } = (await import("pdf-lib")) as unknown as {
        PDFDocument: typeof import("pdf-lib").PDFDocument;
      };
      const srcDoc = await PDFDocCls.load(new Uint8Array(await pdfBlob.arrayBuffer()), {
        ignoreEncryption: true,
      });
      const sliceDoc = await PDFDocCls.create();
      const sliceIndices: number[] = [];
      for (let p = batch.pageStart - 1; p <= Math.min(batch.pageEnd - 1, srcDoc.getPageCount() - 1); p++) {
        sliceIndices.push(p);
      }
      const copiedSlice = await sliceDoc.copyPages(srcDoc, sliceIndices);
      for (const cp of copiedSlice) sliceDoc.addPage(cp);
      const sliceBytes = await sliceDoc.save();
      const renumbered = slicePageData.map((p, i) => ({ ...p, num: i + 1 }));

      const { bytes } = await renderTranslatedPdf({
        srcBytes: new Uint8Array(sliceBytes),
        pageData: renumbered,
        mergedText: sliceText,
        langCode: args.langCode,
        getFontBytes,
      } as never);

      const outBlob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const storageId = await ctx.storage.store(outBlob);

      // Cheap checksum (djb2 over first 64KB) for durability tracking.
      const head = new Uint8Array(bytes).slice(0, 65536);
      let h = 5381;
      for (const b of head) h = ((h * 33) ^ b) >>> 0;
      await ctx.runMutation(api.adaptivePdf.completeBatch, {
        batchId: batch._id as never,
        storageId,
        checksum: `djb2:${h.toString(16)}`,
      });
      return { done: "ok", batchIndex: batch.batchIndex };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Retry once at the same size (spec: retry → then shrink).
      if (batch.attempts < 2) {
        await ctx.runMutation(api.adaptivePdf.requeueBatch, {
          batchId: batch._id as never,
          error: msg,
        });
        return { done: "retry", error: msg };
      }
      const result = await ctx.runMutation(api.adaptivePdf.shrinkOrSplitBatch, {
        batchId: batch._id as never,
        error: msg,
      });
      return { done: "shrink", result, error: msg };
    }
  },
});

export const requeueBatch = internalMutation({
  args: { batchId: v.id("pdfBatches"), error: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.batchId, {
      status: "pending",
      error: args.error.slice(0, 500),
      heartbeatAt: undefined,
    });
    return { ok: true };
  },
});

// ─── Action: drive all batches for a language to completion ──────────────

export const processAllBatches = internalAction({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const deadline = Date.now() + TRANSLATION_CONFIG.actionSafetyDeadlineMs;
    let rendered = 0;
    let failed = 0;
    while (Date.now() < deadline - 3000) {
      const summary = (await ctx.runQuery(api.adaptivePdf.getLanguageBatches, {
        projectId: args.projectId,
        langCode: args.langCode,
      })) as { total: number; done: number; failed: number };
      if (summary.done + summary.failed >= summary.total) break;
      const r = (await ctx.runAction(api.adaptivePdf.renderNextBatch, {
        projectId: args.projectId,
        langCode: args.langCode,
      })) as { done?: string };
      if (r.done === "no_pending_batch") break;
      if (r.done === "failed_batch") failed++;
      else if (r.done === "ok" || r.done === "shrink") rendered++;
    }
    // Chain: more batches → next tick of this action; else finalize language.
    const summary = (await ctx.runQuery(api.adaptivePdf.getLanguageBatches, {
      projectId: args.projectId,
      langCode: args.langCode,
    })) as { total: number; done: number; failed: number };
    if (summary.done + summary.failed < summary.total) {
      await ctx.scheduler.runAfter(1000, api.adaptivePdf.processAllBatches, {
        projectId: args.projectId,
        langCode: args.langCode,
      });
      return { status: "continuing", rendered, failed };
    }
    if (summary.failed > 0) {
      // Failed batches fail ONLY themselves — language marked partial-error.
      await ctx.scheduler.runAfter(0, api.adaptivePdf.finalizeLanguagePdfs, {
        projectId: args.projectId,
      });
      return { status: "partial", rendered, failed };
    }
    await ctx.scheduler.runAfter(0, api.adaptivePdf.finalizeLanguagePdfs, {
      projectId: args.projectId,
    });
    return { status: "complete", rendered, failed };
  },
});

// ─── Mutation: finalize language records when every batch is terminal ────

export const finalizeLanguagePdfs = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const translations = (await ctx.db
      .query("translations")
      .filter((q) => q.eq(q.field("projectId"), args.projectId))
      .collect()) as Array<{
      _id: string;
      langCode: string;
      status: string;
      mergedText?: string;
    }>;
    for (const t of translations) {
      if (t.status !== "generating_pdf") continue;
      const batches = (await ctx.db
        .query("pdfBatches")
        .withIndex("by_project_lang", (q) =>
          q.eq("projectId", args.projectId).eq("langCode", t.langCode),
        )
        .collect()) as BatchDoc[];
      if (batches.length === 0) continue; // not batch-managed (legacy path)
      const allTerminal = batches.every(
        (b) => b.status === "done" || b.status === "failed",
      );
      if (!allTerminal) continue;
      const failedBatches = batches.filter((b) => b.status === "failed");
      await ctx.db.patch(t._id as never, {
        status: failedBatches.length > 0 ? "error" : "complete",
        pdfGenerating: false,
        completedAt: Date.now(),
        pdfProgress:
          failedBatches.length > 0
            ? `pdf batches failed: ${failedBatches
                .map((b) => `pages ${b.pageStart}-${b.pageEnd}`)
                .join(", ")}`
            : `pdf complete: ${batches.length} batches`,
      });
      // Assemble the FINAL language PDF from done batches (for ZIP + UI). If
      // any batch failed, keep the error status — partial PDFs are honest.
      if (failedBatches.length === 0) {
        await ctx.scheduler.runAfter(0, api.adaptivePdf.assembleLanguagePdf, {
          projectId: args.projectId,
          langCode: t.langCode,
        });
      }
      await ctx.db.patch(args.projectId, {
        pdfGenerationState: failedBatches.length > 0 ? "partial_error" : "complete",
      });
    }
    // ZIP check runs through the adaptive finalizer (never duplicates ZIPs).
    await ctx.runMutation(api.adaptiveJobs.zipFinalizeIfDone, {
      projectId: args.projectId,
    });
    return { ok: true };
  },
});

// ─── Action: merge done batch PDFs into the FINAL language PDF ──────────
// (Translations need translations.pdfStorageId/pdfUrl for ZIP + preview to
// keep working — identical end state to the whole-book renderer.)

export const assembleLanguagePdf = internalAction({
  args: { projectId: v.id("projects"), langCode: v.string() },
  handler: async (ctx, args) => {
    const batches = (await ctx.runQuery(api.adaptivePdf.getLanguageBatches, {
      projectId: args.projectId,
      langCode: args.langCode,
    })) as { batches: BatchDoc[] };
    const done = batches.batches
      .filter((b) => b.status === "done" && b.storageId)
      .sort((a, b) => a.batchIndex - b.batchIndex);
    if (done.length === 0) return { assembled: false, reason: "no_done_batches" };

    const { PDFDocument: PDFDocCls } = (await import("pdf-lib")) as unknown as {
      PDFDocument: typeof import("pdf-lib").PDFDocument;
    };
    const outDoc = await PDFDocCls.create();
    let pageCount = 0;
    for (const b of done) {
      const blob = await ctx.storage.get(b.storageId as never);
      if (!blob) continue;
      const part = await PDFDocCls.load(new Uint8Array(await blob.arrayBuffer()), {
        ignoreEncryption: true,
      });
      const copied = await outDoc.copyPages(part, part.getPageIndices());
      for (const p of copied) {
        outDoc.addPage(p);
        pageCount++;
      }
    }
    const bytes = await outDoc.save();
    const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    const storageId = await ctx.storage.store(blob);
    const url = (await ctx.storage.getUrl(storageId)) ?? undefined;
    await ctx.runMutation(api.adaptivePdf.setLanguagePdf, {
      projectId: args.projectId,
      langCode: args.langCode,
      storageId,
      url,
      pageCount,
    });
    return { assembled: true, batches: done.length, pageCount };
  },
});

export const setLanguagePdf = internalMutation({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    storageId: v.id("_storage"),
    url: v.optional(v.string()),
    pageCount: v.number(),
  },
  handler: async (ctx, args) => {
    const translations = (await ctx.db
      .query("translations")
      .withIndex("by_project_lang", (q) =>
        q.eq("projectId", args.projectId).eq("langCode", args.langCode),
      )
      .collect()) as Array<{ _id: Id<"translations">; status: string }>;
    const t = translations[0];
    if (!t) return { ok: false };
    await ctx.db.patch(t._id, {
      pdfStorageId: args.storageId,
      pdfUrl: args.url,
      pdfGenerating: false,
      pdfProgress: `assembled from batches: ${args.pageCount} pages`,
    });
    await ctx.db.patch(args.projectId, {
      pdfGenerationState: "complete",
    });
    return { ok: true };
  },
});

// ─── Wire-in: route adaptive languages into batched PDF generation ───────
// (Called from adaptiveJobs.flushJobResults instead of the whole-book render.)

export const startLanguageBatches = internalMutation({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    translationId: v.id("translations"),
  },
  handler: async (ctx, args) => {
    const project = (await ctx.db.get(args.projectId)) as
      | { pageCount?: number; pdfStorageId?: string }
      | null;
    if (!project) return { started: false };
    // Pasted-text projects have no PDF — complete without PDF (legacy parity).
    if (!project.pdfStorageId) {
      await ctx.db.patch(args.translationId, {
        status: "complete",
        pdfGenerating: false,
        completedAt: Date.now(),
      });
      await ctx.runMutation(api.adaptiveJobs.zipFinalizeIfDone, {
        projectId: args.projectId,
      });
      return { started: false, reason: "no_pdf" };
    }
    await ctx.db.patch(args.translationId, {
      status: "generating_pdf",
      pdfGenerating: true,
    });
    await ctx.scheduler.runAfter(0, api.adaptivePdf.processAllBatches, {
      projectId: args.projectId,
      langCode: args.langCode,
    });
    return { started: true };
  },
});
