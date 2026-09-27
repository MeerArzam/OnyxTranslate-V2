#!/usr/bin/env node
// TEMP dispatcher driver — deleted after report. Resume-safe via final-proof.json.
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";
import { api } from "../convex/_generated/api.js";

const c = new ConvexHttpClient("https://quixotic-tapir-141.convex.cloud");
const P = "kd7c7ya0eebxk74xq0qt7kbred8f71py";
const OUT = "/tmp/onyx/final-proof.json";
const ev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(ev, null, 2));

const t0 = Date.now();
while (Date.now() - t0 < 150_000) {
  const trans = await c.query(api.queries.getTranslationsRaw, { projectId: P });
  const ur = (trans ?? []).find((t) => t.langCode === "ur");
  if (ur?.pdfUrl) {
    ev.pdfUrl = ur.pdfUrl;
    ev.pdfAt = new Date().toISOString();
    save();
    console.log("PDF READY:", ur.pdfUrl);
    break;
  }
  const proj = await c.query(api.queries.getProjectRaw, { projectId: P });
  const rate = await c.query(api.adaptiveTestProbes.probeRateSnapshot, { projectId: P });
  const staleMs = Date.now() - (rate?.lastRequestAt ?? 0);
  const jobs = await c.query(api.adaptiveTestProbes.probeJobsByProject, { projectId: P });
  const j = (jobs?.jobs ?? [])[0];
  console.log(new Date().toISOString(), `job=${j?.status} staleReq=${Math.round(staleMs / 1000)}s gov=${proj?.governorState}`);
  if (j?.status === "done") { console.log("JOB DONE — waiting for PDF chain"); }
  if (staleMs > 90_000 && proj?.status === "translating") {
    const w = await c.action(api.probes.runWatchdogOnce, {});
    ev.watchdogTicks = (ev.watchdogTicks ?? 0) + 1;
    save();
    console.log("  → watchdog:", JSON.stringify(w).slice(0, 160));
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
save();
console.log("driver exit");
