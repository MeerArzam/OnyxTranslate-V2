import type { PDFPageData, PDFTextItem } from "./pdfParser";
import { getPDFJS } from "./pdfParser";

// jsPDF is lazily imported inside generateTranslatedPDF() so it is NOT bundled
// into the initial page load — it only loads when the user clicks "Download
// PDF". pdf.js is loaded lazily too, via getPDFJS() from pdfParser (served
// from /public/vendor, outside the Vite module graph).

export interface PDFGenerationProgress {
  phase: "rendering" | "text-overlay" | "compiling";
  currentPage: number;
  totalPages: number;
  message: string;
}

type ProgressCallback = (progress: PDFGenerationProgress) => void;

const RENDER_SCALE = 1.5; // Balance of quality and speed

/**
 * Generate a translated PDF while preserving original images.
 *
 * Renders each original page to a canvas, whites-out the original text areas,
 * draws translated text on top, then embeds everything into a new PDF via jspdf.
 */
export async function generateTranslatedPDF(
  arrayBuffer: ArrayBuffer,
  pageData: PDFPageData[],
  originalTextByPage: string[],
  translatedText: string,
  languageCode: string,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const totalPages = pageData.length;

  // Lazy-load pdfjs-dist on first use
  const pdfjsLib = await getPDFJS();

  // Load the PDF document for re-rendering
  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    disableFontFace: true,
    useSystemFonts: true,
    disableRange: true,
    disableAutoFetch: true,
  });
  const pdf = await loadingTask.promise;

  // Split translated text into pages proportionally by original word count
  const originalWordCounts = originalTextByPage.map((t) => t.split(/\s+/).filter(Boolean).length);
  const totalOriginalWords = originalWordCounts.reduce((a, b) => a + b, 0);
  const translatedWords = translatedText.split(/\s+/).filter(Boolean);
  const totalTranslatedWords = translatedWords.length;

  // Build translated page texts
  const translatedPageTexts: string[] = [];
  let wordIdx = 0;
  for (let p = 0; p < totalPages; p++) {
    const ratio = originalWordCounts[p] / totalOriginalWords;
    const wordsForPage = Math.round(ratio * totalTranslatedWords);
    const endIdx = Math.min(wordIdx + wordsForPage, translatedWords.length);
    translatedPageTexts.push(translatedWords.slice(wordIdx, endIdx).join(" "));
    wordIdx = endIdx;
  }
  // Append any remaining words to last page
  if (wordIdx < translatedWords.length) {
    translatedPageTexts[totalPages - 1] += " " + translatedWords.slice(wordIdx).join(" ");
  }

  const isRTL = ["ar", "ur", "ks"].includes(languageCode);
  const isCJK = ["ja", "zh", "ko"].includes(languageCode);

  // Create the new PDF document
  const firstPage = await pdf.getPage(1);
  const firstViewport = firstPage.getViewport({ scale: RENDER_SCALE });
  // pdf.js viewport units at scale 1 are PDF points (1/72"), so dividing by the
  // render scale gives the true page size in points. (The old `* 72 / 96` factor
  // silently shrank every output page to 75% of its real physical size.)
  const pdfWidth = firstViewport.width / RENDER_SCALE;
  const pdfHeight = firstViewport.height / RENDER_SCALE;

  // Lazy-load jsPDF only when actually generating a PDF (not on page load)
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({
    orientation: pdfWidth > pdfHeight ? "landscape" : "portrait",
    unit: "pt",
    format: [pdfWidth, pdfHeight],
  });

  // Process each page
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageNum = pageIdx + 1;

    onProgress?.({
      phase: "rendering",
      currentPage: pageNum,
      totalPages,
      message: `Rendering page ${pageNum} of ${totalPages}`,
    });

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    // Render page to canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    // White background first
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render PDF page onto canvas
    await page.render({
      canvas: canvas,
      canvasContext: ctx,
      viewport,
    }).promise;

    // ---- White-out original text areas ----
    onProgress?.({
      phase: "text-overlay",
      currentPage: pageNum,
      totalPages,
      message: `Applying translation to page ${pageNum} of ${totalPages}`,
    });

    const rawPageItems = pageData[pageIdx]?.textItems || [];
    // Text item coordinates from the parser are in scale-1 PDF space, but the
    // canvas below is rendered at RENDER_SCALE. Scale the items once so the
    // white-out rectangles, text areas, and font sizing line up exactly with
    // the rendered page. (Without this, erasure and overlay were offset ~33%.)
    const pageItems: PDFTextItem[] = rawPageItems.map((i) => ({
      ...i,
      x: i.x * RENDER_SCALE,
      y: i.y * RENDER_SCALE,
      width: i.width * RENDER_SCALE,
      height: i.height * RENDER_SCALE,
    }));

    // Group text items into lines (items on same Y within tolerance)
    const Y_TOLERANCE = 4 * RENDER_SCALE;
    const lines: PDFTextItem[][] = [];
    for (const item of pageItems) {
      const itemY = Math.round(item.y / Y_TOLERANCE) * Y_TOLERANCE;
      let foundLine = false;
      for (const line of lines) {
        if (Math.abs(line[0].y - itemY) < Y_TOLERANCE) {
          line.push(item);
          foundLine = true;
          break;
        }
      }
      if (!foundLine) {
        lines.push([item]);
      }
    }

    // Sort lines top-to-bottom, items left-to-right
    lines.sort((a, b) => a[0].y - b[0].y);
    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
    }

    // White-out: add padding around text for clean erasure
    const TEXT_PAD = 2 * RENDER_SCALE;
    for (const line of lines) {
      // Find bounding box for the entire line
      const minX = Math.min(...line.map((item) => item.x)) - TEXT_PAD;
      const maxX = Math.max(...line.map((item) => item.x + item.width)) + TEXT_PAD;
      const minY = Math.min(...line.map((item) => item.y)) - TEXT_PAD;
      const maxY = Math.max(...line.map((item) => item.y + item.height)) + TEXT_PAD;

      const paintX = Math.max(0, minX);
      const paintY = Math.max(0, minY);
      const paintW = Math.min(canvas.width - paintX, maxX - minX);
      const paintH = Math.min(canvas.height - paintY, maxY - minY);

      if (paintW > 0 && paintH > 0) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(paintX, paintY, paintW, paintH);
      }
    }

    // ---- Draw translated text on the canvas ----
    const pageTranslatedText = translatedPageTexts[pageIdx] || "";

    if (pageTranslatedText.trim()) {
      // Determine font size from original text (average height of items)
      let avgFontSize = 11 * RENDER_SCALE;
      if (pageItems.length > 0) {
        const heights = pageItems.map((i) => i.height).filter((h) => h > 0 && h < 50 * RENDER_SCALE);
        if (heights.length > 0) {
          avgFontSize = heights.reduce((a, b) => a + b, 0) / heights.length;
        }
      }

      // Heights are now in canvas pixels (already scaled), so draw the
      // translated text at the same visual size as the original.
      const fontSize = Math.max(8, Math.min(28, avgFontSize));

      // Get the text bounding area from original items
      let textAreaTop = 0;
      let textAreaBottom = canvas.height;
      let textAreaLeft = 0;
      let textAreaRight = canvas.width;

      if (pageItems.length > 0) {
        textAreaTop = Math.max(0, Math.min(...pageItems.map((i) => i.y)) - 10 * RENDER_SCALE);
        textAreaBottom = Math.min(canvas.height, Math.max(...pageItems.map((i) => i.y + i.height)) + 10 * RENDER_SCALE);
        textAreaLeft = Math.max(0, Math.min(...pageItems.map((i) => i.x)) - 10 * RENDER_SCALE);
        textAreaRight = Math.min(canvas.width, Math.max(...pageItems.map((i) => i.x + i.width)) + 10 * RENDER_SCALE);
      }

      // Draw text
      const textWidth = textAreaRight - textAreaLeft;
      ctx.fillStyle = "#000000";
      ctx.textBaseline = "top";

      // Use appropriate font stack for the language
      const fontStack = getFontStack(languageCode, fontSize);
      ctx.font = fontStack;

      if (isRTL) {
        ctx.direction = "rtl";
        ctx.textAlign = "right";
      } else {
        ctx.direction = "ltr";
        ctx.textAlign = "left";
      }

      // Simple line-by-line text wrapping
      const linesToDraw = wrapText(ctx, pageTranslatedText, textWidth, fontSize, isRTL, isCJK);
      const lineHeight = fontSize * 1.4;
      let cursorY = textAreaTop;

      for (const line of linesToDraw) {
        if (cursorY + lineHeight > textAreaBottom) break;

        const drawX = isRTL ? textAreaRight : textAreaLeft;
        ctx.fillText(line, drawX, cursorY);
        cursorY += lineHeight;
      }
    }

    // ---- Convert canvas to JPEG and add to PDF ----
    onProgress?.({
      phase: "compiling",
      currentPage: pageNum,
      totalPages,
      message: `Compiling page ${pageNum} of ${totalPages}`,
    });

    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.85);

    if (pageIdx > 0) {
      doc.addPage();
    }

    // Add image at full page size
    doc.addImage(jpegDataUrl, "JPEG", 0, 0, pdfWidth, pdfHeight);
  }

  // Return as Blob
  return doc.output("blob");
}

