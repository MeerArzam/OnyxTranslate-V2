/**
 * IndexedDB-based persistent storage for Onyx Translate.
 * Stores parsed PDF data, translated chunks, and progress state
 * so work is never lost on page refresh.
 *
 * Export/Import enables cross-origin sync (Preview ↔ Published)
 * and backup across devices.
 */

import type { PDFPageData } from "./pdfParser";

const DB_NAME = "onyx-translate-db";
const DB_VERSION = 2; // v2: PDFs stored as raw ArrayBuffer/Blob (was Base64 in v1)

// Object store names
const STORE_PROJECT = "project";
const STORE_TRANSLATIONS = "translations";
const STORE_MEMORY = "translation-memory";

// Project-level metadata stored under a fixed key
export interface ProjectData {
  id: string;
  fileName: string;
  pageCount: number;
  wordCount: number;
  warnings: string[];
  /** Raw binary bytes of the original PDF (v2 storage, ~33% smaller than Base64) */
  pdfBytes?: ArrayBuffer;
  /** Legacy Base64 encoding (v1). Migrated to pdfBytes on load; kept on exports for file compatibility. */
  pdfBase64?: string;
  /** Parsed page data (text items with positions) */
  pageData: PDFPageData[];
  /** Per-page plain text */
  pageTexts: string[];
  /** Full concatenated text */
  fullText: string;
  /** How many pages have been parsed so far */
  parsedPages: number;
  createdAt: string;
}

export interface TranslationChunk {
  langCode: string;
  langName: string;
  langNativeName: string;
  /** Translated text for this chunk of pages */
  translatedText: string;
  /** Page indices this chunk covers (0-based) */
  pageStart: number;
  pageEnd: number;
  chunkIndex: number;
  /** Whether this chunk is complete */
  complete: boolean;
}

export interface LanguageProgress {
  langCode: string;
  langName: string;
  langNativeName: string;
  /** Number of translated chunks completed */
  completedChunks: number;
  /** Total chunks for this language */
  totalChunks: number;
  /** Full merged translated text (built as chunks complete) */
  mergedText: string | null;
  /** Whether all chunks are done */
  complete: boolean;
  /** Whether PDF was generated and downloaded */
  pdfDownloaded: boolean;
}

export interface TranslationRecord {
  progress: LanguageProgress;
  chunks: TranslationChunk[];
  /** Cached generated PDF for this language (v2) — makes ZIP downloads instant. */
  pdfBlob?: Blob;
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECT)) {
        db.createObjectStore(STORE_PROJECT);
      }
      if (!db.objectStoreNames.contains(STORE_TRANSLATIONS)) {
        db.createObjectStore(STORE_TRANSLATIONS);
      }
      if (!db.objectStoreNames.contains(STORE_MEMORY)) {
        db.createObjectStore(STORE_MEMORY);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Fire-and-forget migration for projects written by v1 (Base64 PDF).
      migrateFromBase64(db).catch((e) =>
        console.warn("v1->v2 migration skipped", e)
      );
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if IndexedDB is available and responsive.
 */
export async function isIndexedDBAvailable(): Promise<boolean> {
  try {
    const db = await openDB();
    db.close();
    return true;
  } catch {
    return false;
  }
}

async function dbGet<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbClear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ──────────────────────────────────────────────
// ArrayBuffer <-> Base64 conversion
// ──────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * One-time migration for databases created by v1 (which stored the original
 * PDF as a Base64 string). Converts to raw ArrayBuffer/Blob in place.
 */
async function migrateFromBase64(db: IDBDatabase): Promise<void> {
  // Project: pdfBase64 -> pdfBytes
  try {
    const tx = db.transaction(STORE_PROJECT, "readwrite");
    const store = tx.objectStore(STORE_PROJECT);
    const proj = await new Promise<ProjectData | undefined>((resolve) => {
      const r = store.get(PROJECT_KEY);
      r.onsuccess = () => resolve(r.result as ProjectData | undefined);
      r.onerror = () => resolve(undefined);
    });
    if (proj && proj.pdfBase64 && !proj.pdfBytes) {
      proj.pdfBytes = base64ToArrayBuffer(proj.pdfBase64);
      delete proj.pdfBase64;
      store.put(proj, PROJECT_KEY);
    }
  } catch (e) {
    console.warn("project migration skipped", e);
  }
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

const PROJECT_KEY = "current";
const CHUNK_SEPARATOR = "|||CHUNK_SEP|||";

// ──────────────────────────────────────────────
// Translation Memory (Phase 13)
// Saves finalized terminology choices so they are enforced consistently
// across large PDF batches and future sequel uploads.
// ──────────────────────────────────────────────

export interface TerminologyEntry {
  source: string;
  translation: string;
  langCode: string;
  category: "proper-noun" | "fantasy" | "military" | "endearment" | "medical";
  locked: boolean; // If locked, always use this translation regardless of context
}

/**
 * Save a terminology entry to the translation memory.
 */
export async function saveTerminology(entry: TerminologyEntry): Promise<void> {
  const key = `${entry.langCode}::${entry.source.toLowerCase()}`;
  await dbPut(STORE_MEMORY, key, entry);
}

/**
 * Get a terminology entry from the translation memory.
 */
export async function getTerminology(
  langCode: string,
  source: string
): Promise<TerminologyEntry | null> {
  const key = `${langCode}::${source.toLowerCase()}`;
  return dbGet<TerminologyEntry>(STORE_MEMORY, key);
}

/**
 * Get all terminology entries for a language.
 */
export async function getAllTerminology(
  langCode: string
): Promise<TerminologyEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEMORY, "readonly");
    const store = tx.objectStore(STORE_MEMORY);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as TerminologyEntry[]).filter(
        (e) => e.langCode === langCode
      );
      db.close();
      resolve(all);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * Batch save terminology entries.
 */
