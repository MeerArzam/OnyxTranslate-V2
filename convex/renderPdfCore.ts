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
 *   C3. RTL — Arabic/Urdu/Kashmiri lines are rendered right-aligned with
 *       WORD-ORDER reversal only (never per-character, which would corrupt
 *       contextual shaping/ligatures).
 */

import { itemsToBlocks, type LayoutTextItem } from "./pdfLayout";

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
    const visual = isRTL ? reverseWords(line) : line;
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
}): PageOverlayPlan {
  const { textItems, storedBlocks, pageHeight, paragraphs, font, isRTL } = opts;

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
    const op = fitBlockText(font, text, blocks[i], isRTL);
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
