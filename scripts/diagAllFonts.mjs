/** Bisect-test ONE render font (pass lang as argv[2]): embed + 200 widths. */
import { renderTranslatedPdf, RENDER_FONT_URLS } from "../convex/renderPdfCore.ts";

const ONLY = process.argv[2];

const pdfLibMod = (await import("pdf-lib"));
const pdfLib = pdfLibMod.PDFDocument ? pdfLibMod : pdfLibMod.default;
const fontkitMod = (await import("@pdf-lib/fontkit"));
const fontkit = fontkitMod.default ?? fontkitMod;

const SAMPLES = {
  ur: "بادشاہت کے نقشے کی طرف Lyra نے دو بار پڑھا",
  ar: "نص المدينة الفضية التي قرأتها ليانا مرتين",
  hi: "लड़की ने पुराना अभिलेख दो बार पढ़ा",
  ne: "लड़की ने पुरानो अभिलेख दुई पटक पढ्यो",
  bn: "মেয়েটি পুরনো শিলালিপি দুবার পড়েছে",
  ja: "少女は古い碑文を二回読んだ",
  zh: "少女把古老的碑文读了两遍",
  ko: "소녀는 오래된 비문을 두 번 읽었다",
};

for (const [lang, url] of Object.entries(RENDER_FONT_URLS)) {
  if (ONLY && lang !== ONLY) continue;
  const die = setTimeout(() => { console.error(`[${lang}] >>> HANG/OOM (45s)`); process.exit(3); }, 45000);
  try {
    const t0 = Date.now();
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const doc = await pdfLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(bytes, { subset: false });
    const t1 = Date.now();
    const text = SAMPLES[lang] ?? "The silver city glittered beneath the storm";
    for (let i = 0; i < 200; i++) font.widthOfTextAtSize(text, 12);
    clearTimeout(die);
    console.log(`[${lang}] OK — ${bytes.length}B, embed+200 widths in ${Date.now() - t1 + 0}ms (fetch ${Date.now() - t0 - (Date.now() - t1)}ms)`);
  } catch (e) {
    clearTimeout(die);
    console.error(`[${lang}] FAIL: ${e.message?.slice(0, 120)}`);
    process.exit(2);
  }
}
console.log("ALL FONTS PASS");
process.exit(0);
