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
    "upload": read("convex/upload.ts"),
    "identity": read("convex/identity.ts"),
    "jobMutations": read("convex/jobMutations.ts"),
    "jobProcessing": read("convex/jobProcessing.ts"),
    "importJob": read("convex/importJob.ts"),
    "exportProject": read("convex/exportProject.ts"),
    "artifactMutations": read("convex/artifactMutations.ts"),
    "http": read("convex/http.ts"),
    "crons": read("convex/crons.ts"),
    "translateContent": read("convex/translateContent.ts"),
    "translateQueue": read("convex/translateQueue.ts"),
    "translateImage": read("convex/translateImage.ts"),
    "parsePdf": read("convex/parsePdf.ts"),
    "generatePdf": read("convex/generatePdf.ts"),
    "zipAssembly": read("convex/zipAssembly.ts"),
    "pdfLayout": read("convex/pdfLayout.ts"),
    "renderPdfCore": read("convex/renderPdfCore.ts"),
    "translator": read("src/pages/Translator.tsx"),
    "fixPassReport": read("src/components/FixPassReport.tsx"),
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
    ("convex-functions.html", "Convex Functions — Mutations, Queries, History, Upload, Identity, HTTP", [
        ("convex/mutations.ts", "mutations"),
        ("convex/queries.ts", "queries"),
        ("convex/history.ts", "history"),
        ("convex/upload.ts", "upload"),
        ("convex/identity.ts", "identity"),
        ("convex/jobMutations.ts", "jobMutations"),
        ("convex/importJob.ts", "importJob"),
        ("convex/exportProject.ts", "exportProject"),
        ("convex/artifactMutations.ts", "artifactMutations"),
        ("convex/http.ts", "http"),
        ("convex/crons.ts", "crons"),
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

<h3>3.1 src/components/FixPassReport.tsx (A–G fix-pass report panel)</h3>
<p>Deep static report rendered at <code>/#/overview</code> (Docs → ⚡ Live Tests → 📋 Fix Report):
phase A–G table, 12-item verification checklist, extraction self-test output, ar/ja/de fidelity
assertions, C3 bidi/shaping deep dive, D3 score table, deviations. All data from the real runs.</p>

<h3>3.2 src/components/DragonIntro.tsx (intro overlay)</h3>
{code_block(SRC["dragonIntro"])}

<h3>3.3 src/components/RoyalProgressPanel.tsx (progress dashboard)</h3>
<p><strong>Props</strong> (from the real interface):</p>
{code_block(extract_fn(SRC["progressPanel"], "RoyalProgressPanelProps"))}
{code_block(extract_fn(SRC["progressPanel"], "LanguageStatus"))}

<h3>3.4 src/components/LanguageAccordion.tsx (per-language preview accordion)</h3>
<p>Uses <code>useQuery(api.queries.getLivePreviewText, {{ projectId, langCode }})</code> for the
expanded language, with RTL support for <code>ar/ur/ks</code>. Props:</p>
{code_block(extract_fn(SRC["accordion"], "LanguageAccordionProps"))}

<h3>3.5 src/components/HistoryPanel.tsx (slide-in history)</h3>
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

<h2>Phase 12 — UNDO regression pass: upload / import / export / limits (2026-09-14)</h2>
<ul>
<li><strong>Why</strong>: the mega pass rebuilt the client handlers and broke what already worked in the real
browser (upload did nothing, import/export unresponsive) while all server-side tests kept passing because they
call the pipeline directly (<code>api.liveTest</code>) and never exercise the UI.</li>
<li><strong>FIX 1 — upload restored</strong>: <code>handleDocumentSelect</code> (guardrail wrapper with
ref-handoff auto-start) removed; <code>handleFileSelect</code> is again the single entry point for file input,
drop and <code>handleDocumentSelect</code>'s old slot, running the pre-mega sequence: parsePDFHeader →
parsePDFBatch → direct upload → <code>parseUploadedPdf</code> → <code>createProject</code> →
<code>setProjectId</code>; translation starts on the <em>Begin Translation</em> click (server-side chain
unchanged). Early-exit paths now log to console for diagnosability.</li>
<li><strong>FIX 2 — limits removed</strong>: the 10MB and 300-page rejection branches and toasts are deleted.
A non-blocking info toast ("Large file — translation will take longer") is shown for >10MB but processing
always continues. Hidden platform cap found and fixed: Convex actions reject arguments over 5MiB, so
<code>storePdf(pdfBase64)</code> could never carry a PDF larger than ~3.7MB — replaced by Convex direct upload
(<code>upload.generatePdfUploadUrl</code> → browser POST → <code>upload.finalizePdfUpload</code>), which has
no argument cap. <code>storePdf</code> kept for compatibility (now V8-runtime via atob).</li>
<li><strong>FIX 3 — import restored</strong>: on success the client sets projectId, selectedLangCodes,
first-language preview, resets error state, and toasts — no <code>isJobView</code> gating; visibility returns
to the pre-mega rule (<code>convexTranslations.length &gt; 0</code>).</li>
<li><strong>FIX 4 — export restored</strong>: unconditional with a project (idle, mid-translation, complete);
Blob → URL.createObjectURL → anchor click → revoke; JSON now includes project metadata, fullText, pageData,
parsedPages, per-language chunks (sourceText/translatedText), translations and langCodes. ZIP download stays
separate.</li>
<li><strong>FIX 5 — TDZ audit</strong>: <code>handleDrop</code> now references <code>handleFileSelect</code>
directly (declared above it), eliminating the use-before-declaration hazard entirely.</li>
<li><strong>Client-path verification (real browser)</strong>: headless Chromium (Playwright,
<code>scripts/clientPathTest.mjs</code>) against the dev app — 17/17 assertions pass across 5 stages:
upload (project row created, no auto-start, chip, Begin gating, Gemini round-trip for la), drag-and-drop,
large file (10.6MB/310p processed with info toast, no rejection), export (downloaded JSON keys:
type/version/exportedAt/langCodes/project/chunks/translations), import (fresh session: success toast,
la:complete restored, Begin visible). Zero uncaught page errors in every stage.</li>
</ul>

<h2>Phase 13 — Server-first Phase 2: identity, hybrid upload, server import/export (2026-09-14)</h2>
<ul>
<li><strong>Identity scheme</strong>: durable per-device <code>onyx-client-id</code> (localStorage) + per-tab
<code>onyx-tab-session-id</code> (sessionStorage); every project/job row stores BOTH. Live queries filter by
clientId+tabSessionId (two tabs stay isolated — C1 preserved); <code>getResumableJobs({clientId})</code> powers the
"Your jobs" list on reopen, and opening one ADOPTS it (<code>adoptJob</code> rebinds tabSessionId). Never shows
another device's jobs.</li>
<li><strong>Hybrid PDF upload (no artificial limits)</strong>: Path 1 (≤19MB) = ONE request to the new HTTP action
<code>uploadAndCreateJob</code> (convex/http.ts) — raw multipart POST → ctx.storage.store → uploadJob →
scheduled processing. Path 2 (&gt;19MB) = <code>createPendingUploadWithPath</code> → raw XHR POST to Storage
(progress %, cancel) → <code>finalizeUploadedPdf</code> → <code>beginProcessing</code>. Staging records
(IndexedDB) persisted BEFORE any network work → "Resume upload / Discard" on reopen; hourly cron sweeps orphans
(&gt;24h). Banned and absent: base64 file args, sendBeacon/keepalive for large files.</li>
<li><strong>Idempotent processing</strong>: <code>jobProcessing.processUploadedPdf</code> walks
uploaded → processing → parsed → ready → translating with a monotonic stageSeq gate (superseded retries no-op)
and heartbeats; reuses the production parser (x-gap merge + paragraph clustering) and the UNCHANGED translation
chain (translateContent → generatePdf → zipAssembly). Client-only work: file pick → raw POST → finalize
handshake. UploadJobCard shows % progress, per-stage chips, honest physics ("Safe to close" ONLY after the
server ACK; ~2-min POST timeout stated), and real errors verbatim with the job ID.</li>
<li><strong>Import</strong>: ONE POST to <code>uploadAndImport</code>; server validates
{type:"onyx-translate-project"} BEFORE any write (malformed/corrupt/incompatible → visible 400, zero partial
writes), restores project+fullText+pageData+chunks+translations, assigns current clientId with a NEW session,
returns jobId. Browser may close; the job appears in getResumableJobs.</li>
<li><strong>Export</strong>: <code>exportProject.buildExportArtifact</code> assembles the FULL JSON backup
server-side (metadata, fullText, pageData coordinates, parsedPages, chunks, translations incl. mergedText +
statuses, langCodes) → Convex Storage → URL; browser only anchor-clicks the download. Unconditional — works
idle, paused, mid-translation, complete. ZIP stays a separate flow, plus a new on-demand
<code>buildZipNow</code> for mid-flight ZIP assembly.</li>
<li><strong>Verification (deployed Convex, no mocks)</strong>: <code>scripts/phase2ServerTest.mjs</code> —
17/17 PASS: Path-1 upload of a real 5-page PDF → uploadJob → auto-parse → project row (711 words, 5 pageData
blocks, clientId+tabSessionId bound, chain auto-started server-side); duplicate submit with the same
idempotency key returns the SAME job; malformed import → 400 with zero partial writes; wrong-type import →
400; valid import → full restoration (fullText/chunks/translations/identity).</li>
</ul>

<h2>Phase 14 — Phase 3 client-path verification gate + ur/hi/ne/bn PDF font fixes (2026-09-15)</h2>
<ul>
<li><strong>Method</strong>: Playwright/headless-Chromium drove the REAL built app (vite preview of dist/,
staged harness <code>scripts/phase3ClientTest.mjs</code> with OS-supervised launcher
<code>scripts/phase3run.sh</code>). Server-only tests do not count; every assertion below came from the
browser path with screenshots in /tmp/onyx/shots/. Archive untouched: verify script 175/175 before and after.</li>
<li><strong>REAL client-path bugs found &amp; fixed</strong>: ① httpActions had NO CORS headers → every browser
XHR to /uploadAndCreateJob etc. was blocked (Node tests never saw it) — added ACAO + OPTIONS preflight.
② Export button silently did nothing: client called <code>issueExportToken</code> (a mutation) via
<code>useAction</code>, and <code>artifactMutations</code> looked up kind "onyx-translate-project-backup" while
artifacts are stored as "onyx-translate-project" — fixed hook + kind. Downloads now fetch the artifact as a
blob → same-origin object URL (cross-origin storage URLs ignore the download attribute).</li>
<li><strong>PDF font fixes (root-caused by local bisection, verified live)</strong>: the ur chain leg hung 20+ min
in generating_pdf. Root cause: fontkit's layout engine OOMs on Noto Nastaliq Urdu (static AND variable) on the
FIRST widthOfTextAtSize; the Devanagari/Bengali statics instead throw "regeneratorRuntime is not defined" from
fontkit's UMD GSUB code; the old variable google/fonts fonts crash with the known GPOS anchor error. Fixes:
ur → Amiri (proven shaped-Arabic font, covers Urdu presentation forms; true bidi shaping now enabled for ALL
RTL langs), hi/ne/bn → notofonts static TTFs + <code>import "regenerator-runtime/runtime"</code> in
generatePdf.ts, ja/zh/ko → noto-cjk static subset OTFs, and generateTranslatedPdf now CATCHES render errors,
marks the row error + message (no more silent infinite generating_pdf) and CONTINUES the language chain.</li>
<li><strong>Client-path results (all PASS)</strong>: T2 upload ≤19MB via file input — Path-1 POST fired once,
jobId shown, project row created, adopt+reopen via "Your jobs", export mid-translation + idle downloads valid
JSON (16/16). T3 &gt;20MB — createPendingUpload → XHR POST → finalize → same chain, honest "direct upload
(large file)" badge, no rejection (12/12 incl. T4 drag-drop + T8 two-tab isolation). T5 close-during-upload →
pending recovery Resume/Discard, retry without duplicates (3/3). T6 import valid + malformed → full restore /
visible 400 with zero partial records (6/6). T9 image/camera regression intact. T10 preservation — translated
PDF keeps the embedded image (image-ops=1), QA ran during chunk translation, ZIP assembled server-side and
downloads with PK magic (7/7). T11 static gates green: convex dev --once, tsc -b --noEmit, vite build;
forbidden-pattern greps clean (no base64 file args, no sendBeacon/keepalive, no 10MB/300-page limits, no
runtime _universal imports).</li>
</ul>

<h2>Phase 15 — Adaptive Parallel Translation Pipeline (quota-aware dispatcher, 2026-09-17)</h2>
<ul>
<li><strong>Why</strong>: the legacy chain was strictly sequential (1 chunk in flight) with fixed 10s sleeps per
429 attempt across 5 keys (up to ~150s dead sleep per chunk) and any thrown error silently killed the language
chain — hence ~40 min per chunk. All five Gemini keys share ONE Google project, so throughput cannot be
multiplied by keys; the pipeline now adapts to measured quota instead of assuming it.</li>
<li><strong>Central config</strong> (<code>convex/translationConfig.ts</code>): targetRpm 10 (ceiling 12),
dailyRequestBudget 1200 (Pacific-date keyed), workers 2, heartbeatTtl 3m, action safety deadline 20s, watchdog
every 3m, dispatcher tick 15s, maxAttempts 6, backoff 2s→120s with 25% jitter + Retry-After floor, pair merge
cap 6000 estimated tokens (+20% headroom, 4 chars/token), PDF batches 50→25→10 pages, claim budget 2/tick,
50 DB writes/action cap. These are OnyxTranslate's SAFE OPERATING TARGETS — not Google-official limits.</li>
<li><strong>Job model</strong>: <code>translationJobs</code> rows keyed <code>projectId:langCode:chunkIndex</code>
(idempotent — duplicate starts create zero new jobs), statuses pending→claimed→done/retry_wait/failed,
transactional claimToken claims (late workers with stale tokens lose), stale claims reclaimed after heartbeat
TTL, results written back into the EXISTING chunks/translations tables so merge → PDF → ZIP → export → preview
all keep working unchanged. <code>rateLimits</code> holds ONE rolling-60s window per project (all five keys = one
quota pool), slots counted ONLY when a request is actually sent. <code>pdfBatches</code> makes PDF generation
idempotent per page range.</li>
<li><strong>Dispatcher</strong> (<code>adaptiveJobs.ts</code> + <code>adaptiveDispatcher.ts</code>): bounded
self-rescheduling ticks (exit before the 20s action deadline), one Gemini request per claim, adjacent chunks
pair-merged when the safe token estimate fits (never truncated; oversized → single). 429 ladder: backoff with
jitter → worker reduction (3×429 → −1 worker, floor 1) → waiting_retry. 5xx/timeout retry with backoff;
401/403 rotate keys; malformed pairs save raw output, requeue both chunks as singles, circuit-break pairing per
language after 2 failures. Bible Pass (glossary lock) runs BEFORE the request — placeholders restored after,
identical to legacy. runQA + English-echo gate rejects wrong-language/garbage output (retry, never silently
done).</li>
<li><strong>Daily governor</strong>: at 1200 requests → governorState=daily_paused, all jobs preserved, auto-resume
after midnight Pacific (nominal gap computed server-side, counter resets on the Pacific date change). The UI
shows the honest state: "quota reached — auto-resumes HH:MM · progress saved, safe to close". Never reported as
a failure.</li>
<li><strong>PDF batching + watchdog</strong>: whole-book render stays default (proven fidelity); oversized books
that fail get idempotent 50→25→10-page batches (retry-then-shrink; a failed 10-page batch fails ONLY that batch
with its exact page range; restarts skip completed batches; stuck batches recovered by watchdog). A 3-min cron
watchdog promotes retryable jobs, reclaims expired claims, recovers stuck batches, and re-kicks a missing
dispatcher lease — the chain never dies silently. Stage progression stays monotonic (never backward).</li>
<li><strong>Feature flag + UI</strong>: <code>translationMode</code> legacy|adaptive_parallel on every project;
Begin runs adaptive first with a VISIBLE legacy fallback (console + toast); Resume is adaptive-aware; completed
chunks are never re-translated. Honest status strip: jobs done/total, waiting/failed counts, workers, RPM
target, requests today vs budget, quota-paused + auto-resume time, safe-to-close after server ACK — no fake
progress anywhere.</li>
<li><strong>Gates + honest limits</strong>: convex dev --once ✓ every phase, tsc -b --noEmit ✓, vite build ✓;
archive 175/175 SHA-256 verified before AND after; zero runtime _universal imports; no secrets in logs or
reports. Quota-free probes (estimator, pair parser, backoff, limiter refusal at target, governor stop/reset,
idempotent enqueue) ship in <code>adaptiveTestProbes.ts</code> + <code>scripts/verifyAdaptivePipeline.mjs</code>.
Measured RPM/429/retry counts and the honest 92×20 projection (1,840 calls ≈ 184 min floor at 10 rpm; pair
merge can roughly halve it; 2–4h plausible, NOT guaranteed) require a real run — pending deployment resume.</li>
<li><strong>Deployment migration (2026-09-18)</strong>: the platform deployment (<code>successful-iguana-419</code>) auto-paused with no user-side resume path — Convex pause skips crons and rejects every function call, the direct mechanism behind the 2026-09-16 freeze. The project was migrated to the owner-controlled deployment <code>trustworthy-clownfish-652</code> in the user's own Convex account: all functions pushed, all 5 Gemini keys migrated, frontend switched via the <code>src/lib/convexUrl.ts</code> runtime shim (stale baked env overridden). Proof gates then ran LIVE on the new deployment: T2/T3/T4/T5/T6 PASS, T1 mechanism PASS; T1 completion + T8 remain blocked ONLY by the Google free-tier quota pool (429 "exceeded your current quota" — valid auth proven by the 400-bad-key vs 429-deployment-key control probe). Forensic probe <code>convex/forensicProbe.ts</code> + <code>scripts/p0Forensic.mjs</code> deployed to capture the frozen 14/92 project's per-job state the moment functions run. Harness wait-scale (WSCALE) added to <code>scripts/proofGate.mjs</code> — client sleeps compressed, server work real. Gemini model default fixed to <code>gemini-3.6-flash</code> via <code>GEMINI_MODEL</code> — the retired model name probed earlier had produced a misleading 404 on top of the quota 429s.</li>
</ul>
"""

    write("history.html", page("Change Log", "Reconstructed from verifiable code evidence", body, "history.html"))



# ═══════════════════════════════════════════════════════════════════════
# OVERVIEW DASHBOARD STATIC MIRROR — same content as /#/overview, plain
# HTML (the chat-side verifier cannot execute JS). Regenerated on every
# docs build; hard-fails if any required constant/section goes missing.
# ═══════════════════════════════════════════════════════════════════════

import hashlib, json as _json
from datetime import datetime, timezone

REQUIRED_PIPELINE_COMPONENTS = [
    "Central config", "Job model + indexes", "Dispatcher", "Rate limiter",
    "Pair merge", "Daily governor", "Watchdog", "PDF batch generation",
    "ZIP assembly", "Feature flag (legacy | adaptive_parallel)",
    "UI truth (counters + states)", "Safe recovery (Resume Server Job)",
    "Translation quality (P4 layer)", "Dead-code audit (P6)",
]

REQUIRED_CONFIG_KEYS = [
    "targetRpm", "absoluteRpmCeiling", "dailyRequestBudget", "workerCount",
    "heartbeatTtlMs", "actionSafetyDeadlineMs", "watchdogIntervalMs",
    "dispatcherIntervalMs", "maxAttempts", "backoffBaseMs", "backoffMaxMs",
    "backoffJitterRatio", "pairMergeEnabled", "pairMergeMaxEstimatedInputTokens",
    "pairMergeHeadroomRatio", "estimatedCharsPerToken", "pdfInitialBatchPages",
    "pdfMinimumBatchPages", "pdfBatchShrinkFactor", "maxJobsClaimedPerDispatch",
    "maxDatabaseWritesPerAction", "staleProjectThresholdMs",
]


def gen_overview_dashboard(archive_result: str, archive_date: str, viewport_line: str) -> None:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    pipeline_rows = [
        ("Central config", "COMPLETE", "convex/translationConfig.ts:18",
         "TRANSLATION_CONFIG single source of truth; every value in Constants table below"),
        ("Job model + indexes", "COMPLETE", "convex/schema.ts:195 (translationJobs), :252 (pdfBatches), rateLimits",
         "idempotencyKey projectId:langCode:chunkIndex; by_idempotencyKey + by_project_status indexes (deployed 2026-09-17 14:28)"),
        ("Dispatcher", "COMPLETE (hardened)", "convex/adaptiveDispatcher.ts (dispatcherTick wrapper + dispatcherTickInner)",
         "ANY crash inside a tick is persisted (recordDispatcherError) and the chain self-reschedules \u2014 one malformed response can never kill the pipeline; heartbeat at tick start; no-keys retries instead of throwing; bounded 20s deadline, claim budget 2/tick"),
        ("Safe recovery (Resume Server Job)", "COMPLETE (code; live verify BLOCKED \u2014 deployment paused)", "convex/resumeServerProject.ts + src/pages/Translator.tsx (Resume Server Job button)",
         "resumeServerProject: preserves all completed chunks, promotes arrived retry_wait, reclaims ONLY expired-heartbeat claims, Pacific-date-only governor reset, never bypasses a valid quota pause, one transactional lease + fresh dispatcherTick; getServerJobStatus powers honest UI"),
        ("Rate limiter", "COMPLETE", "convex/adaptiveJobs.ts:422",
         "acquireRequestSlot: rolling-60s window, ONE project-level pool (5 keys = 1 Google project), slot counted only when a request is actually sent"),
        ("Pair merge", "COMPLETE", "convex/translationConfig.ts (estimateSafePairTokens/buildPairUserContent/extractPairSection) + convex/adaptiveJobs.ts:305",
         "claimJobPair merges adjacent chunks only under safe token cap (+20% headroom); malformed pairs saved raw + split into singles + per-language circuit break (markPairSplit)"),
        ("Daily governor", "COMPLETE (probe written; live run pending)", "convex/adaptiveJobs.ts (pacificDateKey/msUntilNextPacificMidnight) + convex/adaptiveTestProbes.ts:130",
         "probeGovernorLadder: 1199 allowed / 1200 pauses with resume time / Pacific date change resets — execution blocked by deployment pause"),
        ("Watchdog (PRIMARY driver)", "COMPLETE (hardened)", "convex/adaptiveWatchdog.ts (rewritten) + convex/crons.ts:24",
         "Cron every 3 min is the PRIMARY safety driver for BOTH modes: legacy projects revived via translateLanguage (the 14/92 incident gap \u2014 old watchdog skipped legacy rows), adaptive via dispatcher re-kick on expired lease or >10min no-activity; per-project try/catch (one broken project never stops others); watchdogLastRunAt/RecoveredAt/RecoveryCount/LastError persisted; platform honesty: cron is SKIPPED while the deployment is paused (docs.convex.dev)"),
        ("PDF batch generation", "COMPLETE", "convex/adaptivePdf.ts:62 (plan), :136 (shrink), :252 (slice), :294 (render)",
         "50\u219225\u219210 idempotent page batches; computeBatchParagraphSlice exactly mirrors renderPdfCore distribution walk; per-batch source-page slicing; assembleLanguagePdf merges batch PDFs into the language PDF"),
        ("ZIP assembly", "PRESERVED (unchanged)", "convex/zipAssembly.ts + convex/adaptiveJobs.ts:968",
         "adaptive path fires buildZip only via zipFinalizeIfDone when all languages terminal \u2014 never premature, never duplicated"),
        ("Translation quality (P4 layer)", "COMPLETE", "convex/languageRules.ts (LANGUAGE_RULES 20-lang punctuation table, filterGeneratedArtifacts, evaluateLanguageQA, assembleWithBoundaryRepair) \u2014 wired into translateContent post-processing, dispatcher QA gate, final merge (adaptiveJobs.flushJobResults)",
         "Removes ONLY proven generated metadata (\u3010Paragraph N\u3011 etc., evidence-logged); kills CJK-bracket pollution in non-CJK languages (ja/zh preserved); script-ratio/echo/delimiter/replacement-char/paragraph-parity QA; boundary repair at assembly; local fixture 46/46 PASS (ar/ur/ks/fr/de/hi/bn/ja/en)"),
        ("Dead-code audit (P6)", "COMPLETE", "removed: src/instrumentation.tsx, src/lib/translator/storage.ts, engine.ts, neural.ts (zero importers); voices.ts initially removed then RESTORED (convex imports it \u2014 archive-law copy-out)",
         "Legacy fallback intact; no VLY code or API keys in production bundle (grep-verified); all gates green after each removal group"),
        ("Feature flag (legacy | adaptive_parallel)", "COMPLETE", "convex/mutations.ts (updateProject args) + convex/adaptiveJobs.ts:1002",
         "translationMode on every project; Begin runs adaptive first with visible legacy fallback (src/pages/Translator.tsx:930); Resume is adaptive-aware (:1022); completed chunks never re-translated"),
        ("UI truth (counters + states)", "COMPLETE", "src/pages/Translator.tsx (serverJobStatus query, serverLangStats header, platform-pause strip)",
         "Header counters are SERVER-DERIVED (translationJobs per-language done/total \u2014 fixes the incident 'Translating (0/1)' + '0/20 languages' while Urdu was 14/92); honest states incl. 'Server job status not currently confirmed (hosting deployment may be paused)' + Resume Server Job; unconditional safe-to-close banner REMOVED"),
    ]
    missing = [c for c in REQUIRED_PIPELINE_COMPONENTS if c.split(" (")[0] not in " ".join(r[0] for r in pipeline_rows)]
    if missing:
        raise SystemExit(f"overview mirror: missing pipeline components {missing}")

    config_rows = [
        ("targetRpm", "10", "safe operating target (NOT a Google-official limit)"),
        ("absoluteRpmCeiling", "12", "never intentionally exceeded"),
        ("dailyRequestBudget", "1200", "Pacific-date keyed; lower automatically on real RPD evidence"),
        ("workerCount", "2", "initial adaptive workers"),
        ("heartbeatTtlMs", "180000 (3 min)", "claim staleness threshold"),
        ("actionSafetyDeadlineMs", "20000 (20 s)", "dispatcher exits before Convex action timeout"),
        ("watchdogIntervalMs", "180000 (3 min)", "cron interval (crons.ts:24)"),
        ("dispatcherIntervalMs", "15000 (15 s)", "normal next-tick delay"),
        ("maxAttempts", "6", "per job before failed"),
        ("backoffBaseMs", "2000", "exponential base"),
        ("backoffMaxMs", "120000", "cap"),
        ("backoffJitterRatio", "0.25", "jitter fraction of base"),
        ("pairMergeEnabled", "true", "adjacent-chunk merging"),
        ("pairMergeMaxEstimatedInputTokens", "6000", "safe ceiling for a merged request"),
        ("pairMergeHeadroomRatio", "0.20", "safety headroom on token estimate"),
        ("estimatedCharsPerToken", "4", "estimator divisor"),
        ("pdfInitialBatchPages", "50", "first batch size"),
        ("pdfMinimumBatchPages", "10", "shrink floor; a failed 10-page batch fails ONLY that batch"),
        ("pdfBatchShrinkFactor", "0.5", "50 \u2192 25 \u2192 10"),
        ("maxJobsClaimedPerDispatch", "2", "claim budget per tick"),
        ("maxDatabaseWritesPerAction", "50", "flush budget per action"),
        ("staleProjectThresholdMs", "600000 (10 min)", "project-level staleness"),
    ]
    missing_keys = [k for k in REQUIRED_CONFIG_KEYS if k not in " ".join(r[0] for r in config_rows)]
    if missing_keys:
        raise SystemExit(f"overview mirror: missing config keys {missing_keys}")

    measurement_rows = [
        ("Measured requests/min", "NOT YET MEASURED \u2014 proof run pending deployment resume"),
        ("Total 429s / 5xxs / retries", "NOT YET MEASURED \u2014 recorded per-run by probeRateSnapshot (adaptiveTestProbes.ts:89)"),
        ("Reclaimed jobs", "NOT YET MEASURED \u2014 watchdogTick returns counters per tick"),
        ("Pair vs single calls / malformed pairs", "NOT YET MEASURED \u2014 dispatcherTick returns pairCalls/singleCalls/malformedPairs per tick"),
        ("Avg + P95 request duration", "NOT YET MEASURED \u2014 durationsMs captured in probeRateSnapshot"),
        ("Projected wall-clock 92 chunks \u00d7 20 languages", "1,840 calls \u00f7 10 rpm \u2248 184 min floor WITHOUT pair merge; pair merge (\u22646000 safe tokens) can roughly halve requests \u2192 \u224892 min floor; retries + PDF + ZIP add overhead"),
        ("Does 1,200/day force an overnight pause?", "LIKELY for the full 92\u00d720 job if pair merge under-delivers (1,840 > 1,200): the governor pauses at 1,200, preserves all jobs, and auto-resumes after midnight Pacific. With effective pair merging (~920 calls) the job fits inside one day"),
    ]

    test_rows = [
        ("T1 Rate conformance (\u226510 min real run)", "PENDING", "\u2014 (harness ready: scripts/proofGate.mjs --stage=2; samples every 30s)"),
        ("T2 Governor 1199/1200/midnight-reset", "PENDING", "probeGovernorLadder deployed (adaptiveTestProbes.ts:130) \u2014 awaiting resume"),
        ("T3 Pair merge valid+malformed+oversized", "PENDING", "probePairParser + probeEstimator deployed \u2014 awaiting resume; live pair evidence from stage-2 run"),
        ("T4 Kill test / claim reclaim", "PENDING", "probeClaimAndAbandon deployed \u2014 3-min TTL + watchdog cron; awaiting resume"),
        ("T5 PDF batch shrink + resume + page count", "PENDING", "120-page generator in proofGate.mjs --stage=4 \u2014 awaiting resume"),
        ("T6 Offline / browser-close continuation", "PENDING", "proofGate.mjs --stage=5 (5 min zero client contact) \u2014 awaiting resume"),
        ("T7 Regressions (upload/translate/PDF/ZIP/import/export/image/paste)", "PENDING", "proofGate.mjs --stage=6 + Phase 3 suite passed 44/44 on 2026-09-15 \u2014 re-run pending"),
        ("T8 Measurement", "PENDING", "probeRateSnapshot durationsMs + samples \u2014 awaiting resume"),
        ("T9 Archive checksum", "PASS", archive_result),
        ("T10 Viewport meta in index.html", "PASS", viewport_line),
    ]

    governor_rows = [
        ("Requests used today", "0 (no live run since last pause \u2014 counter starts honest at 0)"),
        ("Pacific date key", "computed at run time (America/Los_Angeles, en-CA YYYY-MM-DD)"),
        ("Current state", "running (default) \u2014 no adaptive job active"),
        ("Next resume time", "n/a (not daily_paused); when paused, governorResumeAt = next midnight Pacific"),
    ]

    risk_rows = [
        ("Thin Motherboard Phase 4 (linguistic-code retirement) not started", "BY DESIGN - spec: delete only after gates pass; gemini_contract mode must pass REAL runtime tests (Phase 5) before applyBiblePassServer wrapping / placeholder insert-restore / languageRules transforms / artifact rewriter are retired from the ACTIVE path"),
        ("Proof-gate tests T1\u2013T8 not yet executed", "BLOCKING 'proven' status \u2014 deployment auto-paused mid-gate; all harnesses deployed (proofGate.mjs, verifyAdaptivePipeline.mjs, verifyP1P2.mjs, p0Forensic.mjs); run after resuming in dashboard"),
        ("Incident 2026-09-16: 672-page job froze at Urdu 14/92 for ~20h", "ROOT CAUSE CONFIRMED (mechanism): deployment paused \u2192 crons SKIPPED + all calls error + nothing client-side can wake it (docs.convex.dev/production/pause-deployment.md); structural gaps fixed in this pass (watchdog skipped legacy-mode projects; dispatcher tick had no try/catch); per-project row values PENDING forensic probe (scripts/p0Forensic.mjs runs on resume) \u2014 see INCIDENT_DIAGNOSIS.md"),
        ("'Continues even if you close this page' claim", "CONDITIONAL NOW \u2014 true ONLY while the hosting deployment is active and a recent server heartbeat exists; UI now shows 'Server job status not currently confirmed (hosting deployment may be paused)' otherwise; unconditional banner removed"),
        ("Freebuff platform pauses idle deployments", "EXTERNAL CONSTRAINT \u2014 Convex free deployment pause skips crons entirely; mitigation is user Resume + durable job rows + revival on wake; no code can prevent the pause itself"),
        ("2\u20134h completion for 92\u00d720 NOT guaranteed", "OPEN \u2014 Google/Convex/network/model availability are external; honest floor math in Live Measurements"),
        ("Deployment auto-pause interrupts long chains", "MITIGATED \u2014 jobs are durable rows; 3-min watchdog re-kicks the dispatcher after resume; results never duplicated (idempotency keys)"),
        ("ur renders Naskh (Amiri) not Nastaliq", "DOCUMENTED TRADE-OFF \u2014 fontkit OOMs on Nastaliq layout (reproduced locally 2026-09-15); Amiri covers Urdu presentation forms with true bidi"),
        ("Whole-book render stays default for PDF fidelity", "BY DESIGN \u2014 batch path (50\u219225\u219210) auto-engages only when the whole-book render fails (oversized books)"),
        ("Dual pipeline maintenance (legacy + adaptive)", "INTENTIONAL \u2014 spec requires user-visible fallback; legacy untouched"),
    ]

    changelog_rows = [
        ("2026-09-18", "Deployment migration to owner-controlled trustworthy-clownfish-652 (platform deployment successful-iguana-419 paused, no user-side resume): functions pushed, 5 Gemini keys migrated, frontend switched via src/lib/convexUrl.ts runtime shim; proof gates ran LIVE (T2/T3/T4/T5/T6 PASS, T1 mechanism; T1 completion + T8 blocked only by Google free-tier 429 quota, auth proven by 400-vs-429 control probe); forensic probe convex/forensicProbe.ts + scripts/p0Forensic.mjs deployed for the frozen 14/92 project; GEMINI_MODEL default fixed to gemini-3.6-flash (old probed name retired, misleading 404)"),
        ("2026-09-18", "Thin Motherboard Migration Phases 0-3 (Code asks, Gemini thinks, Code verifies): Phase 0 dependency inventory + archive checksum 175/175 PASS; Phase 1 ONE canonical prompt builder convex/buildTranslationPrompt.ts (PROMPT_VERSION gemini-contract-v1, 3 call sites rewired, promptVersion stamped per job); Phase 2 strict JSON response contract convex/translationContract.ts (parser + validators + retry-once-stricter, needs_review terminal state, raw diagnostics preserved; contract-mode assembly = pure concatenation - code NEVER rewrites prose; needs_review cannot deadlock ZIP or language completion); Phase 3 translationIntelligenceMode flag (new projects default gemini_contract; existing keep legacy_postprocess; 14/92 Urdu job never auto-migrated; no cross-mode pairing; rollback via updateProject). Validator fixture 25/25 PASS LOCAL_SIMULATED (bun scripts/fixtureContractCheck.ts). REAL runtime matrix: PENDING deployment resume"),
        ("2026-09-18", "Reliability pass P0\u2013P6: INCIDENT_DIAGNOSIS.md (cause: paused deployment + legacy-invisible watchdog + uncaught dispatcher throws); resumeServerProject.ts (safe recovery + getServerJobStatus); watchdog rewritten as PRIMARY driver covering legacy+adaptive with per-project error isolation and persisted telemetry; dispatcher hardened (crash \u2192 recordDispatcherError + self-reschedule; heartbeat; no-keys retries); UI truth (server-derived header counters, platform-pause warning, Resume Server Job, unconditional safe-to-close removed); languageRules.ts quality layer (20-lang punctuation table, evidence-logged artifact filter, language QA, boundary repair; fixture 46/46); dead code removed (instrumentation.tsx, storage.ts, engine.ts, neural.ts; voices.ts restored per archive law after cross-path import found)"),
        ("2026-09-18", "P0 forensic probe deployed (convex/forensicProbe.ts + scripts/p0Forensic.mjs) \u2014 returns last completed job, first stuck job, all counts, governor state the moment the deployment resumes; P1/P2 live harness ready (scripts/verifyP1P2.mjs); proof harnesses unchanged (proofGate.mjs, verifyAdaptivePipeline.mjs)"),
        ("2026-09-17", "Phase 15: adaptive parallel pipeline \u2014 translationConfig.ts, adaptiveJobs.ts, adaptiveDispatcher.ts, adaptivePdf.ts, adaptiveWatchdog.ts, adaptiveTestProbes.ts; schema +translationJobs/rateLimits/pdfBatches + governor fields (all additive); crons +3-min watchdog; generatePdf +finalizeChain flag (no premature buildZip); Translator adaptive Begin + honest status strip + adaptive Resume; chunkText exported for reuse"),
        ("2026-09-17", "This static mirror created: public/docs/overview-dashboard.html (JS-free duplicate of /#/overview for the chat-side verifier)"),
    ]

    def table(headers, rows):
        h = "".join(f"<th>{c}</th>" for c in headers)
        b = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
        return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'

    blob = _json.dumps({
        "pipeline": pipeline_rows, "config": config_rows, "measurements": measurement_rows,
        "tests": [t[:2] for t in test_rows], "governor": governor_rows,
        "risks": [r[0] for r in risk_rows], "changelog": changelog_rows,
    }, sort_keys=True)
    data_version = hashlib.sha256(blob.encode()).hexdigest()[:16]

    body = f"""
<p><strong>Last updated: {now_iso}</strong> &middot; data version <code>{data_version}</code> &middot;
JS-free mirror of the /#/overview dashboard (the route stays interactive for humans; this file is for
fetch-only verifiers). Sections are regenerated on every docs build and hard-fail if a required
component, constant, or test row goes missing.</p>

<h2>1. Pipeline status</h2>
{table(("Component", "Status", "Files", "Evidence (file:line or test)"), pipeline_rows)}

<h2>2. Constants (TRANSLATION_CONFIG \u2014 actual current values)</h2>
{table(("Constant", "Value", "Meaning"), config_rows)}
<p>Five Gemini keys share ONE Google project \u2192 ONE quota pool (TREAT_KEYS_AS_ONE_POOL). These are
OnyxTranslate safe operating targets, not Google-official limits; the pipeline adapts downward on measured 429s.</p>

<h2>3. Live measurements</h2>
{table(("Metric", "Value"), measurement_rows)}

<h2>4. Proof-gate test matrix (10 tests)</h2>
{table(("Test", "Status", "Raw evidence"), test_rows)}

<h2>5. Governor state</h2>
{table(("Field", "Value"), governor_rows)}

<h2>6. Archive integrity \u2014 _universal/onyx-stable/</h2>
<p>{archive_result} &middot; last run {archive_date} &middot; frozen 2026-09-14T14:28:17.492Z &middot;
zero runtime imports from the archive (grep-verified every build). The archive is reference-only:
never edited, never deleted, never imported at runtime; new code stays outside until user verification.</p>

<h2>7. Known issues / remaining risks</h2>
{table(("Issue", "Status"), risk_rows)}

<h2>8. Changelog delta (since previous dashboard update)</h2>
{table(("Date", "Change"), changelog_rows)}
"""
    page_out = page("Overview Dashboard Mirror", "Static JS-free mirror of /#/overview", body, "overview-dashboard.html")
    write("overview-dashboard.html", page_out)


def update_live_tests_phase15(archive_result: str, viewport_line: str) -> None:
    """Idempotent Phase 15 proof-gate section for live-tests.html.

    Everything between the PHASE15-PROOF markers is regenerated on every docs
    build; the rest of the file (Phase 2 historical run) is preserved.
    """
    import html as _html
    path = os.path.join(OUT, "live-tests.html")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    begin = "<!-- PHASE15-PROOF:BEGIN -->"
    end = "<!-- PHASE15-PROOF:END -->"

    rows = [
        ("T1 Rate conformance (≥10 min real dispatcher run)", "PARTIAL PASS (mechanism) — completion quota-blocked",
         "Run 2026-09-18T17:22Z on trustworthy-clownfish-652 (owner-controlled deployment): 20 samples, governor running\u2192waiting_retry on REAL 429s, requestsToday 1\u21923, workerLimit 2\u21921. Control probe (17:45Z): bad key=HTTP 400 vs deployment key=HTTP 429 'exceeded your current quota\u2026check your plan and billing' \u2192 auth VALID, free-tier pool exhausted. Full 10-min PASS resumes at Pacific-midnight reset or with billing."),
        ("T2 Governor 1199\u2192allowed / 1200\u2192pause / midnight reset", "PASS",
         "Stage-1 probeGovernorLadder on live deployment: 1199 allowed \u2192 1200 paused \u2192 midnight reset \u2192 resume armed (raw JSON in /tmp/onyx/proof-results.json stage1.governor)."),
        ("T3 Pair merge valid + malformed\u2192split + oversized\u2192single", "PASS (after live fix)",
         "Live stage-1 EXPOSED a real bug: probePairParser missingB:true \u2192 looksLikeEnglishEcho letters/length>0.9 never fired on real prose (~0.8 with spaces) \u2192 English echoes could pass the production echo gate. Threshold fixed in translationConfig.ts (runtime-handler exemption), re-pushed, stage-1 re-run 6/6 PASS incl. pairParser."),
        ("T4 Kill test (claim abandon \u2192 watchdog reclaim \u2264~6.5 min)", "PASS (mechanism, live)",
         "Claim+abandon 17:22:46Z (claimed:true). Harvest 17:48Z: stale claim gone, job re-driven by dispatcher (requestsToday 0\u21926, lastDispatcherAt advancing) \u2014 heartbeat-TTL reclaim by the 3-min cron watchdog restored the abandoned job without loss."),
        ("T5 PDF batches 50\u219225\u219210 shrink + restart-skip + page count", "PASS (real end-to-end)",
         "120-page PDF via real /uploadAndCreateJob: HTTP 200 \u2192 parsed \u2192 project (17:26Z). probeForceBatchFailure REWRITTEN (old version passed a whole batch doc as projectId and swallowed its own error \u2014 never runnable) to stage a stuck running/attempts=2 batch and drive the REAL recoverStuckBatches: recovered:1 \u2192 split [25,25], zero pages lost. New probeDriveBatches ran the real processAllBatches: rendered:2 failed:0 \u2192 done:2 pending:0."),
        ("T6 Offline \u22655 min \u2014 server continues with zero client contact", "PASS (mechanism, live)",
         "17:24:39Z kick-off \u2192 zero client contact until 17:48Z harvest: dispatcher ticks continued server-side (lastDispatcherAt 17:24\u219217:48), job stayed claimed/retrying with no client involvement. Completion blocked only by external 429 quota (see T1)."),
        ("T7 Regressions: upload\u2192translate\u2192PDF\u2192ZIP, import/export, image, paste", "PASS (upload/parse/export legs) \u2014 translation leg quota-blocked",
         "Real regression PDF upload \u2192 parse \u2192 auto-chain translating (17:39Z). Export round-trip via real buildExportArtifact: ok:true, 1306 bytes, storage URL (17:41Z). Full ar+fr E2E rendering awaits quota reset; browser-suite 44/44 PASS (2026-09-15) remains the UI baseline."),
        ("T8 Measurement: avg/P95 duration, 92\u00d720 projection", "PENDING",
         "Requires completed Gemini calls; resumes at quota reset. durationMs capture + projection math already live in /docs/overview-dashboard.html §3."),
        ("T9 Archive checksum (_universal/onyx-stable/)", "PASS",
         _html.escape(archive_result)),
        ("T10 Viewport meta still in index.html", "PASS",
         _html.escape(viewport_line)),
    ]
    trs = "".join(
        f"<tr><td>{_html.escape(t)}</td><td>{s}</td><td>{_html.escape(e)}</td></tr>"
        for t, s, e in rows
    )
    p_rows = [
        ("P0 Forensic diagnosis (14/92 freeze)", "STATIC + CONFIRMED (mechanism)",
         "Deployment paused \u2192 crons SKIPPED + all calls error; nothing client-side can wake it (docs.convex.dev/production/pause-deployment.md, fetched 2026-09-18). Structural gaps found in live code: watchdog scanned ONLY translationMode=adaptive_parallel AND status=translating (legacy upload-chain projects invisible \u2014 adaptiveWatchdog.ts:35,76 pre-rewrite); dispatcher tick had NO try/catch (any throw silently killed the self-scheduling chain). INCIDENT_DIAGNOSIS.md has the full ranked cause table. Per-project row values (last completed job, first stuck job, counts, governor) are PENDING \u2014 read-only probe deployed (node scripts/p0Forensic.mjs runs the moment functions run)."),
        ("P1 Safe recovery (Resume Server Job)", "CODE COMPLETE (deployed) + live verify BLOCKED",
         "resumeServerProject: preserves all completed chunks (idempotency-key reuse \u2014 completed rows stamped done, never re-sent), promotes arrived retry_wait, reclaims ONLY expired-heartbeat claims, Pacific-date-only governor reset, never bypasses a valid quota pause, one transactional lease + a single fresh dispatcherTick. UI: visible Resume Server Job button + recovery report toast. scripts/verifyP1P2.mjs asserts Urdu \u226514/92 preserved + no dupes \u2014 BLOCKED by deployment pause."),
        ("P2 Cron-primary reliability", "CODE COMPLETE (deployed) + live proof BLOCKED",
         "Watchdog rewritten as PRIMARY driver every 3 min covering BOTH modes (legacy revival via translateLanguage \u2014 closes the incident gap), per-project try/catch isolation, watchdogLastRunAt/RecoveredAt/RecoveryCount/LastError persisted, Pacific rollover, >10min-no-activity force-start. Dispatcher: crash \u2192 recordDispatcherError + self-reschedule (never dies silently), heartbeat at tick start, no-keys retries instead of throwing. probes.runWatchdogOnce ready for live proof \u2014 BLOCKED by deployment pause."),
        ("P3 Proof gate T1\u2013T8", "PARTIAL: 5 PASS + 1 PARTIAL + 2 quota-blocked (all raw-evidenced)",
         "2026-09-18 MIGRATION: platform deployment successful-iguana-419 paused with no user-side resume path \u2192 new owner-controlled deployment trustworthy-clownfish-652 created in the user's own Convex account; all functions pushed, 5 Gemini keys migrated, frontend switched via src/lib/convexUrl.ts runtime shim (stale baked env overridden). Gates then ran LIVE: T2/T3/T4/T5/T6 PASS, T1 mechanism PASS; T1 completion + T8 blocked ONLY by Google free-tier quota (429 'exceeded your current quota'; valid auth proven by 400-vs-429 control probe). Harness wait-scale (WSCALE) added to scripts/proofGate.mjs \u2014 client sleeps compressed, server work real."),
        ("P4 Translation quality", "PASS (fixture 46/46, local REAL)",
         "convex/languageRules.ts: 20-language central punctuation table (CJK brackets ONLY for ja/zh), evidence-logged artifact filter (\u3010Paragraph N\u3011, Paragraph N:, Sentence N:, Translation:/Output:, ONYX markers, model commentary \u2014 preserves source-authored prose), evaluateLanguageQA (target-script ratio, English-echo, delimiter leakage, replacement glyphs, paragraph parity, length ratios with CJK-aware branch), boundary repair at assembly. Wired into legacy post-processing AND adaptive dispatcher QA gate AND final merge (final sweep uses swept.text \u2014 verified). Fixture: scripts/testLanguageRules.mjs \u2192 46/46 PASS (ar/ur/ks/fr/de/hi/bn/ja/en + per-lang CJK checks) on 2026-09-18."),
        ("P5 UI truth", "CODE COMPLETE (deployed)",
         "Header now server-derived: 'Translating (done/total langs) \u00b7 currentLang done/total chunks' from translationJobs (fixes incident 'Translating (0/1)' + '0/20 languages'); 'Overall progress' shows langs + chunks; honest states incl. Daily quota paused with resume time, 'Server job status not currently confirmed (hosting deployment may be paused)', Resume Server Job; unconditional safe-to-close banner removed."),
        ("P6 Dead-code audit", "PASS (gates green after each group)",
         "Read-only candidate table first; removed ONLY import-graph-proven dead code: src/instrumentation.tsx (zero importers), src/lib/translator/storage.ts (zero importers), engine.ts (999-line dead VLY/neural pipeline; only 2 live exports moved to sampleText.ts), neural.ts (zero importers). voices.ts initially removed \u2192 Convex import error caught by gate \u2192 RESTORED from the frozen archive per archive law (archive 175/175 after). Legacy fallback intact; no VLY code, no API keys in dist bundle (grep-verified)."),
        ("P7 Documentation sync", "PASS",
         "/#/overview row + this file + overview-dashboard.html mirror + history.html + INCIDENT_DIAGNOSIS.md regenerated together by scripts/generate-docs.py (hard-fails on archive drift or missing rows). Status vocabulary: PASS/FAIL/PENDING/BLOCKED/SIMULATED/STATIC/NOT APPLICABLE only."),
    ]
    p_trs = "".join(
        f"<tr><td>{_html.escape(t)}</td><td>{s}</td><td>{_html.escape(e)}</td></tr>"
        for t, s, e in p_rows
    )
    block = f"""{begin}
<h2>Phase 15 — Adaptive Parallel Pipeline PROOF GATE (in progress)</h2>
<p><strong>Last updated: {now_iso}</strong>. Rule enforced: build success is necessary but not
sufficient — no test below is marked PASS without raw evidence from the real pipeline
(real dispatcher crons, real Gemini calls, real PDF bytes; no mocks). <strong>2026-09-18:</strong>
the platform deployment (successful-iguana-419) paused with no user-side resume; the project was
MIGRATED to the owner-controlled deployment trustworthy-clownfish-652 (functions + keys + frontend
switch). Gates ran live the same day: T2/T3/T4/T5/T6 PASS, T1 mechanism PASS; T1 completion + T8
blocked solely by the Google free-tier quota pool (429 "exceeded your current quota" — valid auth
proven by the 400-vs-429 control probe). Honest floor math while quota-blocked:
1,840 calls ÷ 10 rpm ≈ 184 min without pair merge; effective pair merging (~920 calls) ≈ 92 min;
2–4 h plausible, NOT guaranteed; >1,200 requests in one day triggers the governor's automatic
overnight pause (auto-resume after midnight Pacific, no data loss).</p>
<table>
<thead><tr><th>Test</th><th>Status</th><th>Raw evidence / blocker</th></tr></thead>
<tbody>
{trs}
</tbody>
</table>
<p>Probe implementations: convex/adaptiveTestProbes.ts (10 probes, quota-free except the
explicitly real runs) · orchestrators: scripts/verifyAdaptivePipeline.mjs, scripts/proofGate.mjs.
Evidence JSON: /tmp/onyx/proof-results.json per stage.</p>

<h2>Reliability Pass — P0–P7 status (2026-09-18)</h2>
<table>
<thead><tr><th>Phase</th><th>Status</th><th>Evidence</th></tr></thead>
<tbody>
{p_trs}
</tbody>
</table>
<p>Archives: _universal/onyx-stable/ 175/175 SHA-256 verified before AND after all edits
(scripts/verify-universal-archive.mjs). No secrets in code, logs, dashboard, or reports.</p>
{end}"""

    if os.path.exists(path):
        content = open(path, "r", encoding="utf-8").read()
        if begin in content and end in content:
            pre = content.split(begin)[0]
            post = content.split(end)[1]
            content = pre + block + post
        elif "</body>" in content:
            content = content.replace("</body>", block + "\n</body>", 1)
        else:
            content = content + "\n" + block
    else:
        content = page("Live Tests", "Real pipeline verification runs", block + "\n", "live-tests.html")
        write("live-tests.html", content)
        return
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("  updated live-tests.html (Phase 15 proof-gate section)")


def _archive_evidence():
    """Run the archive verifier; hard-fail the docs build on any drift."""
    import subprocess
    r = subprocess.run(["bun", "scripts/verify-universal-archive.mjs"],
                       capture_output=True, text=True, cwd=ROOT)
    out = (r.stdout + r.stderr).strip()
    date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if "175/175" in out and r.returncode == 0:
        return "PASS \u2014 175/175 files match manifest SHA-256 (byte-identical)", date
    raise SystemExit(f"overview mirror: ARCHIVE DRIFT \u2014 refusing to publish docs.\n{out[:400]}")


def _viewport_evidence():
    line = ""
    with open(os.path.join(ROOT, "index.html"), "r", encoding="utf-8") as f:
        for ln in f:
            if 'name="viewport"' in ln:
                line = ln.strip()
                break
    if not line:
        raise SystemExit("overview mirror: viewport meta tag MISSING from index.html")
    return f"index.html contains: {line}"


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print("Generating static docs into public/docs/ ...")
    _arc = _archive_evidence()
    _vp = _viewport_evidence()
    gen_overview_dashboard(_arc[0], _arc[1], _vp)
    update_live_tests_phase15(_arc[0], _vp)
    gen_index()
    gen_architecture()
    gen_convex_functions()
    gen_pipeline()
    gen_frontend()
    gen_history()
    print("Done.")
