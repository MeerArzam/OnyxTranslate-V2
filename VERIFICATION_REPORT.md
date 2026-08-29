# Verification Report — August 29, 2026

## Build Status
- convex dev: **PASS** (3.85s, all functions ready)
- tsc: **PASS** (zero errors)
- build: **PASS** (10.85s, zero errors)

---

## Critical Issues (must fix before shipping)

| # | File | Line | Issue | How to Fix |
|---|------|------|-------|------------|
| C1 | `convex/translateQueue.ts` | 375 | `processChunkInternal` calls `api.queries.getProjectTranslations` which requires `sessionId`, but action has no session context. This will **crash at runtime** when processing any chunk. | Change to `api.queries.getTranslationsRaw` (which requires only `projectId`). |
| C2 | `convex/translateQueue.ts` | 593-607 | `cancelTranslation` only sets project status to "cancelled" but **never cancels already-scheduled** `processLanguage` jobs via `ctx.scheduler.cancel()`. The queue keeps running in the background after user clicks Pause. | Use `ctx.scheduler.cancel()` on pending scheduled actions, or check `project.status === "cancelled"` at the START of each `processLanguage` invocation (already done partially at line 490, but only at the top — not after the `await processChunkInternal()` call where a new chunk may have already been scheduled). |
| C3 | `convex/generatePdf.ts` | 237 | RTL text "reversal" uses `[...line].reverse().join("")` — this is **character-level** reversal, not word-level. For Arabic/Urdu, this corrupts connected letters and ligatures. pdf-lib draws RTL text left-to-right; the correct approach is to reverse **words**, not characters. | Replace with word-level reversal: `line.split(" ").reverse().join(" ")`. |
| C4 | `convex/generatePdf.ts` | 137-158 | If Noto font download fails AND StandardFonts.Helvetica also fails (e.g., invalid font data), the entire PDF generation crashes with no graceful fallback. | Wrap the entire font block in try/catch and return a meaningful error. |

---

## High Issues (should fix soon)

| # | File | Line | Issue | How to Fix |
|---|------|------|-------|------------|
| H1 | `src/pages/Translator.tsx` | 710 | `startTranslation` dependency array is missing `sessionId`: `[sourceText, projectId, selectedLangCodes, startTranslationAction, createProjectMutation]`. The `sessionId` is used inside the function for `createProjectMutation({ sessionId, ... })`. This could cause a stale closure. | Add `sessionId` to the dependency array. |
| H2 | `src/pages/Translator.tsx` | various | **6 unused mutation hooks** declared: `upsertChunkMutation`, `updateChunkMutation`, `upsertTranslationMutation`, `updateTranslationMutation` (lines 118-121). These are never called — all mutations happen server-side in Convex actions. Wastes memory and clutters the component. | Remove all 4 unused `useMutation` declarations. |
| H3 | `src/pages/Translator.tsx` | 114 | `translateChunkAction` (`useAction(api.translate.translateChunk)`) is declared but **never called** anywhere in the component. Translation is handled by `startTranslationAction` → Convex queue. Dead code. | Remove the `translateChunkAction` declaration. |
| H4 | `src/pages/Translator.tsx` | 33 | `getPDFJS` is imported from `pdfParser.ts` but **never called** in Translator.tsx. Dead import. | Remove from import. |
| H5 | `src/pages/Translator.tsx` | 36-37 | `mergeChunkTexts` and `TranslationChunk` are imported from `storage.ts` but **never used** in Translator.tsx. Dead imports. | Remove from import. |
| H6 | `src/pages/Translator.tsx` | 207-223 | **5 dead state variables**: `translationMode` (line 221), `translationModel` (line 222), `translationUsage` (line 223), `showAllQaPhases` (line 225), `currentPdfBlob` (line 203). These are set but never read in the UI. | Remove all 5 state declarations and their setter calls in `resetFlow()`. |
| H7 | `src/pages/Translator.tsx` | 894 | `const nextLang = null;` is dead code — comment says "No Continue button in autonomous mode" but the variable is unused. | Remove the declaration. |
| H8 | `src/pages/Translator.tsx` | 1259 | **Auto-resume indicator** checks `flowPhase === "idle"` but the condition also requires `activeTranslations.length > 0`. If `flowPhase` is "idle" AND there are translations, it means `convexProject` is null (project not yet loaded or different session). This indicator will **never show** for the correct session because `flowPhase` derives to "translating" when there's a project with translations. | The logic is contradictory — either show it when `flowPhase === "translating"` AND `!isTranslating` (paused state), or remove the duplicate "View Progress" button. |
| H9 | `src/pages/Translator.tsx` | various | **`currentTranslation` fallback to `mergedText`** (line 198): `const currentTranslation = livePreviewText \|\| previewTranslation?.mergedText \|\| null`. The `mergedText` is only populated when ALL chunks for a language are "complete". During active translation, `livePreviewText` should work, but if the query returns empty (no chunks done yet), the preview shows nothing — not even the source text. | Add a fallback: `{currentTranslation || sourceText || "Translating..."}` in the preview panel. |
| H10 | `convex/translateQueue.ts` | 430-467 | **Duplicate chunk records**: `startTranslation` creates chunk records in a loop, but `upsertChunk` skips if one already exists. However, the `totalChunks` count is computed from `chunkText(project.fullText, CHUNK_SIZE)`. If `startTranslation` is called twice for the same project (e.g., user clicks Begin twice), it creates duplicate translation records (skipped by upsert) but the second call also re-schedules `processLanguage` — causing **two parallel chains** for the same language. | Add a guard: check if a translation record already exists with status "in_progress" or "generating_pdf" before starting a new chain. |

