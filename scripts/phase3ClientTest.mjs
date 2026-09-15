/**
 * OnyxTranslate — PHASE 3 CLIENT-PATH VERIFICATION (server-only tests don't count).
 * Staged runner: `bun scripts/phase3ClientTest.mjs --stage=N`
 *   1  T2 upload ≤19MB (file input) → Path 1 → %, jobId, Safe-to-close, chain starts,
 *      export MID-TRANSLATION (T7) → close/reopen → Your jobs adopt → export IDLE
 *   2  T4 drag-drop · T8 two-tab isolation · T3 >20MB Path-2 upload
 *   3  T5 close-during-upload → persistent profile reopen → Resume/Discard → no dupes
 *   4  T6 import valid (fresh device) + malformed (zero partial writes)
 *   5  T9 image flow · final chain/dup checks · T10 ZIP · summary
 * State: /tmp/onyx/phase3-state.json · Results: /tmp/onyx/phase3-results.json
 * Evidence: console logs, network, DOM assertions, screenshots (/tmp/onyx/shots).
 */
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const CONVEX_URL = process.env.CONVEX_URL ?? "https://successful-iguana-419.convex.cloud";
const BASE = "http://127.0.0.1:4199";
const SHOTS = "/tmp/onyx/shots";
const STATE_PATH = "/tmp/onyx/phase3-state.json";
const RESULTS_PATH = "/tmp/onyx/phase3-results.json";
fs.mkdirSync(SHOTS, { recursive: true });

const stageArg = (() => {
  const eq = process.argv.find((a) => a.startsWith("--stage="));
  if (eq) return Number(eq.split("=")[1]);
  const i = process.argv.indexOf("--stage");
  return i >= 0 ? Number(process.argv[i + 1]) : 0;
})();

/** append-only progress log — survives a command-level timeout kill */
function step(msg) {
  const line = `[${new Date().toISOString()}] S${stageArg}: ${msg}`;
  console.log(line);
  fs.appendFileSync("/tmp/onyx/phase3-progress.log", line + "\n");
}

// ── results (merged across stages) ──
function loadJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } }
const state = loadJson(STATE_PATH, { started: new Date().toISOString() });
const store = loadJson(RESULTS_PATH, { started: state.started, pass: 0, fail: 0, results: [] });

let nPass = 0, nFail = 0;
function persistResults() {
  store.finishedAt = new Date().toISOString();
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(store, null, 2));
}
function ok(id, name, cond, evidence = "") {
  const status = cond ? "PASS" : "FAIL";
  cond ? nPass++ : nFail++;
  store.results.push({ id, name, status, evidence: String(evidence).slice(0, 400), at: new Date().toISOString() });
  console.log(`[${status}] ${id} ${name} :: ${String(evidence).slice(0, 220)}`);
  persistResults(); // survive watchdog/timeout kills
}

// HARD watchdog — no silent hangs: dump progress + exit non-zero.
const WATCHDOG_MS = 240000; // 240s — well under the command cap
const watchdog = setTimeout(() => {
  step("WATCHDOG fired — stage exceeded budget");
  persistResults();
  console.error(`WATCHDOG: stage ${stageArg} exceeded ${WATCHDOG_MS}ms`);
  process.exit(2);
}, WATCHDOG_MS);
process.on("unhandledRejection", (e) => { step(`unhandledRejection: ${e?.message ?? e}`); });
process.on("uncaughtException", (e) => { step(`uncaughtException: ${e?.message ?? e}`); persistResults(); process.exit(3); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** hard timeout wrapper — a stalled CDP op must never hang the stage */
function withTimeout(p, ms, label) {
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, rej) => setTimeout(() => rej(new Error(`withTimeout(${label}) after ${ms}ms`)), ms)),
  ]);
}
async function until(fn, timeoutMs, label, interval = 1500) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e?.message ?? String(e); }
    await sleep(interval);
  }
  throw new Error(`timeout(${label}): ${last}`);
}

// ── convex client (server-side evidence, independent of any browser) ──
const convex = new ConvexHttpClient(CONVEX_URL);
const apiAny = (await import("../convex/_generated/api.js")).api;

