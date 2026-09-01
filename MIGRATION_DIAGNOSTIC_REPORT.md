# Migration Diagnostic Report

**Date:** September 1, 2026  
**Auditor:** Buffy (automated forensic code audit)  
**Scope:** Onyx Translate client→server migration (IndexedDB→Convex)

---

## Executive Summary

The migration from client-side IndexedDB to server-side Convex introduced 5 critical architectural flaws that compound into the reported symptoms. **The "Begin Translation" button IS wired correctly and CAN fire** — the real issue is that the `translateLanguage` action creates translation records but **does not update the project status to "translating"**, so the UI never transitions out of "idle" flowPhase, the progress panel never appears, and the user sees zero feedback. Image translation works because it's a single synchronous server action with immediate return — no DB state machine required. Text/PDF translation fails because it requires 4 coordinated mutations (project status, translation records, chunk writes, scheduler chains) and the first mutation is never called.

---

## Task 1: Begin Translation Button

### Code Path Trace

| Step | What Happens | File:Line | Verdict |
|------|-------------|-----------|---------|
| 1. Button click | `onClick={startTranslation}` | Translator.tsx:1578 | ✅ Wired |
| 2. Guard: empty text | `if (!sourceText.trim()) return` | Translator.tsx:728 | ✅ Correct |
| 3. Guard: already translating | `if (isTranslating) return` | Translator.tsx:731 | ⚠️ See state conflict below |
| 4. Create project (paste) | `createProjectMutation({ status: "ready" })` | Translator.tsx:740 | ✅ Works |
| 5. Call action | `translateLanguageAction({ projectId, langCode, ... })` | Translator.tsx:762 | ✅ Dispatched |
| 6. Action: read project | `getProjectRaw(projectId)` | translateContent.ts | ✅ |
| 7. Action: check cancelled | `if (project.status === "cancelled") return` | translateContent.ts | ✅ |
| 8. Action: create chunks | Creates chunk records in loop | translateContent.ts | ✅ |
| 9. **MISSING: update project status** | **`status` stays "ready" forever** | **translateContent.ts** | **🔴 CRITICAL** |
| 10. Action: call Gemini | `callGemini(keys, systemPrompt, userContent)` | translateContent.ts | ✅ (if keys exist) |
| 11. Action: save chunk | `updateChunk(chunkId, ...)` | translateContent.ts | ✅ |
| 12. Action: update translation | `updateTranslation(translationId, status: "in_progress")` | translateContent.ts | ⚠️ See below |

### Root Cause #1: Project status never changes to "translating"

The `translateLanguage` action in `convex/translateContent.ts` **never calls `api.mutations.updateProject`** to set `status: "translating"`. It only creates translation records and chunk records. Because the project status stays `"ready"`:

- `flowPhase` stays `"idle"` (line 176: `return "idle" as const` when status is "ready")
- The progress panel never shows (`{flowPhase !== "idle" && (...)}`)
- The user sees no UI change after clicking

**Evidence:** `convex/translateContent.ts` has zero references to `api.mutations.updateProject`. The only place project status is set is `cancelTranslation` in `translateQueue.ts:736`.

### Root Cause #2: Translation records may not be created

The `translateLanguage` action calls `upsertChunk` (mutations.ts) but **does NOT call `upsertTranslation`** first. The translation record is only created by `translateQueue.startTranslation` (translateQueue.ts:569). If `startTranslation` was never called (the new flow uses `translateLanguage` instead), translation records may be missing.

Looking at the code: `translateContent.ts` queries `getTranslationsRaw` at line 409, finds the translation record, and updates it. But **if no translation record exists** (because `startTranslation` was never called), `translation` is `undefined` and the `if (translation)` guard skips the update silently. The chunk still gets saved, but the `completedChunks` counter never advances.

### Root Cause #3: `isTranslating` stuck on page reload

