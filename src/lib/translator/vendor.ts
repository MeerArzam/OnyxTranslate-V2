/**
 * Runtime-vendored libraries.
 *
 * pdf.js and transformers.js are heavy (multi-MB with CJS/ONNX internals).
 * Their prebuilt dist files live in /public/vendor and are loaded at runtime
 * via fetch + blob URL import. This avoids two problems:
 *   1. The browser's ESM loader appends `?import` to dynamic imports, which
 *      can confuse some static-file servers.
 *   2. It keeps the files completely outside the Vite module graph so the
 *      dev-server's optimizer and `vite build` never process them.
 */

export const VENDOR_URLS = {
  // pdf.js v5.4.296 — single-file ESM build (no internal imports).
  pdfjs: "/vendor/pdf.min.mjs",
  pdfjsWorker: "/vendor/pdf.worker.min.mjs",
  // transformers.js v2.17.2 — webpack ESM bundle (onnxruntime baked in).
  transformers: "/vendor/transformers.min.js",
} as const;

/**
 * Load an ES module from /public/vendor via fetch + blob URL.
 *
 * Direct `import("/vendor/foo.mjs")` causes the browser to append `?import`
 * to the request, which can fail on some servers. Fetching the file first and
 * importing from a blob: URL sidesteps this entirely.
 */
let blobCache: Record<string, string> = {};

export async function loadVendorModule<T = Record<string, unknown>>(
  url: string
): Promise<T> {
  if (blobCache[url]) {
    return import(/* @vite-ignore */ blobCache[url]) as Promise<T>;
  }

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to load vendor module ${url}: ${resp.statusText}`);
  }

  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);
  blobCache[url] = blobUrl;

  // For .mjs files, we must import as ESM. For .js (UMD), the dynamic import
  // still works because the browser treats blob: URLs as modules.
  const mod = await import(/* @vite-ignore */ blobUrl);

  // Don't revoke — the browser may lazy-evaluate the module later.
  return mod as T;
}
