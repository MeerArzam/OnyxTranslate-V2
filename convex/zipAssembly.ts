"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import JSZip from "jszip";

/**
 * convex/zipAssembly.ts — Builds a ZIP of all translated PDFs.
 *
 * Runs after the LAST language's PDF is generated. Reads all translation
 * records with a pdfStorageId, downloads each PDF from Convex Storage,
 * bundles them into a ZIP with a summary report, stores the ZIP in
 * Convex Storage, and updates the project record.
 */

export const buildZip = action({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(api.queries.getProject, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");

    const translations = await ctx.runQuery(api.queries.getProjectTranslations, {
      projectId: args.projectId,
    });

    const zip = new JSZip();

    // Add each translated PDF
    let pdfCount = 0;
    for (const t of translations) {
      if (t.status === "complete" && t.pdfStorageId) {
        const blob = await ctx.storage.get(t.pdfStorageId);
        if (blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          zip.file(`${t.langCode}_translated.pdf`, bytes);
          pdfCount++;
        }
      }
    }

    // Add summary report
    const report = [
      "Onyx Translate — Batch Report",
      "=".repeat(40),
      `Generated: ${new Date().toISOString()}`,
      `Source: ${project.fileName}`,
      `Pages: ${project.pageCount}`,
      `Words: ${project.wordCount.toLocaleString()}`,
      `Languages: ${translations.length}`,
      `PDFs included: ${pdfCount}`,
      "",
      "Language Status:",
      ...translations.map(
        (t) =>
          `  ${t.langCode.toUpperCase()}: ${t.status} (${t.completedChunks}/${t.totalChunks} chunks)`,
      ),
    ].join("\n");
    zip.file("translation_report.txt", report);

    // Generate ZIP and store in Convex Storage
    const zipBytes = await zip.generateAsync({ type: "uint8array" });
    const zipBlob = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });
    const storageId = await ctx.storage.store(zipBlob);
    const url = (await ctx.storage.getUrl(storageId)) ?? undefined;

    // Update project with ZIP info
    await ctx.runMutation(api.mutations.updateProject, {
      projectId: args.projectId,
      zipStorageId: storageId,
      zipUrl: url,
      status: "complete",
    });

    return { ok: true, url, pdfCount };
  },
});
