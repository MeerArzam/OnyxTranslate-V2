"use node";
/**
 * convex/translate.ts — Server-side DeepSeek localization via the VLY gateway.
 *
 * The VLY_INTEGRATION_KEY is read from process.env on the Convex server (never
 * exposed to the browser bundle). Contains the full 23-phase buildSystemPrompt
 * relocated verbatim from src/lib/translator/vlyTranslate.ts.
 */
import { action } from "./_generated/server";
import { v } from "convex/values";
import { createVlyIntegrations } from "@vly-ai/integrations";

// ── Data imports (resolved by Convex's esbuild from src/) ──
import glossaryData from "../src/data/glossary.json";
import { getLocalizationConfig } from "../src/data/localization";
import { characterVoices } from "../src/lib/translator/voices";

// ════════════════════════════════════════════════════════════
// Model configuration
// ════════════════════════════════════════════════════════════

const DEEPSEEK_MODEL_CANDIDATES = [
  "deepseek-chat",
  "deepseek-v4-flash",
  "deepseek-r1",
  "deepseek-thinking",
] as const;

let resolvedModel: string | null = null;

// ════════════════════════════════════════════════════════════
// buildSystemPrompt — VERBATIM from src/lib/translator/vlyTranslate.ts
// All 23 phases, deep-reasoning protocol, per-language config,
// locked glossary column, name map, character voice matrix.
// ════════════════════════════════════════════════════════════

const LOCKED_TERM_LIST = [
  "Signet", "Venin", "Sages", "Mavens", "Wards", "Empyrean", "Conduits",
  "Alloy", "Irid", "Dragon Rider", "Battle Wards", "Mending", "Squadron",
  "Basgiath", "Rune", "Scribe", "Rider",
];

