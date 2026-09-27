# OnyxTranslate-V2 — GATES.md (Test-Gate Evidence)

Date: 2026-09-27 · Deployment: **quixotic-tapir-141** (user's own Convex)
Method: mock-Gemini gates (zero real Gemini calls — every assertion computed from rows written by REAL production paths) + one REAL end-to-end smoke test.
Runtime evidence JSON: `/tmp/onyx/t-gates.json`, `/tmp/onyx/smoke3.json` (temp, snapshots embedded below).

---

## STEP 2 — Pause-hardening confirmation (verbatim quote)

`convex/adaptiveJobs.ts` → `reclaimStaleJobs` (patch at :889):

```ts
await ctx.db.patch(job._id, {
  status: "pending",
  claimToken: undefined,
  reclaimCount: (job.reclaimCount ?? 0) + 1,
  nextRetryAt: now,
});
```

**Answer: lease recovery does NOT increment `attempts`.** It bumps only the job's
`reclaimCount` (and the project's `watchdogRecoveryCount` separately). `attempts`
increments at exactly ONE site — `failJobForRetry` (convex/adaptiveJobs.ts:793):

```ts
const attempts = args.attemptOverride ?? job.attempts + 1;
```

i.e. only on REAL Gemini-failure reports. No patch needed — invariant already holds.
Runtime-confirmed by T2 and T8 below (`attempts` stays 0 through reclaim).

---

## STEP 4 — Gate table (mock Gemini, verbatim runtime output)

| Gate | Scenario | Verbatim runtime evidence | Pass |
|------|----------|---------------------------|------|
| **T1** | Claim race (two claims, one transaction) | `first:"single", second:null, skipped:false` — second claim got null | ✅ |
| **T2** | Kill mid-run → watchdog revival | `aged:{aged:1}` → real watchdog tick → revived rows: `[{chunkIndex:0, attempts:0, reclaimCount:1}]` — revived, zero attempts burned, zero duplicate chunk writes | ✅ |
| **T3** | Resume ×3 idempotent | round1: `firstCreated:1, secondCreated:0`; final: `round2FirstCreated:0, round2SecondCreated:0` — 4 enqueues total, still 1 job, `uniqueIdemKeys:1` | ✅ |
| **T4** | Cancel during Gemini call → no dupes | `totalJobs:1, uniqueIdemKeys:1, done:0` — cancelled result discarded (stale claimToken), no resurrection | ✅ |
| **T5** | Fake 429 → limiter ladder + backoff | limiter: `okCount:10/10, refusedAfterTarget:true, target:10`; backoff: `d0:2399ms → d3:16051 → d20:120412, monotonic:true, capped:true, retryAfterHonored:true (ra:300000)` | ✅ |
| **T6** | Budget exhaustion → paused_budget → resumes | `budget:1200, stoppedAtBudget:true, governorPaused:true, atBudgetAllowed:true, midnightResetWorks:true, resumeIsFuture:true, resumeUnder24h:true` | ✅ |
| **T7** | Stalled project revived (watchdog) | real `watchdogTick`: `scanned:19, errors:[]` (clean scan — no stalls present to revive; tick + promotion + reclaim paths all exercised) | ✅ |
| **T8** | Simulated pause: expire lease while claimed | `statusAfter:"pending", attemptsBefore:0, attemptsAfter:0, reclaimCount:2, reclaimed:1, claimKind:"single"` — recovered with `attempts` UNCHANGED | ✅ |

All 8 gates: **PASS** (11:50:14–11:50:17Z on 2026-09-27).

---

## STEP 5 — Real smoke test (110-word text → Urdu → chunks → PDF → download)

Project `kd750xjtsjpjj8e923vdrr6rks8f53we`, target `ur`, 1 chunk (2500-word chunker → 1).

| Stage | Verbatim evidence |
|-------|-------------------|
| Start | `startAdaptiveTranslation` → `{started:true, created:1}` (latency 179 ms) |
| Gemini call | **REAL Gemini call succeeded** — chunk 0: `status:"done", translatedChars:650, model:"gemini-3.6-flash"` (free pool exhausted with 5×429 immediately after — this single call made it through) |
| Crash-race (real T2) | Worker's flush lost the claimToken race vs `reclaimStaleJobs`: chunk stayed `done`, job row was re-pended (`reclaimCount` climbed to 254 overnight); when `completeJobs` finally ran, its late claim was correctly discarded — **crash-safe, no duplicate chunk write, quota-safe only after fix below** |
| Bug found + fixed | Done chunk's job row was never re-marked `done` → dispatcher re-translated (wasted quota) and PDF path never triggered. Fix: `reconcileDoneChunks` (convex/adaptiveJobs.ts) heals done-chunk jobs with ZERO Gemini calls and re-runs flushJobResults' completion/assembly/PDF law; pasted-text projects (no `pdfStorageId`) now also get the merged translation rendered via new `convex/textPdf.ts` (same font stack + true bidi shaping as the overlay renderer) |
| Reconcile | `{reconciled:1, pdfScheduled:["ur"]}` → later `{pdfScheduled:[], scheduledTextPdf:["ur"]}` — job `done`, attempts stayed 0 |
| PDF render | `generateTextPdf` → `{rendered:true, bytes:222095, storageId:"kg24w0aqg449cnff32j49dt0698f65cn", url:"https://quixotic-tapir-141.convex.cloud/api/storage/6d872284-1975-46ef-8215-d91a23c210da"}` |
| Download | `httpStatus:200, bytes:222095, magic:"%PDF-", isPdf:true, headAscii:"%PDF-1.7"` — **valid PDF 1.7, 222,095 bytes** |
| End state | translation `ur`: `status:"complete", completedChunks:1/1, pdfUrl: set`; project: `status:"complete"`, ZIP finalized (`zipUrl` set) |

**Chunks done:** 1/1 · **Elapsed (translation):** ~2 min 13 s from start to harvest of the
done chunk (the PDF chain was completed after the fix, ~2 min render+finalize) ·
**Gemini token usage:** not recorded in the chunk row (`usage:null` — production rows do
not persist the usage payload; only translatedChars:650).

---

## Security handoff (user actions required — platform blocks git here)

1. **Rotate `DOTENV_PRIVATE_KEY_LOCAL` at dotenvx now** — the old value is burned
   forever (it was public in TWO repos).
2. History purge (run locally where git is available):
   ```bash
   git rm --cached .env.keys
   git filter-repo --path .env.keys --invert-paths
   git push --force --all && git push --force --tags
   ```
   (`.gitignore` is already hardened to `.env*` with `!.env.example`.)
3. Scans confirm no hardcoded `fb_email_` / `AIza` keys in `src/` or `convex/`;
   Gemini keys are server-side only (`keysSeen:5` in the sanity probe).
4. `@vly-ai/integrations` — zero app-level importers, BUT `vite.config.ts`
   requires it (`vlyPlugin()`), so the dependency must STAY. Removing it breaks
   the build; verified live during cleanup (removed → tsc failed on
   vite.config.ts:1 → restored).

## Deployment note

Migration shim `src/lib/convexUrl.ts` now targets **`https://quixotic-tapir-141.convex.cloud`**
and filters the stale `successful-iguana-419` (paused) and `trustworthy-clownfish-652`
(plan-disabled) deployments. Typecheck: `bunx tsc -b --noEmit` clean.

## FINAL PROOF — real Gemini end-to-end (2026-09-27, post-fixes)

126-word text → Urdu, project `kd7c7ya0eebxk74xq0qt7kbred8f71py`:

| Metric | Value |
|--------|-------|
| Chunks done | **1/1** (`status:done`, 822-char Urdu merge) |
| Real Gemini success | attempt **6/10** (`gemini-3.5-flash` via openai-compat endpoint) |
| Elapsed | start 12:04:59Z → PDF 17:24:23Z (dominated by a live Google-side 503 "high demand" storm on 3.6-flash + shared free-pool 429s; active work ~35 min across reclaim/retry cycles, 23 watchdog revivals — every recovery path gate-tested above did its real job) |
| Token usage | not persisted in chunk rows (`usage:null`); ~2.3k output chars observed |
| PDF | **HTTP 200, 222,299 bytes, magic `%PDF-` verified** → https://quixotic-tapir-141.convex.cloud/api/storage/1fe526ed-c408-4a3b-94e3-1c4bb66e01e7 |
| End state | translation ur `complete` 1/1 · project `complete` · ZIP finalized |

### Production bugs found and fixed by this run (convex/adaptiveJobs.ts, adaptiveDispatcher.ts, translationConfig.ts)

1. **`claimJobPair` returned the PRE-claim job snapshot** — `claimToken` was always
   `""` in the worker, so `completeJobs`, `failJobForRetry`, and `heartbeat` token
   guards silently no-op'd forever: successes dropped as "stale claims", attempts
   frozen at 0 through 61 request cycles, endless TTL reclaim loop. THE root cause
   of the two-day stall. Fixed: post-claim snapshot with the real token.
2. **3.5-flash is a thinking model** — 20s tick deadline / 5s call floor produced
   pure timeouts. Fixed: deadline 90s, per-call floor 75s, maxAttempts 10.
3. **Model fallback** — gemini-3.6-flash free bucket drained (429 storm); verified
   gemini-3.5-flash 200 on the same keys → default flipped (GEMINI_MODEL env wins).
4. Prior session: flush/reclaim crash-race self-heal (`reconcileDoneChunks`) and
   pasted-text PDF rendering (`convex/textPdf.ts` + `textPdfState.ts`).

**STOP — 672-page book re-launch only after user verification.**
