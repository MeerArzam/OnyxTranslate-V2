/**
 * convex/translationContract.ts — Thin Motherboard Migration Phase 2.
 *
 * Minimal ECC layer for the strict JSON response contract:
 *   single: { "translation": "...", "selfCheck": { fullyTargetLanguage,
 *             noMarkers, completeSentences, glossaryRespected } }
 *   pair:   { "items": [ { chunkIndex, translation, selfCheck }, ... ] }
 *
 * Principle: Code asks. Gemini thinks. Code verifies.
 *
 * The validator NEVER rewrites prose: it does not replace punctuation,
 * translate names, repair sentences, reverse RTL, remove literary symbols,
 * or run a hidden second translation. It either ACCEPTS (save), RETRIES
 * (once, with stricter instructions), or FLAGS needs_review. Diagnostics
 * (raw model output) are preserved for postmortems, never silently dropped.
 *
 * Retry policy (spec): invalid JSON or any false selfCheck → retry once
 * with strict instructions → still failing → status needs_review.
 * A completed chunk is never overwritten by a failed retry.
 */

import glossaryData from "../src/data/glossary.json";
import { LOCKED_TERM_LIST } from "./buildTranslationPrompt";

// ─── Contract types ──────────────────────────────────────────────────────────

export interface SelfCheck {
  fullyTargetLanguage: boolean;
  noMarkers: boolean;
  completeSentences: boolean;
  glossaryRespected: boolean;
}

export interface SingleContract {
  translation: string;
  selfCheck: SelfCheck;
}

export interface PairItem {
  chunkIndex: number;
  translation: string;
  selfCheck: SelfCheck;
}

export interface PairContract {
  items: PairItem[];
}

export type ParseOutcome =
  | { ok: true; kind: "single"; value: SingleContract }
  | { ok: true; kind: "pair"; value: PairContract }
  | { ok: false; reason: string; rawSample?: string };

// ─── Parser (strict JSON, tolerant of accidental fences ONLY as detection) ──

/**
 * Parse a Gemini reply into the contract. Strict: the reply must BE a JSON
 * object. If it is wrapped in Markdown fences, that is itself a contract
 * violation (noMarkers/selfCheck false) — we surface it as a failure reason
 * so the retry-with-strict-instructions path can run. We never salvage prose
 * from a broken reply.
 */
export function parseContractResponse(raw: string): ParseOutcome {
  const text = (raw || "").trim();
  if (!text) return { ok: false, reason: "empty_response" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json", rawSample: text.slice(0, 400) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "not_an_object", rawSample: text.slice(0, 400) };
  }
  const obj = parsed as Record<string, unknown>;

  // Pair envelope
  if (Array.isArray(obj.items)) {
    const items: PairItem[] = [];
    for (const it of obj.items) {
      const v = validateSingleShape(it, "pair_item");
      if (!v.ok) return v;
      items.push((it as PairItem));
    }
    if (items.length === 0) return { ok: false, reason: "empty_items" };
    return { ok: true, kind: "pair", value: { items } };
  }

  // Single envelope
  const single = validateSingleShape(obj, "single");
  if (!single.ok) return single;
  return { ok: true, kind: "single", value: obj as unknown as SingleContract };
}

function validateSingleShape(
  candidate: unknown,
  ctx: string,
): { ok: true } | { ok: false; reason: string; rawSample?: string } {
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, reason: `${ctx}_not_an_object` };
  }
  const c = candidate as Record<string, unknown>;
  if (typeof c.translation !== "string" || c.translation.trim().length === 0) {
    return { ok: false, reason: `${ctx}_missing_or_empty_translation` };
  }
  const sc = c.selfCheck;
  if (typeof sc !== "object" || sc === null) {
    return { ok: false, reason: `${ctx}_missing_selfCheck` };
  }
  const s = sc as Record<string, unknown>;
  for (const key of ["fullyTargetLanguage", "noMarkers", "completeSentences", "glossaryRespected"] as const) {
    if (typeof s[key] !== "boolean") {
      return { ok: false, reason: `${ctx}_selfCheck_${key}_not_boolean` };
    }
  }
  return { ok: true };
}

// ─── Detector layer (detection ONLY — never rewriting) ───────────────────────

