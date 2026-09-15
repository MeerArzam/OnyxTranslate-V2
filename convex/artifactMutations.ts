import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { EXPORT_KIND } from "./exportProject";

/**
 * convex/artifactMutations.ts — PHASE 2: idempotent export-artifact upsert.
 * (Actions cannot touch ctx.db directly, so the export action routes here.)
 */
export const upsertExportArtifact = mutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    kind: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("exportArtifacts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const row of existing) {
      if (row.kind === args.kind) {
        await ctx.db.patch(row._id, {
          storageId: args.storageId,
          sizeBytes: args.sizeBytes,
          createdAt: Date.now(),
        });
        return { artifactId: row._id, replaced: true as const };
      }
    }
    const artifactId = await ctx.db.insert("exportArtifacts", {
      projectId: args.projectId,
      storageId: args.storageId,
      kind: args.kind,
      sizeBytes: args.sizeBytes,
      createdAt: Date.now(),
    });
    return { artifactId, replaced: false as const };
  },
});

/**
 * PHASE 3 client-path fix: the export token — projectId bound to its artifact's
 * storageId, single-use-safe (read-only, short TTL). The download httpAction
 * uses it to serve the JSON with a Content-Disposition filename; browsers honor
 * that on cross-origin URLs (the plain anchor+download attribute is ignored).
 */
export const issueExportToken = mutation({
  args: { projectId: v.id("projects"), fileName: v.string() },
  handler: async (ctx, args) => {
    const artifacts = await ctx.db
      .query("exportArtifacts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const artifact = artifacts.find((a) => a.kind === EXPORT_KIND);
    if (!artifact) throw new Error("No export artifact for this project yet");
    const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const ttlMs = 10 * 60 * 1000;
    await ctx.db.insert("exportTokens", {
      token,
      projectId: args.projectId,
      storageId: artifact.storageId,
      fileName: args.fileName,
      expiresAt: Date.now() + ttlMs,
    });
    return { token };
  },
});

/** Used by the download httpAction to resolve + lazily expire tokens. */
export const consumeExportToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("exportTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!row) return null;
    if (row.expiresAt < Date.now()) return null;
    return row;
  },
});
