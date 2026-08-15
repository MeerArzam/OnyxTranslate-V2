# Onyx Translate — Agent Self-Audit & Implementation Report

**Auditor:** Buffy (Codebuff) · **Date:** Aug 15, 2026 · **Method:** Read-only static analysis of the full repo + runtime probes executed against the actual engine code and the VLY gateway. **No project code was modified.** (Only this report file was created, as instructed.)

**Scope note on runtime verification:** this sandbox has no browser and the dev server is platform-managed, so Section 4 could not capture a real browser console/network tab. Instead I executed (a) the actual production build output (`dist/`) as static evidence, (b) live HTTP probes to the exact AI endpoint the SDK calls, and (c) the real translation pipeline (`runLocalizedTranslationPipeline`) with the real glossary/QA code, running in Node. Those are labeled as such.

---

## SECTION 1 — RESTATE THE TRUE REQUIREMENTS (what we actually want)

- [ ] REAL AI translation via Freebuff VLY gateway with a DeepSeek model for all 20 languages (Urdu, Arabic, French, Japanese, Spanish, Hindi, Turkish, Chinese, Russian, Korean, German, Kashmiri, Romanian, Swahili, Italian, Latin, Indonesian, Nepali, Bangla, Portuguese). Server-side action; VLY key NEVER in the browser.
- [ ] A system prompt containing all 23 localization phases (glossary fidelity, name consistency, natural bridge, character voice, tone, censorship, honorifics, RTL, magic terms, dialogue flow, internal monologue, action pacing, romance filters, profanity, political sensitivity, dragon telepathy, visual extraction, self-verification, chapter headings/TOC, poetry/songs, book-wide consistency, layout text-fit, final QA).
- [ ] Code-level QA checks for phases P1, P2, P8, P9, P10, P16, P17, P19, P21, P22, P23.
- [ ] UI badges: "DeepSeek AI" when AI is used, "Glossary Mode" when it falls back.
- [ ] PDF generation via pdf-lib embedPage() in a Web Worker — zero canvas rasterization.
- [ ] ArrayBuffer/Blob storage (no Base64), batch of 10 pages, progress events.
- [ ] Progress saved in IndexedDB forever; resume works on preview tab AND published link.
- [ ] The 4-step lazy loading removed.
- [ ] Works on Chrome 95, Android 5 WebView, 2GB RAM.

---

## SECTION 2 — ACTUAL STATE OF THE TRANSLATION PIPELINE (most important)

### 2.1 The exact code path, from "Begin Translation Journey" to output

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

### 2.2 Repo-wide search hits (vly / deepseek / completion / ai. / translate.ts / VLY_INTEGRATION_KEY / fetch / axios)

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

### 2.3 Is `src/convex/translate.ts` present?

**NO.** `src/convex/` does not exist. The repo root has a `convex/` folder containing ONLY generated files (`convex/_generated/api.js`, `api.d.ts`, `dataModel.d.ts`, `server.js`, `server.d.ts`) — template leftovers. There is **no `convex.config.ts`, no `schema.ts`, no function file, no `src/convex/` at all**, and `grep -rn convex src/` returns nothing. The spec's Step 1 ("In `src/convex/translate.ts` (server action, `"use node"`)") was **never implemented**.

### 2.4 Is a backend actually deployed? Is there an outbound AI call?

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

### 2.5 Does the old glossary/word-swap code still run?

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

### 2.6 Sample English sentence → what the engine actually outputs for Urdu (real run)

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

---

