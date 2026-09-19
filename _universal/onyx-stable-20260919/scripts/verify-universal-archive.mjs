// Verifies the frozen _universal/onyx-stable archive against its manifest.
// Exits non-zero on ANY mismatch, missing file, or untracked extra file.
// Run from project root: bun scripts/verify-universal-archive.mjs
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Default verifies the FROZEN 2026-09-14 baseline. Set ARCHIVE_ROOT to verify a
// different snapshot (e.g. ARCHIVE_ROOT=_universal/onyx-stable-20260919).
const ROOT = process.env.ARCHIVE_ROOT || "_universal/onyx-stable";
const MANIFEST = join(ROOT, "manifest.json");

function fail(msg) {
  console.error(`\n✗ ARCHIVE VERIFY FAILED: ${msg}`);
  process.exit(1);
}

if (!existsSync(MANIFEST)) fail("manifest.json missing from archive root");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const entries = manifest.files;
if (!Array.isArray(entries) || entries.length === 0) fail("manifest has no file entries");

// Walk the actual archive (excluding manifest.json itself)
const actual = new Map();
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "manifest.json") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else actual.set(relative(ROOT, p).split("\\").join("/"), p);
  }
})(ROOT);

let checked = 0, bytes = 0;
const mismatches = [], missing = [], extra = [];

for (const e of entries) {
  const p = actual.get(e.path);
  if (!p) { missing.push(e.path); continue; }
  const buf = readFileSync(p);
  const hash = createHash("sha256").update(buf).digest("hex");
  if (hash !== e.sha256) { mismatches.push(e.path); continue; }
  if (buf.length !== e.size) mismatches.push(`${e.path} (size)`);
  checked++;
  bytes += buf.length;
  actual.delete(e.path);
}
for (const leftover of actual.keys()) extra.push(leftover);

if (missing.length) fail(`${missing.length} file(s) listed in manifest but missing:\n  ${missing.join("\n  ")}`);
if (mismatches.length) fail(`${mismatches.length} file(s) failed SHA-256 verification:\n  ${mismatches.join("\n  ")}`);
if (extra.length) fail(`${extra.length} file(s) present in archive but NOT in manifest (untracked drift):\n  ${extra.join("\n  ")}`);

console.log(`✓ ARCHIVE VERIFIED: ${checked}/${entries.length} files match manifest SHA-256 (${(bytes / 1024 / 1024).toFixed(2)} MB). No drift, no missing files, no untracked additions.`);
console.log(`  Archive: ${ROOT} (frozen ${manifest.created}) — reference-only, never import at runtime.`);
