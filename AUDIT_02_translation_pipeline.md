# SECTION 2 — ACTUAL STATE OF THE TRANSLATION PIPELINE (most important)

## 2.1 The exact code path, from "Begin Translation Journey" to output

```
Translator.tsx:748  runLocalizedTranslationPipeline({ sourceText: chunkText, targetLanguage: lang.code, marketContext, chapterNumber })
  └─ engine.ts:586  vlyTranslateChunk(bibleText, langCode, marketContext, onStatus)      ← PRIMARY (DeepSeek via VLY)
       └─ vlyTranslate.ts:112  getDeepSeekModel(client) — probes 4 model candidates
       └─ vlyTranslate.ts:361  client.ai.completion({ model, messages:[system, user], temperature: 0.3, maxTokens: 4000 })
       └─ (SDK) POST https://integrations.vly.ai/v1/llm/chat/completions   ← the actual outbound call
  └─ engine.ts:606  neural fallback (only if hasNeuralModel(langCode) && mode === "glossary")
  └─ engine.ts:621  Glossary Mode — 5-tier glossary word-swap                 ← the fallback that actually runs
  └─ engine.ts:669  runQA(sourceText, translatedText, langCode, memory)      ← 23-phase code checks
  └─ Translator.tsx:775  saveTranslationChunk(...)  → IndexedDB after every chunk
```

**The core function (10–20 lines), `engine.ts` `runLocalizedTranslationPipeline` (lines 583–601):**

```ts
onProgress?.("neural", `Running 23-phase DeepSeek AI localization → ${targetLanguage}…`);
try {
  const vlyResult = await vlyTranslateChunk(
    bibleText,
    targetLanguage,
    marketContext,
    (msg) => onProgress?.("model", msg)
  );
  if (vlyResult.ok && vlyResult.text) {
    translatedText = vlyResult.text;
    mode = "vly";
    model = vlyResult.model;
    usage = vlyResult.usage;
    phases[1].result = "DeepSeek AI localization complete";
    phases[1].notes = `23-phase prompt · model: ${vlyResult.model ?? "gateway default"} · per-language config applied`;
  }
} catch (error) {
  phases[1].notes = `DeepSeek AI unavailable (${error instanceof Error ? error.message : "error"}); falling back`;
}
```

And the completion itself, `vlyTranslate.ts:361`:

```ts
const resp = await client.ai.completion({
  model: model ?? undefined,
  messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: sourceText },
  ],
  temperature: 0.3,
  maxTokens: 4000,
});
```

## 2.2 Repo-wide search hits (vly / deepseek / completion / ai. / translate.ts / VLY_INTEGRATION_KEY / fetch / axios)

| Pattern | Hits (file:line) |
|---|---|
| `vly` | `src/lib/vly-integrations.ts:5` (`createVlyIntegrations`), `:6` (`deploymentToken: process.env.VLY_INTEGRATION_KEY!`); `src/lib/translator/vlyTranslate.ts:24,101-104` (dynamic `import("@/lib/vly-integrations")`), `:361` (`client.ai.completion`); `src/lib/translator/engine.ts:21,586`; `vite.config.ts:2` (`vlyPlugin()`); `node_modules/@vly-ai/integrations/dist/index.mjs` (SDK) |
| `deepseek` | `vlyTranslate.ts:94-98` (`DEEPSEEK_MODEL_CANDIDATES = ["deepseek-chat","deepseek-v4-flash","deepseek-r1","deepseek-thinking"]`); `Translator.tsx:746,1699` (UI strings only) |
| `completion` | `vlyTranslate.ts:114` (model probe), `:361` (real call); SDK `VlyAI.completion` |
| `VLY_INTEGRATION_KEY` | `src/lib/vly-integrations.ts:6`; **and in the built bundle** `dist/assets/vly-integrations-48yrn9YI.js:142` as `deploymentToken: o.VLY_INTEGRATION_KEY` where `var o = {}` (see 2.4) |
| `fetch(` | `src/lib/translator/vendor.ts:47` (loads pdf.js/transformers from `/public/vendor`); `src/lib/translator/pdf-render.ts:104` (downloads Unicode fonts from cdn.jsdelivr.net); inside SDK (`VlyClient.request` → `integrations.vly.ai`) |
| `translate.ts` | **NOT FOUND** under `src/convex/` (directory does not exist). Only `convex/_generated/*` leftovers exist at repo root (see 2.3) |
| `axios` | **0 hits** |
| `ai.` | `vlyTranslate.ts` (`client.ai.completion`), SDK `VlyAI` |

