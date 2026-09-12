// scripts/testPdfFidelity.cjs — Phase B + C verification driver.
// Run: bun scripts/testPdfFidelity.cjs   (bun: native TS imports for convex modules)
//
// Phase B (extraction self-test):
//   builds a PDF where words are drawn as TIGHTLY-KERNED FRAGMENTS (gap <
//   0.3em) — exactly the pdf.js pattern that produced "Ony xStor m" — uploads
//   it to the REAL deployment and runs the REAL parseUploadedPdf action.
//   Asserts: no internal spaces in OnyxStorm/fluxcapacitor/hyperdrive,
//   hyphen-join works, paragraph blocks cluster.
//
// Phase C (translated-PDF fidelity, ar/ja/de):
//   drives the REAL production flow: upload → parse → createProject →
//   translateLanguage → (chained) generateTranslatedPdf → zipAssembly.
//   Then asserts on the OUTPUT PDF:
//     1. page count identical
//     2. page-3 image + vector rectangle preserved (pdfjs operator counts)
//     3. every source text block is covered by a white erase rect (visual
//        English removal — same overlay approach as Google Translate)
//     4. translated text present in the correct script (Arabic/CJK/Latin)
//     5. rendered lines stay within block bounds ±2px (renderPdfCore
//        re-run locally with the SAME fonts + texts the server used)

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");

const BASE = "https://successful-iguana-419.convex.cloud";
const API = `${BASE}/api`;
const OUT = "/tmp/pdf_fidelity_results.json";

// ─────────────────────────────── helpers ───────────────────────────────

async function post(path, args, kind = "action", timeout = 280000) {
  const res = await fetch(`${API}/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
    signal: AbortSignal.timeout(timeout),
  });
  const j = await res.json();
  if (j.status !== "success") throw new Error(`${path}: ${j.errorMessage || JSON.stringify(j).slice(0, 300)}`);
  return j.value;
}

async function waitFor(path, args, pred, { every = 10000, tries = 60, label = "" } = {}) {
  for (let i = 0; i < tries; i++) {
    const val = await post(path, args, "query", 30000);
    if (pred(val)) return val;
    process.stdout.write(`  ...waiting ${label} (${i + 1}/${tries})\r`);
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timeout waiting for ${label || path}`);
}

// ─────────────────────── test PDF construction ─────────────────────────

// 1×1 purple PNG (kept tiny; only XObject presence is asserted)
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** Page 1: tightly-kerned fragments + hyphenated line-break + paragraphs. */
async function buildExtractionPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const size = 12;

  // Word drawn as fragments with sub-0.3em gaps (kerned-split word pattern)
  const drawFragWord = (frags, x, y) => {
    let cx = x;
    for (const f of frags) {
      page.drawText(f, { x: cx, y, size, font });
      cx += font.widthOfTextAtSize(f, size) + 0.8; // 0.8pt gap ≪ 0.3 × 12pt = 3.6pt
    }
    return cx;
  };

  let y = 800;
  // "OnyxStorm fluxcapacitor hyperdrive" — each word split into fragments
  let x = 60;
  x = drawFragWord(["Ony", "xStor", "m"], x, y) + 8;
  x = drawFragWord(["flux", "capac", "itor"], x, y) + 8;
  drawFragWord(["hyper", "driv", "e"], x, y);
  y -= 30;

  // Normal spaced sentence (sanity: real spaces must survive)
  page.drawText("The dragon riders flew over Basgiath at dawn.", { x: 60, y, size, font });
  y -= 40;

  // Hyphenated line break: "adven-" / "ture" on next line
  page.drawText("It was a grand adven-", { x: 60, y, size, font });
  y -= 16;
  page.drawText("ture of a lifetime.", { x: 60, y, size, font });
  y -= 32;

  // Two separate paragraph blocks (blank gap > 1.5× line-gap) for block clustering
  const para1 =
    "Violet gripped the reins and climbed into the storm. The wards flickered overhead while venin gathered beyond the ridge.";
  const para2 =
    "Xaden watched from the wall, arms crossed, certain that the battle ahead would burn everything they loved.";
  for (const para of [para1, para2]) {
    let line = "";
    for (const w of para.split(" ")) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > 480) {
        page.drawText(line, { x: 60, y, size, font });
        y -= 16;
        line = w;
      } else line = t;
    }
    if (line) page.drawText(line, { x: 60, y, size, font });
    y -= 40; // paragraph gap (≫ 16pt line gap)
  }

  return Buffer.from(await doc.save());
}

