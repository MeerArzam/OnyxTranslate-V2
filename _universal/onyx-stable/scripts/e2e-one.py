#!/usr/bin/env python3
"""Resumable per-language E2E driver. One language per invocation.

Usage:
  python3 scripts/e2e-one.py <convex_url> init          -> create project
  python3 scripts/e2e-one.py <convex_url> run <lang>    -> translate one language
  python3 scripts/e2e-one.py <convex_url> collect       -> fetch all results so far
"""
import base64, json, sys, time, urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://successful-iguana-419.convex.cloud").rstrip("/")
API = f"{BASE}/api"
STATE = "/tmp/e2e_state.json"
LANGS = ["ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
         "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt"]


def post(path, args, kind="action", timeout=280):
    req = urllib.request.Request(f"{API}/{kind}",
                                 data=json.dumps({"path": path, "args": args, "format": "json"}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def load():
    return json.load(open(STATE)) if __import__("os").path.exists(STATE) else {}


def save(s):
    json.dump(s, open(STATE, "w"), ensure_ascii=False)


if sys.argv[2] == "init":
    b64 = base64.b64encode(open("/tmp/onyx-test-book.pdf", "rb").read()).decode()
    sid = post("upload:storePdf", {"fileName": "OnyxTest-Book.pdf", "pdfBase64": b64})["value"]["storageId"]
    parsed = post("parsePdf:parseUploadedPdf", {"pdfStorageId": sid})["value"]
    pid = post("mutations:createProject", {
        "sessionId": "e2e-20lang-final", "fileName": "OnyxTest-Book.pdf",
        "pageCount": parsed["pageCount"], "wordCount": parsed["wordCount"],
        "pdfStorageId": sid, "pageData": parsed["pageData"],
        "fullText": parsed["fullText"], "parsedPages": parsed["pageCount"], "status": "ready",
    }, kind="mutation")["value"]
    save({"pid": pid, "pages": parsed["pageCount"], "words": parsed["wordCount"], "results": {}})
    print(f"INIT OK pid={pid} pages={parsed['pageCount']} words={parsed['wordCount']}")

elif sys.argv[2] == "run":
    lang = sys.argv[3]
    s = load()
    pid = s["pid"]
    t0 = time.time()
    r = post("translateContent:translateLanguage", {"projectId": pid, "langCode": lang, "marketContext": "standard"})
    v = r.get("value") or {}
    err = v.get("error") or r.get("errorMessage")
    chunks = post("queries:getChunksForLang", {"projectId": pid, "langCode": lang}, kind="query")["value"]
    texts = [c.get("translatedText") or "" for c in sorted(chunks, key=lambda c: c["chunkIndex"])]
    merged = "\n\n".join(x for x in texts if x)
    usage, qa, models = {}, [], set()
    for c in chunks:
        u = c.get("usage") or {}
        for k in ("prompt_tokens", "completion_tokens", "total_tokens", "promptTokens", "completionTokens", "totalTokens"):
            if k in u and isinstance(u[k], (int, float)):
                kk = "prompt" if "prompt" in k else ("completion" if "completion" in k else "total")
                usage[kk] = usage.get(kk, 0) + int(u[k])
        if u.get("qaScore") is not None:
            qa.append(u["qaScore"])
        if c.get("model"):
            models.add(c["model"])
    s["results"][lang] = {
        "ok": v.get("ok", False), "error": err, "chunks": len(chunks),
        "mergedTextLength": len(merged), "wordCount": len(merged.split()),
        "qaScores": qa, "models": sorted(models), "usage": usage,
        "seconds": int(time.time() - t0), "mergedText": merged,
    }
    save(s)
    print(f'{lang}: ok={v.get("ok")} err={err} chunks={len(chunks)} qa={qa} '
          f'words={len(merged.split())} usage={usage} {int(time.time()-t0)}s')

elif sys.argv[2] == "collect":
    s = load()
    pid = s["pid"]
    ts = post("queries:getTranslationsRaw", {"projectId": pid}, kind="query")["value"]
    tmap = {t["langCode"]: t for t in ts}
    proj = post("queries:getProjectRaw", {"projectId": pid}, kind="query")["value"]
    out = {"deployment": BASE, "projectId": pid, "sourcePages": s.get("pages"),
           "sourceWords": s.get("words"), "projectStatus": proj.get("status"),
           "zipUrl": proj.get("zipUrl"), "languages": {}}
    for l in LANGS:
        r = dict(s["results"].get(l, {}))
        t = tmap.get(l, {})
        r["status"] = t.get("status")
        r["pdfUrl"] = t.get("pdfUrl")
        r["pdfGenerating"] = t.get("pdfGenerating")
        out["languages"][l] = r
    json.dump(out, open("/tmp/e2e_results.json", "w"), ensure_ascii=False, indent=1)
    print("WROTE /tmp/e2e_results.json")
    for l in LANGS:
        r = out["languages"][l]
        print(f'  {l}: status={r.get("status")} qa={r.get("qaScores")} words={r.get("wordCount")} '
              f'pdf={"Y" if r.get("pdfUrl") else "N"} err={(r.get("error") or "")[:50]}')
