/**
 * VLY AI translation module (Part D.1-D.2 of the 18-phase spec).
 *
 * Builds the full 18-phase (+5 extra) localization SYSTEM_PROMPT by injecting
 * the per-language Part C config, the locked glossary column, the name
 * transliterations and the character voice matrix, then calls
 * vly.ai.completion(). Used by engine.ts as the primary translation engine,
 * with neural MT and glossary-swap as fallbacks.
 */

import glossaryData from "../../data/glossary.json";
import { getLocalizationConfig } from "../../data/localization";
import { characterVoices } from "./voices";

/**
 * Minimal structural type for the VLY AI completion client. The real type
 * comes from @vly-ai/integrations (see src/lib/vly-integrations.ts), which we
 * lazy-load so the heavy module + its process.env access never runs unless the
 * platform has injected the integration key into the browser build.
 */
interface VlyCompletionRequest {
  model?: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
}

interface VlyCompletionResponse {
  success: boolean;
  data?: {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };
  error?: string;
}

interface VlyClient {
  ai: {
    completion: (
      request: VlyCompletionRequest
    ) => Promise<VlyCompletionResponse>;
  };
}

export interface VlyTranslateResult {
  ok: boolean;
  text: string;
  mode: "vly" | "fallback";
  reason?: string;
}

export type VlyStatusCallback = (message: string) => void;

// ──────────────────────────────────────────────
// Prompt building
// ──────────────────────────────────────────────

const LOCKED_TERM_LIST = [
  "Signet", "Venin", "Sages", "Mavens", "Wards", "Empyrean", "Conduits",
  "Alloy", "Irid", "Dragon Rider", "Battle Wards", "Mending", "Squadron",
  "Basgiath", "Rune", "Scribe", "Rider",
];

const PHASE_RULES_A = [
  ["P1", "GLOSSARY & TERM FIDELITY", "Use EXACTLY the per-language terms from the locked glossary below (magic/military terms + proper nouns). Never invent synonyms."],
  ["P2", "PROPER NOUN & NAME CONSISTENCY", "Use the language's locked name spellings from the Name Map below. Same name = same spelling every time, book-wide."],
  ["P3", "LITERAL-TO-NATURAL BRIDGE", "Translate meaning, not words. If a literal rendering sounds unnatural, rephrase naturally while keeping the meaning and the book's imagery."],
  ["P4", "CHARACTER VOICE & DIALOGUE", "Apply the Voice Matrix below. Keep speaker attributions and line breaks; preserve dialogue turns 1:1."],
  ["P5", "TONE & REGISTER", "Match the register of this language's literary fantasy (elevated/poetic where the culture expects it, grounded where it doesn't). First-person internal monologue stays intimate."],
  ["P6", "CULTURAL CONTEXTUALIZATION & CENSORSHIP", "Apply market rules: profanity euphemized per market, intimacy handled per cultural norms, political/religious content adapted."],
  ["P7", "HONORIFICS & FORMALITY", "Apply the language's formality system below. Drop formality in emotional-breaking scenes; escalate in formal/military scenes."],
  ["P8", "MULTI-SCRIPT & RTL FORMATTING", "Use the correct script. For RTL languages (ur/ar/ks) render naturally with no leftover English order artifacts. For script languages, ZERO Latin-script words outside the allowed names."],
  ["P9", "MAGIC SYSTEM & TECHNICAL FANTASY TERMS", "Translate the magic system as a coherent hierarchy per the Magic System note below. 'Rune' must never become a generic spell; keep ward/conduit/signet consistent."],
  ["P10", "DIALOGUE FLOW & QUOTATION CONVENTIONS", "Use this language's dialogue punctuation from the Dialogue Marks below. Preserve paragraph breaks and speaker turns."],
  ["P11", "INTERNAL MONOLOGUE & STREAM OF CONSCIOUSNESS", "Preserve Violet's internal thoughts (dashes/italics as the language uses), self-interruption, and the 'I won't. I refuse.' rhythm — keep it first-person."],
  ["P12", "ACTION PACING & SENTENCE RHYTHM", "Match action-scene norms per language (short punchy sentences for combat; flowing rhythm for Romance languages). Keep tension and chapter momentum."],
  ["P13", "ROMANCE & INTIMACY FILTERING", "Apply market romance norms from the Profanity/Cultural map. France/Italy = poetic; Japan/Korea = fated-pair subtlety; Germany/Russia = grim endurance."],
  ["P14", "PROFANITY & MATURE CONTENT", "Map English expletives to culturally appropriate equivalents or euphemisms from the Profanity Map below; keep character authenticity without gratuitousness."],
  ["P15", "POLITICAL & MILITARY SENSITIVITY", "Adapt ranks and hierarchy from the Rank Map below — no literal calques."],
  ["P16", "DRAGON TELEPATHY & BOND SPEECH", "Render dragon-mind speech with the language's markers (「」/『』/【】) and differentiate dragon voices from human dialogue; keep the bond's intimacy."],
  ["P17", "VISUAL & LAYOUT AWARENESS", "Translate chapter titles and front matter too. Keep translated text length-aware (expansion/shrink per the Style Sheet) so it fits the original PDF text areas."],
  ["P18", "FINAL QA & SELF-VERIFICATION", "Self-check before returning: consistency, no English leftovers (script languages), no commentary/notes, grammar, cultural fit."],
];

