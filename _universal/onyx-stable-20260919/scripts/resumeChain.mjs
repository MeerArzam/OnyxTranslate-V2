/** Resume the production language chain from where the font crash killed it:
 *  ur is complete (PDF rendered). Fire translateLanguage for ar with the full
 *  remaining chain — scheduled calls continue server-side even if we exit. */
import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";

const convex = new ConvexHttpClient("https://successful-iguana-419.convex.cloud");
const apiAny = (await import("../convex/_generated/api.js")).api;

const state = JSON.parse(fs.readFileSync("/tmp/onyx/phase3-state.json", "utf8"));
const mid = state.mainProjectId;
console.log("resuming chain for project", mid);

const rest = ["fr", "ja", "es", "hi", "tr", "zh", "ru", "ko", "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt"];
// Fire-and-forget: the action + its scheduled successors run server-side.
convex.action(apiAny.translateContent.translateLanguage, {
  projectId: mid,
  langCode: "ar",
  marketContext: "standard",
  nextLangCode: rest[0],
  remainingLangs: rest.slice(1),
}).then(
  (r) => { console.log("ar leg returned:", JSON.stringify(r)?.slice(0, 120)); process.exit(0); },
  (e) => { console.error("ar leg error:", e.message?.slice(0, 200)); process.exit(1); },
);
// Detach: do not keep the socket open — server continues regardless.
setTimeout(() => { console.log("(detached — chain continues server-side)"); process.exit(0); }, 8000);
