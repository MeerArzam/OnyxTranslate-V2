import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/identity.ts — PHASE 2 identity scheme.
 *
 * - localStorage `onyx-client-id`       = durable per-device UUID → projects.clientId
 * - sessionStorage `onyx-tab-session-id` = per-tab UUID           → projects.tabSessionId
 *
 * Live "current work" queries stay filtered by clientId + tabSessionId (two
 * tabs never see each other's in-flight job — the C1 rule). On reopen in a NEW
 * tab, getResumableJobs shows the device's own past/active jobs; adoptJob
 * rebinds the job to this tab. Jobs from OTHER devices are never returned.
 */

// ─── Queries ────────────────────────────────────────────────────────────────

/** All projects this DEVICE has ever created (newest first). Never other devices'. */
export const getResumableJobs = query({
  args: { clientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(Math.min(args.limit ?? 20, 50));
  },
});

/** Upload jobs for this device — powers the upload progress card. */
export const getUploadJobs = query({
  args: { clientId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("uploadJobs")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(Math.min(args.limit ?? 5, 20));
  },
});

/** PHASE 2: idempotency lookup — Path 1 double-submits return the same job. */
export const getUploadJobByIdempotencyKey = query({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("uploadJobs")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
  },
});

/** PHASE 2: create the uploadJob row (Path 1 and Path 2 both start here). */
export const createUploadJob = mutation({
  args: {
    clientId: v.string(),
    tabSessionId: v.optional(v.string()),
    fileName: v.string(),
    fileSize: v.number(),
    storageId: v.optional(v.id("_storage")),
    idempotencyKey: v.optional(v.string()),
    langCodes: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("uploadJobs")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey!))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("uploadJobs", {
      clientId: args.clientId,
      tabSessionId: args.tabSessionId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      storageId: args.storageId,
      idempotencyKey: args.idempotencyKey,
      langCodes: args.langCodes,
      status: "uploaded",
      stageSeq: 0,
      heartbeatAt: Date.now(),
      createdAt: args.createdAt,
      updatedAt: args.updatedAt,
    });
  },
});

/** PHASE 2: link the created project back onto its uploadJob (idempotent). */
export const attachProjectToUploadJob = mutation({
  args: { uploadJobId: v.id("uploadJobs"), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.uploadJobId);
    if (!job) return;
    if (job.projectId === args.projectId) return;
    await ctx.db.patch(args.uploadJobId, { projectId: args.projectId });
  },
});

/**
 * PHASE 2 Path 2, step 1: create the uploadJob + pendingUpload staging row and
 * mint the Storage upload URL — all BEFORE the browser POSTs a single byte.
 */
export const createPendingUploadWithPath = mutation({
  args: {
    clientId: v.string(),
    tabSessionId: v.optional(v.string()),
    fileName: v.string(),
    fileSize: v.number(),
    langCodes: v.optional(v.array(v.string())),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotency: a retry of the same staging record reuses its uploadJob.
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("uploadJobs")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey!))
        .first();
      if (existing) {
        if (existing.status === "uploaded") {
          const url = await ctx.storage.generateUploadUrl();
          return { uploadJobId: existing._id, uploadUrl: url, reused: true as const };
        }
        return { uploadJobId: existing._id, uploadUrl: "", reused: true as const };
      }
    }
    const now = Date.now();
    const uploadJobId = await ctx.db.insert("uploadJobs", {
      clientId: args.clientId,
      tabSessionId: args.tabSessionId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      langCodes: args.langCodes,
      idempotencyKey: args.idempotencyKey,
      status: "uploaded",
      stageSeq: 0,
      heartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("pendingUploads", {
      clientId: args.clientId,
      tabSessionId: args.tabSessionId,
      uploadJobId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      langCodes: args.langCodes,
      status: "staging",
      createdAt: now,
    });
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { uploadJobId, uploadUrl, reused: false as const };
  },
});

/** Live upload-job card, scoped to this tab (used while a POST is in flight). */
export const getUploadJob = query({
  args: { uploadJobId: v.id("uploadJobs"), clientId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.uploadJobId);
    if (!job || job.clientId !== args.clientId) return null;
    return job;
  },
});

/**
 * Staging records for interrupted Path-2 uploads on THIS device.
 * The client offers "Resume upload" (re-pick file) or "Discard".
 */
export const getPendingUploads = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("pendingUploads")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .order("desc")
      .take(10);
    return rows.filter((r) => r.status === "staging");
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Adopt a job from a previous tab/session: rebind the project to this tab.
 * Ownership is still checked (only the owning device may adopt its own job).
 */