const MARKER_PATTERNS: RegExp[] = [
  /^\s*paragraph\s*#?\s*\d+\s*[:.)-]?/i,
  /^\s*sentence\s*#?\s*\d+\s*[:.)-]?/i,
  /^[\s\u3010\[]*(?:paragraph|sentence)\s*#?\s*\d+[\u3011\]]?\s*/i,
  /^\s*(?:translation|output|result|translated text)\s*[:\uff1a]/i,
  /^\s*(?:here(?:'s| is) (?:the|your) translation|sure|certainly)\b/i,
  /```(?:json|markdown|text)?/g,
];

/** Detect instruction artifacts / leakage markers in a translation. */
export function detectMarkers(translation: string): string[] {
  const hits: string[] = [];
  const lines = translation.split(/\n/).slice(0, 5); // head is where markers live
  for (const p of MARKER_PATTERNS) {
    const probe = (p.global ? new RegExp(p.source, p.flags.replace("g", "")) : p);
    if (lines.some((l) => probe.test(l)) || (p.global && p.test(translation))) {
      hits.push(p.source);
    }
  }
  return hits;
}

/**
 * Source-echo detection: did the model copy a large verbatim span of the
 * ENGLISH source instead of translating? Uses a cheap 8-word shingle check.
 */
export function detectSourceEcho(translation: string, sourceText: string): boolean {
  if (!sourceText || !translation) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const src = norm(sourceText);
  const out = new Set(norm(translation));
  if (src.length < 24) return false; // too short for a reliable shingle
  const shingle = 8;
  let matches = 0;
  let windows = 0;
  for (let i = 0; i + shingle <= src.length; i += 4) {
    windows++;
    const w = src.slice(i, i + shingle);
    if (w.every((word) => out.has(word))) matches++;
  }
  return windows > 0 && matches / windows > 0.25;
}

/**
 * Lightweight language heuristic: fraction of characters belonging to the
 * expected target script. Latin targets (fr/de/es/…) always pass this check
 * by definition (English echo is caught by detectSourceEcho instead).
 */
export function detectWrongLanguage(translation: string, langCode: string): boolean {
  const scriptByLang: Record<string, RegExp> = {
    ar: /[\u0600-\u06FF\u0750-\u077F]/,
    ur: /[\u0600-\u06FF\u0750-\u077F]/,
    ks: /[\u0600-\u06FF\u0750-\u077F]/,
    fa: /[\u0600-\u06FF]/,
    hi: /[\u0900-\u097F]/,
    ne: /[\u0900-\u097F]/,
    bn: /[\u0980-\u09FF]/,
    ja: /[\u3040-\u30FF\u4E00-\u9FFF]/,
    ko: /[\uAC00-\uD7AF\u1100-\u11FF]/,
    zh: /[\u4E00-\u9FFF]/,
    ru: /[\u0400-\u04FF]/,
  };
  const re = scriptByLang[langCode];
  if (!re) return false; // Latin-script target: script check not applicable
  const letters = translation.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (letters.length < 12) return false; // too short to judge
  const inScript = (translation.match(new RegExp(re.source, "gu")) || []).length;
  return inScript / Math.max(letters.length, 1) < 0.5;
}

/** Locked glossary terms that MUST appear in the translation (TARGET_FORM). */
export function missingGlossaryTerms(
  translation: string,
  lockedTerms: { en: string; target: string }[],
): string[] {
  const hay = translation.toLowerCase();
  return lockedTerms
    .filter((t) => t.target && t.target.length > 1 && !hay.includes(t.target.toLowerCase()))
    .map((t) => t.en);
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

/**
 * Thin Motherboard Phase 2: the TARGET_FORM values for locked glossary terms
 * that actually appear in this chunk's English source. Callers pass the result
 * to validateChunkResponse; code only VERIFIES presence — never translates.
 */
export function lockedTermsForChunk(
  langCode: string,
  sourceText: string,
): { en: string; target: string }[] {
  const glossary = glossaryData.magicMilitary as Record<
    string,
    Record<string, string>
  >;
  return LOCKED_TERM_LIST.filter((term) => sourceText.includes(term))
    .map((term) => ({
      en: term,
      target: glossary[term]?.[langCode] || glossary[term]?.en || term,
    }));
}

export type Verdict =
  | { action: "accept"; translation: string }
  | { action: "retry_strict"; reason: string; diagnostics?: string }
  | { action: "needs_review"; reason: string; diagnostics?: string };

/**
 * THE validator. Takes a parsed contract (or a parse failure) plus the source
 * context, and returns exactly one verdict. No rewriting. Ever.
 *
 * lockedTerms: the TARGET_FORM values for glossary terms present in this
 * chunk's source (callers extract from src/data/glossary.json + LOCKED_TERM_LIST).
 */
export function validateChunkResponse(args: {
  parse: ParseOutcome;
  langCode: string;
  sourceText: string;
  lockedTerms: { en: string; target: string }[];
  /** true when this response is already the strict-retry attempt */
  alreadyRetried: boolean;
}): Verdict {
  const { parse, langCode, sourceText, lockedTerms, alreadyRetried } = args;

  // Parse failures → strict retry once, then needs_review.
  if (!parse.ok) {
    const diagnostics = parse.rawSample;
    return alreadyRetried
      ? { action: "needs_review", reason: parse.reason, diagnostics }
      : { action: "retry_strict", reason: parse.reason, diagnostics };
  }

  const extractTranslation = (): string => {
    if (parse.kind === "single") return parse.value.translation;
    // Pair validated upstream: caller splits per chunkIndex. For the single
    // validation path, an out-of-context pair is a contract violation.
    return "";
  };

  if (parse.kind === "pair") {
    // Pair shape is valid JSON; per-item verification happens in the pair
    // path (validatePairItems). Reaching here means single-validation got a
    // pair envelope → treat as contract violation for that chunk.
    return alreadyRetried
      ? { action: "needs_review", reason: "pair_envelope_in_single_call" }
      : { action: "retry_strict", reason: "pair_envelope_in_single_call" };
  }

  const translation = parse.value.translation;
  const sc = parse.value.selfCheck;

  // Model self-check lied or reported failure → machine re-verification below
  // decides; a false selfCheck field itself is a contract violation.
  const falseChecks = (Object.keys(sc) as (keyof SelfCheck)[]).filter((k) => sc[k] !== true);
  if (falseChecks.length > 0) {
    const reason = `selfCheck_false:${falseChecks.join(",")}`;
    return alreadyRetried
      ? { action: "needs_review", reason }
      : { action: "retry_strict", reason };
  }

  // ── Machine verification (detection only) ──
  const markers = detectMarkers(translation);
  if (markers.length > 0) {
    const reason = `markers_detected:${markers.length}`;
    return alreadyRetried
      ? { action: "needs_review", reason, diagnostics: translation.slice(0, 400) }
      : { action: "retry_strict", reason, diagnostics: translation.slice(0, 400) };
  }

  if (detectSourceEcho(translation, sourceText)) {
    const reason = "source_echo";
    return alreadyRetried
      ? { action: "needs_review", reason }
      : { action: "retry_strict", reason };
  }

  if (detectWrongLanguage(translation, langCode)) {
    const reason = `wrong_language:${langCode}`;
    return alreadyRetried
      ? { action: "needs_review", reason }
      : { action: "retry_strict", reason };
  }

  const missing = missingGlossaryTerms(translation, lockedTerms);
  if (missing.length > 0) {
    const reason = `glossary_missing:${missing.slice(0, 3).join("|")}`;
    // Glossary misses are the softest signal (translation may legitimately
    // phrase around a term) — strict retry once, then needs_review.
    return alreadyRetried
      ? { action: "needs_review", reason }
      : { action: "retry_strict", reason };
  }

  void extractTranslation;
  return { action: "accept", translation };
}

/**
 * Pair-path validation: verify both items of a pair envelope. Returns the
 * per-chunk translations when both pass, or the failure reason driving the
 * split-into-singles fallback (never kills the dispatcher).
 */
export function validatePairItems(args: {
  pair: PairContract;
  expectedIndexes: [number, number];
  sources: [string, string];
  langCode: string;
  lockedTerms: { en: string; target: string }[];
}): { ok: true; translations: [string, string] } | { ok: false; reason: string } {
  const { pair, expectedIndexes, sources, langCode, lockedTerms } = args;
  if (pair.items.length !== 2) return { ok: false, reason: `items_length_${pair.items.length}` };

  const byIndex = new Map(pair.items.map((i) => [i.chunkIndex, i]));
  const a = byIndex.get(expectedIndexes[0]);
  const b = byIndex.get(expectedIndexes[1]);
  if (!a || !b) return { ok: false, reason: "chunkIndex_mismatch" };

  for (const [item, src] of [[a, sources[0]], [b, sources[1]]] as const) {
    const sc = item.selfCheck;
    const falseChecks = (Object.keys(sc) as (keyof SelfCheck)[]).filter((k) => sc[k] !== true);
    if (falseChecks.length > 0) return { ok: false, reason: `selfCheck_false:${falseChecks.join(",")}` };
    if (detectMarkers(item.translation).length > 0) return { ok: false, reason: "markers_detected" };
    if (detectSourceEcho(item.translation, src)) return { ok: false, reason: "source_echo" };
    if (detectWrongLanguage(item.translation, langCode)) return { ok: false, reason: `wrong_language:${langCode}` };
  }
  const missingA = missingGlossaryTerms(a.translation, lockedTerms);
  const missingB = missingGlossaryTerms(b.translation, lockedTerms);
  if (missingA.length > 0 || missingB.length > 0) {
    return { ok: false, reason: `glossary_missing:${[...missingA, ...missingB].slice(0, 3).join("|")}` };
  }
  return { ok: true, translations: [a.translation, b.translation] };
}

// ─── Test exports (Convex probes / fixtures) ────────────────────────────────
export const translationContractForTest = {
  parseContractResponse,
  detectMarkers,
  detectSourceEcho,
  detectWrongLanguage,
  missingGlossaryTerms,
  lockedTermsForChunk,
  validateChunkResponse,
  validatePairItems,
};
