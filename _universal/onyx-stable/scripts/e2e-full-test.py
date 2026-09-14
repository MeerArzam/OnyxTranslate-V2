#!/usr/bin/env python3
"""Full 20-language live E2E test for Onyx Translate.

Creates a project with a real 5-page PDF, runs the autonomous translation
chain, polls to completion, then fetches per-language results (text, QA,
tokens, PDFs, ZIP) and writes /tmp/e2e_results.json.

Usage: python3 scripts/e2e-full-test.py <convex_url>
"""
import base64, json, sys, time, urllib.request

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "https://successful-iguana-419.convex.cloud"
API = f"{BASE}/api"
SESSION = "e2e-20lang-final"
LANGS = ["ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
         "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt"]


def post(path, args, kind="action", timeout=300):
    url = f"{API}/{kind}"
    req = urllib.request.Request(url, data=json.dumps({"path": path, "args": args, "format": "json"}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def create_project():
    b64 = base64.b64encode(open("/tmp/onyx-test-book.pdf", "rb").read()).decode()
    r = post("upload:storePdf", {"fileName": "OnyxTest-Book.pdf", "pdfBase64": b64})
    sid = r["value"]["storageId"]
    p = post("parsePdf:parseUploadedPdf", {"pdfStorageId": sid})
    parsed = p["value"]
    r = post("mutations:createProject", {
        "sessionId": SESSION, "fileName": "OnyxTest-Book.pdf",
        "pageCount": parsed["pageCount"], "wordCount": parsed["wordCount"],
        "pdfStorageId": sid, "pageData": parsed["pageData"],
        "fullText": parsed["fullText"], "parsedPages": parsed["pageCount"], "status": "ready",
    }, kind="mutation")
    return r["value"], parsed


def start_chain(pid, langs):
    return post("translateContent:translateLanguage", {
        "projectId": pid, "langCode": langs[0], "marketContext": "standard",
        "nextLangCode": langs[1] if len(langs) > 1 else None,
        "remainingLangs": langs[2:] if len(langs) > 2 else None,
    })


def poll(pid, want, deadline_s=3600):
    """Poll translation statuses until all `want` languages complete/error."""
    start = time.time()
    last_print = 0
    while time.time() - start < deadline_s:
        ts = post("queries:getTranslationsRaw", {"projectId": pid}, kind="query")["value"]
        done = [t for t in ts if t["status"] == "complete"]
        prog = {t["langCode"]: f'{t["completedChunks"]}/{t["totalChunks"]}' for t in ts}
        if time.time() - last_print > 60:
            last_print = time.time()
            print(f"  [{int(time.time()-start)}s] complete={len(done)}/{len(want)} " +
                  " ".join(f'{k}:{v}' for k, v in sorted(prog.items())), flush=True)
        if all(any(t["langCode"] == l and t["status"] in ("complete", "error", "stalled") for t in ts) for l in want):
            return ts
        time.sleep(20)
    return post("queries:getTranslationsRaw", {"projectId": pid}, kind="query")["value"]


def fetch_results(pid):
    ts = post("queries:getTranslationsRaw", {"projectId": pid}, kind="query")["value"]
    results = {}
    for t in ts:
        chunks = post("queries:getChunksForLang", {"projectId": pid, "langCode": t["langCode"]}, kind="query")["value"]
        texts = [c.get("translatedText") or "" for c in sorted(chunks, key=lambda c: c["chunkIndex"])]
        merged = "\n\n".join(x for x in texts if x)
        usage = {}
        qa_scores = []
        models = set()
        for c in chunks:
            u = c.get("usage") or {}
            for k in ("prompt_tokens", "completion_tokens", "total_tokens", "promptTokens", "completionTokens", "totalTokens"):
                if k in u and isinstance(u[k], (int, float)):
                    kk = "prompt" if "prompt" in k else ("completion" if "completion" in k else "total")
                    usage[kk] = usage.get(kk, 0) + int(u[k])
            if u.get("qaScore") is not None:
                qa_scores.append(u["qaScore"])
            if c.get("model"):
                models.add(c["model"])
        results[t["langCode"]] = {
            "status": t["status"], "chunks": len(chunks),
            "completedChunks": sum(1 for c in chunks if c.get("status") == "done"),
            "mergedTextLength": len(merged), "wordCount": len(merged.split()),
            "qaScores": qa_scores, "models": sorted(models),
            "usage": usage, "pdfUrl": t.get("pdfUrl"), "pdfGenerating": t.get("pdfGenerating"),
            "mergedText": merged,
        }
    return results, ts


def main():
    print(f"Target: {BASE}")
    pid, parsed = create_project()
    print(f"Project: {pid} | {parsed['pageCount']} pages | {parsed['wordCount']} words")
    t0 = time.time()
    r = start_chain(pid, LANGS)
    v = r.get("value") or {}
    print(f"Chain started: ok={v.get('ok')} err={v.get('error')}")
    if not v.get("ok"):
        print(json.dumps(r)[:500]); sys.exit(1)

    print("Polling autonomous chain (20 languages, this takes a while)...")
    ts = poll(pid, LANGS)
    print(f"Chain finished in {int(time.time()-t0)}s")

    results, ts = fetch_results(pid)
    proj = post("queries:getProjectRaw", {"projectId": pid}, kind="query")["value"]

    summary = {
        "deployment": BASE, "projectId": pid,
        "sourcePages": parsed["pageCount"], "sourceWords": parsed["wordCount"],
        "projectStatus": proj.get("status"), "zipUrl": proj.get("zipUrl"),
        "languages": {l: {k: v for k, v in results.get(l, {}).items() if k != "mergedText"} for l in LANGS},
        "mergedTexts": {l: results.get(l, {}).get("mergedText", "") for l in LANGS},
        "elapsedSeconds": int(time.time() - t0),
    }
    json.dump(summary, open("/tmp/e2e_results.json", "w"), ensure_ascii=False, indent=1)
    print("Wrote /tmp/e2e_results.json")
    for l in LANGS:
        r = results.get(l, {})
        print(f'  {l}: {r.get("status")} chunks={r.get("completedChunks")}/{r.get("chunks")} '
              f'qa={r.get("qaScores")} words={r.get("wordCount")} pdf={"Y" if r.get("pdfUrl") else "N"}')


if __name__ == "__main__":
    main()
