# SECTION 1 — RESTATE THE TRUE REQUIREMENTS (what we actually want)

- [ ] REAL AI translation via Freebuff VLY gateway with a DeepSeek model for all 20 languages (Urdu, Arabic, French, Japanese, Spanish, Hindi, Turkish, Chinese, Russian, Korean, German, Kashmiri, Romanian, Swahili, Italian, Latin, Indonesian, Nepali, Bangla, Portuguese). Server-side action; VLY key NEVER in the browser.
- [ ] A system prompt containing all 23 localization phases (glossary fidelity, name consistency, natural bridge, character voice, tone, censorship, honorifics, RTL, magic terms, dialogue flow, internal monologue, action pacing, romance filters, profanity, political sensitivity, dragon telepathy, visual extraction, self-verification, chapter headings/TOC, poetry/songs, book-wide consistency, layout text-fit, final QA).
- [ ] Code-level QA checks for phases P1, P2, P8, P9, P10, P16, P17, P19, P21, P22, P23.
- [ ] UI badges: "DeepSeek AI" when AI is used, "Glossary Mode" when it falls back.
- [ ] PDF generation via pdf-lib embedPage() in a Web Worker — zero canvas rasterization.
- [ ] ArrayBuffer/Blob storage (no Base64), batch of 10 pages, progress events.
- [ ] Progress saved in IndexedDB forever; resume works on preview tab AND published link.
- [ ] The 4-step lazy loading removed.
- [ ] Works on Chrome 95, Android 5 WebView, 2GB RAM.
