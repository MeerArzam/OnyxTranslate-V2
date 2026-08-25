"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * convex/upload.ts — Stores the original PDF in Convex File Storage.
 * Returns the storageId so the client can create the project record via mutation.
 */
export const storePdf = action({
  args: {
    fileName: v.string(),
    pdfBase64: v.string(),
  },
  handler: async (ctx, args) => {
    const pdfBuffer = Buffer.from(args.pdfBase64, "base64");
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    const storageId = await ctx.storage.store(blob);
    return { storageId };
  },
});
