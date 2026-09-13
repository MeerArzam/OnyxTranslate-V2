/**
 * convex/renderPdfCore.ts — Pure PDF overlay planning (NO Convex imports).
 *
 * Used by convex/generatePdf.ts (production) and scripts/testPdfFidelity.ts
 * (verification). Implements Google-translate-grade fidelity:
 *
 *   C1. Paragraph alignment — translated paragraphs (split on the \n\n
 *       sentinel produced by the 23-phase pipeline) are mapped back to their
 *       original paragraph BLOCKS in reading order. When counts mismatch the
 *       page falls back to word-proportional fill (recorded, never silent).
 *
 *   C2. Per-block font auto-fit — each block starts at its OWN original font
 *       size, wraps at the block's original width (lineHeight 1.3×), and
 *       shrinks ×0.95 (floor 6pt) until the wrapped text fits BOTH width and
 *       height. Erase rectangle = block bounds + 1px padding (white).
 *
 *   C3. RTL — Arabic/Kashmiri get TRUE bidi (UAX #9) + Arabic shaping:
 *       logical text is reshaped to Unicode presentation forms (U+FE70–U+FEFF
 *       contextual glyphs via arabic-reshaper) and reordered to visual order
 *       (bidi-js); the embedded Noto Sans Arabic font carries those glyphs
 *       (verified via cmap). Urdu stays on WORD-ORDER reversal because Noto
 *       Nastaliq Urdu lacks presentation-form glyphs (would render boxes);
 *       documented limitation, not silent corruption.
 */

import { itemsToBlocks, type LayoutTextItem } from "./pdfLayout";
import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";

export interface RenderFont {
  widthOfTextAtSize(text: string, size: number): number;
  heightAtSize(size: number): number;
}

export interface RenderBlock {
  text: string;
  x: number;
  /** Top edge measured from the page TOP (client-stored convention). */
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineCount: number;
  align: "left" | "center";
}

export interface BlockOp {
  erase: { x: number; y: number; width: number; height: number };
  lines: Array<{ text: string; x: number; y: number; size: number }>;
  fontSize: number;
  fits: boolean;
  /** bottom-origin y of the erase rect (for pdf-lib drawRectangle) */
  eraseYBottomOrigin: number;
}

export interface PageOverlayPlan {
  ops: BlockOp[];
  mode: "blocks" | "proportional";
  paragraphsMatched: boolean;
  minFontSize: number;
}

const SIZE_FLOOR = 6;
const SIZE_CAP = 16;
const LINE_HEIGHT_FACTOR = 1.3;

// ──────────────────────────────────────────────────────────
// Word wrapping (moved from generatePdf — shared with tests)
// ──────────────────────────────────────────────────────────

export function wrapText(
  font: RenderFont,
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

// ──────────────────────────────────────────────────────────
// Paragraph → block mapping
// ──────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Assign translated paragraphs (reading order) to blocks (reading order).
 * 1:1 when counts match; otherwise words are distributed proportionally to
 * each block's ORIGINAL word count (translation preserves the ~1:1 word
 * ratio per paragraph, so this stays faithful even when the model merged or
 * split a paragraph).
 */
export function mapParagraphsToBlocks(
  paragraphs: string[],
  blocks: RenderBlock[],
): { text: string[]; matched: boolean } {
  if (blocks.length === 0) return { text: [], matched: false };

  if (paragraphs.length === blocks.length) {
    return { text: paragraphs, matched: true };
  }

  const blockWords = blocks.map((b) => Math.max(countWords(b.text), 1));
  const totalBlockWords = blockWords.reduce((a, b) => a + b, 0);
  const paraWords = paragraphs.map(countWords);
  const totalParaWords = Math.max(
    paraWords.reduce((a, b) => a + b, 0),
    1,
  );

  const out: string[] = [];
  let paraIdx = 0;
  let consumed = 0; // words consumed so far (of totalParaWords)

  for (let b = 0; b < blocks.length; b++) {
    const target = (blockWords[b] / totalBlockWords) * totalParaWords;
    let buf: string[] = [];
    let bufWords = 0;
    // Pull paragraphs until this block has its proportional share
    while (
      paraIdx < paragraphs.length &&
      (bufWords + paraWords[paraIdx] <= target + 0.5 || b === blocks.length - 1)
    ) {
      buf.push(paragraphs[paraIdx]);
      bufWords += paraWords[paraIdx];
      consumed += paraWords[paraIdx];
      paraIdx++;
      if (b < blocks.length - 1 && bufWords >= target) break;
    }
    out.push(buf.join("\n\n"));
  }
  // Any leftover paragraphs go to the last block
  while (paraIdx < paragraphs.length) {
    out[out.length - 1] += "\n\n" + paragraphs[paraIdx++];
  }
  void consumed;

  return { text: out, matched: false };
}

