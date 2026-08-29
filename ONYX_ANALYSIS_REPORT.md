# OnyxTranslate — Deep Analysis Report: Server-Side Migration Problems

## Executive Summary

The migration from client-side (IndexedDB) to server-side (Convex) introduced **7 critical issues** and **5 secondary issues**. The most fundamental problem is that **the server-side architecture was designed without per-session isolation**, causing every browser tab to see the same shared state. Secondary problems include broken real-time progress, missing intermediate text preview, and an incomplete UI integration between the old client-side state and the new Convex queries.

---

## CRITICAL ISSUES (Block Everything)

### C1. No Per-Session Isolation — All Tabs Share One Project

**Problem:**
When a user opens a new tab (or private tab), `convex/queries.ts` → `getLatestProject` returns the MOST RECENT project in the ENTIRE database. The `useEffect` on mount in `Translator.tsx` (line ~295) auto-restores it:

```tsx
// convex/queries.ts line 9
export const getLatestProject = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").order("desc").take(1);
    return projects[0] ?? null;
  },
});
```

```tsx
// Translator.tsx line ~295
useEffect(() => {
  if (!latestProject) return;
  setProjectId(latestProject._id);  // EVERY tab picks up the SAME project
  setSourceText(latestProject.fullText);
  // ...
}, [latestProject]);
```

**Result:** Every tab — preview, published site, private window — shows the same project and the same progress. The user cannot start a fresh translation in a new tab without the old one interfering.

**Root Cause:** `getLatestProject` has no session/user filtering. Convex is a shared database — without a session ID, every client reads the same data.

**Fix Required:** 
- Generate a unique `sessionId` per browser tab (crypto.randomUUID() stored in sessionStorage, not localStorage).
- Add `sessionId: v.optional(v.string())` to the `projects` table schema.
- Change `getLatestProject` to filter by `sessionId`.
- When creating a project, pass the current `sessionId`.

---

### C2. Real-Time Progress Doesn't Update During Translation

**Problem:**
The progress panel shows `Chunk N/M` and percentage, but these values appear frozen or update very infrequently. The Convex reactive query `getChunksForLang` is the data source, but the `processChunkInternal` function in `convex/translateQueue.ts` updates chunks via mutations. The issue is:

1. `processChunkInternal` calls `updateChunk` to set a chunk to `status: "done"` with translated text.
2. It then calls `updateTranslation` to set `completedChunks`.
3. Convex should reactively push these updates to the client.

**However**, the actual bottleneck is in how the client derives state. The `inProgressTranslation` is computed as:

```tsx
const inProgressTranslation = activeTranslations.find((t) => t.status === "in_progress");
```

But the backend sets `status: "complete"` when ALL chunks for a language finish, and `status: "in_progress"` only when there are more chunks. The gap: when chunk N is done but chunk N+1 hasn't started yet (between scheduler invocations), the translation status might not be "in_progress" — it could be stuck in a previous state.

**Root Cause:** The scheduler uses `runAfter(0, ...)` which queues the next chunk. Between the current chunk completing and the next one starting, there's a brief window where the translation record might not have an updated `completedChunks` count visible to the client.

**Fix Required:**
- After each chunk completes, immediately update the translation's `completedChunks` count (this IS done, but the Convex query may lag).
- Consider updating `completedChunks` INSIDE the same mutation that marks the chunk done (atomic update).
- Alternatively, add a `lastUpdated` timestamp to translations so the client can show "updating..." state.

---

### C3. Translated Text Preview Is Empty During Translation

**Problem:**
The right panel is supposed to show translated text as chunks complete. But the code uses:

```tsx
const currentTranslation = previewTranslation?.mergedText ?? null;
```

`mergedText` is ONLY set when the ENTIRE language finishes (all chunks done). During active translation, individual chunk translations are in the `chunks` table, but the `translations.mergedText` is null until completion.

**Result:** The right panel shows nothing (or a spinner) until an entire language finishes. The user expects to see text streaming in as each chunk completes.

**Root Cause:** The system was designed to merge all chunks at the end, then store `mergedText`. There's no mechanism to fetch and concatenate individual chunk translations in real-time.

**Fix Required:**
- Add a new query `getTranslatedTextProgress` that joins chunks for a language, sorted by `chunkIndex`, filtering for `status: "done"`, and returns the concatenated text of completed chunks.
- Use this query instead of `mergedText` for the preview panel.
- Only use `mergedText` for PDF generation (where all chunks must be complete).

---

### C4. PDF Generation Fires Too Early / Without UI Feedback

**Problem:**
When a language finishes all chunks, `translateQueue.ts` → `processLanguage` immediately schedules `generatePdf.generateTranslatedPdf`. The PDF generation:
1. Runs on Convex server (no client visibility)
2. Takes time (downloading fonts, processing pages)
3. No progress feedback to the user
4. The user sees "generating_pdf" badge but doesn't know if it's 1% or 99% done

