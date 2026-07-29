// Polyfill Promise.withResolvers for browsers that don't support it yet (ES2024)
if (typeof (Promise as unknown as Record<string, unknown>).withResolvers === "undefined") {
  (Promise as unknown as Record<string, (...args: unknown[]) => unknown>).withResolvers = function <T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// pdfjs-dist is imported dynamically only when needed (when user uploads a PDF)
// This avoids bundling its ~25MB into the initial page load, making the tool open instantly.

export interface PDFTextItem {
  str: string;
  x: number;
  y: number;       // Canvas Y coordinate (top-left origin)
  width: number;    // Width in canvas pixels
  height: number;   // Height in canvas pixels
  fontName: string;
}

export interface PDFPageData {
  num: number;
  text: string;
  textItems: PDFTextItem[];
  pageWidth: number;   // Canvas pixel width at scale 1
  pageHeight: number;  // Canvas pixel height at scale 1
}

export interface PDFParseResult {
  text: string;
  numPages: number;
  title: string | undefined;
  info: Record<string, unknown>;
  wordCount: number;
  pages: Array<{ num: number; text: string }>;
  pageData: PDFPageData[];
  hasImages: boolean;
  extractedPages: number;
  warnings: string[];
  /** Original PDF ArrayBuffer for re-rendering pages to canvas */
  arrayBuffer: ArrayBuffer;
}

export interface PDFParseError {
  message: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "PARSE_FAILED" | "EMPTY_CONTENT" | "ENCRYPTED";
}

type ProgressCallback = (currentPage: number, totalPages: number) => void;

const PARALLEL_BATCH_SIZE = 10;

type PDFJS = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PDFJS> | null = null;

/** Lazy-load pdfjs-dist only when first needed */
async function getPDFJS(): Promise<PDFJS> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      const pdfjs = mod as unknown as PDFJS;
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.296/pdf.worker.min.mjs`;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Extract text items with positions from a single PDF page.
 */
async function extractPageData(
  pdf: import("pdfjs-dist").PDFDocumentProxy,
  pageNum: number,
  renderScale: number
): Promise<PDFPageData> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const textContent = await page.getTextContent();

  // Extract text items with canvas pixel positions
  const rawItems = textContent.items.filter((item) => "str" in item) as Array<{ str: string; transform?: number[]; width?: number; height?: number; fontName?: string; hasEOL?: boolean }>;

  const textItems: PDFTextItem[] = rawItems
    .filter((item) => item.str.trim().length > 0)
    .map((item) => {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const width = item.width || 0;
      const height = item.height || 0;
      const fontName = item.fontName || "";

      // PDF coordinates: (transform[4], transform[5]) with bottom-left origin
      // Convert to canvas coordinates (top-left origin)
      const pdfX = transform[4];
      const pdfY = transform[5];
      const canvasX = pdfX * renderScale;
      const canvasY = (pageHeight - pdfY) * renderScale;

      return {
        str: item.str,
        x: canvasX,
        y: canvasY,
        width: width * renderScale,
        height: height * renderScale,
        fontName,
      };
    });

  // Build plain text from items
  const text = rawItems
    .map((item, i, arr) => {
      const str = item.str;
      const nextItem = arr[i + 1];
      if (item.hasEOL || (nextItem && nextItem.transform?.[5] !== item.transform?.[5])) {
        return str + "\n";
      }
      return str + (str.endsWith("-") ? "" : " ");
    })
    .join("")
    .trim();

  return {
    num: pageNum,
    text,
    textItems,
    pageWidth,
    pageHeight,
  };
}

/**
 * Parse a PDF file and extract text content with position data.
 * Stores the original ArrayBuffer for later page rendering.
 */
export async function parsePDF(
  file: File,
  onProgress?: ProgressCallback
): Promise<PDFParseResult> {
  const warnings: string[] = [];

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw createError("INVALID_FORMAT", "The uploaded file is not a valid PDF.");
  }

  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    throw createError("FILE_TOO_LARGE", `File is too large (${formatSize(file.size)}). Maximum size is 50MB.`);
  }

  if (file.size < 500) {
    throw createError("EMPTY_CONTENT", "The PDF file appears to be empty.");
  }

  try {
    const arrayBuffer = await file.arrayBuffer();

    const pdfjsLib = await getPDFJS();

    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      disableFontFace: true,
      disableRange: true,
      disableAutoFetch: true,
      useSystemFonts: false,
    });

    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    // We'll render at 1x for text extraction (positions), 2x for final PDF image
    const renderScale = 1;

    const pageData: PDFPageData[] = [];
    const pages: Array<{ num: number; text: string }> = [];

    for (let batchStart = 1; batchStart <= totalPages; batchStart += PARALLEL_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE - 1, totalPages);
      const batchPageNums: number[] = [];
      for (let i = batchStart; i <= batchEnd; i++) {
        batchPageNums.push(i);
      }

      const batchResults = await Promise.all(
        batchPageNums.map((pageNum) => extractPageData(pdf, pageNum, renderScale))
      );

      for (const result of batchResults) {
        pageData.push(result);
        pages.push({ num: result.num, text: result.text });
      }

      if (onProgress) {
        onProgress(batchEnd, totalPages);
      }
    }

    const fullText = pages
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();

    let title: string | undefined;
    let info: Record<string, unknown> = {};
    try {
      const metadata = await pdf.getMetadata();
      if (metadata.info) {
        info = metadata.info as Record<string, unknown>;
        title = (metadata.info as Record<string, unknown>)?.Title as string | undefined;
      }
    } catch {
      // Non-critical
    }

    const pagesWithText = pages.filter((p) => p.text.length > 10).length;

    if (fullText.length < 10) {
      throw createError(
        "EMPTY_CONTENT",
        "The PDF does not contain extractable text. It may be a scanned/image-based PDF. " +
        "Please upload a text-based PDF, or paste the text content directly."
      );
    }

    if (pagesWithText < totalPages * 0.3 && totalPages > 5) {
      warnings.push(
        `Only ${pagesWithText} of ${totalPages} pages contain extractable text. ` +
        `This PDF may contain images, scans, or DRM-protected content.`
      );
    }

    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    if (wordCount < 50) {
      warnings.push(`Only ${wordCount} words were extracted. The PDF may be image-heavy.`);
    }

    return {
      text: fullText,
      numPages: totalPages,
      title,
      info,
      wordCount,
      pages,
      pageData,
      hasImages: pagesWithText < totalPages * 0.5,
      extractedPages: pagesWithText,
      warnings,
      arrayBuffer,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("encrypted") || message.includes("password") || message.includes("Unsupported")) {
      throw createError(
        "ENCRYPTED",
        "This PDF is password-protected or encrypted. Please upload an unprotected PDF."
      );
    }

    throw createError(
      "PARSE_FAILED",
      `Could not parse the PDF: ${message}. ` +
      `You can also paste the text content directly into the text area above.`
    );
  }
}

export function splitTextIntoChunks(text: string, maxWords: number = 5000): string[] {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(start + maxWords, words.length);
    if (end < words.length) {
      const segment = words.slice(start, end);
      const paraBreak = segment.lastIndexOf("\n\n");
      if (paraBreak > segment.length * 0.8) {
        end = start + paraBreak + 1;
      } else {
        for (let j = end - 1; j > start + maxWords * 0.7; j--) {
          if (/[.!?…]$/.test(words[j])) {
            end = j + 1;
            break;
          }
        }
      }
    }
    chunks.push(words.slice(start, end).join(" "));
    start = end;
  }
  return chunks;
}

export function validateTextForTranslation(text: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (wordCount < 10) {
    errors.push("Text is too short for translation (minimum 10 words).");
  }
  if (wordCount > 5000) {
    warnings.push(`Text contains ${wordCount.toLocaleString()} words. It will be processed in batches of 5,000 words.`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

function createError(code: PDFParseError["code"], message: string): PDFParseError {
  const error = new Error(message) as PDFParseError & Error;
  error.code = code;
  return error;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