const PHASE_RULES_B = [
  ["P19", "TRANSLATION MEMORY & SEQUEL CONSISTENCY", "Lock every term/name decision to a fixed choice; future books must reuse it. Be maximally consistent with the glossary below."],
  ["P20", "FAN-NOMENCLATURE ALIGNMENT", "For zh/ko/ru, adopt the fan-name spellings in the Fan Names map where given, so the translation matches what readers already use."],
  ["P21", "BLURB & MARKETING LOCALIZATION", "N/A for body text — blurbs are handled separately per market."],
  ["P22", "PER-LANGUAGE STYLE SHEET", "Follow the Style Sheet below: formality level, gender handling, archaic-vs-modern register, sentence-length preference, numerals/units."],
  ["P23", "CHAPTER & METADATA FIDELITY", "Translate chapter titles, TOC entries, epigraphs, and the Jesinia frame ('transcribed by Jesinia Neilwart…') with the same fidelity as body text."],
];

const VOICE_MATRIX = [
  ["Violet Sorrengail", characterVoices.violet.internalThought, characterVoices.violet.dialogueStyle, characterVoices.violet.examples.declaration],
  ["Xaden Riorson", "Clipped, arrogant, icily possessive. Short declarative sentences. No polite/formal honorifics with Violet. Deep possessive pronouns.", characterVoices.xaden.examples.possessive],
  ["Ridoc Gamlyn", "Modern, sarcastic, comedic relief. Sacrifice literal English jokes for culturally equivalent humor.", characterVoices.ridoc.examples.declaration],
  ["Dain Aetos", "Controlled, political, strategic. Formal and precise, uses titles and protocol.", characterVoices.dain.examples.command],
  ["Tairn", "Gruff, formal, ancient. Speaks through the bond in short commands.", "Mine. Always."],
  ["Andarna", "Young, teasing, affectionate. Lighter register than Tairn.", "I choose you."],
];

function buildGlossaryColumn(langCode: string): string {
  const glossary = glossaryData.magicMilitary as Record<string, Record<string, string>>;
  const lines: string[] = [];
  for (const term of LOCKED_TERM_LIST) {
    const entry = glossary[term];
    if (!entry) continue;
    const target = entry[langCode] || entry.en;
    lines.push(`  - ${term} → ${target}`);
  }
  return lines.join("\n");
}

function buildNameMap(langCode: string): string {
  const cfg = getLocalizationConfig(langCode);
  if (!cfg) return "(no name map)";
  return Object.entries(cfg.names)
    .map(([en, localized]) => `  - ${en} → ${localized}`)
    .join("\n");
}

function buildMarketContext(marketContext: string): string {
  switch (marketContext) {
    case "high-censorship":
      return "HIGH-CENSORSHIP market: keep all intimacy strictly implied, euphemize profanity heavily, and adapt any political/religious content to local norms.";
    case "romance-focused":
      return "ROMANCE-FOCUSED market: lean into fated-pair emotion and chemistry with cultural subtlety; keep intimacy tasteful per local norms.";
    case "standard":
    default:
      return "STANDARD market: publish-grade literary fantasy localization with age-appropriate content handling.";
  }
}