const PHASE_RULES: [string, string, string][] = [
  ["P1", "GLOSSARY & TERM FIDELITY", "Use EXACTLY the per-language terms from the locked glossary below (magic/military terms + proper nouns). Never invent synonyms."],
  ["P2", "PROPER NOUN & NAME CONSISTENCY", "Use the language's locked name spellings from the Name Map. Same name = same spelling every time, book-wide."],
  ["P3", "LITERAL-TO-NATURAL BRIDGE", "Translate the meaning, not word-for-word. If a literal rendering sounds unnatural, rephrase naturally while preserving meaning, imagery, and the book's voice."],
  ["P4", "CHARACTER VOICE & DIALOGUE", "Apply the Voice Matrix. Keep speaker attributions and line breaks intact; preserve dialogue turns 1:1."],
  ["P5", "TONE & REGISTER", "Match the register of this language's literary fantasy (poetic where the culture expects it, grounded where it doesn't). First-person internal monologue stays intimate; narration stays immersive."],
  ["P6", "CULTURAL CONTEXTUALIZATION & CENSORSHIP", "Apply market rules from the Market Context and the Profanity/Cultural map: euphemize profanity per market, handle intimacy per cultural norms, adapt political/religious content."],
  ["P7", "HONORIFICS & FORMALITY", "Apply the language's formality system (Japanese keigo, Korean jondaetmal, Urdu adab, French vous/tu, German Sie/du…). Drop formality in emotional-breaking scenes; escalate in formal/military scenes."],
  ["P8", "MULTI-SCRIPT & RTL FORMATTING", "Use the correct script. For RTL languages (ur/ar/ks) render naturally with ZERO English-order artifacts; use the language's native punctuation. For script languages, ZERO Latin-script words outside the allowed names."],
  ["P9", "MAGIC SYSTEM & FANTASY TERMINOLOGY", "Translate the magic system as a coherent hierarchy per the Magic System note (French: sceau/maîtriser/puiser; German: Wappen|Siegel/handhaben/schöpfen; Korean: 인장/구사하다…). 'Rune' must never become a generic spell; keep ward/conduit/signet consistent."],
  ["P10", "DIALOGUE FLOW & PUNCTUATION", "Use this language's dialogue punctuation from the Dialogue Marks (French \u00ab \u00bb, German \u201e\u2026, Japanese \u300c\u300d, Spanish \u2014, etc.). Keep interruptions, mid-sentence cuts (em-dashes) and beat breaks natural."],
  ["P11", "INTERNAL MONOLOGUE", "Keep Violet's first-person inner voice intimate, urgent, and emphasis-aware (reproduce italics/emphasis naturally in the target language); keep self-interruption and the 'I won't. I refuse.' rhythm."],
  ["P12", "ACTION PACING", "Keep fight scenes short, punchy, and immediate; preserve the sentence rhythm of action and chapter momentum."],
  ["P13", "ROMANCE & INTIMACY FILTERS", "Apply the language's market norms for romantic/intimate content — tasteful, natural, never clinical, never overly sanitized unless the market requires it."],
  ["P14", "PROFANITY & SLANG LOCALIZATION", "Replace English profanity with culturally equivalent (not literal) expressions; keep intensity levels matching the scene (mild vs. strong)."],
  ["P15", "POLITICAL & MILITARY SENSITIVITY", "Adapt war and political content per market rules; keep the story's meaning, don't editorialize. Use the Rank Map for military hierarchy."],
  ["P16", "DRAGON TELEPATHY FORMATTING", "Format dragon mental speech per language convention (\u300c\u300d/\u3010\u3011 for ja/ko/zh, italics or guillemets elsewhere); keep it distinct from spoken dialogue and keep the bond's intimacy."],
  ["P17", "VISUAL-ELEMENT EXTRACTION (PDF-AWARE)", "When translating text near images, maps or illustrations, keep captions and map labels translated and short enough to fit their text boxes."],
  ["P18", "SELF-VERIFICATION PASS", "Before replying, self-check this chunk against P1-P17 and fix violations silently."],
  ["P19", "CHAPTER HEADINGS, TOC & FRONT/BACK MATTER", "Translate chapter titles, the Contents list, the copyright page and acknowledgments in the same style as the body; keep chapter numbering consistent."],
  ["P20", "POETRY, SONGS, RITUALS & PROVERBS", "For verse, songs and ritual chants, prioritize naturalness and rhythm over literalness; keep line structure where possible; adapt proverbs idiomatically."],
  ["P21", "BOOK-WIDE CONSISTENCY & MEMORY LOCK", "The glossary, names, terms and style are locked: the same term must translate identically in every chapter, forever."],
  ["P22", "LAYOUT & TEXT-FIT", "Keep translated lines reasonably short so they fit the PDF text boxes; prefer concise phrasings; for RTL, expect right-aligned flow."],
  ["P23", "FINAL QA & PROOFREAD (deep reasoning)", "Do a final read-through as a native editor: fix grammar, unnatural phrasing, typos and any phase violations; the chunk must read like published fiction."],
];

const REASONING_PROTOCOL = [
  "1. PLAN — identify dialogue vs. narration vs. telepathy; spot glossary and name hits; flag culturally sensitive lines.",
  "2. DRAFT — translate with the language's natural grammar and register.",
  "3. SELF-CRITIQUE — check P1-P23 violations, unnatural phrasing, Latin leftovers.",
  "4. REFINE — rewrite once, silently fixing everything found.",
  "The user only ever sees the final refined text — never show the reasoning.",
];

