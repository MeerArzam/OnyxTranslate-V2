/**
 * src/lib/translator/serverUpload.ts — PHASE 2 hybrid server-first upload.
 *
 * PHYSICS (surfaced honestly in the UI, never faked):
 *  - Path 1 (≤19MB): ONE request — POST /uploadAndCreateJob → the server stores
 *    the file, creates the job, schedules processing. Smallest close-window.
 *  - Path 2 (>19MB): createPendingUpload → raw XHR POST of the File to Convex
 *    Storage (progress %, cancel supported) → finalizeUploadedPdf → job
 *    scheduled. ~2-minute platform timeout on the POST — reported honestly.
 *  - BANNED and absent: base64 file args, sendBeacon/keepalive for large files.
 *
 * The browser's ONLY jobs: file pick → raw POST → finalize handshake. Parsing,
 * chunking, translation, PDF gen and ZIP all continue server-side.
 */
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  saveStagingRecord,
  deleteStagingRecord,
  type UploadStagingRecord,
} from "../identity";

// Deployment migration: the site URL derives from the migrated cloud URL.
import { resolveConvexUrl } from "../convexUrl";

const CONVEX_HTTP_URL: string = resolveConvexUrl(
  import.meta.env?.VITE_CONVEX_URL,
).replace(/\.cloud$/, ".site");

export const PATH1_MAX_BYTES = 19 * 1024 * 1024; // mirrors convex/http.ts

/**
 * PHASE 3 client-path fix: download the server-built export JSON through the
 * /downloadExport endpoint (Content-Disposition filename) and hand the caller a
 * same-origin blob URL. Browsers ignore the anchor `download` attribute on
 * cross-origin URLs — the old direct-storage anchor never produced a download
 * event in a real browser (caught by the Chromium client-path run).
 */