export const adoptJob = mutation({
  args: {
    projectId: v.id("projects"),
    clientId: v.string(),
    tabSessionId: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    if (project.clientId && project.clientId !== args.clientId) {
      throw new Error("Not your job");
    }
    await ctx.db.patch(args.projectId, {
      tabSessionId: args.tabSessionId,
      sessionId: args.sessionId,
    });
    return { ok: true as const, projectId: args.projectId };
  },
});

/**
 * Stage-transition helper used by the processing action. Guarded by stageSeq
 * so an outdated scheduled run (already superseded by a retry) cannot regress
 * a job's status — this is what makes retries safe.
 */
export const updateUploadJobStage = mutation({
  args: {
    uploadJobId: v.id("uploadJobs"),
    stage: v.string(),
    expectedSeq: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.uploadJobId);
    if (!job) return { ok: false as const, reason: "not_found" };
    if ((job.stageSeq ?? 0) !== args.expectedSeq) {
      return { ok: false as const, reason: "stale_run" };
    }
    await ctx.db.patch(args.uploadJobId, {
      status: args.stage,
      processStage: args.stage,
      stageSeq: args.expectedSeq + 1,
      heartbeatAt: Date.now(),
      updatedAt: Date.now(),
      ...(args.error !== undefined ? { error: args.error } : {}),
    });
    return { ok: true as const };
  },
});

/** Heartbeat: keep the job visibly alive during long stages. */
export const heartbeatUploadJob = mutation({
  args: { uploadJobId: v.id("uploadJobs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.uploadJobId, { heartbeatAt: Date.now(), updatedAt: Date.now() });
  },
});

/** Failure path: persist the real error (never swallowed). */
export const failUploadJob = mutation({
  args: {
    uploadJobId: v.id("uploadJobs"),
    error: v.string(),
    expectedSeq: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.uploadJobId);
    if (!job) return;
    if (args.expectedSeq !== undefined && (job.stageSeq ?? 0) !== args.expectedSeq) return;
    if (job.status === "cancelled") return;
    await ctx.db.patch(args.uploadJobId, {
      status: "error",
      error: args.error,
      heartbeatAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const cancelUploadJob = mutation({
  args: { uploadJobId: v.id("uploadJobs"), clientId: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.uploadJobId);
    if (!job || job.clientId !== args.clientId) return { ok: false as const };
    if (job.projectId) {
      await ctx.runMutation(api.mutations.updateProject, {
        projectId: job.projectId,
        status: "cancelled",
      });
    }
    await ctx.db.patch(args.uploadJobId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/** Create a Path-2 staging record BEFORE the big POST. */
export const createPendingUpload = mutation({
  args: {
    clientId: v.string(),
    tabSessionId: v.optional(v.string()),
    uploadJobId: v.id("uploadJobs"),
    fileName: v.string(),
    fileSize: v.number(),
    langCodes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("pendingUploads", {
      clientId: args.clientId,
      tabSessionId: args.tabSessionId,
      uploadJobId: args.uploadJobId,
      fileName: args.fileName,
      fileSize: args.fileSize,
      langCodes: args.langCodes,
      status: "staging",
      createdAt: Date.now(),
    });
    return { pendingUploadId: id };
  },
});

export const discardPendingUpload = mutation({
  args: { pendingUploadId: v.id("pendingUploads"), clientId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.pendingUploadId);
    if (!row || row.clientId !== args.clientId) return { ok: false as const };
    await ctx.db.patch(args.pendingUploadId, { status: "abandoned" });
    await ctx.db.patch(row.uploadJobId, { status: "cancelled", updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/**
 * Housekeeping: sweep stale rows.
 * - pendingUploads stuck "staging" > 24h → abandoned (orphan sweep per spec)
 * - uploadJobs with no heartbeat for 24h and no project → error'd out
 * Scheduled hourly by convex/crons.ts.
 */
export const sweepStaleUploads = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let pendingSwept = 0;
    let jobsSwept = 0;

    const pendings = await ctx.db
      .query("pendingUploads")
      .withIndex("by_status", (q) => q.eq("status", "staging"))
      .collect();
    for (const p of pendings) {
      if (now - p.createdAt > DAY) {
        await ctx.db.patch(p._id, { status: "abandoned" });
        pendingSwept++;
      }
    }

    const jobs = await ctx.db
      .query("uploadJobs")
      .withIndex("by_status", (q) => q.eq("status", "uploaded"))
      .collect();
    for (const j of jobs) {
      if (!j.projectId && now - (j.heartbeatAt ?? j.createdAt) > DAY) {
        await ctx.db.patch(j._id, {
          status: "error",
          error: "Upload never completed (24h timeout)",
          updatedAt: now,
        });
        jobsSwept++;
      }
    }
    return { pendingSwept, jobsSwept };
  },
});
