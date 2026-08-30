# Migration Regression Report

**Date:** August 30, 2026  
**Scope:** Onyx Translate — Client-Side (IndexedDB) → Server-Side (Convex) migration  
**Auditor:** Buffy (Codebuff)

---

## Executive Summary

The migration from client-side IndexedDB to server-side Convex **fundamentally changed the translation pipeline architecture**. Several critical features were lost or degraded:

1. **The entire client-side translation pipeline (`engine.ts`) is dead code** — the new queue (`translateQueue.ts`) bypasses it entirely, losing QA checks, translation memory, and the Bible pass (glossary lock).
2. **Text chunking now uses a DIFFERENT algorithm** — the old system chunked by page boundaries; the new system chunks by word count at arbitrary positions, potentially splitting mid-sentence.
3. **PDF overlay lost page-coordinate alignment** — the old system used `pageData[].textItems[].x/y` to place translated text precisely; the new system distributes text proportionally across pages with fixed margins, ignoring original text positions.
4. **QA checks (16 code-level validations) are gone** — the server queue returns only raw Gemini output with no quality checks.
5. **Translation memory (P21) is broken** — terminology decisions are never locked across chunks because the storage import is gone.
6. **Import/Export is completely removed** — no way to backup or restore progress.

## Build Status
- **convex dev:** ✅ PASS (3.76s)
- **tsc:** ✅ PASS (zero errors)
- **build:** ✅ PASS

---

## Area 1: Text Chunking

### Old Code (Client-Side) — `src/lib/translator/storage.ts:270-295`
```typescript
export function chunkPageTexts(
  pageTexts: string[],
  wordsPerChunk: number = 2000
): Array<{ pageStart: number; pageEnd: number }> {
  const chunks: Array<{ pageStart: number; pageEnd: number }> = [];
  let currentStart = 0;
  let currentWordCount = 0;

  for (let i = 0; i < pageTexts.length; i++) {
    const pageWords = pageTexts[i].split(/\s+/).filter(Boolean).length;
    if (currentWordCount + pageWords > wordsPerChunk && i > currentStart) {
      chunks.push({ pageStart: currentStart, pageEnd: i - 1 });
      currentStart = i;
      currentWordCount = pageWords;
    } else {
      currentWordCount += pageWords;
    }
  }
  if (currentStart < pageTexts.length) {
    chunks.push({ pageStart: currentStart, pageEnd: pageTexts.length - 1 });
  }
  return chunks;
}
```
**Key traits:** Splits at **page boundaries** (never mid-page). Each chunk knows which pages it covers (`pageStart`, `pageEnd`). Default: 2000 words/chunk.

### New Code (Server-Side) — `convex/translateQueue.ts:189-196`
```typescript
function chunkText(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }
  return chunks;
}
```
**Key traits:** Splits at **word boundaries** (can split mid-sentence, mid-paragraph). No page association. Default: 2500 words/chunk. Returns raw text strings, not page ranges.

### Gap:
1. **Mid-sentence splits** — The new chunker can break in the middle of a dialogue line or paragraph, causing translation context loss at chunk boundaries.
2. **No page awareness** — Chunks have no knowledge of which PDF pages they span, so the PDF overlay cannot correctly map translated text back to pages.
3. **Double chunking** — `startTranslation` calls `chunkText()` to create chunk records with source text, then `processChunkInternal` calls `chunkText()` AGAIN on every invocation. If `project.fullText` changes between these calls (e.g., after re-parsing), chunks become misaligned.
4. **Word count mismatch** — Old default was 2000 words; new default is 2500 words. This means fewer, larger chunks — more context per AI call (which is good) but longer processing time per chunk.

### Severity: Critical
### Fix:
- Change `chunkText` to split at paragraph/sentence boundaries instead of raw word counts
- Store source text in chunk records at creation time and use THAT (not re-chunking) during processing
- Consider re-introducing page-range awareness for PDF overlay mapping

---

## Area 2: Progress Saving

### Old Code (Client-Side) — `src/lib/translator/storage.ts:215-236`
```typescript
export async function saveTranslationChunk(
  langCode: string,
  langName: string,
  langNativeName: string,
  chunks: TranslationChunk[],
  mergedText: string | null,
  complete: boolean
): Promise<void> {
  const progress: LanguageProgress = {
    langCode, langName, langNativeName,
    completedChunks: chunks.filter((c) => c.complete).length,
    totalChunks: chunks.length,
    mergedText, complete, pdfDownloaded: false,
  };
  await dbPut(STORE_TRANSLATIONS, langCode, { progress, chunks });
}
```
**Key traits:** Saves to IndexedDB **immediately** after each chunk completes. Stores the entire `chunks[]` array and the `mergedText` together. Transactional — either all data saves or none does.

