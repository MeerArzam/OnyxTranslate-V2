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

import * as pdfjsLib from "pdfjs-dist";

// Configure the PDF.js worker from CDN for reliable browser compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.296/pdf.worker.min.mjs`;

export interface PDFParseResult {
  text: string;
  numPages: number;
  title: string | undefined;
  info: Record<string, unknown>;
  wordCount: number;
  pages: Array<{ num: number; text: string }>;
  hasImages: boolean;
  extractedPages: number;
  warnings: string[];
}

export interface PDFParseError {
  message: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "PARSE_FAILED" | "EMPTY_CONTENT" | "ENCRYPTED";
}

type ProgressCallback = (currentPage: number, totalPages: number) => void;

// Maximum number of pages to extract in parallel
const PARALLEL_BATCH_SIZE = 10;

/**
 * Extract text from a single PDF page efficiently.
 */
async function extractPageText(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNum: number
): Promise<{ num: number; text: string }> {
  const page = await pdf.getPage(pageNum);
  const textContent = await page.getTextContent();

  // Build text efficiently using map/join (much faster than string concat in loops)
  const text = textContent.items
    .map((item, i, arr) => {
      if (!("str" in item)) return "";
      const str = item.str;
      // Add appropriate spacing based on positioning
      const nextItem = arr[i + 1];
      if (item.hasEOL || (nextItem && "str" in nextItem && nextItem.transform?.[4] !== item.transform?.[4])) {
        return str + "\n";
      }
      return str + (str.endsWith("-") ? "" : " ");
    })
    .join("")
    .trim();

  return { num: pageNum, text };
}

/**
 * Parse a PDF file and extract its text content with maximum speed.
 * Uses parallel page extraction and performance-optimized PDF.js settings.
 */
export async function parsePDF(
  file: File,
  onProgress?: ProgressCallback
): Promise<PDFParseResult> {
  const warnings: string[] = [];

  // Fast validation checks
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
    // Read file as ArrayBuffer once
    const arrayBuffer = await file.arrayBuffer();

    // Load PDF with performance-optimized settings
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      disableFontFace: true,          // Skip font downloads (we only need text)
      disableRange: true,             // Disable range requests (faster for local files)
      disableAutoFetch: true,         // Don't pre-fetch remaining pages
      useSystemFonts: false,          // Don't use system fonts (we only need text)
    });

    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    // Extract pages in parallel batches for maximum speed
    const pages: Array<{ num: number; text: string }> = [];

    for (let batchStart = 1; batchStart <= totalPages; batchStart += PARALLEL_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + PARALLEL_BATCH_SIZE - 1, totalPages);
      const batchPageNums: number[] = [];

      for (let i = batchStart; i <= batchEnd; i++) {
        batchPageNums.push(i);
      }

      // Extract pages in parallel within each batch
      const batchResults = await Promise.all(
        batchPageNums.map((pageNum) => extractPageText(pdf, pageNum))
      );

      pages.push(...batchResults);

      // Report progress after each batch
      if (onProgress) {
        onProgress(batchEnd, totalPages);
      }
    }

    // Build full text from pages (fast join)
    const fullText = pages
      .map((p) => p.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();

    // Get metadata in parallel (fire-and-forget, not blocking)
    let title: string | undefined;
    let info: Record<string, unknown> = {};
    try {
      const metadata = await pdf.getMetadata();
      if (metadata.info) {
        info = metadata.info as Record<string, unknown>;
        title = (metadata.info as Record<string, unknown>)?.Title as string | undefined;
      }
    } catch {
      // Metadata failure is non-critical
    }

    // Quick checks
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
      hasImages: pagesWithText < totalPages * 0.5,
      extractedPages: pagesWithText,
      warnings,
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

/**
 * Split large text into chunks suitable for translation processing.
 * Uses fast word-boundary splitting.
 */
export function splitTextIntoChunks(
  text: string,
  maxWords: number = 5000
): string[] {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    let end = Math.min(start + maxWords, words.length);

    // Try to break at paragraph or sentence boundary
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

/**
 * Fast validation that text is suitable for translation
 */
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
    warnings.push(
      `Text contains ${wordCount.toLocaleString()} words. It will be processed in batches of 5,000 words.`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function createError(
  code: PDFParseError["code"],
  message: string
): PDFParseError {
  const error = new Error(message) as PDFParseError & Error;
  error.code = code;
  return error;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}