/**
 * FIX (1MiB document limit): resolver for projects whose pageData/fullText
 * were offloaded to Blob Storage. Callers that find empty inline values with a
 * storage ref present use this to fetch the real data — every other code path
 * is untouched.
 */
import { v } from "convex/values";
import { action, query } from "./_generated/server";
import { api } from "./_generated/api";

// FIX (1MiB document limit): shared threshold + size check. Values at or below
// the limit keep the exact pre-fix inline behavior; anything larger is stored
// in Blob Storage by the action that already holds the bytes.
export const DOC_VALUE_LIMIT_BYTES = 384 * 1024;

export function isOversized(value: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength > DOC_VALUE_LIMIT_BYTES;
}

/** Resolve the full source data for a project (works for any caller with the id). */
export const resolveSourceData = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(api.queries.getProjectRaw, { projectId: args.projectId });
    if (!project) throw new Error("Project not found");

    let fullText = (project.fullText ?? "") as string;
    let pageData = (project.pageData ?? []) as unknown[];

    if (!fullText && project.fullTextStorageId) {
      const blob = await ctx.storage.get(project.fullTextStorageId);
      if (blob) fullText = (JSON.parse(await blob.text()) as string) ?? "";
    }
    if (Array.isArray(pageData) && pageData.length === 0 && project.pageDataStorageId) {
      const blob = await ctx.storage.get(project.pageDataStorageId);
      if (blob) pageData = (JSON.parse(await blob.text()) as unknown[]) ?? [];
    }

    return { fullText, pageData };
  },
});

/** Short-lived download URLs so browsers can fetch offloaded values directly. */
export const getSourceDataUrls = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    return {
      fullTextUrl: project.fullTextStorageId
        ? await ctx.storage.getUrl(project.fullTextStorageId)
        : null,
      pageDataUrl: project.pageDataStorageId
        ? await ctx.storage.getUrl(project.pageDataStorageId)
        : null,
      fullTextStorageId: project.fullTextStorageId ?? null,
      pageDataStorageId: project.pageDataStorageId ?? null,
    };
  },
});
