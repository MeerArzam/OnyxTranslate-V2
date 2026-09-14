/**
 * PDF generation Web Worker.
 *
 * Runs ALL heavy PDF work (font download/embed, page copying, white-out,
 * text overlay, PDF serialization) off the main thread so the UI never
 * freezes during generation. Created lazily by pdfGenerator.ts only when the
 * user clicks "Download (language) PDF" or "Download All ZIP".
 */
import {
  buildTranslatedPdfBytes,
  type RenderPageInput,
  type RenderProgress,
} from "./pdf-render";

// `self` inside a dedicated worker. Cast because the app's tsconfig uses the
// DOM lib (where `self` is Window-typed).
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

ctx.onmessage = async (e: MessageEvent) => {
  const data = e.data || {};
  if (data.type !== "GENERATE_PDF") return;

  const payload = data.payload || {};
  const pdfBytes = payload.pdfBytes as ArrayBuffer;
  const pages = payload.pages as RenderPageInput[];
  const languageCode = payload.languageCode as string;

  try {
    const report = (progress: RenderProgress) => {
      ctx.postMessage({ type: "GENERATE_PROGRESS", payload: progress });
    };

    const result = await buildTranslatedPdfBytes(
      pdfBytes,
      pages,
      languageCode,
      report
    );

    // Transfer the result buffer back — zero-copy.
    ctx.postMessage({ type: "PDF_READY", payload: result }, [result.buffer]);
  } catch (error) {
    ctx.postMessage({
      type: "PDF_ERROR",
      payload: {
        message:
          error instanceof Error ? error.message : String(error),
      },
    });
  }
};
