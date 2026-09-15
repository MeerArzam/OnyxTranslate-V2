/**
 * Phase 3 test assets — real PDFs for client-path verification.
 *  - /tmp/onyx/basic-3p.pdf   : 3 text pages (Path 1 upload + full chain)
 *  - /tmp/onyx/image-1p.pdf   : 1 page with an embedded raster image (T10 preservation)
 *  - /tmp/onyx/large-22mb.pdf : 3 pages + incompressible embedded PNG >20MB (Path 2)
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import zlib from "node:zlib";
import fs from "node:fs";

fs.mkdirSync("/tmp/onyx", { recursive: true });

// ── Minimal PNG encoder (filter 0 rows, stored deflate → incompressible) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(w, h, random) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter none
    for (let x = 0; x < w * 3; x++) raw[o++] = random ? (Math.random() * 256) | 0 : (x + y) % 256;
  }
  const idat = random ? zlib.deflateSync(raw, { level: 0 }) : zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const STORY = [
  "The ember gates of Vaelthara opened only under a blood moon, and Kaelen had waited eleven years for this night.",
  "Lyra tightened her grip on the obsidian blade. Somewhere beyond the Stormspire, the dragon queen was listening.",
  "Every ward on the onyx storm had been carved by hands that no longer existed. Tonight those hands would answer.",
];

// ── basic 3-page ──
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let p = 0; p < 3; p++) {
  const page = doc.addPage([595, 842]);
  page.drawText(`OnyxTranslate Test Novel — Page ${p + 1}`, { x: 50, y: 780, size: 16, font });
  page.drawText(STORY[p % 3].slice(0, 90), { x: 50, y: 740, size: 11, font });
  page.drawText("Kaelen drew the ember blade; the storm answered with thunder.", { x: 50, y: 720, size: 11, font });
}
fs.writeFileSync("/tmp/onyx/basic-3p.pdf", await doc.save());

// ── image-embedded 1-page ──
const doc2 = await PDFDocument.create();
const page2 = doc2.addPage([595, 842]);
const f2 = await doc2.embedFont(StandardFonts.Helvetica);
page2.drawText("Illustrated Page — the map of Vaelthara", { x: 50, y: 780, size: 14, font: f2 });
const logo = makePng(240, 120, false);
const png = await doc2.embedPng(logo);
page2.drawImage(png, { x: 50, y: 560, width: 240, height: 120 });
page2.drawText("Beneath the image: Lyra read the ember inscription twice.", { x: 50, y: 520, size: 11, font: f2 });
fs.writeFileSync("/tmp/onyx/image-1p.pdf", await doc2.save());

// ── >20MB (random-pixel PNG, stored deflate → truly incompressible) ──
const big = makePng(2700, 2700, true); // ~21.9MB raw scanlines
const doc3 = await PDFDocument.create();
const f3 = await doc3.embedFont(StandardFonts.Helvetica);
for (let p = 0; p < 3; p++) {
  const page = doc3.addPage([595, 842]);
  page.drawText(`Large Novel — Page ${p + 1}`, { x: 50, y: 780, size: 16, font: f3 });
  page.drawText(STORY[p % 3].slice(0, 90), { x: 50, y: 740, size: 11, font: f3 });
}
const bigPng = await doc3.embedPng(big);
doc3.getPages()[0].drawImage(bigPng, { x: 300, y: 600, width: 100, height: 100 });
const buf = Buffer.from(await doc3.save({ useObjectStreams: false }));
fs.writeFileSync("/tmp/onyx/large-22mb.pdf", buf);

for (const f of ["basic-3p.pdf", "image-1p.pdf", "large-22mb.pdf"]) {
  const s = fs.statSync(`/tmp/onyx/${f}`);
  console.log(`${f}: ${(s.size / 1024 / 1024).toFixed(2)} MB`);
}