## 2.3 Is `src/convex/translate.ts` present?

**NO.** `src/convex/` does not exist. The repo root has a `convex/` folder containing ONLY generated files (`convex/_generated/api.js`, `api.d.ts`, `dataModel.d.ts`, `server.js`, `server.d.ts`) — template leftovers. There is **no `convex.config.ts`, no `schema.ts`, no function file, no `src/convex/` at all**, and `grep -rn convex src/` returns nothing. The spec's Step 1 ("In `src/convex/translate.ts` (server action, `"use node"`)") was **never implemented**.

## 2.4 Is a backend actually deployed? Is there an outbound AI call?

- **No Convex/VLY backend exists**, so nothing runs server-side. The spec's "server-side action; VLY key NEVER in the browser" is not true in this codebase: the whole AI path is **client-side**.
- **Yes, an outbound call is made at translation time — from the browser.** The SDK (`node_modules/@vly-ai/integrations/dist/index.mjs`) hardcodes:
  - `baseURL: "https://integrations.vly.ai/v1/llm"` → effective URL `https://integrations.vly.ai/v1/llm/chat/completions`
  - `Authorization: Bearer ${config.deploymentToken}` where `deploymentToken = config.deploymentToken || "vlytomoonF2024"` (a hardcoded public default token).
- **Which token actually ships?** The built production bundle (`dist/assets/vly-integrations-48yrn9YI.js`) contains:
  ```js
  var o = {};
  const a = e({ deploymentToken: o.VLY_INTEGRATION_KEY, debug: !1 });
  ```
  i.e. Vite/esbuild replaced `process.env` with `{}`, so `deploymentToken` is `undefined` at runtime → the SDK silently falls back to the **public token `vlytomoonF2024`**.
- **Live probe result (this sandbox, real HTTP):** POST to `https://integrations.vly.ai/v1/llm/chat/completions` with `Bearer vlytomoonF2024` returns **HTTP 401 `{"error":"Invalid token","statusCode":401}`** for **every** DeepSeek candidate AND for `gpt-5` (see Section 4).
- **Consequence:** the probe chain in `getDeepSeekModel` (vlyTranslate.ts:110-130) gets `success:false` for all 4 candidates → returns `null` → the completion is sent with the gateway default model → also 401 → `vlyTranslateChunk` throws → `engine.ts` catches and drops to Glossary Mode. **No DeepSeek model string ever resolves; no AI translation is ever produced.**

## 2.5 Does the old glossary/word-swap code still run?

**Yes — it is the code that actually produces the output today.**

- `engine.ts:621-630` (phase 2c): when VLY and neural both fail, it does the word-swap:
  ```ts
  for (const term of Object.keys(glossary)) {
    const regex = new RegExp(`\\b${term}\\b`, "gi");
    if (regex.test(translatedText)) {
      const translation = getTranslation(term, targetLanguage);
      translatedText = translatedText.replace(regex, translation);
    }
  }
  ```
- The two legacy pipelines `runNeuralTranslationPipeline` (engine.ts:299) and `runTranslationPipeline` (engine.ts:783) are **still defined but no longer called** anywhere (grep across `src/` shows only their definitions). The UI calls only `runLocalizedTranslationPipeline` (Translator.tsx:748), whose fallback is the swap above.

## 2.6 Sample English sentence → what the engine actually outputs for Urdu (real run)

Input chunk (dialog + narration):

> "You're afraid," Xaden said, not a question but a statement. Cold. Certain. / "I'm not afraid," Violet lied. ... / *You are mine,* his thoughts echoed ... / "Holy shit," Ridoc muttered. ...

Actual output from running `runLocalizedTranslationPipeline` with `targetLanguage: "ur"` (full output in Section 4):

```
‏Chapter 1: The Storm Within

"You're afraid," Xaden said, not a question but a statement. Cold. Certain.

"I'm not afraid," Violet lied. She could feel his amusement through the bond.

【You are mine,】 his thoughts echoed through the telepathic link.

"Holy shit," Ridoc muttered. "Remind me why we volunteered for this?"
```

Result metadata: `mode: "glossary"`, `model: (none)`, `usage: null`, QA 97/100 (overall "fail"). This is **pure word-swap** — every English sentence is unchanged except glossary terms and `*...*` → `【...】` telepathy markers. This proves the user sees fake word-swap translation because that is exactly what the fallback path produces.