// ──────────────────────────────────────────────────────────
// Per-block font auto-fit
// ──────────────────────────────────────────────────────────

export function fitBlockText(
  font: RenderFont,
  text: string,
  block: RenderBlock,
  isRTL: boolean,
  useBidiShaping = false,
): BlockOp {
  const width = Math.max(block.width, 20);
  const height = Math.max(block.height, block.fontSize);

  let size = Math.min(Math.max(block.fontSize, SIZE_FLOOR), SIZE_CAP);
  let lines: string[] = [];
  let fits = false;

  for (let iter = 0; iter < 24; iter++) {
    lines = wrapText(font, text, width, size);
    const lineHeight = size * LINE_HEIGHT_FACTOR;
    const needed = lines.length * lineHeight;
    if (needed <= height + 0.5) {
      fits = true;
      break;
    }
    const next = size * 0.95;
    if (next < SIZE_FLOOR) {
      size = SIZE_FLOOR;
      lines = wrapText(font, text, width, size);
      break;
    }
    size = next;
  }

  const lineHeight = size * LINE_HEIGHT_FACTOR;

  // Erase rect: block bounds +1px padding, white — drawn by the caller.
  const erase = {
    x: block.x - 1,
    y: block.y - 1, // top-origin
    width: width + 2,
    height: height + 2,
  };

  // Baselines (bottom-origin for pdf-lib): first baseline sits one font
  // ascent below the block's top edge.
  const firstBaselineTopOrigin = block.y + size;
  const ops: BlockOp["lines"] = [];
  let drawn = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const baselineTop = firstBaselineTopOrigin + drawn * lineHeight;
    if (baselineTop > block.y + height + lineHeight * 0.5) break; // don't spill past block
    const visual = isRTL
      ? (useBidiShaping ? toVisualBidi(line) : reverseWords(line))
      : line;
    let x = block.x;
    const lineWidth = font.widthOfTextAtSize(visual, size);
    if (block.align === "center" || isRTL) {
      if (isRTL) x = block.x + width - lineWidth;
      else x = block.x + (width - lineWidth) / 2;
    }
    ops.push({
      text: visual,
      x,
      y: baselineTop, // top-origin; caller converts
      size,
    });
    drawn++;
  }

  return {
    erase,
    lines: ops,
    fontSize: size,
    fits,
    // bottom-origin conversion done by caller (needs pageHeight)
    eraseYBottomOrigin: 0,
  };
}

/** RTL visual order: reverse WORD order only, never characters. */
export function reverseWords(line: string): string {
  return line.split(/\s+/).filter(Boolean).reverse().join(" ");
}

/**
 * C3 TRUE bidi pipeline (ar/ks): logical Arabic → shaped presentation forms
 * (U+FE70–U+FEFF) → visual-order string via the Unicode Bidirectional
 * Algorithm. Both pure-JS, no node builtins — verified Convex-compatible.
 * Dynamic requires keep the bundler from eagerly evaluating them in actions
 * that never render RTL pages.
 */
export function toVisualBidi(line: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const arabicShaper = require("arabic-reshaper");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bidiFactory = require("bidi-js");
    const bidi = (bidiFactory.default ?? bidiFactory)();
    const shaped: string =
      (arabicShaper.convertArabic ?? arabicShaper.default?.convertArabic)(line);
    const levels = bidi.getEmbeddingLevels(shaped, "rtl");
    return bidi.getReorderedString(shaped, levels);
  } catch {
    return reverseWords(line); // safety net — never worse than before
  }
}

// ──────────────────────────────────────────────────────────
// Full-page planning
// ──────────────────────────────────────────────────────────

/**
 * Plan the overlay for one page.
 *
 * @param textItems stored text items in TOP-origin coordinates
 * @param storedBlocks stored paragraph blocks (TOP-origin) if the parse
 *        produced them; null for pre-existing projects
 * @param paragraphs translated paragraphs for THIS page (reading order)
 */
