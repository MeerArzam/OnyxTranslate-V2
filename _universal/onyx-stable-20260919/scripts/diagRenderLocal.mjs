/**
 * Local repro of the ur PDF render — times each stage of renderTranslatedPdf
 * against the REAL font + REAL project data to find the hang/crash point.
 */
import fs from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { renderTranslatedPdf } from "../convex/renderPdfCore.ts";

const convex = new ConvexHttpClient("https://successful-iguana-419.convex.cloud");
const apiAny = (await import("../convex/_generated/api.js")).api;
const state = JSON.parse(fs.readFileSync("/tmp/onyx/phase3-state.json", "utf8"));
const mid = state.mainProjectId;

const proj = await convex.query(apiAny.queries.getProjectRaw, { projectId: mid });
const ts = await convex.query(apiAny.queries.getTranslationsRaw, { projectId: mid });
const ur = ts.find((t) => t.langCode === "ur");
console.log("project pages:", proj.pageCount, "pageData blocks:", proj.pageData?.[0]?.blocks?.length ?? 0, "merged:", (ur.mergedText ?? "").length, "ch");

// Fetch the ORIGINAL pdf via its storage url
const origUrl = await convex.query(apiAny.queries.getProjectRaw, { projectId: mid }).then((p) => p.pdfUrl).catch(() => null);
let srcBytes;
if (origUrl) {
  srcBytes = new Uint8Array(await (await fetch(origUrl)).arrayBuffer());
  console.log("src pdf via pdfUrl:", srcBytes.length, "bytes");
} else {
  srcBytes = new Uint8Array(fs.readFileSync("/tmp/onyx/image-1p.pdf"));
  console.log("src pdf from disk asset:", srcBytes.length, "bytes");
}

const fontUrl = "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoNastaliqUrdu/hinted/ttf/NotoNastaliqUrdu-Regular.ttf";
console.log("font download…");
const t0 = Date.now();
const fontBytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
console.log(`font: ${fontBytes.length} bytes in ${Date.now() - t0}ms`);

console.log("render…");
const t1 = Date.now();
const hard = setTimeout(() => { console.error(">>> render exceeded 120s — hung inside render core"); process.exit(3); }, 120000);
try {
  const { bytes, stats, usedFallbackFont } = await renderTranslatedPdf({
    srcBytes,
    pageData: proj.pageData ?? [],
    mergedText: ur.mergedText ?? "",
    langCode: "ur",
    getFontBytes: async () => fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
  });
  clearTimeout(hard);
  console.log(`render OK in ${Date.now() - t1}ms — ${bytes.length} bytes, fallbackFont=${usedFallbackFont}, stats=${JSON.stringify(stats)}`);
  fs.writeFileSync("/tmp/onyx/ur-local-render.pdf", bytes);
  console.log("wrote /tmp/onyx/ur-local-render.pdf");
} catch (e) {
  clearTimeout(hard);
  console.error("RENDER ERROR:", e.message);
  process.exit(2);
}
process.exit(0);
