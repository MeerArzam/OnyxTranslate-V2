/**
 * convex/translationConfig.ts — PHASE 1: CENTRAL CONFIGURATION
 *
 * One module for every tunable in the adaptive parallel translation pipeline
 * (Phases 3–9 of the Adaptive Parallel Translation spec). Nothing here claims
 * to be a Google-official limit: these are OnyxTranslate's SAFE OPERATING
 * TARGETS. The pipeline reads real Gemini responses (429 / Retry-After /
 * RESOURCE_EXHAUSTED) and adapts downward dynamically; it never exceeds the
 * configured ceiling.
 *
 * IMPORTANT PHYSICS (kept honest, surfaced in the UI):
 *  - The five Gemini keys currently share ONE Google project → ONE quota pool.
 *    Five keys do NOT multiply throughput. treatKeysAsOnePool models this.
 *  - Absolute 2–4h completion cannot be guaranteed — Google, Convex, storage,
 *    network and model availability are external dependencies.
 */

export const TRANSLATION_CONFIG = {
  // ── Rate control (project-level, shared by all five keys) ──
  targetRpm: 10,
  absoluteRpmCeiling: 12,
  dailyRequestBudget: 1200,
  workerCount: 2,

  // ── Liveness / deadlines ──
  heartbeatTtlMs: 3 * 60 * 1000,
  // 3.5-flash is a THINKING model (thought_signature in probe response):
  // real translation calls exceed 20s, so the tick deadline + 5s per-call
  // floor caused pure timeouts (lastError:"timeout", attempts 4→5). Raised
  // 2026-09-27 for thinking-model latency.
  actionSafetyDeadlineMs: 90 * 1000,
  watchdogIntervalMs: 3 * 60 * 1000,
  dispatcherIntervalMs: 15 * 1000,

  // ── Retries / backoff ──
  maxAttempts: 10,
  max429AttemptsBeforeWorkerReduction: 3,
  maxConsecutive429TicksBeforeHalvingWorkers: 2,

  backoffBaseMs: 2000,
  backoffMaxMs: 120000,
  backoffJitterRatio: 0.25,

  // ── Pair merging (2 chunks share 1 Gemini request when safe) ──
  pairMergeEnabled: true,
  pairMergeMaxEstimatedInputTokens: 6000,
  pairMergeHeadroomRatio: 0.2,
  estimatedCharsPerToken: 4,

  // ── PDF generation batching ──
  pdfInitialBatchPages: 50,
  pdfMinimumBatchPages: 10,
  pdfBatchShrinkFactor: 0.5,

  // ── Dispatcher / per-action budgets ──
  maxJobsClaimedPerDispatch: 2,
  maxDatabaseWritesPerAction: 50,
  staleProjectThresholdMs: 10 * 60 * 1000,

  // ── Identity of this pipeline (feature flag support) ──
  pipelineVersion: "adaptive_parallel_v1",
} as const;

/**
 * treatKeysAsOnePool: all five configured Gemini keys belong to one Google
 * project, so they share one quota. The limiter therefore enforces ONE
 * project-level RPM window — never per-key pools. If keys are later moved to
 * separate Google projects, this must be changed ONLY after explicit
 * verification of the real per-project quotas (spec Phase 6).
 */
export const TREAT_KEYS_AS_ONE_POOL = true;

/** Fixed 40-min/chunk symptom root cause (documented for the overview):
 *  legacy chain = 1 chunk in flight + fixed 10s sleeps per 429 attempt across
 *  5 keys (up to ~150s dead sleep per chunk) + any throw silently kills the
 *  language chain. The adaptive dispatcher removes all three. */

/** Deterministic idempotency key for a translation unit. */
export function translationJobIdempotencyKey(
  projectId: string,
  langCode: string,
  chunkIndex: number,
): string {
  return `${projectId}:${langCode}:${chunkIndex}`;
}

/** Deterministic idempotency key for a PDF page batch. */
export function pdfBatchIdempotencyKey(
  projectId: string,
  langCode: string,
  batchIndex: number,
): string {
  return `${projectId}:${langCode}:pdf:${batchIndex}`;
}

/**
 * Safe pair-merge token estimate (spec Phase 3):
 *   ceil((lenA + sep + lenB + promptOverhead) / charsPerToken) × (1 + headroom)
 * Never merges when the safe estimate exceeds the cap. Never truncates source.
 */
export function estimateSafePairTokens(
  lenA: number,
  lenB: number,
  separatorLength: number,
  promptOverheadChars: number,
): number {
  const raw =
    (lenA + separatorLength + lenB + promptOverheadChars) /
    TRANSLATION_CONFIG.estimatedCharsPerToken;
  const safe = Math.ceil(raw) * (1 + TRANSLATION_CONFIG.pairMergeHeadroomRatio);
  return Math.ceil(safe);
}

