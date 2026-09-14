import { v } from "convex/values";
import { mutation } from "./_generated/server";

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