### New Code (Server-Side) — `convex/translateQueue.ts:315-345`
```typescript
// After Gemini call succeeds:
if (existing) {
  await ctx.runMutation(api.mutations.updateChunk, {
    chunkId: existing._id,
    translatedText: result.text,
    status: "done",
    model: result.model,
    usage: result.usage,
  });
} else {
  const chunkId = await ctx.runMutation(api.mutations.upsertChunk, { ... });
  await ctx.runMutation(api.mutations.updateChunk, { ... });
}

// Then update translation record:
await ctx.runMutation(api.mutations.updateTranslation, {
  translationId: translation._id,
  status: "in_progress",
  completedChunks: completedCount,
  startedAt: translation.startedAt || Date.now(),
});
```
**Key traits:** Saves per-chunk via `updateChunk` mutation, then updates `completedChunks` count via `updateTranslation`. Two separate mutations (not transactional). The `mergedText` is rebuilt in-memory by querying all chunks and joining them.

### Gap:
1. **Race condition on `completedChunks`** — The count is re-derived from all chunks after each save, but the query could see stale data if two chunks finish simultaneously (unlikely with sequential processing, but possible with future parallelism).
2. **No mergedText persistence per-chunk** — The merged text is only built when ALL chunks complete. During translation, the preview relies on `getLivePreviewText` which concatenates completed chunks. This works but is a new dependency on a reactive query.
3. **Missing per-chunk QA report** — The old system stored QA reports per-language alongside chunks. The new system has no QA storage at all.

### Severity: High
### Fix:
- Add a `qaReport` field to the `translations` table
- Update `completedChunks` atomically within the same mutation that saves the chunk (combine into one mutation)
- Verify `getLivePreviewText` correctly handles concurrent chunk writes

---

## Area 3: Resume / Recovery

### Old Code (Client-Side) — `src/pages/Translator.tsx` (mount effect)
```typescript
useEffect(() => {
  const loadProject = async () => {
    const project = await getProject(); // IndexedDB
    if (project) {
      const translations = await getAllTranslations(); // IndexedDB
      // Find which language was in progress
      // Find which chunk was in progress
      // Resume from exact chunk index
    }
  };
  loadProject();
}, []);
```
**Key traits:** Loads from IndexedDB on mount. Finds the exact language and chunk index that was in progress. Resumes automatically. Client-side only — no server state.

### New Code (Server-Side) — `src/pages/Translator.tsx:134`
```typescript
const latestProject = useQuery(api.queries.getLatestProject, { sessionId });
// Convex scheduler auto-resumes via ctx.scheduler.runAfter(0, ...)
```
**Key traits:** Convex reactive query shows project status. The scheduler chains `processLanguage` calls via `ctx.scheduler.runAfter(0, ...)`. If the browser closes, the scheduler's last-scheduled action completes, but **no new actions are scheduled after it finishes** — the pipeline stops at whatever chunk it was processing.

### Gap:
1. **Pipeline stops if browser closes mid-chunk** — If the browser closes while a chunk is being translated, the `processLanguage` action completes for that chunk and schedules the next. But if the action times out (Convex actions have a ~5min timeout), the chain breaks. There is NO auto-resume mechanism that detects an interrupted pipeline and restarts it.
2. **No "resume from chunk N" logic** — The old system explicitly found `chunkIndex` to resume from. The new system always starts from `chunkIndex: 0` for each language and relies on `if (existing?.status === "done") return { skipped: true }` to skip already-completed chunks. This works but is O(n) for resume — it must re-skip all completed chunks one by one.
3. **Missing reconnection logic** — When the user reopens the page, `latestProject` shows the project, but there's no `useEffect` that re-triggers `startTranslation` for an interrupted project. The user must click "Resume" manually.
4. **Scheduler persistence** — Convex scheduled functions survive server restarts, but if the chain is broken (action failed before scheduling the next), there's no watchdog to detect and repair it.

### Severity: Critical
### Fix:
- Add a "pipeline watchdog" that detects projects stuck in "translating" status and re-schedules the next incomplete chunk
- Add auto-resume on mount: if project status is "translating" and no active scheduler chain is detected, re-trigger `processLanguage` from the first incomplete chunk
- Track `lastScheduledChunkIndex` on the project so resume can skip directly to the right chunk

