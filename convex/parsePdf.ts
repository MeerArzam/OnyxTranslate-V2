"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { itemsToBlocks, mergeItemsIntoLines, type LayoutTextItem } from "./pdfLayout";

/**
 * convex/parsePdf.ts — Server-side PDF text extraction.
 *
 * The browser's pdf.js parser extracts individual text items without merging
 * nearby fragments, causing broken words and missing letters. This action
 * re-parses the PDF server-side with geometry-aware word merging (x-gap
 * based) and paragraph block clustering.
 */

interface RawTextItem {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface ServerParsedTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

export interface ServerParsedLine {
  text: string;
  y: number;
}

export interface ServerParsedPage {
  num: number;
  text: string;
  lines: ServerParsedLine[];
  textItems: ServerParsedTextItem[];
  blocks: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    lineCount: number;
    align: "left" | "center";
  }>;
  pageWidth: number;
  pageHeight: number;
}

export const parseUploadedPdf = action({
  args: {
    pdfStorageId: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Download PDF from Convex File Storage
    const blob = await ctx.storage.get(args.pdfStorageId);
    if (!blob) throw new Error("PDF not found in storage");
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // 2. Dynamically import pdfjs-dist.
    // CRITICAL: pdfjs-dist references DOMMatrix at module load. In the
    // browser that global exists; in the Node runtime ("use node" actions)
    // it does not, and the optional @napi-rs/canvas polyfill is unavailable,
    // so the import crashed with "DOMMatrix is not defined". Text extraction
    // never performs real rendering — a minimal stub is sufficient.
    const g = globalThis as Record<string, unknown>;
    if (typeof g.pdfjsWorker === "undefined") {
      // In Node, pdf.js falls back to a "fake worker" that does a runtime
      // dynamic import of pdf.worker.mjs — impossible inside Convex's
      // bundler. Pre-registering the worker module on globalThis.pdfjsWorker
      // is the documented escape hatch pdf.js checks FIRST.
      const workerMod = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
      g.pdfjsWorker = workerMod;
    }
    if (typeof g.DOMMatrix === "undefined") {
      class DOMMatrixStub {
        a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
        constructor(init?: unknown) {
          if (Array.isArray(init) && init.length === 6) {
            [this.a, this.b, this.c, this.d, this.e, this.f] = init as number[];
          }
        }
        multiply() { return this; }
        translate() { return this; }
        scale() { return this; }
        rotate() { return this; }
        inverse() { return this; }
        transformPoint(p: { x: number; y: number }) { return { x: p.x, y: p.y, z: 0, w: 1 }; }
      }
      g.DOMMatrix = DOMMatrixStub;
    }
    if (typeof g.Path2D === "undefined") {
      g.Path2D = class {
        moveTo() {} lineTo() {} closePath() {} rect() {} arc() {}
        bezierCurveTo() {} quadraticCurveTo() {}
      };
    }
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

    // 3. Load the PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: uint8,
      useSystemFonts: true,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    // 4. Parse each page with proper merging
    const allPages: ServerParsedPage[] = [];
    const allTexts: string[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const pageWidth = viewport.width;
        const pageHeight = viewport.height;

        const textContent = await page.getTextContent({
          normalizeWhitespace: true,
        } as any);

        const rawItems = (textContent.items as RawTextItem[]).filter(
          (item) => "str" in item && item.str.trim().length > 0
        );

        // Map to clean format (PDF bottom-origin coordinates, unscaled)
        const textItems: ServerParsedTextItem[] = rawItems.map((item) => {
          const t = item.transform || [1, 0, 0, 1, 0, 0];
          return {
            str: item.str,
            x: t[4],
            y: t[5],
            width: item.width || 0,
            height: item.height || 0,
            fontName: item.fontName || "",
          };
        });

        // Geometry-aware merging (x-gap based) — fixes "Ony xStor m"
        const layoutLines = mergeItemsIntoLines(textItems as LayoutTextItem[]);

        // Paragraph block clustering for coordinate-aware PDF output
        const blocks = itemsToBlocks(textItems as LayoutTextItem[]);

        const lines: ServerParsedLine[] = layoutLines.map((l) => ({
          text: l.text,
          y: l.y,
        }));

        // Build clean page text from grouped lines
        const pageText = layoutLines.map((l) => l.text).join("\n").trim();

        allPages.push({
          num: pageNum,
          text: pageText,
          lines,
          textItems,
          blocks,
          pageWidth,
          pageHeight,
        });
        allTexts.push(pageText);
      } catch (pageErr) {
        // One unreadable page must not kill the whole parse — record an
        // empty page and continue.
        console.warn(`[parsePdf] page ${pageNum} failed:`, pageErr);
        allPages.push({
          num: pageNum,
          text: "",
          lines: [],
          textItems: [],
          blocks: [],
          pageWidth: 595,
          pageHeight: 842,
        });
        allTexts.push("");
      }

      // Yield every 20 pages to stay within action timeout
      if (pageNum % 20 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    const fullText = allTexts.filter(Boolean).join("\n\n").trim();
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    return {
      pageData: allPages,
      fullText,
      pageCount: totalPages,
      wordCount,
    };
  },
});
