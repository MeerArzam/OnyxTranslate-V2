"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import { wrapText, toVisualBidi, RENDER_FONT_URLS } from "./renderPdfCore";
import type { PDFFont } from "pdf-lib";

/**
 * convex/textPdf.ts — PDF output for PASTED-TEXT projects.
 *
 * Pasted-text projects have no original PDF (no pdfStorageId), so the
 * whole-book overlay renderer short-circuits and marks the translation
 * complete with no artifact. This module renders the merged translation
 * itself into a clean A4 document — same font stack (RENDER_FONT_URLS),
 * same RTL law (true bidi + shaping for ar/ur/ks via toVisualBidi), same
 * wrapText — so pasted-text output matches the overlay renderer's fidelity
 * guarantees. Thin Motherboard: pure machine work, zero linguistic logic.
 */

async function getFontBytes(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Font download failed (HTTP ${resp.status}): ${url}`);
  return resp.arrayBuffer();
}

export const generateTextPdf = internalAction({
  args: {
    projectId: v.id("projects"),
    translationId: v.id("translations"),
    langCode: v.string(),
  },
  handler: async (ctx, args) => {
    const translation = (await ctx.runQuery(api.textPdfState.getTranslationInternal, {
      translationId: args.translationId,
    })) as { mergedText?: string } | null;
    const mergedText = translation?.mergedText?.trim();
    if (!mergedText) throw new Error("No merged text to render");

    try {
      const pdfLibMod = (await import("pdf-lib")) as unknown as Record<string, unknown>;
      const pdfLib = (
        pdfLibMod.PDFDocument ? pdfLibMod : (pdfLibMod.default as Record<string, unknown>)
      ) as typeof import("pdf-lib");
      const { PDFDocument, rgb } = pdfLib;

      const outDoc = await PDFDocument.create();
      try {
        const fontkitMod = (await import("@pdf-lib/fontkit")) as unknown as Record<string, unknown>;
        const fontkit = fontkitMod.default ?? fontkitMod;
        outDoc.registerFontkit(fontkit as never);
      } catch {
        // fontkit optional — only needed for the Unicode fonts
      }

      const isRTL = ["ar", "ur", "ks"].includes(args.langCode);
      const fontUrl = RENDER_FONT_URLS[args.langCode];
      let font: PDFFont;
      try {
        if (fontUrl) font = await outDoc.embedFont(await getFontBytes(fontUrl));
        else font = await outDoc.embedFont(pdfLib.StandardFonts.Helvetica);
      } catch {
        font = await outDoc.embedFont(pdfLib.StandardFonts.Helvetica);
      }

      const black = rgb(0, 0, 0);
      const pageWidth = 595.28; // A4 portrait, points
      const pageHeight = 841.89;
      const margin = 56;
      const fontSize = 12;
      const lineHeight = fontSize * 1.5;
      const maxWidth = pageWidth - margin * 2;

      const paragraphs = mergedText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      const fontMeasure = font as unknown as {
        widthOfTextAtSize(t: string, s: number): number;
        heightAtSize(s: number): number;
      };
      const maxLinesPerPage = Math.max(1, Math.floor((pageHeight - margin * 2) / lineHeight));
      // Flat line stream: wrap each paragraph, separate with a blank line.
      const allLines: string[] = [];
      paragraphs.forEach((para, idx) => {
        if (idx > 0) allLines.push("");
        allLines.push(...wrapText(fontMeasure, para, maxWidth, fontSize));
      });
      if (allLines.length === 0) allLines.push("");

      const pages: string[][] = [];
      for (let i = 0; i < allLines.length; i += maxLinesPerPage) {
        pages.push(allLines.slice(i, i + maxLinesPerPage));
      }

      for (const pageLines of pages) {
        const page = outDoc.addPage([pageWidth, pageHeight]);
        let baseline = pageHeight - margin - fontSize;
        for (const line of pageLines) {
          if (!line.trim()) {
            baseline -= lineHeight;
            continue;
          }
          try {
            if (isRTL) {
              const visual = toVisualBidi(line);
              const lineWidth = fontMeasure.widthOfTextAtSize(visual, fontSize);
              page.drawText(visual, {
                x: pageWidth - margin - lineWidth,
                y: baseline,
                size: fontSize,
                font,
                color: black,
              });
            } else {
              page.drawText(line, { x: margin, y: baseline, size: fontSize, font, color: black });
            }
          } catch {
            // skip unencodable glyph lines (same law as the overlay renderer)
          }
          baseline -= lineHeight;
        }
      }

      const bytes = await outDoc.save();
      const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const storageId = await ctx.storage.store(blob);
      const url = (await ctx.storage.getUrl(storageId)) ?? undefined;
      if (!url) throw new Error("Storage returned no URL");
      await ctx.runMutation(api.textPdfState.markPdfComplete, {
        projectId: args.projectId,
        translationId: args.translationId,
        storageId,
        url,
      });
      return { rendered: true, bytes: bytes.length, storageId, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(api.textPdfState.markPdfError, { translationId: args.translationId, message });
      return { rendered: false, error: message.slice(0, 300) };
    }
  },
});