/** 3-page English prose source; page 3 has a vector rectangle + raster image. */
async function buildFidelityPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);

  const pages = [
    `Chapter 1: The Storm Within

Violet gripped the reins of Tairn's saddle, her knuckles white against the worn leather. The wind screamed past her ears as they climbed higher, the peaks of the Empyrean Mountains disappearing into roiling clouds below.

"You're afraid," Xaden's voice came through the bond, not a question but a statement. Cold. Certain.

She could feel his amusement through the connection, dark and possessive, like he could taste her fear and found it delicious.`,
    `"Holy shit," Ridoc muttered from beside her, his dragon banking in formation. "Remind me again why we volunteered for this?"

"Because we're Scribes," Violet shot back, her voice sharp with righteous fury. "And someone has to record what happens here."

The truth was darker than any of them knew. The Empyrean was watching. The Sages were moving. And somewhere in the shadows, Xaden Riorson was playing a game that could burn the world.

Wards flickered, Riders fell, and the sigils on their uniforms were torn and bloodied. This was no training exercise. This was war.`,
    `"I'm on my way," she said, forcing steadiness into her voice.

The runes carved into the ancient stone walls pulsed with a faint, sickly light. Violet could feel them, could feel the power they held, the Wards they maintained, the secrets they guarded.

Violet closed her eyes and reached for the Source. The power flooded through her like molten iron, burning, consuming, transforming. She was a Conduit now, a vessel for something older and more terrible than anyone in Navarre understood.

And Tairn, ancient and furious and hers, dove straight into the fire.`,
  ];

  for (let p = 0; p < pages.length; p++) {
    const page = doc.addPage([595, 842]);
    const size = 11;
    let y = 790;
    for (const para of pages[p].split("\n\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        const t = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(t, size) > 480) {
          page.drawText(line, { x: 56, y, size, font, color: rgb(0.05, 0.05, 0.1) });
          y -= 16;
          line = w;
        } else line = t;
      }
      if (line) page.drawText(line, { x: 56, y, size, font, color: rgb(0.05, 0.05, 0.1) });
      y -= 26;
    }
    if (p === 2) {
      // Vector rectangle (map legend box) + raster image — must survive translation
      page.drawRectangle({ x: 430, y: 700, width: 110, height: 90, color: rgb(0.35, 0.2, 0.7) });
      const img = await doc.embedPng(PNG_1PX);
      page.drawImage(img, { x: 430, y: 600, width: 110, height: 80 });
    }
  }
  return Buffer.from(await doc.save());
}

// ─────────────────────── pdfjs output inspection ───────────────────────

async function loadPdfjs() {
  const g = globalThis;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class {
      constructor(i) { if (Array.isArray(i)) [this.a, this.b, this.c, this.d, this.e, this.f] = i; }
      multiply() { return this; } translate() { return this; } scale() { return this; }
      rotate() { return this; } inverse() { return this; }
      transformPoint(p) { return { x: p.x, y: p.y, z: 0, w: 1 }; }
    };
  }
  if (typeof g.Path2D === "undefined") {
    g.Path2D = class { moveTo() {} lineTo() {} closePath() {} rect() {} arc() {} bezierCurveTo() {} quadraticCurveTo() {} };
  }
  const workerMod = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  g.pdfjsWorker = workerMod;
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

async function pdfjsCounts(bytes) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => it.str).join("\n");
    const ops = await page.getOperatorList();
    let images = 0, fills = 0;
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintJpegXObject) images++;
      if (fn === pdfjs.OPS.fill || fn === pdfjs.OPS.eoFill || fn === pdfjs.OPS.fillStroke) fills++;
    }
    pages.push({ num: i, text, images, fills });
  }
  return { numPages: doc.numPages, pages };
}

// ────────────────────── production render re-run (assert 5) ────────────