export function planPageOverlay(opts: {
  textItems: LayoutTextItem[];
  storedBlocks: RenderBlock[] | null;
  pageWidth: number;
  pageHeight: number;
  paragraphs: string[];
  font: RenderFont;
  isRTL: boolean;
  useBidiShaping?: boolean;
}): PageOverlayPlan {
  const { textItems, storedBlocks, pageHeight, paragraphs, font, isRTL, useBidiShaping = false } = opts;

  // Resolve blocks: prefer stored, else cluster on the fly. Stored items are
  // TOP-origin; clustering helpers expect PDF BOTTOM-origin, so convert.
  let blocks: RenderBlock[];
  if (storedBlocks && storedBlocks.length > 0) {
    blocks = storedBlocks;
  } else {
    const bottomItems: LayoutTextItem[] = textItems.map((it) => ({
      ...it,
      y: pageHeight - it.y - it.height,
    }));
    blocks = itemsToBlocks(bottomItems).map((b) => ({
      ...b,
      y: pageHeight - b.y - b.height, // back to top-origin
    }));
  }

  if (blocks.length === 0 || paragraphs.length === 0) {
    return { ops: [], mode: "blocks", paragraphsMatched: false, minFontSize: 0 };
  }

  const { text: blockTexts, matched } = mapParagraphsToBlocks(paragraphs, blocks);

  const ops: BlockOp[] = [];
  let minSize = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const text = blockTexts[i] ?? "";
    if (!text.trim()) continue;
    const op = fitBlockText(font, text, blocks[i], isRTL, useBidiShaping);
    op.eraseYBottomOrigin = pageHeight - op.erase.y - op.erase.height;
    ops.push(op);
    minSize = Math.min(minSize, op.fontSize);
  }

  return {
    ops,
    mode: "blocks",
    paragraphsMatched: matched,
    minFontSize: Number.isFinite(minSize) ? minSize : 0,
  };
}

// ════════════════════════════════════════════════════════════
// Full-document render (shared by generatePdf action + fidelity tests)
// ════════════════════════════════════════════════════════════

export interface SourcePageData {
  num: number;
  text?: string;
  textItems?: Array<{ str: string; x: number; y: number; width: number; height: number; fontName?: string }>;
  blocks?: RenderBlock[];
  pageWidth?: number;
  pageHeight?: number;
}

export interface RenderFontUrls {
  /** Per-language CDN font URL; absent = Helvetica. */
  [langCode: string]: string | undefined;
}

export interface RenderStats {
  pagesUsingBlocks: number;
  pagesFallback: number;
  paragraphsMatchedPages: number;
  minFontSize: number;
  wordSpaceCompressions: number;
}

export const RENDER_FONT_URLS: RenderFontUrls = {
  ur: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notonastaliqurdu/NotoNastaliqUrdu[wght].ttf",
  // C3: ar/ks use Amiri (STATIC classical Naskh with full Unicode
  // presentation-form coverage). The VARIABLE Noto Sans Arabic crashes in
  // fontkit's GPOS anchor parser on real shaped text (null anchor in a
  // variable-glyph combination) — Amiri embeds+draws the identical text
  // cleanly (verified against the full production translation).
  ar: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf",
  ks: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/amiri/Amiri-Regular.ttf",
  ja: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansjp/NotoSansJP[wght].ttf",
  zh: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC[wght].ttf",
  ko: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanskr/NotoSansKR[wght].ttf",
  hi: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf",
  ne: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansdevanagari/NotoSansDevanagari[wdth,wght].ttf",
  bn: "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosansbengali/NotoSansBengali[wdth,wght].ttf",
};

const RTL_LANGS = new Set(["ar", "ur", "ks"]);

/**
 * Render the translated PDF in memory (NO Convex imports — used by the
 * generatePdf action and by scripts/testPdfFidelity.cjs to assert on the
 * exact production drawing code).
 */
