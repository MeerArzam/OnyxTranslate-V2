/**
 * convex/languageRules.ts — PHASE 4: central language-quality layer.
 *
 * Pure functions only (no Convex imports) so they can be unit-tested locally
 * AND used by both pipelines. Sections:
 *   4.2 LANGUAGE_RULES — ONE central per-language punctuation table
 *   4.1 filterGeneratedArtifacts — removes ONLY proven generated metadata
 *   4.2 normalizePunctuationForLanguage — kills CJK-bracket pollution in
 *       non-CJK languages WITHOUT touching legitimate CJK output in ja/zh
 *   4.3 evaluateLanguageQA — chunk/language-level quality gates
 *   4.4 boundary repair helpers (completeBoundaryAtJoin)
 *
 * NOTHING here removes legitimate book text: artifact patterns are anchored
 * to generated-metadata shapes (Paragraph/Sentence/Translation/Output labels,
 * internal markers) and every removal is counted + typed for the evidence log.
 */

// ─── 4.2 Central per-language rules table ──────────────────────────────────

export type LanguageRule = {
  /** Primary quotation style for dialogue. */
  quotes: [string, string];
  /** Whether CJK corner brackets are APPROPRIATE for this language. */
  cjkBracketsOk: boolean;
  /** Sentence-ending punctuation considered native. */
  sentenceEnd: string[];
  /** Text direction. */
  direction: "ltr" | "rtl";
  /** Main Unicode script blocks that count as "target script" for QA. */
  scriptRegex: string;
  /** Dash used for speaker turns / breaks. */
  dash: string;
};

export const LANGUAGE_RULES: Record<string, LanguageRule> = {
  ur: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: ["\u06D4", "!", "?"],
    direction: "rtl",
    // Arabic script (covers Urdu letters)
    scriptRegex: "\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF",
    dash: "\u2014",
  },
  ar: {
    quotes: ["\u00AB", "\u00BB"],
    cjkBracketsOk: false,
    sentenceEnd: ["\u06D4", ".", "!", "?"],
    direction: "rtl",
    scriptRegex: "\\u0600-\\u06FF\\u0750-\\u077F\\uFB50-\\uFDFF\\uFE70-\\uFEFF",
    dash: "\u2014",
  },
  ks: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: ["\u06D4", "!", "?"],
    direction: "rtl",
    scriptRegex: "\\u0600-\\u06FF\\u0900-\\u097F", // Perso-Arabic + Devanagari heritage
    dash: "\u2014",
  },
  fa: {
    quotes: ["\u00AB", "\u00BB"],
    cjkBracketsOk: false,
    sentenceEnd: ["\u06D4", ".", "!", "?"],
    direction: "rtl",
    scriptRegex: "\\u0600-\\u06FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF",
    dash: "\u2014",
  },
  fr: {
    quotes: ["\u00AB", "\u00BB"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z\\u00C0-\\u024F",
    dash: "\u2014",
  },
  de: {
    quotes: ["\u201E", "\u201C"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z\\u00C0-\\u024F",
    dash: "\u2014",
  },
  es: {
    quotes: ["\u00AB", "\u00BB"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u00A1", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z\\u00C0-\\u024F",
    dash: "\u2014",
  },
  it: {
    quotes: ["\u00AB", "\u00BB"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z\\u00C0-\\u024F",
    dash: "\u2014",
  },
  pt: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z\\u00C0-\\u024F",
    dash: "\u2014",
  },
  ro: {
    quotes: ["\u201E", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z\\u00C0-\\u024F",
    dash: "\u2014",
  },
  tr: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z\\u00C0-\\u024F",
    dash: "\u2014",
  },
  id: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z",
    dash: "\u2014",
  },
  sw: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z",
    dash: "\u2014",
  },
  la: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?"],
    direction: "ltr",
    scriptRegex: "A-Za-z",
    dash: "\u2014",
  },
  ru: {
    quotes: ["\u00AB", "\u00BB"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "\\u0400-\\u04FF",
    dash: "\u2014",
  },
  hi: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: ["\u0964", "\u0965", ".", "!", "?"],
    direction: "ltr",
    scriptRegex: "\\u0900-\\u097F",
    dash: "\u2014",
  },
  bn: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: ["\u0964", "\u0965", ".", "!", "?"],
    direction: "ltr",
    scriptRegex: "\\u0980-\\u09FF",
    dash: "\u2014",
  },
  ne: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: ["\u0964", "\u0965", ".", "!", "?"],
    direction: "ltr",
    scriptRegex: "\\u0900-\\u097F",
    dash: "\u2014",
  },
  ja: {
    quotes: ["\u300C", "\u300D"],
    cjkBracketsOk: true, // CJK brackets ARE native here
    sentenceEnd: ["\u3002", "!", "?"],
    direction: "ltr",
    scriptRegex: "\\u3040-\\u30FF\\u4E00-\\u9FFF\\uFF01-\\uFF9F",
    dash: "\u2015",
  },
  zh: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: true,
    sentenceEnd: ["\u3002", "!", "?"],
    direction: "ltr",
    scriptRegex: "\\u4E00-\\u9FFF\\u3000-\\u303F\\uFF00-\\uFFEF",
    dash: "\u2014",
  },
  ko: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?"],
    direction: "ltr",
    scriptRegex: "\\uAC00-\\uD7AF\\u1100-\\u11FF",
    dash: "\u2014",
  },
  en: {
    quotes: ["\u201C", "\u201D"],
    cjkBracketsOk: false,
    sentenceEnd: [".", "!", "?", "\u2026"],
    direction: "ltr",
    scriptRegex: "A-Za-z",
    dash: "\u2014",
  },
};

