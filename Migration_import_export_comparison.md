# Migration Import/Export Comparison Report

## Executive Summary

The Import/Export feature migrated from a **client-side IndexedDB** system to a **server-side Convex DB** system. The old system exported the entire browser database as JSON; the new system exports Convex DB records as JSON. The old import rewrote IndexedDB directly; the new import creates records in Convex via a server action. The new system is simpler but has lost several features that existed in the old version.

---

## 1. Architecture Overview

| Aspect | OLD (Client-Side IndexedDB) | NEW (Server-Side Convex DB) |
|---|---|---|
| **Storage** | Browser IndexedDB (`onyx-translate-db`) | Convex cloud database (6 tables) |
| **Export location** | `src/lib/translator/storage.ts` → `exportAllProgress()` | `src/pages/Translator.tsx` → `handleExportProgress()` |
| **Import location** | `src/lib/translator/storage.ts` → `importAllProgress()` | `convex/importProject.ts` → `importProject()` action |
| **Data format** | `ExportedProgress` interface (v2, with `_version`, `_exportedAt`) | `{ type, version, project, translations }` |
| **PDF storage in export** | Base64-encoded raw PDF bytes (from `pdfBytes`) | **Not included** — only `fullText` is exported |
| **Terminology/Translation Memory** | Exported + imported | **Not included** |
| **QA Reports** | Exported + imported | **Not included** |
| **Session isolation** | N/A (single user per browser) | Per-tab via `sessionId` |
| **Cross-device sync** | Via JSON file transfer | Native (Convex is cloud DB) |

---

## 2. Export Flow — Side by Side

### OLD: `exportAllProgress()` (storage.ts)

```typescript
interface ExportedProgress {
  _exportedAt: string;
  _version: number;              // Always 2
  project: ProjectData | null;   // Full project including PDF bytes
  translations: Record<string, TranslationRecord>;
  terminology: TerminologyEntry[];
}

export async function exportAllProgress(): Promise<ExportedProgress> {
  // 1. Read project from IndexedDB
  const project = await dbGet<ProjectData>(STORE_PROJECT, PROJECT_KEY);
  // 2. Read all translations from IndexedDB
  const translations = await getAllTranslations();
  // 3. Read terminology from IndexedDB
  let terminology: TerminologyEntry[] = [];
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_MEMORY, "readonly");
    const store = tx.objectStore(STORE_MEMORY);
    const req = store.getAll();
    terminology = await new Promise<TerminologyEntry[]>((resolve) => {
      req.onsuccess = () => resolve(req.result as TerminologyEntry[]);
      req.onerror = () => resolve([]);
      tx.oncomplete = () => db.close();
    });
  } catch { /* Non-critical */ }

  // 4. Convert binary PDF to Base64 for JSON serialization
  if (project) {
    if (project.pdfBytes) {
      project.pdfBase64 = arrayBufferToBase64(project.pdfBytes);
      delete project.pdfBytes;
    } else if (!project.pdfBase64) {
      project.pdfBase64 = "";
    }
  }

  // 5. Strip cached PDF blobs (too large for JSON)
  const exportedTranslations: Record<string, TranslationRecord> = {};
  for (const [langCode, rec] of Object.entries(translations)) {
    exportedTranslations[langCode] = {
      progress: rec.progress,
      chunks: rec.chunks,
      qaReport: rec.qaReport,
    };
  }

  return {
    _exportedAt: new Date().toISOString(),
    _version: 2,
    project,
    translations: exportedTranslations,
    terminology,
  };
}
```

**What was included:**
- ✅ Full project metadata (fileName, pageCount, wordCount, warnings)
- ✅ Original PDF as Base64 string (reconstructed on import)
- ✅ Parsed page data (text items with X/Y positions)
- ✅ Per-page text
- ✅ Full concatenated text
- ✅ All translation chunks per language (with page ranges)
- ✅ Merged text per language
- ✅ QA reports per language
- ✅ Translation memory / terminology entries
- ✅ Version tracking (`_version: 2`)
- ✅ Timestamp (`_exportedAt`)

### NEW: `handleExportProgress()` (Translator.tsx)

