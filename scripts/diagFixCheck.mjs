/** Verify fixes: hi with regenerator polyfill; ur render with Amiri + bidi. */
import "regenerator-runtime/runtime";
import fs from "node:fs";
import { renderTranslatedPdf, RENDER_FONT_URLS } from "../convex/renderPdfCore.ts";

const MODE = process.argv[2]; // "hi" | "ur-render"

const die = setTimeout(() => { console.error(">>> HANG/OOM"); process.exit(3); }, 90000);

const pdfLibMod = (await import("pdf-lib"));
const pdfLib = pdfLibMod.PDFDocument ? pdfLibMod : pdfLibMod.default;
const fontkitMod = (await import("@pdf-lib/fontkit"));
const fontkit = fontkitMod.default ?? fontkitMod;

if (MODE === "hi") {
  const bytes = new Uint8Array(await (await fetch(RENDER_FONT_URLS.hi)).arrayBuffer());
  const doc = await pdfLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes, { subset: false });
  const text = "लड़की ने पुराना अभिलेख दो बार पढ़ा";
  const t0 = Date.now();
  const w = font.widthOfTextAtSize(text, 12);
  for (let i = 0; i < 200; i++) font.widthOfTextAtSize(text, 12);
  console.log(`hi OK — width=${w.toFixed(1)}, 201 widths in ${Date.now() - t0}ms`);
  clearTimeout(die);
  process.exit(0);
}

// ur-render: full local render with Amiri + bidi shaping (as the fixed core does)
const srcBytes = new Uint8Array(fs.readFileSync("/tmp/onyx/image-1p.pdf"));
const fontBytes = new Uint8Array(await (await fetch(RENDER_FONT_URLS.ar)).arrayBuffer());
const t0 = Date.now();
const { bytes, stats } = await renderTranslatedPdf({
  srcBytes,
  pageData: [{
    pageNumber: 1,
    width: 612, height: 792,
    text: "Illustrated Page — the map of Vaelthara\nBeneath the image: Lyra read the ember inscription twice.",
    textItems: [],
    blocks: [
      { x: 50, y: 780, width: 249, height: 14, fontSize: 14, align: "left", text: "Illustrated Page — the map of Vaelthara" },
      { x: 50, y: 520, width: 281, height: 11, fontSize: 11, align: "left", text: "Beneath the image: Lyra read the ember inscription twice." },
    ],
  }],
  mergedText: "وائل تھارا کے نقشے والا صفحہ\nتصویر کے نیچے: لیارا نے ایندھن کا کتبہ دو بار پڑھا۔",
  langCode: "ur",
  getFontBytes: async () => fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
});
clearTimeout(die);
console.log(`ur render OK in ${Date.now() - t0}ms — ${bytes.length}B stats=${JSON.stringify(stats)}`);
fs.writeFileSync("/tmp/onyx/ur-amiri-render.pdf", bytes);
console.log("wrote /tmp/onyx/ur-amiri-render.pdf");
process.exit(0);
