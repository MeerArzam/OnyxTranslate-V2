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
  ): Promise<{ success: boolean; projectId: Id<"projects"> }> => {
    let data: {
      type: string;
      version: number;
      project: {
        fileName: string;
        pageCount: number;
        wordCount: number;
        fullText: string;
      };
      translations: Array<{
        langCode: string;
        totalChunks: number;
        completedChunks: number;
        mergedText?: string;
        status: string;
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

    // Create project
    const projectId: Id<"projects"> = await ctx.runMutation(
      api.mutations.createProject,
      {
        sessionId: args.sessionId,
        fileName: data.project.fileName,
        pageCount: data.project.pageCount,
        wordCount: data.project.wordCount,
        pageData: [],
        fullText: data.project.fullText,
        parsedPages: data.project.pageCount,
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

    return { success: true, projectId };
  },
});
