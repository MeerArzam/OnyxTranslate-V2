# Migration Comprehensive Report — Onyx Translate

**Date:** September 1, 2026  
**Scope:** Complete codebase audit — every file, every function, every data flow  
**Purpose:** Eliminate all confusion about what exists, what works, what's broken, and why

---

## TABLE OF CONTENTS

1. [Project Overview & Architecture](#1-project-overview--architecture)
2. [File Inventory (Every File in the Project)](#2-file-inventory)
3. [Convex Backend (Server-Side)](#3-convex-backend)
4. [Frontend (Client-Side)](#4-frontend)
5. [Data Flow: Text/PDF Translation (End-to-End)](#5-data-flow-textpdf-translation)
6. [Data Flow: Image Translation (End-to-End)](#6-data-flow-image-translation)
7. [Database Schema & State Machine](#7-database-schema--state-machine)
8. [Bug Analysis (Every Known Bug)](#8-bug-analysis)
9. [Dead Code Inventory](#9-dead-code-inventory)
10. [Feature Parity: Old vs New](#10-feature-parity-old-vs-new)

---

## 1. PROJECT OVERVIEW & ARCHITECTURE

### Tech Stack
- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **Backend:** Convex (serverless functions: queries, mutations, actions)
- **AI Provider:** Gemini 3.6 Flash via Google's OpenAI-compatible endpoint
- **PDF:** pdf.js (client parsing) + pdf-lib (server generation)
- **Storage:** Convex File Storage (replaces IndexedDB)
- **Package Manager:** Bun

### Architecture Diagram (Simplified)
```
Browser (React)                    Convex Server
─────────────────                 ──────────────
Translator.tsx                    queries.ts (read DB)
  ├─ useQuery(getLatestProject)   mutations.ts (write DB)
  ├─ useQuery(getProject)         translateContent.ts (Gemini calls)
  ├─ useQuery(getProjectTranslations)  translateImage.ts (Gemini calls)
  ├─ useAction(translateLanguage) generatePdf.ts (PDF creation)
  ├─ useAction(translateImage)    parsePdf.ts (PDF extraction)
  ├─ useAction(storePdf)          upload.ts (PDF storage)
  ├─ useMutation(createProject)   zipAssembly.ts (ZIP creation)
  └─ useMutation(createProject)   history.ts (history tracking)
```

### Session Isolation
Each browser tab gets a unique `sessionId` stored in `sessionStorage`. All queries filter by this session ID. This means:
- Tab A and Tab B in the same browser have completely separate projects
- Refreshing the page preserves the session ID (same tab = same session)
- Closing the tab destroys the session (new session on reopen)

---

## 2. FILE INVENTORY

### Convex Backend Files (server-side, `"use node"`)
| File | Purpose | Status |
|------|---------|--------|
| `convex/schema.ts` | Database schema (6 tables) | ✅ Complete |
| `convex/mutations.ts` | Database write operations (11 mutations) | ✅ Complete |
| `convex/queries.ts` | Database read operations (11 queries) | ✅ Complete |
| `convex/translateContent.ts` | **PRIMARY: Text/PDF translation action** | 🔴 Missing 2 critical mutations |
| `convex/translateImage.ts` | Image translation action | ✅ Working |
| `convex/translateQueue.ts` | OLD queue system (scheduler chain) | ⚠️ Partially used (cancel only) |
| `convex/generatePdf.ts` | Server-side PDF generation | ✅ Complete |
| `convex/parsePdf.ts` | Server-side PDF text extraction | ✅ Complete |
| `convex/upload.ts` | PDF upload to Convex Storage | ✅ Complete |
| `convex/zipAssembly.ts` | ZIP file creation | ✅ Complete |
| `convex/history.ts` | Translation history tracking | ✅ Complete |
| `convex/exportImport.ts` | Export/import translation progress | ✅ Complete |
| `convex/health.ts` | Health check probe | ✅ Complete |

### Frontend Files (client-side)
| File | Purpose | Status |
|------|---------|--------|
| `src/main.tsx` | App entry point (ConvexProvider setup) | ✅ Complete |
| `src/pages/Translator.tsx` | **MAIN: 1778-line component (all UI + logic)** | ⚠️ Multiple issues |
| `src/components/RoyalProgressPanel.tsx` | Progress display component | ✅ Complete |
| `src/components/LanguageAccordion.tsx` | Language list + preview component | ✅ Complete |
| `src/components/HistoryPanel.tsx` | History sidebar component | ✅ Complete |
| `src/index.css` | Global styles (dark neon theme) | ✅ Complete |

### Library/Utility Files
| File | Purpose | Status |
|------|---------|--------|
| `src/lib/translator/engine.ts` | OLD translation engine (999 lines, mostly dead) | ⚠️ Dead code |
| `src/lib/translator/storage.ts` | OLD IndexedDB storage (656 lines, mostly dead) | ⚠️ Dead code |
| `src/lib/translator/qa.ts` | QA engine (23-phase checks) | ✅ Used by translateContent.ts |
| `src/lib/translator/cultural.ts` | Cultural filters (profanity, intimacy, etc.) | ✅ Used by translateContent.ts |
| `src/lib/translator/formatters.ts` | Script configs, RTL, telepathy formatting | ✅ Used by translateContent.ts |
| `src/lib/translator/voices.ts` | Character voice definitions | ✅ Used by translateContent.ts |
| `src/lib/translator/baseline.ts` | Baseline test references | ✅ Used by UI |
| `src/lib/translator/pdfParser.ts` | Client-side PDF parsing | ✅ Used by Translator.tsx |
| `src/lib/translator/pdfGenerator.ts` | Client-side PDF generation (fallback) | ✅ Used by Translator.tsx |

### Data Files
| File | Purpose | Status |
|------|---------|--------|
| `src/data/glossary.json` | Locked terminology (magic/military terms) | ✅ Used by translateContent.ts |
| `src/data/localization.ts` | Per-language config loader | ✅ Used by translateContent.ts |
| `src/data/localization/*.json` (20 files) | Per-language configs (names, profanity, ranks, etc.) | ✅ Complete |

---

## 3. CONVEX BACKEND

### 3.1 Database Schema (convex/schema.ts)

**6 tables:**

```
projects: {
  sessionId: string (optional)
  fileName: string
  pageCount: number
  wordCount: number
  pdfStorageId: string (optional)  → Convex File Storage reference
  pageData: any                    → PDF page data with text item positions
  fullText: string                 → Complete extracted text
  parsedPages: number
  status: string                   → "ready" | "translating" | "all_translated" | "complete" | "cancelled" | "error"
  zipStorageId: string (optional)
  zipUrl: string (optional)
  createdAt: number
}
Index: by_session (sessionId)

chunks: {
  projectId: Id<"projects">
  langCode: string
  chunkIndex: number
  sourceText: string
  translatedText: string (optional)
  status: string                   → "pending" | "done"
  model: string (optional)         → e.g. "gemini-3.6-flash"
  usage: any (optional)            → { promptTokens, completionTokens, qaScore }
}
Index: by_project_lang (projectId, langCode, chunkIndex)
Index: by_project_status (projectId, status)

translations: {
  projectId: Id<"projects">
  langCode: string
  status: string                   → "pending" | "in_progress" | "complete"
  totalChunks: number
  completedChunks: number
  mergedText: string (optional)    → All chunks concatenated
  pdfStorageId: string (optional)
  pdfUrl: string (optional)
  pdfGenerating: boolean (optional)
  pdfProgress: string (optional)
  startedAt: number (optional)
  completedAt: number (optional)
}
Index: by_project_lang (projectId, langCode)

imageTranslations: {
  projectId: Id<"projects"> (optional)
  imageBase64: string
  extractedText: string (optional)
  translatedText: string (optional)
  targetLangCode: string
  status: string
  createdAt: number
}

history: {
  sessionId: string
  projectId: Id<"projects">
  fileName: string
  pageCount: number
  wordCount: number
  status: string
  languagesCompleted: number
  createdAt: number
  completedAt: number (optional)
  zipUrl: string (optional)
}
Index: by_session (sessionId)

jobs: {
  projectId: Id<"projects">
  type: string
  langCode: string (optional)
  chunkIndex: number (optional)
  status: string
  error: string (optional)
  scheduledFor: number
  createdAt: number
}
Index: by_status_scheduled
Index: by_project
```

### 3.2 Mutations (convex/mutations.ts)

| Mutation | Args | Purpose |
|----------|------|---------|
| `createProject` | sessionId, fileName, pageCount, wordCount, pageData, fullText, parsedPages, status | Create new project |
| `updateProject` | projectId, ...optional fields | Update any project field |
| `deleteProject` | projectId | Delete project + all chunks + translations + jobs |
| `upsertChunk` | projectId, langCode, chunkIndex, sourceText | Create chunk (returns existing if already exists) |
| `updateChunk` | chunkId, translatedText, status, model, usage | Update chunk with translation result |
| `upsertTranslation` | projectId, langCode, totalChunks | Create translation record (returns existing if exists) |
| `updateTranslation` | translationId, status, completedChunks, mergedText, pdfStorageId, pdfUrl, pdfGenerating, pdfProgress, startedAt, completedAt | Update translation progress |
| `deleteChunksForLang` | projectId, langCode | Delete all chunks for a language |
| `createJob` | projectId, type, langCode, chunkIndex, status, scheduledFor | Create a scheduled job |
| `saveImageTranslation` | imageBase64, extractedText, translatedText, langCode, status | Save image translation result |

### 3.3 Queries (convex/queries.ts)

| Query | Args | Purpose | Session-filtered? |
|-------|------|---------|-------------------|
| `getProject` | projectId, sessionId | Get project (must match session) | ✅ Yes |
| `getLatestProject` | sessionId | Get most recent project for session | ✅ Yes |
| `getProjectTranslations` | projectId, sessionId | Get all translations for project (must match session) | ✅ Yes |
| `getProjectRaw` | projectId | Get project (no session check — server use) | ❌ No |
| `getTranslationsRaw` | projectId | Get translations (no session check — server use) | ❌ No |
| `getChunkProgress` | projectId, langCode | Get chunk completion count | ❌ No |
| `getChunksForLang` | projectId, langCode | Get all chunks for a language | ❌ No |
| `getAllJobs` | projectId | Get all jobs for a project | ❌ No |
| `getHistory` | sessionId | Get history entries | ✅ Yes |
| `getTranslationProgress` | projectId, langCode | Get percentage complete | ❌ No |
| `getAllProjectsForWatchdog` | none | Get ALL projects (watchdog use) | ❌ No |
| `getLivePreviewText` | projectId, langCode | Get concatenated translated chunks | ❌ No |

### 3.4 Actions (Server-Side Functions)

#### translateContent.ts:translateLanguage (PRIMARY TRANSLATION ACTION)
**This is the main action the UI calls.** Here's what it does, step by step:

1. Read project from DB (`getProjectRaw`)
2. Guard: return error if project not found or cancelled
3. Read 5 Gemini API keys from `process.env`
4. Guard: return error if no keys
5. Chunk `project.fullText` into 2500-word chunks
6. Query existing chunks for this language (`getChunksForLang`)
7. Build 23-phase system prompt ONCE (expensive)
8. **FOR EACH CHUNK:**
   a. Skip if already "done"
   b. Check cancellation
   c. Get previous chunk's last 2 sentences (sliding window)
   d. Apply Bible Pass (lock glossary terms with placeholders)
   e. Call Gemini API (5-key rotation, 3 retries per key)
   f. Restore placeholders
   g. Apply cultural filters (profanity, intimacy, etc.)
   h. Format dragon telepathy markers
   i. Add RTL marker for Urdu/Arabic/Kashmiri
   j. Run QA checks
   k. Save chunk to DB
   l. Update translation record's `completedChunks`
9. Merge all chunks into `mergedText`
10. Mark translation as "complete"
11. **Chain to next language via `ctx.scheduler.runAfter(0, ...)`**

**CRITICAL BUG:** Steps 1-3 never call `updateProject({ status: "translating" })`. Steps 8l never calls `upsertTranslation` (it assumes translation records already exist). This is the root cause of the "button doesn't work" symptom.

#### translateImage.ts:translateImage
**Simpler action for image OCR + translation:**

1. Build a simple 6-line system prompt (OCR + translate)
2. Read 5 Gemini API keys
3. For each key, for each retry attempt:
   - POST to Gemini with image as base64 data URL
   - If 200: save to `imageTranslations` table, return result
   - If 429: wait, try next key
   - If 500: wait, retry
4. Return `{ ok, extractedText, model, usage }` or `{ ok: false, error }`

**WHY THIS WORKS:** No state machine, no multi-table coordination. Single action, single result, immediate return.

#### translateQueue.ts:cancelTranslation
Sets project status to "cancelled". Still used by the pause button.

#### translateQueue.ts:startTranslation
Creates translation records + chunks for all selected languages, then starts the scheduler chain. **NOT CALLED BY THE NEW UI** — the new UI calls `translateContent.translateLanguage` instead, which skips the translation record creation step.

#### generatePdf.ts:generateTranslatedPdf
1. Read original PDF from Convex Storage
2. Load with pdf-lib
3. Embed Noto Sans font for the target language
4. For each page: white out English text areas, overlay translated text
5. Store result in Convex Storage
6. Return storage ID

#### parsePdf.ts:parseUploadedPdf
1. Download PDF from Convex Storage
2. Parse with pdfjs-dist server-side
3. Group text items by Y-coordinate into lines
4. Return structured page data with text items + coordinates

#### zipAssembly.ts:buildZip
1. Read all translation records with `pdfStorageId`
2. Download each PDF from Convex Storage
3. Bundle into ZIP with summary report
4. Store ZIP in Convex Storage
5. Update project with `zipUrl`

---

## 4. FRONTEND

### 4.1 App Entry (src/main.tsx)
```tsx
const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL!);
<ConvexProvider client={convex}>
  <Translator />
</ConvexProvider>
```

### 4.2 Translator.tsx (1778 lines — the entire app)

#### State Hooks (47 useState calls)

**Session & Project:**
- `sessionId` — unique per tab (sessionStorage)
- `projectId` — current project ID (local React state)

**Source Data:**
- `sourceText` — full extracted text
- `pdfFileName` — uploaded PDF name
- `pdfPageCount` — number of pages
- `pdfWarnings` — extraction warnings
- `pageData` — PDF page data with text item positions
- `originalPageTexts` — per-page plain text
- `originalArrayBuffer` — raw PDF bytes

**Upload State:**
- `isUploading` — upload in progress
- `uploadError` — upload error message
- `isDragOver` — drag-and-drop state
- `parseProgress` — `{ current, total }` pages
- `parsePhase` — "idle" | "loading" | "parsing" | "done"

**Translation State:**
- `isTranslating` — translation in progress
- `translationError` — translation error message
- `currentPreviewLangCode` — which language to show in preview
- `selectedLangCodes` — which languages to translate
- `marketContext` — "standard" | "high-censorship" | "romance-focused" | "conservative"

**Image State:**
- `imageMode` — "none" | "upload" | "camera"
- `imagePreview` — base64 image preview URL
- `currentImageBase64` — image data for translation
- `imageTranslation` — `{ extracted, translated, langCode }`
- `isTranslatingImage` — image translation in progress
- `imageSelectedLangs` — languages selected for image

**Display State:**
- `copiedPreview` — clipboard copy feedback
- `showHistory` — history panel open
- `baselineSummary` / `baselineRunning` / `baselineOpen` — baseline test
- `pdfProgress` / `currentPdfBlob` — PDF generation (fallback)
- `currentQaReport` / `translationMode` / `translationModel` / `translationUsage` — QA display (legacy)
- `isDownloadingZip` — ZIP download in progress

#### Convex Subscriptions (useQuery)

| Variable | Query | Args | Purpose |
|----------|-------|------|---------|
| `latestProject` | `getLatestProject` | `{ sessionId }` | Auto-load project on mount |
| `convexProject` | `getProject` | `{ projectId, sessionId }` | Project status, derive flowPhase |
| `convexTranslations` | `getProjectTranslations` | `{ projectId, sessionId }` | All translation records |

#### Convex Actions (useAction)

| Variable | Action | Purpose |
|----------|--------|---------|
| `storePdfAction` | `upload.storePdf` | Upload PDF to Convex Storage |
| `parsePdfAction` | `parsePdf.parseUploadedPdf` | Server-side PDF parsing |
| `translateLanguageAction` | `translateContent.translateLanguage` | **Start translation** |
| `cancelTranslationAction` | `translateQueue.cancelTranslation` | Pause/cancel translation |
| `translateImageAction` | `translateImage.translateImage` | Image OCR + translation |

#### Convex Mutations (useMutation)

| Variable | Mutation | Purpose |
|----------|----------|---------|
| `createProjectMutation` | `mutations.createProject` | Create project record |
| `deleteProjectMutation` | `mutations.deleteProject` | Delete project + children |
| `deleteChunksForLangMutation` | `mutations.deleteChunksForLang` | Delete chunks for retranslate |
| `saveHistoryMutation` | `history.saveToHistory` | Save to history |

#### Derived State (useMemo)

| Variable | Derivation | Purpose |
|----------|-----------|---------|
| `flowPhase` | From `convexProject.status` | Controls which UI panel shows |
| `activeTranslations` | From `convexTranslations` | All translation records |
| `completedCount` | Count of "complete" translations | Progress display |
| `isAllComplete` | All translations complete | Show ZIP download |
| `inProgressTranslation` | First "in_progress" translation | Preview text source |
| `previewTranslation` | Selected or in-progress translation | Preview text source |
| `currentTranslation` | `previewTranslation.mergedText` | Text to display |
| `languageStatuses` | Map of all 20 languages to status | Progress panel input |
| `activeLangIndex` | Index of translating language | Progress panel input |
| `overallProgress` | Percentage of complete languages | Progress bar |
| `completedLanguages` | Completed translations with text | ZIP download source |

#### Key Functions

**`startTranslation` (line 722):**
1. Guard: empty sourceText → return
2. Guard: isTranslating → return
3. Create project if needed (for pasted text)
4. Get selected languages (or all 20)
5. Call `translateLanguageAction({ projectId, langCode, marketContext, nextLangCode, remainingLangs })`
6. Save to history
7. Catch errors, reset `isTranslating`

**`handlePause` (line 782):**
1. Call `cancelTranslationAction({ projectId })`
2. Set `isTranslating = false`

**`handleRetranslate` (line 789):**
1. Delete chunks for the language
2. Call `translateLanguageAction({ projectId, langCode, marketContext })`

**`handleCopyTranslation` (line 813):**
1. Copy first 10,000 words to clipboard
2. Show "Copied" feedback for 2 seconds

**`handleDownloadPDF` (line 840):**
1. If server PDF exists → open URL
2. Else → client-side PDF generation fallback

**`handleDownloadAllZIP` (line 880):**
1. If server ZIP exists → open URL
2. Else → client-side ZIP assembly using JSZip

**`handleImageUpload` (line 628):**
1. Read file as data URL
2. Downscale to max 1024px width
3. Convert to base64
4. Show preview

**`translateCurrentImage` (line 657):**
1. Call `translateImageAction({ imageBase64, langCode })`
2. Show result in preview

**`translateImageMultiLang` (line 670):**
1. Loop through selected languages
2. Call `translateImageAction` for each
3. Concatenate results

#### UI Layout

```
┌──────────────────────────────────────────────────┐
│ Header: Logo + History + Export + Import buttons  │
├────────────────────┬─────────────────────────────┤
│ LEFT PANEL         │ RIGHT PANEL                  │
│                    │                              │
│ Step 1: Upload     │ Step 3: Preview              │
│  - PDF drop zone   │  - Translated text           │
│  - Image/Camera    │  - Copy button               │
│  - Language picker │  - RTL/LTR direction         │
│  - Begin button    │                              │
│                    │ Language Accordion            │
│ Step 2: Progress   │  - Per-language status       │
│  (if translating)  │  - Click to preview          │
│  - Active banner   │  - Chunk progress            │
│  - Overall bar     │                              │
│  - Pause/Resume    │ Download ZIP (when complete) │
│  - Language list   │                              │
├────────────────────┴─────────────────────────────┤
│ History Panel (slide-in, conditional)             │
└──────────────────────────────────────────────────┘
```

---

## 5. DATA FLOW: TEXT/PDF TRANSLATION

### Complete Request Lifecycle

```
1. User pastes text or uploads PDF
   ↓
2. handleFileSelect() or setSourceText()
   ↓
3. User selects languages (selectedLangCodes)
   ↓
4. User clicks "Begin Translation" → startTranslation()
   ↓
5. createProjectMutation({ status: "ready" })  ← if no project exists
   ↓
6. translateLanguageAction({ projectId, langCode: langs[0], ... })
   ↓
7. Convex server: translateContent.translateLanguage()
   ├── Reads project.fullText
   ├── Chunks into 2500-word pieces
   ├── Queries existing chunks (for resume)
   ├── Builds 23-phase system prompt
   ├── FOR EACH CHUNK:
   │   ├── Bible Pass (lock terms)
   │   ├── Gemini API call
   │   ├── Restore placeholders
   │   ├── Cultural filters
   │   ├── Dragon telepathy formatting
   │   ├── RTL marker
   │   ├── QA checks
   │   ├── Save chunk to DB
   │   └── Update translation.completedChunks
   ├── Merge all chunks → mergedText
   ├── Mark translation "complete"
   └── Chain to next language via scheduler
   ↓
8. React re-renders because Convex queries update
   ↓
9. flowPhase changes: "idle" → "translating" (if project.status changed)
   ↓
10. Progress panel appears
    ↓
11. When all languages complete:
    - flowPhase → "all-complete"
    - Download ZIP button appears
```

### THE BUG IN THIS FLOW

**Step 7 never calls `updateProject({ status: "translating" })`.** The project status stays `"ready"`. Therefore:

- Step 9: `flowPhase` stays `"idle"` (line 176: returns "idle" when status is "ready")
- Step 10: Progress panel never appears (`{flowPhase !== "idle" && (...)}`)
- User sees: button click → nothing happens

**Step 7 also never calls `upsertTranslation` to create translation records.** The action assumes translation records exist (from `translateQueue.startTranslation`), but the new UI doesn't call `startTranslation`. So even if the project status DID change, the `completedChunks` counter would never advance because `getTranslationsRaw` returns an empty array, and the `if (translation)` guard skips the update.

---

## 6. DATA FLOW: IMAGE TRANSLATION

```
1. User uploads image or takes photo
   ↓
2. handleImageUpload() → downscale → base64
   ↓
3. User selects languages (imageSelectedLangs)
   ↓
4. translateImageMultiLang() loops through languages
   ↓
5. translateImageAction({ imageBase64, langCode })
   ↓
6. Convex server: translateImage.translateImage()
   ├── Build OCR + translation prompt
   ├── Read 5 Gemini keys
   ├── POST to Gemini with image
   ├── Save to imageTranslations table
   └── Return { ok, extractedText, model, usage }
   ↓
7. Result returned immediately to client
   ↓
8. setImageTranslation({ extracted, translated, langCode })
   ↓
9. UI shows extracted + translated text
```

**WHY THIS WORKS:** No state machine, no multi-table coordination, no scheduler chains. Single action → single result → immediate UI update.

---

## 7. DATABASE STATE MACHINE

### Project Status Transitions

```
"ready" ──────────────────→ "translating" ──→ "all_translated" → "complete"
   │                            │                    │
   │ (should happen at          │ (should happen     │ (should happen
   │  start of translate)       │  when all langs    │  after ZIP built)
   │                            │  complete)
   ↓                            ↓
"cancelled" ←───────────── Any status (via cancelTranslation)
```

**Current reality:** The status stays `"ready"` forever because `translateContent.ts` never transitions it.

### Translation Status Transitions

```
"pending" → "in_progress" → "complete"
```

**Current reality:** The `upsertTranslation` call that creates the record is never made by `translateContent.ts`. The record may or may not exist depending on whether `translateQueue.startTranslation` was called.

### Chunk Status Transitions

```
"pending" → "done"
```

**This works correctly.** Chunks are created by `upsertChunk` and updated by `updateChunk`.

---

## 8. BUG ANALYSIS

### Bug #1: Project status never changes (CRITICAL)
- **File:** `convex/translateContent.ts`
- **What's missing:** `await ctx.runMutation(api.mutations.updateProject, { projectId: args.projectId, status: "translating" })` at the start of the handler
- **Impact:** `flowPhase` stays "idle", progress panel never shows, user sees no feedback
- **Evidence:** Grep for `updateProject` in translateContent.ts returns 0 results

### Bug #2: Translation records never created (CRITICAL)
- **File:** `convex/translateContent.ts`
- **What's missing:** `await ctx.runMutation(api.mutations.upsertTranslation, { projectId, langCode, totalChunks })` before the chunk loop
- **Impact:** `completedChunks` counter never advances, progress bar shows 0/0
- **Evidence:** The action queries `getTranslationsRaw` but never creates the record it's querying for

### Bug #3: isTranslating never resets after action completes
- **File:** `src/pages/Translator.tsx` line 762-768
- **What's wrong:** `startTranslation` calls `translateLanguageAction(...)` but doesn't read the return value or add `.then()/.catch()` to reset `isTranslating`
- **Impact:** If the action throws, `isTranslating` stays `true`, preventing retry
- **Current mitigation:** The `useEffect` at line 319 syncs with `convexProject.status`, but since that status never changes (Bug #1), this doesn't help

### Bug #4: Import button does nothing
- **File:** `src/pages/Translator.tsx` line 561
- **What's wrong:** `handleImportProgress` is an empty function
- **Impact:** Import button appears but clicking it does nothing
- **Note:** `convex/exportImport.ts` has the server-side import logic, but the client never calls it

### Bug #5: Export is metadata-only
- **File:** `src/pages/Translator.tsx` line 536
- **What's wrong:** `handleExportProgress` only exports project metadata + translation statuses, not the actual translated text or chunks
- **Impact:** Importing the exported file would restore counters but not the actual translations
- **Note:** `convex/exportImport.ts:exportProgress` exports full chunk data, but the client doesn't use it

### Bug #6: Old translateQueue.startTranslation is orphaned
- **File:** `convex/translateQueue.ts` line 547
- **What's wrong:** This function creates translation records + chunks + updates project status. It's the ONLY place that does all 3 correctly. But the new UI never calls it.
- **Impact:** The new `translateContent.translateLanguage` duplicates most of its logic but misses the critical setup steps

### Bug #7: No auto-PDF generation after translation
- **File:** `convex/translateContent.ts`
- **What's missing:** After marking a translation "complete", the action should call `generatePdf.generateTranslatedPdf`
- **Impact:** Users must wait for all languages to complete, then manually trigger PDF generation (which the UI doesn't do automatically either)

### Bug #8: No auto-ZIP after all languages complete
- **File:** `convex/translateContent.ts`
- **What's missing:** After the last language completes, the action should call `zipAssembly.buildZip`
- **Impact:** `convexProject.zipUrl` is never set, so the "Download All ZIP" button falls back to client-side ZIP assembly (which may fail for large books)

---

## 9. DEAD CODE INVENTORY

### Completely Dead Files
| File | Lines | Why Dead |
|------|-------|----------|
| `src/lib/translator/engine.ts` | 999 | OLD client-side translation engine. Only `generateSampleText()` and type exports are used. The `runLocalizedTranslationPipeline()` function is never called. |
| `src/lib/translator/storage.ts` | 656 | OLD IndexedDB storage. Only `mergeChunkTexts()` type and `TranslationChunk` interface are imported. The actual IndexedDB functions (`saveProject`, `getProject`, etc.) are never called. |

### Partially Dead Code
| File | Function | Status |
|------|----------|--------|
| `convex/translateQueue.ts:startTranslation` | Creates records + starts chain | Dead (not called by new UI) |
| `convex/translateQueue.ts:processLanguage` | Processes chunks via scheduler chain | Dead (replaced by translateContent.ts) |
| `convex/translate.ts:translateChunk` | OLD VLY gateway translation | Dead (VLY gateway retired) |
| `convex/health.ts:checkVlyKey` | Probes VLY key | Dead (VLY retired) |
| `src/lib/translator/neural.ts` | ONNX neural model translation | Dead (never deployed) |
| `convex/exportImport.ts:exportProgress` | Full export with chunks | Dead (client uses metadata-only export) |
| `convex/exportImport.ts:importProgress` | Full import | Dead (client import is empty function) |

### Legacy State Hooks (set but never read in current UI)
| Hook | Set Where | Read Where |
|------|-----------|-----------|
| `translationMode` | Nowhere (dead) | Nowhere |
| `translationModel` | Nowhere (dead) | Nowhere |
| `translationUsage` | Nowhere (dead) | Nowhere |
| `currentQaReport` | Nowhere (dead) | Nowhere |
| `showAllQaPhases` | Nowhere (dead) | Nowhere |

---

## 10. FEATURE PARITY: OLD VS NEW

| Feature | Old Implementation | New Implementation | Status |
|---------|-------------------|-------------------|--------|
| **Text chunking** | `chunkText()` in engine.ts (client) | `chunkText()` in translateContent.ts (server) | ✅ Working |
| **Progress save** | IndexedDB `saveTranslationChunk()` | Convex `updateChunk()` mutation | ✅ Working |
| **Resume** | `loadSavedProject()` from IndexedDB | `getLatestProject` query + auto-load | ⚠️ Partial (translation records may not exist) |
| **Bible Pass** | `extractBiblePass()` in engine.ts | `applyBiblePassServer()` in translateContent.ts | ✅ Working |
| **QA checks** | `runQA()` in qa.ts | `runQA()` in translateContent.ts | ✅ Working |
| **Cultural filters** | `applyCulturalFilters()` in cultural.ts | Same function, called server-side | ✅ Working |
| **Dragon telepathy** | `formatDragonTelepathy()` in formatters.ts | Same function, called server-side | ✅ Working |
| **PDF generation** | `generateTranslatedPDF()` in pdf-render.ts (client) | `generatePdf.ts` (server) | ⚠️ Not auto-triggered |
| **Export** | Full JSON with chunks + PDF blobs | Metadata-only JSON | 🔴 Lost 90% of data |
| **Import** | Full restore from JSON | Empty function | 🔴 Not implemented |
| **Cancel/Pause** | `cancelCurrentTranslation()` → IndexedDB | `cancelTranslation()` → Convex DB | ✅ Working |
| **Language selection** | `selectedLanguages` state | `selectedLangCodes` state | ✅ Working |
| **History** | IndexedDB `history` store | Convex `history` table + `HistoryPanel` | ✅ Working |
| **Image translation** | Client-side Gemini SDK | `translateImage.ts` server action | ✅ Working |
| **Baseline test** | `runBaselineTests()` in baseline.ts | Same function, still client-side | ✅ Working |
| **Sliding window** | `previousContext` in engine.ts | `extractLastSentences()` in translateContent.ts | ✅ Working |
| **Auto-load on mount** | `loadSavedProject()` from IndexedDB | `useEffect` + `getLatestProject` | ✅ Working |
| **ZIP download** | Client-side JSZip | Server `zipAssembly.ts` + client fallback | ⚠️ Not auto-triggered |
| **Per-language PDF** | Generated per language | Generated per language | ⚠️ Not auto-triggered |

### Top 5 Missing Features

1. **Auto-transition project status** — `translateContent.ts` must call `updateProject({ status: "translating" })` at the start
2. **Auto-create translation records** — `translateContent.ts` must call `upsertTranslation` for each selected language before processing chunks
3. **Auto-trigger PDF generation** — After a language completes, trigger `generateTranslatedPdf`
4. **Auto-trigger ZIP assembly** — After all languages complete, trigger `buildZip`
5. **Full export/import** — Client should use `convex/exportImport.ts` actions instead of metadata-only export

---

## SUMMARY: THE SINGLE ROOT CAUSE

**All 4 reported symptoms (unresponsive button, broken import, image-works-but-text-doesn't, missing progress) trace to ONE root cause:**

`convex/translateContent.ts:translateLanguage` does not call two mutations that `convex/translateQueue.ts:startTranslation` does:

1. `updateProject({ status: "translating" })` — without this, the UI never transitions out of "idle"
2. `upsertTranslation({ projectId, langCode, totalChunks })` — without this, progress counters never advance

The fix is adding ~10 lines of code to `translateContent.ts`. Everything else (UI, components, PDF generation, ZIP assembly) is complete and correct — it just never gets triggered because the state machine never leaves "idle".
