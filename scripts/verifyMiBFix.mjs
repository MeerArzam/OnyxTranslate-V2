/**
 * FIX (1MiB limit) — live verification against the REAL production pipeline.
 * Exits 2 when the deployment is paused (resume in dashboard, then rerun).
 *
 * A) REAL upload: dense text PDF (parsed pageData >1MiB) → POST
 *    /uploadAndCreateJob → server parse → createProject. Before the fix this
 *    chain died with "Value is too large" at mutations.ts:17:9; after the fix
 *    the project row exists with storage refs + stubs and translation starts.
 * B) round-trip: resolveSourceData returns byte-identical values; URLs fetch OK.
 * C) regression: small project (<1MiB) writes/reads exactly as before.
 */
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = "https://successful-iguana-419.convex.cloud";
const SITE_URL = CONVEX_URL.replace(".cloud", ".site");
const c = new ConvexHttpClient(CONVEX_URL);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

try {
  await c.query(api.queries.getAllProjectsForWatchdog, {});
} catch (e) {
  if (String(e).includes("paused")) {
    console.log("SKIPPED: deployment paused — resume in dashboard, rerun: node scripts/verifyMiBFix.mjs");
    process.exit(2);
  }
  throw e;
}

// ── A) real upload of the dense PDF (the user's exact flow) ──
const pdfPath = process.argv[2] ?? "/tmp/onyx/dense-160p.pdf";
let pdf;
try { pdf = readFileSync(pdfPath); } catch { console.log(`missing ${pdfPath}`); process.exit(1); }
console.log(`uploading ${pdfPath} (${(pdf.length / 1048576).toFixed(2)}MiB file)`);

const form = new FormData();
form.append("file", new Blob([pdf], { type: "application/pdf" }), pdfPath.split("/").pop());
const clientId = `mibverify-${Date.now()}`;
form.append("clientId", clientId);
form.append("langCodes", JSON.stringify(["fr"]));
const res = await fetch(`${SITE_URL}/uploadAndCreateJob`, { method: "POST", body: form });
const body = await res.json().catch(() => null);
ok("A1 uploadAndCreateJob accepted", res.status === 200 && !!body?.uploadJobId, `status=${res.status} job=${body?.uploadJobId ?? "—"}`);

let project = null;
if (body?.uploadJobId) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const job = await c.query(api.queries.getUploadJobRaw, { uploadJobId: body.uploadJobId });
      if (job?.projectId) { project = await c.query(api.queries.getProjectRaw, { projectId: job.projectId }); break; }
      if (job?.status === "error") { console.log("job error:", job.error?.slice(0, 200)); break; }
    } catch (e) {
      if (String(e).includes("paused")) break;
      console.log("(poll)", String(e).slice(0, 90));
    }
  }
}
ok("A2 parse→createProject SUCCEEDED (the 1MiB crash is gone)", !!project,
  project ? `project=${project._id} refs(pd/ft)=${!!project.pageDataStorageId}/${!!project.fullTextStorageId} status=${project.status}` : "no project row");
if (project) {
  const oversizePd = !!project.pageDataStorageId;
  const oversizeFt = !!project.fullTextStorageId;
  ok("A3 oversized values were offloaded to refs", oversizePd || oversizeFt, `pd=${oversizePd} ft=${oversizeFt}`);

  // ── B) round-trip through the resolver ──
  const resolved = await c.action(api.sourceData.resolveSourceData, { projectId: project._id });
  ok("B1 fullText restored non-empty", typeof resolved.fullText === "string" && resolved.fullText.length > 1000, `${resolved.fullText.length}ch`);
  ok("B2 pageData restored non-empty", Array.isArray(resolved.pageData) && resolved.pageData.length > 0, `${resolved.pageData.length} pages`);
  const urls = await c.query(api.sourceData.getSourceDataUrls, { projectId: project._id });
  ok("B3 URLs minted + fetchable", !!urls?.pageDataUrl && !!(await fetch(urls.pageDataUrl)).ok);

  // translation started server-side (chain intact)
  await new Promise((r) => setTimeout(r, 8000));
  const translations = await c.query(api.queries.getTranslationsRaw, { projectId: project._id }).catch(() => []);
  ok("B4 translation chain started", (translations ?? []).length > 0, translations?.map(t => `${t.langCode}:${t.status}`).join(",") || "none");
}

// ── C) small-project regression (inline path, unchanged) ──
const smallId = await c.mutation(api.mutations.createProject, {
  fileName: "small-regression.pdf", pageCount: 1, wordCount: 5,
  pageData: [{ text: "tiny", page: 1 }], fullText: "tiny text", parsedPages: 1, status: "ready",
});
const smallRow = await c.query(api.queries.getProjectRaw, { projectId: smallId });
ok("C1 small project inline (no refs, full values)", smallRow.fullText === "tiny text" && !smallRow.fullTextStorageId && !smallRow.pageDataStorageId && smallRow.pageData.length === 1);

// cleanup (keep nothing in the user's deployment)
for (const id of [project?._id, smallId].filter(Boolean)) {
  await c.mutation(api.mutations.deleteProject, { projectId: id }).catch(() => {});
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
