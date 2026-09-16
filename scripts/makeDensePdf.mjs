/**
 * Test asset: a text-dense PDF whose PARSED pageData exceeds Convex's 1MiB
 * document cap (the exact OnyxTranslate failure mode) — many pages of real
 * extractable text.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import fs from "node:fs";

const PARAGRAPHS = [
  "Violet Sorrengail had always known she would die in the Rider Quadrant, and the parapet was simply the first of many doors.",
  "Tairn's voice cut through her mind like a blade wrapped in velvet, asking whether she intended to fly or merely to freeze.",
  "Xaden Riorson watched from the second row, his onyx eyes tracking every cadet who stepped onto the parapet and every one who fell.",
  "Andarna was small for a dragon, golden-scaled and impossibly fast, and she had chosen Violet for reasons no one could explain.",
  "The wards around Basgiath flickered at dusk, and the Scribes recorded every fluctuation in their ledgers of rune-marked paper.",
  "General Sorrengail did not look at her youngest daughter as the rotation was announced; the Mavens called it mercy, the Wards called it strategy.",
  "Signets manifested in the drainage tunnel beneath the college, and the Conduits among the first-years whispered about the power it took to hold them.",
  "Liam held his mended arm loosely at his side, the Mending still fresh, while Rhiannon counted the squadrons mustering on the flight field.",
];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const PAGE_W = 612, PAGE_H = 792, M = 56, LINE = 14, MAXW = PAGE_W - M * 2;

function wrap(text, size) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > MAXW) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

const PAGES = Number(process.argv[2] ?? 40);
const OUT = process.argv[3] ?? `/tmp/onyx/dense-${PAGES}p.pdf`;
for (let p = 0; p < PAGES; p++) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;
  for (let b = 0; b < 10; b++) {
    const para = PARAGRAPHS[(p * 10 + b) % PARAGRAPHS.length];
    for (const ln of wrap(para, 11)) {
      if (y < M) break;
      page.drawText(ln, { x: M, y, size: 11, font });
      y -= LINE;
    }
    y -= 6;
    if (y < M) break;
  }
}

const bytes = await doc.save();
fs.writeFileSync(OUT, bytes);
console.log(`${OUT} — ${PAGES} pages, ${(bytes.length / 1048576).toFixed(2)}MiB file (parsed pageData targets >1MiB)`);