---

## Area 4: PDF Page Data Preservation

### Old Code (Client-Side) — `src/lib/translator/pdfParser.ts`
```typescript
export interface PDFTextItem {
  str: string;
  x: number;      // Position in PDF coordinates
  y: number;
  width: number;
  height: number;
  fontName: string;
}

export interface PDFPageData {
  num: number;
  text: string;
  textItems: PDFTextItem[];  // Per-item positions
  pageWidth: number;
  pageHeight: number;
}
```
The old PDF generator (`pdfGenerator.ts`) used these coordinates to:
1. White-out the exact area where English text was rendered
2. Overlay translated text at the same x/y positions
3. Preserve images, maps, and non-text elements (they were below the text layer)

### New Code (Server-Side) — `convex/generatePdf.ts:121-180`
```typescript
// Split translated text proportionally across pages
const translatedWords = args.mergedText.split(/\s+/).filter(Boolean);
const perPageWords = Math.ceil(translatedWords / srcPageCount);

// White-out ENTIRE text area with fixed margins
copiedPage.drawRectangle({
  x: textLeft - 5,      // 50px from left
  y: textBottom - 5,    // 50px from bottom
  width: maxWidth + 10,  // page width - 100px
  height: pageHeight - textBottom - margin + 10,  // entire text area
  color: white,
});

// Overlay text with fixed font size and margins
const fontSize = 10;
const lineHeight = fontSize * 1.4;
```
**Key traits:** Ignores `pageData` coordinates entirely. Uses fixed 50px margins. Whites out the entire text area (covers any images/maps in the text zone). Distributes text proportionally by word count.

### Gap:
1. **Lost coordinate precision** — The old system placed text exactly where English text was. The new system uses fixed margins, so text may overlap images, headings, or decorative elements.
2. **pageData stored but never used** — The `projects` table stores `pageData` (with all the x/y/width/height info), but `generatePdf.ts` never reads it. It just distributes translated text evenly.
3. **Fixed font size** — Always uses 10pt font regardless of the original document's font sizes. Small print becomes too large; large headings become too small.
4. **Proportional text distribution is unreliable** — If one page's translation is much denser than others (e.g., a chapter title page vs. a dense text page), the proportional split puts too much or too little text on each page.
5. **White rectangle covers images** — The white-out rectangle covers the entire text area including any inline images, maps, or decorative elements that the original text was positioned around.

### Severity: Critical
### Fix:
- Use `pageData[].textItems[]` coordinates to white-out and overlay text at the correct positions
- Map translated text chunks back to their source pages using the chunk→page mapping from chunking
- Preserve inline images by white-outing only the text bounding boxes, not the entire page

---

## Area 5: Translation Pipeline Execution

### Old Code (Client-Side) — `src/lib/translator/engine.ts:362-480`
```typescript
export async function runLocalizedTranslationPipeline(
  config: TranslationConfig,
  onProgress?: NeuralPipelineProgressCallback,
  aiTranslate?: AiTranslateFn
): Promise<TranslationResult> {
  // Phase 1: Bible Pass — lock glossary terms with placeholders
  const { text: bibleText, placeholders } = applyBiblePass(sourceText, targetLanguage);
  
  // Phase 2: AI call (via injected function)
  if (aiTranslate) {
    const aiResult = await aiTranslate({ text: bibleText, langCode: targetLanguage, ... });
    if (aiResult.ok) {
      translatedText = aiResult.text;
      mode = "vly";
    }
  }
  
  // Phase 3: Restore placeholders
  translatedText = restorePlaceholders(translatedText, placeholders);
  
  // Phase 4: Cultural formatters (second pass)
  translatedText = applyCulturalFilters(translatedText, targetLanguage, marketContext);
  
  // Phase 5: Dragon telepathy formatting
  translatedText = translatedText.replace(thoughtPattern, ...);
  
  // Phase 6: RTL marker
  if (scriptConfig.direction === "rtl") translatedText = `\u200F${translatedText}`;
  
  // Phase 7: Code-level QA
  const qaReport = runQA(sourceText, translatedText, targetLanguage, memoryEntries);
  
  // Phase 8: Translation Memory — lock terms
  await saveTerminologyBatch(tmEntries);
  
  return { translatedText, phases, report, csvData, voiceNotes, qaReport, mode, model, usage };
}
```
**Key traits:** 23-phase pipeline with Bible pass, AI translation, post-processing (placeholders, cultural, telepathy, RTL), QA checks, and translation memory lock. Returns structured result with QA report and mode.

