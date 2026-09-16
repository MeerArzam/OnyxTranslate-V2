"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { isOversized } from "./sourceData";

/**
 * convex/jobProcessing.ts — PHASE 2 server-first processing.
 *
 * processUploadedPdf is the ONLY component that walks a stored PDF through the
 * full production pipeline, and it is IDEMPOTENT:
 *  - re-invocation with the same uploadJob finds the existing project (stored
 *    on the job) and resumes from the current stage instead of duplicating;
 *  - the stageSeq guard (updateUploadJobStage) makes superseded scheduled runs
 *    no-op, so a retry can never regress or double-run a stage;
 *  - chunk creation goes through translateContent.translateLanguage, which
 *    upserts chunks deduped on (projectId, langCode, chunkIndex).
 *
 * It reuses the PRODUCTION pipeline unchanged: parsePdf.parseUploadedPdf
 * (x-gap merge + paragraph clustering) → createProject →
 * translateContent.translateLanguage → generatePdf → zipAssembly.
 */
export const processUploadedPdf = action({
  args: { uploadJobId: v.id("uploadJobs") },
  handler: async (ctx, args) => {
    // Actions have no ctx.db — job reads go through a query.
    const getJob = () =>
      ctx.runQuery(api.queries.getUploadJobRaw, { uploadJobId: args.uploadJobId });

    const firstJob = await getJob();
    if (!firstJob) throw new Error("Upload job not found");
    if (firstJob.status === "cancelled") return { ok: false, projectId: undefined };

    // ── Idempotency: an earlier attempt may already have parsed everything ──
    let projectId = firstJob.projectId ?? undefined;
    if (!firstJob.storageId) throw new Error("Upload job has no stored PDF");

    const heartbeat = () =>
      ctx.runMutation(api.identity.heartbeatUploadJob, { uploadJobId: args.uploadJobId });

    try {
      // ── Stage: processing → parse (production parser, x-gap + blocks) ──
      if (!projectId) {
        const seq = firstJob.stageSeq ?? 0;
        const gate = await ctx.runMutation(api.identity.updateUploadJobStage, {
          uploadJobId: args.uploadJobId,
          stage: "processing",
          expectedSeq: seq,
        });
        if (!gate.ok) return { ok: false, projectId: undefined }; // superseded run

        await heartbeat();
        // parseUploadedPdf is an ACTION (Node runtime) — must be runAction.
        const parsed = (await ctx.runAction(api.parsePdf.parseUploadedPdf, {
          pdfStorageId: firstJob.storageId,
        })) as {
          pageData: unknown;
          fullText: string;
          pageCount: number;
          wordCount: number;
        };

        // FIX (1MiB limit): values over Convex's document cap are stored in
        // Blob Storage here (the action holds the bytes); the row keeps stubs
        // plus the refs. Small PDFs behave exactly as before.
        const pageDataStorageId = isOversized(parsed.pageData)
          ? await ctx.storage.store(
              new Blob([JSON.stringify(parsed.pageData)], { type: "application/json" })
            )
          : undefined;
        const fullTextStorageId = isOversized(parsed.fullText)
          ? await ctx.storage.store(
              new Blob([JSON.stringify(parsed.fullText)], { type: "application/json" })
            )
          : undefined;

        projectId = await ctx.runMutation(api.mutations.createProject, {
          sessionId: firstJob.tabSessionId,
          fileName: firstJob.fileName,
          pageCount: parsed.pageCount,
          wordCount: parsed.wordCount,
          pdfStorageId: firstJob.storageId,
          // FIX (1MiB limit): when offloaded, the row gets stubs — nothing
          // oversized crosses the mutation-argument boundary either.
          pageData: pageDataStorageId ? [] : parsed.pageData,
          fullText: fullTextStorageId ? "" : parsed.fullText,
          parsedPages: parsed.pageCount,
          status: "ready",
          pageDataStorageId: pageDataStorageId as string | undefined,
          fullTextStorageId: fullTextStorageId as string | undefined,
        });
        await ctx.runMutation(api.jobMutations.setProjectIdentity, {
          projectId,
          clientId: firstJob.clientId,
          tabSessionId: firstJob.tabSessionId,
          sessionId: firstJob.tabSessionId,
        });
        await ctx.runMutation(api.identity.attachProjectToUploadJob, {
          uploadJobId: args.uploadJobId,
          projectId,
        });
      }

      // ── Stage: parsed (extraction done — text lives server-side now) ──
      {
        const fresh = await getJob();
        const seq = fresh?.stageSeq ?? 0;
        const gate = await ctx.runMutation(api.identity.updateUploadJobStage, {
          uploadJobId: args.uploadJobId,
          stage: "parsed",
          expectedSeq: seq,
        });
        if (!gate.ok) return { ok: false, projectId };
      }

      // ── Stage: ready (handoff complete — browser may close any time) ──
      {
        const fresh = await getJob();
        const seq = fresh?.stageSeq ?? 0;
        const gate = await ctx.runMutation(api.identity.updateUploadJobStage, {
          uploadJobId: args.uploadJobId,
          stage: "ready",
          expectedSeq: seq,
        });
        if (!gate.ok) return { ok: false, projectId };
      }

      await heartbeat();

      // ── Stage: translating — hand off to the UNCHANGED production chain ──
      const project = await ctx.runQuery(api.queries.getProjectRaw, { projectId });
      if (!project) throw new Error("Project vanished during processing");
      if (project.status === "ready" || project.status === "parsed") {
        const langs =
          firstJob.langCodes && firstJob.langCodes.length > 0
            ? firstJob.langCodes
            : [
                "ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
                "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
              ];
        await ctx.runAction(api.translateContent.translateLanguage, {
          projectId,
          langCode: langs[0],
          marketContext: "standard",
          nextLangCode: langs.length > 1 ? langs[1] : undefined,
          remainingLangs: langs.length > 2 ? langs.slice(2) : undefined,
        });
      }

      return { ok: true, projectId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(api.identity.failUploadJob, {
        uploadJobId: args.uploadJobId,
        error: message,
      });
      if (projectId) {
        await ctx.runMutation(api.mutations.updateProject, {
          projectId,
          status: "error",
        });
      }
      throw err;
    }
  },
});
