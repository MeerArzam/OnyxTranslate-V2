# OnyxTranslate — BASELINE_REPORT.md (Phase 1: Universal Archive + Safe Removal)

Frozen forensic snapshot taken **2026-09-14** immediately before Phase 1 safe removal.
This file describes the archived state of the project (`_universal/onyx-stable/`), which is
FROZEN reference-only. Nothing in the archive is imported at runtime.

---

## 0. Baseline build gates (recorded verbatim, pre-removal)

```
===== GATE 1: bunx convex dev --once =====
    src/data/glossary.json:877:4:
      877 │     "Power": {
          ╵     ~~~~~~~
esbuild warning: Duplicate key "Power" in object literal
✔ 14:14:08 Convex functions ready! (6.4s)
EXIT1=0

===== GATE 2: bunx tsc -b --noEmit =====
(no output)
EXIT2=0

===== GATE 3: bun run build =====
dist/assets/lucide-BeXBrY5P.js         15.71 kB │ gzip:   6.03 kB
dist/assets/index-DVAx3FEM.js          46.08 kB │ gzip:  15.09 kB
dist/assets/jszip-DVduAWha.js          96.73 kB │ gzip:  29.87 kB
dist/assets/Overview-Cn7d-eDc.js      132.11 kB │ gzip:  30.84 kB
dist/assets/index-CItVXF51.js         387.81 kB │ gzip: 164.91 kB
dist/assets/index-Dvx3aTXd.js         589.00 kB │ gzip: 190.40 kB
dist/assets/fontkit.es-DH-7Jfc2.js    716.75 kB │ gzip: 329.77 kB
✓ built in 16.90s
EXIT3=0
```

All three gates green at archive time. Known warning: duplicate `"Power"` key in
`src/data/glossary.json` (~lines 877/1153) — harmless esbuild warning, parked.

## 1. Convex function inventory (baseline)

| Module | Functions | Status at baseline |
|---|---|---|
| `upload.ts` | `storePdf` (action, V8) | Test-infra only (scripts call `upload:storePdf` via HTTP); client no longer calls it |
| `upload.ts` | `generatePdfUploadUrl` (mutation) | **Live** — step 1 of direct upload |
| `upload.ts` | `finalizePdfUpload` (mutation) | **Live** — step 3 of direct upload |
| `parsePdf.ts` | `parseUploadedPdf` (action) | **Live** — server authoritative re-parse (Phase B x-gap merge) |
| `importProject.ts` | `importProject` (action, node) | **Working client-path** (verified 2026-09-14) — scheduled for Phase 1 removal per user |
| `mutations.ts` | `createProject`, `upsertTranslation`, `deleteProject`, `deleteChunksForLang`, … | **Live** shared infra |
| `queries.ts` | `getProject`, `getProjectTranslations`, `getLatestProject`, `getSessionProjects`, `getChunksForLang`, `getStalledLanguages`, … | **Live**; `getChunksForLang` used by live Export + server pipeline |
| `translateContent.ts` | `translateLanguage` | **Live** — 23-phase pipeline |
| `translateQueue.ts` | scheduler chain, watchdog | **Live** |
| `generatePdf.ts`, `zipAssembly.ts`, `pdfLayout.ts`, `renderPdfCore.ts` | PDF generation | **Live** (C3 bidi on Convex) |
| `translateImage.ts` | `translateImage` | **Live** (Images tab) |
| `history.ts` | `saveToHistory` | **Live** |
| `liveTest.ts`, `liveTestStore.ts` | live-test pipeline | **Live** (Overview dashboard) |
| `crons.ts.bak` | — | Backup file, never compiled |

## 2. Schema fields (baseline, `convex/schema.ts`)

`projects`: sessionId, fileName, pageCount, wordCount, pdfStorageId, pageData, fullText,
parsedPages, status, zipStorageId, zipUrl, createdAt (index `by_session`).
`chunks`: projectId, langCode, chunkIndex, sourceText, translatedText, status, model, usage.
`translations`: projectId, langCode, status, totalChunks, completedChunks, mergedText,
pdfStorageId, pdfUrl, pdfGenerating, pdfProgress, startedAt, completedAt, lastChunkAt.
`imageTranslations`, `history`, `jobs`, `liveTests` as shipped. **Schema is NOT touched in Phase 1.**

## 3. UI buttons rendering at baseline (Translator page)

Header: History (clock), **Export** (`handleExportProgress`), **Import** (`handleImportProgress`),
Overview link, status badge (idle/translating/all-complete), Gemini badge, "20 Languages" badge.
Input view: tabs Documents | Text | Images; dropzone; market select; language chips;
**Begin Translation** (`startTranslation`); Baseline + Sample buttons (text tab).
Job view: file header card, "Continues even if you close this page" badge, per-language rows,
ZIP button (enabled iff `convexProject.zipUrl`), Recent jobs, "New Translation".
Progress panel: RoyalProgressPanel with Resume/Pause/ZIP/Start Fresh.