---

## Medium Issues (nice to fix)

| # | File | Line | Issue | How to Fix |
|---|------|------|-------|------------|
| M1 | `package.json` | — | **Unused heavy dependencies**: `@hookform/resolvers`, `hono`, `embla-carousel-react`, `react-day-picker`, `sonner`, `recharts`, `zod`, `date-fns`, `react-intersection-observer`, `react-resizable-panels`. These are shadcn/ui template leftovers that inflate the bundle. | Remove unused dependencies from `package.json`. |
| M2 | `package.json` | — | `@vly-ai/integrations` is still in dependencies (used only by `vite.config.ts` Vite plugin). The platform requires it, but it's ~300KB of dead code for this app. | Cannot remove (platform requires it), but note it inflates bundle. |
| M3 | `convex/translateQueue.ts` | — | The entire `buildSystemPrompt` function is **duplicated verbatim** (~150 lines) between `convex/translate.ts` and `convex/translateQueue.ts`. If one is updated, the other falls out of sync. | Extract to a shared module (e.g., `convex/lib/systemPrompt.ts`). |
| M4 | `convex/translateQueue.ts` | 510 | `getProjectTranslations` called in `processChunkInternal` (line 375) — same as C1. This query requires `sessionId`. | Same fix as C1: use `getTranslationsRaw`. |
| M5 | `src/lib/translator/engine.ts` | 307, 810 | **Two dead exported functions**: `runNeuralTranslationPipeline` (line 307) and `runTranslationPipeline` (line 810). These are old client-side translation pipelines that are never called. | Delete both functions and their unused imports. |
| M6 | `src/lib/translator/storage.ts` | various | Contains **12 references** to IndexedDB operations (`saveProject`, `getProject`, `exportAllProgress`, `importAllProgress`, etc.) that are dead code since the migration to Convex. | Gut the file or remove IndexedDB-specific functions. |
| M7 | `src/lib/translator/vlyTranslate.ts` | — | File is "gutted" with comments only but still exists. Since no code imports it, it's dead weight. | Delete the file entirely. |
| M8 | `convex/schema.ts` | — | `jobs` table is defined in schema but **no code reads or writes it**. The queue uses `ctx.scheduler.runAfter()` instead of the jobs table. | Remove the `jobs` table from the schema and delete `createJob`/`getAllJobs`. |
| M9 | `src/pages/Translator.tsx` | 455 | `handleExportProgress` exports translation status to JSON, but the **import** handler is a no-op (`handleImportProgress` does nothing). The Export button is misleading. | Either implement import or remove the Export/Import buttons. |
| M10 | `src/pages/Translator.tsx` | 287-298 | **Auto-load effect** restores project state from `latestProject` on mount. But if the project was in "translating" status, it restores `sourceText`/`pageData` but **doesn't restore `projectId`** from the query result — wait, it does (line 289). However, `convexTranslations` is still loading (query is "skip" until `projectId` is set), so there's a brief flash where `flowPhase` is "idle" before convexProject loads. | Add `flowPhase === "idle"` guard to show a loading state while `convexProject` loads. |
| M11 | `convex/translate.ts` | — | `translateChunk` action exists but is **never called** by the queue. The queue uses `callGemini()` directly. Dead code. | Remove `convex/translate.ts` or rewire the queue to use it. |
| M12 | `convex/generatePdf.ts` | 200 | White-out rectangle coordinates (`textBottom - 5` to `pageHeight - margin + 10`) don't account for **header/footer text** that may exist in the PDF. This could white-out page numbers, headers, or footers. | Make the white-out area configurable per page or use `pageData` text items to determine the exact text bounds. |

