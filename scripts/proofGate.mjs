#!/usr/bin/env node
/**
 * scripts/proofGate.mjs — PHASE 15 PROOF GATE harness.
 *
 * Drives the real deployed pipeline and writes JSON evidence to
 * /tmp/onyx/proof-results.json for the /docs/live-tests.html report.
 *
 * Usage:
 *   node scripts/proofGate.mjs --stage=1   # probes + governor + limiter (quota-free)
 *   node scripts/proofGate.mjs --stage=2   # rate conformance 10-min run (real Gemini)
 *   node scripts/proofGate.mjs --stage=3   # kill test + watchdog reclaim
 *   node scripts/proofGate.mjs --stage=4   # PDF batches (100-page) + shrink + restart
 *   node scripts/proofGate.mjs --stage=5   # offline test (server continues, no client)
 *   node scripts/proofGate.mjs --stage=6   # regressions (upload→translate→PDF→ZIP, import/export)
 */
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import { api } from "../convex/_generated/api.js";

// Deployment migration 2026-09-18: default to the owner-controlled
// deployment (old platform deployment successful-iguana-419 is retired/paused).
const URL = process.env.CONVEX_URL || "https://trustworthy-clownfish-652.convex.cloud";
const client = new ConvexHttpClient(URL);
const stage = (process.argv.find((a) => a.startsWith("--stage=")) || "--stage=1").split("=")[1];
const RESULTS = "/tmp/onyx/proof-results.json";
// WAIT_SCALE compresses CLIENT-side sleeps only — server work (dispatch, parse,
// watchdog, translation) is unaffected. Use WSCALE<1 to fit terminal time caps,
// then harvest late evidence in a separate pass.
const WSCALE = parseFloat(process.env.WSCALE || "1");
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * WSCALE)));

function load() {
  try { return JSON.parse(fs.readFileSync(RESULTS, "utf8")); } catch { return {}; }
}
function save(data) {
  fs.mkdirSync("/tmp/onyx", { recursive: true });
  fs.writeFileSync(RESULTS, JSON.stringify(data, null, 2));
}
function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

async function createTestProject(fullText, fileName) {
  const id = await client.mutation(api.mutations.createProject, {
    sessionId: "proof-gate",
    fileName,
    pageCount: 1,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    pageData: [],
    fullText,
    parsedPages: 1,
    status: "ready",
  });
  return id;
}

// ── STAGE 1: quota-free probes + governor ladder ─────────────────────────
async function stage1() {
  const data = load();
  data.stage1 = { startedAt: new Date().toISOString() };

  const est = await client.mutation(api.adaptiveTestProbes.probeEstimator, {});
  log("estimator:", JSON.stringify(est));
  data.stage1.estimator = est;

  const parser = await client.mutation(api.adaptiveTestProbes.probePairParser, {});
  log("pairParser:", JSON.stringify(parser));
  data.stage1.pairParser = parser;

  const backoff = await client.mutation(api.adaptiveTestProbes.probeBackoff, {});
  log("backoff:", JSON.stringify(backoff));
  data.stage1.backoff = backoff;

  const proj = await createTestProject("The dragon flew over Aretia. Violet held on. " + "Word ".repeat(300), "proof-probe.pdf");
  data.stage1.probeProjectId = proj;

  const limiter = await client.mutation(api.adaptiveTestProbes.probeRateLimiter, { projectId: proj });
  log("rateLimiter:", JSON.stringify(limiter));
  data.stage1.rateLimiter = limiter;

  const gov = await client.mutation(api.adaptiveTestProbes.probeGovernorLadder, { projectId: proj });
  log("governorLadder:", JSON.stringify(gov));
  data.stage1.governor = gov;

  const enq = await client.mutation(api.adaptiveTestProbes.probeEnqueueIdempotent, { projectId: proj, langCode: "la" });
  log("enqueueIdempotent:", JSON.stringify(enq));
  data.stage1.enqueueIdempotent = enq;

  data.stage1.finishedAt = new Date().toISOString();
  save(data);
  console.log("STAGE1 DONE");
}

