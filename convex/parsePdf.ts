"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * convex/parsePdf.ts — Server-side PDF text extraction.
 *
 * The browser's pdf.js parser extracts individual text items without merging
 * nearby fragments, causing broken words and missing letters. This action
 * re-parses the PDF server-side with proper Y-coordinate grouping into lines.
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

    // 2. Dynamically import pdfjs-dist
    const pdfjsLib = await import("pdfjs-dist");

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
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const pageWidth = viewport.width;
      const pageHeight = viewport.height;

      // Use getTextContent with normalizeWhitespace enabled via the options
      // object. In pdfjs-dist v6+, the text items are already combined by
      // default when disableCombineTextItems is NOT set to true.
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

      // Group items into lines by Y-coordinate proximity (2px tolerance)
      const lines = groupIntoLines(textItems, 2);

      // Build clean page text from grouped lines
      const pageText = lines.map((l) => l.text).join("\n").trim();

      allPages.push({
        num: pageNum,
        text: pageText,
        lines,
        textItems,
        pageWidth,
        pageHeight,
      });
      allTexts.push(pageText);

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

/**
 * Group text items into lines by Y-coordinate proximity.
 *
 * Items within `tolerance` pixels vertically are on the same line.
 * Within each line, items are sorted left-to-right by X position.
 * Words within a line are joined with single spaces.
 */
function groupIntoLines(
  items: ServerParsedTextItem[],
  tolerance: number
): ServerParsedLine[] {
  if (items.length === 0) return [];

  // Sort by Y descending (higher Y = top of page in PDF coords)
  const sorted = [...items].sort((a, b) => b.y - a.y);

  const groups: ServerParsedTextItem[][] = [];
  let currentGroup: ServerParsedTextItem[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const lastInGroup = currentGroup[currentGroup.length - 1];

    if (Math.abs(item.y - lastInGroup.y) <= tolerance) {
      currentGroup.push(item);
    } else {
      groups.push(currentGroup);
      currentGroup = [item];
    }
  }
  groups.push(currentGroup);

  // Sort each group left-to-right and build line text
  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x);

    const text = group
      .map((it) => it.str.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const avgY =
      group.reduce((sum, it) => sum + it.y, 0) / group.length;

    return { text, y: avgY };
  });
}