Additionally, the PDF overlay logic in `generatePdf.ts` is rudimentary:
```tsx
// Split translated text proportionally across pages
const perPageWords = Math.ceil(totalWords / srcPageCount);
```
This ignores page structure, chapter breaks, images, maps, and text boxes.

**Root Cause:** 
- No PDF generation progress tracking in the schema (no `pdfProgress` field).
- The PDF text distribution is naive (equal word split per page).
- The whiteout rectangle covers the ENTIRE page area, potentially covering images.

**Fix Required:**
- Add `pdfProgress: v.optional(v.number())` to translations schema (0-100).
- The `generatePdf` action should update this field periodically.
- The client subscribes via reactive query for real-time PDF progress.
- Improve the text distribution to respect page structure from `pageData`.
- Make the whiteout area more precise (cover text areas, not images).

---

### C5. Old Client-Side Code Still Runs Alongside Server-Side

**Problem:**
`Translator.tsx` still imports and uses client-side translation engine code:
```tsx
import { runLocalizedTranslationPipeline, generateSampleText, type TranslationMode } from "@/lib/translator/engine";
```

The file still has `QAReport`, `NeuralProgressCallback`, `BaselineSummary`, `generateTranslatedPDF` imports. The `handleDownloadPDF` function still tries client-side PDF generation as a fallback. The `handleDownloadAllZIP` function still tries client-side ZIP creation.

This creates confusion: which path is actually being used? The client-side engine (`engine.ts`) still calls the old `vlyTranslate` path (which falls back to glossary mode), and the server-side queue (`translateQueue.ts`) calls Gemini directly. Both exist simultaneously.

**Root Cause:** The migration was incremental — server-side was added but old code wasn't removed.

**Fix Required:**
- Remove `runLocalizedTranslationPipeline` import and all client-side translation logic.
- Remove `QAReport`, `NeuralProgressCallback`, `BaselineSummary` state (unless QA is moved server-side).
- Remove client-side `generateTranslatedPDF` import (server generates PDFs now).
- Keep client-side PDF generation ONLY as a fallback when server generation fails.
- Clean up the `handleDownloadAllZIP` to only use server ZIPs.

---

### C6. `flowPhase` State Conflicts with Convex Server State

**Problem:**
The client maintains `flowPhase` as local React state:
```tsx
const [flowPhase, setFlowPhase] = useState<"idle" | "translating" | "translation-done" | "generating-pdf" | "all-complete">("idle");
```

But the server has its own status field:
```tsx
// projects.status: "ready" | "translating" | "all_translated" | "complete" | "cancelled"
```

These two can desync:
1. Server finishes all translations → sets `status: "all_translated"` → schedules ZIP
2. Client's `flowPhase` might still be "translating" if the `useEffect` didn't fire
3. Or: user pauses → server sets `status: "cancelled"` → client `flowPhase` stays "translating"

The auto-detect effect tries to sync:
```tsx
useEffect(() => {
  if (convexProject.status === "all_translated") setFlowPhase("all-complete");
  // ...
}, [convexProject, activeTranslations, completedCount]);
```

But this can miss transitions or fire in wrong order.

**Root Cause:** Dual state management — React state + Convex DB state.

**Fix Required:**
- Derive `flowPhase` entirely from Convex data (no local `flowPhase` state).
- Create a computed value: `const flowPhase = useMemo(() => { ... }, [convexProject, activeTranslations])`.
- Remove `setFlowPhase` calls — let Convex be the single source of truth.

---

### C7. Progress Panel Layout Is Tiny and Incomplete

**Problem:**
The progress panel (lines 1320-1430) is rendered as a small card in the left sidebar:
```tsx
{flowPhase !== "idle" && (
  <div className="rounded-xl border overflow-hidden neon-border" style={{ background: 'rgba(10,10,22,0.9)' }}>
    ...
    <ScrollArea className="max-h-[280px]">
```

Issues:
1. Max height is only 280px — with 20 languages, items are compressed
2. The neon progress bar at the top only shows overall completion, not which language is active
3. The "Chunk N/M" text is 9px font — barely readable
4. No animation on the progress bar (just `transition-all duration-500`)
5. No language name highlight for the currently translating language
6. No "estimated time remaining" or throughput indicator
7. No visual separation between completed, active, pending, and PDF-generating states

**Root Cause:** The progress panel was hastily converted from the old per-language UI without redesigning for the new autonomous queue model.

**Fix Required:**
- Redesign as a full-width progress section (not a sidebar card)
- Show: Active language name (large), chunk progress (N/M with progress bar), overall progress (X/20 languages)
- Color-code: Cyan = done, Purple = translating, Orange = PDF generating, Gray = pending
- Add pulsing animation for the active language
- Show throughput: "≈2 min/chunk • ETA: ~45 min"
- Collapsible per-language details below the main progress

---

## SECONDARY ISSUES

### S1. No "Start Fresh" When Project Already Exists

**Problem:** When a user uploads a new PDF, the code calls `deleteProjectMutation` to remove the old project. But if the old project's translation queue is still running on the server (scheduler), the deletion might not stop the running actions. The scheduler will try to process chunks for a deleted project and fail.

