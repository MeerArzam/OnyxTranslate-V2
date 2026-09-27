import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

/**
 * convex/probes.ts — on-demand verification entry points (P2 evidence).
 * Runs a single watchdog tick and returns its raw report.
 */
export const runWatchdogOnce = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    return await ctx.runAction(api.adaptiveWatchdog.watchdogTick, {});
  },
});

/** T1/T3 diagnostic: one real Gemini round-trip, raw status + body sample (never logs the key). */
export const runGeminiProbe = action({
  args: { model: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.forensicProbe.probeGeminiOnce, { model: args.model });
  },
});

//** Dispatcher-shaped probe: variable prompt size + max_tokens to test quota-reservation behavior. */
export const probeShapedRequest = action({
  args: {
    model: v.optional(v.string()),
    promptChars: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const key = process.env.Gemini_API_Key_1;
    if (!key) return { ok: false, reason: "no key" };
    const model = args.model || "gemini-3.5-flash";
    const promptChars = args.promptChars ?? 2000;
    const filler = "Translate this sample text to Urdu and keep paragraph breaks: ".repeat(
      Math.ceil(promptChars / 62),
    ).slice(0, promptChars);
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a translator." },
            { role: "user", content: filler },
          ],
          max_tokens: args.maxTokens ?? 4000,
        }),
      },
    );
    const body = (await resp.text()).slice(0, 250);
    return { httpStatus: resp.status, model, promptChars, maxTokens: args.maxTokens ?? 4000, body };
  },
});

/** Reveal the deployment's GEMINI_MODEL env value (model NAME only, no secrets). */
export const probeModelEnv = action({
  args: {},
  returns: v.any(),
  handler: async () => {
    return { geminiModelEnv: process.env.GEMINI_MODEL ?? null };
  },
});

/** Direct-call the pasted-text PDF renderer so its errors surface synchronously (scheduled action died silently). */
export const runTextPdfDirect = action({
  args: { projectId: v.id("projects"), langCode: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const trans = (await ctx.runQuery(api.queries.getTranslationsRaw, {
      projectId: args.projectId,
    })) as Array<{ langCode: string; _id: string }>;
    const row = trans.find((t) => t.langCode === args.langCode);
    if (!row) return { error: "no_translation_row" };
    return await ctx.runAction(api.textPdf.generateTextPdf, {
      projectId: args.projectId,
      translationId: row._id as never,
      langCode: args.langCode,
    } as never);
  },
});

/** Probe all 5 keys; 429 bodies reveal retryDelay/limit semantics (no quota cost). */
export const runAllKeysProbe = action({
  args: { model: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.runAction(api.forensicProbe.probeAllKeys, { model: args.model });
  },
});