/** Exponential backoff with jitter + Retry-After floor (spec Phase 6). */
export function computeBackoffDelayMs(
  attempt: number,
  retryAfterMs?: number,
): number {
  const capped = Math.min(attempt, 16);
  const exponential = Math.min(
    TRANSLATION_CONFIG.backoffMaxMs,
    TRANSLATION_CONFIG.backoffBaseMs * Math.pow(2, capped),
  );
  const jitterMax =
    TRANSLATION_CONFIG.backoffBaseMs * TRANSLATION_CONFIG.backoffJitterRatio;
  const jitter = Math.floor(Math.random() * jitterMax);
  const delay = exponential + jitter;
  return Math.max(delay, retryAfterMs ?? 0);
}

/** Current Pacific calendar date (YYYY-MM-DD) for the daily governor. */
export function pacificDateKey(now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

/** Milliseconds until the next midnight Pacific (for daily_paused resume). */
export function msUntilNextPacificMidnight(now: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const parts = fmt.formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const s = Number(parts.find((p) => p.type === "second")?.value ?? "0");
  const msIntoDay = ((h * 60 + m) * 60 + s) * 1000;
  const day = 24 * 60 * 60 * 1000;
  // DST shifts are absorbed by re-checking at wake-up; this is the nominal gap.
  return Math.max(day - msIntoDay, 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3 pure helpers (pair merge) — single source of truth, importable
// by the dispatcher AND by the verification tests (no Convex runtime needed).

export const ONYX_TRANSLATION_MARKERS = {
  A_START: "<<<ONYX_TRANSLATION_A_START>>>",
  A_END: "<<<ONYX_TRANSLATION_A_END>>>",
  B_START: "<<<ONYX_TRANSLATION_B_START>>>",
  B_END: "<<<ONYX_TRANSLATION_B_END>>>",
} as const;

/** Latin-script targets (English-echo check is meaningless for these). */
export const LATIN_TARGET_LANGS = new Set([
  "fr", "es", "tr", "de", "ro", "sw", "it", "la", "id", "pt",
]);

export function isLatinTarget(langCode: string): boolean {
  return LATIN_TARGET_LANGS.has(langCode);
}

export function buildPairUserContent(a: string, b: string): string {
  return [
    "Translate the TWO book chunks below into the target language specified in the system prompt.",
    "Return the two translations wrapped in EXACTLY these markers:",
    ONYX_TRANSLATION_MARKERS.A_START,
    "(translation A)",
    ONYX_TRANSLATION_MARKERS.A_END,
    ONYX_TRANSLATION_MARKERS.B_START,
    "(translation B)",
    ONYX_TRANSLATION_MARKERS.B_END,
    "No commentary, no notes, no extra sections, no other markers.",
    "",
    "<<<ONYX_CHUNK_A_START>>>",
    a,
    "<<<ONYX_CHUNK_A_END>>>",
    "",
    "<<<ONYX_CHUNK_B_START>>>",
    b,
    "<<<ONYX_CHUNK_B_END>>>",
  ].join("\n");
}

/** Extract a marked section; null when missing/empty (malformed pair). */
export function extractPairSection(raw: string, letter: "A" | "B"): string | null {
  const start = `<<<ONYX_TRANSLATION_${letter}_START>>>`;
  const end = `<<<ONYX_TRANSLATION_${letter}_END>>>`;
  const s = raw.indexOf(start);
  if (s === -1) return null;
  const e = raw.indexOf(end, s + start.length);
  if (e === -1) return null;
  const body = raw.slice(s + start.length, e).trim();
  return body.length > 0 ? body : null;
}

/** Latin-ratio heuristic: catches untranslated English echo fast. */
export function looksLikeEnglishEcho(text: string): boolean {
  if (!text.trim()) return true;
  // LIVE-PROOF FIX (stage 1, 2026-09-18): the previous char-ratio check
  // (letters/length > 0.9) almost never fired on real prose — spaces kept
  // typical English sentences at ~0.8, so untranslated English passed the
  // gate in production. New rule: with enough linguistic content, text whose
  // letters are ALL plain ASCII is an English echo for non-Latin targets
  // (any accented or non-Latin script — é, ç, Cyrillic, Arabic, CJK — fails
  // the all-ASCII test, so real translations never trip it). Short fragments
  // (< 20 letters) are never judged: too little signal, and short Latin
  // fragments (allowed proper nouns like Violet/Tairn) legitimately appear
  // inside non-Latin prose.
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 20) return false;
  return letters.every((ch) => ch.charCodeAt(0) < 128);
}