**Fix:** Call `cancelTranslation` BEFORE deleting the project.

---

### S2. Text Area Doesn't Clear Server Project When Pasting New Text

**Problem:** When the user types new text in the textarea, the code:
```tsx
if (projectId) await deleteProjectMutation({ projectId }).catch(() => {});
resetFlow();
```
This deletes the project but doesn't cancel any running translations first. Same issue as S1.

---

### S3. Image Translation Results Not Persisted in Convex

**Problem:** The `saveImageTranslation` mutation exists but is never called from the client. Image translations exist only in React state and are lost on page refresh.

**Fix:** Call `saveImageTranslation` after each image translation completes.

---

### S4. Export/Import Buttons Are Non-Functional

**Problem:** The Export button downloads a JSON summary, but it doesn't include the actual translated text or PDFs. The Import function is a no-op:
```tsx
const handleImportProgress = useCallback(async () => {
  // Import is not needed with Convex — data persists server-side.
}, []);
```
The user might want to move work between devices or back up data.

---

### S5. `convexProject` Auto-Restore Doesn't Handle `pageData` Correctly

**Problem:** The auto-restore effect sets:
```tsx
setPageData(latestProject.pageData);
setOriginalPageTexts(latestProject.pageData.map((p: any) => p.text));
```
But `pageData` is stored as `v.any()` in the schema. When retrieved from Convex, it might not have the exact same shape as `PDFPageData[]` (missing `textItems`, `pageWidth`, etc.), causing downstream PDF generation to fail.

---

## ROOT CAUSE ANALYSIS

### Why does the progress section not work?

1. **No session isolation** → Every tab sees the same project, confusing the user
2. **`flowPhase` desync** → Local React state doesn't reliably reflect server state
3. **`mergedText` only available after completion** → No intermediate text preview
4. **Progress panel is too small** → 280px max-height with 9px text
5. **No real-time chunk count update** → Convex subscription might have lag

### Why does text not appear in preview during translation?

1. **`currentTranslation` uses `mergedText`** → Only set when language fully completes
2. **Individual chunks are in `chunks` table** → No query concatenates them in real-time
3. **No streaming/SSE** → Convex queries poll at intervals, not push per-chunk

### Why does PDF generation start automatically without preview?

1. **`processLanguage` schedules PDF immediately after last chunk** → No intermediate preview step
2. **No "view text first, generate PDF later" option** → The pipeline is fully automated
3. **PDF generation is server-side** → User has no control over when it starts

### Why do all tabs show the same progress?

1. **`getLatestProject` returns the most recent project globally** → No session filter
2. **`useEffect` auto-restores on mount** → Every tab picks up the latest project
3. **No sessionId concept** → Convex DB has no way to distinguish users/sessions

---

## WHAT NEEDS TO HAPPEN (Priority Order)

### Phase A: Session Isolation (Must be first)
1. Add `sessionId` to projects schema
2. Generate unique sessionId per tab (sessionStorage)
3. Filter all queries by sessionId
4. Pass sessionId when creating projects

### Phase B: Real-Time Progress + Text Preview
1. Add query: `getTranslatedChunksProgress(projectId, langCode)` — returns concatenated completed chunks
2. Use this query for the right panel preview
3. Add `pdfProgress` field to translations schema
4. Show PDF generation progress in real-time

### Phase C: UI Redesign
1. Remove local `flowPhase` state → derive from Convex
2. Redesign progress panel: full-width, prominent, animated
3. Remove old client-side engine imports
4. Clean up dead code

### Phase D: Pipeline Fixes
1. Add cancel-before-delete pattern
2. Persist image translations
3. Improve PDF text distribution
4. Add "pause before PDF" option

---

## FILES INVOLVED

| File | Issues |
|------|--------|
| `convex/schema.ts` | Missing `sessionId` field, missing `pdfProgress` |
| `convex/queries.ts` | `getLatestProject` needs session filter |
| `convex/translateQueue.ts` | No progress update per chunk, early PDF trigger |
| `convex/generatePdf.ts` | Naive text distribution, no progress reporting |
| `convex/mutations.ts` | Missing cancel-before-delete helper |
| `src/pages/Translator.tsx` | Dual state management, dead imports, tiny progress UI, mergedText-only preview |

---

## VERIFICATION CHECKLIST

- [ ] Open tab A → upload PDF → start translation
- [ ] Open tab B → should see EMPTY state (not tab A's project)
- [ ] Tab A: progress bar shows chunk N/M for active language
- [ ] Tab A: right panel shows translated text AS chunks complete
- [ ] Tab A: after language finishes, PDF generation progress shown
- [ ] Tab A: after all done, ZIP available for download
- [ ] Tab B: still empty — no contamination from tab A
- [ ] Pause → Resume → continues from where it stopped
- [ ] Start Fresh → deletes old project, starts clean
- [ ] Upload new PDF → old project cancelled and deleted first
