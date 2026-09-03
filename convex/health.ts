"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";

export const checkVlyKey = action({
  args: {},
  handler: async () => {
    const key = process.env.VLY_INTEGRATION_KEY;
    return {
      hasKey: !!key,
      keyPrefix: (key || "").slice(0, 5),
      length: (key || "").length,
    };
  },
});

/**
 * Temporary diagnostic — probes the VLY gateway with the real server key
 * and returns the exact HTTP status + response body. The key itself is
 * never returned.
 */export const probeVly = action({
  args: {},
  handler: async () => {
    const key = process.env.VLY_INTEGRATION_KEY;
    if (!key) return { hasKey: false };

    const envBase = (process.env.VLY_INTEGRATION_BASE_URL || "").replace(/\/$/, "");
    const candidates = [
      envBase,
      "https://integrations.freebuff.com",
      "https://integrations.vly.ai",
    ].filter((u, i, arr) => u && arr.indexOf(u) === i);

    const body = JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      max_tokens: 4,
    });

    const results: Array<{
      baseUrl: string;
      status: number | string;
      statusText?: string;
      body?: string;
      error?: string;
    }> = [];

    for (const base of candidates) {
      const url = `${base}/v1/llm/chat/completions`;
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body,
        });
        const text = await resp.text();
        results.push({
          baseUrl: url,
          status: resp.status,
          statusText: resp.statusText,
          body: text.slice(0, 400),
        });
      } catch (e) {
        results.push({
          baseUrl: url,
          status: "fetch-error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { envBase, results };
  },
});

/**
 * Temporary diagnostic — 1-shot probe of the SambaNova gateway.
 */
export const probeSambaNova = action({
  args: {},
  handler: async () => {
    const key = process.env.SAMBANOVA_API_KEY;
    if (!key) return { hasKey: false };
    try {
      const resp = await fetch("https://api.sambanova.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: process.env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct",
          messages: [{ role: "user", content: "Reply OK" }],
          max_tokens: 5,
        }),
      });
      const text = await resp.text();
      return {
        hasKey: true,
        keyPrefix: key.slice(0, 7),
        status: resp.status,
        body: text.slice(0, 600),
      };
    } catch (e) {
      return { hasKey: true, status: "fetch-error", error: e instanceof Error ? e.message : String(e) };
    }
  },
});

/**
 * Temporary diagnostic — 1-shot probe of the OpenRouter gateway with the
 * server-side OPENROUTER_API_KEY. Returns HTTP status + body only; the key
 * is never returned.
 */
export const probeOpenRouter = action({
  args: { model: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return { hasKey: false };
    const body = JSON.stringify({
      model: args.model ?? "deepseek/deepseek-v4-flash-latest",
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      max_tokens: 5,
    });
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body,
      });
      const text = await resp.text();
      return {
        hasKey: true,
        keyPrefix: key.slice(0, 6),
        keyLength: key.length,
        status: resp.status,
        statusText: resp.statusText,
        body: text.slice(0, 600),
      };
    } catch (e) {
      return {
        hasKey: true,
        status: "fetch-error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },
});

/**
 * Temporary diagnostic — lists the NAMES of all env vars available to the
 * Convex server (never their values), to see what the platform injects.
 */
export const listEnvVarNames = action({
  args: {},
  handler: async () => {
    return {
      names: Object.keys(process.env).sort().filter((n) =>
        /VLY|CONVEX|DEEPSEEK|OPENAI|TOKEN|KEY|API|DEPLOY|GEMINI/i.test(n)
      ),
    };
  },
});

/**
 * Temporary diagnostic — probes all 5 Gemini API keys and returns status for each.
 * The keys themselves are never returned, only their prefix and status.
 */
export const probeGeminiKeys = action({
  args: {},
  handler: async () => {
    const keyNames = [
      "Gemini_API_Key_1",
      "Gemini_API_Key_2",
      "Gemini_API_Key_3",
      "Gemini_API_Key_4",
      "Gemini_API_Key_5",
    ];
    const results: Array<{
      key: string;
      keyPrefix?: string;
      status: number | string;
      body?: string;
      error?: string;
    }> = [];
    
    for (const keyName of keyNames) {
      const key = process.env[keyName];
      if (!key) {
        results.push({ key: keyName, status: "missing", error: "Env var not set" });
        continue;
      }
      
      try {
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
              messages: [{ role: "user", content: "Reply OK" }],
              max_tokens: 5,
            }),
          }
        );
        const text = await res.text();
        results.push({
          key: keyName,
          keyPrefix: key.slice(0, 8),
          status: res.status,
          body: text.slice(0, 200),
        });
      } catch (e) {
        results.push({
          key: keyName,
          status: "fetch-error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    
    return {
      model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
      results,
    };
  },
});
