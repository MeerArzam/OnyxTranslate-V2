import { VENDOR_URLS, loadVendorModule } from "./vendor";

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
  y: number;
  width: number;
  height: number;
  fontName: string;
}

export interface PDFPageData {
  num: number;
  text: string;
  textItems: PDFTextItem[];
  pageWidth: number;
  pageHeight: number;
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
  arrayBuffer: ArrayBuffer;
}

export interface PDFParseError {
  message: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "PARSE_FAILED" | "EMPTY_CONTENT" | "ENCRYPTED";
}

type ProgressCallback = (currentPage: number, totalPages: number) => void;

// ──────────────────────────────────────────────
// Lazy pdf.js loader — served from /public/vendor and loaded via a runtime
// URL import. It is deliberately NOT part of the Vite module graph, so neither
// the dev-server's dependency optimizer nor `vite build` ever processes the
// ~1.3 MB library: the page opens and the build runs instantly.
// ──────────────────────────────────────────────

// Minimal structural types for the pdf.js API surface we use. The real package
// is loaded at runtime from /vendor, so no separate type package is needed.
export interface PDFDocumentProxyLike {
  numPages: number;
  getPage(pageNum: number): Promise<PDFPageLike>;
  getMetadata(): Promise<{ info?: Record<string, unknown> }>;
}

export interface PDFPageLike {
  getViewport(opts: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: Array<Record<string, unknown>> }>;
  render(opts: Record<string, unknown>): { promise: Promise<unknown> };
}

export interface PDFJSModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(
    params: Record<string, unknown>
  ): { promise: Promise<PDFDocumentProxyLike> };
}

let pdfjsPromise: Promise<PDFJSModule> | null = null;

/**
 * Load the pdf.js worker as a blob URL.
 *
 * pdf.js creates its worker via `new Worker(workerSrc, { type: "module" })` and,
 * if that fails, falls back to a "fake worker" that builds a blob module doing
 * `import(workerSrc)`. A server-relative path like "/vendor/pdf.worker.min.mjs"
 * fails in both cases (module resolution from a blob context). A blob: URL for
 * the worker sidesteps the server entirely and works in both paths.
 */
async function loadWorkerBlobUrl(): Promise<string> {
  const resp = await fetch(VENDOR_URLS.pdfjsWorker);
  if (!resp.ok) {
    throw new Error(`Failed to load pdf.js worker: ${resp.statusText}`);
  }
  return URL.createObjectURL(await resp.blob());
}

export async function getPDFJS(): Promise<PDFJSModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await loadVendorModule<PDFJSModule>(VENDOR_URLS.pdfjs);
      // Point the worker at a blob URL of the local /vendor copy — no CDN
      // dependency, and it matches the pdf.js version we vendored exactly.
      pdfjs.GlobalWorkerOptions.workerSrc = await loadWorkerBlobUrl();
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

// ──────────────────────────────────────────────
// Single page extraction
// ──────────────────────────────────────────────

async function extractPageData(
  pdf: PDFDocumentProxyLike,
  pageNum: number,
  renderScale: number
): Promise<PDFPageData> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;

  const textContent = await page.getTextContent();

  const rawItems = textContent.items.filter((item) => "str" in item) as Array<{
    str: string;
    transform?: number[];
    width?: number;
    height?: number;
    fontName?: string;
    hasEOL?: boolean;
  }>;

  const textItems: PDFTextItem[] = rawItems
    .filter((item) => item.str.trim().length > 0)
    .map((item) => {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const width = item.width || 0;
      const height = item.height || 0;
      const fontName = item.fontName || "";

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

  return { num: pageNum, text, textItems, pageWidth, pageHeight };
}

// ──────────────────────────────────────────────
// Incremental / Chunked PDF Parser
// ──────────────────────────────────────────────

export const PARSE_BATCH_SIZE = 3; // Pages per batch — keeps each batch fast (~5-10s)

export interface PDFHeader {
  pdf: PDFDocumentProxyLike;
  totalPages: number;
  title: string | undefined;
  info: Record<string, unknown>;
  arrayBuffer: ArrayBuffer;
}

/**
 * Open a PDF and return just the header (metadata + page count).
 * This is fast — no page processing.
 */
export async function parsePDFHeader(file: File): Promise<PDFHeader> {
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

  const rawBuffer = await file.arrayBuffer();
  // CRITICAL: Clone the ArrayBuffer before passing to pdfjs-dist.
  // pdfjs-dist v5 detaches/transfers the buffer internally during getDocument(),
  // which makes the original unusable for IndexedDB, PDF generation, and resume.
  const arrayBuffer = rawBuffer.slice(0);
  const pdfjsLib = await getPDFJS();

  const loadingTask = pdfjsLib.getDocument({
    data: rawBuffer,
    disableFontFace: true,
    disableRange: true,
    disableAutoFetch: true,
    useSystemFonts: false,
  });

  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

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

  return { pdf, totalPages, title, info, arrayBuffer };
}

/**
 * Parse a single batch of pages from an already-opened PDF.
 * Returns the page data for pages [startPage..endPage] (1-based).
 */
export async function parsePDFBatch(
  pdf: PDFDocumentProxyLike,
  startPage: number,
  endPage: number
): Promise<PDFPageData[]> {
  const renderScale = 1;
  const results: PDFPageData[] = [];

  // Process pages in this batch concurrently
  const pageNums: number[] = [];
  for (let i = startPage; i <= endPage; i++) {
    pageNums.push(i);
  }

  const batchResults = await Promise.all(
    pageNums.map((pageNum) => extractPageData(pdf, pageNum, renderScale))
  );

  for (const result of batchResults) {
    results.push(result);
  }

  return results;
}

/**
 * One-shot parse (kept for backwards compat and small PDFs).
 */
export async function parsePDF(
  file: File,
  onProgress?: ProgressCallback
): Promise<PDFParseResult> {
  const warnings: string[] = [];
  const { pdf, totalPages, title, info, arrayBuffer } = await parsePDFHeader(file);

  if (onProgress) {
    onProgress(0, totalPages);
  }

  const renderScale = 1;
  const pageData: PDFPageData[] = [];
  const pages: Array<{ num: number; text: string }> = [];

  for (let batchStart = 1; batchStart <= totalPages; batchStart += PARSE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + PARSE_BATCH_SIZE - 1, totalPages);
    const batchResults = await parsePDFBatch(pdf, batchStart, batchEnd);

    for (const result of batchResults) {
      pageData.push(result);
      pages.push({ num: result.num, text: result.text });
    }

    if (onProgress) {
      onProgress(batchEnd, totalPages);
    }
  }

  // Sort by page number
  pageData.sort((a, b) => a.num - b.num);
  pages.sort((a, b) => a.num - b.num);

  const fullText = pages
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();

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