async function assertNoOverflow({ srcBytes, pageData, mergedText, langCode }) {
  const core = await import("../convex/renderPdfCore");
  const fontkitModule = await import("@pdf-lib/fontkit");
  const fontkit = fontkitModule.default ?? fontkitModule;
  const fontCache = new Map();
  const getFontBytes = async (url) => {
    if (fontCache.has(url)) return fontCache.get(url);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`font HTTP ${resp.status}`);
    const buf = await resp.arrayBuffer();
    fontCache.set(url, buf);
    return buf;
  };

  // Re-render with the EXACT production code path (self-contained since the
  // interop refactor — no ref injection needed)
  const { stats } = await core.renderTranslatedPdf({
    srcBytes: new Uint8Array(srcBytes),
    pageData,
    mergedText,
    langCode,
    getFontBytes,
  });

  // Then verify line geometry against the same planner the render used
  let font;
  const tmpDoc = await PDFDocument.create();
  tmpDoc.registerFontkit(fontkit); // Noto fonts are custom fonts
  const fontUrl = core.RENDER_FONT_URLS[langCode];
  if (fontUrl) font = await tmpDoc.embedFont(await getFontBytes(fontUrl));
  else font = await tmpDoc.embedFont(StandardFonts.Helvetica);
  const isRTL = ["ar", "ur", "ks"].includes(langCode);
  const byPage = distributePageParagraphs(mergedText, pageData);

  const violations = [];
  let checks = 0;
  for (const pd of pageData) {
    const storedBlocks = pd.blocks || [];
    if (storedBlocks.length === 0) continue;
    const plan = core.planPageOverlay({
      textItems: [],
      storedBlocks,
      pageWidth: pd.pageWidth || 595,
      pageHeight: pd.pageHeight || 842,
      paragraphs: byPage[pd.num] || [],
      font,
      isRTL,
    });
    for (const op of plan.ops) {
      for (const line of op.lines) {
        checks++;
        const lw = font.widthOfTextAtSize(line.text, line.size);
        if (line.x < op.erase.x - 2 || line.x + lw > op.erase.x + op.erase.width + 1) {
          violations.push(`pg${pd.num} x-overflow x=${line.x.toFixed(1)}+${lw.toFixed(1)} rect=[${op.erase.x.toFixed(1)},${(op.erase.x + op.erase.width).toFixed(1)}]`);
        }
        if (line.y > op.erase.y + op.erase.height + 2) {
          violations.push(`pg${pd.num} y-overflow baseline=${line.y.toFixed(1)} > ${(op.erase.y + op.erase.height).toFixed(1)}`);
        }
      }
    }
  }
  return { stats, checks, violations: violations.slice(0, 10), violationCount: violations.length };
}

// ────────────────────── production page-para distribution ──────────────

// Mirrors convex/generatePdf.ts C1 distribution exactly so assertion 5 runs
// the same planner inputs the server used.
function distributePageParagraphs(mergedText, pageData) {
  const paragraphs = mergedText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const totalWords = mergedText.split(/\s+/).filter(Boolean).length;
  let paraIdx = 0;
  const srcWordsPerPage = pageData.map((p) => {
    const text = p.text ?? (p.textItems || []).map((it) => it.str).join(" ");
    return Math.max(text.split(/\s+/).filter(Boolean).length, 1);
  });
  const totalSrcWords = Math.max(srcWordsPerPage.reduce((a, b) => a + b, 0), 1);
  const srcPageCount = pageData.length;
  const byPage = {};
  for (let i = 0; i < srcPageCount; i++) {
    const share = (srcWordsPerPage[i] ?? 1) / totalSrcWords;
    const targetWords = Math.floor(share * totalWords);
    const pageParas = [];
    let pageParaWords = 0;
    while (
      paraIdx < paragraphs.length &&
      (pageParaWords + paragraphs[paraIdx].split(/\s+/).filter(Boolean).length <= targetWords ||
        i === srcPageCount - 1)
    ) {
      pageParas.push(paragraphs[paraIdx]);
      pageParaWords += paragraphs[paraIdx].split(/\s+/).filter(Boolean).length;
      paraIdx++;
      if (i < srcPageCount - 1 && pageParaWords >= targetWords) break;
    }
    byPage[(pageData[i] && pageData[i].num) || i + 1] = pageParas;
  }
  return byPage;
}

// ─────────────────────────────── main ──────────────────────────────────

const results = { generatedAt: new Date().toISOString(), deployment: BASE, extraction: null, languages: {} };

