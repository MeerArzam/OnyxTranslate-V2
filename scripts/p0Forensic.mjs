/**
 * P0 forensic runner — read-only diagnosis of the real frozen project.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const URL = "https://successful-iguana-419.convex.cloud";
const c = new ConvexHttpClient(URL);

const HOUR = 3600_000;
const iso = (t) => (t ? new Date(t).toISOString() : null);

try {
  const list = await c.query(api.forensicProbe.watchdogEvidence, {}, {});
  console.log("=== RECENT PROJECTS (newest first) ===");
  for (const p of list) {
    console.log(
      `${p.projectId.slice(-6)} mode=${p.translationMode} status=${p.status} gov=${p.governorState} ` +
      `lastDispatch=${iso(p.lastDispatcherAt)} lastActivity=${iso(p.lastSuccessfulActivityAt)} updated=${iso(p.updatedAt)}`
    );
  }

  // Pick the most recent translating/stuck project
  const target = list.find(
    (p) => p.status === "translating" || (p.lastDispatcherAt && Date.now() - p.lastDispatcherAt > 6 * HOUR)
  );
  if (!target) {
    console.log("\nNO obvious frozen project found — diagnosing newest anyway.");
  }
  const projectId = (target ?? list[0]).projectId;
  console.log(`\n=== DIAGNOSIS for ${projectId} ===`);
  const d = await c.query(api.forensicProbe.diagnoseProject, { projectId }, {});
  console.log(JSON.stringify(d, null, 2));
} catch (e) {
  console.log("BLOCKED:", String(e).slice(0, 400));
  process.exit(2);
}
process.exit(0);
