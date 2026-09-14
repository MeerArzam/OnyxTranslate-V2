/**
 * OnyxTranslate — FIX 6 client-path verification (staged).
 * Drives the REAL UI (headless Chromium via Playwright) at http://127.0.0.1:5173/
 * and asserts the real client handlers fire the real Convex actions.
 *
 * Usage: bun scripts/clientPathTest.mjs <stage>
 *   stages: upload | drop | large | import | summary
 * Each stage persists its records to /tmp/clientpath-<stage>.json.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:5173/";
const CONVEX = "https://successful-iguana-419.convex.cloud/api";
const BOOK_PDF = "/tmp/onyx-test-book.pdf";
const SMALL_PDF = "/tmp/onyx-extraction-test.pdf";
const stage = process.argv[2] || "upload";
const results = [];
const consoleLines = [];
const pageErrors = [];

function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
  console.log(`${pass ? "✅ PASS" : "❌ FAIL"} — ${name}\n   ${evidence}\n`);
}

async function convexPost(kind, path, args, timeout = 60) {
  const res = await fetch(`${CONVEX}/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
    signal: AbortSignal.timeout(timeout * 1000),
  });
  const json = await res.json();
  if (json.errorMessage) throw new Error(`${path}: ${json.errorMessage}`);
  return json.value;
}

async function makeLargePdf(targetPages = 310, minBytes = 10.5 * 1024 * 1024) {
  // Memory-efficient bulk: 310 light pages (defeats the removed page limit)
  // + a spec-compliant ~10MB embedded-file attachment (defeats the removed
  // size limit). pdf-lib stores attachments verbatim; pdf.js ignores them
  // for text extraction, so Convex's 1MB page-text limit is not hit.
  const { PDFDocument } = await import("pdf-lib");
  const d = await PDFDocument.create();
  const f = await d.embedFont("Helvetica");
  for (let i = 0; i < targetPages; i++) {
    const page = d.addPage([595, 842]);
    page.drawText(`Large-file regression page ${i + 1} of ${targetPages}`, { x: 40, y: 780, size: 12, font: f });
  }
  // Random bytes — pdf-lib Flate-compresses attachment streams, so repeated
  // content would shrink to nothing. Random data stays ~1:1.
  const payload = Buffer.alloc(minBytes);
  for (let i = 0; i < payload.length; i++) payload[i] = (Math.random() * 256) | 0;
  await d.attach(payload, "bulk-payload.bin", "application/octet-stream");
  // useObjectStreams:false keeps the attachment verbatim (object streams would
  // Flate-compress 10MB of repeated bytes down to ~10KB).
  const bytes = await d.save({ useObjectStreams: false });
  return { bytes, pages: targetPages, size: bytes.length };
}

async function newPage(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("console", (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText("Drop PDF here or click to browse").waitFor({ timeout: 30000 });
  return { ctx, page };
}

const browser = await chromium.launch();
try {
  if (stage === "upload") {
    const { ctx, page } = await newPage(browser);
    const sessionId = await page.evaluate(() => sessionStorage.getItem("onyx-session-id"));
    console.log("sessionId:", sessionId);

    await page.setInputFiles('input[type="file"][accept=".pdf,application/pdf"]', BOOK_PDF);
    await page.waitForFunction(
      () => document.body.innerText.toLowerCase().includes("onyx-test-book.pdf"),
      { timeout: 180000 }
    ).catch(() => {});
    await page.waitForTimeout(4000);

    const proj = await convexPost("query", "queries:getLatestProject", { sessionId });
    record(
      "FIX6.1 Upload: client pipeline fired (storePdf→parsePdf→createProject), project row in Convex",
      !!proj && proj.fileName?.toLowerCase() === "onyx-test-book.pdf" && (proj.pageData?.length ?? 0) > 0,
      `getLatestProject → fileName=${proj?.fileName} status=${proj?.status} pages=${proj?.pageCount} words=${proj?.wordCount} pageDataBlocks=${proj?.pageData?.length}`
    );
    record(
      "FIX6.1 Upload: NO auto-start (status stays 'ready' until Begin click)",
      proj?.status === "ready",
      `status=${proj?.status} (expected "ready")`
    );

    const dropzoneText = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div.rounded-xl")].find((d) => d.textContent.includes("Upload English PDF"));
      return el ? el.innerText : "";
    });
    record(
      "FIX6.1 Upload: compact chip ('filename • N pages • N words'), no text editor dump",
      dropzoneText.toLowerCase().includes("onyx-test-book.pdf") && /5 pages • [\d,]+ words/.test(dropzoneText) && !dropzoneText.includes("Paste your text here"),
      `chip: "${(dropzoneText.match(/onyx-test-book\.pdf[\s\S]{0,40}/i) || ["?"])[0].replace(/\n/g, " ").trim()}"`
    );

    const beginBtn = page.getByRole("button", { name: /Begin Translation|Select languages to begin/ });
    const disabledBefore = !(await beginBtn.isEnabled());
    await page.getByRole("button", { name: "LA", exact: true }).click();
    const enabledAfter = await beginBtn.isEnabled();
    record(
      "FIX6.1 Begin button: disabled pre-selection → enabled after language pick",
      disabledBefore && enabledAfter,
      `disabled before=${disabledBefore}, enabled after picking LA=${enabledAfter}`
    );
    // Persist for the follow-on 'begin' stage (same browser profile/session
    // cannot be shared across runs, so 'begin' re-uploads via import of the
    // saved export instead — see stage 'begin').
    await ctx.close();
  }

  if (stage === "begin") {
    // Fresh page: restore the uploaded project from its session, then Begin.
    const { ctx, page } = await newPage(browser);
    const sessionId = await page.evaluate(() => sessionStorage.getItem("onyx-session-id"));
    await page.setInputFiles('input[type="file"][accept=".pdf,application/pdf"]', BOOK_PDF);
    await page.waitForFunction(
      () => document.body.innerText.toLowerCase().includes("onyx-test-book.pdf"),
      { timeout: 180000 }
    ).catch(() => {});
    await page.waitForTimeout(3000);
    const proj = await convexPost("query", "queries:getLatestProject", { sessionId });

    const beginBtn = page.getByRole("button", { name: /Begin Translation|Select languages to begin/ });
    await page.getByRole("button", { name: "LA", exact: true }).click();
    await beginBtn.click();
    await page.waitForFunction(
      () => document.body.innerText.includes("Translating") || document.body.innerText.includes("View Progress") || document.body.innerText.includes("Overall progress"),
      { timeout: 60000 }
    ).catch(() => {});
    const started = consoleLines.some((l) => l.includes("[Onyx] translateLanguage started"));
    record(
      "FIX6.1 Begin click → translateLanguage action fired (console log evidence)",
      started,
      consoleLines.filter((l) => l.includes("[Onyx] translateLanguage")).slice(-1)[0] ?? "(log missing)"
    );
    const t0 = Date.now();
    let latinStatus = "";
    while (Date.now() - t0 < 300000) {
      const trs = await convexPost("query", "queries:getProjectTranslations", { projectId: proj._id, sessionId }).catch(() => []);
      latinStatus = trs.find((t) => t.langCode === "la")?.status ?? "absent";
      if (latinStatus === "complete") break;
      await page.waitForTimeout(10000);
    }
    record(
      "FIX6.1 End-to-end: client-initiated translation completed server-side",
      latinStatus === "complete",
      `la status after client Begin: ${latinStatus} (waited ${Math.round((Date.now() - t0) / 1000)}s)`
    );
    // Export in the same session, right after language completion
    const exportBtn = page.getByTitle("Export progress");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), exportBtn.click()]);
    const exportPath = "/tmp/onyx-client-export.json";
    await download.saveAs(exportPath);
    const backup = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    const topKeys = Object.keys(backup);
    record(
      "FIX6.4 Export: .json downloads via Blob→anchor click and parses",
      topKeys.includes("project") && topKeys.includes("translations"),
      `top-level keys: ${topKeys.join(", ")}`
    );
    record(
      "FIX6.4 Export JSON contents (fullText/pageData/parsedPages/chunks/langCodes)",
      !!backup.project?.fullText && Array.isArray(backup.project?.pageData) && backup.project?.parsedPages != null && !!backup.chunks && Array.isArray(backup.langCodes),
      `project keys: ${Object.keys(backup.project || {}).join(", ")}; chunks for ${Object.keys(backup.chunks || {}).length} lang(s); langCodes=[${(backup.langCodes || []).join(",")}]`
    );
    await ctx.close();
  }

  if (stage === "drop") {
    const { ctx, page } = await newPage(browser);
    const sessionId = await page.evaluate(() => sessionStorage.getItem("onyx-session-id"));
    const b64 = fs.readFileSync(SMALL_PDF).toString("base64");
    await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const file = new File([bin], "onyx-extraction-test.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const dz = [...document.querySelectorAll("div")].find(
        (d) => typeof d.className === "string" && d.className.includes("border-dashed") && d.textContent.includes("Drop PDF here")
      );
      dz.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, b64);
    await page.waitForFunction(() => document.body.innerText.toLowerCase().includes("onyx-extraction-test.pdf"), { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const proj = await convexPost("query", "queries:getLatestProject", { sessionId });
    const dropFired = consoleLines.some((l) => l.includes("handleDrop fired"));
    record(
      "FIX6.2 Drag-and-drop: drop event → handleDrop → upload pipeline → project row",
      dropFired && proj?.fileName?.toLowerCase() === "onyx-extraction-test.pdf",
      `handleDrop log=${dropFired}; getLatestProject → ${proj?.fileName} status=${proj?.status} pages=${proj?.pageCount}`
    );
    await ctx.close();
  }

  if (stage === "large") {
    const { bytes, pages, size } = await makeLargePdf();
    const bigPath = "/tmp/onyx-large-regression.pdf";
    fs.writeFileSync(bigPath, bytes);
    console.log(`large test pdf: ${pages} pages, ${(size / 1048576).toFixed(1)}MB`);

    const { ctx, page } = await newPage(browser);
    const sessionId = await page.evaluate(() => sessionStorage.getItem("onyx-session-id"));
    await page.setInputFiles('input[type="file"][accept=".pdf,application/pdf"]', bigPath);
    // The NON-BLOCKING notice must appear as a DOM toast, then processing continues.
    const infoToast = await page
      .getByText("Large file — translation will take longer")
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForFunction(
      () => document.body.innerText.toLowerCase().includes("onyx-large-regression.pdf"),
      { timeout: 420000 }
    ).catch(() => {});
    await page.waitForTimeout(5000);
    const proj = await convexPost("query", "queries:getLatestProject", { sessionId });
    const rejected = consoleLines.some((l) => l.includes("must be under 10MB") || l.includes("300 pages or fewer"));
    record(
      "FIX6.5 Large file (>10MB, >300 pages) NOT rejected — processed to project creation",
      !rejected && proj?.fileName?.toLowerCase() === "onyx-large-regression.pdf" && proj?.status === "ready",
      `rejection toast=${rejected}; non-blocking info toast (DOM)=${infoToast}; project created: ${proj?.fileName} pages=${proj?.pageCount} (310 expected) status=${proj?.status}`
    );
    await ctx.close();
  }

  if (stage === "import") {
    const { ctx, page } = await newPage(browser);
    const sessionId = await page.evaluate(() => sessionStorage.getItem("onyx-session-id"));
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByTitle("Import progress").click(),
    ]);
    await chooser.setFiles("/tmp/onyx-client-export.json");
    // Success toast renders in the DOM (sonner) — poll [data-sonner-toast].
    let importToast = null;
    for (let i = 0; i < 30 && !importToast; i++) {
      await page.waitForTimeout(500);
      importToast = await page.evaluate(
        () => [...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent || "").find((s) => s.includes("Imported")) ?? null
      );
    }
    const proj = await convexPost("query", "queries:getLatestProject", { sessionId });
    const beginVisible = await page.evaluate(() => document.body.innerText.includes("Begin Translation") || document.body.innerText.includes("Select languages to begin"));
    record(
      "FIX6.3 Import (fresh session): importProject action returns → project restored",
      !!importToast && proj?.fileName?.toLowerCase() === "onyx-test-book.pdf",
      `toast="${importToast ?? "(none)"}"; latest project=${proj?.fileName} status=${proj?.status}`
    );
    const trs = await convexPost("query", "queries:getProjectTranslations", { projectId: proj._id, sessionId }).catch(() => []);
    record(
      "FIX6.3 Import: translations + langCodes restored, Begin ready",
      trs.length > 0 && beginVisible,
      `${trs.length} translation row(s) imported (${trs.map((t) => t.langCode + ":" + t.status).join(", ")}); Begin button visible=${beginVisible}`
    );
    await ctx.close();
  }
} finally {
  await browser.close();
}

if (stage !== "summary") {
  const allErrors = pageErrors.filter((e) => !e.includes("Warning"));
  record(
    `FIX6.6 No uncaught page exceptions (stage: ${stage})`,
    allErrors.length === 0,
    allErrors.length ? allErrors.slice(0, 3).join(" || ") : "0 uncaught page errors"
  );
  fs.writeFileSync(`/tmp/clientpath-${stage}.json`, JSON.stringify(results, null, 1));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n[${stage}] ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