const VOICE_MATRIX: [string, string, string][] = [
  ["Violet Sorrengail", characterVoices.violet.internalThought, characterVoices.violet.dialogueStyle],
  ["Xaden Riorson", "Clipped, arrogant, icily possessive. Short declarative sentences. No polite/formal honorifics with Violet. Deep possessive pronouns.", ""],
  ["Ridoc Gamlyn", "Modern, sarcastic, comedic relief. Sacrifice literal English jokes for culturally equivalent humor.", ""],
  ["Dain Aetos", "Controlled, political, strategic. Formal and precise, uses titles and protocol.", ""],
  ["Tairn", "Gruff, formal, ancient. Speaks through the bond in short commands.", ""],
  ["Andarna", "Young, teasing, affectionate. Lighter register than Tairn.", ""],
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

function buildSystemPrompt(langCode: string, marketContext = "standard"): string {
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

  const phaseRules = PHASE_RULES.map(([id, name, rule]) => `### ${id}. ${name}\n${rule}`).join("\n\n");
  const reasoning = REASONING_PROTOCOL.join("\n");
  const voices = VOICE_MATRIX.map(
    ([name, style, example], i) => `${i + 1}. ${name}: ${style}${example ? `\n   Example: ${example}` : ""}`
  ).join("\n");

  return [
    "You are the Empyrean Translator — a world-class literary localization engine for the epic high-fantasy novel ONYX STORM (English source).",
    "You translate the source text into a professionally localized edition that reads as NATIVE fiction in the target market — never as word-swapped English. You follow every phase below, in order, before producing your output.",
    "",
    `TARGET LANGUAGE: ${langLine}`,
    `MARKET CONTEXT: ${buildMarketContext(marketContext)}`,
    "",
    "# THE 23 PHASES",
    phaseRules,
    "",
    "# DEEP REASONING PROTOCOL (think before you write)",
    reasoning,
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
    "1. Return ONLY the translated text — no explanations, no notes, no metadata, no markdown fences, and no quotation marks around the reply.",
    "2. Preserve paragraph breaks, speaker turns and dialogue lines 1:1 with the source.",
    "3. Use the language's dialogue punctuation (P10) and telepathy markers (P16).",
    "4. For script languages (non-Latin scripts): ZERO Latin-script words may remain, except the allowed names listed in the Name Map.",
    "5. Translate chapter titles and headings with the same fidelity as body text.",
    "6. The result must read like it was written in the target language by a native literary translator.",
  ].join("\n");
}

// ════════════════════════════════════════════════════════════
// translateChunk — Convex action (server-side, key in process.env)
// ════════════════════════════════════════════════════════════

export const translateChunk = action({
  args: {
    text: v.string(),
    langCode: v.string(),
    marketContext: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const key = process.env.VLY_INTEGRATION_KEY;
    if (!key) {
      throw new Error("VLY_INTEGRATION_KEY missing on server — check project settings");
    }

    const client = createVlyIntegrations({ deploymentToken: key });

    // ── Model probe (cached across calls) ──
    if (!resolvedModel) {
      for (const m of DEEPSEEK_MODEL_CANDIDATES) {
        try {
          const probe = await client.ai.completion({
            model: m,
            messages: [{ role: "user", content: "Reply with the single word: OK" }],
            temperature: 0,
            maxTokens: 4,
          });
          if (probe.success && probe.data?.choices?.[0]?.message?.content) {
            resolvedModel = m;
            break;
          }
        } catch {
          // try next candidate
        }
      }
      if (!resolvedModel) resolvedModel = "gateway-default";
    }

    // ── Translate ──
    const systemPrompt = buildSystemPrompt(args.langCode, args.marketContext);

    const completion = await client.ai.completion({
      model: resolvedModel === "gateway-default" ? undefined : resolvedModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: args.text },
      ],
      temperature: 0.3,
      maxTokens: 4000,
    });

    if (!completion.success) {
      throw new Error(completion.error || "VLY AI completion failed on server");
    }

    // ApiResponse<AICompletionResponse> shape:
    //   completion.data.choices[0].message.content
    //   completion.data.usage.promptTokens / completionTokens / totalTokens
    //   completion.usage.credits (gateway-level)
    const content = completion.data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      throw new Error("VLY AI returned an empty translation");
    }

    // Strip accidental markdown fences
    const cleaned = content.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();

    return {
      ok: true,
      text: cleaned,
      model: resolvedModel,
      usage: {
        credits: completion.usage?.credits ?? null,
        promptTokens: completion.data?.usage?.promptTokens ?? null,
        completionTokens: completion.data?.usage?.completionTokens ?? null,
        totalTokens: completion.data?.usage?.totalTokens ?? null,
      },
    };
  },
});
