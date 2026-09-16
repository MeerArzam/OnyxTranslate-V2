"use node";

// fontkit's UMD bundle contains transpiled async GSUB code (Devanagari/Bengali
// substitution paths) that expects a global regeneratorRuntime — provide it
// BEFORE fontkit is ever imported. Verified: hi measures 201 widths in 746ms
// with the polyfill; without it fontkit throws "regeneratorRuntime is not
// defined".
import "regenerator-runtime/runtime";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { renderTranslatedPdf } from "./renderPdfCore";

/**
 * convex/generatePdf.ts — Server-side translated PDF generation (Segment B).
 *
 * Reads the original PDF from Convex Storage, renders the translated overlay
 * via the shared pure module renderPdfCore.ts (per-block erase + auto-fit,
 * paragraph mapping, RTL word-order handling), stores the result in Convex
 * Storage, and chains to the NEXT language's translation or ZIP assembly.
 *
 * The rendering body lives in renderPdfCore so scripts/testPdfFidelity.cjs
 * can execute the EXACT production render code (no drift between prod and
 * the fidelity assertions).
 */

// ─── Font cache (across calls within same action worker) ────────────────

const fontCache = new Map<string, ArrayBuffer>();

async function getFontBytes(url: string): Promise<ArrayBuffer> {
  const cached = fontCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Font download failed (HTTP ${resp.status}): ${url}`);
  const bytes = await resp.arrayBuffer();
  fontCache.set(url, bytes);
  return bytes;
}

// ─── Main action ────────────────────────────────────────────────────────

export const generateTranslatedPdf = action({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    translationId: v.id("translations"),
    mergedText: v.string(),
    // UNIFIED chain: generatePdf now carries the language chain (set by
    // translateContent when each language's text completes)
    nextLangCode: v.optional(v.string()),
    remainingLangs: v.optional(v.array(v.string())),
    marketContext: v.optional(v.string()),
  },
  handler: async (ctx, args) => {

    // 1. Get project and original PDF
    const project = await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");

    // Pasted-text projects have no PDF — keep the chain alive, do NOT abort
    if (!project.pdfStorageId) {
      await ctx.runMutation(api.mutations.updateTranslation, {
        translationId: args.translationId,
        status: "complete",
        pdfGenerating: false,
        completedAt: Date.now(),
      });
      if (args.nextLangCode) {
        const rest = args.remainingLangs || [];
        await ctx.scheduler.runAfter(0, api.translateContent.translateLanguage, {
          projectId: args.projectId,
          langCode: args.nextLangCode,
          marketContext: args.marketContext,
          nextLangCode: rest.length > 0 ? rest[0] : undefined,
          remainingLangs: rest.length > 1 ? rest.slice(1) : undefined,
        });
      } else {
        // All languages done — finalize project + build ZIP
        await ctx.runMutation(api.mutations.updateProject, {
          projectId: args.projectId,
          status: "all_translated",
        });
        await ctx.scheduler.runAfter(0, api.zipAssembly.buildZip, {
          projectId: args.projectId,
        });
      }
      return { skipped: true, url: undefined, storageId: undefined };
    }

    const pdfBlob = await ctx.storage.get(project.pdfStorageId);
    if (!pdfBlob) throw new Error("Original PDF blob not found");
    const pdfArrayBuffer = await pdfBlob.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfArrayBuffer);

    // 2. Render via the shared production core (identical code path as the
    // fidelity tests): copy pages → per-item whiteout → block overlay
    //
    // CHAIN-SAFETY: a render crash here used to kill the whole remaining
    // language chain (the chain continues INSIDE this action). Now the error
    // is surfaced honestly on the translation row (status "error" + message
    // in pdfProgress) and the chain CONTINUES to the next language.
    // FIX (1MiB limit): if pageData was offloaded to Storage (empty on the
    // row with a ref present), resolve the real coordinates before rendering.
    let pageDataRaw: unknown = project.pageData;
    if (Array.isArray(pageDataRaw) && pageDataRaw.length === 0 && (project as { pageDataStorageId?: string }).pageDataStorageId) {
      const blob = await ctx.storage.get((project as { pageDataStorageId: string }).pageDataStorageId);
      if (blob) pageDataRaw = JSON.parse(await blob.text());
    }
    const pageData = (pageDataRaw || []) as NonNullable<
      Parameters<typeof renderTranslatedPdf>[0]["pageData"]
    >;

    let storageId: string | undefined;
    let url: string | undefined;
    try {
      const { bytes: resultBytes, stats: pdfFit } = await renderTranslatedPdf({
        srcBytes: pdfBytes,
        pageData,
        mergedText: args.mergedText,
        langCode: args.langCode,
        getFontBytes,
      });

      console.log(
        `[generatePdf] ${args.langCode} pdfFit: blocks=${pdfFit.pagesUsingBlocks} fallback=${pdfFit.pagesFallback} paraMatched=${pdfFit.paragraphsMatchedPages} minFont=${pdfFit.minFontSize === 999 ? 0 : pdfFit.minFontSize}pt`,
      );

      // 3. Store in Convex Storage
      const resultBlob = new Blob(
        [new Uint8Array(resultBytes).buffer as ArrayBuffer],
        { type: "application/pdf" },
      );
      storageId = await ctx.storage.store(resultBlob);
      url = (await ctx.storage.getUrl(storageId)) ?? undefined;

      // 4. Update translation record
      await ctx.runMutation(api.mutations.updateTranslation, {
        translationId: args.translationId,
        pdfStorageId: storageId,
        pdfUrl: url,
        status: "complete",
        pdfGenerating: false,
        completedAt: Date.now(),
      });
    } catch (renderErr) {
      const message = renderErr instanceof Error ? renderErr.message : String(renderErr);
      console.error(`[generatePdf] ${args.langCode} RENDER FAILED: ${message}`);
      await ctx.runMutation(api.mutations.updateTranslation, {
        translationId: args.translationId,
        status: "error",
        pdfGenerating: false,
        pdfProgress: `pdf_render_failed: ${message.slice(0, 300)}`,
        completedAt: Date.now(),
      });
    }

    // 5. UNIFIED chain: next language comes from the args set by
    // translateContent (nextLangCode + remainingLangs). If none remain,
    // all languages are done — mark project and build the ZIP.
    if (args.nextLangCode) {
      const rest = args.remainingLangs || [];
      await ctx.scheduler.runAfter(0, api.translateContent.translateLanguage, {
        projectId: args.projectId,
        langCode: args.nextLangCode,
        marketContext: args.marketContext,
        nextLangCode: rest.length > 0 ? rest[0] : undefined,
        remainingLangs: rest.length > 1 ? rest.slice(1) : undefined,
      });
    } else {
      // All languages done — build ZIP
      await ctx.runMutation(api.mutations.updateProject, {
        projectId: args.projectId,
        status: "all_translated",
      });
      await ctx.scheduler.runAfter(0, api.zipAssembly.buildZip, {
        projectId: args.projectId,
      });
    }

    return { storageId: storageId ?? undefined, url, renderFailed: !storageId };
  },
});