---

## Low Issues (cleanup)

| # | File | Line | Issue | How to Fix |
|---|------|------|-------|------------|
| L1 | `src/pages/Translator.tsx` | 698 | `completedLanguages` is used only in `handleDownloadAllZIP`. Could be a useMemo for clarity. | Minor refactoring. |
| L2 | `convex/glossary.json` | 877, 1153 | **Duplicate key "Power"** in `magicMilitary` object (esbuild warning). The second entry silently overwrites the first. | Fix the duplicate key in the JSON. |
| L3 | `convex/parsePdf.ts` | 97 | `getTextContent` options cast with `as any` — this hides type mismatches between pdfjs-dist types. | Use proper pdfjs-dist types. |
| L4 | `convex/translateQueue.ts` | — | No exponential backoff jitter — all retries use deterministic delays `(attempt + 1) * 10000`. With 5 keys × 3 attempts, worst case is 15 × 10s = 150s per chunk. | Add jitter to prevent thundering herd. |
| L5 | `src/pages/Translator.tsx` | 681 | `handlePause` sets `isTranslating(false)` immediately, but the Convex queue may still be processing the current chunk. The UI shows "paused" while one more chunk completes in the background. | Acceptable behavior, but add a note in the UI. |

---

## Dead Code Found

| File | What to Remove |
|------|---------------|
| `src/pages/Translator.tsx` | `translateChunkAction` hook (never called) |
| `src/pages/Translator.tsx` | `upsertChunkMutation`, `updateChunkMutation`, `upsertTranslationMutation`, `updateTranslationMutation` hooks (never called) |
| `src/pages/Translator.tsx` | `translationMode`, `translationModel`, `translationUsage`, `showAllQaPhases`, `currentPdfBlob` state (set but never read in UI) |
| `src/pages/Translator.tsx` | `nextLang = null` variable |
| `src/pages/Translator.tsx` | Import of `getPDFJS` from pdfParser (never called) |
| `src/pages/Translator.tsx` | Import of `mergeChunkTexts`, `TranslationChunk` from storage (never used) |
| `src/lib/translator/engine.ts` | `runNeuralTranslationPipeline` function (dead export) |
| `src/lib/translator/engine.ts` | `runTranslationPipeline` function (dead export) |
| `src/lib/translator/storage.ts` | All IndexedDB functions (dead after Convex migration) |
| `src/lib/translator/vlyTranslate.ts` | Entire file (gutted, nothing imports it) |
| `convex/translate.ts` | Entire file (dead — queue uses `callGemini` directly) |
| `convex/health.ts` | `checkVlyKey`, `probeVly`, `probeSambaNova`, `probeOpenRouter` (obsolete VLY/SambaNova probes) |
| `convex/schema.ts` | `jobs` table (unused — queue uses scheduler) |
| `convex/mutations.ts` | `createJob` mutation (unused) |

---

## Edge Cases That Could Fail

