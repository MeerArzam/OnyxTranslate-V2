import { ConvexHttpClient } from "convex/browser";
import fs from "node:fs";

const convex = new ConvexHttpClient("https://successful-iguana-419.convex.cloud");
const apiAny = (await import("../convex/_generated/api.js")).api;

const state = JSON.parse(fs.readFileSync("/tmp/onyx/phase3-state.json", "utf8"));
const mid = state.mainProjectId;

const ts = await convex.query(apiAny.queries.getTranslationsRaw, { projectId: mid });
const ur = ts.find((t) => t.langCode === "ur");
console.log("before:", ur?.status, "chunks", ur?.completedChunks, "/", ur?.totalChunks, "merged?", !!ur?.mergedText);

// Capture any action-side error verbatim
try {
  const res = await convex.action(apiAny.generatePdf.generateTranslatedPdf, {
    projectId: mid,
    langCode: "ur",
    translationId: ur._id,
    mergedText: ur.mergedText ?? "",
  });
  console.log("action result:", JSON.stringify(res));
} catch (e) {
  console.log("ACTION ERROR:", e.message?.slice(0, 500));
}

const after = await convex.query(apiAny.queries.getTranslationsRaw, { projectId: mid });
const ur2 = after.find((t) => t.langCode === "ur");
console.log("after:", ur2?.status, "pdfUrl?", !!ur2?.pdfUrl, "pdfGenerating?", ur2?.pdfGenerating);