## SECTION 3 — CHECKLIST: ACTUAL STATE OF EACH REQUESTED CHANGE

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | VLY integration wired as a **backend** action | **NOT DONE** | No `src/convex/`, no `translate.ts`, no `"use node"` action. `src/lib/vly-integrations.ts:6` is client-side; SDK is called from the browser bundle. |
| 2 | DeepSeek model actually used (exact model string) | **NOT DONE** | `DEEPSEEK_MODEL_CANDIDATES` (vlyTranslate.ts:94-98) never resolves: all probes 401 with the shipped token (Section 4). UI always shows "gateway-default" at best; runtime shows `model: (none)`. |
| 3 | System prompt with all 23 phases built server-side | **PARTIAL** | `buildSystemPrompt` (vlyTranslate.ts) does contain all 23 phases + deep-reasoning protocol + per-language config — but it is built **client-side** (browser), not server-side. |
| 4 | Code QA checks implemented and running | **DONE** | `src/lib/translator/qa.ts` — code checks for P1,P2,P3,P4,P6,P8,P9,P10,P13,P14,P15,P16,P17,P19,P21,P22,P23 (superset of the requested P1,P2,P8,P9,P10,P16,P17,P19,P21,P22,P23). Runs at engine.ts:669 after every chunk; verified live (QA report returned in the Urdu run). |
| 5 | "DeepSeek AI" / "Glossary Mode" badges | **DONE** | Translator.tsx:1699-1702 renders `DeepSeek AI · 23 phases` / `Neural MT + phases` / `Glossary Mode · VLY offline (word-swap fallback)`; also present in the built bundle. |
| 6 | pdf-lib embedPage(), zero canvas | **DONE** (uses `copyPages` instead of `embedPage` — equivalent, no canvas) | `pdf-render.ts:226` `outDoc.copyPages(srcDoc, [i])` copies whole pages (images/vector preserved); white-out via `drawRectangle` (:268), text via `drawText` (:325,:333). **Zero `canvas`/`getContext`/`toDataURL` in the PDF path** (grep confirms). |
| 7 | PDF parsing AND generation inside a Web Worker | **PARTIAL** | Generation: **yes** — `pdf-worker.ts` handles `GENERATE_PDF` (worker created lazily in `pdfGenerator.ts:44-58`). Parsing: **no** — `pdfParser.ts` runs `parsePDFHeader`/`parsePDFBatch` on the **main thread**. |
| 8 | ArrayBuffer/Blob storage, no Base64 | **DONE** | `storage.ts` v2 stores `pdfBytes` as raw `ArrayBuffer` (DB_VERSION 2, v1→v2 migration). Base64 exists only for export/import JSON files and legacy migration — not for storage. |
| 9 | Batched processing (10 pages) with progress | **PARTIAL** | Parse batches = **3 pages** (`PARSE_BATCH_SIZE = 3`, pdfParser.ts:214); translation chunks = **~2000 words** (`chunkPageTexts(pageTexts, 2000)`, Translator.tsx:717); PDF render yields every 10 pages (pdf-render.ts). Progress events exist for all three. Not "10 pages". |
| 10 | IndexedDB persistence + resume across reloads | **DONE** | DB `onyx-translate-db` (storage.ts:19); mount effect loads project (Translator.tsx:193); resume flow restores project + continues parsing (Translator.tsx:214-330); export/import for cross-origin sync (Translator.tsx:517,541). Never auto-cleared; only "Start Over" clears. |
| 11 | ZIP built from cached blobs | **DONE** | Translator.tsx:1000-1040 — lazy `import("jszip")`; uses in-memory blob → IndexedDB-cached blob (`getTranslationPdf`) → regenerates only as last resort. |
| 12 | Android 5 / no-WASM fallback path | **UNVERIFIED / LIKELY BROKEN** | `pdfGenerator.ts` falls back to main thread when `Worker` is missing; `neural.ts` forces `wasm.numThreads=1`. **But** the vendored pdf.js 5.4.296 worker uses modern APIs (`CompressionStream`, `ReadableStream`, optional chaining, class fields) that do not exist in Android 5 WebView (Chrome ~37-49 era). Cannot be verified in this sandbox (no device/browser). |
| 13 | 4-step application loading removed | **DONE** | `main.tsx` renders only `<Translator/>`; mount effects only check IndexedDB (Translator.tsx:193-206). pdf.js, transformers.js, pdf-lib, VLY client, JSZip are all loaded lazily on user action (vendor.ts, pdfParser.ts `getPDFJS`, pdf-render.ts `await import("pdf-lib")`, pdfGenerator.ts lazy worker, Translator.tsx:1002). `dist/assets` initial chunks = react-vendor + lucide + app (no pdf-lib/pdf.js/vly in the first load). |
| 14 | VLY failure → glossary fallback wired | **DONE** | engine.ts:583-630 (try VLY → neural → glossary swap); verified live (the Urdu run took this exact path). |

