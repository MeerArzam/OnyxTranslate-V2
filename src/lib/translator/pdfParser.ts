import { PDFParse } from "pdf-parse";

export interface PDFParseResult {
  text: string;
  numPages: number;
  title: string | undefined;
  info: Record<string, unknown>;
  wordCount: number;
}

export interface PDFParseError {
  message: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "PARSE_FAILED" | "EMPTY_CONTENT";
}

/**
 * Parse a PDF file and extract its text content.
 * Uses pdf-parse v2 class-based API.
 */
export async function parsePDF(file: File): Promise<PDFParseResult> {
  // Validate file type
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw createError("INVALID_FORMAT", "The uploaded file is not a valid PDF. Please upload a .pdf file.");
  }

  // Validate file size (max 20MB)
  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    throw createError("FILE_TOO_LARGE", `File is too large (${formatSize(file.size)}). Maximum size is 20MB.`);
  }

  // Validate file size (min 1KB - empty PDFs are usually < 1KB)
  if (file.size < 1024) {
    throw createError("EMPTY_CONTENT", "The PDF file appears to be empty or too small to contain readable text.");
  }

  let parser: PDFParse | null = null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    parser = new PDFParse({ data });
    const textResult = await parser.getText();
    const infoResult = await parser.getInfo();

    const text = textResult.text?.trim() || "";

    if (!text || text.length < 10) {
      throw createError(
        "EMPTY_CONTENT",
        "The PDF does not contain readable text. It may be a scanned document or image-based PDF. Please upload a text-based PDF."
      );
    }

    const wordCount = text
      .split(/\s+/)
      .filter((w: string) => w.length > 0).length;

    return {
      text,
      numPages: infoResult.total || textResult.pages?.length || 0,
      title: infoResult.info?.Title as string | undefined,
      info: (infoResult.info as Record<string, unknown>) || {},
      wordCount,
    };
  } catch (error) {
    // Re-throw our own errors
    if (error && typeof error === "object" && "code" in error) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("encrypted") || message.includes("password")) {
      throw createError(
        "PARSE_FAILED",
        "This PDF is password-protected or encrypted. Please upload an unprotected PDF."
      );
    }
    throw createError(
      "PARSE_FAILED",
      `Failed to parse the PDF: ${message}`
    );
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Split large text into chunks suitable for translation processing.
 * Each chunk is approximately maxWords per chunk.
 */
export function splitTextIntoChunks(
  text: string,
  maxWords: number = 5000
): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += maxWords) {
    const chunkWords = words.slice(i, i + maxWords);

    // Try to break at a paragraph or sentence boundary
    let breakPoint = chunkWords.length;

    // Look for paragraph break near the end of the chunk
    const lastParagraphIdx = chunkWords.lastIndexOf("\n\n");
    if (lastParagraphIdx > chunkWords.length * 0.8) {
      breakPoint = lastParagraphIdx + 1;
    } else {
      // Look for sentence boundary
      for (let j = chunkWords.length - 1; j > chunkWords.length * 0.7; j--) {
        if ([".", "!", "?", "…"].some((p) => chunkWords[j].endsWith(p))) {
          breakPoint = j + 1;
          break;
        }
      }
    }

    const chunk = chunkWords.slice(0, breakPoint).join(" ");
    if (chunk.trim()) {
      chunks.push(chunk);
    }

    // If we broke early, adjust the iterator
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
      `Text contains ${wordCount.toLocaleString()} words. Consider processing in batches of 5,000 words for optimal results.`
    );
  }

  // Check for non-English characters (rough heuristic)
  const nonAsciiRatio =
    (text.match(/[^\x00-\x7F]/g)?.length || 0) / text.length;
  if (nonAsciiRatio > 0.1) {
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