export async function fetchExportBlobUrl(opts: {
  projectId: Id<"projects">;
  fileName: string;
  issueToken: (args: { projectId: Id<"projects">; fileName: string }) => Promise<{ token: string }>;
}): Promise<{ blobUrl: string; sizeBytes: number | null }> {
  const { token } = await opts.issueToken({ projectId: opts.projectId, fileName: opts.fileName });
  const res = await fetch(`${convexHttpBase()}/downloadExport?t=${encodeURIComponent(token)}`);
  if (!res.ok) {
    let msg = `Export download failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  return { blobUrl: URL.createObjectURL(blob), sizeBytes: blob.size };
}

export interface UploadJobHandle {
  uploadJobId: Id<"uploadJobs">;
  path: 1 | 2;
}

function convexHttpBase(): string {
  if (!CONVEX_HTTP_URL) {
    throw new Error("VITE_CONVEX_URL is not configured — cannot reach the server");
  }
  return CONVEX_HTTP_URL.replace(/\/$/, "");
}

/**
 * PATH 1 — file ≤19MB. One request does everything:
 * upload → job creation → processing scheduled.
 */
export function uploadAndCreateJob(opts: {
  file: File;
  clientId: string;
  tabSessionId: string;
  langCodes: string[];
  idempotencyKey: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<UploadJobHandle & { duplicate?: boolean }> {
  const { file, clientId, tabSessionId, langCodes, idempotencyKey, onProgress, signal } = opts;

  const form = new FormData();
  form.append("file", file);
  form.append("clientId", clientId);
  form.append("tabSessionId", tabSessionId);
  form.append("langCodes", langCodes.join(","));
  form.append("idempotencyKey", idempotencyKey);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${convexHttpBase()}/uploadAndCreateJob`);
    xhr.responseType = "json";
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as {
        ok?: boolean;
        uploadJobId?: string;
        duplicate?: boolean;
        error?: string;
        code?: string;
      };
      if (xhr.status >= 200 && xhr.status < 300 && body.ok && body.uploadJobId) {
        resolve({
          uploadJobId: body.uploadJobId as Id<"uploadJobs">,
          path: 1,
          duplicate: body.duplicate,
        });
      } else {
        // Real server errors surface verbatim — never converted into fake limits.
        reject(new Error(body.error || `Upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(form);
  });
}

/**
 * PATH 2 — file >19MB: staged direct upload with progress and cancel.
 * 1. createPendingUpload (mutation) → uploadJob + storage upload URL
 * 2. raw XHR POST of the File to Storage (progress, abortable)
 * 3. finalizeUploadedPdf → schedules processing (the handoff ACK)
 */
export async function uploadLargeFile(opts: {
  file: File;
  clientId: string;
  tabSessionId: string;
  langCodes: string[];
  convex: {
    mutation: (ref: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<UploadJobHandle> {
  const { file, clientId, tabSessionId, langCodes, convex, onProgress, signal } = opts;

  // Staging record FIRST (spec A) — survives a tab crash mid-POST.
  const uploadId = crypto.randomUUID();
  const staging: UploadStagingRecord = {
    uploadId,
    fileName: file.name,
    size: file.size,
    langCodes,
    path: 2,
    createdAt: Date.now(),
  };
  await saveStagingRecord(staging);

  // Step 1: staging row + storage upload URL.
  const created = (await convex.mutation(api.identity.createPendingUploadWithPath, {
    clientId,
    tabSessionId,
    fileName: file.name,
    fileSize: file.size,
    langCodes,
    idempotencyKey: uploadId,
  })) as { uploadJobId: string; uploadUrl: string };

  const uploadJobId = created.uploadJobId as Id<"uploadJobs">;

  // Step 2: raw POST — the browser only carries bytes.
  try {
    const storageId = await new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", created.uploadUrl);
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText) as { storageId?: string };
            if (body.storageId) resolve(body.storageId);
            else reject(new Error("Storage upload returned no storageId"));
          } catch {
            reject(new Error("Storage upload returned invalid JSON"));
          }
        } else {
          // Platform errors (e.g. ~2-min timeout on very slow links) shown as-is.
          reject(new Error(`Storage upload failed (HTTP ${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during storage upload"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.send(file);
    });

    // Step 3: finalize handshake → schedules server processing (the ACK).
    await convex.mutation(api.upload.finalizeUploadedPdf, { uploadJobId, storageId });
    await convex.mutation(api.upload.beginProcessing, { uploadJobId });
    await deleteStagingRecord(uploadId);
    return { uploadJobId, path: 2 };
  } catch (err) {
    // Keep the staging record — reopen offers "Resume upload"/Discard.
    throw err;
  }
}

/** Clear a completed/cancelled staging row (called after a successful retry). */
export async function clearStaging(uploadId: string): Promise<void> {
  await deleteStagingRecord(uploadId);
}

/**
 * IMPORT — one request with the project JSON (usually <20MB → Path 1 style).
 * Server validates {type:"onyx-translate-project"} BEFORE any write; rejects
 * malformed/corrupt/incompatible files with a visible error, zero partial writes.
 */
export function uploadAndImport(opts: {
  file: File;
  clientId: string;
  tabSessionId: string;
  onProgress?: (loaded: number, total: number) => void;
}): Promise<{ ok: boolean; jobId: string; importedLangCodes: string[] }> {
  const { file, clientId, tabSessionId, onProgress } = opts;
  const form = new FormData();
  form.append("file", file);
  form.append("clientId", clientId);
  form.append("tabSessionId", tabSessionId);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${convexHttpBase()}/uploadAndImport`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as {
        ok?: boolean;
        jobId?: string;
        importedLangCodes?: string[];
        error?: string;
      };
      if (xhr.status >= 200 && xhr.status < 300 && body.ok && body.jobId) {
        resolve({
          ok: true,
          jobId: body.jobId,
          importedLangCodes: body.importedLangCodes ?? [],
        });
      } else {
        reject(new Error(body.error || `Import failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during import"));
    xhr.send(form);
  });
}
