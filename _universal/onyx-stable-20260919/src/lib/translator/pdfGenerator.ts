import type { PDFPageData } from "./pdfParser";
import {
  buildTranslatedPdfBytes,
  type RenderPageInput,
  type RenderProgress,
} from "./pdf-render";

/**
 * Translated-PDF generation.
 *
 * Heavy work (font loading, page copying, white-out, text overlay, PDF
 * serialization) runs inside a dedicated Web Worker (pdf-worker.ts) so the
 * UI never freezes. On browsers without module workers (Android 5 WebView)
 * it falls back to the main thread using the same render engine.
 */

export interface PDFGenerationProgress {
  phase: "rendering" | "compiling";
  currentPage: number;
  totalPages: number;
  message: string;
}

type ProgressCallback = (progress: PDFGenerationProgress) => void;

// ──────────────────────────────────────────────
// Worker management (created lazily, reused)
// ──────────────────────────────────────────────

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = new Promise<Worker>((resolve, reject) => {
      try {
        const worker = new Worker(
          new URL("./pdf-worker.ts", import.meta.url),
          { type: "module" }
        );
        worker.addEventListener(
          "error",
          (e) => {
            reject(new Error(e.message || "PDF worker failed to start."));
          },
          { once: true }
        );
        resolve(worker);
      } catch (err) {
        reject(err);
      }
    });
  }
  return workerPromise;
}

function runInWorker(
  worker: Worker,
  pdfBytes: ArrayBuffer,
  pages: RenderPageInput[],
  languageCode: string,
  onProgress: ProgressCallback
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data || {};
      if (data.type === "GENERATE_PROGRESS") {
        const p = data.payload as RenderProgress;
        onProgress({
          phase: "rendering",
          currentPage: p.currentPage,
          totalPages: p.totalPages,
          message: p.message,
        });
      } else if (data.type === "PDF_READY") {
        cleanup();
        resolve(data.payload as Uint8Array);
      } else if (data.type === "PDF_ERROR") {
        cleanup();
        reject(
          new Error(
            (data.payload?.message as string) || "PDF generation failed."
          )
        );
      }
    };

    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || "PDF worker crashed."));
    };

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    // Send a CLONE of the buffer so the caller's copy stays usable for
    // IndexedDB saves and later generations.
    const transferBuf = pdfBytes.slice(0);
    worker.postMessage(
      {
        type: "GENERATE_PDF",
        payload: { pdfBytes: transferBuf, pages, languageCode },
      },
      [transferBuf]
    );
  });
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Generate a translated PDF while preserving original images and layout.
 *
 * @param arrayBuffer      Original PDF bytes (never detached by this call).
 * @param pageData         Parsed page data (text items with positions).
 * @param originalTextByPage Per-page original text (for proportional split).
 * @param translatedText   Full translated text for the whole document.
 * @param languageCode     Target language code (drives font + RTL handling).
 */
export async function generateTranslatedPDF(
  arrayBuffer: ArrayBuffer,
  pageData: PDFPageData[],
  originalTextByPage: string[],
  translatedText: string,
  languageCode: string,
  onProgress?: ProgressCallback
): Promise<Blob> {
  const pages = buildPageInputs(
    pageData,
    originalTextByPage,
    translatedText
  );

  const report = (p: RenderProgress) => {
    onProgress?.({
      phase: "rendering",
      currentPage: p.currentPage,
      totalPages: p.totalPages,
      message: p.message,
    });
  };

  let bytes: Uint8Array;

  if (typeof Worker !== "undefined") {
    try {
      const worker = await getWorker();
      bytes = await runInWorker(
        worker,
        arrayBuffer,
        pages,
        languageCode,
        report
      );
    } catch (err) {
      // Worker unavailable/failed — run the same engine on the main thread.
      console.warn("PDF worker unavailable, using main thread:", err);
      bytes = await buildTranslatedPdfBytes(
        arrayBuffer.slice(0),
        pages,
        languageCode,
        report
      );
    }
  } else {
    bytes = await buildTranslatedPdfBytes(
      arrayBuffer.slice(0),
      pages,
      languageCode,
      report
    );
  }

  // pdf-lib returns a Uint8Array backed by a plain ArrayBuffer — re-wrapping
  // in a fresh Uint8Array satisfies TS's strict ArrayBufferLike typing.
  const buffer = new Uint8Array(bytes).buffer as ArrayBuffer;
  return new Blob([buffer], { type: "application/pdf" });
}

/**
 * Split the full translated text across pages proportionally to each page's
 * original word count, then build the per-page inputs for the render engine.
 */
function buildPageInputs(
  pageData: PDFPageData[],
  originalTextByPage: string[],
  translatedText: string
): RenderPageInput[] {
  const totalPages = pageData.length;

  const originalWordCounts = originalTextByPage.map(
    (t) => t.split(/\s+/).filter(Boolean).length
  );
  const totalOriginalWords =
    originalWordCounts.reduce((a, b) => a + b, 0) || 1;
  const translatedWords = translatedText.split(/\s+/).filter(Boolean);
  const totalTranslatedWords = translatedWords.length;

  const perPageTexts: string[] = [];
  let wordIdx = 0;
  for (let p = 0; p < totalPages; p++) {
    const wordsForPage = Math.round(
      (originalWordCounts[p] / totalOriginalWords) * totalTranslatedWords
    );
    const endIdx = Math.min(wordIdx + wordsForPage, totalTranslatedWords);
    perPageTexts.push(translatedWords.slice(wordIdx, endIdx).join(" "));
    wordIdx = endIdx;
  }
  // Append any remaining words to the last page.
  if (wordIdx < totalTranslatedWords && totalPages > 0) {
    perPageTexts[totalPages - 1] +=
      " " + translatedWords.slice(wordIdx).join(" ");
  }

  return pageData.map((pd, i) => ({
    pageWidth: pd.pageWidth,
    pageHeight: pd.pageHeight,
    textItems: (pd.textItems || []).map((it) => ({
      x: it.x,
      y: it.y,
      width: it.width,
      height: it.height,
    })),
    translatedText: perPageTexts[i] || "",
  }));
}

/** Convert page data to per-page original text strings (public API compat). */
export function extractPageTexts(pageData: PDFPageData[]): string[] {
  return pageData.map((p) => p.text);
}
