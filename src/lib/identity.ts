/**
 * src/lib/identity.ts — PHASE 2 client identity scheme.
 *
 * - `onyx-client-id`       (localStorage)  durable per-device UUID
 * - `onyx-tab-session-id`  (sessionStorage) fresh UUID per tab
 *
 * Every project/job row stores BOTH ids. Live current-work queries filter by
 * clientId + tabSessionId → two tabs stay isolated (C1 rule preserved).
 * Reopening in a new tab surfaces the device's own past jobs via
 * getResumableJobs({clientId}); opening one ADOPTS it (rebinds tabSessionId).
 */

export function getClientId(): string {
  if (typeof window === "undefined") return "ssr-fallback";
  const existing = window.localStorage.getItem("onyx-client-id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem("onyx-client-id", id);
  return id;
}

export function getTabSessionId(): string {
  if (typeof window === "undefined") return "ssr-fallback";
  const existing = window.sessionStorage.getItem("onyx-tab-session-id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.sessionStorage.setItem("onyx-tab-session-id", id);
  return id;
}

/**
 * PHASE 2 staging (spec A): BEFORE the browser POSTs a file, persist a staging
 * record in IndexedDB so an interrupted upload can be offered as "Resume
 * upload" (re-pick file) or discarded on reopen.
 */
const STAGING_DB = "onyx-upload-staging";
const STAGING_STORE = "pending-uploads";

function openStagingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STAGING_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STAGING_STORE)) {
        db.createObjectStore(STAGING_STORE, { keyPath: "uploadId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export interface UploadStagingRecord {
  uploadId: string; // client-generated UUID; doubles as the server idempotencyKey
  fileName: string;
  size: number;
  langCodes: string[];
  path: 1 | 2;
  createdAt: number;
}

export async function saveStagingRecord(rec: UploadStagingRecord): Promise<void> {
  try {
    const db = await openStagingDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, "readwrite");
      tx.objectStore(STAGING_STORE).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("staging put failed"));
    });
    db.close();
  } catch {
    // Staging is best-effort durability; the upload itself continues regardless.
  }
}

export async function listStagingRecords(): Promise<UploadStagingRecord[]> {
  try {
    const db = await openStagingDb();
    const rows = await new Promise<UploadStagingRecord[]>((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, "readonly");
      const req = tx.objectStore(STAGING_STORE).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as UploadStagingRecord[]);
      req.onerror = () => reject(req.error ?? new Error("staging read failed"));
    });
    db.close();
    return rows;
  } catch {
    return [];
  }
}

export async function deleteStagingRecord(uploadId: string): Promise<void> {
  try {
    const db = await openStagingDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STAGING_STORE, "readwrite");
      tx.objectStore(STAGING_STORE).delete(uploadId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("staging delete failed"));
    });
    db.close();
  } catch {
    // ignore — staging cleanup is best-effort
  }
}
