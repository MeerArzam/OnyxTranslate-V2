// Builds _universal/onyx-stable/manifest.json — the forensic index of the frozen archive.
// Read-only with respect to the archive except for manifest.json itself.
// Re-runnable: re-walks the tree, recomputes hashes, re-applies curation.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = "_universal/onyx-stable";
const OUT = join(ROOT, "manifest.json");

const EXCLUSIONS = [
  "node_modules", "dist", ".git", "isolate", "_universal",
  "*.log", "__pycache__", ".vite", ".turbo", ".cache",
  ".env", ".env.local", ".env.*",
];
const REDACTED = [
  { file: ".env.local", reason: "secret env file — never archived; recorded as redacted" },
  { file: ".env.example", reason: "env template — excluded with all env files; recorded as redacted" },
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "manifest.json") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

function exportsOf(text) {
  const syms = new Set();
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/g)) syms.add(m[1]);
  for (const m of text.matchAll(/export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_]+)/g)) syms.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(",").forEach((s) => { const t = s.trim().split(/\s+as\s+/).pop().trim(); if (t) syms.add(t); });
  if (/export\s+default\s+[^function\sclass]/.test(text)) syms.add("default");
  return [...syms];
}
function importsOf(text) {
  const mods = new Set();
  for (const m of text.matchAll(/(?:import|export)\s[^"';]*?from\s+["']([^"']+)["']/g)) mods.add(m[1]);
  for (const m of text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) mods.add(m[1]);
  return [...mods];
}

// ── Curated audit verdicts (from the 2026-09-14 forensic pass) ──
const CURATED = {
  "src/pages/Translator.tsx": { status: "partial", area: "ui", note: "MIXED: upload pipeline + Begin/queue + preview + ZIP working; dead = storePdfAction binding, mergeChunkTexts import, startTranslationCore overrides param (auto-start remnant), isJobView local view machine." },
  "convex/upload.ts": { status: "partial", area: "storage", note: "storePdf = test-infra only (scripts via HTTP); generatePdfUploadUrl/finalizePdfUpload = live client direct-upload pair." },
  "convex/importProject.ts": { status: "working", area: "import", note: "Client-path verified 2026-09-14; scheduled for removal in Phase 1 (server test scripts e2e-one.py also call it)." },
  "convex/crons.ts.bak": { status: "dead", area: "shared", note: "Backup file, never compiled (non-.ts extension)." },
  "src/lib/translator/storage.ts": { status: "partial", area: "storage", note: "LIVE: saveTerminologyBatch/getAllTerminology/TerminologyEntry (engine.ts), mergeChunkTexts (dead import in Translator). DEAD: IndexedDB project/chunk persistence, exportAllProgress/importAllProgress/serialize/deserialize, PDF blob cache, chunkPageTexts, QA cache, v1→v2 migration." },
  "src/lib/translator/engine.ts": { status: "partial", area: "translation", note: "Pure localization fns + voices shared working; local neural/model path (hasNeuralModel, saveTerminologyBatch call site at L760) never exercised by the Convex pipeline — server translateContent.ts is the live engine." },
  "src/lib/translator/qa.ts": { status: "partial", area: "translation", note: "runQA/QAReport live (server pipeline + client baseline tests); IndexedDB cache helper call sites dead." },
  "src/lib/translator/neural.ts": { status: "dead", area: "translation", note: "Transformers.js local model path — public/vendor/transformers.min.js loaded only via this module; no live call path in the Convex architecture." },
  "src/lib/translator/baseline.ts": { status: "working", area: "translation", note: "Client baseline tester (Translator 'Baseline' button) — working." },
  "src/lib/translator/pdfGenerator.ts": { status: "working", area: "pdf", note: "Client PDF fallback + ZIP regeneration path; server generatePdf.ts is the primary generator." },
  "src/lib/translator/pdfParser.ts": { status: "working", area: "pdf", note: "Client parsePDFHeader/parsePDFBatch live in handleFileSelect; server parsePdf.ts re-parses authoritatively." },
  "src/lib/translator/pdf-render.ts": { status: "working", area: "pdf" },
  "src/lib/translator/pdf-worker.ts": { status: "working", area: "pdf" },
  "src/lib/translator/vendor.ts": { status: "working", area: "pdf", note: "Runtime vendored pdfjs paths under public/vendor — loaded at runtime by the parser chain." },
  "src/lib/translator/voices.ts": { status: "working", area: "translation" },
  "src/lib/translator/cultural.ts": { status: "working", area: "translation" },
  "src/lib/translator/formatters.ts": { status: "working", area: "translation" },
  "src/lib/translator/arabic-reshaper.d.ts": { status: "working", area: "pdf", note: "Type declarations for arabic-reshaper (Convex bidi pipeline, renderPdfCore.ts)." },
  "convex/generatePdf.ts": { status: "working", area: "pdf" },
  "convex/parsePdf.ts": { status: "working", area: "pdf", note: "x-gap merge + paragraph clustering (Phase B) — shared parsing core, DO NOT remove." },
  "convex/pdfLayout.ts": { status: "working", area: "pdf" },
  "convex/renderPdfCore.ts": { status: "working", area: "pdf", note: "Includes Phase C3 bidi+reshape (ar/ks on Amiri)." },
  "convex/zipAssembly.ts": { status: "working", area: "pdf" },
  "convex/translateContent.ts": { status: "working", area: "translation", note: "23-phase prompt + Bible Pass + 5-key rotation — DO NOT remove." },
  "convex/translateQueue.ts": { status: "working", area: "translation", note: "Watchdog/auto-resume chain — DO NOT remove." },
  "convex/translateImage.ts": { status: "working", area: "translation" },
  "convex/mutations.ts": { status: "working", area: "storage", note: "createProject/upsertTranslation/deleteProject/deleteChunksForLang — shared by working features." },
  "convex/queries.ts": { status: "working", area: "storage", note: "getChunksForLang used by live Export (added in undo pass)." },
  "convex/schema.ts": { status: "working", area: "storage", note: "Schema — DO NOT remove (session fields, history, liveTests)." },
  "convex/history.ts": { status: "working", area: "storage" },
  "convex/liveTest.ts": { status: "working", area: "shared", note: "Server-side live-test pipeline (Overview dashboard)." },
  "convex/liveTestStore.ts": { status: "working", area: "shared" },
  "src/components/FixPassReport.tsx": { status: "working", area: "ui", note: "Overview 'Fix Report' view; contains stale 10MB/300-page history text (historical)." },
  "src/components/LiveTestPanel.tsx": { status: "working", area: "ui" },
  "src/components/HistoryPanel.tsx": { status: "working", area: "ui" },
  "src/components/RoyalProgressPanel.tsx": { status: "working", area: "ui" },
  "src/components/LanguageAccordion.tsx": { status: "working", area: "ui" },
  "src/components/DragonIntro.tsx": { status: "working", area: "ui" },
  "src/pages/Overview.tsx": { status: "working", area: "ui" },
  "src/main.tsx": { status: "working", area: "shared" },
  "src/instrumentation.tsx": { status: "working", area: "shared" },
  "src/index.css": { status: "working", area: "shared", note: "Dark neon theme + Phase A mobile hardening — DO NOT remove." },
  "vite.config.ts": { status: "working", area: "shared", note: "Freebuff requires HMR disabled — never modify." },
  "scripts/testPdfFidelity.cjs": { status: "working", area: "shared", note: "Calls upload:storePdf via HTTP — reason storePdf must stay in Phase 1." },
  "scripts/e2e-one.py": { status: "working", area: "shared", note: "Calls upload:storePdf + importProject? (storePdf confirmed)." },
  "scripts/e2e-full-test.py": { status: "working", area: "shared", note: "Calls upload:storePdf via HTTP." },
  "scripts/clientPathTest.mjs": { status: "working", area: "shared", note: "Playwright client-path harness (17/17 assertions 2026-09-14)." },
  "scripts/generate-docs.py": { status: "working", area: "shared" },
  "scripts/make-test-pdf.cjs": { status: "working", area: "shared" },
  "scripts/update-docs.sh": { status: "working", area: "shared" },
  "scripts/archive-exclude.txt": { status: "working", area: "shared", note: "Exclusion list used to build this archive." },
  "src/hooks/use-mobile.ts": { status: "working", area: "shared" },
  "src/lib/utils.ts": { status: "working", area: "shared" },
  "src/lib/vly-integrations.ts": { status: "unknown", area: "shared", note: "Platform integration shim." },
  "vly-toolbar-readonly.tsx": { status: "unknown", area: "shared", note: "Platform file — do not modify." },
  "main.ts": { status: "unknown", area: "shared", note: "Platform SST entry." },
  "sst-env.d.ts": { status: "unknown", area: "shared", note: "Platform generated types." },
  "src/data/glossary.json": { status: "working", area: "translation", note: "PARKED: duplicate 'Power' key (lines ~877/1153) — esbuild warning, harmless." },
  "PROJECT_DOCUMENTATION.json": { status: "unknown", area: "shared" },
  "src/docs/PROJECT_DOCUMENTATION.json": { status: "unknown", area: "shared" },
};

function areaFor(rel) {
  if (CURATED[rel]?.area) return CURATED[rel].area;
  if (rel.startsWith("src/lib/translator/pdf")) return "pdf";
  if (rel.startsWith("src/components/ui/")) return "ui";
  if (rel.startsWith("src/components/")) return "ui";
  if (rel.startsWith("src/data/")) return "translation";
  if (rel.startsWith("src/localization") || rel.includes("/localization/")) return "translation";
  if (rel.startsWith("public/docs/")) return "shared";
  if (rel.startsWith("public/vendor/")) return "pdf";
  if (rel.startsWith("scripts/")) return "shared";
  if (rel.startsWith("convex/")) return "translation";
  if (rel.startsWith("src/lib/")) return "shared";
  return "shared";
}
function categoryFor(rel) {
  const e = extname(rel);
  if (e === ".ts" || e === ".tsx") return rel.endsWith(".d.ts") ? "types" : "source";
  if (e === ".json") return rel.endsWith("lock") || rel.includes("lock.") ? "lockfile" : "data";
  if (e === ".html") return "html";
  if (e === ".css") return "styles";
  if ([".svg", ".png", ".webp", ".jpg", ".webmanifest", ".mjs", ".js"].includes(e)) return rel.startsWith("public/vendor/") ? "vendored-runtime" : "asset";
  if ([".cjs", ".mjs", ".py", ".sh", ".txt"].includes(e)) return "script";
  if (e === ".md") return "docs";
  if (rel.includes("tsconfig") || rel.includes(".config.") || rel.startsWith("postcss") || rel.startsWith("eslint") || rel.startsWith(".prettier") || rel.startsWith("components.json") || rel === "bun.lock" || rel === "package.json") return "config";
  return "other";
}

const files = walk(ROOT).sort();
const allRel = files.map((f) => relative(ROOT, f).split("\\").join("/"));

// Pre-read source text for caller mapping
const textOf = new Map();
for (const f of files) {
  const rel = relative(ROOT, f).split("\\").join("/");
  if (/\.(ts|tsx|js|mjs|cjs)$/.test(extname(rel)) || rel.endsWith(".d.ts")) {
    try { textOf.set(rel, readFileSync(f, "utf8")); } catch { /* binary-ish */ }
  }
}

const entries = [];
for (const f of files) {
  const rel = relative(ROOT, f).split("\\").join("/");
  const buf = readFileSync(f);
  const st = statSync(f);
  const c = CURATED[rel] ?? {};
  const text = textOf.get(rel);
  const exportedSymbols = text ? exportsOf(text) : [];
  const imports = text ? importsOf(text) : [];
  // direct callers: any other file containing a symbol this file exports
  const callers = new Set();
  for (const sym of exportedSymbols) {
    if (sym === "default") continue;
    const re = new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    for (const [otherRel, otherText] of textOf) {
      if (otherRel === rel) continue;
      if (re.test(otherText)) callers.add(otherRel);
    }
  }
  // callees: local modules this file imports (resolve relative + @/ alias)
  const callees = new Set();
  for (const imp of imports) {
    let resolved = null;
    if (imp.startsWith(".")) {
      const base = rel.split("/").slice(0, -1);
      const parts = (imp[1] === "/" ? imp.slice(2) : imp).split("/");
      const stack = imp[1] === "/" ? [] : [...base];
      for (const part of parts) {
        if (part === "..") stack.pop();
        else if (part !== ".") stack.push(part);
      }
      const cand = stack.join("/");
      resolved = allRel.find((r) => r === cand || r === cand + ".ts" || r === cand + ".tsx" || r === cand + "/index.ts" || r === cand + ".json" || r === cand + ".css" || r === cand + ".js" || r === cand + ".d.ts") ?? cand;
    } else if (imp.startsWith("@/")) {
      const cand = "src/" + imp.slice(2);
      resolved = allRel.find((r) => r === cand || r === cand + ".ts" || r === cand + ".tsx" || r === cand + "/index.ts" || r === cand + ".css" || r === cand + ".json") ?? cand;
    } else if (imp.startsWith("../../convex") || imp.startsWith("../convex") || imp.startsWith("./convex")) {
      const cand = imp.replace(/^(\.\.\/)+|^\.\//, "").replace(/^convex\/?/, "convex/");
      resolved = allRel.find((r) => r === cand || r === cand + ".ts") ?? cand;
    }
    if (resolved) callees.add(resolved);
  }
  entries.push({
    path: rel,
    size: st.size,
    sha256: createHash("sha256").update(buf).digest("hex"),
    category: categoryFor(rel),
    exportedSymbols,
    imports,
    directCallers: [...callers].sort(),
    callees: [...callees].sort(),
    status: c.status ?? "working",
    area: areaFor(rel),
    note: c.note,
    redacted: false,
    timestamp: st.mtime.toISOString(),
    gitHash: null,
  });
}

const totalBytes = entries.reduce((a, e) => a + e.size, 0);
const manifest = {
  archive: "_universal/onyx-stable",
  created: new Date().toISOString(),
  purpose: "FROZEN reference snapshot of the entire OnyxTranslate project, captured before Phase 1 safe removal (upload/import/export regression undo). Reference-only: never imported at runtime, never edited, never deleted from.",
  rules: [
    "NEVER edit, overwrite, rename, or delete anything inside _universal/onyx-stable.",
    "NEVER import from it at runtime.",
    "NEVER add new/unverified code to it.",
    "Repair flow: copy OUTSIDE the folder, edit the copy, verify, then — only after USER verification — replace the archived version.",
    "Folder is chmod a-w (read-only). Verify with: bun scripts/verify-universal-archive.mjs",
  ],
  exclusions: EXCLUSIONS,
  redactions: REDACTED,
  gitHash: null,
  gitNote: "Git commands are blocked in this environment (Vly manages version control) — per-file gitHash recorded as null.",
  generatedBy: "scripts/build-universal-manifest.mjs (run from project root)",
  totals: { files: entries.length, bytes: totalBytes },
  files: entries,
};
writeFileSync(OUT, JSON.stringify(manifest, null, 2));
console.log(`manifest.json written: ${entries.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);
console.log(`redacted: ${REDACTED.map((r) => r.file).join(", ")} (not copied)`);
const missingCuration = entries.filter((e) => e.status === "working" && !CURATED[e.path]).length;
console.log(`curated: ${Object.keys(CURATED).length} paths; default 'working' applied to ${missingCuration} files (assets/config/docs/ui primitives)`);