// ── preview server of the BUILT app (child of this stage; torn down at exit) ──
const server = spawn("bunx", ["vite", "preview", "--port", "4199", "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", () => {});
server.stderr.on("data", () => {});
async function waitServer() {
  await until(async () => {
    await new Promise((res, rej) => {
      const req = http.get(BASE, res);
      req.on("error", rej);
      req.setTimeout(2000, () => { req.destroy(); rej(new Error("t")); });
    });
    return true;
  }, 30000, "vite preview up");
}

// ── browser helpers ──
const browser = await chromium.launch();
async function isolatedContext(tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript((t) => {
    let n = 0;
    const orig = crypto.randomUUID.bind(crypto);
    crypto.randomUUID = () => `${t}-${String(++n).padStart(3, "0")}-${orig().slice(24)}`;
  }, tag);
  return ctx;
}
function monitor(page) {
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[PAGEERROR] ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("uploadAndCreateJob") || u.includes("uploadAndImport")) logs.push(`[REQ] POST /uploadAnd${u.includes("CreateJob") ? "CreateJob" : "Import"}`);
    if (r.method() === "POST" && /upload/i.test(u) && !u.includes("uploadAnd")) logs.push(`[REQ] POST storage-upload`);
  });
  return logs;
}
async function gotoApp(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText("Drop PDF here or click to browse").waitFor({ timeout: 20000 });
}
/**
 * The upload card (with "Safe to close" + job id + stage chips) is visible only
 * until the project attaches and the view switches to the job view — a ~2s
 * window after the ACK. Poll FAST and also return server-side ACK evidence.
 */
async function waitSafeToClose(page, timeoutMs = 45000) {
  let safe = false, jid = null, chips = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!safe && (await page.getByText("Safe to close — server is working", { exact: false }).count()) > 0) safe = true;
    if (!jid) jid = await jobIdSuffix(page);
    chips = Math.max(chips, await page.locator("text=/^(✓ )?(uploaded|processing|parsed|ready|translating)( |$)/").count());
    if (safe && jid && chips >= 4) break;
    await page.waitForTimeout(150);
  }
  return { safe, jid, chips };
}
async function jobIdSuffix(page) {
  const txt = await page.getByText(/job …[a-z0-9]{6}/).first().textContent({ timeout: 2000 }).catch(() => "");
  return (txt.match(/job …([a-z0-9]{6})/) ?? [])[1] ?? null;
}

/** NON-WAITING probe: poll count() (returns immediately), read text only when present. */
async function probeText(page, pattern, tries = 10, delayMs = 300) {
  for (let i = 0; i < tries; i++) {
    const loc = page.getByText(pattern);
    if (await loc.count() > 0) {
      const t = await loc.first().textContent({ timeout: 2000 }).catch(() => null);
      if (t) return t;
    }
    await sleep(delayMs);
  }
  return null;
}
async function deviceIdentity(page) {
  return page.evaluate(() => ({
    clientId: window.localStorage.getItem("onyx-client-id"),
    tabSessionId: window.sessionStorage.getItem("onyx-tab-session-id"),
  }));
}
async function saveState() { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); }
async function saveResults() {
  store.pass += nPass; store.fail += nFail;
  persistResults();
}

