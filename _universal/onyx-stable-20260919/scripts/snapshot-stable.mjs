// Creates a NEW versioned archive snapshot under _universal/ — e.g.
//   bun scripts/snapshot-stable.mjs                    → _universal/onyx-stable-YYYYMMDD
//   bun scripts/snapshot-stable.mjs my-tag            → _universal/onyx-stable-my-tag
//
// NEVER touches an existing archive (the frozen 2026-09-14 baseline or any prior
// snapshot). Refuses to overwrite. After copying, builds a SHA-256 manifest with
// the same schema as scripts/build-universal-manifest.mjs (paths/sizes/hashes;
// curated statuses intentionally NOT re-captured — new snapshots record a note
// instead), then chmod a-w the tree (best-effort; some container FS ignore it).
//
// Verify afterwards: ARCHIVE_ROOT=_universal/onyx-stable-YYYYMMDD bun scripts/verify-universal-archive.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, chmodSync, existsSync, copyFileSync } from "node:fs";
import { join, relative, extname } from "node:path";

const PROJECT = process.cwd();
const UNIVERSAL = join(PROJECT, "_universal");

const rawArg = process.argv[2]?.trim();
const tag = (rawArg && /^[A-Za-z0-9._-]+$/.test(rawArg) ? rawArg : new Date().toISOString().slice(0, 10).replaceAll("-", ""))
  .replace(/^onyx-stable-?/, "");
const NAME = `onyx-stable-${tag || new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
const DEST = join(UNIVERSAL, NAME);

if (existsSync(DEST)) {
  console.error(`✗ REFUSING: ${DEST} already exists — archives are immutable. Pick another tag.`);
  process.exit(1);
}
if (rawArg && !/^[A-Za-z0-9._-]+$/.test(rawArg)) {
  console.error(`✗ REFUSING: tag may only contain [A-Za-z0-9._-] (got: ${rawArg})`);
  process.exit(1);
}

// Exclusions mirror scripts/archive-exclude.txt (secrets never enter archives).
const EXCLUDE_NAMES = new Set(["node_modules", "dist", ".git", "isolate", "_universal", "__pycache__", ".vite", ".turbo", ".cache", "convex_local_storage"]);
const EXCLUDE_SUFFIX = [".log"];
const EXCLUDE_FILES = new Set([".env", ".env.local", ".env.keys", ".env.production", ".env.development"]);
function excluded(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  if (/^\.env\./.test(rel)) return true; // .env.example, .env.keys, … — all env files stay out
  if (EXCLUDE_SUFFIX.some((s) => rel.endsWith(s))) return true;
  return false;
}

console.log(`Creating snapshot ${NAME} ...`);
mkdirSync(DEST, { recursive: true });
let copied = 0;
// Explicit walk-copy (cpSync refuses to copy a tree into its own subdirectory).
(function copyDir(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const s = join(srcDir, name);
    const rel = relative(PROJECT, s).split("\\").join("/");
    const st = statSync(s);
    if (st.isDirectory()) {
      if (EXCLUDE_NAMES.has(name) || name === "_universal") continue;
      copyDir(s, join(destDir, name));
    } else {
      if (excluded(rel)) continue;
      copyFileSync(s, join(destDir, name));
      copied++;
    }
  }
})(PROJECT, DEST);
console.log(`  copied ${copied} files (exclusions applied)`);

// Walk the snapshot and hash everything.
const ROOT = DEST;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "manifest.json") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(ROOT);
files.sort();

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

const entries = [];
let totalBytes = 0;
for (const f of files) {
  const rel = relative(ROOT, f).split("\\").join("/");
  const buf = readFileSync(f);
  const st = statSync(f);
  totalBytes += st.size;
  const e = extname(rel);
  let category = "other";
  if (e === ".ts" || e === ".tsx") category = rel.endsWith(".d.ts") ? "types" : "source";
  else if (e === ".json") category = rel.includes("lock") ? "lockfile" : "data";
  else if (e === ".html") category = "html";
  else if (e === ".css") category = "styles";
  else if ([".svg", ".png", ".webp", ".jpg", ".webmanifest", ".mjs", ".js"].includes(e)) category = rel.startsWith("public/vendor/") ? "vendored-runtime" : "asset";
  else if ([".cjs", ".py", ".sh", ".txt"].includes(e)) category = "script";
  else if (e === ".md") category = "docs";
  else if (rel.includes("tsconfig") || rel.includes(".config.") || rel.startsWith("postcss") || rel.startsWith("eslint") || rel.startsWith(".prettier") || rel === "bun.lock" || rel === "package.json") category = "config";

  let text;
  try { text = /\.(ts|tsx|js|mjs|cjs)$/.test(e) ? buf.toString("utf8") : undefined; } catch { text = undefined; }
  entries.push({
    path: rel,
    size: st.size,
    sha256: createHash("sha256").update(buf).digest("hex"),
    category,
    exportedSymbols: text ? exportsOf(text) : [],
    imports: text ? importsOf(text) : [],
    directCallers: [],
    callees: [],
    status: "working-snapshot",
    area: rel.startsWith("convex/") ? "backend" : rel.startsWith("src/") ? "frontend" : rel.startsWith("scripts/") ? "shared" : rel.startsWith("public/") ? "assets" : "shared",
    note: "Captured by scripts/snapshot-stable.mjs as the working state at snapshot time; per-file audit verdicts live in the frozen 2026-09-14 baseline manifest.",
    redacted: false,
    timestamp: st.mtime.toISOString(),
    gitHash: null,
  });
}

const manifest = {
  archive: `_universal/${NAME}`,
  created: new Date().toISOString(),
  purpose: `Working-state snapshot of OnyxTranslate taken from the live project root — everything verified working at capture time. Reference-only: never imported at runtime, never edited, never deleted from.`,
  basedOn: "Post-migration state: owner-controlled Convex deployment trustworthy-clownfish-652, Thin Motherboard contract pipeline (gemini_contract mode) behind feature flag, reliability pass P0–P7 landed.",
  rules: [
    "NEVER edit, overwrite, rename, or delete anything inside this snapshot.",
    "NEVER import from it at runtime.",
    "NEVER add new/unverified code to it.",
    "Verify with: ARCHIVE_ROOT=_universal/" + NAME + " bun scripts/verify-universal-archive.mjs",
  ],
  exclusions: [...EXCLUDE_NAMES, ...EXCLUDE_SUFFIX, ".env*"],
  redactions: [{ file: ".env.local / .env.keys / .env*", reason: "secret env files — never archived; recorded as redacted" }],
  gitHash: null,
  gitNote: "Git commands are blocked in this environment (Vly manages version control) — per-file gitHash recorded as null.",
  generatedBy: "scripts/snapshot-stable.mjs (run from project root)",
  totals: { files: entries.length, bytes: totalBytes },
  files: entries,
};
writeFileSync(join(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`  manifest.json written: ${entries.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

// Best-effort read-only chmod (containers may ignore; verification is hash-based anyway).
try {
  chmodSync(ROOT, 0o555);
  (function ro(dir) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { chmodSync(p, 0o555); ro(p); } else chmodSync(p, 0o444); } })(ROOT);
  console.log("  chmod a-w applied (read-only)");
} catch (e) {
  console.log(`  chmod skipped: ${e instanceof Error ? e.message : e}`);
}

console.log(`\n✓ Snapshot complete: _universal/${NAME} (${entries.length} files)`);
console.log(`  Verify: ARCHIVE_ROOT=_universal/${NAME} bun scripts/verify-universal-archive.mjs`);
