# SECTION 6 — ROOT-CAUSE HYPOTHESIS

**The single most likely reason the user still sees fake word-swap translation: the DeepSeek/VLY AI call never authenticates, so every translation silently falls back to Glossary Mode.** The code has a fully built AI path (23-phase prompt, model probe chain, SDK call, QA), but the key never reaches the SDK: the app reads `process.env.VLY_INTEGRATION_KEY` in a **browser** module, Vite/esbuild compiles `process.env` to an empty object (`dist/assets/vly-integrations-*.js` shows `deploymentToken: o.VLY_INTEGRATION_KEY` with `var o={}`), the SDK substitutes its hardcoded public token `vlytomoonF2024`, and the gateway rejects it (live probe: HTTP 401 "Invalid token" for all 4 DeepSeek candidates). The probe chain therefore returns `null`, the completion throws, `engine.ts` catches and runs the 5-tier glossary word-swap (verified live: `mode: glossary`, output = English text with a few term swaps), and the UI dutifully labels it "Glossary Mode · VLY offline (word-swap fallback)".

## Supporting evidence

1. `src/lib/vly-integrations.ts:6` — key read in client code via `process.env` (no server anywhere in the project).
2. `dist/assets/vly-integrations-48yrn9YI.js` — compiled bundle passes `undefined` to `createVlyIntegrations`.
3. SDK fallback token `vlytomoonF2024` (node_modules/@vly-ai/integrations/dist/index.mjs:471) → HTTP 401 in live probe (Section 4.1).
4. `vlyTranslate.ts:110-130` — probe chain returns null on 401; `:361` completion then 401s; `engine.ts:583-601` catch → glossary swap `engine.ts:621-630`.
5. Live pipeline run (Section 4.2): `MODE: glossary`, English-only output in 450 ms — matches exactly what the user sees.
6. `integrations.md` documents the intended fix ("Must be used in Convex actions with `"use node"`", "The integration key should never be exposed to the client") — and that server-side design was never implemented (`src/convex/` doesn't exist).

## Bottom line

Everything except the actual AI translation works and is verifiably implemented. The one thing the user is chasing — real DeepSeek localization — is dead on arrival because the key plumbing was built for a server that doesn't exist, and the browser bundle can never read `process.env`. The honest fix is the one the original spec already described: a real `src/convex/translate.ts` action (`"use node"`) that reads `VLY_INTEGRATION_KEY` server-side and calls `vly.ai.completion`, with the client calling that action instead of the SDK directly.