/**
 * Get a font stack string suitable for the target language's script.
 */
function getFontStack(languageCode: string, size: number): string {
  // Map language codes to appropriate font stacks
  const fontMap: Record<string, string> = {
    ar: `"Noto Naskh Arabic", "Traditional Arabic", "Tahoma", "Arial", sans-serif`,
    ur: `"Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Arial", sans-serif`,
    ks: `"Noto Naskh Arabic", "Arial", sans-serif`,
    ja: `"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "MS Gothic", sans-serif`,
    zh: `"Noto Sans SC", "SimSun", "Microsoft YaHei", sans-serif`,
    ko: `"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`,
    hi: `"Noto Sans Devanagari", "Nirmala UI", "Mangal", sans-serif`,
    ne: `"Noto Sans Devanagari", "Nirmala UI", "Mangal", sans-serif`,
    bn: `"Noto Sans Bengali", "Nirmala UI", "Vrinda", sans-serif`,
    ru: `"Noto Sans", "Arial", sans-serif`,
  };

  const fontFace = fontMap[languageCode] || `"Noto Sans", "Arial", sans-serif`;
  return `${size}px ${fontFace}`;
}

/**
 * Simple word-wrap text into lines that fit within maxPixelWidth.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxPixelWidth: number,
  fontSize: number,
  isRTL: boolean,
  isCJK: boolean
): string[] {
  if (!text.trim()) return [""];

  const paragraphs = text.split("\n");
  const result: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      result.push("");
      continue;
    }

    const words = paragraph.split(/\s+/).filter(Boolean);
    let currentLine = "";
    // CJK glyphs are roughly square (fontSize wide); Latin scripts ~0.6em.
    const estimatedCharWidth = isCJK ? fontSize : fontSize * 0.6;
    const maxCharsPerLine = Math.max(1, Math.floor(maxPixelWidth / estimatedCharWidth));

    for (const word of words) {
      // Hard-break overlong tokens (common in CJK text, which has no spaces)
      // so they never overflow the text column.
      if (word.length > maxCharsPerLine) {
        if (currentLine) result.push(currentLine);
        currentLine = "";
        for (let k = 0; k < word.length; k += maxCharsPerLine) {
          result.push(word.slice(k, k + maxCharsPerLine));
        }
        continue;
      }
      const separator = currentLine ? " " : "";
      const testLine = isRTL ? word + separator + currentLine : currentLine + separator + word;

      if (testLine.length <= maxCharsPerLine) {
        currentLine = testLine;
      } else {
        if (currentLine) result.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) result.push(currentLine);
  }

  return result.length > 0 ? result : [""];
}

/**
 * Convert page data to per-page original text strings for the translator.
 */
export function extractPageTexts(pageData: PDFPageData[]): string[] {
  return pageData.map((p) => p.text);
}