### New Code (Server-Side) — `convex/translateQueue.ts:267-290`
```typescript
const systemPrompt = buildSystemPrompt(langCode, "standard");
let userContent = sourceChunks[chunkIndex];
if (previousContext) {
  userContent = `Previous chunk ended with: ${previousContext}\n\nContinue seamlessly.\n\n${userContent}`;
}

const result = await callGemini(keys, systemPrompt, userContent);

// Save raw Gemini output directly — NO post-processing
await ctx.runMutation(api.mutations.updateChunk, {
  chunkId: existing._id,
  translatedText: result.text,  // Raw AI output, no QA, no post-processing
  status: "done",
  model: result.model,
  usage: result.usage,
});
```
**Key traits:** Sends text to Gemini with system prompt. Saves raw output. No Bible pass. No placeholder restoration. No cultural post-processing. No QA checks. No translation memory. The 23-phase instruction is in the SYSTEM PROMPT only — it's up to the AI to follow it, with zero code-level verification.

### Gap:
1. **No Bible pass (P1)** — Glossary terms are NOT locked with placeholders before the AI sees them. The AI is instructed to use the glossary via the system prompt, but there's no code-level enforcement. If the AI ignores the glossary, there's no fallback.
2. **No post-processing** — Cultural filters, dragon telepathy formatting (`*thoughts*` → `「」`/`【】`), and RTL markers (`\u200F`) are not applied. The AI is expected to handle these via the system prompt.
3. **No QA checks** — 16 code-level validations (P1-P2, P8-P10, P16-P17, P19, P21-P23) that were running in `qa.ts` are completely gone. The QA badge shows "0/3 pass" or similar because no QA is run.
4. **No translation memory (P21)** — Terminology decisions are not locked. Each chunk independently decides how to translate terms, leading to inconsistency within a language across chunks.
5. **Sliding window context is minimal** — Only the last 2 sentences of the previous chunk are passed. The old system had full context of locked terms and translation memory.
6. **The system prompt does all the work** — If the AI follows the 23 phases perfectly, this works. But there's no verification that it actually did.

### Severity: Critical
### Fix:
- Re-implement the Bible pass in `translateQueue.ts` (import `applyBiblePass` from engine.ts and apply it before sending to Gemini, restore placeholders after)
- Re-implement post-processing: cultural filters, dragon telepathy, RTL marker
- Add QA checks after translation (import `runQA` from qa.ts)
- Add translation memory: save locked terms after each chunk, pass them to the next chunk's context

---

## Area 6: Import/Export Progress

### Old Code (Client-Side) — `src/lib/translator/storage.ts:340-420`
```typescript
export async function exportAllProgress(): Promise<ExportedProgress> {
  const project = await dbGet<ProjectData>(STORE_PROJECT, PROJECT_KEY);
  const translations = await getAllTranslations();
  let terminology = /* get from STORE_MEMORY */;
  
  // Convert binary PDFs to Base64 for JSON serialization
  if (project.pdfBytes) {
    project.pdfBase64 = arrayBufferToBase64(project.pdfBytes);
  }
  
  return { _exportedAt, _version: 2, project, translations, terminology };
}

export async function importAllProgress(data: ExportedProgress): Promise<void> {
  if (data.project) await dbPut(STORE_PROJECT, PROJECT_KEY, proj);
  if (data.translations) {
    for (const [langCode, langData] of Object.entries(data.translations)) {
      await dbPut(STORE_TRANSLATIONS, langCode, langData);
    }
  }
  if (data.terminology) {
    for (const entry of data.terminology) {
      await dbPut(STORE_MEMORY, `${entry.langCode}::${entry.source}`, entry);
    }
  }
}
```
**Key traits:** Full export of project + all translations + terminology to JSON. Import restores everything. Used for cross-device sync and backup.

### New Code (Server-Side)
**No export/import implementation exists.** The `exportAllProgress` and `importAllProgress` functions are never called from `Translator.tsx` (confirmed by grep: zero matches). The feature is completely removed.

### Gap:
- No way to export project data, translations, or terminology
- No way to import a previously exported `.onyx-progress.json` file
- Cross-device sync is impossible
- No backup mechanism if the Convex database is corrupted or reset
- The old `storage.ts` file still exists with these functions, but they're dead code

### Severity: High
### Fix:
- Create `convex/exportData.ts` action that queries all project data, translations, chunks, and builds a JSON export
- Create `convex/importData.ts` action that accepts a JSON payload and creates project/translation/chunk records
- Add Export/Import buttons to the UI

