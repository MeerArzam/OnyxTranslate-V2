import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

/**
 * convex/crons.ts — PHASE 2 housekeeping.
 *
 * Hourly orphan sweep (spec A):
 *  - pendingUploads stuck "staging" > 24h → abandoned
 *  - uploadJobs with no heartbeat for 24h and no project → errored
 * (Recreated in Phase 2; the Phase 1 removal cleared the old broken crons.)
 */
const crons = cronJobs();

crons.hourly(
  "sweep orphaned uploads",
  { minuteUTC: 7 },
  api.identity.sweepStaleUploads,
  {},
);

// ══ ADAPTIVE PIPELINE: watchdog every 3 minutes (Phase 9) ══
// Reclaims stale claims, revives retryable jobs, recovers stuck PDF batches,
// and re-kicks a missing dispatcher lease — the chain never dies silently.
crons.interval(
  "adaptive watchdog",
  { minutes: 3 },
  api.adaptiveWatchdog.watchdogTick,
  {},
);

export default crons;
