import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";

const CONVEX_URL = "https://successful-iguana-419.convex.cloud";
const convex = new ConvexHttpClient(CONVEX_URL);
const apiAny = (await import("../convex/_generated/api.js")).api;

const state = JSON.parse(fs.readFileSync("/tmp/onyx/phase3-state.json", "utf8"));
const mid = state.mainProjectId;
console.log("projectId:", mid);

const proj = await convex.query(apiAny.queries.getProjectRaw, { projectId: mid });
console.log("project:", JSON.stringify(proj, null, 2).slice(0, 900));

const ts = await convex.query(apiAny.queries.getTranslationsRaw, { projectId: mid });
console.log("\ntranslations:", ts.map((t) => `${t.langCode}:${t.status}:${t.completedChunks}/${t.totalChunks}`).join("  "));

const chunks = await convex.query(apiAny.queries.getChunksForProjectRaw, { projectId: mid });
console.log("\nchunks:", chunks.length);
for (const c of chunks.slice(0, 6)) {
  console.log(`  #${c.chunkIndex} ${c.langCode} ${c.status} src=${(c.sourceText ?? "").length}ch out=${(c.translatedText ?? "").length}ch model=${c.model ?? "-"} err=${(c.usage?.error ?? "-").toString().slice(0, 120)}`);
}

const jobs = await convex.query(apiAny.identity.getResumableJobs, { clientId: proj.clientId });
const j = jobs.find((x) => x._id === mid);
console.log("\njob row:", j ? JSON.stringify({ status: j.status, processStage: j.processStage, error: j.error, heartbeat: j.heartbeatAt }) : "none");

const uj = state.mainJobId ? await convex.query(apiAny.queries.getUploadJobRaw, { uploadJobId: state.mainJobId }) : null;
console.log("uploadJob:", uj ? JSON.stringify({ status: uj.status, stage: uj.processStage, error: uj.error }) : "none");