---

## Dead Code Found

| File | What to remove/repurpose |
|------|-------------------------|
| `src/lib/translator/engine.ts` | Entire file is dead code. The queue (`translateQueue.ts`) has its own `callGemini` + `buildSystemPrompt` and never calls engine.ts. However, `applyBiblePass`, `restorePlaceholders`, `runQA`, `saveTerminologyBatch`, `applyCulturalFilters`, `formatDragonTelepathy` should be REUSED in the queue. |
| `src/lib/translator/storage.ts` | IndexedDB functions are dead for main flow. `exportAllProgress`/`importAllProgress` need Convex equivalents. `chunkPageTexts` is dead (queue uses own `chunkText`). |
| `src/lib/translator/pdfGenerator.ts` | Browser-side PDF generation is dead (server does it). |
| `src/lib/translator/vlyTranslate.ts` | Gutted stub — can be deleted. |
| `src/lib/vly-integrations.ts` | Gutted stub — can be deleted. |
| `convex/translate.ts` | Standalone translate action — dead (queue uses its own `callGemini`). |
| `convex/health.ts` | VLY key probe is obsolete. `probeGeminiKeys` still useful but may be dead code. |

---

## Edge Cases That Could Fail

| Scenario | Current Behavior | Expected | Fix |
|----------|-----------------|----------|-----|
| Browser closes mid-chunk | Scheduler finishes current chunk, chain breaks. Pipeline stalls. | Auto-resume from next incomplete chunk | Add pipeline watchdog |
| Two tabs open simultaneously | Each creates independent projects via sessionId | ✅ Works correctly | None needed |
| Upload new PDF while translating | Old project continues in background; new project created | ⚠️ Both run simultaneously, potentially exhausting Gemini keys | Add "stop previous" on new upload |
| Gemini all keys rate-limited (429) | Chunk fails, falls to next key, then throws "All keys exhausted" | Retry after cooldown, or queue for later | Add retry queue with exponential backoff |
| PDF with 0 extractable text | Empty fullText → 0 chunks → translation never starts | Show clear error | Add validation before starting |
| Pasted text that is 1-2 words | 1 chunk with 1-2 words → works but wasteful | ✅ Works | None needed |
| generatePdf fails for one language | Error thrown, chain breaks. Next language never starts | Should skip failed language and continue | Wrap in try/catch, chain to next language |
| User cancels mid-translation | Project status set to "cancelled", in-progress chunk may complete | ⚠️ Chunk completes but next chunk check sees "cancelled" and stops. Works. | None needed (C2 fix already in place) |
| Large PDF (500+ pages) | parsePdf.ts yields every 20 pages; translateQueue re-chunks fullText | Works but base64 upload may exceed Convex limits for very large PDFs | Add size validation |

---

## Summary Table

| Area | Status | Severity | Fix Effort |
|------|--------|----------|------------|
| Chunking | ⚠️ Different algorithm, mid-sentence splits possible | Critical | 2 hours |
| Progress Saving | ✅ Works (per-chunk mutations), but no QA storage | High | 1 hour |
| Resume/Recovery | ⚠️ No auto-resume, pipeline breaks on browser close | Critical | 3 hours |
| PDF Page Data | ❌ pageData stored but never used for overlay | Critical | 4 hours |
| Translation Pipeline | ❌ No Bible pass, no post-processing, no QA, no TM | Critical | 4 hours |
| Import/Export | ❌ Feature completely removed | High | 3 hours |

---

## Recommended Fix Order

1. **First fix: Translation Pipeline (Area 5)** — Highest impact. Re-implement Bible pass, post-processing, QA, and translation memory in `translateQueue.ts`. This makes translations actually高质量.

2. **Second fix: Text Chunking (Area 1)** — Prevent mid-sentence splits and fix the double-chunking bug. This is a prerequisite for correct PDF overlay.

3. **Third fix: PDF Overlay (Area 4)** — Use `pageData` coordinates to place text correctly. Depends on correct chunking (fix #2) for chunk→page mapping.

4. **Fourth fix: Resume/Recovery (Area 3)** — Add pipeline watchdog and auto-resume. Critical for the "close browser and come back" UX.

5. **Fifth fix: Import/Export (Area 6)** — Restore cross-device sync capability.

6. **Sixth fix: Progress Saving QA storage (Area 2)** — Add QA report persistence. Lower priority since QA itself needs to be re-implemented first (fix #1).