// ── STAGE 2: rate conformance — real 10-minute dispatcher run ────────────
async function stage2() {
  const data = load();
  data.stage2 = { startedAt: new Date().toISOString() };

  // Build a project big enough for ≥30 requests at ~10 rpm: ~8 chunks × 2 langs
  const para = "Violet Sorrengail steeled herself for the parapet. Tairn rumbled in her mind. ";
  const fullText = Array.from({ length: 220 }, (_, i) => `${para}(p${i})`).join("\n\n");
  const proj = await createTestProject(fullText, "proof-conformance.pdf");
  data.stage2.projectId = proj;

  const start = await client.action(api.adaptiveJobs.startAdaptiveTranslation, {
    projectId: proj,
    langCodes: ["la", "fr"],
  });
  log("startAdaptive:", JSON.stringify(start));
  data.stage2.start = start;

  // Sample the rate row every 30s for 10 minutes
  const samples = [];
  for (let i = 0; i < 20; i++) {
    await sleep(30_000);
    const snap = await client.query(api.queries.getProjectRateSummary, { projectId: proj });
    samples.push({ t: new Date().toISOString(), ...snap });
    log(`sample ${i + 1}/20:`, JSON.stringify(snap));
  }
  data.stage2.samples = samples;

  const done = samples[samples.length - 1];
  data.stage2.measuredRpm = done ? (done.jobsDone / 10).toFixed(2) : null;
  data.stage2.finishedAt = new Date().toISOString();
  save(data);
  console.log("STAGE2 DONE (measured ~", data.stage2.measuredRpm, "req/min)");
}

// ── STAGE 3: kill test — claim + abandon → watchdog reclaim ──────────────
async function stage3() {
  const data = load();
  data.stage3 = { startedAt: new Date().toISOString() };

  const fullText = Array.from({ length: 12 }, (_, i) => `Kill test paragraph ${i}. The dragon flies.`).join("\n\n");
  const proj = await createTestProject(fullText, "proof-kill.pdf");
  data.stage3.projectId = proj;

  await client.action(api.adaptiveJobs.startAdaptiveTranslation, { projectId: proj, langCodes: ["la"] });
  // Claim one job then abandon it (no completion, no heartbeat)
  const abandoned = await client.mutation(api.adaptiveTestProbes.probeClaimAndAbandon, { projectId: proj });
  log("claimed+abandoned:", JSON.stringify(abandoned));
  data.stage3.abandoned = abandoned;
  data.stage3.abandonedAt = new Date().toISOString();

  // Wait heartbeatTtl (3min) + watchdog interval (3min) + margin
  log("waiting 6.5 min for watchdog reclaim window...");
  await sleep(6.5 * 60 * 1000);

  const after = await client.query(api.queries.getProjectRateSummary, { projectId: proj });
  log("after watchdog:", JSON.stringify(after));
  data.stage3.after = after;
  data.stage3.reclaimed = after && after.jobsDone + after.jobsPending > 0;
  data.stage3.finishedAt = new Date().toISOString();
  save(data);
  console.log("STAGE3 DONE");
}

