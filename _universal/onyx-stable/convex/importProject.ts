"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const importProject = action({
  args: {
    sessionId: v.string(),
    exportJson: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: boolean; projectId: Id<"projects">; importedLangCodes: string[]; fileName: string }> => {
    let data: {
      type: string;
      version: number;
      project: {
        fileName: string;
        pageCount: number;
        wordCount: number;
        fullText: string;
        parsedPages?: number;
        pageData?: unknown[];
      };
      translations: Array<{
        langCode: string;
        totalChunks: number;
        completedChunks: number;
        mergedText?: string;
        status: string;
        pdfUrl?: string;
      }>;
    };

    try {
      data = JSON.parse(args.exportJson);
    } catch {
      throw new Error("Invalid JSON file");
    }

    if (data.type !== "onyx-translate-project" || data.version !== 1) {
      throw new Error(
        "Invalid export file format — expected Onyx Translate JSON export"
      );
    }
    if (!data.project || !Array.isArray(data.translations)) {
      throw new Error(
        "Invalid export file structure — missing project or translations"
      );
    }

    // Create project — restore pageData/parsedPages so PDF regeneration
    // coordinates survive an import round-trip (FIX 6).
    const projectId: Id<"projects"> = await ctx.runMutation(
      api.mutations.createProject,
      {
        sessionId: args.sessionId,
        fileName: data.project.fileName,
        pageCount: data.project.pageCount,
        wordCount: data.project.wordCount,
        pageData: (data.project.pageData ?? []) as object[],
        fullText: data.project.fullText,
        parsedPages: data.project.parsedPages ?? data.project.pageCount,
        status: "ready",
      }
    );

    // Create translation records for each language
    for (const t of data.translations) {
      await ctx.runMutation(api.mutations.upsertTranslation, {
        projectId,
        langCode: t.langCode,
        totalChunks: t.totalChunks || 1,
        status: t.status === "complete" ? "complete" : "pending",
        completedChunks: t.completedChunks || 0,
        mergedText: t.mergedText || "",
      });
    }

    return {
      success: true,
      projectId,
      importedLangCodes: data.translations?.map((t) => t.langCode) || [],
      fileName: data.project.fileName,
    };
  },
});
