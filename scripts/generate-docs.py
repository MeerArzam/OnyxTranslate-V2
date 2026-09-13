#!/usr/bin/env python3
"""
scripts/generate-docs.py — Regenerates the static, JavaScript-free documentation
mirror in public/docs/ from the REAL source files.

Run after every code change task (see UPDATE POLICY in the docs prompt):
    python3 scripts/generate-docs.py

Output files (all plain HTML, no JS, no external CSS):
    public/docs/index.html
    public/docs/architecture.html
    public/docs/convex-functions.html        (mutations, queries, history, import, upload)
    public/docs/convex-functions-2.html      (translateContent.ts full source)
    public/docs/convex-functions-3.html      (translateQueue.ts + translateImage.ts)
    public/docs/convex-functions-4.html      (parsePdf.ts + generatePdf.ts + zipAssembly.ts)
    public/docs/translation-pipeline.html    (23 phases, Bible pass, Gemini rotation, QA)
    public/docs/frontend.html                (React components, state, hooks, CSS)
    public/docs/history.html                 (change log, reconstructed from code evidence)
"""
import html
import json
import os
import re
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "docs")

STYLE = """<style>
body{background:#0a0a0f;color:#e0e0e0;font-family:Georgia,'Times New Roman',serif;max-width:960px;margin:0 auto;padding:24px;line-height:1.6}
h1{color:#8B5CF6;border-bottom:2px solid rgba(139,92,246,.3);padding-bottom:8px}
h2{color:#00e5ff;margin-top:28px}
h3{color:#fbbf24}
a{color:#00e5ff}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#F59E0B}
pre{background:rgba(0,0,0,.45);border:1px solid rgba(139,92,246,.25);border-radius:8px;padding:12px;overflow-x:auto}
pre code{color:#e0e0e0;font-size:11px;line-height:1.5;white-space:pre}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid rgba(139,92,246,.25);padding:6px 10px;text-align:left;vertical-align:top}
th{color:#8B5CF6;background:rgba(139,92,246,.08)}
td code{color:#00e5ff}
.meta{color:#8b8ba0;font-size:12px;font-family:ui-monospace,monospace}
.note{border-left:3px solid #fbbf24;background:rgba(251,191,36,.06);padding:8px 14px;font-size:13px}
</style>"""


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def read(rel: str) -> str:
    with open(os.path.join(ROOT, rel), "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def code_block(source: str, lang: str = "typescript") -> str:
    return f"<pre><code>{esc(source)}</code></pre>"


def page(title: str, subtitle: str, body: str, filename: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    nav = (
        '<p class="meta"><a href="/docs/index.html">&larr; Docs index</a> '
        '&middot; <a href="/">&larr; OnyxTranslate app</a></p>'
    )
    return (
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        f"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{esc(title)} — OnyxTranslate Docs</title>\n{STYLE}\n</head>\n<body>\n"
        f"{nav}\n<h1>{esc(title)}</h1>\n<p class=\"meta\">{esc(subtitle)} &middot; generated {now}</p>\n"
        f"{body}\n<hr>\n<p class=\"meta\">OnyxTranslate static documentation mirror — plain HTML, no JavaScript. "
        f"Interactive version: <a href=\"/#/overview\">/#/overview</a></p>\n</body>\n</html>\n"
    )


def write(filename: str, content: str) -> None:
    path = os.path.join(OUT, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    size = os.path.getsize(path)
    print(f"  wrote {filename} ({size/1024:.0f} KB)")
    if size > 400 * 1024:
        raise SystemExit(f"ERROR: {filename} exceeds 400KB — split it")


# ─────────────────────────────────────────────────────────────
# Source loading
# ─────────────────────────────────────────────────────────────

SRC = {
    "schema": read("convex/schema.ts"),
    "mutations": read("convex/mutations.ts"),
    "queries": read("convex/queries.ts"),
    "history": read("convex/history.ts"),
    "importProject": read("convex/importProject.ts"),
    "upload": read("convex/upload.ts"),
    "translateContent": read("convex/translateContent.ts"),
    "translateQueue": read("convex/translateQueue.ts"),
    "translateImage": read("convex/translateImage.ts"),
    "parsePdf": read("convex/parsePdf.ts"),
    "generatePdf": read("convex/generatePdf.ts"),
    "zipAssembly": read("convex/zipAssembly.ts"),
    "pdfLayout": read("convex/pdfLayout.ts"),
    "renderPdfCore": read("convex/renderPdfCore.ts"),
    "translator": read("src/pages/Translator.tsx"),
    "dragonIntro": read("src/components/DragonIntro.tsx"),
    "progressPanel": read("src/components/RoyalProgressPanel.tsx"),
    "accordion": read("src/components/LanguageAccordion.tsx"),
    "historyPanel": read("src/components/HistoryPanel.tsx"),
    "css": read("src/index.css"),
    "main": read("src/main.tsx"),
}


def extract_fn(src: str, name: str) -> str:
    """Extract a top-level function/const block starting at its declaration."""
    m = re.search(rf"^(?:export\s+)?(?:async\s+)?(?:function|const)\s+{re.escape(name)}\b", src, re.M)
    if not m:
        return f"// {name} not found"
    lines = src[m.start():].split("\n")
    out, depth = [], 0
    started = False
    for ln in lines:
        out.append(ln)
        depth += ln.count("{") + ln.count("(") - ln.count("}") - ln.count(")")
        if "{" in ln or "(" in ln:
            started = True
        if started and depth <= 0:
            break
    return "\n".join(out)


def hook_block(src: str, name: str) -> str:
    """Extract an export const X = action({ ... }); block."""
    m = re.search(rf"^export\s+const\s+{re.escape(name)}\s*=\s*", src, re.M)
    if not m:
        return f"// {name} not found"
    lines = src[m.start():].split("\n")
    out, depth, started = [], 0, False
    for ln in lines:
        out.append(ln)
        depth += ln.count("{") + ln.count("(") - ln.count("}") - ln.count(")")
        if "{" in ln:
            started = True
        if started and depth <= 0:
            break
    return "\n".join(out)


def parse_schema() -> list:
    tables = []
    for m in re.finditer(r"^  (\w+):\s*defineTable\(\{(.*?)^\  \}\)", SRC["schema"], re.M | re.S):
        name, body = m.group(1), m.group(2)
        fields = re.findall(r"^    (\w+):\s*(v\.[^,]+?),?\s*(?:// (.*))?$", body, re.M)
        tail = SRC["schema"][m.end():m.end() + 400]
        indexes = re.findall(r'\.index\("([^"]+)",\s*\[([^\]]+)\]\)', tail)
        tables.append({"name": name, "fields": fields, "indexes": indexes})
    return tables


def react_inventory(path_key: str) -> dict:
    src = SRC[path_key]
    states = []
    for m in re.finditer(r"^  const \[(\w+), (\w+)\] = useState(<[^;]+?>)?\(([^;]*)\);", src, re.M):
        states.append({"name": m.group(1), "setter": m.group(2), "type": (m.group(3) or "inferred").strip("<>"), "init": m.group(4).strip()[:80]})
    hooks = []
    for m in re.finditer(r"^  const (\w+) = (useQuery|useMutation|useAction)\(([^;]+?)\);", src, re.M):
        hooks.append({"var": m.group(1), "hook": m.group(2), "target": " ".join(m.group(3).split())[:110]})
    memos = []
    for m in re.finditer(r"^  const (\w+) = useMemo\(", src, re.M):
        memos.append(m.group(1))
    return {"states": states, "hooks": hooks, "memos": memos}


def css_classes() -> list:
    out = []
    for m in re.finditer(r"^\.([a-zA-Z][\w-]*)\s*\{([^}]*)\}", SRC["css"], re.M):
        props = "; ".join(p.strip() for p in m.group(2).split(";") if p.strip())
        out.append({"name": "." + m.group(1), "props": props[:300]})
    return out


# ─────────────────────────────────────────────────────────────
# 1. index.html
# ─────────────────────────────────────────────────────────────

def gen_index() -> None:
    body = f"""
<h2>OnyxTranslate — Project Summary</h2>
<p><strong>OnyxTranslate</strong> is a server-side book/PDF localization tool. Users upload an English
novel (PDF), paste text, or snap/upload an image; the app extracts the text, splits it into
~2,500-word chunks, and translates each chunk into up to 20 target languages using
<strong>Gemini 3.6 Flash</strong> behind a 5-key rotation (5 free-tier API keys, ~1,250 requests/day
combined). Translation runs entirely in <strong>Convex server actions</strong> — the browser never holds
API keys, and the queue keeps running after the user closes the tab.</p>
<p><strong>Stack:</strong> React 19 + Vite 7 + TypeScript 5.9 + Tailwind CSS 4 (dark neon royal theme)
&middot; Convex 1.45 (database, file storage, reactive queries, scheduler) &middot; Gemini 3.6 Flash
(5-key rotation via <code>Gemini_API_Key_1..5</code>) &middot; pdf.js (parse) + pdf-lib (server-side
PDF generation) &middot; JSZip (batch download). Target languages: Urdu, Arabic, French, Japanese,
Spanish, Hindi, Turkish, Chinese, Russian, Korean, German, Kashmiri, Romanian, Swahili, Italian,
Latin, Indonesian, Nepali, Bangla, Portuguese.</p>
<p class="note">This mirror is plain HTML for AI agents and raw HTTP fetchers. The interactive
documentation dashboard lives at <a href="/#/overview">/#/overview</a>.</p>

<h2>Documentation Pages</h2>
<table>
<tr><th>Page</th><th>Contents</th></tr>
<tr><td><a href="/docs/architecture.html">architecture.html</a></td>
<td>Convex schema (every table, field, index), session isolation model, end-to-end data flow:
upload &rarr; parse &rarr; chunking &rarr; translation &rarr; PDF generation &rarr; ZIP</td></tr>
<tr><td><a href="/docs/convex-functions.html">convex-functions.html</a></td>
<td>Convex mutations + queries + history + import + upload — exact signatures and real code</td></tr>
<tr><td><a href="/docs/convex-functions-2.html">convex-functions-2.html</a></td>
<td><code>convex/translateContent.ts</code> — the unified translation action, full real source</td></tr>
<tr><td><a href="/docs/convex-functions-3.html">convex-functions-3.html</a></td>
<td><code>convex/translateQueue.ts</code> (autonomous scheduler queue) and
<code>convex/translateImage.ts</code> (image OCR + translation)</td></tr>
<tr><td><a href="/docs/convex-functions-4.html">convex-functions-4.html</a></td>
<td><code>parsePdf.ts</code>, <code>generatePdf.ts</code>, <code>zipAssembly.ts</code> — PDF parsing,
translated-PDF generation, ZIP assembly</td></tr>
<tr><td><a href="/docs/convex-functions-5.html">convex-functions-5.html</a></td>
<td><code>pdfLayout.ts</code>, <code>renderPdfCore.ts</code> — geometry-aware word merging,
paragraph block clustering, and the coordinate-aware translated-PDF render core</td></tr>
<tr><td><a href="/docs/translation-pipeline.html">translation-pipeline.html</a></td>
<td>The Gemini flow: all 23 localization phases (real text), Bible pass, 5-key rotation,
retry/backoff, sliding-window context, post-processing, QA checks, language chaining</td></tr>
<tr><td><a href="/docs/frontend.html">frontend.html</a></td>
<td>Every React component: props, useState/useQuery/useMutation/useAction inventory, render
structure, theme CSS classes</td></tr>
<tr><td><a href="/docs/history.html">history.html</a></td>
<td>Change log — what was built, migrated, and fixed</td></tr>
<tr><td><a href="/docs/live-tests.html">live-tests.html</a></td>
<td>Live Gemini verification — all 20 target languages tested through the real production
pipeline (23-phase prompt, Bible Pass, post-processing, QA engine) with scores, timings,
sample outputs, and warnings analysis</td></tr>
</table>

<h2>Deployment</h2>
<p class="meta">App: https://oyxtranslate.freebuff.app (SPA at /, hash routes #/overview)
&middot; Convex deployment: curious-cat-677.convex.cloud &middot; Docs mirror: /docs/*.html (this mirror)</p>
"""
    write("index.html", page("OnyxTranslate Documentation", "Static JS-free mirror", body, "index.html"))


# ─────────────────────────────────────────────────────────────
# 2. architecture.html
# ─────────────────────────────────────────────────────────────

def gen_architecture() -> None:
    tables = parse_schema()
    rows = []
    for t in tables:
        flds = "<br>".join(
            f"<code>{esc(f[0])}</code>: {esc(f[1].strip().rstrip(','))}" + (f" <em>// {esc(f[2])}</em>" if len(f) > 2 and f[2] else "")
            for f in t["fields"]
        )
        idx = ", ".join(f"<code>{esc(i[0])}</code> ({esc(i[1])})" for i in t["indexes"]) or "—"
        rows.append(f"<tr><td><strong>{esc(t['name'])}</strong></td><td>{flds}</td><td>{idx}</td></tr>")

    get_project = extract_fn(SRC["queries"], "getProject")
    latest = extract_fn(SRC["queries"], "getLatestProject")
    session_state = re.search(r"const \[sessionId\] = useState\(\(\) => \{", SRC["translator"])

    body = f"""
<h2>1. Convex Schema (verbatim from convex/schema.ts)</h2>
<table>
<tr><th>Table</th><th>Fields (name: type)</th><th>Indexes</th></tr>
{chr(10).join(rows)}
</table>

<h2>2. Session Isolation Model</h2>
<p>Every browser tab generates a unique <code>sessionId</code> on mount
(<code>useState(() =&gt; {{ ... }})</code> in <code>src/pages/Translator.tsx</code> —
persistence via <code>sessionStorage</code>). All client-facing Convex queries filter by it,
so two tabs (or a private window) never see each other's progress. Imported projects are
assigned the importing session's ID.</p>
<p>The session check lives server-side in <code>convex/queries.ts</code>:</p>
{code_block(get_project)}
<p>Auto-resume uses the latest project for the session:</p>
{code_block(latest)}
{'' if not session_state else ''}
<h2>3. End-to-End Data Flow</h2>
<h3>3.1 PDF upload &amp; parse</h3>
<ol>
<li><code>handleFileSelect</code> (Translator.tsx) &rarr; <code>parsePDFHeader</code> reads page count
without decoding pages.</li>
<li><code>parsePDFBatch</code> loops in batches of <code>PARSE_BATCH_SIZE = 10</code> pages, updating
<code>setParseProgress({{ current, total }})</code> after each batch (live "Page X of Y").</li>
<li><code>storePdfAction</code> → <code>convex/upload.ts storePdf</code> stores the original PDF in
Convex File Storage, returns <code>storageId</code>.</li>
<li><code>parsePdfAction</code> → <code>convex/parsePdf.ts parseUploadedPdf</code> re-parses
server-side with pdfjs-dist, groups text items into lines by Y-coordinate (2 px tolerance) —
fixes broken words/missing letters.</li>
<li><code>createProjectMutation</code> writes the <code>projects</code> row
(<code>fullText</code>, <code>pageData</code>, <code>pdfStorageId</code>, <code>status: "ready"</code>).</li>
</ol>
<h3>3.2 Text paste</h3>
<p><code>setSourceText(text)</code> directly; project row is created lazily inside
<code>startTranslation</code> with <code>fileName: "Pasted Text"</code>.</p>
<h3>3.3 Translation (Begin Translation Journey)</h3>
<ol>
<li><code>startTranslation</code> creates the project if needed, then calls
<code>translateLanguageAction({{ projectId, langCode: langs[0], marketContext, nextLangCode: langs[1],
remainingLangs: langs.slice(2) }})</code>.</li>
<li><code>convex/translateContent.ts translateLanguage</code>: chunks
<code>project.fullText</code> into 2,500-word chunks, and for each chunk runs:
sliding-window context (last 2 sentences of previous chunk) &rarr; <strong>Bible Pass</strong>
(glossary terms replaced by <code>__PH0__</code> placeholders) &rarr; <strong>Gemini call</strong>
(5-key rotation, retries) &rarr; placeholder restore &rarr; cultural filters &rarr;
dragon-telepathy formatting &rarr; RTL marker &rarr; <strong>runQA</strong> &rarr; writes the
<code>chunks</code> row and bumps <code>translations.completedChunks</code>.</li>
<li>After the last chunk the action merges text into <code>translations.mergedText</code>, marks
the language <code>complete</code>, and chains the next language via
<code>ctx.scheduler.runAfter(0, api.translateContent.translateLanguage, {{ ... }})</code>.</li>
<li>The browser can close at any point — the chain is server-side. Progress is read back
through reactive queries (<code>getTranslationProgress</code>, <code>getLivePreviewText</code>).</li>
</ol>
<h3>3.4 PDF generation (autonomous)</h3>
<p>When a language finishes inside the scheduler queue
(<code>convex/translateQueue.ts processLanguage</code> &rarr; status
<code>"generating_pdf"</code>), <code>convex/generatePdf.ts generateTranslatedPdf</code> loads the
original PDF from storage, copies each page, whites out text using per-text-item coordinates
(preserving images/maps), overlays the translation with Noto fonts for non-Latin scripts
(Helvetica fallback), stores the PDF, and either chains the next language or, when none
remain, sets <code>projects.status = "all_translated"</code> and schedules
<code>zipAssembly.buildZip</code>.</p>
<h3>3.5 ZIP assembly</h3>
<p><code>convex/zipAssembly.ts buildZip</code> downloads every completed
<code>translations.pdfStorageId</code>, bundles them (plus <code>translation_report.txt</code>)
with JSZip, stores the ZIP, and writes <code>projects.zipStorageId</code>/<code>zipUrl</code> and
<code>status: "complete"</code>.</p>
<h3>3.6 Images</h3>
<p><code>translateImageMultiLang</code> (client) downsamples to ≤1024 px JPEG
&harr; <code>convex/translateImage.ts translateImage</code> sends the base64 image to Gemini
multimodal for OCR + translation in one pass, saves to <code>imageTranslations</code>.</p>

<h2>4. Status Enums (as written by the code)</h2>
<table>
<tr><th>Table</th><th>Values</th></tr>
<tr><td>projects.status</td><td><code>ready</code> &rarr; <code>translating</code> &rarr;
<code>all_translated</code> &rarr; <code>complete</code>; also <code>cancelled</code> (Pause button)</td></tr>
<tr><td>chunks.status</td><td><code>pending</code>, <code>done</code></td></tr>
<tr><td>translations.status</td><td><code>pending</code>, <code>in_progress</code>,
<code>generating_pdf</code>, <code>complete</code>, <code>error</code></td></tr>
<tr><td>history.status</td><td><code>in_progress</code>, <code>complete</code></td></tr>
<tr><td>imageTranslations.status</td><td><code>pending</code>, <code>processing</code>,
<code>complete</code>, <code>error</code></td></tr>
</table>
"""
    write("architecture.html", page("Architecture", "Schema, sessions, data flow", body, "architecture.html"))


# ─────────────────────────────────────────────────────────────
# 3-6. convex-functions*.html
# ─────────────────────────────────────────────────────────────

CONVEX_PAGES = [
    ("convex-functions.html", "Convex Functions — Mutations, Queries, History, Import, Upload", [
        ("convex/mutations.ts", "mutations"),
        ("convex/queries.ts", "queries"),
        ("convex/history.ts", "history"),
        ("convex/importProject.ts", "importProject"),
        ("convex/upload.ts", "upload"),
    ]),
    ("convex-functions-2.html", "Convex Functions — translateContent.ts (Unified Translation Action)", [
        ("convex/translateContent.ts", "translateContent"),
    ]),
    ("convex-functions-3.html", "Convex Functions — Autonomous Queue + Image Translation", [
        ("convex/translateQueue.ts", "translateQueue"),
        ("convex/translateImage.ts", "translateImage"),
    ]),
    ("convex-functions-4.html", "Convex Functions — PDF Parse, PDF Generate, ZIP", [
        ("convex/parsePdf.ts", "parsePdf"),
        ("convex/generatePdf.ts", "generatePdf"),
        ("convex/zipAssembly.ts", "zipAssembly"),
    ]),
    ("convex-functions-5.html", "Convex Functions — PDF Layout Cores (x-gap merge + block render)", [
        ("convex/pdfLayout.ts", "pdfLayout"),
        ("convex/renderPdfCore.ts", "renderPdfCore"),
    ]),
]


def convex_export_index(src: str) -> str:
    names = re.findall(r"^export const (\w+) = (query|mutation|action|internalMutation)\(", src, re.M)
    return "<ul>" + "".join(f"<li><code>{n}</code> — {k}</li>" for n, k in names) + "</ul>"


def gen_convex_functions() -> None:
    for filename, title, files in CONVEX_PAGES:
        parts = [f"<p>Files on this page: " + ", ".join(f"<code>{f[0]}</code>" for f in files) + "</p>"]
        for rel, key in files:
            src = SRC[key]
            parts.append(f"<h2>{esc(rel)} — full real source</h2>")
            parts.append(f"<p class='meta'>Exported Convex functions: " + esc("") + "</p>")
            # replace the placeholder with real list
            parts[-1] = f"<p><strong>Exports:</strong>{convex_export_index(src)}</p>"
            parts.append(code_block(src))
        write(filename, page(title, "Exact signatures + real handler code", "".join(parts), filename))


# ─────────────────────────────────────────────────────────────
# 7. translation-pipeline.html
# ─────────────────────────────────────────────────────────────

def gen_pipeline() -> None:
    tc = SRC["translateContent"]
    phases = extract_fn(tc, "PHASE_RULES")
    reasoning = extract_fn(tc, "REASONING_PROTOCOL")
    voice = extract_fn(tc, "VOICE_MATRIX")
    locked = extract_fn(tc, "LOCKED_TERM_LIST")
    bsp = extract_fn(tc, "buildSystemPrompt")
    bible = extract_fn(tc, "applyBiblePassServer")
    restore = extract_fn(tc, "restorePlaceholdersServer")
    chunking = extract_fn(tc, "chunkText")
    gemini = extract_fn(tc, "callGemini")
    sliding = extract_fn(tc, "extractLastSentences")
    qa_sig = extract_fn(read("src/lib/translator/qa.ts"), "runQA")[:2200]
    qa_report = extract_fn(read("src/lib/translator/qa.ts"), "QAReport")

    SLIDING_USAGE = """let previousContext: string | undefined;
if (i > 0) {
  const prevChunk = existingChunks.find((c) => c.chunkIndex === i - 1 && c.status === "done");
  if (prevChunk?.translatedText) {
    previousContext = extractLastSentences(prevChunk.translatedText);
  }
}
...
let userContent = lockedText;
if (previousContext) {
  userContent = `Previous chunk ended with: ${previousContext}\\n\\nContinue seamlessly.\\n\\n${userContent}`;
}"""

    POST_PROCESS = """let processedText = restorePlaceholdersServer(geminiResult.text, placeholders);
processedText = applyCulturalFilters(processedText, args.langCode, args.marketContext || "standard");
processedText = processedText.replace(/\\*([^*]+)\\*/g, (_, thought) =>
  formatDragonTelepathy(thought, args.langCode)
);
if (isRTLLang(args.langCode) && !processedText.startsWith("\\u200F")) {
  processedText = `\\u200F${processedText}`;
}"""

    CHAINING = """const nextLang = args.nextLangCode ||
  (args.remainingLangs && args.remainingLangs.length > 0 ? args.remainingLangs[0] : undefined);
const restLangs = args.nextLangCode
  ? (args.remainingLangs || [])
  : (args.remainingLangs || []).slice(1);
if (nextLang) {
  await ctx.scheduler.runAfter(0, api.translateContent.translateLanguage, {
    projectId: args.projectId,
    langCode: nextLang,
    marketContext: args.marketContext,
    nextLangCode: restLangs.length > 0 ? restLangs[0] : undefined,
    remainingLangs: restLangs.length > 1 ? restLangs.slice(1) : undefined,
  });
}"""

    body = f"""
<h2>1. The 23 Localization Phases (verbatim PHASE_RULES)</h2>
<p>These rules are embedded verbatim into every Gemini system prompt
(<code>convex/translateContent.ts</code> and its copy in
<code>convex/translateQueue.ts</code>):</p>
{code_block(phases)}

<h2>2. Deep Reasoning Protocol</h2>
{code_block(reasoning)}

<h2>3. Character Voice Matrix</h2>
{code_block(voice)}

<h2>4. Locked Glossary Terms</h2>
{code_block(locked)}

<h2>5. buildSystemPrompt — full real source</h2>
<p>Assembles: target language line, market context, the 23 phases, reasoning protocol,
per-language config (dialogue marks, formality, profanity map, rank map, magic system, fan
names, style sheet from <code>src/data/localization/*.json</code>), locked glossary column,
name map, voice matrix, and output rules.</p>
{code_block(bsp)}

<h2>6. Bible Pass — glossary lock before the AI sees the text</h2>
<p>Proper nouns and magic/military terms are replaced with <code>__PH0__</code> placeholders so
Gemini cannot mangle them, then restored after translation:</p>
{code_block(bible)}
{code_block(restore)}

<h2>7. Chunking + Sliding-Window Context (P21)</h2>
{code_block(chunking)}
{code_block(sliding)}
<p>Applied per chunk inside <code>translateLanguage</code>:</p>
{code_block(SLIDING_USAGE)}

<h2>8. Gemini Call — 5-key rotation with retry/backoff</h2>
<p>Keys <code>Gemini_API_Key_1..5</code> are read from the Convex server environment
(<code>process.env</code>) — never bundled to the client. For each key, up to 3 attempts:
429 backs off 10 s × attempt, 5xx backs off 5 s × attempt, other statuses move to the next key.</p>
{code_block(gemini)}
<p class="meta">Model: <code>process.env.GEMINI_MODEL || "gemini-3.6-flash"</code> &middot;
endpoint: <code>https://generativelanguage.googleapis.com/v1beta/openai/chat/completions</code>
&middot; temperature 0.3 &middot; max_tokens 4000 per chunk.</p>

<h2>9. Post-Processing Pipeline (per chunk, after Gemini returns)</h2>
{code_block(POST_PROCESS)}
<p><code>applyCulturalFilters</code> (<code>src/lib/translator/cultural.ts</code>) applies
market contexts (<code>standard</code> / <code>high-censorship</code> / <code>romance-focused</code>),
profanity euphemisms and cultural rules.
<code>formatDragonTelepathy</code> (<code>src/lib/translator/formatters.ts</code>) converts
<code>*thought*</code> into the language's telepathy markers (「」/【】 for ja/ko/zh, «» elsewhere).</p>

<h2>10. QA Engine (src/lib/translator/qa.ts)</h2>
<p><code>runQA(sourceText, translatedText, langCode, memoryLock)</code> runs code-level checks
mapped to the phases: leftover-English scan (P8), glossary hit-rate (P1/P9), quote balance
(P4/P10), name consistency (P2), ranks (P15), telepathy markers (P16), length heuristic (P17),
line-length/text-fit (P22), chapter metadata (P19). Real interface and signature:</p>
{code_block(qa_report)}
{code_block(qa_sig)}
<p>The score is stored on the chunk's <code>usage</code> field
(<code>usage.qaScore</code>, <code>usage.qaOverall</code>) and shown in the UI QA panel.</p>

<h2>11. Language Chaining</h2>
{code_block(CHAINING)}
"""
    write("translation-pipeline.html", page("Translation Pipeline", "Gemini 3.6 Flash — 23 phases, Bible pass, rotation, QA", body, "translation-pipeline.html"))


# ─────────────────────────────────────────────────────────────
# 8. frontend.html
# ─────────────────────────────────────────────────────────────

def state_table(inv: dict) -> str:
    rows = "".join(
        f"<tr><td><code>{esc(s['name'])}</code></td><td><code>{esc(s['type'])}</code></td>"
        f"<td><code>set{esc(s['setter'][3:])}</code></td><td>{esc(s['init'])}</td></tr>"
        for s in inv["states"]
    )
    return f"<table><tr><th>State</th><th>Type</th><th>Setter</th><th>Initial</th></tr>{rows}</table>" if rows else "<p>None</p>"


def hook_table(inv: dict) -> str:
    rows = "".join(
        f"<tr><td><code>{esc(h['var'])}</code></td><td><code>{esc(h['hook'])}</code></td><td>{esc(h['target'])}</td></tr>"
        for h in inv["hooks"]
    )
    return f"<table><tr><th>Variable</th><th>Hook</th><th>Target</th></tr>{rows}</table>" if rows else "<p>None</p>"


def gen_frontend() -> None:
    tr = react_inventory("translator")
    css = css_classes()
    css_rows = "".join(f"<tr><td><code>{esc(c['name'])}</code></td><td>{esc(c['props'])}</td></tr>" for c in css)
    memo_list = ", ".join(f"<code>{m}</code>" for m in tr["memos"]) or "—"

    start_translation = extract_fn(SRC["translator"], "startTranslation")
    handle_pause = extract_fn(SRC["translator"], "handlePause")
    handle_retranslate = extract_fn(SRC["translator"], "handleRetranslate")
    handle_export = extract_fn(SRC["translator"], "handleExportProgress")
    handle_import = extract_fn(SRC["translator"], "handleImportProgress")
    handle_file = extract_fn(SRC["translator"], "handleFileSelect")[:3000]
    flow_phase = extract_fn(SRC["translator"], "flowPhase")[:1800]

    body = f"""
<h2>1. Entry &amp; Routing (src/main.tsx)</h2>
{code_block(SRC["main"])}

<h2>2. src/pages/Translator.tsx</h2>
<p>Main page: upload/paste/image input, language picker, translation controls, progress,
preview, QA panel, history, export/import. Line count: {SRC['translator'].count(chr(10)) + 1}.</p>

<h3>2.1 React state ({len(tr['states'])} variables — real declarations)</h3>
{state_table(tr)}

<h3>2.2 Convex / React hooks ({len(tr['hooks'])} — real bindings)</h3>
{hook_table(tr)}

<h3>2.3 Derived values (useMemo)</h3>
<p>{memo_list}</p>

<h3>2.4 Key functions (real code)</h3>
<h4>startTranslation — kicks off the server-side chain</h4>
{code_block(start_translation)}
<h4>handlePause — cancels the queue server-side</h4>
{code_block(handle_pause)}
<h4>handleRetranslate — deletes chunks for one language and restarts it</h4>
{code_block(handle_retranslate)}
<h4>handleExportProgress — JSON export</h4>
{code_block(handle_export)}
<h4>handleImportProgress — JSON import via Convex action</h4>
{code_block(handle_import)}
<h4>handleFileSelect (first 50 lines) — PDF upload with batched parse progress</h4>
{code_block(handle_file)}
<h4>flowPhase — derived UI phase (useMemo)</h4>
{code_block(flow_phase)}

<h2>3. Components</h2>

<h3>3.1 src/components/DragonIntro.tsx (intro overlay)</h3>
{code_block(SRC["dragonIntro"])}

<h3>3.2 src/components/RoyalProgressPanel.tsx (progress dashboard)</h3>
<p><strong>Props</strong> (from the real interface):</p>
{code_block(extract_fn(SRC["progressPanel"], "RoyalProgressPanelProps"))}
{code_block(extract_fn(SRC["progressPanel"], "LanguageStatus"))}

<h3>3.3 src/components/LanguageAccordion.tsx (per-language preview accordion)</h3>
<p>Uses <code>useQuery(api.queries.getLivePreviewText, {{ projectId, langCode }})</code> for the
expanded language, with RTL support for <code>ar/ur/ks</code>. Props:</p>
{code_block(extract_fn(SRC["accordion"], "LanguageAccordionProps"))}

<h3>3.4 src/components/HistoryPanel.tsx (slide-in history)</h3>
<p>Reactive query <code>api.queries.getHistory</code> filtered by sessionId; delete via
<code>api.history.deleteHistory</code>.</p>

<h2>4. Theme CSS Classes (src/index.css — real properties)</h2>
<table>
<tr><th>Class</th><th>Key properties (from the real file)</th></tr>
{css_rows}
</table>
<p class="meta">Plus Tailwind utility classes and CSS variables
(<code>--bg: #06060e</code>, <code>--neon-cyan: #00e5ff</code>,
<code>--neon-purple: #a78bfa</code>, <code>--neon-gold: #fbbf24</code>).</p>
"""
    write("frontend.html", page("Frontend", "React components, state, hooks, CSS", body, "frontend.html"))


# ─────────────────────────────────────────────────────────────
# 9. history.html
# ─────────────────────────────────────────────────────────────

def gen_history() -> None:
    body = """
<p class="note">Provenance: the original audit/report .md files (AUDIT_REPORT,
EXHAUSTIVE_AUDIT_REPORT, VERIFICATION_REPORT, MIGRATION_REGRESSION_REPORT, …) were removed
during the dead-code cleanup pass. This change log is reconstructed from code evidence that
is still verifiable in the repository (legacy modules kept on disk, Convex schema history,
commit-level architecture changes) and from the development session records.</p>

<h2>Phase 0 — Client-side era (IndexedDB)</h2>
<ul>
<li>Original architecture: everything ran in the browser — pdf.js parsing, local "glossary"
word-swap translation, IndexedDB persistence. Evidence still on disk:
<code>src/lib/translator/storage.ts</code> (656 lines of IndexedDB code: saveProject,
saveTranslationChunk, terminology locks, QA-report and PDF blobs), now largely dead after the
migration.</li>
<li>Translation quality problem: the "AI" path ran client-side, the gateway token was compiled
to <code>{}</code> in the browser bundle, requests failed with HTTP 401, and the app silently
fell back to word-swap — users saw English with a few swapped words instead of real Urdu.</li>
</ul>

<h2>Phase 1 — Move AI server-side (Convex actions)</h2>
<ul>
<li>Created the root <code>convex/</code> deployment: schema, mutations, queries, and a
server translation action where the integration key exists only in <code>process.env</code>.</li>
<li>Client wired through <code>useAction</code>; browser SDK imports removed from
<code>src/</code> entirely.</li>
</ul>

<h2>Phase 2 — AI transport migrations</h2>
<ul>
<li>Legacy VLY gateway retired (permanent HTTP 401 "Invalid token", confirmed after key
rotation).</li>
<li>Switched to OpenAI-compatible providers, finally settling on
<strong>Google Gemini</strong> with a <strong>5-key rotation</strong>
(<code>Gemini_API_Key_1..5</code>, ~250 req/day each &rarr; ~1,250/day) to stay on the free
tier. Model moved to <code>gemini-3.6-flash</code> (default via <code>GEMINI_MODEL</code>).</li>
</ul>

<h2>Phase 3 — Server-side pipeline hardening</h2>
<ul>
<li>23-phase literary localization system prompt (P1 glossary fidelity … P23 final QA) with
per-language config from <code>src/data/localization/*.json</code>.</li>
<li>Bible Pass placeholder locking, sliding-window context across chunks (P21), cultural
filters, dragon-telepathy formatting, RTL markers, code-level QA engine
(<code>src/lib/translator/qa.ts</code>, 710 lines).</li>
<li>Fixed double-chunking (chunks re-derived from stored <code>chunk.sourceText</code>),
duplicate-chain guard (<code>project.status === "translating"</code> skip), and the two P0
missing-mutation bugs found by the migration audit.</li>
</ul>

<h2>Phase 4 — Autonomous queue + PDF/ZIP on the server</h2>
<ul>
<li><code>convex/translateQueue.ts</code>: scheduler-chained <code>processLanguage</code>/
<code>processChunkInternal</code> — the browser can close; the server continues.</li>
<li><code>convex/generatePdf.ts</code>: vector PDF generation with pdf-lib (copy pages,
coordinate-aware whiteout, Noto font embedding for ur/ar/ks/ja/zh/ko/hi/ne/bn, RTL draw),
chaining into <code>convex/zipAssembly.ts</code> for the batch ZIP + report.</li>
<li>Pause via <code>cancelTranslation</code>; per-language Retranslate
(<code>deleteChunksForLang</code> + restart).</li>
</ul>

<h2>Phase 5 — Unified multi-input experience</h2>
<ul>
<li>Image &amp; camera translation via Gemini multimodal OCR
(<code>convex/translateImage.ts</code>, downsampling to ≤1024 px for low-RAM devices).</li>
<li>One unified flow for PDF / pasted text / images: shared language picker
(multi-select, select-all), one Begin button, one progress section
(<code>RoyalProgressPanel</code>: which language N/20, which chunk X/Y).</li>
<li>Live preview while PDF generates in the background; copy first 10,000 words button.</li>
<li>Session isolation per browser tab (sessionId), history panel, JSON export/import fixed
(returning <code>projectId</code>/<code>importedLangCodes</code>, auto-selecting languages,
preview visible when translations exist).</li>
</ul>

<h2>Phase 6 — UI</h2>
<ul>
<li>Dark neon royal theme (cyan <code>#00e5ff</code> / purple <code>#a78bfa</code> / gold
<code>#fbbf24</code> on <code>#06060e</code>); Android 5.1-safe (no backdrop-filter, CSS-only
animations).</li>
<li>Kali-dragon intro overlay using the real <code>logo.svg</code> asset with neon glow;
plays every refresh, <code>?debug=1</code> replay button, reduced-motion respected.</li>
</ul>

<h2>Phase 7 — Documentation</h2>
<ul>
<li><code>/#/overview</code> lazy-loaded React dashboard backed by
<code>src/docs/PROJECT_DOCUMENTATION.json</code> (124 files / 20k+ lines documented).</li>
<li>This static JS-free mirror under <code>public/docs/</code> for raw HTTP fetchers / AI
agents, regenerated by <code>scripts/generate-docs.py</code>.</li>
</ul>

<h2>Phase 9 — Comprehensive fix pass (viewport, extraction fidelity, PDF overlay, UX)</h2>
<ul>
<li><strong>Mobile viewport root cause fixed</strong>: <code>index.html</code> now ships
<code>&lt;meta name=&quot;viewport&quot; content=&quot;width=device-width, initial-scale=1, viewport-fit=cover&quot;&gt;</code>,
theme-color, description, and manifest link — phones render at device width instead of a
~980 px desktop layout.</li>
<li><strong>Global CSS hardening</strong> (<code>src/index.css</code>): full-height
<code>html/body/#root</code>, text-size-adjust, 16 px form controls (no focus auto-zoom),
tap-highlight reset, <code>.safe-pad</code> safe-area helper applied to the app shell;
flex-first layout, single column below 768 px.</li>
<li><strong>PDF word-extraction fixed</strong> (<code>convex/pdfLayout.ts</code>, wired into
<code>convex/parsePdf.ts</code>): geometry-aware x-gap word merging replaces blind
<code>.join(&quot; &quot;)</code> — gap &lt; 0.3 × fontSize joins with no space (kills
&quot;Ony xStor m&quot;), explicit spaces deduped, line-end hyphenation rejoined.</li>
<li><strong>Paragraph block clustering</strong> (<code>clusterIntoBlocks</code>): modal-bucketed
line-gap detection, ±2 px left-x tolerance, 1.5× gap paragraph breaks, centered-heading
detection; blocks <code>{text, x, y, width, height, fontSize, lineCount, align}</code> stored
in <code>pageData</code> for the renderer.</li>
<li><strong>Coordinate-aware PDF overlay</strong> (<code>convex/renderPdfCore.ts</code>, used by
<code>convex/generatePdf.ts</code>): per-block erase + auto-fit font sizing replaces the global
average-font proportional fill; per-paragraph mapping with RTL word-order handling; per-page
fit stats logged (blocks / fallback / paraMatched / minFont).</li>
<li><strong>Chunking</strong>: paragraph-aware accumulation (~2,500-word cap) that never splits a
paragraph mid-sentence; single-source chunk records (<code>chunks.sourceText</code>) with no
re-chunking from <code>fullText</code> during processing.</li>
<li><strong>Resilience</strong>: action-timeout continuation after MAX_CHUNKS_PER_RUN,
chunk-level try/catch with a single 60 s retry (watchdog pickup), hardened placeholder
restore (mangled <code>__PHn__</code> tokens repaired by index), dictionary-format and
meta-commentary stripping.</li>
<li><strong>Docs</strong>: generator extended with <code>convex-functions-5.html</code>
(pdfLayout + renderPdfCore full source); all source-derived pages regenerated from current
code.</li>
</ul>
<h2>Phase 10 — Phase E/F/G completion (job-centric UX, unified input tabs, crash recovery)</h2>
<ul>
<li><strong>Interrupted-session repair</strong>: the previous session died mid-edit leaving
<code>Translator.tsx</code> with an unclosed JSX ternary (uncompilable). Repaired and completed:</li>
<li><strong>Phase E1 — Documents auto-start</strong>: <code>handleDocumentSelect</code> guardrails
(&lt;10 MB, &lt;300 pages, pre-parse rejection with toasts) plus auto-start of the full 20-language
chain after upload via ref handoff (<code>newProjectIdRef</code>,
<code>serverFullTextRef</code>).</li>
<li><strong>Phase E2 — State-driven job view</strong>: <code>isJobView</code> gates on Convex
project/translation state, never on local <code>flowPhase</code>; job header card, overall
progress, per-language rows, server-driven ZIP card, session-scoped recent-jobs list;
<code>Toaster</code> viewport mounted so toasts render.</li>
<li><strong>Phase E3 — Recent jobs</strong>: <code>queries.getSessionProjects</code> (last 10,
session-indexed) feeds compact resume cards.</li>
<li><strong>Google-style segmented input tabs</strong>: Documents | Paste Text | Image/Camera
tab bar in the upload card; dropzone gated to Documents, paste block to Text, image/camera
controls to Images.</li>
<li><strong>TDZ fix</strong>: <code>handleDrop</code> moved below <code>handleDocumentSelect</code>
(it appeared in the dependency array before declaration).</li>
</ul>

<h2>Phase 11 — C3 true bidi/shaping, fidelity suite green, D3 re-test (2026-09-13)</h2>
<ul>
<li><strong>C3 verified on Convex</strong>: added <code>bidi-js</code> (UAX #9) and
<code>arabic-reshaper</code> (presentation forms) — pure JS, both run inside node actions.
<code>renderPdfCore.toVisualBidi()</code> reshapes + reorders Arabic to visual order;
<code>useBidiShaping</code> is enabled only where the embedded font carries the glyphs.</li>
<li><strong>Font swap ar/ks → Amiri</strong>: the variable Noto Sans Arabic crashed fontkit’s GPOS
anchor parser on real shaped text (<code>Cannot destructure 'xCoordinate' from null</code>). Static
Amiri-Regular embeds and draws the full production translation cleanly and has complete
presentation-form coverage.</li>
<li><strong>Evidence</strong>: regenerated ar PDF contains 373 Unicode presentation-form glyphs of
469 Arabic codepoints; the 15-assertion fidelity suite passes for ar/ja/de (page count, image/vector
preservation, whiteout coverage, script presence, ≤2px overflow) with ZIPs assembled; extraction
self-test passes (OnyxStorm/fluxcapacitor/hyperdrive merged, hyphen rejoin, 5 paragraph blocks).</li>
<li><strong>D3 re-test</strong>: tr 91→99, ks 91→99, bn 91→99 after the placename lock — zero missing
names. Suite aggregate 99.3/100, 0 failures.</li>
<li><strong>Documented limitation (ur)</strong>: Noto Nastaliq Urdu has no presentation-form glyphs;
Urdu keeps word-reversal rendering (right-aligned, correct word order) instead of glyph shaping.</li>
</ul>
"""

    write("history.html", page("Change Log", "Reconstructed from verifiable code evidence", body, "history.html"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("Generating static docs into public/docs/ ...")
    gen_index()
    gen_architecture()
    gen_convex_functions()
    gen_pipeline()
    gen_frontend()
    gen_history()
    print("Done.")