export async function saveTerminologyBatch(
  entries: TerminologyEntry[]
): Promise<void> {
  for (const entry of entries) {
    await saveTerminology(entry);
  }
}

/**
 * Save or update the project data (call after each parsing chunk).
 * The original PDF is stored as raw binary (no Base64 overhead).
 */
export async function saveProject(data: Omit<ProjectData, "pdfBytes" | "pdfBase64"> & { arrayBuffer: ArrayBuffer }): Promise<void> {
  const project: ProjectData = {
    ...data,
    pdfBytes: data.arrayBuffer,
  };
  delete (project as { pdfBase64?: string }).pdfBase64;
  await dbPut(STORE_PROJECT, PROJECT_KEY, project);
}

/**
 * Get the stored project, or null if none exists.
 * Handles v1 projects (Base64) by migrating them to raw binary on read.
 */
export async function getProject(): Promise<(ProjectData & { arrayBuffer: ArrayBuffer }) | null> {
  const data = await dbGet<ProjectData>(STORE_PROJECT, PROJECT_KEY);
  if (!data) return null;

  if (data.pdfBytes) {
    return { ...data, arrayBuffer: data.pdfBytes };
  }

  // Legacy v1 data — migrate in place.
  if (data.pdfBase64) {
    const arrayBuffer = base64ToArrayBuffer(data.pdfBase64);
    const migrated: ProjectData = { ...data, pdfBytes: arrayBuffer };
    delete migrated.pdfBase64;
    try {
      await dbPut(STORE_PROJECT, PROJECT_KEY, migrated);
    } catch {
      // Non-critical: migration will retry next time.
    }
    return { ...migrated, arrayBuffer };
  }

  return { ...data, arrayBuffer: new ArrayBuffer(0) };
}

/**
 * Delete the current project and all its translations.
 */
export async function deleteProject(): Promise<void> {
  await dbClear(STORE_TRANSLATIONS);
  await dbDelete(STORE_PROJECT, PROJECT_KEY);
}

/**
 * Save a translated chunk for a language.
 * Chunks are stored as a single merged string under key `{langCode}`.
 */
export async function saveTranslationChunk(
  langCode: string,
  langName: string,
  langNativeName: string,
  chunks: TranslationChunk[],
  mergedText: string | null,
  complete: boolean
): Promise<void> {
  const progress: LanguageProgress = {
    langCode,
    langName,
    langNativeName,
    completedChunks: chunks.filter((c) => c.complete).length,
    totalChunks: chunks.length,
    mergedText,
    complete,
    pdfDownloaded: false,
  };
  await dbPut(STORE_TRANSLATIONS, langCode, { progress, chunks });
}

/**
 * Get all stored translation progress for all languages.
 */
export async function getAllTranslations(): Promise<Record<string, TranslationRecord>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, "readonly");
    const store = tx.objectStore(STORE_TRANSLATIONS);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const keys = req.result as string[];
      const result: Record<string, TranslationRecord> = {};

      if (keys.length === 0) {
        db.close();
        resolve(result);
        return;
      }

      let loaded = 0;
      for (const key of keys) {
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          result[key] = getReq.result;
          loaded++;
          if (loaded === keys.length) {
            db.close();
            resolve(result);
          }
        };
        getReq.onerror = () => {
          loaded++;
          if (loaded === keys.length) {
            db.close();
            resolve(result);
          }
        };
      }
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * Delete all stored translation progress for a language.
 * Used when the user retranslates: wipes the old chunks so a fresh
 * translation starts from chunk 0 instead of resuming the old one.
 */
export async function deleteTranslation(langCode: string): Promise<void> {
  await dbDelete(STORE_TRANSLATIONS, langCode);
}

/**
 * Cache the generated PDF for a language so ZIP downloads never regenerate.
 */
