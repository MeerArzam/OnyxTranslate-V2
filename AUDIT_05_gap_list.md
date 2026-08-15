# SECTION 5 — GAP LIST

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
