"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/generatePdf.ts — Server-side translated PDF generation (Segment B).
 *
 * Reads the original PDF from Convex Storage, copies each page (preserving
 * images/maps), whites out English text, overlays translated text using
 * Noto Sans fonts for non-Latin scripts, stores the result in Convex Storage,
 * and chains to the NEXT language's translation or ZIP assembly.
 */

// ─── Font URLs for non-Latin scripts ────────────────────────────────────

const FONT_URLS: Record<string, string> = {
  ur: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoNastaliqUrdu-Regular.ttf",
  ar: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansArabic-Regular.ttf",
  ks: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansArabic-Regular.ttf",
  ja: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansJP-Regular.ttf",
  zh: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansSC-Regular.ttf",
  ko: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansKR-Regular.ttf",
  hi: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansDevanagari-Regular.ttf",
  ne: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansDevanagari-Regular.ttf",
  bn: "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSansBengali-Regular.ttf",
  // Latin-script languages use Helvetica (built-in)
};

const RTL_CODES = new Set(["ar", "ur", "ks"]);

const LANGUAGES = [
  "ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
  "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
];

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

// ─── Text wrapping ──────────────────────────────────────────────────────

function wrapText(
  font: { widthOfTextAtSize: (text: string, size: number) => number },
  text: string,
  maxWidth: number,
  size: number,
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
        // Break very long words character by character
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
    translationId: v.id("translations"),
    mergedText: v.string(),
  },
  handler: async (ctx, args) => {
    const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");

    // 1. Get project and original PDF
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

    // 2. Load original PDF
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const srcPageCount = srcDoc.getPageCount();
    if (srcPageCount === 0) throw new Error("Source PDF has no pages");

    // 3. Create output document
    const outDoc = await PDFDocument.create();

    // Register fontkit for custom font embedding
    const fontkitModule = await import("@pdf-lib/fontkit");
    const fontkit = (fontkitModule as { default?: unknown }).default ?? fontkitModule;
    outDoc.registerFontkit(fontkit as never);

    // 4. Embed font for this language
    const isRTL = RTL_CODES.has(args.langCode);
    const fontUrl = FONT_URLS[args.langCode];
    let font;
    try {
      if (fontUrl) {
        font = await outDoc.embedFont(await getFontBytes(fontUrl));
      } else {
        font = await outDoc.embedFont(StandardFonts.Helvetica);
      }
    } catch {
      font = await outDoc.embedFont(StandardFonts.Helvetica);
    }

    const black = rgb(0, 0, 0);
    const white = rgb(1, 1, 1);

    // 5. Split translated text proportionally across pages
    const translatedWords = args.mergedText.split(/\s+/).filter(Boolean);
    const totalWords = translatedWords.length;
    const perPageWords = Math.ceil(totalWords / srcPageCount);

    let wordIdx = 0;

    // 6. Process each page: copy original → whiteout → overlay translation
    for (let i = 0; i < srcPageCount; i++) {
      const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
      outDoc.addPage(copiedPage);

      const pageWidth = copiedPage.getWidth();
      const pageHeight = copiedPage.getHeight();

      // Text area: generous margins for book layout
      const margin = 50;
      const textLeft = margin;
      const textRight = pageWidth - margin;
      const maxWidth = textRight - textLeft;

      // Font size (standard 10-12pt for most PDFs)
      const fontSize = 10;
      const lineHeight = fontSize * 1.4;
      const textBottom = margin + 10;

      // White-out the English text area
      copiedPage.drawRectangle({
        x: textLeft - 5,
        y: textBottom - 5,
        width: maxWidth + 10,
        height: pageHeight - textBottom - margin + 10,
        color: white,
        borderWidth: 0,
      });

      // Get words for this page
      const endIdx = Math.min(wordIdx + perPageWords, totalWords);
      let pageText = translatedWords.slice(wordIdx, endIdx).join(" ");
      wordIdx = endIdx;

      // Append remaining to last page
      if (i === srcPageCount - 1 && wordIdx < totalWords) {
        const remaining = translatedWords.slice(wordIdx).join(" ");
        pageText = pageText ? pageText + " " + remaining : remaining;
      }

      // Overlay translated text
      if (pageText.trim()) {
        const wrappedLines = wrapText(font, pageText, maxWidth, fontSize);
        let baseline = pageHeight - margin - fontSize;

        for (const line of wrappedLines) {
          if (baseline - fontSize < textBottom) break;
          if (line.trim()) {
            try {
              if (isRTL) {
                // RTL: draw from right edge
                const visual = [...line].reverse().join("");
                const lineWidth = font.widthOfTextAtSize(visual, fontSize);
                copiedPage.drawText(visual, {
                  x: textLeft + maxWidth - lineWidth,
                  y: baseline,
                  size: fontSize,
                  font,
                  color: black,
                });
              } else {
                copiedPage.drawText(line, {
                  x: textLeft,
                  y: baseline,
                  size: fontSize,
                  font,
                  color: black,
                });
              }
            } catch {
              // Skip lines with unencodable glyphs
            }
          }
          baseline -= lineHeight;
        }
      }
    }

    // 7. Save and store in Convex Storage
    const resultBytes = await outDoc.save();
    const resultBlob = new Blob(
      [new Uint8Array(resultBytes).buffer as ArrayBuffer],
      { type: "application/pdf" },
    );
    const storageId = await ctx.storage.store(resultBlob);
    const url = (await ctx.storage.getUrl(storageId)) ?? undefined;

    // 8. Update translation record
    await ctx.runMutation(api.mutations.updateTranslation, {
      translationId: args.translationId,
      pdfStorageId: storageId,
      pdfUrl: url,
      status: "complete",
      pdfGenerating: false,
      completedAt: Date.now(),
    });

    // 9. Chain to next language or build ZIP
    const langIndex = LANGUAGES.indexOf(args.langCode);
    if (langIndex < LANGUAGES.length - 1) {
      const nextLang = LANGUAGES[langIndex + 1];
      await ctx.scheduler.runAfter(0, api.translateQueue.processLanguage, {
        projectId: args.projectId,
        langCode: nextLang,
        chunkIndex: 0,
      });
    } else {
      // Last language done — build ZIP
      await ctx.runMutation(api.mutations.updateProject, {
        projectId: args.projectId,
        status: "all_translated",
      });
      await ctx.scheduler.runAfter(0, api.zipAssembly.buildZip, {
        projectId: args.projectId,
      });
    }

    return { storageId, url };
  },
});
