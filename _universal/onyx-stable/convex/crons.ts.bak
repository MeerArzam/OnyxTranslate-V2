import { cronJobs } from "convex/server";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const crons = cronJobs();

// Watchdog: check for stalled projects every 15 minutes
crons.interval(
  "watchdog-restart-stalled",
  { minutes: 15 },
  internal.crons.checkStalledProjects,
);

/**
 * CRITICAL FIX 4: Pipeline Watchdog
 * Finds projects stuck in "translating" status for > 30 minutes
 * with no recent chunk completions, and restarts the queue.
 */
interface WatchdogProject {
  _id: Id<"projects">;
  status: string;
  createdAt: number;
}

export const checkStalledProjects = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; restarted: number }> => {
    const allProjects: WatchdogProject[] = await ctx.runQuery(
      api.queries.getAllProjectsForWatchdog,
    );

    const now = Date.now();
    const STALL_THRESHOLD = 30 * 60 * 1000;
    let restarted = 0;

    for (const project of allProjects) {
      if (project.status !== "translating") continue;
      const elapsed = now - project.createdAt;
      if (elapsed < STALL_THRESHOLD) continue;

      const translations: Array<{ status: string; langCode: string }> = await ctx.runQuery(
        api.queries.getTranslationsRaw,
        { projectId: project._id },
      );

      const inProgress = translations.find(
        (t) => t.status === "in_progress" || t.status === "pending",
      );

      if (inProgress) {
        const chunks: Array<{ status: string; chunkIndex: number }> = await ctx.runQuery(api.queries.getChunksForLang, {
          projectId: project._id,
          langCode: inProgress.langCode,
        });

        const pendingChunk = chunks.find((c) => c.status === "pending");

        if (pendingChunk) {
          console.log(
            `[WATCHDOG] Restarting stalled project ${project._id} at chunk ${pendingChunk.chunkIndex} for ${inProgress.langCode}`,
          );
          await ctx.scheduler.runAfter(0, api.translateQueue.processLanguage, {
            projectId: project._id,
            langCode: inProgress.langCode,
            chunkIndex: pendingChunk.chunkIndex,
          });
          restarted++;
        }
      }
    }

    return { checked: allProjects.length, restarted };
  },
});

export default crons;