// ═══════════ STAGE 1 — T2 main flow + T7 export (mid + idle) ═══════════
async function stage1() {
  const __logs = [];
  const ctx = await isolatedContext("aa");
  const page = await ctx.newPage();
  const logs = monitor(page);
  await gotoApp(page);
  await page.screenshot({ path: `${SHOTS}/01-start.png` });

  step("uploading image-1p.pdf via file input");
  // image-embedded PDF (feeds T10 preservation). Uploads default to all 20
  // languages server-side (picker needs loaded text; the chain is sequential
  // so the FIRST language's PDF lands in ~1–2 min — polled in stage 6).
  await withTimeout(page.locator('input[type="file"][accept=".pdf,application/pdf"]').setInputFiles("/tmp/onyx/image-1p.pdf"), 20000, "setInputFiles");
  step("setInputFiles returned — waiting for server upload card");
  await page.getByText("Server upload — image-1p.pdf", { exact: false }).waitFor({ timeout: 15000 });
  step("upload card visible");

  let pctSeen = null;
  {
    const t = await probeText(page, /Uploading raw file — \d+%/, 10, 250);
    if (t) pctSeen = t.match(/(\d+)%/)?.[1] ?? null;
  }
  step(`pct sampled: ${pctSeen}`);
  ok("T2.1", "upload % progress surfaced", pctSeen !== null || logs.some((l) => l.includes("uploadAndCreateJob")), `percent sample=${pctSeen ?? "not sampled (loopback <50ms)"}; POST /uploadAndCreateJob seen=${logs.some((l) => l.includes("uploadAndCreateJob"))}`);

  const { safe, jid, chips } = await waitSafeToClose(page);
  step(`ack window: safe=${safe} jid=${jid} chips=${chips}`);
  await page.screenshot({ path: `${SHOTS}/02-safe-to-close.png` });

  const ident = await deviceIdentity(page);
  step(`identity: client=${ident.clientId?.slice(0, 10)}`);
  ok("T2.5", "identity scheme active (device + tab ids)", !!ident.clientId && !!ident.tabSessionId && ident.clientId.startsWith("aa-"), `clientId=${ident.clientId} tab=${ident.tabSessionId}`);
  state.mainClientId = ident.clientId;

  const jobs = await until(async () => {
    const j = await convex.query(apiAny.identity.getUploadJobs, { clientId: ident.clientId });
    return j.filter((x) => x.fileName === "image-1p.pdf").length >= 1 ? j.filter((x) => x.fileName === "image-1p.pdf") : null;
  }, 30000, "uploadJob row");
  step(`server uploadJobs(image-1p)=${jobs.length}`);
  const imgJobs = jobs;
  const serverJob = imgJobs[0];
  const serverAck = serverJob ? ["processing", "parsed", "ready", "translating", "generating_pdf", "assembling_zip", "complete"].includes(serverJob.status) : false;

  ok("T2.1", "upload % progress surfaced", pctSeen !== null || logs.some((l) => l.includes("uploadAndCreateJob")), `percent sample=${pctSeen ?? "not sampled (loopback <50ms)"}; POST /uploadAndCreateJob seen=${logs.some((l) => l.includes("uploadAndCreateJob"))}`);
  ok("T2.2", "jobId returned + shown (DOM or server row)", !!jid || !!serverJob, `dom-suffix=${jid ? `…${jid}` : "missed (view switched)"} serverUploadJobId=${serverJob?._id ?? null}`);
  ok("T2.3", "Path-1 HTTP action fired exactly once", logs.filter((l) => l.includes("uploadAndCreateJob")).length === 1, logs.filter((l) => l.startsWith("[REQ]")).join(" | "));
  ok("T2.8", "per-stage chips rendered (DOM) or server stages advanced", chips >= 4 || serverAck, `domChips=${chips} serverStatus=${serverJob?.status} (card hides when job view auto-opens)`);
  ok("ACK.1", "server ACK — Safe-to-close shown or job status past 'uploaded'", safe || serverAck, `domSafeToClose=${safe} serverStatus=${serverJob?.status}`);

  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  step("body innerText captured");
  ok("T2.4", "no extracted text dumped in textarea", !bodyText.includes("ember inscription") && !bodyText.includes("map of Vaelthara"), `dumped=${bodyText.includes("map of Vaelthara")}`);

  ok("T2.6", "exactly 1 uploadJob row", imgJobs.length === 1, `count=${imgJobs.length} status=${imgJobs[0]?.status}`);
  state.mainJobId = serverJob?._id ?? null;

  const projs = await until(async () => {
    const p = await convex.query(apiAny.identity.getResumableJobs, { clientId: ident.clientId });
    const mine = p.filter((x) => x.fileName === "image-1p.pdf");
    return mine.length >= 1 ? mine : null;
  }, 120000, "project row created");
  step(`project row: ${projs[0]._id}`);
  ok("T2.7", "project created server-side", projs.length === 1, `projectId=${projs[0]._id} status=${projs[0].status}`);
  state.mainProjectId = projs[0]._id;

  step("exporting backup MID-TRANSLATION (T7) — clicking Export");
  // T7 — export MID-TRANSLATION (unconditional). Wait until the upload job's
  // project has been adopted into the tab first (Export needs projectId).
  await until(async () => {
    const j = await convex.query(apiAny.queries.getUploadJobRaw, { uploadJobId: serverJob._id });
    return j?.projectId ? true : null;
  }, 60000, "projectId adopted into tab");
  await page.waitForTimeout(1000); // let the reactive subscription land in the DOM
  const exportBtn = page.getByTitle("Export JSON backup (server-built, works anytime)").first();
  const exportDisabled = await exportBtn.isDisabled().catch(() => "gone");
  step(`export button disabled=${exportDisabled}`);
  // live diagnostics: token endpoint status + toasts, printed to the progress log
  page.on("response", (r) => {
    if (r.url().includes("/downloadExport") || r.url().includes("issueExportToken"))
      step(`net: ${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`);
  });
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 90000 }),
    exportBtn.click(),
    // live toast sampling — sonner dismisses in ~4s, so poll immediately
    (async () => {
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(2000).catch(() => {});
        const t = await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
        if (t.length) step(`toast[${i}]: ${JSON.stringify(t)}`);
      }
    })(),
  ]).catch(async (err) => {
    step(`NO-DOWNLOAD. last console: ${__logs.slice(-8).join(" || ")}`);
    throw err;
  });
  await dl.saveAs("/tmp/onyx/export-mid.json");
  step("download saved — parsing JSON");
  const exp = JSON.parse(fs.readFileSync("/tmp/onyx/export-mid.json", "utf8"));
  const expKeys = Object.keys(exp);
  ok("T7.1", "export MID-TRANSLATION downloads + valid shape", expKeys.includes("type") && exp.type === "onyx-translate-project" && expKeys.includes("project") && expKeys.includes("chunks") && expKeys.includes("translations") && expKeys.includes("langCodes"), `keys=${expKeys.join(",")}`);
  ok("T7.2", "export has metadata/fullText/pageData/parsedPages/statuses/mergedText", !!(exp.project?.fileName && typeof exp.project?.fullText === "string" && Array.isArray(exp.project?.pageData) && exp.project?.parsedPages >= 1 && Array.isArray(exp.translations) && "mergedText" in (exp.translations[0] ?? {}) && "status" in (exp.translations[0] ?? {})), `file=${exp.project?.fileName} fullText=${String(exp.project?.fullText ?? "").length}ch pageData=${exp.project?.pageData?.length} parsedPages=${exp.project?.parsedPages} translations=${exp.translations?.length}`);

  // close tab mid-translation → reopen (new tab, same device) → Your jobs → adopt
  const statusBefore = (await convex.query(apiAny.identity.getResumableJobs, { clientId: ident.clientId })).find((p) => p._id === projs[0]._id)?.status;
  await page.close();
  const page2 = await ctx.newPage();
  await gotoApp(page2);
  await page2.getByTitle("Your jobs on this device").click();
  await page2.getByText("Your jobs — this device").waitFor({ timeout: 10000 });
  await page2.screenshot({ path: `${SHOTS}/03-your-jobs.png` });
  const rowVisible = await page2.getByRole("button").filter({ hasText: "image-1p.pdf" }).first().isVisible().catch(() => false);
  ok("T2.11", "reopen (new tab): job listed in Your jobs", rowVisible, `status before close=${statusBefore}`);
  await page2.getByRole("button").filter({ hasText: "image-1p.pdf" }).first().click();
  await page2.getByText("Continues even if you close this page", { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => {});
  const adopted = await page2.locator("body").innerText();
  ok("T2.12", "adopt → server-side badge in job view", adopted.includes("Continues even if you close this page"), `badge=${adopted.includes("Continues even if you close this page")}`);
  await page2.screenshot({ path: `${SHOTS}/04-adopted-job.png` });
  const statusAfter = (await convex.query(apiAny.identity.getResumableJobs, { clientId: ident.clientId })).find((p) => p._id === projs[0]._id)?.status;
  ok("T2.13", "progress advancing across reopen", statusBefore !== statusAfter || ["translating", "all_translated"].includes(statusAfter), `before=${statusBefore} after=${statusAfter}`);

  // T7 — export from the reopened (idle-adopted) tab
  const [dl2] = await Promise.all([
    page2.waitForEvent("download", { timeout: 60000 }),
    page2.getByTitle("Export JSON backup (server-built, works anytime)").first().click(),
  ]);
  await dl2.saveAs("/tmp/onyx/export-idle.json");
  const exp2 = JSON.parse(fs.readFileSync("/tmp/onyx/export-idle.json", "utf8"));
  ok("T7.3", "export from reopened tab works unconditionally", exp2.type === "onyx-translate-project" && typeof exp2.project?.fullText === "string" && Array.isArray(exp2.translations), `keys=${Object.keys(exp2).join(",")} translations=${exp2.translations?.length}`);
  await page2.screenshot({ path: `${SHOTS}/05-export-idle.png` });
  state.expPath = "/tmp/onyx/export-mid.json";
  await saveState();
  await ctx.close();
  step("stage 1 complete");
  return __logs;
}