```typescript
const handleExportProgress = useCallback(async () => {
  if (!convexProject) return;
  const exportData = {
    type: "onyx-translate-project" as const,
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      fileName: convexProject.fileName,
      pageCount: convexProject.pageCount,
      wordCount: convexProject.wordCount,
      fullText: convexProject.fullText,
      status: convexProject.status,
    },
    translations: activeTranslations.map((t) => ({
      langCode: t.langCode,
      totalChunks: t.totalChunks,
      completedChunks: t.completedChunks,
      mergedText: t.mergedText,
      status: t.status,
    })),
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `onyx-translate-${convexProject.fileName.replace(/\.pdf$/i, "")}-backup.json`;
  a.click();
  URL.revokeObjectURL(url);
}, [convexProject, activeTranslations]);
```

**What is included:**
- ✅ Project metadata (fileName, pageCount, wordCount, fullText, status)
- ✅ Translation records (langCode, totalChunks, completedChunks, mergedText, status)
- ✅ Timestamp (`exportedAt`)
- ✅ Version tracking (`version: 1`)

**What is missing (regressions):**
- ❌ Original PDF binary (was Base64 in old export)
- ❌ Parsed page data (text items with positions)
- ❌ Per-page text array
- ❌ Translation chunks (individual chunk texts with page ranges)
- ❌ QA reports per language
- ❌ Translation memory / terminology entries
- ❌ Project warnings array
- ❌ `pdfStorageId` (Convex storage reference to original PDF)

---

## 3. Import Flow — Side by Side

### OLD: `importAllProgress()` (storage.ts)

```typescript
export async function importAllProgress(data: ExportedProgress): Promise<void> {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid progress file format.");
  }

  // 1. Import project (restore binary PDF from exported Base64)
  if (data.project) {
    const proj = data.project;
    if (proj.pdfBase64) {
      proj.pdfBytes = base64ToArrayBuffer(proj.pdfBase64);
      delete proj.pdfBase64;
    }
    await dbPut(STORE_PROJECT, PROJECT_KEY, proj);
  }

  // 2. Import translations (cached PDF blobs regenerate on demand)
  if (data.translations) {
    for (const [langCode, langData] of Object.entries(data.translations)) {
      delete langData.pdfBlobBase64;
      delete langData.pdfBlob;
      await dbPut(STORE_TRANSLATIONS, langCode, langData);
    }
  }

  // 3. Import terminology
  if (data.terminology && Array.isArray(data.terminology)) {
    for (const entry of data.terminology) {
      await dbPut(STORE_MEMORY,
        `${entry.langCode}::${entry.source.toLowerCase()}`, entry);
    }
  }
}
```

**What the old import did:**
- ✅ Restored full project with PDF binary → IndexedDB
- ✅ Restored all translation chunks with page ranges → IndexedDB
- ✅ Restored merged text per language → IndexedDB
- ✅ Restored QA reports per language → IndexedDB
- ✅ Restored terminology/translation memory → IndexedDB
- ✅ Overwrote existing data (user confirmed before calling)
- ✅ Synchronous — single transaction, instant restore
- ✅ No network call — purely local

### NEW: `importProject()` (convex/importProject.ts)

```typescript
export const importProject = action({
  args: {
    sessionId: v.string(),
    exportJson: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    projectId: Id<"projects">;
  }> => {
    let data: {
      type: string;
      version: number;
      project: {
        fileName: string;
        pageCount: number;
        wordCount: number;
        fullText: string;
      };
      translations: Array<{
        langCode: string;
        totalChunks: number;
        completedChunks: number;
        mergedText?: string;
        status: string;
      }>;
    };

    try {
      data = JSON.parse(args.exportJson);
    } catch {
      throw new Error("Invalid JSON file");
    }

    if (data.type !== "onyx-translate-project" || data.version !== 1) {
      throw new Error("Invalid export file format");
    }

    // 1. Create project record in Convex
    const projectId = await ctx.runMutation(api.mutations.createProject, {
      sessionId: args.sessionId,
      fileName: data.project.fileName,
      pageCount: data.project.pageCount,
      wordCount: data.project.wordCount,
      pageData: [],                    // ← Always empty!
      fullText: data.project.fullText,
      parsedPages: data.project.pageCount,
      status: "ready",
    });

    // 2. Create translation records
    for (const t of data.translations) {
      await ctx.runMutation(api.mutations.upsertTranslation, {
        projectId,
        langCode: t.langCode,
        totalChunks: t.totalChunks || 1,
        status: t.status === "complete" ? "complete" : "pending",
        completedChunks: t.completedChunks || 0,
        mergedText: t.mergedText || "",
      });
    }

    return { success: true, projectId };
  },
});
```

