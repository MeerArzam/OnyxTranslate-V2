import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/http.ts — PHASE 2 Path 1 endpoints (single-request, server-first).
 *
 * PHYSICS (honest limits, also surfaced in the UI):
 *  - Convex upload POSTs are capped by a ~2-minute HTTP timeout.
 *  - An HTTP action's REQUEST body may be at most 20MB → this endpoint accepts
 *    files up to 19MB (headroom for multipart/other overhead). Larger files use
 *    Path 2 (createPendingUpload → direct Storage POST → finalizeUploadedPdf).
 *  - NO artificial 10MB/300-page limits exist anywhere. Real provider errors are
 *    reported verbatim; nothing is converted into fake app limits.
 *
 * BANNED and absent here: base64 file args, sendBeacon/keepalive for large
 * files. The file arrives as RAW bytes; zero client parsing beforehand.
 */

const MAX_PATH1_BYTES = 19 * 1024 * 1024; // 19MB — reported honestly, enforced by platform physics
const MAX_IMPORT_BYTES = 19 * 1024 * 1024;

// PHASE 3 client-path fix: custom httpActions get NO CORS headers by default,
// so every browser XHR (and its preflight) was blocked — invisible to the
// server-level tests, caught by the real Chromium run. The app is public by
// design (client-id identity, no cookies), so a permissive ACAO is correct.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// ─── PHASE 3: export download with an honest filename ──────────────────────
// Browsers IGNORE the anchor `download` attribute on cross-origin URLs, so the
// direct storage link either navigated away or opened inline and no download
// event ever fired (caught by the real Chromium client-path run). Exports are
// now served here with Content-Disposition. Token-bound: the client can only
// download the artifact its own project produced.
export const downloadExport = httpAction(async (ctx, request) => {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("t") ?? "";
    if (!token) return json({ ok: false, error: "Missing token" }, 400);
    const row = await ctx.runQuery(api.artifactMutations.consumeExportToken, { token });
    if (!row) return json({ ok: false, error: "Export link expired or invalid" }, 404);
    const blob = await ctx.storage.get(row.storageId);
    if (!blob) return json({ ok: false, error: "Artifact bytes missing" }, 404);
    const safeName = row.fileName.replace(/[^a-zA-Z0-9_.-]/g, "_") || "onyx_backup.json";
    return new Response(blob, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const ALL_LANGS = [
  "ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
  "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
];

// ─── Path 1: ONE request → uploadJob → processing scheduled ────────────────

export const uploadAndCreateJob = httpAction(async (ctx, request) => {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "Missing file field (multipart/form-data)" }, 400);
    }
    const clientId = String(form.get("clientId") ?? "");
    if (!clientId) return json({ ok: false, error: "Missing clientId" }, 400);
    const tabSessionId = String(form.get("tabSessionId") ?? "") || undefined;
    const idempotencyKey = String(form.get("idempotencyKey") ?? "") || undefined;
    const langsRaw = String(form.get("langCodes") ?? "");
    const langCodes = langsRaw
      ? langsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined;

    if (file.size > MAX_PATH1_BYTES) {
      // Honest physics message — client should switch to Path 2, not give up.
      return json(
        {
          ok: false,
          error: `File is ${file.size} bytes; single-request upload accepts up to ${MAX_PATH1_BYTES}. Use the direct-upload path (Path 2) for this file.`,
          code: "USE_PATH2",
        },
        413,
      );
    }
    if (idempotencyKey) {
      const dupe = await ctx.runQuery(api.identity.getUploadJobByIdempotencyKey, { idempotencyKey });
      if (dupe) return json({ ok: true, uploadJobId: dupe._id, duplicate: true });
    }

    // Store RAW bytes — no client-side base64, no parsing, no text dump.
    const storageId = await ctx.storage.store(file);

    const now = Date.now();
    const uploadJobId = await ctx.runMutation(api.identity.createUploadJob, {
      clientId,
      tabSessionId,
      fileName: file.name || "upload.pdf",
      fileSize: file.size,
      storageId,
      idempotencyKey,
      langCodes: langCodes && langCodes.length > 0 ? langCodes : ALL_LANGS,
      uploadPath: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Fire server processing — the browser is DONE the moment this returns.
    await ctx.scheduler.runAfter(0, api.jobProcessing.processUploadedPdf, { uploadJobId });

    return json({ ok: true, uploadJobId, storageId, duplicate: false });
  } catch (err) {
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

// ─── Import: ONE request with the project JSON ──────────────────────────────

export const uploadAndImport = httpAction(async (ctx, request) => {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "Missing file field (multipart/form-data)" }, 400);
    }
    const clientId = String(form.get("clientId") ?? "");
    if (!clientId) return json({ ok: false, error: "Missing clientId" }, 400);
    const tabSessionId = String(form.get("tabSessionId") ?? "") || undefined;
    const sessionId = tabSessionId;

    if (file.size > MAX_IMPORT_BYTES) {
      return json({ ok: false, error: `Import file exceeds ${MAX_IMPORT_BYTES} bytes (HTTP action request limit)` }, 413);
    }

    // Validate BEFORE any write — malformed/corrupt/incompatible JSON must
    // produce a visible error and ZERO partial writes.
    const text = await file.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "Import failed: file is not valid JSON (corrupt?)" }, 400);
    }
    const d = data as Record<string, unknown>;
    if (d?.type !== "onyx-translate-project") {
      return json({ ok: false, error: "Import failed: not an OnyxTranslate project file (missing type \"onyx-translate-project\")" }, 400);
    }
    const project = d.project as Record<string, unknown> | undefined;
    if (!project || typeof project.fullText !== "string") {
      return json({ ok: false, error: "Import failed: project payload missing or has no fullText" }, 400);
    }

    const result = await ctx.runAction(api.importJob.uploadAndImportFromData, {
      clientId,
      sessionId,
      data: d as {
        langCodes?: string[];
        project: {
          fileName?: string;
          pageCount?: number;
          wordCount?: number;
          fullText: string;
          parsedPages?: number;
          status?: string;
          pageData?: unknown;
        };
        chunks?: Array<{ langCode: string; chunkIndex: number; sourceText: string; translatedText?: string | null; status?: string }>;
        translations?: Array<{ langCode: string; status?: string; totalChunks?: number; completedChunks?: number; mergedText?: string | null }>;
      },
    });
    return json(result);
  } catch (err) {
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

const http = httpRouter();

http.route({
  path: "/uploadAndCreateJob",
  method: "POST",
  handler: uploadAndCreateJob,
});
http.route({
  path: "/uploadAndCreateJob",
  method: "OPTIONS",
  handler: httpAction(async () => preflight()),
});
http.route({
  path: "/uploadAndImport",
  method: "POST",
  handler: uploadAndImport,
});
http.route({
  path: "/uploadAndImport",
  method: "OPTIONS",
  handler: httpAction(async () => preflight()),
});
http.route({
  path: "/downloadExport",
  method: "GET",
  handler: downloadExport,
});

export default http;
