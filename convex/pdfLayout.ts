/**
 * convex/pdfLayout.ts — Pure PDF text-layout helpers (NO Convex imports).
 *
 * Used by:
 *   - convex/parsePdf.ts  (extraction: raw text items → clean lines → blocks)
 *   - convex/generatePdf.ts (rendering: cluster blocks from stored textItems
 *     when the project predates stored blocks)
 *   - scripts/testExtraction.ts (extraction self-test)
 *
 * Root cause this fixes: naive `.join(" ")` between pdf.js text items inserts
 * spaces INSIDE words ("OnyxStorm" → "Ony xStor m") because tightly-kerned
 * text arrives as many small per-glyph fragments. Word merging must be
 * GEOMETRY-based: measure the horizontal gap between consecutive items and
 * only insert a space when the gap is word-sized.
 */

export interface LayoutTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
}

export interface LayoutLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface LayoutBlock {
  text: string;
  x: number;
  /** Top edge of the block in the SAME convention as the input items. */
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lineCount: number;
  align: "left" | "center";
}

// ──────────────────────────────────────────────────────────
// Word merging: items → lines (x-gap based)
// ──────────────────────────────────────────────────────────

/**
 * Merge raw text items into clean visual lines.
 *
 * Rules between two consecutive items on the same line (sorted by x):
 *  - Explicit spaces in the strings themselves are preserved (deduped —
 *    never double-spaced).
 *  - gap = next.x − (current.x + current.width)
 *      gap < 0.3 × fontSize  → join with NO space (same word, kerned split)
 *      otherwise             → join with ONE space
 *  - Line-end hyphenation: "some-" + "thing" → "something"
 */
export function mergeItemsIntoLines(items: LayoutTextItem[]): LayoutLine[] {
  const usable = items.filter((it) => it.str && it.str.trim().length > 0);
  if (usable.length === 0) return [];

  // 1. Group into lines by baseline Y proximity (2px tolerance).
  const sorted = [...usable].sort((a, b) => b.y - a.y); // PDF bottom-origin: higher y = higher on page
  const groups: LayoutTextItem[][] = [];
  let current: LayoutTextItem[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const last = current[current.length - 1];
    if (Math.abs(item.y - last.y) <= 2) {
      current.push(item);
    } else {
      groups.push(current);
      current = [item];
    }
  }
  groups.push(current);

  // 2. Sort each line left-to-right and merge with gap logic.
  const lines: LayoutLine[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);

    let text = "";
    let maxX = 0;
    for (const item of group) {
      if (text === "") {
        text = item.str;
        maxX = item.x + item.width;
        continue;
      }
      const prev = text;
      const prevTrimEnd = prev.replace(/\s+$/, "");
      const hadTrailingSpace = prevTrimEnd.length < prev.length;
      const nextTrimStart = item.str.replace(/^\s+/, "");
      const hadLeadingSpace = nextTrimStart.length < item.str.length;

      let joiner = "";
      if (hadTrailingSpace || hadLeadingSpace) {
        // Explicit space — exactly one (dedupe).
        joiner = " ";
      } else {
        const fontSize = Math.max(item.height, 1) || 10;
        const gap = item.x - maxX;
        joiner = gap < 0.3 * fontSize ? "" : " ";
      }
      text = prevTrimEnd + joiner + nextTrimStart;
      maxX = Math.max(maxX, item.x + item.width);
    }

    // Collapse accidental double spaces, trim.
    text = text.replace(/ {2,}/g, " ").trim();
    if (!text) continue;

    const first = group[0];
    const lastItem = group[group.length - 1];
    const fontSize =
      group.reduce((s, it) => s + (it.height || 10), 0) / group.length;

    lines.push({
      text,
      x: first.x,
      y: Math.max(...group.map((it) => it.y)),
      width: Math.max(maxX - first.x, lastItem.x + lastItem.width - first.x),
      height: Math.max(...group.map((it) => it.height || 10)),
      fontSize,
    });
  }

  // 3. Line-end hyphenation: "some-" at line end + "thing" at next line
  //    start → "something" (only for lowercase continuation — headings that
  //    legitimately end with "-" and start a capitalized word are kept).
  const merged: LayoutLine[] = [];
  for (const line of lines) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      /[a-z]-$/.test(prev.text) &&
      /^[a-z]/.test(line.text)
    ) {
      prev.text = prev.text.replace(/-$/, "") + line.text;
      prev.width = Math.max(prev.width, line.x + line.width - prev.x);
      prev.fontSize = Math.max(prev.fontSize, line.fontSize);
      continue;
    }
    merged.push({ ...line });
  }

  return merged;
}