## 4. Handlers that silently no-op at baseline (verified by reading code + browser tests)

1. `storePdfAction` (`api.upload.storePdf` bound at `Translator.tsx:130`) — **dead binding**:
   included in `handleFileSelect` deps but never invoked (client uses direct upload).
2. `mergeChunkTexts` import (`Translator.tsx:76`) — imported, never called.
3. `startTranslationCore(overrides?)` — the overrides parameter
   (`text/langs/existingProjectId`) has **zero callers**; only `startTranslation()` (no-arg)
   is used. It is the remains of the removed ref-handoff auto-start.
4. No other silent no-ops found: Export, Import, dropzone, Begin, Pause/Resume/ZIP all fire.

---

## 5. FORENSIC DEPENDENCY MAP — UPLOAD

### LIVE chain (working — client-path verified 2026-09-14, 17/17 assertions)
```
<input type=file .pdf> (Translator.tsx:1228 onChange)
  → handleFileSelect (376)
      ├─ parsePDFHeader(file)          [src/lib/translator/pdfParser.ts]  LIVE
      ├─ parsePDFBatch(pdf, s, e)      [pdfParser.ts, batches of PARSE_BATCH_SIZE]  LIVE
      ├─ direct upload:
      │    convexClient.mutation(api.upload.generatePdfUploadUrl)         LIVE
      │    fetch(uploadUrl, POST file)  (browser → Convex Storage)
      │    convexClient.mutation(api.upload.finalizePdfUpload)            LIVE
      ├─ parsePdfAction({pdfStorageId}) [convex/parsePdf.ts parseUploadedPdf]  LIVE (fallback to browser parse on error)
      └─ createProjectMutation          [convex/mutations.ts createProject]  LIVE
  → setProjectId → user clicks Begin → startTranslation → startTranslationCore (828)
      → translateLanguageAction (chain)   [convex/translateContent.ts + translateQueue.ts]  LIVE
handleDrop (914) → handleFileSelect   LIVE
handleDragOver/handleDragLeave (550/555)  LIVE
```
Progress/error states: `isUploading`, `uploadError`, `parseProgress`, `parsePhase`,
`pdfWarnings`, `pageData`, `originalPageTexts`, `sourceText`, `originalArrayBuffer` — all LIVE.

### DEAD in upload
- `storePdfAction` binding (see §4.1). `convex/upload.ts storePdf` itself is kept:
  **shared test infrastructure** — `scripts/testPdfFidelity.cjs` (lines 329/370/482),
  `scripts/e2e-one.py` (line 36), `scripts/e2e-full-test.py` (line 29) call
  `upload:storePdf` over HTTP.
- `newProjectIdRef` / `serverFullTextRef` — **already absent** (removed in the undo pass).
- `handleDocumentSelect` — **already absent** (removed in the undo pass).

## 6. FORENSIC DEPENDENCY MAP — IMPORT

```
Header "Import" button (1296 onClick=handleImportProgress)
  → hidden file picker (.json) → file.text()
  → importProjectAction = api.importProject.importProject   [convex/importProject.ts, node runtime]  WORKING
      → api.mutations.createProject (restores fullText, pageData, parsedPages)
      → api.mutations.upsertTranslation per language
  → on success: setProjectId + setSelectedLangCodes + setCurrentPreviewLangCode[0]
      + reset isTranslating/error + toast   (Convex reactive queries refresh the rest)
```
Status: **fully working** (browser-verified 2026-09-14: toast "Imported … language(s) ready",
restored row, Begin enabled). No `isJobView` gate in this handler.
Session handling: import creates rows under the CURRENT `sessionId` (session isolation intact).
Convex Storage ids (`pdfStorageId`, per-language `pdfStorageId`) are NOT carried in the JSON —
regeneration relies on stored `mergedText`/`pageData`; this matches the archived design.

## 7. FORENSIC DEPENDENCY MAP — EXPORT (JSON backup — distinct from PDF/ZIP downloads)

```
Header "Export" button (1286 onClick=handleExportProgress)   WORKING
  → gate: project existence only (toast.info if none) — no status/isJobView/flowPhase gate
  → per-language chunks: convexClient.query(api.queries.getChunksForLang)   LIVE
  → exportData { type:"onyx-translate-project", version:1, exportedAt, langCodes,
      project{projectId,sessionId,fileName,pageCount,wordCount,fullText,status,
              parsedPages,pageData,zipUrl}, chunks{lang→[{chunkIndex,sourceText,
              translatedText,status}]}, translations[{langCode,totalChunks,
              completedChunks,mergedText,status,pdfUrl,pdfGenerating,startedAt,completedAt}] }
  → Blob → URL.createObjectURL → a.click() → revoke   WORKING (mid-translation and idle)
```
Distinct download paths (NOT part of Export, all WORKING):
- Per-language PDF: `handleDownloadPDF` (server `pdfUrl` first, else client `generateTranslatedPDF`).
- ZIP: `handleDownloadAllZIP` (server `zipUrl` first, else client JSZip assembly).