export async function renderTranslatedPdf(opts: {
  srcBytes: Uint8Array;
  pageData: SourcePageData[];
  mergedText: string;
  langCode: string;
  getFontBytes: (url: string) => Promise<ArrayBuffer>;
}): Promise<{ bytes: Uint8Array; stats: RenderStats; usedFallbackFont: boolean }> {
  const { srcBytes, pageData, mergedText, langCode, getFontBytes } = opts;

  // Resolve pdf-lib with CJS/ESM interop fallbacks (action bundlers can
  // expose the CJS build either as named exports or under .default).
  const pdfLibMod = (await import("pdf-lib")) as unknown as Record<string, unknown>;
  const pdfLib = (
    pdfLibMod.PDFDocument ? pdfLibMod : (pdfLibMod.default as Record<string, unknown>)
  ) as typeof import("pdf-lib");
  const PDFDocument = pdfLib.PDFDocument;
  const StandardFontsRef = pdfLib.StandardFonts;
  const rgbRef = pdfLib.rgb;

  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const srcPageCount = srcDoc.getPageCount();
  if (srcPageCount === 0) throw new Error("Source PDF has no pages");

  const outDoc = await PDFDocument.create();
  try {
    const fontkitMod = (await import("@pdf-lib/fontkit")) as unknown as Record<string, unknown>;
    const fontkit = fontkitMod.default ?? fontkitMod;
    outDoc.registerFontkit(fontkit as never);
  } catch {
    // fontkit optional — only needed for custom (Noto) fonts
  }

  const isRTL = RTL_LANGS.has(langCode);
  // C3: TRUE bidi+shaping only where the embedded font carries the Unicode
  // presentation forms the reshaper emits (verified cmap coverage):
  //   ar/ks → Noto Sans Arabic (full coverage)  → bidi + reshape
  //   ur    → Noto Nastaliq Urdu (NO coverage)  → word-reversal fallback
  const useBidiShaping = isRTL && (langCode === "ar" || langCode === "ks");
  const fontUrl = RENDER_FONT_URLS[langCode];
  let font: PDFFont;
  try {
    if (fontUrl) font = await outDoc.embedFont(await getFontBytes(fontUrl));
    else font = await outDoc.embedFont(StandardFontsRef.Helvetica);
  } catch {
    font = await outDoc.embedFont(StandardFontsRef.Helvetica);
  }
  const usedFallbackFont = !fontUrl;
  const black = rgbRef(0, 0, 0);
  const white = rgbRef(1, 1, 1);

  // C1: split translated text into paragraphs and distribute across pages by
  // ORIGINAL word share (identical to the previous inline implementation).
  const translatedParagraphs = mergedText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const totalWords = mergedText.split(/\s+/).filter(Boolean).length;
  let paraIdx = 0;
  const srcWordsPerPage = pageData.map((p) => {
    const text = p.text ?? (p.textItems || []).map((it) => it.str).join(" ");
    return Math.max(text.split(/\s+/).filter(Boolean).length, 1);
  });
  const totalSrcWords = Math.max(srcWordsPerPage.reduce((a, b) => a + b, 0), 1);

  const stats: RenderStats = {
    pagesUsingBlocks: 0, pagesFallback: 0, paragraphsMatchedPages: 0,
    minFontSize: 999, wordSpaceCompressions: 0,
  };

  for (let i = 0; i < srcPageCount; i++) {
    const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
    outDoc.addPage(copiedPage);
    const pageWidth = copiedPage.getWidth();
    const pageHeight = copiedPage.getHeight();

    const pageEntry = pageData.find((p) => p.num === i + 1);
    const textItems = pageEntry?.textItems || [];

    // White-out with per-item coordinates (preserves images/maps/illustrations)
    if (textItems.length > 0) {
      for (const item of textItems) {
        if (!item.str.trim()) continue;
        const w = Math.max(item.width + 2, 10);
        const h = Math.max(item.height + 2, 6);
        const y = pageHeight - item.y - item.height; // top-origin → bottom-origin
        copiedPage.drawRectangle({ x: item.x, y, width: w, height: h, color: white, borderWidth: 0 });
      }
    } else {
      const margin = 50;
      copiedPage.drawRectangle({
        x: margin - 5,
        y: margin + 10 - 5,
        width: pageWidth - 2 * margin + 10,
        height: pageHeight - 2 * margin - 20 + 10,
        color: white, borderWidth: 0,
      });
    }

    // C1: page paragraphs by original word share
    const share = (srcWordsPerPage[i] ?? 1) / totalSrcWords;
    const targetWords = Math.floor(share * totalWords);
    const pageParas: string[] = [];
    let pageParaWords = 0;
    while (
      paraIdx < translatedParagraphs.length &&
      (pageParaWords + translatedParagraphs[paraIdx].split(/\s+/).filter(Boolean).length <= targetWords ||
        i === srcPageCount - 1)
    ) {
      pageParas.push(translatedParagraphs[paraIdx]);
      pageParaWords += translatedParagraphs[paraIdx].split(/\s+/).filter(Boolean).length;
      paraIdx++;
      if (i < srcPageCount - 1 && pageParaWords >= targetWords) break;
    }
    const pageText = pageParas.join("\n\n");

    // C1/C2: block-based overlay (erase → auto-fit at block's own font size)
    const storedBlocks = pageEntry?.blocks;
    if (storedBlocks && storedBlocks.length > 0 && pageText.trim()) {
      const plan = planPageOverlay({
        textItems: [],
        storedBlocks,
        pageWidth, pageHeight,
        paragraphs: pageParas,
        font: font as unknown as { widthOfTextAtSize(t: string, s: number): number; heightAtSize(s: number): number },
        isRTL,
        useBidiShaping,
      });
      for (const op of plan.ops) {
        copiedPage.drawRectangle({
          x: op.erase.x, y: op.eraseYBottomOrigin,
          width: op.erase.width, height: op.erase.height,
          color: white, borderWidth: 0,
        });
        for (const line of op.lines) {
          try {
            copiedPage.drawText(line.text, {
              x: line.x, y: pageHeight - line.y, // top-origin baseline → bottom-origin
              size: line.size, font, color: black,
            });
          } catch { /* skip unencodable glyph lines */ }
        }
      }
      stats.pagesUsingBlocks++;
      if (plan.paragraphsMatched) stats.paragraphsMatchedPages++;
      if (plan.minFontSize > 0) stats.minFontSize = Math.min(stats.minFontSize, plan.minFontSize);
    } else if (textItems.length > 0 && pageText.trim()) {
      stats.pagesFallback++;
      // Legacy band fill (avg font, band width/height from stored coordinates)
      const avgFontSize = textItems.reduce((s, it) => s + (it.height || 10), 0) / textItems.length;
      const fontSize = Math.min(Math.max(avgFontSize, 7), 14);
      const lineHeight = fontSize * 1.35;
      const allYs = textItems.filter((it) => it.str.trim()).map((it) => it.y);
      const storedTopY = allYs.length ? Math.min(...allYs) : 50;
      const storedBottomY = allYs.length ? Math.max(...allYs) : pageHeight - 50;
      const topY = pageHeight - storedTopY;
      const bottomY = pageHeight - storedBottomY;
      const totalHeight = topY - bottomY;
      const maxLines = Math.max(1, Math.floor(totalHeight / lineHeight));
      const allXs = textItems.filter((it) => it.str.trim()).map((it) => it.x);
      const textLeft = allXs.length ? Math.max(0, Math.min(...allXs) - 4) : 40;
      const textRight = Math.max(...textItems.filter((it) => it.str.trim()).map((it) => it.x + it.width), textLeft + 100);
      const bandWidth = Math.min(pageWidth - 40 - textLeft, Math.max(textRight - textLeft, 200));
      const wrappedLines = wrapText(font, pageText, bandWidth, fontSize);
      const toVisualRTL = (l: string) => l.split(/\s+/).filter(Boolean).reverse().join(" ");
      for (let ln = 0; ln < Math.min(wrappedLines.length, maxLines); ln++) {
        const line = wrappedLines[ln];
        if (!line.trim()) continue;
        const y = topY - ln * lineHeight;
        if (y < bottomY) break;
        try {
          if (isRTL) {
            // C3: ar/ks use true bidi+shaped visual order; ur falls back to
            // word reversal (its Nastaliq font lacks presentation forms).
            const visual = useBidiShaping ? toVisualBidi(line) : toVisualRTL(line);
            const lineWidth = font.widthOfTextAtSize(visual, fontSize);
            copiedPage.drawText(visual, { x: textLeft + bandWidth - lineWidth, y, size: fontSize, font, color: black });
          } else {
            copiedPage.drawText(line, { x: textLeft, y, size: fontSize, font, color: black });
          }
        } catch { /* skip */ }
      }
    } else if (pageText.trim()) {
      // Fixed-margin fallback (no pageData)
      const margin = 50;
      const textLeft = margin;
      const maxWidth = pageWidth - 2 * margin;
      const fontSize = 10;
      const lineHeight = fontSize * 1.4;
      const textBottom = margin + 10;
      const wrappedLines = wrapText(font, pageText, maxWidth, fontSize);
      let baseline = pageHeight - margin - fontSize;
      for (const line of wrappedLines) {
        if (baseline - fontSize < textBottom) break;
        if (line.trim()) {
          try {
          if (isRTL) {
            const visual = useBidiShaping ? toVisualBidi(line) : line.split(/\s+/).filter(Boolean).reverse().join(" ");
              const lineWidth = font.widthOfTextAtSize(visual, fontSize);
              copiedPage.drawText(visual, { x: textLeft + maxWidth - lineWidth, y: baseline, size: fontSize, font, color: black });
            } else {
              copiedPage.drawText(line, { x: textLeft, y: baseline, size: fontSize, font, color: black });
            }
          } catch { /* skip */ }
        }
        baseline -= lineHeight;
      }
    }
  }

  const bytes = await outDoc.save();
  return { bytes, stats, usedFallbackFont };
}