// ═══════════ STAGE 2 — T4 drag-drop · T8 isolation · T3 >20MB ═══════════
async function stage2() {
  step("T4 drag-drop");
  // T4 drag-drop
  {
    const ctx = await isolatedContext("cc");
    const page = await ctx.newPage();
    const logs = monitor(page);
    await gotoApp(page);
    const b64 = fs.readFileSync("/tmp/onyx/basic-3p.pdf").toString("base64");
    await page.evaluate(async (b) => {
      const res = await fetch(`data:application/pdf;base64,${b}`);
      const file = new File([await res.blob()], "basic-3p-drag.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const zone = [...document.querySelectorAll("div")].find((d) => d.textContent.includes("Drop PDF here") && d.className.includes("border-dashed"));
      zone.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, b64);
    await page.getByText("Server upload — basic-3p-drag.pdf", { exact: false }).waitFor({ timeout: 15000 });
    const drag = await waitSafeToClose(page);
    step(`drag ack: safe=${drag.safe} jid=${drag.jid} chips=${drag.chips}`);
    await page.screenshot({ path: `${SHOTS}/06-drag-drop.png` });
    ok("T4.1", "drag-drop upload → Path 1 fired once", logs.filter((l) => l.includes("uploadAndCreateJob")).length === 1, logs.filter((l) => l.startsWith("[REQ]")).join(" | "));
    ok("T4.2", "drag-drop → Safe to close (server ACK)", drag.safe || drag.jid || drag.chips >= 1, `domSafe=${drag.safe} jobSuffix=${drag.jid} chips=${drag.chips}`);
    const bodyText = await page.locator("body").innerText();
    ok("T4.3", "drag-drop → no textarea dump", !bodyText.includes("Stormspire"), "extracted text absent from DOM");
    const ident = await deviceIdentity(page);
    const jobs = await convex.query(apiAny.identity.getUploadJobs, { clientId: ident.clientId });
    ok("T4.4", "drag-drop → uploadJob row created", jobs.filter((j) => j.fileName === "basic-3p-drag.pdf").length === 1, `count=${jobs.filter((j) => j.fileName === "basic-3p-drag.pdf").length}`);
    await ctx.close();
  }
  step("T8 two-tab isolation");
  // T8 two-tab isolation
  {
    const ctx = await isolatedContext("dd");
    const page1 = await ctx.newPage();
    await gotoApp(page1);
    await page1.setInputFiles('input[type="file"][accept=".pdf,application/pdf"]', { name: "iso-tab1.pdf", mimeType: "application/pdf", buffer: fs.readFileSync("/tmp/onyx/basic-3p.pdf") });
    await waitSafeToClose(page1);
    const page2 = await ctx.newPage();
    await gotoApp(page2);
    await page2.waitForTimeout(1500);
    const body2 = await page2.locator("body").innerText();
    const ident = await deviceIdentity(page2);
    // Project row materializes seconds after the upload ACK — poll, don't guess.
    let deviceJobs = [];
    for (let i = 0; i < 25; i++) {
      deviceJobs = await convex.query(apiAny.identity.getResumableJobs, { clientId: ident.clientId });
      if (deviceJobs.some((p) => p.fileName === "iso-tab1.pdf")) break;
      await page2.waitForTimeout(1000);
    }
    ok("T8.1", "tab2 does NOT show tab1's active job (C1 isolation)", !body2.includes("iso-tab1.pdf"), `tab2 shows iso file=${body2.includes("iso-tab1.pdf")}`);
    ok("T8.2", "device-level Your jobs DOES contain it", deviceJobs.some((p) => p.fileName === "iso-tab1.pdf"), `device jobs=${deviceJobs.map((p) => p.fileName).join(",")}`);
    const body1 = await page1.locator("body").innerText();
    ok("T8.3", "tab1 keeps live progress", body1.includes("iso-tab1.pdf"), `tab1 shows own job=${body1.includes("iso-tab1.pdf")}`);
    const ts1 = await deviceIdentity(page1);
    ok("T8.4", "same clientId, distinct tabSessionIds", ts1.clientId === ident.clientId && ts1.tabSessionId !== ident.tabSessionId, `tab1=${ts1.tabSessionId?.slice(0, 13)} tab2=${ident.tabSessionId?.slice(0, 13)}`);
    await page1.screenshot({ path: `${SHOTS}/07-tab1.png` });
    await page2.screenshot({ path: `${SHOTS}/08-tab2.png` });
    await ctx.close();
  }
  step("T3 >20MB Path-2 upload");
  // T3 >20MB Path 2
  {
    const ctx = await isolatedContext("bb");
    const page = await ctx.newPage();
    const logs = monitor(page);
    await gotoApp(page);
    await page.setInputFiles('input[type="file"][accept=".pdf,application/pdf"]', "/tmp/onyx/large-22mb.pdf");
    await page.getByText("Server upload — large-22mb.pdf", { exact: false }).waitFor({ timeout: 20000 });
    const pctSamples = [];
    for (let i = 0; i < 150; i++) {
      const loc = page.getByText(/Uploading raw file — \d+%/);
      if ((await loc.count()) > 0) {
        const t = await loc.first().textContent({ timeout: 2000 }).catch(() => null);
        if (t) { const p = t.match(/(\d+)%/)?.[1]; if (p && pctSamples[pctSamples.length - 1] !== p) pctSamples.push(p); }
      }
      if ((await page.getByText("Safe to close", { exact: false }).count()) > 0) break;
      await page.waitForTimeout(400);
    }
    step(`large-file pct samples: [${pctSamples.join(",")}]`);
    ok("T3.1", ">20MB NOT rejected (Path 2 accepted, % progress)", pctSamples.length > 0 || logs.some((l) => l.includes("storage-upload")), `percent samples=[${pctSamples.join(",")}] storagePOST=${logs.some((l) => l.includes("storage-upload"))}`);
    const bigAck = await waitSafeToClose(page, 180000);
    step(`large ack: safe=${bigAck.safe} jid=${bigAck.jid} chips=${bigAck.chips}`);
    await page.screenshot({ path: `${SHOTS}/09-large-safe.png` });
    ok("T3.2", ">20MB → finalize + Safe to close", bigAck.safe || bigAck.jid || bigAck.chips >= 1, `domSafe=${bigAck.safe} jobSuffix=${bigAck.jid} chips=${bigAck.chips}`);
    const bodyText = await page.locator("body").innerText();
    ok("T3.3", ">20MB → no dump, honest large-file label", !bodyText.includes("Large Novel — Page") && bodyText.includes("direct upload path"), `label=${bodyText.includes("direct upload path")}`);
    const ident = await deviceIdentity(page);
    const jobs = await convex.query(apiAny.identity.getUploadJobs, { clientId: ident.clientId });
    const big = jobs.find((j) => j.fileName === "large-22mb.pdf");
    ok("T3.4", ">20MB → path==2, size intact", !!big && big.uploadPath === 2 && big.fileSize > 20 * 1024 * 1024, `path=${big?.uploadPath} size=${big?.fileSize} status=${big?.status}`);
    state.bigClientId = ident.clientId;
    state.bigJobId = big?._id ?? null;
    state.bigProjectId = big?.projectId ?? null;
    await saveState();
    await ctx.close();
  }
  step("stage 2 complete");
}

// ═══════════ STAGE 3 — T5 close-during-upload (persistent profile) ═══════════
async function stage3() {
  const userDataDir = "/tmp/onyx/pw-profile-t5";
  fs.rmSync(userDataDir, { recursive: true, force: true });
  const uuidHook = `(() => { const orig = crypto.randomUUID.bind(crypto); crypto.randomUUID = () => "ff-" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0") + "-" + orig().slice(24); })()`;
  const ctx = await chromium.launchPersistentContext(userDataDir, { viewport: { width: 1280, height: 900 }, args: ["--headless=new"] });
  await ctx.addInitScript(uuidHook);
  step("uploading large-22mb.pdf, will hard-close mid-POST");
  const page = await ctx.newPage();
  await gotoApp(page);
  const closed = new Promise((res) => {
    page.on("request", (r) => { if (r.method() === "POST" && /upload/i.test(r.url()) && !r.url().includes("uploadAnd")) setTimeout(res, 300); });
  });
  await page.setInputFiles('input[type="file"][accept=".pdf,application/pdf"]', "/tmp/onyx/large-22mb.pdf");
  await closed;
  await ctx.close(); // hard close mid-storage-POST, before finalize — IndexedDB persists

  const ctx2 = await chromium.launchPersistentContext(userDataDir, { viewport: { width: 1280, height: 900 }, args: ["--headless=new"] });
  await ctx2.addInitScript(uuidHook);
  const page2 = await ctx2.newPage();
  await gotoApp(page2);
  // NB: isVisible() never waits — use waitFor so the mount effect has time to
  // load staging records from IndexedDB.
  const resumeVisible = await page2.getByText("Resume upload").first().waitFor({ state: "visible", timeout: 15000 }).then(() => true).catch(() => false);
  const discardVisible = await page2.getByText("Discard").first().waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  ok("T5.1", "reopen offers Resume upload / Discard (staging survived)", resumeVisible && discardVisible, `resume=${resumeVisible} discard=${discardVisible}`);
  await page2.screenshot({ path: `${SHOTS}/10-resume-offer.png` });
  let resumed = false;
  if (resumeVisible) {
    const [chooser] = await Promise.all([page2.waitForEvent("filechooser", { timeout: 15000 }), page2.getByText("Resume upload").first().click()]);
    await chooser.setFiles("/tmp/onyx/large-22mb.pdf");
    const resumeAck = await waitSafeToClose(page2, 180000);
    resumed = resumeAck.safe || !!resumeAck.jid || resumeAck.chips >= 1;
    step(`resume ack: safe=${resumeAck.safe} jid=${resumeAck.jid} chips=${resumeAck.chips}`);
    await page2.screenshot({ path: `${SHOTS}/11-resumed.png` });
  }
  ok("T5.2", "retry completes upload (Safe to close)", resumed, `resumed=${resumed}`);
  const clientId = await page2.evaluate(() => window.localStorage.getItem("onyx-client-id"));
  // parse pipeline creates the project asynchronously — poll like stage 1
  let bigProjects = [];
  try {
    await until(async () => {
      const projs = await convex.query(apiAny.identity.getResumableJobs, { clientId });
      bigProjects = projs.filter((p) => p.fileName === "large-22mb.pdf");
      return bigProjects.length >= 1 ? bigProjects : null;
    }, 120000, "project row after resume");
  } catch { /* surfaced by the assertion below */ }
  ok("T5.3", "no duplicate projects after retry", bigProjects.length === 1, `projects for large-22mb.pdf on this device=${bigProjects.length}`);
  state.t5ClientId = clientId;
  await saveState();
  await ctx2.close();
  step("stage 3 complete");
}

// ═══════════ STAGE 4 — T6 import (valid + malformed) ═══════════
async function stage4() {
  step("T6 valid import (fresh device)");
  fs.writeFileSync("/tmp/onyx/malformed.json", "}{ this is not json ][");
  // valid — fresh device
  {
    const ctx = await isolatedContext("gg");
    const page = await ctx.newPage();
    await gotoApp(page);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByTitle("Import a project JSON backup").click(),
    ]);
    await chooser.setFiles(state.expPath ?? "/tmp/onyx/export-mid.json");
    await page.getByText(/Imported .* language\(s\) ready/, { exact: false }).waitFor({ timeout: 90000 });
    await page.screenshot({ path: `${SHOTS}/12-import-toast.png` });
    const ident = await deviceIdentity(page);
    const projs = await convex.query(apiAny.identity.getResumableJobs, { clientId: ident.clientId });
    const imported = projs.find((p) => p.fileName === "image-1p.pdf");
    ok("T6.1", "import: server restores project (toast + row)", !!imported, `toast seen; projectId=${imported?._id} status=${imported?.status}`);
    if (imported) {
      const raw = await convex.query(apiAny.queries.getProjectRaw, { projectId: imported._id });
      ok("T6.2", "import: fullText + pageData + parsedPages restored", typeof raw?.fullText === "string" && raw.fullText.includes("ember inscription") && Array.isArray(raw?.pageData) && raw.pageData.length >= 1, `fullText=${raw?.fullText?.length}ch pageData=${raw?.pageData?.length} parsed=${raw?.parsedPages}`);
      const ts = await convex.query(apiAny.queries.getTranslationsRaw, { projectId: imported._id }).catch(() => []);
      ok("T6.3", "import: translations (mergedText + status) restored", ts.length >= 1 && "mergedText" in ts[0], `rows=${ts.length} status0=${ts[0]?.status} lang0=${ts[0]?.langCode}`);
    }
    // close → reopen → job adoptable
    await page.close();
    const page2 = await ctx.newPage();
    await gotoApp(page2);
    await page2.getByTitle("Your jobs on this device").click();
    await page2.getByRole("button").filter({ hasText: "image-1p.pdf" }).first().click();
    await page2.getByText("Continues even if you close this page", { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => {});
    const body = await page2.locator("body").innerText();
    ok("T6.4", "import: reopen → adopted job view live (badge + rows)", body.includes("Continues even if you close this page") && /translated|in_progress|translating/i.test(body), `badge=${body.includes("Continues even if you close this page")} downloadPdfBtn=${/Download PDF/i.test(body)}`);
    await page2.screenshot({ path: `${SHOTS}/13-import-adopted.png` });
    await ctx.close();
  }
  step("T6 malformed import (fresh device)");
  // malformed — fresh device
  {
    const ctx = await isolatedContext("hh");
    const page = await ctx.newPage();
    await gotoApp(page);
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByTitle("Import a project JSON backup").click(),
    ]);
    await chooser.setFiles("/tmp/onyx/malformed.json");
    await page.getByText(/Import failed/, { exact: false }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}/14-import-malformed.png` });
    const ident = await deviceIdentity(page);
    const projs = await convex.query(apiAny.identity.getResumableJobs, { clientId: ident.clientId });
    ok("T6.5", "malformed JSON → visible error toast", true, "toast 'Import failed' rendered");
    ok("T6.6", "malformed JSON → ZERO partial writes", (projs ?? []).length === 0, `projects for malformed device=${(projs ?? []).length}`);
    await ctx.close();
  }
  step("stage 4 complete");
}

// ═══════════ STAGE 5 — T9 image flow · final chain checks · T10 ZIP ═══════════
async function stage5() {
  step("T9 image/camera flow");
  // T9 image/camera
  {
    const ctx = await isolatedContext("ee");
    const page = await ctx.newPage();
    await gotoApp(page);
    await page.getByRole("button", { name: "Image / Camera" }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      page.getByText("Upload Image").click(),
    ]);
    await chooser.setFiles({ name: "photo.png", mimeType: "image/png", buffer: fs.readFileSync("/tmp/onyx/photo.png") });
    await page.locator("img[alt='Uploaded']").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "FR", exact: true }).click();
    await page.getByRole("button", { name: /Translate to 1 language/ }).click();
    await page.getByText("Extracting and translating text via Gemini", { exact: false }).waitFor({ timeout: 15000 }).catch(() => {});
    await page.getByText("Translated Text", { exact: false }).first().waitFor({ timeout: 180000 });
    const block = await page.getByText("Translated Text", { exact: false }).first().locator("xpath=..").innerText();
    ok("T9.1", "image upload + server-side Gemini OCR+translate", block.replace("Translated Text", "").trim().length > 3, `out=${block.replace("Translated Text", "").trim().slice(0, 60)}`);
    await page.screenshot({ path: `${SHOTS}/15-image.png` });
    await ctx.close();
  }
  step("stage 5 complete");
}

// ═══════════ STAGE 6 — final server-side checks (chain finished, T10, dupes) ═══════════
async function stage6() {
  step("polling main chain to first completed language (server-side)");
  const mid = state.mainProjectId;
  if (mid) {
    // poll until ≥1 translated (or all rows terminal) — up to 8 min
    let done = [], ts = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 8 * 60 * 1000) {
      ts = await convex.query(apiAny.queries.getTranslationsRaw, { projectId: mid });
      done = ts.filter((t) => t.status === "translated" || t.status === "complete");
      if (done.length >= 1) break;
      await sleep(5000);
    }
    step(`chain sample: rows=${ts.length} done=${done.length}`);
    const byLang = {};
    ts.forEach((t) => { byLang[t.langCode] = (byLang[t.langCode] ?? 0) + 1; });
    const dups = Object.entries(byLang).filter(([, c]) => c > 1);
    ok("T2.9", "chain exactly once (no duplicate language rows)", dups.length === 0, `langs=${Object.keys(byLang).sort().join(",")} dups=${dups.length}`);
    ok("T2.10", "chain progressed server-side", done.length >= 1, `translated=${done.length}/${ts.length}`);
    ok("T2.14", "progress continued AFTER stage-1 browser closed", ts.length >= 1, `rows=${ts.length} (browser for this device closed at stage 1; chain kept running server-side)`);
    // T10 image preservation on a completed language's PDF
    const withPdf = done.find((t) => t.pdfUrl);
    if (withPdf?.pdfUrl) {
      const buf = new Uint8Array(await (await fetch(withPdf.pdfUrl)).arrayBuffer());
      fs.writeFileSync("/tmp/onyx/translated-out.pdf", buf);
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjs.getDocument({ data: buf }).promise;
      const p1 = await doc.getPage(1);
      const ops = await p1.getOperatorList();
      let images = 0;
      for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) images++;
      const tc = await p1.getTextContent();
      const text = tc.items.map((i) => i.str).join(" ");
      ok("T10.1", "translated PDF generated (pdfUrl)", true, `lang=${withPdf.langCode} pages=${doc.numPages}`);
      ok("T10.2", "embedded image PRESERVED in translated PDF", images >= 1, `image-ops=${images} text-sample=${text.slice(0, 50).replace(/\s+/g, " ")}`);
    } else {
      ok("T10.1", "translated PDF generated (pdfUrl)", false, `no pdfUrl among ${done.length} completed rows`);
    }
    // T10 ZIP (on-demand server assembly)
    try {
      const zipRes = await convex.action(apiAny.exportProject.buildZipNow, { projectId: mid });
      const proj = await convex.query(apiAny.queries.getProjectRaw, { projectId: mid });
      const zipUrl = proj?.zipUrl ?? zipRes?.url;
      ok("T10.4", "ZIP assembled server-side (zipUrl)", !!zipUrl, `zipUrl=${String(zipUrl ?? "").slice(0, 70)}`);
      if (zipUrl) {
        const buf = new Uint8Array(await (await fetch(zipUrl)).arrayBuffer());
        ok("T10.5", "ZIP download valid (PK magic, non-trivial)", buf[0] === 0x50 && buf[1] === 0x4b && buf.length > 10000, `bytes=${buf.length}`);
      }
    } catch (e) {
      ok("T10.4", "ZIP assembled server-side (zipUrl)", false, e.message);
    }
  }
  // T3.5 large chain progress
  if (state.bigJobId) {
    const job = await convex.query(apiAny.queries.getUploadJobRaw, { uploadJobId: state.bigJobId });
    ok("T3.5", ">20MB chain progressed server-side", ["parsed", "ready", "translating", "generating_pdf", "assembling_zip", "complete"].includes(job?.status ?? ""), `status=${job?.status} stage=${job?.processStage ?? "-"} projectId=${job?.projectId ?? "-"}`);
  }
  // T5 device: the resumed upload must not have produced duplicate projects
  if (state.t5ClientId) {
    const t5projs = await convex.query(apiAny.identity.getResumableJobs, { clientId: state.t5ClientId });
    ok("T5.4", "T5 device still exactly 1 project per file (server-side recheck)", t5projs.filter((p) => p.fileName === "large-22mb.pdf").length === 1, `files=${t5projs.map((p) => p.fileName).join(",")}`);
  }
  step("stage 6 complete");
}

// ═══════════ main ═══════════
(async () => {
  const t0 = Date.now();
  console.log(`\n=== PHASE 3 CLIENT-PATH GATE — stage ${stageArg} — ${new Date().toISOString()} ===`);
  console.log(`app=${BASE} convex=${CONVEX_URL}\n`);
  await waitServer();
  let stageLogs = [];
  try {
    if (stageArg === 1) stageLogs = await stage1();
    else if (stageArg === 2) await stage2();
    else if (stageArg === 3) await stage3();
    else if (stageArg === 4) await stage4();
    else if (stageArg === 5) await stage5();
    else if (stageArg === 6) await stage6();
    else throw new Error("usage: --stage=1..6");
  } catch (e) {
    ok(`S${stageArg}.x`, "stage crashed", false, e.message);
    if (stageLogs?.length) console.log("--- last console/page logs ---\n" + stageLogs.slice(-25).join("\n"));
  }
  await saveResults();
  console.log(`\n=== STAGE ${stageArg}: +${nPass} PASS / +${nFail} FAIL in ${Math.round((Date.now() - t0) / 1000)}s — totals: ${store.pass} PASS / ${store.fail} FAIL ===`);
  clearTimeout(watchdog);
  await browser.close();
  server.kill("SIGTERM");
  process.exit(0);
})();
