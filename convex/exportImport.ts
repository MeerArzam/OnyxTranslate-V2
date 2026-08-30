"use node";

/**
 * convex/exportImport.ts — Export and import translation progress as JSON.
 *
 * CRITICAL FIX 5: Restores the import/export feature lost during the
 * client-side → server-side migration. Users can now backup all their
 * projects and translations, then restore from a JSON file.
 */

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ─── Export ────────────────────────────────────────────────────────────────

export const exportProgress = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all projects for this session
    const projects = await ctx.runQuery(api.queries.getAllProjectsForWatchdog);
    const sessionProjects = projects.filter(
      (p: { sessionId?: string }) => p.sessionId === args.sessionId,
    );

    const exportData: Array<{
      project: Record<string, unknown>;
      translations: Array<Record<string, unknown>>;
      chunks: Array<Record<string, unknown>>;
    }> = [];

    for (const project of sessionProjects) {
      // Get translations for this project
      const translations = await ctx.runQuery(api.queries.getTranslationsRaw, {
        projectId: project._id,
      });

      // Get chunks for all languages
      const allChunks: Array<Record<string, unknown>> = [];
      for (const t of translations) {
        const chunks = await ctx.runQuery(api.queries.getChunksForLang, {
          projectId: project._id,
          langCode: t.langCode,
        });
        allChunks.push(
          ...chunks.map((c: { chunkIndex: number; langCode: string; sourceText: string; translatedText?: string; status: string; model?: string }) => ({
            chunkIndex: c.chunkIndex,
            langCode: c.langCode,
            sourceText: c.sourceText,
            translatedText: c.translatedText,
            status: c.status,
            model: c.model,
          })),
        );
      }

      exportData.push({
        project: {
          fileName: project.fileName,
          pageCount: project.pageCount,
          wordCount: project.wordCount,
          fullText: project.fullText,
          status: project.status,
        },
        translations: translations.map((t: { langCode: string; status: string; totalChunks: number; completedChunks: number; mergedText?: string }) => ({
          langCode: t.langCode,
          status: t.status,
          totalChunks: t.totalChunks,
          completedChunks: t.completedChunks,
          mergedText: t.mergedText,
        })),
        chunks: allChunks,
      });
    }

    return JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        sessionId: args.sessionId,
        projects: exportData,
      },
      null,
      2,
    );
  },
});

// ─── Import ────────────────────────────────────────────────────────────────

export const importProgress = action({
  args: {
    sessionId: v.string(),
    data: v.string(),
  },
  handler: async (ctx, args) => {
    const importData = JSON.parse(args.data);
    if (!importData.projects || !Array.isArray(importData.projects)) {
      throw new Error("Invalid import file format");
    }

    let projectsImported = 0;
    let chunksImported = 0;

    for (const item of importData.projects) {
      // Create project record
      const projectId: Id<"projects"> = await ctx.runMutation(
        api.mutations.createProject,
        {
          sessionId: args.sessionId,
          fileName: item.project.fileName,
          pageCount: item.project.pageCount,
          wordCount: item.project.wordCount,
          pageData: [],
          fullText: item.project.fullText,
          parsedPages: item.project.pageCount,
          status: item.project.status,
        },
      );

      projectsImported++;

      // Create translation records
      for (const t of item.translations) {
        const translationId = await ctx.runMutation(
          api.mutations.upsertTranslation,
          {
            projectId,
            langCode: t.langCode,
            totalChunks: t.totalChunks,
          },
        );

        // Update with additional fields
        await ctx.runMutation(api.mutations.updateTranslation, {
          translationId,
          status: t.status,
          completedChunks: t.completedChunks,
          mergedText: t.mergedText,
        });
      }

      // Create chunk records
      for (const c of item.chunks) {
        const chunkId = await ctx.runMutation(api.mutations.upsertChunk, {
          projectId,
          langCode: c.langCode,
          chunkIndex: c.chunkIndex,
          sourceText: c.sourceText,
        });

        if (c.translatedText) {
          await ctx.runMutation(api.mutations.updateChunk, {
            chunkId,
            translatedText: c.translatedText,
            status: c.status,
            model: c.model,
          });
        }

        chunksImported++;
      }
    }

    return {
      imported: true,
      projectsCount: projectsImported,
      chunksCount: chunksImported,
    };
  },
});
