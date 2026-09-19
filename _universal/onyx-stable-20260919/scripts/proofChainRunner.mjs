#!/usr/bin/env node
/**
 * scripts/proofChainRunner.mjs — waits for deployment wake, then runs
 * p0Forensic + proofGate stages sequentially, saving evidence to
 * /tmp/onyx/proof-results.json (same file the harnesses use).
 *
 * Usage:
 *   node scripts/proofChainRunner.mjs [--from=1] [--poll-secs=15] [--max-wait-min=45]
 *
 * Exit codes:
 *   0 = chain complete
 *   3 = never woke within --max-wait-min (STILL_PAUSED)
 *   4 = deployment re-paused mid-chain (runner.interruptedAtStage records where)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const from = parseInt(args.from || "1", 10);
const pollSecs = parseInt(args["poll-secs"] || "15", 10);
const maxWaitMin = parseInt(args["max-wait-min"] || "45", 10);
const RESULTS = "/tmp/onyx/proof-results.json";
const URL = process.env.CONVEX_URL || "https://successful-iguana-419.convex.cloud";
const client = new ConvexHttpClient(URL);

const load = () => {
  try { return JSON.parse(fs.readFileSync(RESULTS, "utf8")); } catch { return {}; }
};
const save = (d) => {
  fs.mkdirSync("/tmp/onyx", { recursive: true });
  fs.writeFileSync(RESULTS, JSON.stringify(d, null, 2));
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

function runNode(cmd, argv, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn("node", [cmd, ...argv], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const t = setTimeout(() => {
      out += "\n[RUNNER] hard timeout killed child";
      p.kill("SIGKILL");
    }, timeoutMs);
    p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    p.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
    p.on("exit", (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

async function isAwake() {
  try {
    await client.query(api.queries.getProjectRateSummary, { projectId: "wake-probe-nonexistent" });
    return true; // responded fine
  } catch (e) {
    const msg = String(e?.message || e);
    if (/paused/i.test(msg)) return false; // still paused
    return true; // any other server response = deployment is running functions
  }
}

async function main() {
  const d0 = load();
  d0.runner = { ...(d0.runner || {}), startedAt: new Date().toISOString(), from, pid: process.pid };
  save(d0);

  // 1) Wait for wake
  const deadline = Date.now() + maxWaitMin * 60 * 1000;
  let awake = false;
  while (Date.now() < deadline) {
    if (await isAwake()) { awake = true; break; }
    log("deployment still PAUSED; re-polling in", pollSecs, "s");
    await new Promise((r) => setTimeout(r, pollSecs * 1000));
  }
  if (!awake) {
    const d = load();
    d.runner = { ...(d.runner || {}), result: "STILL_PAUSED", checkedUntil: new Date().toISOString() };
    save(d);
    log("STILL_PAUSED — giving up after", maxWaitMin, "min");
    process.exit(3);
  }
  log("*** DEPLOYMENT AWAKE at", new Date().toISOString(), "***");
  {
    const d = load();
    d.runner = { ...(d.runner || {}), awakeAt: new Date().toISOString() };
    save(d);
  }

  // 2) Forensic on the real project first
  const fr = await runNode("scripts/p0Forensic.mjs", [], 120_000);
  {
    const d = load();
    d.forensic = {
      ...(d.forensic || {}),
      exitCode: fr.code,
      ranAt: new Date().toISOString(),
      tail: fr.out.split("\n").slice(-50).join("\n"),
    };
    save(d);
    log("p0Forensic exit", fr.code);
  }

  // 3) Proof-gate stages
  for (let s = Math.max(1, from); s <= 6; s++) {
    const ds = load();
    ds[`stage${s}`] = { ...(ds[`stage${s}`] || {}), runnerStartedAt: new Date().toISOString() };
    save(ds);
    log(`=== STAGE ${s} START ===`);
    const stageTimeoutMs = s === 1 ? 180_000 : 40 * 60_000;
    const r = await runNode("scripts/proofGate.mjs", [`--stage=${s}`], stageTimeoutMs);
    const d = load();
    d[`stage${s}`] = {
      ...(d[`stage${s}`] || {}),
      exitCode: r.code,
      runnerFinishedAt: new Date().toISOString(),
    };
    if (r.code !== 0) d[`stage${s}`].runnerNote = "stage exited non-zero — see fatal/output";
    save(d);

    if (/paused/i.test(r.out)) {
      const dd = load();
      dd.runner = {
        ...(dd.runner || {}),
        interruptedAtStage: s,
        interruptedAt: new Date().toISOString(),
        reason: "deployment re-paused mid-chain",
      };
      save(dd);
      log(`DEPLOYMENT RE-PAUSED during stage ${s}; chain halted. Restart with --from=${s}`);
      process.exit(4);
    }
    if (r.code !== 0) log(`stage ${s} exited ${r.code}; continuing to next stage (evidence saved).`);
  }

  const df = load();
  df.runner = { ...(df.runner || {}), finishedAt: new Date().toISOString(), result: "CHAIN_COMPLETE" };
  save(df);
  log("CHAIN_COMPLETE");
}

main().catch((e) => {
  log("RUNNER FATAL:", e?.message || e);
  const d = load();
  d.runner = { ...(d.runner || {}), fatal: String(e?.message || e), fatalAt: new Date().toISOString() };
  save(d);
  process.exit(1);
});
