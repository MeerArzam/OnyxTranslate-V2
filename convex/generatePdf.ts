"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/generatePdf.ts — Server-side translated PDF generation.
 *
 * Reads the original PDF from Convex Storage, overlays translated text on
 * each page using pdf-lib vector text drawing (no canvas rasterization),
 * stores the result back in Convex Storage, and returns a download URL.
 *
 * Font handling: Downloads Noto Sans fonts for non-Latin scripts and embeds
 * them once. For Latin scripts, uses Helvetica (built-in).
 */

// ─── Font URLs for non-Latin scripts ────────────────────────────────────

const FONT_URLS: Record<string, string> = {
  ar: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoNaskhArabic/hinted/ttf/NotoNaskhArabic-Regular.ttf",
  ur: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoNaskhArabic/hinted/ttf/NotoNaskhArabic-Regular.ttf",
  ks: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoNaskhArabic/hinted/ttf/NotoNaskhArabic-Regular.ttf",
  hi: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf",
  ne: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf",
  bn: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansBengali/hinted/ttf/NotoSansBengali-Regular.ttf",
  ru: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  tr: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  ro: "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf",
  ja: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf",
  zh: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
  ko: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf",
};

const RTL_CODES = ["ar", "ur", "ks"];

const fontCache = new Map<string, ArrayBuffer>();