When the user reloads the page, the `useEffect` at line 319 restores `projectId` and `sourceText` from `latestProject`. If the project status is `"ready"` (because root cause #1 was never fixed), `isTranslating` stays `false` — but `flowPhase` stays `"idle"`, so the user sees the upload panel again, not the progress panel. If they click "Begin Translation" again, a new `translateLanguage` action fires, but the old chunks still exist with `status: "pending"`, so the action skips them (line 353: `if (existing?.status === "done") ... continue`). The chunks were never marked "done" because the first attempt also had this bug.

### Findings Table

| Check | Expected | Actual | Gap |
|-------|----------|--------|-----|
| Button wired to handler | `onClick={startTranslation}` | `onClick={startTranslation}` | None |
| Guard: empty text | Silent return | Silent return | None |
| Guard: isTranslating | Prevent double-fire | Prevents (but gets stuck from prev session) | ⚠️ |
| Create project | status: "ready" → "translating" | status: "ready" forever | 🔴 |
| Create translation records | `upsertTranslation` called | **NEVER called** in translateContent.ts | 🔴 |
| Update project status | `updateProject({ status: "translating" })` | **NEVER called** | 🔴 |
| UI transition idle→translating | `flowPhase` changes | `flowPhase` stays "idle" | 🔴 |
| Progress panel appears | Shows when `flowPhase !== "idle"` | Never shows | 🔴 |

### Most Likely Explanation for "Unresponsive Button"

The button **does fire**. The `translateLanguage` action **does execute**. But because (1) the project status stays "ready", (2) no translation records are created upfront, and (3) the UI derives everything from project status, the user sees **zero visual feedback**. The action silently processes chunks in the background, but the UI stays on the upload panel. This is indistinguishable from "the button doesn't work."

---

## Task 2: Import/Export

### Current State

| Function | File | What It Does | Status |
|----------|------|-------------|--------|
| `handleExportProgress` | Translator.tsx:536 | Creates JSON blob of project metadata + translation statuses, triggers browser download | ⚠️ PARTIAL |
| `handleImportProgress` | Translator.tsx:561 | **Empty function body** — comment says "Import is not needed with Convex" | 🔴 MISSING |
| Export button UI | Translator.tsx:1110 | `<Button onClick={handleExportProgress}>` | ✅ Wired |
| Import button UI | Translator.tsx:1119 | `<Button onClick={handleImportProgress}>` | ✅ Wired (does nothing) |

### Export Analysis

The export function serializes:
```json
{
  "project": { "fileName", "pageCount", "wordCount", "status" },
  "translations": [{ "langCode", "status", "totalChunks", "completedChunks" }],
  "exportedAt": "ISO timestamp"
}
```

**Missing from export:** `pageData`, `fullText`, `pdfStorageId`, actual `mergedText`, chunk-level translations, QA reports. The export is metadata-only — importing it back would restore progress counters but not the actual translated text.

### Import Analysis

The import function is a no-op:
```typescript
const handleImportProgress = useCallback(async () => {
  // Import is not needed with Convex — data persists server-side.
}, []);
```

This is wrong. Convex data persists **per deployment**, not per user. If the user:
- Switches browsers → data lost (sessionStorage is per-tab)
- Uses a different device → data lost
- Deployment is reset → data lost

### Old vs New

| Old Function | Old Logic | New Equivalent | Gap |
|-------------|-----------|----------------|-----|
| `exportAllProgress` (storage.ts) | Serializes full IndexedDB: project + all chunks + all translations + PDF blobs as Base64 | `handleExportProgress`: metadata only | 🔴 Lost chunk text, PDF data |
| `importAllProgress` (storage.ts) | Parses JSON, writes to IndexedDB stores, triggers re-parse if needed | Empty function | 🔴 Completely missing |
| Export format | Full JSON with `pdfBase64`, `chunks[]`, `translations[]`, `pageData[]` | Minimal JSON with `project{}` + `translations[]` | 🔴 90% of data missing |
| Import triggers | Re-creates project, re-runs pipeline | Nothing | 🔴 Dead button |

---

## Task 3: Image vs Text/PDF Architecture

### Side-by-Side Comparison

| Aspect | `translateImage` | `translateLanguage` (translateContent) |
|--------|------------------|---------------------------------------|
| **Action type** | Single action, single call | Single action, loops through chunks |
| **Gemini call** | Direct `fetch()` with 5-key rotation | Same `fetch()` with 5-key rotation |
| **Chunking** | None (single image = single request) | 2500-word chunks, loops |
| **Progress tracking** | Saves to `imageTranslations` table via `saveImageTranslation` mutation | Updates `chunks` table + `translations` table |
| **Error handling** | Returns `{ ok: false, error }` on failure | Same pattern + throws on exhaustion |
| **Result delivery** | Returns immediately to client via `useAction` | Returns when first language complete; chains rest via `scheduler` |
| **DB state machine** | None needed — result is self-contained | Requires: project.status, translation.status, chunk.status |
| **Post-processing** | None | Bible Pass, cultural filters, dragon telepathy, RTL marker, QA |
| **System prompt** | Simple 6-line OCR prompt | Full 23-phase localization prompt (500+ lines) |
| **Execution time** | ~2-5 seconds | ~30-120 seconds per language |
| **User feedback** | Immediate (result in state) | Delayed (first chunk must complete) |

### Why Image Works But Text/PDF Doesn't

**Image translation** is a simple request-response cycle:
1. Client calls `translateImageAction({ imageBase64, langCode })`
2. Server calls Gemini, gets result, saves to DB, returns result
3. Client receives result, updates UI immediately

**Text/PDF translation** requires a state machine:
1. Client calls `translateLanguageAction({ projectId, langCode, ... })`
2. Server must: create translation records, create chunk records, translate each chunk, update translation progress, chain to next language
3. Client UI must: detect project status change → show progress panel → show per-language progress
4. **Step 2 never creates translation records** (missing `upsertTranslation` call)
5. **Step 3 never triggers** because project status stays "ready"

The fundamental difference: image translation doesn't need UI coordination. Text/PDF translation requires the UI to observe DB state changes, but those state changes never happen.

### Dead Code: `translateQueue.ts`

`convex/translateQueue.ts` contains:
- `startTranslation` (line 547) — creates translation records + starts chain
- `processLanguage` (line 612) — processes chunks for one language
- `cancelTranslation` (line 732) — sets project status to "cancelled"

**`startTranslation` is the function that creates translation records.** It's still deployed and callable, but the new UI (`translateContent.ts` path) never calls it. The `cancelTranslation` function IS still called by the UI (for the pause button), so `translateQueue.ts` is not fully dead.

However, `processLanguage` in `translateQueue.ts` is dead code — the new `translateContent.ts:translateLanguage` replaced it but with a different approach (all chunks in one action vs. scheduler chain per chunk).

---

## Task 4: Feature Comparison (Old vs New)

| Feature | Old File/Function | New File/Function | Status | Explanation |
|---------|------------------|-------------------|--------|-------------|
| Text chunking | `chunkPageTexts()` in Translator.tsx | `chunkText()` in translateContent.ts | ✅ WORKING | Same algorithm, moved to server |
| Progress save per chunk | `saveTranslationChunk()` in storage.ts (IndexedDB) | `updateChunkMutation` in mutations.ts (Convex) | ⚠️ BROKEN | Chunks are saved, but `completedChunks` counter on translation record never advances (no `upsertTranslation` call) |
| Resume from chunk | `handleResume()` + `getAllTranslations()` from IndexedDB | Convex query auto-restore via `getLatestProject` | ⚠️ PARTIAL | Project auto-loads on mount, but translation records may not exist (root cause #2), so progress shows 0/0 |
| Bible Pass (glossary lock) | `extractBiblePass()` in engine.ts | `applyBiblePassServer()` in translateContent.ts | ✅ WORKING | Identical logic, moved to server |
| QA checks | `runQA()` in qa.ts | `runQA()` in translateContent.ts | ✅ WORKING | Called after each chunk, score stored in chunk usage |
| PDF generation | `generateTranslatedPDF()` in pdf-render.ts (client) | `convex/generatePdf.ts` (server) | ⚠️ PARTIAL | Server PDF exists but `translateContent.ts` never calls it — no auto-PDF after translation completes |
| Export/Import | `exportAllProgress` / `importAllProgress` in storage.ts | `handleExportProgress` / `handleImportProgress` in Translator.tsx | 🔴 BROKEN | Export is metadata-only (no chunk text), Import is empty function |
| Cancel/Pause | `cancelCurrentTranslation()` in Translator.tsx | `cancelTranslation` in translateQueue.ts + `handlePause` in Translator.tsx | ✅ WORKING | Sets project status to "cancelled" |
| Language selection | `selectedLangCodes` state in Translator.tsx | Same state, passed as `langCodes` to action | ✅ WORKING | Correctly filters which languages to translate |
| Sliding window context | `previousContext` in translateContent.ts | Same in translateContent.ts | ✅ WORKING | Last 2 sentences prepended to next chunk |
| Image translation | Client-side Gemini SDK (old) | `convex/translateImage.ts` (server) | ✅ WORKING | Unified with text flow in UI |
| History panel | IndexedDB `history` store | `convex/history.ts` + `HistoryPanel` component | ✅ WORKING | Saves on completion |
| Auto-load project on mount | `loadSavedProject()` from IndexedDB | `useEffect` + `getLatestProject` query | ✅ WORKING | Restores project, sourceText, pageData |

---

## Task 5: State Management Confusion

### All `useState` Hooks Related to Translation State

| Hook | Type | Source | Purpose |
|------|------|--------|---------|
| `isTranslating` | `boolean` | Local React | Controls button state, progress panel visibility |
| `translationError` | `string \| null` | Local React | Error message display |
| `flowPhase` | Derived `useMemo` | Convex DB | Controls which UI panel shows (idle/translating/all-complete) |
| `projectId` | `Id<"projects"> \| null` | Local React | Current project reference |
| `selectedLangCodes` | `string[]` | Local React | Which languages to translate |
| `currentPreviewLangCode` | `string \| null` | Local React | Which language's translation to show in preview |
| `marketContext` | string enum | Local React | P6/P7/P13/P14 sensitivity setting |
| `pdfProgress` | Object \| null | Local React | PDF generation progress (legacy) |
| `currentPdfBlob` | Blob \| null | Local React | Generated PDF (legacy) |
| `translationMode` | TranslationMode \| null | Local React | AI vs Glossary badge (legacy) |
| `translationModel` | string \| null | Local React | Model name badge (legacy) |
| `translationUsage` | Object \| null | Local React | Token usage display (legacy) |

### Convex Queries (Server State)

| Query | Returns | Used For |
|-------|---------|----------|
| `latestProject` | Most recent project for this session | Auto-load on mount |
| `convexProject` | Specific project by ID + sessionId | Status derivation, flowPhase |
| `convexTranslations` | All translation records for a project | Progress display, preview text |

### Conflicts Found

#### Conflict 1: `isTranslating` vs `convexProject.status`

```typescript
// Line 319-327: Sync effect
useEffect(() => {
  if (!convexProject) return;
  if (convexProject.status === "translating") {
    setIsTranslating(true);      // Convex says "translating" → set local true
  } else if (convexProject.status === "ready" || ...) {
    setIsTranslating(false);     // Convex says "ready" → set local false
  }
}, [convexProject]);
```

**The problem:** `convexProject.status` NEVER changes to `"translating"` because `translateContent.ts` never calls `updateProject`. So this effect only fires on mount (setting `isTranslating = false`) and never again. Meanwhile, `startTranslation` sets `isTranslating = true` at line 734, but there's no mechanism to set it back to `false` when the action completes (the action returns a value, but `startTranslation` doesn't read it — it just saves to history and exits).

#### Conflict 2: `flowPhase` vs actual project status

```typescript
// Line 171-185: flowPhase derivation
const flowPhase = useMemo(() => {
  const s = project.status;
  if (s === "all_translated" || s === "complete") return "all-complete";
  if (s === "translating" || s === "parsing") return "translating";
  if (s === "cancelled" && translations.length > 0) return "translating";
  return "idle";
}, [convexProject, latestProject, convexTranslations]);
```

Because project status stays `"ready"`, `flowPhase` stays `"idle"`. The progress panel (`{flowPhase !== "idle" && (...)}`) never renders. The preview panel never renders. The user stays on the upload panel forever.

#### Conflict 3: Session isolation breaks auto-load

```typescript
// Line 100-106: Session ID
const [sessionId] = useState(() => {
  const existing = sessionStorage.getItem("onyx-session-id");
  if (existing) return existing;
  const newId = crypto.randomUUID();
  sessionStorage.setItem("onyx-session-id", newId);
  return newId;
});
```

`sessionStorage` is per-tab. If the user opens a new tab, they get a new `sessionId`. The query `getLatestProject({ sessionId })` returns `null` for the new session. The old project exists in Convex but is orphaned — it can't be queried by the new session because the `by_session` index filters by `sessionId`. This means:
- Tab A: starts translation, sees progress
- Tab B (same browser): fresh state, no project found
- This is by design ("session isolation"), but it conflicts with the user expectation that "OnyxTranslate should remember progress"

#### Conflict 4: `selectedLangCodes` starts empty

```typescript
const [selectedLangCodes, setSelectedLangCodes] = useState<string[]>([]);
```

The button is `disabled={selectedLangCodes.length === 0}`. If the user pastes text but doesn't click "Select All" or manually select languages, the button text says "Select languages to begin" and it's disabled. This is correct behavior, but combined with the zero visual feedback after clicking, it feels broken.

---

## Recommended Fix Priority

### P0 — Must Fix (causes "button does nothing")

1. **Add `updateProject({ status: "translating" })` at the start of `translateLanguage`** in `convex/translateContent.ts`. This is a 1-line fix that makes the entire UI state machine work.

2. **Add `upsertTranslation` call at the start of `translateLanguage`** to create translation records for all selected languages before processing chunks. Without this, `completedChunks` never advances and the progress bar stays at 0.

### P1 — Should Fix (causes broken resume/import)

3. **Fix import function** — currently empty. Should parse the export JSON, create a project + translation records in Convex, and set `projectId` in state.

4. **Fix export to include chunk text** — currently only exports metadata. Should query `getChunksForLang` and include `mergedText` in the export.

5. **Reset `isTranslating` when translation action returns** — add `.then()` / `.catch()` to the `translateLanguageAction` call in `startTranslation` to reset state on completion.

### P2 — Should Fix (causes poor UX)

6. **Add loading indicator between button click and first chunk** — the action takes 30+ seconds to return the first chunk. Show a spinner or progress animation.

7. **Add auto-PDF generation trigger** after translation completes — `translateContent.ts` never calls `generateTranslatedPdf`.

8. **Fix session isolation** — either use `localStorage` instead of `sessionStorage`, or add a "restore from link" feature.

### P3 — Nice to Have

9. **Clean up dead code** — `translateQueue.ts:processLanguage` is unused. `convex/translate.ts:translateChunk` is unused (replaced by `translateContent.ts`). `storage.ts` functions are still imported but only `mergeChunkTexts` is used.

10. **Remove legacy state hooks** — `translationMode`, `translationModel`, `translationUsage`, `pdfProgress`, `currentPdfBlob` are set but never read in the current UI.
