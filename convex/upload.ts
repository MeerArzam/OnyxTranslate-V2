import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/upload.ts — PDF storage.
 *
 * Convex caps action arguments at 5MiB, so a base64 upload path could never
 * carry a large PDF. All file bytes flow through the Convex direct-upload
 * flow (generatePdfUploadUrl → browser POST → finalize) or the Phase 2 HTTP
 * actions — there is no base64 file-arg path anywhere in live code.
 *
 * This module runs on the V8 runtime because Convex only allows mutations
 * there.
 */

/** Step 1 of the direct-upload flow — mint a one-time upload URL. */
export const generatePdfUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 3 of the direct-upload flow — capture the storage id + size. */
export const finalizePdfUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const meta = await ctx.db.system.get(args.storageId);
    return {
      storageId: args.storageId,
      size: meta?.size ?? null,
      contentType: meta?.contentType ?? null,
    };
  },
});

// ══ PHASE 2: Path 2 finalize handshake ══
// The browser POSTed the raw file to Storage (storageId in hand). This mutation
// attaches it to the uploadJob, marks the pendingUpload uploaded, schedules the
// idempotent processUploadedPdf action, and returns the job id — the client's
// cue to show "Safe to close — server is working".

/** Step 3a: attach the uploaded bytes to the job (no scheduling yet). */
export const finalizeUploadedPdf = mutation({
  args: {
    uploadJobId: v.id("uploadJobs"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.uploadJobId);
    if (!job) throw new Error("Upload job not found");

    await ctx.db.patch(args.uploadJobId, {
      storageId: args.storageId,
      heartbeatAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Mark the pending staging row (if any) as uploaded.
    const pendings = await ctx.db
      .query("pendingUploads")
      .withIndex("by_client", (q) => q.eq("clientId", job.clientId))
      .collect();
    for (const p of pendings) {
      if (p.uploadJobId === args.uploadJobId && p.status === "staging") {
        await ctx.db.patch(p._id, { status: "uploaded", storageId: args.storageId });
      }
    }

    return { ok: true as const };
  },
});

/**
 * Step 3b: the explicit handoff — schedule processing and return the job id.
 * Split from finalizeUploadedPdf so a client that dies between 3a and 3b can
 * be recovered by the sweep without double-scheduling.
 */
export const beginProcessing = mutation({
  args: { uploadJobId: v.id("uploadJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.uploadJobId);
    if (!job) throw new Error("Upload job not found");
    if (job.status === "processing" || job.projectId) {
      // Already handed off (idempotent re-click).
      return { ok: true as const, alreadyScheduled: true as const };
    }
    await ctx.scheduler.runAfter(0, api.jobProcessing.processUploadedPdf, {
      uploadJobId: args.uploadJobId,
    });
    await ctx.db.patch(args.uploadJobId, {
      status: "processing",
      processStage: "processing",
      heartbeatAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true as const, alreadyScheduled: false as const };
  },
});
