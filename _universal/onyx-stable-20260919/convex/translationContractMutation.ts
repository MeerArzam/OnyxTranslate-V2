// NO "use node": pure DB mutation (V8 runtime), imported by adaptiveJobs.
//
// Thin Motherboard Migration Phase 2 — THE one chunk-result upsert.
//
// Principle: Code asks. Gemini thinks. Code verifies.
//
// legacy_postprocess mode: identical to the pre-migration behavior — the
// translated text is the post-processed prose produced by the legacy path
// (the full assembly sweep in flushJobResults stays authoritative there).
//
// gemini_contract mode: the validator (convex/translationContract.ts) has
// ALREADY accepted this text. The saved prose is Gemini's output verbatim —
// code must not rewrite, re-punctuate, re-wrap, or "repair" it. Language
// assembly therefore performs PURE concatenation for contract chunks, while
// legacy chunks keep the legacy boundary-repair + artifact-sweep assembly.
// (For chunks produced before the migration, contract mode still reads the
// legacy-saved prose unchanged — no migration of stored text.)

import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type UpsertArgs = {
  projectId: Id<"projects">;
  langCode: string;
  chunkIndex: number;
  sourceText: string;
  translatedText: string;
  model: string;
  /** Thin Motherboard Phase 3: stamp the producing contract on the chunk. */
  intelMode?: string;
};

/**
 * Write one chunk result into the chunks table (patch-or-insert).
 * Pure persistence — no linguistic transformation, ever.
 */
export async function upsertTranslationResult(
  ctx: MutationCtx,
  args: UpsertArgs,
): Promise<Id<"chunks">> {
  const existing = await ctx.db
    .query("chunks")
    .withIndex("by_project_lang", (q) =>
      q
        .eq("projectId", args.projectId)
        .eq("langCode", args.langCode)
        .eq("chunkIndex", args.chunkIndex),
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      translatedText: args.translatedText,
      status: "done",
      model: args.model,
      ...(args.intelMode ? { translationIntelligenceMode: args.intelMode } : {}),
    });
    return existing._id;
  }
  return ctx.db.insert("chunks", {
    projectId: args.projectId,
    langCode: args.langCode,
    chunkIndex: args.chunkIndex,
    sourceText: args.sourceText,
    translatedText: args.translatedText,
    status: "done",
    model: args.model,
    ...(args.intelMode ? { translationIntelligenceMode: args.intelMode } : {}),
  });
}

/**
 * Contract-mode language assembly: pure ordered concatenation.
 * Gemini guaranteed complete sentences and paragraph structure via the
 * response contract (selfCheck + validators); code joins with blank lines,
 * collapsing empties. No rewriting — ever.
 */
export function assembleContractChunks(texts: string[]): string {
  return texts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join("\n\n");
}