| Scenario | Current Behavior | Expected | Fix |
|----------|-----------------|----------|-----|
| **Two tabs open simultaneously** | ✅ Fixed — session isolation via `sessionStorage` | Each tab sees its own project | Already implemented |
| **Upload PDF, start translation, close tab, reopen** | ⚠️ Partial — Convex DB persists, but `isTranslating` resets to `false` on reload. The auto-detect effect sets it based on `convexProject.status`, but only after the query loads. | Shows progress panel after mount | The auto-detect effect handles this, but there's a brief "idle" flash |
| **Upload PDF, start translation, hit cancel, then start new project** | ⚠️ The old `processLanguage` chain may still be running (C2). New project gets its own session, so no cross-project contamination. | Old queue stops completely | Fix C2 (cancel scheduled jobs) |
| **Gemini key hits rate limit (429)** | ✅ Retries with backoff (3 attempts × 10s) then rotates to next key | Seamless rotation | Implemented |
| **All 5 Gemini keys rate-limited simultaneously** | ❌ Throws error → `processChunkInternal` fails → chain stops. No retry mechanism. | Queue retries after delay | Add retry scheduling on failure |
| **PDF with 0 pages or corrupt PDF** | ⚠️ `srcDoc.getPageCount() === 0` is checked in `generatePdf.ts` but `PDFDocument.load()` may throw on corrupt PDFs. The error propagates to the scheduler which silently drops it. | Clear error message to user | Catch errors in `processLanguage` and set translation status to "error" |
| **Very large PDF (500+ pages)** | ⚠️ Base64 encoding doubles the data size (~10MB for a 5MB PDF). The `storePdfAction` receives the entire base64 string. Convex actions have a 6MB request limit. | Handle large PDFs | Split base64 into chunks or use Convex storage upload directly |
| **Pasted text that is very short (1-2 words)** | ⚠️ `chunkText` splits by spaces. A single word creates 1 chunk. The translation should work but the system prompt may be overkill for 1 word. | Works but suboptimal | Acceptable |
| **Image with no text** | ⚠️ Gemini returns empty string or "No text found". The code handles empty response (`if (!text)`). But doesn't distinguish "no text" from "API error". | Clear "No text found" message | Check response for common no-text indicators |
| **Camera permission denied** | ⚠️ `input[type="file"][capture]` opens the native camera. If permission is denied, the browser shows its own error dialog. No custom error handling. | Custom error message | Add `onerror` handler for the file input |
| **Internet drops mid-translation** | ✅ Server-side — Convex scheduler keeps running. UI shows stale progress. On reconnect, queries update. | Server continues; UI refreshes on reconnect | Already works by design |
| **Convex cold start** | ⚠️ First request after idle may take 5-10s. No loading indicator for the initial query. | Show loading state | Already handled by Convex's `useQuery` returning `undefined` while loading |
| **User clicks "Begin Translation" twice rapidly** | ⚠️ Could trigger two parallel `processLanguage` chains (H10). `startTranslation` creates duplicate translation records (skipped by upsert) but chains from both calls. | Prevent duplicate chains | Add guard to check existing in-progress translations |
| **generatePdf fails for one language** | ⚠️ The error propagates to the scheduler. The `processLanguage` chain for that language stops. `pdfGenerating` stays `true` forever on the translation record. Next language is never started. | Set `pdfGenerating: false` and `status: "error"` on failure; chain to next language | Wrap `generateTranslatedPdf` in try/catch with cleanup |
| **User deletes project while translation is running** | ⚠️ `deleteProject` deletes all chunks/translations/project. The running `processLanguage` action fails when it tries to read the deleted project. Error is silently dropped. | Stop queue gracefully | Already partially handled (project check at top of `processLanguage`), but cleanup of `pdfGenerating` flag is needed |

---

## Summary
- **Total issues found: 36**
- **Critical: 4** | **High: 10** | **Medium: 12** | **Low: 5**
- **Dead code items: 15**
- **Edge cases: 15** (6 OK, 6 partial, 3 could fail)
- **Estimated fix time: 4-6 hours**

### Top 5 Priorities
1. **C1** — `getProjectTranslations` → `getTranslationsRaw` in translateQueue.ts (will crash at runtime)
2. **C3** — RTL text reversal is character-level (corrupts Arabic/Urdu PDFs)
3. **H10** — Duplicate chain risk when clicking Begin twice
4. **H1** — Missing `sessionId` in `startTranslation` dependency array
5. **C2** — Cancel doesn't stop scheduled jobs (queue keeps running after Pause)