// ──────────────────────────────────────────────────────────
// Paragraph block clustering: lines → blocks
// ──────────────────────────────────────────────────────────

/**
 * Cluster consecutive lines into PARAGRAPH blocks.
 *
 * A block continues while:
 *  - left-x stays within ±2px,
 *  - the vertical gap to the previous line is ≤ 1.5× the document's modal
 *    line-gap (larger gaps are paragraph breaks),
 *  - font size stays within ~15% (headings break out),
 *  - center-x stays within ±3px when the block reads as centered.
 */
export function clusterIntoBlocks(lines: LayoutLine[]): LayoutBlock[] {
  if (lines.length === 0) return [];

  // Modal line gap (mode of positive consecutive diffs, bucketed to 2px —
  // falls back to median). Mode beats median on SPARSE pages (chapter
  // breaks, title pages) where section gaps outnumber line gaps.
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y; // bottom-origin: next line is lower
    if (gap > 0.5 && gap < 200) gaps.push(gap);
  }
  let lineGap = 0;
  if (gaps.length > 0) {
    const buckets = new Map<number, number[]>();
    for (const g of gaps) {
      const key = Math.round(g / 2);
      const arr = buckets.get(key) || [];
      arr.push(g);
      buckets.set(key, arr);
    }
    let best: number[] = [];
    for (const arr of buckets.values()) {
      if (arr.length > best.length || (arr.length === best.length && arr[0] < best[0])) best = arr;
    }
    lineGap = best.reduce((a, b) => a + b, 0) / best.length;
  }

  const blocks: LayoutBlock[] = [];
  let blockLines: LayoutLine[] = [];

  const flush = () => {
    if (blockLines.length === 0) return;
    const x = Math.min(...blockLines.map((l) => l.x));
    const right = Math.max(...blockLines.map((l) => l.x + l.width));
    const top = Math.max(...blockLines.map((l) => l.y)); // bottom-origin top edge
    const bottom = Math.min(...blockLines.map((l) => l.y - l.height));
    const fontSize = Math.max(...blockLines.map((l) => l.fontSize));

    // Centered detection: every line's center within 3px of the block center
    // AND the left margin noticeably indented relative to the widest line.
    const centerX =
      blockLines.reduce((s, l) => s + l.x + l.width / 2, 0) / blockLines.length;
    const centered =
      blockLines.length > 1 &&
      blockLines.every((l) => Math.abs(l.x + l.width / 2 - centerX) <= 3) &&
      x - (centerX - (right - x) / 2) > 4;

    blocks.push({
      text: blockLines.map((l) => l.text).join("\n"),
      x,
      y: top,
      width: Math.max(right - x, 1),
      height: Math.max(top - bottom, fontSize),
      fontSize,
      lineCount: blockLines.length,
      align: centered ? "center" : "left",
    });
    blockLines = [];
  };

  for (const line of lines) {
    if (blockLines.length === 0) {
      blockLines.push(line);
      continue;
    }
    const prev = blockLines[blockLines.length - 1];
    const verticalGap = prev.y - line.y; // bottom-origin
    const leftDelta = Math.abs(line.x - blockLines[0].x);
    const sizeDelta =
      Math.abs(line.fontSize - prev.fontSize) / Math.max(prev.fontSize, 1);

    const isBreak =
      (lineGap > 0 && verticalGap > 1.5 * lineGap) ||
      leftDelta > 2 ||
      sizeDelta > 0.15;

    if (isBreak) {
      flush();
    }
    blockLines.push(line);
  }
  flush();

  return blocks;
}

/**
 * Convenience: raw text items → ordered blocks (top of page first).
 * Input items are expected in PDF bottom-origin coordinates.
 */
export function itemsToBlocks(items: LayoutTextItem[]): LayoutBlock[] {
  const lines = mergeItemsIntoLines(items);
  const blocks = clusterIntoBlocks(lines);
  // Order top→bottom (bottom-origin: descending y)
  return blocks.sort((a, b) => b.y - a.y);
}