**What the new import does:**
- ✅ Creates a new project record in Convex DB
- ✅ Creates translation records with progress data
- ✅ Preserves merged text per language
- ✅ Server-side validation (type + version check)
- ✅ Session-scoped (new project per session)
- ✅ Works cross-device (Convex is cloud)

**What is missing (regressions):**
- ❌ Does NOT restore original PDF binary (pageData is always `[]`)
- ❌ Does NOT restore individual chunk records (only creates translation summaries)
- ❌ Does NOT restore parsed page data (text items with positions)
- ❌ Does NOT restore QA reports
- ❌ Does NOT restore terminology/translation memory
- ❌ Creates a NEW project (doesn't merge with existing)
- ❌ Requires network round-trip to Convex server
- ❌ No `pdfStorageId` — original PDF not uploaded to Convex storage

---

## 4. Data Model Comparison

### OLD IndexedDB Schema

```
Store: "project" (key: "current")
┌─────────────────────────────────────────────────┐
│ id: string                                       │
│ fileName: string                                 │
│ pageCount: number                                │
│ wordCount: number                                │
│ warnings: string[]                               │
│ pdfBytes: ArrayBuffer (or pdfBase64: string)     │
│ pageData: PDFPageData[] (text items + positions) │
│ pageTexts: string[]                              │
│ fullText: string                                 │
│ parsedPages: number                              │
│ createdAt: string                                │
└─────────────────────────────────────────────────┘

Store: "translations" (key: langCode, e.g. "ur")
┌─────────────────────────────────────────────────┐
│ progress: {                                      │
│   langCode, langName, langNativeName             │
│   completedChunks, totalChunks                   │
│   mergedText, complete, pdfDownloaded             │
│ }                                                │
│ chunks: TranslationChunk[]                       │
│   (langCode, translatedText, pageStart, pageEnd, │
│    chunkIndex, complete)                         │
│ qaReport: QAReport                               │
│ pdfBlob: Blob (cached translated PDF)            │
└─────────────────────────────────────────────────┘

Store: "translation-memory" (key: "langCode::source")
┌─────────────────────────────────────────────────┐
│ source: string                                   │
│ translation: string                              │
│ langCode: string                                 │
│ category: "proper-noun" | "fantasy" | ...        │
│ locked: boolean                                  │
└─────────────────────────────────────────────────┘
```

### NEW Convex Schema

```
Table: "projects"
┌─────────────────────────────────────────────────┐
│ sessionId: string (optional)                     │
│ fileName: string                                 │
│ pageCount: number                                │
│ wordCount: number                                │
│ pdfStorageId: string (optional)                  │
│ pageData: any (JSON)                             │
│ fullText: string                                 │
│ parsedPages: number                              │
│ status: string                                   │
│ zipStorageId: string (optional)                  │
│ zipUrl: string (optional)                        │
│ createdAt: number                                │
└─────────────────────────────────────────────────┘

Table: "chunks"
┌─────────────────────────────────────────────────┐
│ projectId: Id<"projects">                       │
│ langCode: string                                 │
│ chunkIndex: number                               │
│ sourceText: string                               │
│ translatedText: string (optional)                │
│ status: string                                   │
│ model: string (optional)                         │
│ usage: any (optional)                            │
└─────────────────────────────────────────────────┘

Table: "translations"
┌─────────────────────────────────────────────────┐
│ projectId: Id<"projects">                       │
│ langCode: string                                 │
│ status: string                                   │
│ totalChunks: number                              │
│ completedChunks: number                          │
│ mergedText: string (optional)                    │
│ pdfStorageId: string (optional)                  │
│ pdfUrl: string (optional)                        │
│ pdfGenerating: boolean (optional)                │
│ pdfProgress: string (optional)                   │
│ startedAt: number (optional)                     │
│ completedAt: number (optional)                   │
└─────────────────────────────────────────────────┘

Table: "translation-memory" — NOT PRESENT in new schema
```

---

## 5. Feature Parity Matrix

| Feature | OLD | NEW | Status |
|---|---|---|---|
| Export project metadata | ✅ Full (fileName, pageCount, wordCount, warnings) | ✅ Partial (no warnings) | ⚠️ Regression |
| Export original PDF | ✅ Base64-encoded in JSON | ❌ Not included | ❌ Missing |
| Export parsed page data | ✅ Text items with X/Y positions | ❌ Not included | ❌ Missing |
| Export page texts | ✅ Per-page text array | ❌ Not included | ❌ Missing |
| Export full text | ✅ Included | ✅ Included | ✅ Working |
| Export translation chunks | ✅ Per-chunk with page ranges | ❌ Not included | ❌ Missing |
| Export merged text | ✅ Included | ✅ Included | ✅ Working |
| Export QA reports | ✅ Per-language QA report | ❌ Not included | ❌ Missing |
| Export terminology | ✅ All locked terms | ❌ Not included | ❌ Missing |
| Export version tracking | ✅ `_version: 2` | ✅ `version: 1` | ✅ Working |
| Export timestamp | ✅ `_exportedAt` | ✅ `exportedAt` | ✅ Working |
| Import project | ✅ Restores to IndexedDB | ✅ Creates in Convex DB | ✅ Working |
| Import PDF binary | ✅ Base64 → ArrayBuffer restore | ❌ Not restored | ❌ Missing |
| Import page data | ✅ Restores text items | ❌ pageData always `[]` | ❌ Missing |
| Import translation chunks | ✅ Full chunk records restored | ❌ Only summary records | ❌ Missing |
| Import merged text | ✅ Restored | ✅ Restored | ✅ Working |
| Import QA reports | ✅ Restored | ❌ Not restored | ❌ Missing |
| Import terminology | ✅ Restored to IndexedDB | ❌ Not imported | ❌ Missing |
| File format validation | ✅ `_exportedAt` + `_version` check | ✅ `type` + `version` check | ✅ Working |
| Cross-device sync | ❌ Manual (download/upload JSON) | ✅ Native (Convex cloud) | ✅ Improvement |
| Session isolation | ❌ Single user per browser | ✅ Per-tab via sessionId | ✅ Improvement |
| Network requirement | ❌ Offline-capable | ⚠️ Requires internet | ⚠️ Trade-off |

---

## 6. Export JSON Format Comparison

### OLD Format (`ExportedProgress`, version 2)

```json
{
  "_exportedAt": "2025-01-15T10:30:00.000Z",
  "_version": 2,
  "project": {
    "id": "current",
    "fileName": "OnyxStorm.pdf",
    "pageCount": 700,
    "wordCount": 185000,
    "warnings": ["Only 650 of 700 pages contain extractable text."],
    "pdfBase64": "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxv...",
    "pageData": [
      {
        "num": 1,
        "text": "Chapter 1: The Storm Within...",
        "textItems": [
          { "str": "Chapter", "x": 72, "y": 700, "width": 54, "height": 12, "fontName": "Times-Roman" }
        ]
      }
    ],
    "pageTexts": ["Chapter 1: The Storm Within..."],
    "fullText": "Chapter 1: The Storm Within\n\nViolet gripped...",
    "parsedPages": 700,
    "createdAt": "2025-01-15T09:00:00.000Z"
  },
  "translations": {
    "ur": {
      "progress": {
        "langCode": "ur",
        "langName": "Urdu",
        "langNativeName": "اردو",
        "completedChunks": 15,
        "totalChunks": 15,
        "mergedText": "باب 1: اندر طوفان...\n\nوائلیٹ نے...",
        "complete": true,
        "pdfDownloaded": false
      },
      "chunks": [
        {
          "langCode": "ur",
          "translatedText": "باب 1: اندر طوفان...",
          "pageStart": 0,
          "pageEnd": 4,
          "chunkIndex": 0,
          "complete": true
        }
      ],
      "qaReport": {
        "overall": "pass",
        "score": 87,
        "checks": [...]
      }
    },
    "ar": { "..." }
  },
  "terminology": [
    {
      "source": "Venin",
      "translation": "فينن",
      "langCode": "ur",
      "category": "fantasy",
      "locked": true
    }
  ]
}
```

### NEW Format (`exportData`, version 1)

```json
{
  "type": "onyx-translate-project",
  "version": 1,
  "exportedAt": "2025-01-15T10:30:00.000Z",
  "project": {
    "fileName": "OnyxStorm.pdf",
    "pageCount": 700,
    "wordCount": 185000,
    "fullText": "Chapter 1: The Storm Within\n\nViolet gripped...",
    "status": "translating"
  },
  "translations": [
    {
      "langCode": "ur",
      "totalChunks": 15,
      "completedChunks": 12,
      "mergedText": "باب 1: اندر طوفان...\n\nوائلیٹ نے...",
      "status": "in_progress"
    },
    {
      "langCode": "ar",
      "totalChunks": 15,
      "completedChunks": 15,
      "mergedText": "الفصل الأول: العاصفة من الداخل...",
      "status": "complete"
    }
  ]
}
```

**Key differences:**
- OLD uses `_version: 2`, NEW uses `version: 1` (and `type` field)
- OLD wraps translations in `Record<string, TranslationRecord>`, NEW uses flat `Array`
- OLD includes `chunks[]` per language, NEW only has summary fields
- OLD includes `qaReport` per language, NEW does not
- OLD includes `pdfBase64` in project, NEW does not include PDF at all
- OLD includes `pageData[]` with text items, NEW has no page data
- OLD includes `terminology[]`, NEW has no terminology

---

## 7. Regression Root Causes

### Why was so much dropped during migration?

1. **Export was simplified to "minimum viable"**: The new `handleExportProgress` was written from scratch without referencing the old `exportAllProgress` implementation. It only exports the fields that are directly available on `convexProject` and `activeTranslations` objects.

2. **Convex doesn't support binary storage in records**: The old system stored `ArrayBuffer` directly in IndexedDB. Convex records are JSON-only — binary data must use Convex File Storage (`ctx.storage.store()`), which requires an async upload action. The export handler is client-side and doesn't upload to Convex Storage.

3. **Chunk records are not queryable from the export**: The `activeTranslations` object from Convex only contains translation summaries (`totalChunks`, `completedChunks`, `mergedText`). The individual chunk records (with `sourceText` and `translatedText` per chunk) are in a separate `chunks` table and would require a separate query.

4. **Terminology table doesn't exist in Convex schema**: The old system had a `translation-memory` IndexedDB store. The Convex schema has no equivalent table, so terminology cannot be exported or imported.

5. **QA reports are not stored in Convex**: QA runs on the client side during translation and is not persisted to Convex. There's no `qaReport` field in the `translations` table.

---

## 8. Impact Assessment

### Critical Regressions (blocks core user workflows)

| # | Regression | Impact |
|---|---|---|
| 1 | **Original PDF not exported** | If user loses their browser data, the imported project has no PDF → cannot regenerate translated PDFs |
| 2 | **Translation chunks not exported** | Only merged text is preserved; individual chunk progress is lost → cannot resume partial translations |
| 3 | **Terminology not exported** | Glossary lock decisions (P21) are lost → future translations may produce inconsistent term choices |

### Moderate Regressions (reduces export utility)

| # | Regression | Impact |
|---|---|---|
| 4 | **QA reports not exported** | Quality audit trail is lost on export |
| 5 | **Page data not exported** | PDF overlay positioning lost → client-side PDF regen may differ |
| 6 | **Warnings not exported** | User loses context about parsing issues |

### Improvements (gained in migration)

| # | Improvement | Benefit |
|---|---|---|
| 1 | **Cross-device sync** | No need to export/import — data lives in Convex cloud |
| 2 | **Session isolation** | Each browser tab has its own project, no conflicts |
| 3 | **Server-side persistence** | Data survives browser cache clear, device switch |
| 4 | **Simpler format** | Easier to parse, fewer edge cases (no Base64 PDF) |

---

## 9. Dead Code in Old System

The following functions in `storage.ts` are still defined but **no longer called** from Translator.tsx:

| Function | Purpose | Status |
|---|---|---|
| `exportAllProgress()` | Export full IndexedDB state | ❌ Dead — replaced by inline `handleExportProgress` |
| `importAllProgress()` | Import JSON into IndexedDB | ❌ Dead — replaced by `convex/importProject.ts` |
| `serializeProgress()` | JSON.stringify wrapper | ❌ Dead |
| `deserializeProgress()` | JSON.parse + validation | ❌ Dead |
| `saveProject()` | Save project to IndexedDB | ❌ Dead — Convex mutation replaces this |
| `getProject()` | Load project from IndexedDB | ❌ Dead — Convex query replaces this |
| `deleteProject()` | Delete project from IndexedDB | ❌ Dead — Convex mutation replaces this |
| `saveTranslationChunk()` | Save chunk to IndexedDB | ❌ Dead — Convex mutation replaces this |
| `getAllTranslations()` | Load all translations from IndexedDB | ❌ Dead — Convex query replaces this |
| `deleteTranslation()` | Delete lang from IndexedDB | ❌ Dead — Convex mutation replaces this |
| `saveQAReport()` | Cache QA report in IndexedDB | ❌ Dead — no Convex equivalent |
| `saveTranslationPdf()` | Cache PDF blob in IndexedDB | ❌ Dead — Convex File Storage replaces this |
| `getTranslationPdf()` | Load cached PDF from IndexedDB | ❌ Dead — Convex File Storage replaces this |
| `isIndexedDBAvailable()` | Feature detection | ❌ Dead |
| `chunkPageTexts()` | Split pages into chunks | ❌ Dead — `chunkText()` in translateContent.ts replaces this |
| `mergeChunkTexts()` | Join chunk texts | ❌ Still imported in Translator.tsx but **never called** |

**Still actively used from `storage.ts`:**
| Function | Purpose | Used by |
|---|---|---|
| `saveTerminology()` | Save locked term | `engine.ts` line 760 |
| `getTerminology()` | Load locked term | `engine.ts` (via `getAllTerminology`) |
| `getAllTerminology()` | Load all terms for lang | `engine.ts` line 728 |
| `saveTerminologyBatch()` | Batch save terms | `engine.ts` line 760 |
| `TranslationChunk` type | Type export | `Translator.tsx` import |
| `mergeChunkTexts` | Type import only | `Translator.tsx` import (unused) |

---

## 10. Recommended Fixes

### Priority 1 — Restore Export Completeness

Update `handleExportProgress` in `Translator.tsx` to:
1. Query the `chunks` table for each language to include individual chunk records
2. Include `pageData` from `convexProject` if available
3. Include a `pdfStorageId` reference so the import can fetch the original PDF from Convex Storage

### Priority 2 — Restore Import Completeness

Update `convex/importProject.ts` to:
1. Accept and store `pageData` if present in the export JSON
2. Recreate individual chunk records if present in the export
3. Upload the original PDF to Convex File Storage if `pdfBase64` is included

### Priority 3 — Add Translation Memory Table to Convex Schema

Create a new `terminology` table in `convex/schema.ts`:
```typescript
terminology: defineTable({
  langCode: v.string(),
  source: v.string(),
  translation: v.string(),
  category: v.string(),
  locked: v.boolean(),
}).index("by_lang_source", ["langCode", "source"]),
```

Wire `saveTerminology()` and `getAllTerminology()` in `storage.ts` to use Convex mutations/queries instead of IndexedDB.

### Priority 4 — Add QA Report Storage

Add a `qaReport` field to the `translations` table in the Convex schema, or create a separate `qaReports` table. Wire the QA pipeline to persist reports after each chunk.

---

## 11. Summary Table

| Category | Items | Status |
|---|---|---|
| **Export features** | 11 in old, 5 in new | 6 regressions |
| **Import features** | 9 in old, 4 in new | 5 regressions |
| **Data fields exported** | 18 in old, 8 in new | 10 fields lost |
| **Dead code functions** | — | 16 functions in storage.ts are dead |
| **Still-used storage.ts functions** | — | 5 functions (terminology + types) |
| **New capabilities** | — | Cross-device sync, session isolation |
| **Net assessment** | — | Functional but feature-degraded |
