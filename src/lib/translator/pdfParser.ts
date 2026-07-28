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

/**
 * Parse a PDF file and extract its text content.
 * Handles mixed image/text PDFs, large files, and encrypted PDFs gracefully.
 */
export async function parsePDF(file: File): Promise<PDFParseResult> {
  const warnings: string[] = [];

  // Validate file type
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw createError("INVALID_FORMAT", "The uploaded file is not a valid PDF. Please upload a .pdf file.");
  }

  // Validate file size (max 50MB)
  const maxSize = 50 * 1024 * 1024;
  if (file.size > maxSize) {
    throw createError("FILE_TOO_LARGE", `File is too large (${formatSize(file.size)}). Maximum size is 50MB.`);
  }

  // Validate file size (min 500 bytes)
  if (file.size < 500) {
    throw createError("EMPTY_CONTENT", "The PDF file appears to be empty or too small to contain readable text.");
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const totalPages = pdf.numPages;
    const pages: Array<{ num: number; text: string }> = [];
    let fullText = "";

    // Extract text from each page
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Build page text from text items
      let pageText = "";
      for (const item of textContent.items) {
        if ("str" in item) {
          pageText += item.str;
          // Add space between items if needed
          if (item.hasEOL) {
            pageText += "\n";
          } else if (textContent.items.indexOf(item) < textContent.items.length - 1) {
            pageText += " ";
          }
        }
      }
      
      const trimmedText = pageText.trim();
      pages.push({ num: i, text: trimmedText });
      
      if (trimmedText) {
        fullText += trimmedText + "\n\n";
      }
    }

    // Also try to get metadata
    let title: string | undefined;
    let info: Record<string, unknown> = {};
    try {
      const metadata = await pdf.getMetadata();
      if (metadata.info) {
        info = metadata.info as Record<string, unknown>;
        title = (metadata.info as Record<string, unknown>)?.Title as string | undefined;
      }
    } catch {
      warnings.push("Could not read PDF metadata.");
    }

    fullText = fullText.trim();

    // Check if PDF is mostly images (very little text extracted)
    const pagesWithText = pages.filter(p => p.text.length > 10).length;

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
        `This PDF may contain images, scans, or DRM-protected content. ` +
        `The translation will cover the extractable text portions.`
      );
    }

    const wordCount = fullText
      .split(/\s+/)
      .filter((w: string) => w.length > 0).length;

    if (wordCount < 50) {
      warnings.push(
        `Only ${wordCount} words were extracted. The PDF may be image-heavy or have limited text content.`
      );
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
    // Re-throw our own errors
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("encrypted") || message.includes("password") || message.includes("Unsupported")) {
      throw createError(
        "ENCRYPTED",
        "This PDF is password-protected, encrypted, or uses an unsupported format. " +
        "Please upload an unprotected, standard PDF file."
      );
    }

    // For any other error, provide a helpful message with fallback suggestion
    throw createError(
      "PARSE_FAILED",
      `Could not parse the PDF: ${message}. ` +
      `You can also paste the text content directly into the text area above.`
    );
  }
}

/**
 * Split large text into chunks suitable for translation processing.
 * Each chunk is approximately maxWords per chunk, breaking at natural boundaries.
 */
export function splitTextIntoChunks(
  text: string,
  maxWords: number = 5000
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += maxWords) {
    const chunkWords = words.slice(i, i + maxWords);
    let breakPoint = chunkWords.length;

    // Look for paragraph break near the end of the chunk
    const lastParagraphIdx = chunkWords.lastIndexOf("\n\n");
    if (lastParagraphIdx > chunkWords.length * 0.8) {
      breakPoint = lastParagraphIdx + 1;
    } else {
      // Look for sentence boundary
      for (let j = chunkWords.length - 1; j > chunkWords.length * 0.7; j--) {
        if ([".", "!", "?", "\u2026"].some((p) => chunkWords[j].endsWith(p))) {
          breakPoint = j + 1;
          break;
        }
      }
    }

    const chunk = chunkWords.slice(0, breakPoint).join(" ");
    if (chunk.trim()) {
      chunks.push(chunk);
    }

    // Adjust iterator for early breaks
    if (breakPoint < chunkWords.length) {
      i -= chunkWords.length - breakPoint;
    }
  }

  return chunks;
}

/**
 * Validate that text is suitable for translation
 */
export function validateTextForTranslation(text: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const wordCount = text.split(/\s+/).filter((w: string) => w.length > 0).length;

  if (wordCount < 10) {
    errors.push("Text is too short for translation (minimum 10 words).");
  }

  if (wordCount > 5000) {
    warnings.push(
      `Text contains ${wordCount.toLocaleString()} words. It will be processed in batches of 5,000 words for optimal results.`
    );
  }

  // Check for non-English characters (rough heuristic)
  const nonAsciiChars = (text.match(/[^\x00-\x7F]/g)?.length || 0);
  const nonAsciiRatio = nonAsciiChars / Math.max(text.length, 1);
  if (nonAsciiRatio > 0.15) {
    warnings.push(
      "The text appears to contain significant non-English content. This tool is designed for English source text."
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
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