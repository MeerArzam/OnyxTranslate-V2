import { v } from "convex/values";
import { action, mutation } from "./_generated/server";

/**
 * convex/upload.ts — PDF storage.
 *
 * FIX 2 (regression pass): Convex caps action arguments at 5MiB, so the old
 * storePdf(pdfBase64) path silently failed for any PDF larger than ~3.7MB —
 * which is incompatible with the "no file limits" requirement. Added the
 * standard Convex direct-upload flow: the browser POSTs the file straight to
 * Storage via a generated upload URL (no argument cap). storePdf is kept for
 * backward compatibility with existing import/tests paths.
 *
 * This module runs on the V8 runtime because Convex only allows mutations
 * there; storePdf decodes base64 via atob instead of Buffer accordingly.
 */
export const storePdf = action({
  args: {
    fileName: v.string(),
    pdfBase64: v.string(),
  },
  handler: async (ctx, args) => {
    const binary = atob(args.pdfBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);
    return { storageId };
  },
});

/** FIX 2: step 1 of the direct-upload flow — mint a one-time upload URL. */
export const generatePdfUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/** FIX 2: step 3 of the direct-upload flow — capture the storage id + size. */
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
