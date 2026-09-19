/** Bisect the ur render hang: embed font alone → single wrapText → full fit. */
import fs from "node:fs";
import { renderTranslatedPdf } from "../convex/renderPdfCore.ts";

const fontUrl = "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoNastaliqUrdu/hinted/ttf/NotoNastaliqUrdu-Regular.ttf";
const fontBytes = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
console.log("font:", fontBytes.length);

const pdfLibMod = (await import("pdf-lib"));
const pdfLib = pdfLibMod.PDFDocument ? pdfLibMod : pdfLibMod.default;
const fontkitMod = (await import("@pdf-lib/fontkit"));
const fontkit = fontkitMod.default ?? fontkitMod;

const die = setTimeout(() => { console.error(">>> HANG detected at current stage"); process.exit(3); }, 45000);

console.log("stage 1: create doc + registerFontkit…");
const doc = await pdfLib.PDFDocument.create();
doc.registerFontkit(fontkit);

console.log("stage 2: embedFont (Nastaliq static)…");
const t0 = Date.now();
const font = await doc.embedFont(fontBytes, { subset: false });
console.log(`embedded in ${Date.now() - t0}ms`);

console.log("stage 3: widthOfTextAtSize x1…");
const t1 = Date.now();
const w = font.widthOfTextAtSize("بادشاہت کے نقشے کی طرف", 12);
console.log(`width=${w.toFixed(1)} in ${Date.now() - t1}ms`);

console.log("stage 4: widthOfTextAtSize x200…");
const t2 = Date.now();
const text = "Lyra نے ember کا تحریر دو بار پڑھا۔ نقشہ Vaelthara کا";
for (let i = 0; i < 200; i++) font.widthOfTextAtSize(text, 12);
console.log(`200 widths in ${Date.now() - t2}ms`);

clearTimeout(die);
console.log("ALL STAGES OK — font is not the hang");
process.exit(0);