export function buildSystemPrompt(langCode: string, marketContext = "standard"): string {
  const cfg = getLocalizationConfig(langCode);
  const langLine = cfg
    ? `${cfg.name} (${cfg.nativeName}) — ${cfg.script} script${cfg.rtl ? ", RTL" : ""}`
    : langCode;

  const dialogueMarks = cfg
    ? `Open: ${cfg.dialogue.open} | Close: ${cfg.dialogue.close} | ${cfg.dialogue.note}`
    : "Use the language's standard quotation marks";

  const profanityMap = cfg
    ? Object.entries(cfg.profanity)
        .map(([en, local]) => `  - ${en} → ${local}`)
        .join("\n")
    : "  - (none configured)";

  const rankMap = cfg
    ? Object.entries(cfg.ranks)
        .map(([en, local]) => `  - ${en} → ${local}`)
        .join("\n")
    : "  - (none configured)";

  const fanNames = cfg && Object.keys(cfg.fanNames).length
    ? Object.entries(cfg.fanNames).map(([en, fan]) => `  - ${en} → ${fan}`).join("\n")
    : "  - (none for this language)";

  const styleSheet = cfg
    ? `Register: ${cfg.styleSheet.register}\n  Sentence length: ${cfg.styleSheet.sentenceLength}\n  Gender handling: ${cfg.styleSheet.gender}\n  Archaic vs modern: ${cfg.styleSheet.archaic}\n  Numerals: ${cfg.styleSheet.numerals}`
    : "(none)";

  const magicSystem = cfg ? cfg.magicSystem : "(none)";

  const phaseA = PHASE_RULES_A.map(([id, name, rule]) => `### ${id}. ${name}\n${rule}`).join("\n\n");
  const phaseB = PHASE_RULES_B.map(([id, name, rule]) => `### ${id}. ${name}\n${rule}`).join("\n\n");
  const voices = VOICE_MATRIX.map(
    ([name, style, example], i) => `${i + 1}. ${name}: ${style}\n   Example: ${example}`
  ).join("\n");

  return [
    "You are the Empyrean Translator — a world-class literary localization engine for the epic high-fantasy novel ONYX STORM (English source).",
    "You translate the source text into a professionally localized edition that reads as NATIVE fiction in the target market — never as word-swapped English. You follow every phase below, in order, before producing your output.",
    "",
    `TARGET LANGUAGE: ${langLine}`,
    `MARKET CONTEXT: ${buildMarketContext(marketContext)}`,
    "",
    "# PART A — THE 18 PHASES",
    phaseA,
    "",
    "# PART B — 5 EXTRA PHASES",
    phaseB,
    "",
    "# PART C — PER-LANGUAGE CONFIG",
    `DIALOGUE MARKS:\n${dialogueMarks}`,
    `FORMALITY SYSTEM: ${cfg ? `${cfg.formality.system} — informal: ${cfg.formality.informal}, formal: ${cfg.formality.formal}. ${cfg.formality.note}` : "(none)"}`,
    "",
    "PROFANITY MAP (use these or milder equivalents):",
    profanityMap,
    "",
    "RANK MAP:",
    rankMap,
    "",
    "MAGIC SYSTEM NOTE:",
    magicSystem,
    "",
    "FAN NAMES (zh/ko/ru only):",
    fanNames,
    "",
    "STYLE SHEET:",
    styleSheet,
    "",
    "# LOCKED GLOSSARY (use EXACTLY these, book-wide)",
    buildGlossaryColumn(langCode),
    "",
    "# NAME MAP (same name = same spelling, always)",
    buildNameMap(langCode),
    "",
    "# CHARACTER VOICE MATRIX",
    voices,
    "",
    "# OUTPUT RULES",
    "1. Return ONLY the translated text. No commentary, no notes, no explanations, no metadata, no markdown fences.",
    "2. Preserve paragraph breaks, speaker turns and dialogue lines 1:1 with the source.",
    "3. Use the language's dialogue punctuation (P10) and telepathy markers (P16).",
    "4. For script languages (non-Latin scripts): ZERO Latin-script words may remain, except the allowed names listed in the Name Map.",
    "5. Translate chapter titles and headings with the same fidelity as body text.",
    "6. The result must read like it was written in the target language by a native literary translator.",
  ].join("\n");
}

// ──────────────────────────────────────────────
// Completion
// ──────────────────────────────────────────────

let cachedVly: VlyClient | null | undefined;
let vlyProbeDone = false;

/**
 * Lazily load the VLY integrations client. The module reads
 * process.env.VLY_INTEGRATION_KEY, which only exists when the platform
 * injected it into the browser build — so we probe inside try/catch and
 * never let a missing env crash the app.
 */
async function getVlyClient(): Promise<VlyClient | null> {
  if (vlyProbeDone) return cachedVly ?? null;
  vlyProbeDone = true;
  try {
    const mod = await import("@/lib/vly-integrations");
    cachedVly = ((mod as { vly?: unknown }).vly as VlyClient | undefined) ?? null;
  } catch {
    cachedVly = null;
  }
  return cachedVly;
}

/**
 * Translate one chunk through VLY AI.
 * Returns ok:false (fast) when VLY isn't available; throws only on a real
 * API failure so the caller falls back to neural/glossary mode.
 */
export async function vlyTranslateChunk(
  sourceText: string,
  langCode: string,
  marketContext = "standard",
  onStatus?: VlyStatusCallback
): Promise<VlyTranslateResult> {
  const client = await getVlyClient();
  if (!client) {
    return {
      ok: false,
      text: "",
      mode: "fallback",
      reason: "VLY integration not available in this build",
    };
  }

  onStatus?.("Building 18-phase localization prompt…");

  const systemPrompt = buildSystemPrompt(langCode, marketContext);

  onStatus?.("Calling VLY AI…");

  const resp = await client.ai.completion({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: sourceText },
    ],
    temperature: 0.3,
    maxTokens: 4000,
  });

  if (!resp.success) {
    throw new Error(resp.error || "VLY AI completion failed");
  }

  const content = resp.data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) {
    throw new Error("VLY AI returned an empty translation");
  }

  // Strip accidental markdown fences
  const cleaned = content.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

  return { ok: true, text: cleaned, mode: "vly" };
}
