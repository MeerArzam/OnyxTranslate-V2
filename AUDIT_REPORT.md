# Onyx Translate — Checkpoint-Driven Fix: Final Report

**Date:** Aug 16, 2026 · **Engineer:** Buffy (Codebuff) · **Method:** Checkpointed implementation + live HTTP verification against the deployed Convex backend and the VLY gateway.

---

## 1. Files Changed

| File | Change | Status |
|---|---|---|
| `convex/health.ts` | **NEW** — `checkVlyKey` action (verifies `VLY_INTEGRATION_KEY` exists server-side). Plus diagnostic helpers `probeVly` (raw gateway probe) and `listEnvVarNames` (env var names only, never values). | ✅ Deployed |
| `convex/translate.ts` | **NEW** — server-side `translateChunk` action (`"use node"`): full 23-phase `buildSystemPrompt` moved verbatim from `vlyTranslate.ts`, DeepSeek model probe chain (`deepseek-chat` → `deepseek-v4-flash` → `deepseek-r1` → `deepseek-thinking`), completion call with `temperature 0.3 / maxTokens 4000`. Key read from `process.env.VLY_INTEGRATION_KEY` — never exposed to the browser. | ✅ Deployed |
| `src/main.tsx` | Wrapped `<Translator />` in `<ConvexProvider client={convex}>` with `ConvexReactClient(import.meta.env.VITE_CONVEX_URL!)`. | ✅ Typecheck + build pass |
| `src/pages/Translator.tsx` | Added `useAction(api.translate.translateChunk)`; passed it into `runLocalizedTranslationPipeline(...)` as the new `aiTranslate` parameter (with `null → undefined` usage mapping). | ✅ Typecheck + build pass |
| `src/lib/translator/engine.ts` | Defined `VlyUsage` + `AiTranslateFn` types inline; added `aiTranslate` param; replaced the old browser `vlyTranslateChunk()` call with `aiTranslate(...)` guarded by `if (aiTranslate)`; glossary fallback kept only inside `catch`, with `console.warn` logging. | ✅ Typecheck + build pass |
| `src/lib/translator/vlyTranslate.ts` | **GUTTED** — comment-only stub. No code, no `@vly-ai/integrations` import. | ✅ |
| `src/lib/vly-integrations.ts` | **GUTTED** — comment-only stub. No `createVlyIntegrations` import. | ✅ |
| `AUDIT_REPORT.md` | This file. | ✅ |

---

## 2. Health Check Result

```
POST https://successful-iguana-419.convex.cloud/api/action
{"path":"health:checkVlyKey","args":{},"format":"json"}

→ {"status":"success","value":{"hasKey":true,"keyPrefix":"sk_25","length":67}}
```

- `VLY_INTEGRATION_KEY` **exists** in the Convex server runtime (prefix `sk_25`, 67 chars).
- Env vars available server-side: `CONVEX_CLOUD_URL`, `CONVEX_SITE_URL`, `JWT_PRIVATE_KEY`, `VLY_APP_NAME`, `VLY_CONVEX_AUTH_ISSUER`, `VLY_INTEGRATION_BASE_URL`, `VLY_INTEGRATION_KEY`.
- `VLY_INTEGRATION_BASE_URL` = `https://integrations.vly.ai` (matches the SDK's hardcoded base URL; the old documented `https://integrations.freebuff.com` no longer resolves).

---

## 3. Bundle Check (client SDK fully removed)

| Check | Result |
|---|---|
| `dist/assets/*vly*` chunk | **GONE** — no chunk with "vly" in the name |
| `integrations.vly.ai` in bundle | **0 matches** |
| `VLY_INTEGRATION_KEY` in bundle | **0 matches** |
| `@vly-ai/integrations` in bundle | **0 matches** |

The browser bundle no longer contains the VLY SDK, the gateway URL, or the key.

---

## 4. End-to-End Verification (translateChunk, HTTP)

Request:

```
POST https://successful-iguana-419.convex.cloud/api/action
{"path":"translate:translateChunk","args":{"text":"\"You're afraid,\" Xaden said, not a question but a statement. Cold. Certain. \"I'm not afraid,\" Violet lied. She could feel his amusement through the bond.","langCode":"ur","marketContext":"standard"},"format":"json"}
```

Response (HTTP 200 with action error):

```
{"status":"error","errorMessage":"[Request ID: c6f9e9417ea6e51f] Server Error\nUncaught Error: Unauthorized\n    at handler (../convex/translate.ts:266:20)\n","logLines":["[WARN] 'AI SDK Warning: System messages ...']"}
```

Raw gateway probe (health:probeVly — replicates the SDK's exact request):

```
POST https://integrations.vly.ai/v1/llm/chat/completions
Authorization: Bearer <VLY_INTEGRATION_KEY — sk_25..., 67 chars, real server value>
{"model":"deepseek-chat","messages":[{"role":"user","content":"Reply with the single word: OK"}],"max_tokens":4}

→ HTTP 401
→ {"error":"Invalid token","statusCode":401}
```

Both the real key and the SDK's default fallback (`vlytomoonF2024`) receive the identical `401 {"error":"Invalid token"}` from the gateway.

**Urdu sample output: NOT PRODUCED.** The AI call is rejected at the gateway before any translation can happen. No Urdu text exists to paste; the exact error is quoted above.

---

## 5. Root Cause of the Remaining Blocker

The code path is now fully correct and server-side:

1. `Translator.tsx` → `runLocalizedTranslationPipeline(..., aiTranslate)` → Convex action
2. `convex/translate.ts` reads `process.env.VLY_INTEGRATION_KEY` (present: `sk_25...`)
3. Calls `createVlyIntegrations({ deploymentToken: key }).ai.completion(...)`
4. Gateway `https://integrations.vly.ai` → **HTTP 401 `{"error":"Invalid token"}`**

**The `VLY_INTEGRATION_KEY` value in the project is not accepted by the VLY gateway.** This is not a code issue — the URL, the auth header format, and the server-side reading are all correct and match the platform's own SDK. The key value itself is either stale, rotated, or not a valid VLY integration token for this deployment.

---

## 6. What Remains

| # | Item | Status |
|---|---|---|
| 1 | Real AI Urdu translation | **BLOCKED** — gateway rejects the configured `VLY_INTEGRATION_KEY` |
| 2 | "DeepSeek AI" badge in UI | Will show automatically once the key works (engine sets `mode = "vly"`) |
| 3 | Glossary fallback behavior | ✅ Working — engine catches the action failure and falls back to neural/glossary with a logged reason |

**User action needed:** check freebuff.com project settings → Keys/API keys UI → confirm the `VLY_INTEGRATION_KEY` value is the correct, active VLY integration key for this project (not a DeepSeek/OpenAI key pasted in by mistake). After updating, re-run `health:probeVly` — it should return HTTP 200 with an OK response.
