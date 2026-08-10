/**
 * Runtime-vendored libraries.
 *
 * pdf.js and transformers.js are heavy (multi-MB with CJS/ONNX internals).
 * Their prebuilt dist files live in /public/vendor and are loaded at runtime
 * via a URL `import()` (both are ES modules). Because nothing in `src/` imports
 * these packages from node_modules anymore, they are completely outside the
 * Vite module graph: the dev-server's dependency optimizer and `vite build`
 * never process them, so the preview boots and builds fast.
 */

export const VENDOR_URLS = {
  // pdf.js v5.4.296 — single-file ESM build (no internal imports).
  pdfjs: "/vendor/pdf.min.mjs",
  pdfjsWorker: "/vendor/pdf.worker.min.mjs",
  // transformers.js v2.17.2 — webpack ESM bundle (onnxruntime baked in).
  // The ONNX .wasm files are fetched from the jsdelivr CDN at runtime.
  transformers: "/vendor/transformers.min.js",
} as const;
