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

    const results = [];
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "Reply with the single word: OK" }],
      max_tokens: 4,
    });

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
 * Temporary diagnostic — lists the NAMES of all env vars available to the
 * Convex server (never their values), to see what the platform injects.
 */
export const listEnvVarNames = action({
  args: {},
  handler: async () => {
    return {
      names: Object.keys(process.env).sort().filter((n) =>
        /VLY|CONVEX|DEEPSEEK|OPENAI|TOKEN|KEY|API|DEPLOY/i.test(n)
      ),
    };
  },
});