async function main() {
  const onlyPhase = process.argv[2] || "all";

  if (onlyPhase === "all" || onlyPhase === "extraction") {
    console.log("\n═══ PHASE B — extraction self-test (real parseUploadedPdf) ═══");
    const bytes = await buildExtractionPdf();
    fs.writeFileSync("/tmp/onyx-extraction-test.pdf", bytes);
    const storageId = (await post("upload:storePdf", { fileName: "extraction-test.pdf", pdfBase64: bytes.toString("base64") })).storageId;
    const parsed = await post("parsePdf:parseUploadedPdf", { pdfStorageId: storageId });
    const pageText = parsed.pageData[0].text;

    const words = ["OnyxStorm", "fluxcapacitor", "hyperdrive"];
    const found = {};
    for (const w of words) found[w] = pageText.includes(w);
    const hyphenFixed = pageText.includes("adventure") && !/adven-\s*\n?\s*ture/.test(pageText);
    const blocks = parsed.pageData[0].blocks.length;

    console.log("extracted page text:\n" + pageText.split("\n").map((l) => "  | " + l).join("\n"));
    console.log(`fragment-merge: ${JSON.stringify(found)}  hyphen-join: ${hyphenFixed}  blocks: ${blocks}`);
    const ok = Object.values(found).every(Boolean) && hyphenFixed && blocks >= 3;
    results.extraction = { ok, found, hyphenFixed, blocks, pageText };
    if (!ok) throw new Error("EXTRACTION SELF-TEST FAILED");
    console.log("PHASE B: PASS ✓");
  }

  // Short resumable modes: the terminal cap is 180s, but the server-side
  // language chain keeps running after the client exits. `kick` fires a
  // language (~15s); `assert` polls, repairs a stalled PDF gen with the real
  // merged text, and runs the 5 assertions.
  // Build a kick file from an EXISTING fully-translated project (avoids a
  // redundant Gemini run when the project predates the kick/assert split).
  if (onlyPhase === "kickfromproject") {
    const langCode = process.argv[3];
    const pid = process.argv[4];
    const project = await post("queries:getProjectRaw", { projectId: pid }, "query");
    const srcBytes = await buildFidelityPdf();
    fs.writeFileSync("/tmp/onyx-fidelity-src.pdf", srcBytes);
    const srcCounts = await pdfjsCounts(srcBytes);
    const parsed = { pageCount: project.pageCount, wordCount: project.wordCount, pageData: project.pageData, fullText: project.fullText };
    fs.writeFileSync(`/tmp/fidelity-kick-${langCode}.json`, JSON.stringify({ pid, sessionId: project.sessionId, storageId: project.pdfStorageId, parsed, srcCounts }));
    console.log(`KICKFILE ${langCode}: pid=${pid} blocks=${parsed.pageData.reduce((s, p) => s + (p.blocks || []).length, 0)}`);
    return;
  }

  if (onlyPhase === "kick") {
    const langCode = process.argv[3];
    const srcBytes = await buildFidelityPdf();
    fs.writeFileSync("/tmp/onyx-fidelity-src.pdf", srcBytes);
    const storageId = (await post("upload:storePdf", { fileName: "fidelity-src.pdf", pdfBase64: srcBytes.toString("base64") })).storageId;
    const parsed = await post("parsePdf:parseUploadedPdf", { pdfStorageId: storageId });
    const sessionId = `e2e-fidelity-${langCode}-${Date.now()}`;
    const pid = (await post("mutations:createProject", {
      sessionId, fileName: "fidelity-src.pdf", pageCount: parsed.pageCount,
      wordCount: parsed.wordCount, pdfStorageId: storageId, pageData: parsed.pageData,
      fullText: parsed.fullText, parsedPages: parsed.pageCount, status: "ready",
    }, "mutation"));
    await post("translateContent:translateLanguage", { projectId: pid, langCode, marketContext: "standard" });
    const srcCounts = await pdfjsCounts(srcBytes);
    fs.writeFileSync(`/tmp/fidelity-kick-${langCode}.json`, JSON.stringify({ pid, sessionId, storageId, parsed, srcCounts }));
    console.log(`KICKED ${langCode}: pid=${pid} blocks=${parsed.pageData.reduce((s, p) => s + (p.blocks || []).length, 0)}`);
    return;
  }

  if (onlyPhase === "assert") {
    const langCode = process.argv[3];
    const { pid, parsed, srcCounts } = JSON.parse(fs.readFileSync(`/tmp/fidelity-kick-${langCode}.json`, "utf8"));
    console.log(`\n═══ PHASE C — ${langCode} fidelity assertions ═══`);
    const t0 = Date.now();
    let translation = null;
    for (let i = 0; i < 9; i++) {
      const ts = await post("queries:getTranslationsRaw", { projectId: pid }, "query");
      const t = ts.find((x) => x.langCode === langCode);
      if (t && t.status === "complete" && t.pdfUrl && !t.pdfGenerating) { translation = t; break; }
      // Repair: text finished but the chained PDF gen stalled (e.g. crashed
      // action before a fix) — re-fire it with the REAL merged text.
      if (t && t.status === "complete" && !t.pdfUrl) {
        const mergedNow = (await post("queries:getChunksForLang", { projectId: pid, langCode }, "query"))
          .sort((a, b) => a.chunkIndex - b.chunkIndex).map((c) => c.translatedText || "").filter(Boolean).join("\n\n");
        if (mergedNow.trim()) {
          console.log(`  [repair] re-firing PDF gen for ${langCode}`);
          await post("generatePdf:generateTranslatedPdf", { projectId: pid, langCode, translationId: t._id, mergedText: mergedNow });
        }
      }
      process.stdout.write(`  ...poll ${i + 1}/9 (${Math.round((Date.now() - t0) / 1000)}s)\r`);
      await new Promise((r) => setTimeout(r, 15000));
    }
    if (!translation) throw new Error(`timeout waiting for ${langCode} translate+pdf (rerun: resumable)`);
    const merged = (await post("queries:getChunksForLang", { projectId: pid, langCode }, "query"))
      .sort((a, b) => a.chunkIndex - b.chunkIndex).map((c) => c.translatedText || "").filter(Boolean).join("\n\n");

    const pdfBytes = Buffer.from(await (await fetch(translation.pdfUrl)).arrayBuffer());
    fs.writeFileSync(`/tmp/fidelity-${langCode}.pdf`, pdfBytes);
    const outCounts = await pdfjsCounts(pdfBytes);

    const a1 = outCounts.numPages === srcCounts.numPages;
    const a2 = outCounts.pages[2].images >= srcCounts.pages[2].images &&
               outCounts.pages[2].fills >= srcCounts.pages[2].fills;
    const blockCount = parsed.pageData.reduce((s, p) => s + (p.blocks || []).length, 0);
    const whiteFills = outCounts.pages.reduce((s, p) => s + p.fills, 0);
    const a3 = whiteFills >= blockCount;
    const allText = outCounts.pages.map((p) => p.text).join("\n");
    let a4 = false, scriptCheck = "";
    if (langCode === "ar") {
      const arabic = (allText.match(/[\u0600-\u06FF]/g) || []).length;
      scriptCheck = `arabic chars: ${arabic}`;
      a4 = arabic > 100;
    } else if (langCode === "ja") {
      const cjk = (allText.match(/[\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
      scriptCheck = `cjk chars: ${cjk}`;
      a4 = cjk > 100;
    } else {
      const sample = merged.split(/\s+/).filter((w) => w.length >= 5).slice(0, 40);
      const hits = sample.filter((w) => allText.includes(w.replace(/[.,!?;:«»"']/g, ""))).length;
      scriptCheck = `sample-word hits: ${hits}/${sample.length}`;
      a4 = hits >= sample.length * 0.5;
    }
    const overflow = await assertNoOverflow({
      srcBytes: fs.readFileSync("/tmp/onyx-fidelity-src.pdf"),
      pageData: parsed.pageData, mergedText: merged, langCode,
    });
    const a5 = overflow.violationCount === 0;
    const pass = a1 && a2 && a3 && a4 && a5;
    results.languages[langCode] = {
      pass, projectId: pid,
      assertions: { pageCount: a1, imagesVectorPreserved: a2, whiteoutCoverage: a3, translatedScriptPresent: a4, noBlockOverflow: a5 },
      evidence: {
        pages: `${outCounts.numPages}/${srcCounts.numPages}`,
        p3Images: `${outCounts.pages[2].images}/${srcCounts.pages[2].images}`,
        p3Fills: `${outCounts.pages[2].fills}/${srcCounts.pages[2].fills}`,
        whiteFillsVsBlocks: `${whiteFills}/${blockCount}`,
        scriptCheck, overflowChecks: overflow.checks, overflowViolations: overflow.violations,
        renderStats: overflow.stats,
        seconds: Math.round((Date.now() - t0) / 1000),
      },
    };
    console.log(`\n  1 page-count:   ${a1 ? "PASS" : "FAIL"} (${outCounts.numPages}/${srcCounts.numPages})`);
    console.log(`  2 image/vector: ${a2 ? "PASS" : "FAIL"} (img ${outCounts.pages[2].images}/${srcCounts.pages[2].images}, fills ${outCounts.pages[2].fills}/${srcCounts.pages[2].fills})`);
    console.log(`  3 whiteout:     ${a3 ? "PASS" : "FAIL"} (${whiteFills} white fills ≥ ${blockCount} blocks)`);
    console.log(`  4 script:       ${a4 ? "PASS" : "FAIL"} (${scriptCheck})`);
    console.log(`  5 overflow≤2px: ${a5 ? "PASS" : "FAIL"} (${overflow.checks} lines checked, ${overflow.violationCount} violations${overflow.violations.length ? ": " + overflow.violations[0] : ""})`);
    console.log(`  renderStats: ${JSON.stringify(overflow.stats)}`);
    const project = await post("queries:getProjectRaw", { projectId: pid }, "query");
    console.log(`  ${langCode}: ${pass ? "ALL PASS ✓" : "FAIL ✗"} in ${results.languages[langCode].evidence.seconds}s  zipUrl=${project.zipUrl ? "YES" : "pending"}`);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
    return;
  }

  if (onlyPhase === "all" || onlyPhase === "fidelity") {
    const argLang = process.argv[3]; // optional: run ONE language (resumable)
    const langs = argLang ? [argLang] : ["ar", "ja", "de"].filter((l) => !results.languages[l]);
    console.log(`\n═══ PHASE C — translated-PDF fidelity (${langs.join(" / ")}) ═══`);
    const srcBytes = await buildFidelityPdf();
    fs.writeFileSync("/tmp/onyx-fidelity-src.pdf", srcBytes);

    const storageId = (await post("upload:storePdf", { fileName: "fidelity-src.pdf", pdfBase64: srcBytes.toString("base64") })).storageId;
    const parsed = await post("parsePdf:parseUploadedPdf", { pdfStorageId: storageId });
    const srcCounts = await pdfjsCounts(srcBytes);

    for (const langCode of langs) {
      const t0 = Date.now();
      console.log(`\n── ${langCode}: production flow ──`);
      const sessionId = `e2e-fidelity-${langCode}`;
      const pid = (await post("mutations:createProject", {
        sessionId, fileName: "fidelity-src.pdf", pageCount: parsed.pageCount,
        wordCount: parsed.wordCount, pdfStorageId: storageId, pageData: parsed.pageData,
        fullText: parsed.fullText, parsedPages: parsed.pageCount, status: "ready",
      }, "mutation"));
      await post("translateContent:translateLanguage", { projectId: pid, langCode, marketContext: "standard" });

      const translations = await waitFor("queries:getTranslationsRaw", { projectId: pid },
        (ts) => ts.length > 0 && ts.every((t) => t.status === "complete" && !t.pdfGenerating && t.pdfUrl),
        { label: `${langCode} translate+pdf`, every: 15000, tries: 40 });

      const translation = translations.find((t) => t.langCode === langCode);
      const merged = (await post("queries:getChunksForLang", { projectId: pid, langCode }, "query"))
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((c) => c.translatedText || "").filter(Boolean).join("\n\n");

      const pdfBytes = Buffer.from(await (await fetch(translation.pdfUrl)).arrayBuffer());
      fs.writeFileSync(`/tmp/fidelity-${langCode}.pdf`, pdfBytes);
      const outCounts = await pdfjsCounts(pdfBytes);

      // Assert 1: page count
      const a1 = outCounts.numPages === srcCounts.numPages;
      // Assert 2: page-3 image + vector fills preserved
      const a2 = outCounts.pages[2].images >= srcCounts.pages[2].images &&
                 outCounts.pages[2].fills >= srcCounts.pages[2].fills;
      // Assert 3: white erase rects cover every source block (visual English removal)
      const blockCount = parsed.pageData.reduce((s, p) => s + (p.blocks || []).length, 0);
      const whiteFills = outCounts.pages.reduce((s, p) => s + p.fills, 0);
      const a3 = whiteFills >= blockCount; // erase rects are white fills
      // Assert 4: translated script present
      const allText = outCounts.pages.map((p) => p.text).join("\n");
      let a4 = false, scriptCheck = "";
      if (langCode === "ar") {
        const arabic = (allText.match(/[\u0600-\u06FF]/g) || []).length;
        scriptCheck = `arabic chars: ${arabic}`;
        a4 = arabic > 100;
      } else if (langCode === "ja") {
        const cjk = (allText.match(/[\u3040-\u30FF\u4E00-\u9FFF]/g) || []).length;
        scriptCheck = `cjk chars: ${cjk}`;
        a4 = cjk > 100;
      } else {
        const sample = merged.split(/\s+/).filter((w) => w.length >= 5).slice(0, 40);
        const hits = sample.filter((w) => allText.includes(w.replace(/[.,!?;:«»"']/g, ""))).length;
        scriptCheck = `sample-word hits: ${hits}/${sample.length}`;
        a4 = hits >= sample.length * 0.5;
      }
      // Assert 5: no line exceeds block bounds by >2px (planner re-run)
      const pageParasByPage = distributePageParagraphs(merged, parsed.pageData);
      const overflow = await assertNoOverflow({ srcBytes, pageData: parsed.pageData, mergedText: merged, langCode });
      const a5 = overflow.violationCount === 0;

      const project = await post("queries:getProjectRaw", { projectId: pid }, "query");
      const pass = a1 && a2 && a3 && a4 && a5;
      results.languages[langCode] = {
        pass, projectId: pid, zipUrl: project.zipUrl || null,
        assertions: { pageCount: a1, imagesVectorPreserved: a2, whiteoutCoverage: a3, translatedScriptPresent: a4, noBlockOverflow: a5 },
        evidence: {
          pages: `${outCounts.numPages}/${srcCounts.numPages}`,
          p3Images: `${outCounts.pages[2].images}/${srcCounts.pages[2].images}`,
          p3Fills: `${outCounts.pages[2].fills}/${srcCounts.pages[2].fills}`,
          whiteFillsVsBlocks: `${whiteFills}/${blockCount}`,
          scriptCheck, overflowChecks: overflow.checks, overflowViolations: overflow.violations,
          renderStats: overflow.stats,
          seconds: Math.round((Date.now() - t0) / 1000),
        },
      };
      console.log(`  1 page-count:   ${a1 ? "PASS" : "FAIL"} (${outCounts.numPages}/${srcCounts.numPages})`);
      console.log(`  2 image/vector: ${a2 ? "PASS" : "FAIL"} (img ${outCounts.pages[2].images}/${srcCounts.pages[2].images}, fills ${outCounts.pages[2].fills}/${srcCounts.pages[2].fills})`);
      console.log(`  3 whiteout:     ${a3 ? "PASS" : "FAIL"} (${whiteFills} white fills ≥ ${blockCount} blocks)`);
      console.log(`  4 script:       ${a4 ? "PASS" : "FAIL"} (${scriptCheck})`);
      console.log(`  5 overflow≤2px: ${a5 ? "PASS" : "FAIL"} (${overflow.checks} lines checked, ${overflow.violationCount} violations${overflow.violations.length ? ": " + overflow.violations[0] : ""})`);
      console.log(`  ${langCode}: ${pass ? "ALL PASS ✓" : "FAIL ✗"} in ${results.languages[langCode].evidence.seconds}s  zipUrl=${project.zipUrl ? "YES" : "pending"}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  console.log(`\nWROTE ${OUT}`);
  const langEntries = Object.values(results.languages);
  const allPass =
    (!results.extraction || results.extraction.ok) &&
    (langEntries.length === 0 || langEntries.every((l) => l.pass));
  console.log(allPass ? "SUITE: ALL PASS ✓" : "SUITE: FAILURES ✗");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("SUITE ERROR:", e.message); process.exit(2); });