export async function saveTranslationPdf(
  langCode: string,
  pdfBlob: Blob
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, "readwrite");
    const store = tx.objectStore(STORE_TRANSLATIONS);
    const req = store.get(langCode);
    req.onsuccess = () => {
      const data = req.result as TranslationRecord | undefined;
      if (data) {
        data.pdfBlob = pdfBlob;
        if (data.progress) data.progress.pdfDownloaded = true;
        store.put(data, langCode);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Get the cached generated PDF for a language, or null if not generated yet.
 */
export async function getTranslationPdf(
  langCode: string
): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, "readonly");
    const store = tx.objectStore(STORE_TRANSLATIONS);
    const req = store.get(langCode);
    req.onsuccess = () =>
      resolve((req.result as TranslationRecord | undefined)?.pdfBlob ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Merge individual chunk texts into a single full translation text.
 */
export function mergeChunkTexts(chunks: TranslationChunk[]): string {
  const sorted = [...chunks].sort((a, b) => a.pageStart - b.pageStart);
  return sorted
    .filter((c) => c.complete)
    .map((c) => c.translatedText)
    .join("\n\n");
}

/**
 * Split page texts into translation chunks of approximately the given
 * word count per chunk. Returns an array of page-index ranges.
 */
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

  // Final chunk
  if (currentStart < pageTexts.length) {
    chunks.push({ pageStart: currentStart, pageEnd: pageTexts.length - 1 });
  }

  return chunks;
}

// ──────────────────────────────────────────────
// Export / Import (cross-origin sync)
// ──────────────────────────────────────────────

interface ExportedProgress {
  _exportedAt: string;
  _version: number;
  project: ProjectData | null;
  translations: Record<string, TranslationRecord>;
  terminology: TerminologyEntry[];
}

/**
 * Export the entire IndexedDB state to a serializable JSON object.
 * The user can download this as a .onyx-progress.json file.
 */
export async function exportAllProgress(): Promise<ExportedProgress> {
  const project = await dbGet<ProjectData>(STORE_PROJECT, PROJECT_KEY);
  const translations = await getAllTranslations();

  // Export terminology
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
  } catch {
    // Non-critical
  }

  // Convert binary PDFs to Base64 so the JSON export stays serializable.
  if (project) {
    if (project.pdfBytes) {
      project.pdfBase64 = arrayBufferToBase64(project.pdfBytes);
      delete project.pdfBytes;
    } else if (!project.pdfBase64) {
      project.pdfBase64 = "";
    }
  }

  // NOTE: cached PDF blobs are NOT included in exports — 20 translated PDFs
  // (up to several hundred MB with embedded Unicode fonts) would blow up the
  // JSON on low-end devices. Translated PDFs regenerate quickly through the
  // pdf-lib worker, so the destination regenerates any missing PDF on demand.
  const exportedTranslations: Record<string, TranslationRecord> = {};
  for (const [langCode, rec] of Object.entries(translations)) {
    exportedTranslations[langCode] = {
      progress: rec.progress,
      chunks: rec.chunks,
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

/**
 * Import a previously exported progress file into IndexedDB.
 * Overwrites any existing project/translations (user confirms before calling).
 */
export async function importAllProgress(data: ExportedProgress): Promise<void> {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid progress file format.");
  }

  // Import project (restore binary PDF from the exported Base64)
  if (data.project) {
    const proj = data.project;
    if (proj.pdfBase64) {
      proj.pdfBytes = base64ToArrayBuffer(proj.pdfBase64);
      delete proj.pdfBase64;
    }
    await dbPut(STORE_PROJECT, PROJECT_KEY, proj);
  }

  // Import translations (cached PDF blobs regenerate on demand)
  if (data.translations) {
    for (const [langCode, langData] of Object.entries(data.translations)) {
      delete (langData as unknown as { pdfBlobBase64?: string }).pdfBlobBase64;
      delete langData.pdfBlob;
      await dbPut(STORE_TRANSLATIONS, langCode, langData);
    }
  }

  // Import terminology
  if (data.terminology && Array.isArray(data.terminology)) {
    for (const entry of data.terminology) {
      await dbPut(STORE_MEMORY, `${entry.langCode}::${entry.source.toLowerCase()}`, entry);
    }
  }
}

/**
 * Serialize exported progress to a JSON string for download.
 */
export function serializeProgress(data: ExportedProgress): string {
  return JSON.stringify(data);
}

/**
 * Parse a .onyx-progress.json string back into an ExportedProgress object.
 */
export function deserializeProgress(json: string): ExportedProgress {
  const parsed = JSON.parse(json);
  if (!parsed._exportedAt || !parsed._version) {
    throw new Error("This does not appear to be a valid Onyx Translate progress file.");
  }
  return parsed as ExportedProgress;
}