---

## SECTION 4 — RUNTIME EVIDENCE (actually run it)

**Limitation:** no browser/console available in this environment; the dev server is platform-managed and cannot be launched or inspected here. Runtime evidence below was obtained by executing the project's real code and by probing the real endpoint over HTTP.

### 4.1 Live probe of the actual AI endpoint (real HTTP, this sandbox)

POST `https://integrations.vly.ai/v1/llm/chat/completions`, `Authorization: Bearer vlytomoonF2024` (the SDK's fallback token — the one the shipped bundle actually sends), probe message "Reply with the single word: OK", `max_tokens: 4`:

```
[deepseek-chat]     HTTP 401 in 96ms :: {"error":"Invalid token","statusCode":401}
[deepseek-v4-flash] HTTP 401 in 73ms :: {"error":"Invalid token","statusCode":401}
[deepseek-r1]       HTTP 401 in 73ms :: {"error":"Invalid token","statusCode":401}
[deepseek-thinking] HTTP 401 in 73ms :: {"error":"Invalid token","statusCode":401}
[gpt-5]             HTTP 401 in 75ms :: {"error":"Invalid token","statusCode":401}
```

→ The gateway is reachable but rejects the token the app actually uses. No DeepSeek model identifier ever succeeds.

### 4.2 Real run of the pipeline (Node, importing the project's engine/glossary/QA code)

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

### 4.3 Build-bundle evidence (why the key never reaches the SDK)

`dist/assets/vly-integrations-48yrn9YI.js` (from `vite.config.ts` with `vlyPlugin()`):

```js
var o={};
const a=e({deploymentToken:o.VLY_INTEGRATION_KEY,debug:!1});
```

`process.env` → `{}` in the browser build ⇒ `deploymentToken` is always `undefined` ⇒ SDK uses public default token ⇒ 401 (4.1). No `.env` file exists in the repo (glob `.env*` → empty) and `VLY_INTEGRATION_KEY` is not inlined anywhere in `dist/assets/`.

### 4.4 Errors / missing modules / 404s

- No build-time errors: `bun tsc -b --noEmit` passes (verified earlier; no files changed during this audit).
- No 404s observed on `/public/vendor/*` (static files exist: `pdf.min.mjs`, `pdf.worker.min.mjs`, `transformers.min.js`).
- The one error observed in real runs is the **HTTP 401 from `integrations.vly.ai`** — i.e., the AI feature is authenticating with an invalid token, which is the "un-deployed backend / failed env lookup" class of failure this section asked to detect.

---

## SECTION 5 — GAP LIST

| # | Requirement | Status | Evidence | What exactly is missing |
|---|---|---|---|---|
| 1 | Server-side VLY action (`src/convex/translate.ts`, `"use node"`) | NOT DONE | No `src/convex/`; no function files | The entire AI path lives in browser code (`vlyTranslate.ts`, `vly-integrations.ts`) |
| 2 | Real DeepSeek model used | NOT DONE | vlyTranslate.ts:94-98; 401s in 4.1; `mode: glossary, model: (none)` in 4.2 | A valid deployment token that the gateway accepts — and code that sends it (the current one sends `undefined` → public fallback → 401) |
| 3 | 23-phase system prompt server-side | PARTIAL | `buildSystemPrompt` vlyTranslate.ts (client-side) | Move prompt construction (and the call) into a server action; currently the model only ever sees it if the call succeeded, which it never does |
| 4 | Code QA checks | DONE | qa.ts; ran in 4.2 (QA 97/100) | — (works) |
| 5 | DeepSeek AI / Glossary Mode badges | DONE | Translator.tsx:1699-1702 | — (works; today always shows Glossary Mode because of #2) |
| 6 | pdf-lib, zero canvas | DONE | pdf-render.ts:226,268,325 | — (uses `copyPages`, not literally `embedPage`, but equivalent & canvas-free) |
| 7 | PDF parsing in Web Worker | PARTIAL | pdfParser.ts (main thread); pdf-worker.ts (generation only) | Move `parsePDFHeader`/`parsePDFBatch` into a worker |
| 8 | ArrayBuffer/Blob storage | DONE | storage.ts v2 | — |
| 9 | Batch of 10 pages | PARTIAL | `PARSE_BATCH_SIZE = 3` (pdfParser.ts:214); 2000-word chunks; render yields every 10 | Batch sizes don't match the "10 pages" spec |
| 10 | IndexedDB + resume | DONE | Translator.tsx:193,214; storage.ts | — (works; cross-origin requires manual Export/Import by design — browsers can't share IndexedDB across origins) |
| 11 | ZIP from cached blobs | DONE | Translator.tsx:1000-1040 | — |
| 12 | Android 5 / 2GB RAM | UNVERIFIED / LIKELY BROKEN | pdf.js v5 worker uses `CompressionStream`/`ReadableStream`; module workers absent on Android 5 | No device to test; likely needs an older pdf.js or server-side parsing for Android 5 WebView |
| 13 | 4-step loading removed | DONE | main.tsx; lazy loads everywhere; dist chunk list | — |
| 14 | VLY → glossary fallback | DONE | engine.ts:583-630; verified in 4.2 | — (this is what makes the app "work" while hiding the AI failure) |

---

## SECTION 6 — ROOT-CAUSE HYPOTHESIS

**The single most likely reason the user still sees fake word-swap translation: the DeepSeek/VLY AI call never authenticates, so every translation silently falls back to Glossary Mode.** The code has a fully built AI path (23-phase prompt, model probe chain, SDK call, QA), but the key never reaches the SDK: the app reads `process.env.VLY_INTEGRATION_KEY` in a **browser** module, Vite/esbuild compiles `process.env` to an empty object (`dist/assets/vly-integrations-*.js` shows `deploymentToken: o.VLY_INTEGRATION_KEY` with `var o={}`), the SDK substitutes its hardcoded public token `vlytomoonF2024`, and the gateway rejects it (live probe: HTTP 401 "Invalid token" for all 4 DeepSeek candidates). The probe chain therefore returns `null`, the completion throws, `engine.ts` catches and runs the 5-tier glossary word-swap (verified live: `mode: glossary`, output = English text with a few term swaps), and the UI dutifully labels it "Glossary Mode · VLY offline (word-swap fallback)".

Supporting evidence:
1. `src/lib/vly-integrations.ts:6` — key read in client code via `process.env` (no server anywhere in the project).
2. `dist/assets/vly-integrations-48yrn9YI.js` — compiled bundle passes `undefined` to `createVlyIntegrations`.
3. SDK fallback token `vlytomoonF2024` (node_modules/@vly-ai/integrations/dist/index.mjs:471) → HTTP 401 in live probe (Section 4.1).
4. `vlyTranslate.ts:110-130` — probe chain returns null on 401; `:361` completion then 401s; `engine.ts:583-601` catch → glossary swap `engine.ts:621-630`.
5. Live pipeline run (Section 4.2): `MODE: glossary`, English-only output in 450 ms — matches exactly what the user sees.
6. `integrations.md` documents the intended fix ("Must be used in Convex actions with `"use node"`", "The integration key should never be exposed to the client") — and that server-side design was never implemented (`src/convex/` doesn't exist).