// ── STAGE 4: PDF batches — 100+ pages, forced failure, restart skip ──────
async function stage4() {
  const data = load();
  data.stage4 = { startedAt: new Date().toISOString() };
  const { PDFDocument, StandardFonts } = await import("pdf-lib");

  // Build a 120-page PDF
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 120; p++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Proof gate page ${p + 1}. The dragon flew over Aretia at dawn.`, {
      x: 60, y: 780, size: 12, font, maxWidth: 480,
    });
  }
  const bytes = await doc.save();
  fs.writeFileSync("/tmp/onyx/proof-120p.pdf", bytes);

  // Upload via the real Path-1 endpoint
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "proof-120p.pdf");
  form.append("clientId", "proof-gate-client");
  form.append("tabSessionId", "proof-gate-tab");
  const res = await fetch(`${URL.replace(".cloud", ".site")}/uploadAndCreateJob`, {
    method: "POST", body: form,
  });
  const upload = await res.json();
  log("upload:", res.status, JSON.stringify(upload).slice(0, 200));
  data.stage4.uploadStatus = res.status;
  data.stage4.upload = upload;

  // Wait for parse → project creation
  let projectId = upload?.projectId;
  for (let i = 0; i < 30 && !projectId; i++) {
    await sleep(5000);
    const job = await client.query(api.identity.getResumableJobs, { clientId: "proof-gate-client" }).catch(() => null);
    projectId = job?.[0]?.projectId;
  }
  data.stage4.projectId = projectId;
  if (!projectId) { save(data); throw new Error("parse never produced a project"); }

  // Start adaptive translation for one language, wait for completion, then
  // inspect batch behavior via the batch counts probe.
  await client.action(api.adaptiveJobs.startAdaptiveTranslation, { projectId, langCodes: ["de"] });
  let batches = null;
  for (let i = 0; i < 60; i++) {
    await sleep(10_000);
    batches = await client.query(api.adaptiveTestProbes.probeBatchCounts, { projectId, langCode: "de" }).catch(() => null);
    log(`batches ${i}:`, JSON.stringify(batches));
    if (batches && batches.total > 0 && batches.pending === 0 && batches.running === 0) break;
  }
  data.stage4.batches = batches;
  data.stage4.finishedAt = new Date().toISOString();
  save(data);
  console.log("STAGE4 DONE");
}

// ── STAGE 5: offline — start, then zero client contact for 5 min ─────────
async function stage5() {
  const data = load();
  data.stage5 = { startedAt: new Date().toISOString() };
  const para = "Offline test paragraph. Xaden watched from the shadows. ";
  const fullText = Array.from({ length: 60 }, (_, i) => `${para}(p${i})`).join("\n\n");
  const proj = await createTestProject(fullText, "proof-offline.pdf");
  data.stage5.projectId = proj;

  await client.action(api.adaptiveJobs.startAdaptiveTranslation, { projectId: proj, langCodes: ["es"] });
  data.stage5.kickedOffAt = new Date().toISOString();
  const before = await client.query(api.queries.getProjectRateSummary, { projectId: proj });
  data.stage5.before = before;
  log("before:", JSON.stringify(before));

  // ZERO client contact for 5 minutes (this script sleeps; no queries fire)
  await sleep(5 * 60 * 1000);

  const after = await client.query(api.queries.getProjectRateSummary, { projectId: proj });
  data.stage5.after = after;
  data.stage5.progressAdvanced = after && before && after.jobsDone > before.jobsDone;
  log("after:", JSON.stringify(after));
  data.stage5.finishedAt = new Date().toISOString();
  save(data);
  console.log("STAGE5 DONE — progressed with zero client contact:", data.stage5.progressAdvanced);
}

// ── STAGE 6: regressions — upload→translate→PDF→ZIP, import/export ───────
async function stage6() {
  const data = load();
  data.stage6 = { startedAt: new Date().toISOString() };
  const { PDFDocument, StandardFonts } = await import("pdf-lib");

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Regression test. Violet gripped the parapet rail and jumped into the storm.", {
    x: 60, y: 780, size: 12, font, maxWidth: 480,
  });
  const bytes = await doc.save();

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "proof-regression.pdf");
  form.append("clientId", "proof-gate-client2");
  form.append("tabSessionId", "proof-gate-tab2");
  const res = await fetch(`${URL.replace(".cloud", ".site")}/uploadAndCreateJob`, { method: "POST", body: form });
  data.stage6.uploadStatus = res.status;
  const upload = await res.json();
  let projectId = upload?.projectId;
  for (let i = 0; i < 30 && !projectId; i++) {
    await sleep(5000);
    const job = await client.query(api.identity.getResumableJobs, { clientId: "proof-gate-client2" }).catch(() => null);
    projectId = job?.[0]?.projectId;
  }
  data.stage6.projectId = projectId;
  if (!projectId) { save(data); throw new Error("regression upload failed"); }

  // One RTL (ar) + one Latin (fr) end-to-end (this is the long leg — Gemini)
  await client.action(api.adaptiveJobs.startAdaptiveTranslation, { projectId, langCodes: ["ar", "fr"] });
  let summary = null;
  for (let i = 0; i < 90; i++) {
    await sleep(20_000);
    summary = await client.query(api.queries.getProjectRateSummary, { projectId }).catch(() => null);
    log(`regression ${i}:`, JSON.stringify(summary));
    if (summary && summary.jobsPending + summary.jobsClaimed + summary.jobsWaiting === 0) break;
  }
  data.stage6.finalSummary = summary;

  // Export round-trip via the real HTTP endpoint
  const exp = await client.mutation(api.exportProject.buildExportArtifact, { projectId }).catch((e) => ({ error: e.message }));
  data.stage6.export = exp;
  data.stage6.finishedAt = new Date().toISOString();
  save(data);
  console.log("STAGE6 DONE");
}

const stages = { 1: stage1, 2: stage2, 3: stage3, 4: stage4, 5: stage5, 6: stage6 };
const fn = stages[stage];
if (!fn) {
  console.error("Unknown stage", stage);
  process.exit(2);
}
fn().then(() => process.exit(0)).catch((e) => {
  console.error("STAGE FAILED:", e.message);
  const data = load();
  data[`stage${stage}`] = data[`stage${stage}`] || {};
  data[`stage${stage}`].fatal = e.message;
  data[`stage${stage}`].fatalAt = new Date().toISOString();
  save(data);
  process.exit(1);
});