export function getLanguageRule(langCode: string): LanguageRule {
  return (
    LANGUAGE_RULES[langCode] ?? LANGUAGE_RULES.en
  );
}

// ─── 4.1 Generated-artifact filter (evidence-logged, conservative) ────────

export type ArtifactRemoval = { kind: string; sample: string };

const ARTIFACT_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  // 【Paragraph 9】 / [Paragraph 9] / 【Paragraph】
  {
    kind: "paragraph_label_bracketed",
    re: /\s*[\u3010\[]\s*Paragraph(?:\s*#?\s*\d+)?\s*[\u3011\]]\s*/gi,
  },
  // Paragraph 9: / Paragraph 9 - (unbracketed, line-anchored)
  {
    kind: "paragraph_label_plain",
    re: /(^|\n)\s*Paragraph\s*#?\s*\d+\s*[:\-—]\s*/gi,
  },
  // Sentence 28: / Sentence 28 -
  {
    kind: "sentence_label",
    re: /(^|\n)\s*Sentence\s*#?\s*\d+\s*[:\-—]\s*/gi,
  },
  // Translation: / Output: / Translated text: (line-anchored meta labels)
  {
    kind: "meta_label",
    re: /(^|\n)\s*(?:Translation|Output|Translated\s+text|Result|Final\s+(?:translation|output))\s*[:：]\s*/gi,
  },
  // ONYX internal pair markers (defensive — never leak to readers)
  {
    kind: "internal_marker",
    re: /<<<\s*ONYX_[A-Z_]+\s*>>>?/g,
  },
  // Model commentary heads
  {
    kind: "model_commentary",
    re: /(^|\n)\s*(?:Here(?:'s| is) (?:the )?(?:translation|your translation)|Sure,? here(?:'s| is)[^:\n]*|Note\s*:|Explanation\s*:)\s*/gi,
  },
  // Placeholder brackets like 【1】 (numbered-only CJK brackets)
  { kind: "numbered_cjk_bracket", re: /\s*\u3010\s*\d{1,3}\s*\u3011\s*/g },
  // Stray chunk markers like [3] or 【Chunk 12】
  {
    kind: "chunk_label",
    re: /\s*[\u3010\[]\s*(?:Chunk|Segment|Part)\s*#?\s*\d+\s*[\u3011\]]\s*/gi,
  },
];

/**
 * Remove ONLY patterns proven to be generated metadata. Returns the cleaned
 * text plus a typed removal log (evidence for /overview + QA).
 * Source-authored labels: the patterns are all shape-anchored to generated
 * metadata (label + optional number + terminator at line start or standalone
 * bracket); prose that merely CONTAINS the word "paragraph" is untouched.
 */
export function filterGeneratedArtifacts(
  text: string,
): { text: string; removals: ArtifactRemoval[] } {
  let out = text;
  const removals: ArtifactRemoval[] = [];
  for (const { kind, re } of ARTIFACT_PATTERNS) {
    out = out.replace(re, (match) => {
      const sample = match.trim().slice(0, 40);
      if (sample) removals.push({ kind, sample });
      // Paragraph/chunk labels separate paragraphs → newline, not space.
      return kind.includes("label") || kind.includes("bracket") ? "\n" : "";
    });
  }
  out = out.replace(/\n{3,}/g, "\n\n");
  return { text: out, removals };
}

// ─── 4.2 Punctuation normalization (no global CJK pollution) ──────────────

/**
 * Replace CJK-style brackets/punctuation in languages where they are NOT
 * native. ja/zh are exempt (cjkBracketsOk). Also strips the RTL mark that
 * post-processing may add before checks (re-added by the pipeline after).
 */
export function normalizePunctuationForLanguage(text: string, langCode: string): string {
  const rule = getLanguageRule(langCode);
  let out = text.replace(/\u200F/g, "").replace(/\u200E/g, "");
  if (rule.cjkBracketsOk) return out;

  const [qOpen, qClose] = rule.quotes;
  // 「...」 / 『...』 → language-appropriate quotes (character-level, keeps content)
  out = out.replace(/[\u300C\u300E]/g, qOpen).replace(/[\u300D\u300F]/g, qClose);
  // 【...】 / 〔...〕 → parentheses of the language (rare legit use → keep visible)
  out = out.replace(/\u3010/g, "(").replace(/\u3011/g, ")");
  out = out.replace(/\u3014/g, "(").replace(/\u3015/g, ")");
  // CJK full stop/comma in non-CJK languages
  if (!/[-JA]/.test("ja") && langCode !== "ja" && langCode !== "zh") {
    out = out.replace(/\u3002/g, rule.sentenceEnd[0] ?? ".").replace(/\u3001/g, ",");
  }
  // Arabic full stop should be Urdu/Arabic dot in RTL languages per rules
  return out;
}

// ─── 4.3 Language-quality QA ───────────────────────────────────────────────

export type LanguageQAReport = {
  ok: boolean;
  score: number; // 0-100
  failures: string[];
  stats: {
    targetScriptRatio: number;
    latinRatio: number;
    lengthRatio: number;
    replacementChars: number;
    artifactCount: number;
    delimiterLeak: boolean;
    sourceEcho: boolean;
    duplicateParagraphs: number;
    empty: boolean;
  };
};

const REPLACEMENT_CHAR = /\uFFFD/g;

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

export function evaluateLanguageQA(
  langCode: string,
  sourceText: string,
  translated: string,
  opts: { minScriptRatio?: number; maxEnglishEchoRatio?: number } = {},
): LanguageQAReport {
  const rule = getLanguageRule(langCode);
  const failures: string[] = [];
  const t = translated.replace(/\u200F|\u200E/g, "");
  const total = [...t].length;
  const stats = {
    targetScriptRatio: 0,
    latinRatio: 0,
    lengthRatio: 0,
    replacementChars: countMatches(t, REPLACEMENT_CHAR),
    artifactCount: 0,
    delimiterLeak: /ONYX_CHUNK|ONYX_TRANSLATION/.test(t),
    sourceEcho: false,
    duplicateParagraphs: 0,
    empty: t.trim().length === 0,
  };

  if (stats.empty) failures.push("empty output");

  // Script ratios
  const targetRe = new RegExp(`[${rule.scriptRegex}]`, "g");
  const latinRe = /[A-Za-z]/g;
  const targetCount = countMatches(t, targetRe);
  const latinCount = countMatches(t, latinRe);
  stats.targetScriptRatio = total ? targetCount / total : 0;
  stats.latinRatio = total ? latinCount / total : 0;

  // Non-Latin targets must be predominantly in their own script.
  const scriptReGlobal = /^\\u|^\\p/.test(rule.scriptRegex);
  if (scriptReGlobal && !stats.empty) {
    const minRatio = opts.minScriptRatio ?? 0.5;
    if (stats.targetScriptRatio < minRatio) {
      failures.push(
        `target-script ratio too low (${(stats.targetScriptRatio * 100).toFixed(1)}% < ${(minRatio * 100).toFixed(0)}%)`,
      );
    }
    // English echo: long English words that are NOT locked proper nouns.
    const properNouns = /\b(Violet|Xaden|Tairn|Andarna|Ridoc|Dain|Basgiath|Navarre|Tyrrendor|Venin|Riorson|Sorrengail|Aetos|Gamlyn)\b/g;
    const englishish = t.replace(properNouns, "");
    const englishWords = englishish.match(/\b[A-Za-z]{3,}\b/g) ?? [];
    const totalWords = englishish.match(/[\p{L}\p{M}]+/gu)?.length ?? (englishWords.length || 1);
    if (englishWords.length / Math.max(totalWords, 1) > (opts.maxEnglishEchoRatio ?? 0.25)) {
      failures.push(`excessive unchanged English (${englishWords.length} words)`);
      stats.sourceEcho = true;
    }
  }

  // Source echo: translation nearly identical to source (non-Latin targets).
  if (!stats.empty) {
    const isCjk = rule.cjkBracketsOk; // ja/zh: no spaces → word ratio meaningless
    if (isCjk) {
      const srcChars = [...sourceText].length;
      const trChars = [...t].length;
      stats.lengthRatio = srcChars ? trChars / srcChars : 0;
      if (stats.lengthRatio > 0 && (stats.lengthRatio < 0.2 || stats.lengthRatio > 4)) {
        failures.push(`abnormal length ratio (${stats.lengthRatio.toFixed(2)}x)`);
      }
    } else {
      const srcWords = sourceText.split(/\s+/).filter(Boolean);
      const trWords = t.split(/\s+/).filter(Boolean);
      stats.lengthRatio = srcWords.length ? trWords.length / srcWords.length : 0;
    }
    if (rule.direction === "rtl" || scriptReGlobal) {
      if (stats.lengthRatio > 0.4 && stats.targetScriptRatio < 0.3) {
        failures.push("likely source echo (length similar, wrong script)");
        stats.sourceEcho = true;
      }
    }
    // Abnormal length ratio (space-language branch)
    if (!rule.cjkBracketsOk) {
      if (stats.lengthRatio > 0 && (stats.lengthRatio < 0.35 || stats.lengthRatio > 3.5)) {
        failures.push(`abnormal length ratio (${stats.lengthRatio.toFixed(2)}x)`);
      }
    }
  }

  // Delimiter / artifact leakage
  if (stats.delimiterLeak) failures.push("internal delimiter leaked");
  const { removals } = filterGeneratedArtifacts(t);
  stats.artifactCount = removals.length;
  if (removals.length > 0) failures.push(`artifact leakage (${removals.length} removed by filter)`);

  // Broken RTL markers / replacement glyphs
  if (stats.replacementChars > 0) {
    failures.push(`replacement-character glyphs (${stats.replacementChars})`);
  }

  // Missing/duplicate paragraphs (chunk level: compare counts)
  const srcParas = sourceText.split(/\n{2,}/).filter((p) => p.trim());
  const trParas = t.split(/\n{2,}/).filter((p) => p.trim());
  const seen = new Map<string, number>();
  for (const p of trParas) {
    const key = p.trim().slice(0, 80);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [, n] of seen) if (n > 1) stats.duplicateParagraphs++;
  if (srcParas.length > 0 && trParas.length < Math.floor(srcParas.length * 0.6)) {
    failures.push(`missing paragraphs (${trParas.length}/${srcParas.length})`);
  }
  if (stats.duplicateParagraphs > 0 && trParas.length > 2) {
    failures.push(`duplicate paragraphs (${stats.duplicateParagraphs})`);
  }

  const score = Math.max(0, 100 - failures.length * 20);
  return { ok: failures.length === 0, score, failures, stats };
}

// ─── 4.4 Chunk-boundary repair ─────────────────────────────────────────────

/**
 * Detect a true sentence continuation at a chunk join: prev ends mid-sentence
 * (no terminal punctuation) and next begins lowercase/continuation. Returns
 * the repaired join or null when no repair is needed — NEVER invents content,
 * only removes a spurious hard break (newline) between two halves of one
 * sentence so assembly reads continuously.
 */
export function completeBoundaryAtJoin(prev: string, next: string): {
  repaired: boolean;
  prev: string;
  next: string;
} {
  const rule = getLanguageRule("en"); // shape-level check; works cross-script
  const p = prev.replace(/\s+$/, "");
  const n = next.replace(/^\s+/, "");
  if (!p || !n) return { repaired: false, prev, next };
  const lastChar = [...p].pop() ?? "";
  const firstChar = [...n][0] ?? "";
  const endsSentence = rule.sentenceEnd.includes(lastChar);
  const startsContinuation =
    firstChar === firstChar.toLowerCase() &&
    firstChar !== firstChar.toUpperCase() &&
    !/^[\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF]/.test(n);
  if (!endsSentence && startsContinuation) {
    return { repaired: true, prev: p, next: n };
  }
  return { repaired: false, prev: p, next: n };
}

/** Boundary repair at final assembly: joins chunks in order, repairing only
 * true mid-sentence breaks (single space) and preserving paragraph breaks. */
export function assembleWithBoundaryRepair(parts: string[]): string {
  if (parts.length === 0) return "";
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const join = completeBoundaryAtJoin(out, parts[i]);
    if (join.repaired) {
      out = `${join.prev} ${join.next}`;
    } else {
      out = `${join.prev}\n\n${join.next}`;
    }
  }
  return out;
}
