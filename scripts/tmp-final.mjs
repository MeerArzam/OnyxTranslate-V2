#!/usr/bin/env node
// TEMP final proof — REAL Gemini end-to-end. Deleted after report.
// Resume-safe: re-running with an existing evidence file continues polling.
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import { api } from "../convex/_generated/api.js";

const client = new ConvexHttpClient("https://quixotic-tapir-141.convex.cloud");
const OUT = "/tmp/onyx/final-proof.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const ev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(ev, null, 2));

// ── Phase 0: pre-flight key probe (no quota cost) ──
if (!ev.keysProbe) {
  log("KEY PROBE");
  try {
    const kp = await client.action(api.probes.runAllKeysProbe, {});
    ev.keysProbe = kp;
  } catch (e) { ev.keysProbe = { error: e.message.slice(0, 200) }; }
  save();
  log("keysProbe:", JSON.stringify(ev.keysProbe).slice(0, 400));
}

// ── Phase 1: create project + start translation ──
if (!ev.projectId) {
  const text = [
    "The desert railway ran twice a week, carrying dates, salt, and letters between two oases that hated each other politely.",
    "The conductor, an old man named Haroun, kept every undelivered letter in a wooden box under his seat. Over forty years the box grew heavy with apologies nobody dared to send.",
    "When he finally retired, the railway gave him a gold watch that stopped working in the first month. He fixed it himself, and for the rest of his life it ran exactly four minutes fast — one minute for each of his children, he said, who always arrived late.",
    "The letters stayed in the box. His daughter found them after the funeral, and mailed every single one, stampless, from the last station on the line.",
  ].join("\n\n");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  log("CREATE PROJECT", wordCount, "words");
  ev.startedAt = new Date().toISOString();
  ev.wordCount = wordCount;
  ev.projectId = await client.mutation(api.mutations.createProject, {
    sessionId: "final-proof",
    fileName: "Final proof.txt",
    pageCount: 1,
    wordCount,
    pageData: [],
    fullText: text,
    parsedPages: 1,
    status: "ready",
  });
  save();
  const t0 = Date.now();
  const start = await client.action(api.adaptiveJobs.startAdaptiveTranslation, {
    projectId: ev.projectId,
    langCodes: ["ur"],
  });
  ev.startLatencyMs = Date.now() - t0;
  ev.startResult = start;
  save();
  log("START:", JSON.stringify(start), "latency", ev.startLatencyMs, "ms projectId", ev.projectId);
}

// ── Phase 2: poll to done (auto-heal via reconcileDoneChunks if stuck) ──
let healed = ev.healed ?? 0;
const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  await sleep(5000);
  const jobs = await client.query(api.adaptiveTestProbes.probeJobsByProject, { projectId: ev.projectId });
  const trans = await client.query(api.queries.getTranslationsRaw, { projectId: ev.projectId });
  const proj = await client.query(api.queries.getProjectRaw, { projectId: ev.projectId });
  const ur = (trans ?? []).find((t) => t.langCode === "ur");
  const j = (jobs?.jobs ?? [])[0];
  const row = {
    at: new Date().toISOString(),
    elapsedSec: Math.round((Date.now() - t0) / 1000) + (ev.elapsedBeforeResumeSec ?? 0),
    job: j ? { status: j.status, attempts: j.attempts, reclaimCount: j.reclaimCount ?? 0 } : null,
    trans: ur ? { status: ur.status, completedChunks: ur.completedChunks, totalChunks: ur.totalChunks, pdfUrl: ur.pdfUrl ? "YES" : null } : null,
    projectStatus: proj?.status,
  };
  ev.polls = ev.polls ?? [];
  ev.polls.push(row);
  save();
  log(`poll ${i} +${row.elapsedSec}s job=${j?.status}/${j?.attempts}a trans=${ur?.status} pdf=${row.trans?.pdfUrl ?? "no"}`);
  if (ur?.pdfUrl) { ev.pdfUrl = ur.pdfUrl; break; }
  // Auto-heal: job stuck in-flight while its chunk is already done (flush/reclaim race)
  const stuck = j && j.status !== "done" && j.status !== "failed" && j.status !== "needs_review" && ur?.status !== "complete" && i - healed >= 4;
  const chunkDone = ur && ur.completedChunks > 0;
  if (stuck && chunkDone && healed < 2) {
    healed++;
    ev.healed = healed;
    const rec = await client.mutation(api.adaptiveJobs.reconcileDoneChunks, { projectId: ev.projectId });
    ev.reconcile = rec;
    save();
    log("RECONCILE:", JSON.stringify(rec));
  }
  if (proj?.status === "complete" && ur?.pdfUrl) break;
}
ev.finishedPollingAt = new Date().toISOString();
save();

// ── Phase 3: download + verify ──
if (ev.pdfUrl && !ev.download) {
  const res = await fetch(ev.pdfUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  ev.download = {
    httpStatus: res.status,
    bytes: buf.length,
    magic: buf.subarray(0, 5).toString("latin1"),
    isPdf: buf.subarray(0, 5).toString("latin1") === "%PDF-",
  };
  fs.writeFileSync("/tmp/onyx/final-proof-ur.pdf", buf);
  save();
  log("DOWNLOAD:", JSON.stringify(ev.download));
}
log("DONE — evidence in", OUT);
