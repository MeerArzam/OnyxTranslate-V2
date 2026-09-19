#!/usr/bin/env node
/**
 * scripts/verifyAdaptivePipeline.mjs — P13 probe runner (quota-free).
 * Drives convex/adaptiveTestProbes.ts against the deployed deployment and
 * prints a PASS/FAIL table. A dedicated throwaway project row is created so
 * the probes never touch real user data.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const URL = process.env.CONVEX_URL || "https://successful-iguana-419.convex.cloud";
const client = new ConvexHttpClient(URL);

const results = [];
function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
  console.log(`${pass ? "✅ PASS" : "❌ FAIL"}  ${name}  ${JSON.stringify(evidence)}`);
}

async function main() {
  // 0. deployment awake?
  const ping = await client.query(api.queries.getProject, { projectId: undefined }).catch((e) => {
    throw new Error(`Deployment not reachable/paused: ${e.message}`);
  }).catch(() => null);
  void ping;

  // Create a throwaway project for limiter/governor probes
  const projectId = await client.mutation(api.mutations.createProject, {
    sessionId: "adaptive-probe-session",
    fileName: "__probe_do_not_use__",
    pageCount: 1,
    wordCount: 1,
    pageData: [],
    fullText: "probe",
    parsedPages: 1,
    status: "cancelled", // cancelled → dispatcher never picks it up
  });

  try {
    // Pure probes (no project needed)
    const est = await client.mutation(api.adaptiveTestProbes.probeEstimator, {});
    record("estimator: oversized→single, tiny→pair", est.pass, est);

    const parser = await client.mutation(api.adaptiveTestProbes.probePairParser, {});
    record("pair parser: markers/empty/missing/echo", parser.pass, parser);

    const backoff = await client.mutation(api.adaptiveTestProbes.probeBackoff, {});
    record("backoff: exponential + cap + Retry-After", backoff.pass, backoff);

    // Limiter probe
    const limiter = await client.mutation(api.adaptiveTestProbes.probeRateLimiter, { projectId });
    record(`rate limiter: refuses after ${limiter.target}/min`, limiter.pass, limiter);

    // Daily governor probe
    const governor = await client.mutation(api.adaptiveTestProbes.probeDailyGovernor, { projectId });
    record("daily governor: stop at 1200 + midnight reset", governor.pass, governor);

    // Enqueue idempotency probe
    const enq = await client.mutation(api.adaptiveTestProbes.probeEnqueueIdempotent, {
      projectId,
      langCode: "la",
    });
    record("enqueue idempotent: duplicate start = 0 new jobs", enq.pass, enq);

    // Cleanup: delete the throwaway project + its probe rows
    await client.mutation(api.mutations.deleteProject, { projectId, sessionId: "adaptive-probe-session" }).catch(() => {});
  } catch (e) {
    record("probe execution", false, { error: e.message });
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n==== ${passed}/${results.length} PASS ====`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
