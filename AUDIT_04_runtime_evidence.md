# SECTION 4 — RUNTIME EVIDENCE (actually run it)

**Limitation:** no browser/console available in this environment; the dev server is platform-managed and cannot be launched or inspected here. Runtime evidence below was obtained by executing the project's real code and by probing the real endpoint over HTTP.

## 4.1 Live probe of the actual AI endpoint (real HTTP, this sandbox)

POST `https://integrations.vly.ai/v1/llm/chat/completions`, `Authorization: Bearer vlytomoonF2024` (the SDK's fallback token — the one the shipped bundle actually sends), probe message "Reply with the single word: OK", `max_tokens: 4`:

```
[deepseek-chat]     HTTP 401 in 96ms :: {"error":"Invalid token","statusCode":401}
[deepseek-v4-flash] HTTP 401 in 73ms :: {"error":"Invalid token","statusCode":401}
[deepseek-r1]       HTTP 401 in 73ms :: {"error":"Invalid token","statusCode":401}
[deepseek-thinking] HTTP 401 in 73ms :: {"error":"Invalid token","statusCode":401}
[gpt-5]             HTTP 401 in 75ms :: {"error":"Invalid token","statusCode":401}
```

→ The gateway is reachable but rejects the token the app actually uses. No DeepSeek model identifier ever succeeds.

## 4.2 Real run of the pipeline (Node, importing the project's engine/glossary/QA code)

Command: `bun /tmp/urdu-demo.mjs` → `runLocalizedTranslationPipeline({ sourceText: <sample>, targetLanguage: "ur", marketContext: "standard" })`.

Progress log:
```
[progress bible] Locking glossary terms and proper nouns…
[progress neural] Running 23-phase DeepSeek AI localization → ur…
[progress model] Building 23-phase DeepSeek localization prompt…
[progress model] Calling DeepSeek (gateway default)…
AI SDK Warning: System messages in the prompt or messages fields …
[progress post-process] Applying character voice rules…
[progress complete] Translation pipeline complete
```

Result metadata:
```
=== MODE: glossary | model: (none) | usage: null
=== QA: 97 /100 overall: fail
=== elapsed: 450 ms
```

EXACT OUTPUT TEXT (Urdu target):

```
‏Chapter 1: The Storm Within

"You're afraid," Xaden said, not a question but a statement. Cold. Certain.

"I'm not afraid," Violet lied. She could feel his amusement through the bond.

【You are mine,】 his thoughts echoed through the telepathic link.

"Holy shit," Ridoc muttered. "Remind me why we volunteered for this?"
```

→ 100% English preserved; only glossary/telepathy transforms applied. This is the word-swap the user is complaining about.

## 4.3 Build-bundle evidence (why the key never reaches the SDK)

`dist/assets/vly-integrations-48yrn9YI.js` (from `vite.config.ts` with `vlyPlugin()`):

```js
var o={};
const a=e({deploymentToken:o.VLY_INTEGRATION_KEY,debug:!1});
```

`process.env` → `{}` in the browser build ⇒ `deploymentToken` is always `undefined` ⇒ SDK uses public default token ⇒ 401 (4.1). No `.env` file exists in the repo (glob `.env*` → empty) and `VLY_INTEGRATION_KEY` is not inlined anywhere in `dist/assets/`.

## 4.4 Errors / missing modules / 404s

- No build-time errors: `bun tsc -b --noEmit` passes (verified earlier; no files changed during this audit).
- No 404s observed on `/public/vendor/*` (static files exist: `pdf.min.mjs`, `pdf.worker.min.mjs`, `transformers.min.js`).
- The one error observed in real runs is the **HTTP 401 from `integrations.vly.ai`** — i.e., the AI feature is authenticating with an invalid token, which is the "un-deployed backend / failed env lookup" class of failure this section asked to detect.
