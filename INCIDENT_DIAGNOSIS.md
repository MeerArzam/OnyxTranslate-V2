# OnyxTranslate — INCIDENT_DIAGNOSIS.md

**Incident:** 672-page PDF · 92 chunks · 20 languages · Urdu completed 14/92 → translation stopped ~20 hours. UI showed `Translating (0/1)` and `Overall progress — 0/20 languages`. User went offline then back online; progress never resumed.

**Diagnosis date:** 2026-09-18 (P0 forensic pass)
**Evidence labels:** CONFIRMED / DISPROVED / UNCONFIRMED (per spec). Live job-level data: **BLOCKED** (deployment paused — see §3).

---

## 1. Static-code facts (VERIFIED — read from live deployed code, timestamps 2026-09-18 ~08:21–08:27Z)

| # | Fact | Evidence (file:line / doc quote) |
|---|------|----------------------------------|
| S1 | Watchdog scans ONLY projects with `translationMode === "adaptive_parallel"` | `convex/adaptiveWatchdog.ts:35` — `q.eq(q.field("translationMode"), "adaptive_parallel")` |
| S2 | Watchdog lease-revival fires ONLY when `status === "translating"` | `convex/adaptiveWatchdog.ts:76` — `if (p.status === "translating")` |
| S3 | Watchdog lease-expiry window = `2 × watchdogIntervalMs` (6 min) | `convex/adaptiveWatchdog.ts:80` |
| S4 | `dispatcherTick` self-schedules with NO try/catch/finally — any throw before §5 (commit/self-schedule) kills the chain silently | `convex/adaptiveDispatcher.ts:248-516` (no exception wrapper around the tick body) |
| S5 | `runAfter` scheduling and function calls DO succeed while a push deploys, but any client-call while paused errors | Probed live 08:26:51Z: push `✔ Convex functions ready` immediately followed by `Cannot run functions while this deployment is paused` on `queries:getLatestProject` |
| S6 | Cron behavior when paused (official docs): **"Cron jobs will be skipped." "New function calls will return an error." "Scheduled jobs will queue and run when the deployment is resumed."** | https://docs.convex.dev/production/pause-deployment.md (fetched 2026-09-18) |
| S7 | UI header counters derive from CLIENT translation rows, not server job state | `src/pages/Translator.tsx:1343` — `` `Translating (${completedCount}/${activeTranslations.length || targetLanguages.length})` `` ; `:1458` — `Overall progress — {completedCount}/{targetLanguages.length} languages` |
| S8 | Legacy auto-chain (upload → parse → translate) stamps projects as legacy (no `translationMode` set) unless user starts adaptive explicitly | `convex/jobProcessing.ts` auto-chain paths (no adaptive stamp after P11 correction); `src/pages/Translator.tsx:930` adaptive only on explicit Begin |
| S9 | Legacy pipeline has no watchdog coverage at all (watchdog is adaptive-only) | `convex/adaptiveWatchdog.ts` (whole file) + absence of any legacy reclaim logic in `convex/translateQueue.ts` |

## 2. Ranked cause table (spec format)

| Rank | Possible cause | Evidence | Status | File/function |
|---|---|---|---|---|
| 1 | **Hosting platform paused the deployment** → crons skipped + all calls error + queued jobs frozen | Exact error string returned live during this pass (`Cannot run functions while this deployment is paused. Resume the deployment in the dashboard settings…`); docs: crons skipped while paused; nothing client-side can wake a paused deployment | **CONFIRMED** (mechanism) | Convex platform; incident window behavior matches exactly |
| 2 | **Dead scheduler chain, no revival for the incident project's mode** — if project ran legacy (upload auto-chain), watchdog never looked at it; if adaptive, a single throw inside a tick killed the chain until cron revival — but cron revival requires the deployment to be running (paused ⇒ skipped) | S1, S2, S4, S9; chain-death on throw is structural (no finally → no next tick) | **CONFIRMED** (structural gap) | `adaptiveDispatcher.ts` (missing try/catch/finally), `adaptiveWatchdog.ts:35,76` (mode/status gates), legacy chain (no watchdog at all) |
| 3 | **Stuck governor** (`daily_paused` never released) | Governor resume path exists (`adaptiveDispatcher.ts:282-294`); project-level values UNREADABLE while paused | UNCONFIRMED | `adaptiveJobs.resumeFromDailyPause` |
| 4 | **Expired lease not reclaimed** | Reclaim logic exists and is cron-driven; cron was provably skipped while paused; job-level claim/heartbeat rows UNREADABLE while paused | UNCONFIRMED (logic exists; execution blocked) | `adaptiveWatchdog.ts` + `adaptiveJobs.reclaimStaleJobs` |
| 5 | Gemini quota (429) stalling all progress | 429 ladder + `waiting_retry` implemented; would produce `retry_wait` jobs that auto-promote; no evidence retrievable while paused | UNCONFIRMED | `adaptiveDispatcher.ts` 429 branch |
| 6 | Database error / scheduler crash inside a tick | No error surfaced client-side; function logs not accessible from sandbox while paused | UNCONFIRMED | `dispatcherTick` |
| 7 | Gemini 401/403, malformed pair, empty output as PRIMARY cause | These produce retries/splits, not a 20h full stop — structurally DISPROVED as sole cause, but job rows unreadable | DISPROVED (as sole cause) | dispatcher error branches |

## 3. Blocked evidence (quote, per honesty rule)

```
Error: [Request ID: 67799108b83a97a6] Server Error
Cannot run functions while this deployment is paused. Resume the deployment
in the dashboard settings to allow functions to run.
```
(attempted `node scripts/p0Forensic.mjs` → `forensicProbe.watchdogEvidence`, 2026-09-18)

**Consequence:** per-project values (§ "Report these exact values" items 1–13) are **PENDING** until the user resumes the deployment. The forensic probe is written, deployed, and typechecked — `node scripts/p0Forensic.mjs` returns the full report the moment the deployment runs functions.

## 4. What the code review alone establishes

1. **The 20-hour stall is fully explained by the paused-deployment mechanism** (CONFIRMED mechanism, matches user's own dashboard error) **combined with** the structural gaps S1/S2/S4/S9: even after resume, an adaptive project whose dispatcher chain died mid-tick would only be revived by cron if it is `adaptive_parallel` + `translating` — and a **legacy** project (the likely mode of an upload-auto-chain run) is permanently invisible to the watchdog.
2. **UI contradiction CONFIRMED at S7:** `0/1` and `0/20` are computed from client-side rows and never from the 92-chunk server job — with 20 languages selected and Urdu at 14/92 server-side, the header can simultaneously show `0/1`.
3. **The banner "Continues even if you close this page" is not currently provable** — S5/S6 show the platform can freeze all background work at any time; the UI has no heartbeat-gated suppression (P5 fix required).

## 5. Phase 0 gate verdict

- Archive checksum: **PASS** (175/175, run before any edits).
- Last completed job / first incomplete job / counts / governor values: **PENDING** (blocked, quoted above).
- Exact cause: **mechanism CONFIRMED** (paused deployment + structural revival gaps); which gap bound first for THIS project row → **PENDING** until live probe runs.
- Per spec: *"If the cause cannot be confirmed, continue with defensive repair but clearly state that the root cause remains unknown."* → P1–P2 proceed with defensive repair; this file stays the source of truth and will be updated with live numbers immediately after resume.
