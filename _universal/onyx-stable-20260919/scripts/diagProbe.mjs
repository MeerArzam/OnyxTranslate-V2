/** Probe 1: staged hi failure. Probe 2: Amiri rendering Urdu text (bidi path). */
import { RENDER_FONT_URLS } from "../convex/renderPdfCore.ts";

const MODE = process.argv[2]; // "hi" | "ur-amiri"

const die = setTimeout(() => { console.error(">>> HANG/OOM"); process.exit(3); }, 45000);

const pdfLibMod = (await import("pdf-lib"));
const pdfLib = pdfLibMod.PDFDocument ? pdfLibMod : pdfLibMod.default;
const fontkitMod = (await import("@pdf-lib/fontkit"));
const fontkit = fontkitMod.default ?? fontkitMod;

const url = MODE === "hi" ? RENDER_FONT_URLS.hi : RENDER_FONT_URLS.ar;
console.log("fetch…");
const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
console.log(`fetched ${bytes.length}B`);
const doc = await pdfLib.PDFDocument.create();
doc.registerFontkit(fontkit);
console.log("embed…");
const font = await doc.embedFont(bytes, { subset: false });
console.log("embedded");

const text = MODE === "hi"
  ? "लड़की ने पुराना अभिलेख दो बार पढ़ा"
  : "بادشاہت کے نقشے کی طرف Lyra نے دو بار پڑھا";
console.log("width x1…");
const t0 = Date.now();
const w = font.widthOfTextAtSize(text, 12);
console.log(`width=${w.toFixed(1)} in ${Date.now() - t0}ms`);

console.log("width x200…");
const t1 = Date.now();
for (let i = 0; i < 200; i++) font.widthOfTextAtSize(text, 12);
console.log(`200 widths in ${Date.now() - t1}ms`);

clearTimeout(die);
console.log(`${MODE} OK`);
process.exit(0);