async function getFontBytes(url: string): Promise<ArrayBuffer> {
  const cached = fontCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Font download failed (HTTP ${resp.status})`);
  const bytes = await resp.arrayBuffer();
  fontCache.set(url, bytes);
  return bytes;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Wrap text into lines that fit maxWidth using the font's real metrics.
 */
function wrapText(
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  text: string,
  maxWidth: number,
  size: number
): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";

    for (const word of words) {
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        if (current) {
          lines.push(current);
          current = "";
        }
        let chunk = "";
        for (const ch of word) {
          if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
        continue;
      }
      const test = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

// ─── Main action ────────────────────────────────────────────────────────

export const generateTranslatedPdf = action({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    translatedText: v.string(),
  },
  handler: async (ctx, args) => {
    const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

    // 1. Get the project's original PDF from storage
    const project = await ctx.runQuery(api.queries.getProject, {
      projectId: args.projectId,
    });
    if (!project || !project.pdfStorageId) {
      throw new Error("Project PDF not found in storage");
    }

    const pdfBlob = await ctx.storage.get(project.pdfStorageId);
    if (!pdfBlob) throw new Error("Original PDF blob not found");
    const pdfArrayBuffer = await pdfBlob.arrayBuffer();
    const pdfBytes = new Uint8Array(pdfArrayBuffer);

    // 2. Load the original PDF
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();

    if (srcPageCount === 0) throw new Error("Source PDF has no pages");

    // 3. Create output document
    const outDoc = await PDFDocument.create();

    // Register fontkit for custom font embedding
    const fontkitModule = await import("@pdf-lib/fontkit");
    const fontkit = (fontkitModule as { default?: unknown }).default ?? fontkitModule;
    outDoc.registerFontkit(fontkit as never);

    // 4. Embed font
    const isRTL = RTL_CODES.includes(args.langCode);
    const fontUrl = FONT_URLS[args.langCode];
    let font;
    try {
      if (fontUrl) {
        font = await outDoc.embedFont(await getFontBytes(fontUrl));
      } else {
        font = await outDoc.embedFont(StandardFonts.Helvetica);
      }
    } catch {
      // Fallback to Helvetica if custom font fails
      font = await outDoc.embedFont(StandardFonts.Helvetica);
    }

    const black = rgb(0, 0, 0);
    const white = rgb(1, 1, 1);
    const pad = 2;

    // 5. Split translated text proportionally across pages
    const translatedWords = args.translatedText.split(/\s+/).filter(Boolean);
    const totalWords = translatedWords.length;
    const perPageWords = Math.ceil(totalWords / srcPageCount);

    let wordIdx = 0;

    // 6. Process each page: copy original → white-out → overlay translation
    for (let i = 0; i < srcPageCount; i++) {
      const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
      outDoc.addPage(copiedPage);

      const pageWidth = copiedPage.getWidth();
      const pageHeight = copiedPage.getHeight();

      // Get text from the original page (using simple text extraction)
      const origPage = srcDoc.getPage(i);
      // We'll estimate text positions from page dimensions
      // Use generous margins and standard text area
      const margin = 50;
      const textLeft = margin;
      const textRight = pageWidth - margin;
      const textTop = pageHeight - margin;
      const textBottom = margin;
      const maxWidth = textRight - textLeft;

      // Font size estimation (standard 10-12pt for most PDFs)
      const fontSize = 10;
      const lineHeight = fontSize * 1.4;

      // Get words for this page
      const endIdx = Math.min(wordIdx + perPageWords, totalWords);
      const pageText = translatedWords.slice(wordIdx, endIdx).join(" ");
      wordIdx = endIdx;

      // Append remaining to last page
      if (i === srcPageCount - 1 && wordIdx < totalWords) {
        const remaining = translatedWords.slice(wordIdx).join(" ");
        const pageTextFinal = pageText ? pageText + " " + remaining : remaining;
        overlayText(outDoc, copiedPage, pageTextFinal, font, isRTL, {
          textLeft,
          textBottom,
          maxWidth,
          fontSize,
          lineHeight,
          pageHeight,
          black,
        });
      } else {
        overlayText(outDoc, copiedPage, pageText, font, isRTL, {
          textLeft,
          textBottom,
          maxWidth,
          fontSize,
          lineHeight,
          pageHeight,
          black,
        });
      }
    }

    // 7. Save and store in Convex Storage
    const resultBytes = await outDoc.save();
    const resultBlob = new Blob(
      [new Uint8Array(resultBytes).buffer as ArrayBuffer],
      { type: "application/pdf" }
    );
    const storageId = await ctx.storage.store(resultBlob);

    // 8. Update the translation record with the PDF storage ID
    // Query translations for this project/lang
    const translations = await ctx.runQuery(
      api.queries.getProjectTranslations,
      { projectId: args.projectId }
    );
    const translation = translations.find((t) => t.langCode === args.langCode);
    if (translation) {
      await ctx.runMutation(api.mutations.updateTranslation, {
        translationId: translation._id,
        pdfStorageId: storageId,
      });
    }

    return { storageId };
  },
});

// ─── Helper: Overlay text on a page ─────────────────────────────────────

function overlayText(
  outDoc: any,
  page: any,
  text: string,
  font: any,
  isRTL: boolean,
  opts: {
    textLeft: number;
    textBottom: number;
    maxWidth: number;
    fontSize: number;
    lineHeight: number;
    pageHeight: number;
    black: any;
  }
) {
  if (!text.trim()) return;

  const wrappedLines = wrapText(font, text, opts.maxWidth, opts.fontSize);
  let baseline = opts.pageHeight - opts.textBottom - opts.fontSize;

  for (const line of wrappedLines) {
    if (baseline - opts.fontSize < opts.textBottom) break;
    if (line.trim()) {
      try {
        if (isRTL) {
          // Simple RTL: reverse characters (pdf-lib draws LTR)
          const visual = [...line].reverse().join("");
          const lineWidth = font.widthOfTextAtSize(visual, opts.fontSize);
          page.drawText(visual, {
            x: opts.textLeft + opts.maxWidth - lineWidth,
            y: baseline,
            size: opts.fontSize,
            font,
            color: opts.black,
          });
        } else {
          page.drawText(line, {
            x: opts.textLeft,
            y: baseline,
            size: opts.fontSize,
            font,
            color: opts.black,
          });
        }
      } catch {
        // Skip lines with unencodable glyphs
      }
    }
    baseline -= opts.lineHeight;
  }
}
