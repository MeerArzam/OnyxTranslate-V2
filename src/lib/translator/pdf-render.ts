/**
 * PDF rendering engine — shared by the Web Worker (pdf-worker.ts) and the
 * main-thread fallback (pdfGenerator.ts when Worker is unavailable).
 *
 * Why this is fast:
 *  - The ORIGINAL page is copied into the output PDF as-is via pdf-lib
 *    `copyPages` — vector art, maps and images are preserved without ever
 *    rasterizing to a canvas/JPEG (the old path rendered every page to a
 *    canvas at 1.5x and took 2-5 s/page).
 *  - White rectangles are painted over the original text boxes (using the
 *    positions captured by the text parser), then the translated text is
 *    drawn on top with an embedded Unicode font.
 *  - The Unicode font is downloaded + embedded ONCE per PDF, never per page.
 *
 * pdf-lib is dynamically imported so it lands in a lazy chunk (never in the
 * initial page load). fontkit + regenerator-runtime are required to embed
 * custom Unicode fonts (and for Indic script shaping inside fontkit).
 */
import "regenerator-runtime/runtime.js";
import reshaper from "arabic-reshaper";
import type { PDFFont } from "pdf-lib";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface RenderTextItem {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderPageInput {
  pageWidth: number;
  pageHeight: number;
  /** Text boxes detected by the parser (top-origin coordinates, PDF points). */
  textItems: RenderTextItem[];
  /** Translated text for this page. */
  translatedText: string;
}

export interface RenderProgress {
  currentPage: number;
  totalPages: number;
  message: string;
}

// ──────────────────────────────────────────────
// Fonts
// ──────────────────────────────────────────────

/** Languages whose scripts need an embedded Unicode font (Helvetica only
 * covers WinAnsi/Latin-1 — it cannot encode Arabic, Devanagari, CJK, Cyrillic
 * or Turkish/Romanian extended Latin). */
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

/** Languages written right-to-left (Arabic script). */
const RTL_CODES = ["ar", "ur", "ks"];

const fontCache = new Map<string, ArrayBuffer>();

async function getFontBytes(url: string): Promise<ArrayBuffer> {
  const cached = fontCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Font download failed (HTTP ${resp.status})`);
  }
  const bytes = await resp.arrayBuffer();
  fontCache.set(url, bytes);
  return bytes;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Wrap text into lines that fit `maxWidth` using the font's real metrics.
 * Works for all scripts (CJK glyphs are measured per-character too).
 */
function wrapText(
  font: PDFFont,
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
      // Hard-break overlong tokens (common in CJK text, which has no spaces).
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

// ──────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────

/**
 * Generate a translated PDF from an original PDF + parsed text positions.
 *
 * @param pdfBytes Original PDF bytes (a clone — not detached here).
 * @param pages    Per-page inputs (text boxes + translated text).
 * @param languageCode Target language (drives font + RTL handling).
 */
export async function buildTranslatedPdfBytes(
  pdfBytes: ArrayBuffer,
  pages: RenderPageInput[],
  languageCode: string,
  onProgress?: (progress: RenderProgress) => void
): Promise<Uint8Array> {
  // pdf-lib is lazy-loaded so it lives in a separate chunk that is only
  // fetched when the user actually generates a PDF.
  const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
  const fontkitModule = await import("@pdf-lib/fontkit");
  const fontkit = (fontkitModule as { default?: unknown }).default ?? fontkitModule;

  const totalPages = pages.length;
  if (totalPages === 0) {
    throw new Error("No pages to render.");
  }

  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const srcPageCount = srcDoc.getPageCount();
  if (srcPageCount === 0) {
    throw new Error("Source PDF contains no pages.");
  }

  const outDoc = await PDFDocument.create();
  outDoc.registerFontkit(fontkit as never);

  // ── Font (embedded once per PDF) ──
  const isRTL = RTL_CODES.includes(languageCode);
  const fontUrl = FONT_URLS[languageCode];
  let font: PDFFont;
  let fontWarning: string | null = null;
  try {
    if (fontUrl) {
      onProgress?.({
        currentPage: 0,
        totalPages,
        message: `Preparing ${languageCode} font…`,
      });
      font = await outDoc.embedFont(await getFontBytes(fontUrl));
    } else {
      font = await outDoc.embedFont(StandardFonts.Helvetica);
    }
  } catch (err) {
    // Degrade gracefully: white-out still applies, Latin chars still render.
    fontWarning = `Font for ${languageCode} failed to load (${
      err instanceof Error ? err.message : String(err)
    }). Some characters may not render.`;
    font = await outDoc.embedFont(StandardFonts.Helvetica);
  }

  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const pad = 2; // white-out padding around each text line

  let failedPages = 0;
  const processed = Math.min(totalPages, srcPageCount);

  for (let i = 0; i < processed; i++) {
    const input = pages[i];
    const pageNum = i + 1;

    try {
      // copyPages only COPIES the page — addPage() appends it to the doc.
      const [copiedPage] = await outDoc.copyPages(srcDoc, [i]);
      outDoc.addPage(copiedPage);
      const newPage = copiedPage;
      const W = input?.pageWidth || newPage.getWidth();
      const H = input?.pageHeight || newPage.getHeight();

      const items = (input?.textItems || []).filter(
        (it) => it && it.width > 0 && it.height > 0
      );

      // ── White-out original text lines ──
      if (items.length > 0) {
        // Group items into lines (same-Y tolerance), like the old canvas path.
        const Y_TOLERANCE = 4;
        const lines: RenderTextItem[][] = [];
        for (const item of items) {
          const bucketY = Math.round(item.y / Y_TOLERANCE) * Y_TOLERANCE;
          let found = false;
          for (const line of lines) {
            if (Math.abs(line[0].y - bucketY) < Y_TOLERANCE) {
              line.push(item);
              found = true;
              break;
            }
          }
          if (!found) lines.push([item]);
        }
        lines.sort((a, b) => a[0].y - b[0].y);
        for (const line of lines) line.sort((a, b) => a.x - b.x);

        for (const line of lines) {
          const minX = Math.min(...line.map((it) => it.x)) - pad;
          const maxX = Math.max(...line.map((it) => it.x + it.width)) + pad;
          const topY = Math.min(...line.map((it) => it.y)) - pad; // top-origin
          const bottomY = Math.max(...line.map((it) => it.y + it.height)) + pad;

          // Convert top-origin y to pdf-lib bottom-origin.
          const rectX = clamp(minX, 0, W);
          const rectBottom = clamp(H - bottomY, 0, H);
          const rectW = clamp(maxX - minX, 0, W - rectX);
          const rectH = clamp(bottomY - topY, 0, H - rectBottom);
          if (rectW > 0 && rectH > 0) {
            newPage.drawRectangle({
              x: rectX,
              y: rectBottom,
              width: rectW,
              height: rectH,
              color: white,
            });
          }
        }
      }

      // ── Overlay translated text ──
      const translated = input?.translatedText || "";
      if (translated.trim() && items.length > 0) {
        // Font size from the original text height (parser scale = 1).
        const heights = items
          .map((it) => it.height)
          .filter((h) => h > 0 && h < 30);
        const avgHeight =
          heights.length > 0
            ? heights.reduce((a, b) => a + b, 0) / heights.length
            : 10;
        const fontSize = clamp(avgHeight, 7, 24);
        const lineHeight = fontSize * 1.35;

        // Text column = bounding box of all original text + margin.
        const areaLeft = clamp(Math.min(...items.map((it) => it.x)) - 10, 0, W);
        const areaRight = clamp(
          Math.max(...items.map((it) => it.x + it.width)) + 10,
          0,
          W
        );
        const areaTop = clamp(Math.min(...items.map((it) => it.y)) - 10, 0, H);
        const areaBottom = clamp(
          Math.max(...items.map((it) => it.y + it.height)) + 10,
          0,
          H
        );
        const maxWidth = Math.max(40, areaRight - areaLeft);

        const wrappedLines = wrapText(font, translated, maxWidth, fontSize);

        // Bottom-origin cursor, starting at the top of the text column.
        let baseline = (H - areaTop) - fontSize * 0.85;
        const areaBottomLib = H - areaBottom;

        for (const line of wrappedLines) {
          if (baseline - fontSize < areaBottomLib) break; // stop at bottom

          if (line.trim()) {
            try {
              if (isRTL) {
                // Shape Arabic script into presentation forms, then reverse so
                // it reads correctly when drawn left-to-right by pdf-lib.
                const shaped = reshaper.convertArabic(line);
                const visual = [...shaped].reverse().join("");
                const lineWidth = font.widthOfTextAtSize(visual, fontSize);
                newPage.drawText(visual, {
                  x: areaRight - lineWidth,
                  y: baseline,
                  size: fontSize,
                  font,
                  color: black,
                });
              } else {
                newPage.drawText(line, {
                  x: areaLeft,
                  y: baseline,
                  size: fontSize,
                  font,
                  color: black,
                });
              }
            } catch {
              // Line contains glyphs the current font can't encode — skip it
              // rather than aborting the whole PDF.
            }
          }
          baseline -= lineHeight;
        }
      }

      onProgress?.({
        currentPage: pageNum,
        totalPages: processed,
        message: `Processing page ${pageNum} of ${processed}`,
      });
    } catch (err) {
      failedPages++;
      console.error(`PDF render: failed on page ${pageNum}`, err);
    }

    // Yield to the event loop every 10 pages (keeps the UI responsive in the
    // main-thread fallback and lets the worker drain its message queue).
    if (pageNum % 10 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (failedPages === processed) {
    throw new Error(
      `Could not render any pages${fontWarning ? ` (${fontWarning})` : ""}.`
    );
  }

  onProgress?.({
    currentPage: processed,
    totalPages: processed,
    message: "Compiling PDF…",
  });

  const bytes = await outDoc.save();
  return bytes;
}
