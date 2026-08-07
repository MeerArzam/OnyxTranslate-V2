/**
 * IndexedDB-based persistent storage for Onyx Translate.
 * Stores parsed PDF data, translated chunks, and progress state
 * so work is never lost on page refresh.
 */

import type { PDFPageData } from "./pdfParser";

const DB_NAME = "onyx-translate-db";
const DB_VERSION = 1;

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
  /** Base64-encoded ArrayBuffer of the original PDF */
  pdfBase64: string;
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

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
 */
export async function saveProject(data: Omit<ProjectData, "pdfBase64"> & { arrayBuffer: ArrayBuffer }): Promise<void> {
  const project: ProjectData = {
    ...data,
    pdfBase64: arrayBufferToBase64(data.arrayBuffer),
  };
  await dbPut(STORE_PROJECT, PROJECT_KEY, project);
}

/**
 * Get the stored project, or null if none exists.
 */
export async function getProject(): Promise<(ProjectData & { arrayBuffer: ArrayBuffer }) | null> {
  const data = await dbGet<ProjectData>(STORE_PROJECT, PROJECT_KEY);
  if (!data) return null;
  return {
    ...data,
    arrayBuffer: base64ToArrayBuffer(data.pdfBase64),
  };
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
export async function getAllTranslations(): Promise<
  Record<string, { progress: LanguageProgress; chunks: TranslationChunk[] }>
> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, "readonly");
    const store = tx.objectStore(STORE_TRANSLATIONS);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const keys = req.result as string[];
      const result: Record<string, { progress: LanguageProgress; chunks: TranslationChunk[] }> = {};

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
 * Mark a language's translation as PDF downloaded.
 */
export async function markPdfDownloaded(langCode: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TRANSLATIONS, "readwrite");
    const store = tx.objectStore(STORE_TRANSLATIONS);
    const req = store.get(langCode);
    req.onsuccess = () => {
      const data = req.result;
      if (data?.progress) {
        data.progress.pdfDownloaded = true;
        store.put(data, langCode);
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
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