## 8. FORENSIC DEPENDENCY MAP — isJobView / view state

```
const [view, setView] = useState<"input"|"job">("input")            (236)
const isJobView = view==="job" && (flowPhase!=="idle" || translations>0)   (245)
setView callers: auto-restore effect (341), startTranslationCore (888),
  "New Translation" (1340), Recent-jobs card (1437)
```
Render split: `{isJobView && convexProject ? <JobView> : <InputView>}` (1316).
Note: this is the surviving Phase E2 two-view home (input ↔ job), NOT the removed
mega-pass gating. Header Export/Import are OUTSIDE the split (always visible).

## 9. DEAD CODE CENSUS (baseline)

| Location | What | Why dead |
|---|---|---|
| `Translator.tsx:130` | `storePdfAction` binding | Never invoked (direct upload replaced it) |
| `Translator.tsx:76-78` | `mergeChunkTexts` + `type TranslationChunk` imports | Never used |
| `Translator.tsx:828-838` | `startTranslationCore` overrides param | Zero callers (auto-start remnant) |
| `src/lib/translator/storage.ts` | IndexedDB persistence: `saveProject`, `getProject`(idb), `deleteProject`(idb), `saveTranslationChunk`, `getAllTranslations`, `deleteTranslation`, `saveQAReport`, `saveTranslationPdf`, `getTranslationPdf`, `chunkPageTexts`, `isIndexedDBAvailable`, `exportAllProgress`, `importAllProgress`, `serializeProgress`, `deserializeProgress`, v1→v2 migration, base64 helpers | Convex is the store; nothing imports these |
| `src/lib/translator/storage.ts` | LIVE: `saveTerminologyBatch`, `getAllTerminology`, `type TerminologyEntry` (used by engine.ts), `mergeChunkTexts` (imported by Translator but unused) | mixed file |
| `convex/crons.ts.bak` | whole file | backup, never compiled |

## 10. Shared-with-working features (DO NOT REMOVE in Phase 1)

- `convex/upload.ts storePdf` — test scripts (HTTP).
- `convex/queries.ts getChunksForLang` — live Export + translateContent + translateQueue.
- `convex/mutations.ts` — createProject used by upload AND import AND paste-text flows.
- `ctx.storage` primitives, schema, session fields, history, zipAssembly, generatePdf,
  parsePdf core, pdfLayout, renderPdfCore, translateContent, translateQueue — all shared.
- `pdfParser.ts` client parse — used by live upload; `pdfGenerator.ts`/`pdf-render.ts`/
  `pdf-worker.ts` — used by per-language PDF fallback + ZIP regeneration.
- `vendor.ts` + `public/vendor/*` — runtime pdfjs chain for the client parser.

## 11. PHASE 1 REMOVAL PLAN (executed after archive hash verification)

| # | Target | Action | Archived SHA-256 (proof of pre-state) |
|---|---|---|---|
| R1 | `Translator.tsx` `storePdfAction` binding + dep | remove | `2dd96afb6cd132c71f683309fa3c93af534852d301d1630ee991e0f7d294cc03` |
| R2 | `Translator.tsx` `mergeChunkTexts` + `TranslationChunk` imports | remove | (same file hash) |
| R3 | `Translator.tsx` `startTranslationCore` overrides param → plain `startTranslation` | simplify | (same file hash) |
| R4 | `convex/upload.ts` `storePdf` action | **KEEP** (shared test infra — deviation, user rule conflict resolved in favor of working tests) | `f39587e8d816a5845b46d96215f391d799c394e61f97e3246843d917a0500ab5` |
| R5 | `convex/importProject.ts` + client `importProjectAction`/`handleImportProgress` + Import button | remove (stub-free: button removed too) | `66a9296b66418f5e6ac30c5fb120b1b456bb69cd16b1dd52b130393a70038a00` |
| R6 | `storage.ts` dead IndexedDB/export-import code | rewrite file to keep only `TerminologyEntry`, `saveTerminologyBatch`, `getAllTerminology`, `mergeChunkTexts`… (see live file for final set) | `eb2cc2572bfa0fd1109eb3d3f160e55ce3bef1f165fc8a4155b46d816d7e0aab` |
| R7 | `convex/crons.ts.bak` | delete from live tree | `9a4e64d36e6569cc3344786814a865f05bf3db492cdfe3934f13299573b16da8` |
| R8 | TDZ check `handleDrop` | verified safe: `handleDrop` (914) references `handleFileSelect` (376) declared above; no TDZ fix needed | — |

Post-removal gates required: `bunx convex dev --once` ✓, `bunx tsc -b --noEmit` ✓,
`bun run build` ✓ (recorded in the Phase 1 report).
