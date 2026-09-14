/**
 * Phase 1 (Universal Archive + Safe Removal): this module was trimmed to its
 * LIVE surface only — the translation-memory store. The previous version
 * (frozen in _universal/onyx-stable/src/lib/translator/storage.ts,
 * sha256 eb2cc257…0aab) carried a dead IndexedDB persistence layer (project /
 * chunk stores, PDF blob cache, v1→v2 migration, exportAllProgress /
 * importAllProgress JSON backup, mergeChunkTexts) — all unused since
 * translation state moved to Convex. Removed here.
 *
 * Kept (verified live callers):
 * - saveTerminologyBatch / getAllTerminology / TerminologyEntry → engine.ts
 */

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

const DB_NAME = "onyx-translate-db";
const STORE_MEMORY = "translation-memory";

function openMemoryDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_MEMORY)) {
        db.createObjectStore(STORE_MEMORY);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a terminology entry to the translation memory.
 */
async function saveTerminology(entry: TerminologyEntry): Promise<void> {
  const key = `${entry.langCode}::${entry.source.toLowerCase()}`;
  const db = await openMemoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MEMORY, "readwrite");
    tx.objectStore(STORE_MEMORY).put(entry, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * Batch save terminology entries.
 */
export async function saveTerminologyBatch(entries: TerminologyEntry[]): Promise<void> {
  for (const entry of entries) {
    await saveTerminology(entry);
  }
}

/**
 * Get all terminology entries for a language.
 */
export async function getAllTerminology(langCode: string): Promise<TerminologyEntry[]> {
  const db = await openMemoryDB();
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
