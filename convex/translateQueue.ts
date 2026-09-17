"use node";
/**
 * convex/translateQueue.ts — Autonomous server-side translation queue.
 *
 * Reads chunks from the DB, translates each via Gemini (5-key rotation),
 * chains languages automatically. User can close browser — server continues.
 */
import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ── Data imports (resolved by Convex's esbuild from src/) ──
import glossaryData from "../src/data/glossary.json";
import { getLocalizationConfig } from "../src/data/localization";
import { characterVoices } from "../src/lib/translator/voices";

// ── Pipeline imports: Bible Pass, Cultural Filters, Formatters, QA ──
import { applyCulturalFilters, detectExplicitContent } from "../src/lib/translator/cultural";
import { formatDragonTelepathy, isRTL as isRTLLang, getScriptConfig } from "../src/lib/translator/formatters";
import { runQA, type MemoryLockEntry } from "../src/lib/translator/qa";

// ════════════════════════════════════════════════════════════
// Constants
// ════════════════════════════════════════════════════════════

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

const CHUNK_SIZE = 2500;

const LANGUAGES = [
  "ur", "ar", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko",
  "de", "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
];

// ════════════════════════════════════════════════════════════
// buildSystemPrompt — VERBATIM copy from convex/translate.ts
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
  ["P7", "HONORIFICS & FORMALITY", "Apply the language's formality system (Japanese keigo, Korean jondaetmal, Urdu adab, French vous/tu, German Sie/du\u2026). Drop formality in emotional-breaking scenes; escalate in formal/military scenes."],
  ["P8", "MULTI-SCRIPT & RTL FORMATTING", "Use the correct script. For RTL languages (ur/ar/ks) render naturally with ZERO English-order artifacts; use the language's native punctuation. For script languages, ZERO Latin-script words outside the allowed names."],
  ["P9", "MAGIC SYSTEM & FANTASY TERMINOLOGY", "Translate the magic system as a coherent hierarchy per the Magic System note (French: sceau/\u00e9tatiser/puiser; German: Wappen|Siegel/handhaben/sch\u00f6pfen; Korean: \uc778\uc7a5/\uad6c\uc0ac\ud558\ub2e4\u2026). 'Rune' must never become a generic spell; keep ward/conduit/signet consistent."],
  ["P10", "DIALOGUE FLOW & PUNCTUATION", "Use this language's dialogue punctuation from the Dialogue Marks (French \u00ab \u00bb, German \u201e\u2026, Japanese \u300c\u300d, Spanish \u2014, etc.). Keep interruptions, mid-sentence cuts (em-dashes) and beat breaks natural."],
  ["P11", "INTERNAL MONOLOGUE", "Keep Violet's first-person inner voice intimate, urgent, and emphasis-aware (reproduce italics/emphasis naturally in the target language); keep self-interruption and the 'I won't. I refuse.' rhythm."],
  ["P12", "ACTION PACING", "Keep fight scenes short, punchy, and immediate; preserve the sentence rhythm of action and chapter momentum."],
  ["P13", "ROMANCE & INTIMACY FILTERS", "Apply the language's market norms for romantic/intimate content \u2014 tasteful, natural, never clinical, never overly sanitized unless the market requires it."],
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
  "1. PLAN \u2014 identify dialogue vs. narration vs. telepathy; spot glossary and name hits; flag culturally sensitive lines.",
  "2. DRAFT \u2014 translate with the language's natural grammar and register.",
  "3. SELF-CRITIQUE \u2014 check P1-P23 violations, unnatural phrasing, Latin leftovers.",
  "4. REFINE \u2014 rewrite once, silently fixing everything found.",
  "The user only ever sees the final refined text \u2014 never show the reasoning.",
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
    lines.push(`  - ${term} \u2192 ${target}`);
  }
  return lines.join("\n");
}

function buildNameMap(langCode: string): string {
  const cfg = getLocalizationConfig(langCode);
  if (!cfg) return "(no name map)";
  return Object.entries(cfg.names)
    .map(([en, localized]) => `  - ${en} \u2192 ${localized}`)
    .join("\n");
}

function buildMarketContext(marketContext: string): string {
  switch (marketContext) {
    case "high-censorship":
      return "HIGH-CENSORSHIP market: keep all intimacy strictly implied, euphemize profanity heavily, and adapt any political/religious content to local norms.";
    case "romance-focused":
      return "ROMANCE-FOCUSED market: lean into fated-pair emotion and chemistry with cultural subtlety; keep intimacy tasteful per local norms.";
    default:
      return "STANDARD market: publish-grade literary fantasy localization with age-appropriate content handling.";
  }
}

function buildSystemPrompt(langCode: string, marketContext = "standard"): string {
  const cfg = getLocalizationConfig(langCode);
  const langLine = cfg
    ? `${cfg.name} (${cfg.nativeName}) \u2014 ${cfg.script} script${cfg.rtl ? ", RTL" : ""}`
    : langCode;
  const dialogueMarks = cfg
    ? `Open: ${cfg.dialogue.open} | Close: ${cfg.dialogue.close} | ${cfg.dialogue.note}`
    : "Use the language's standard quotation marks";
  const profanityMap = cfg
    ? Object.entries(cfg.profanity).map(([en, local]) => `  - ${en} \u2192 ${local}`).join("\n")
    : "  - (none configured)";
  const rankMap = cfg
    ? Object.entries(cfg.ranks).map(([en, local]) => `  - ${en} \u2192 ${local}`).join("\n")
    : "  - (none configured)";
  const fanNames = cfg && Object.keys(cfg.fanNames).length
    ? Object.entries(cfg.fanNames).map(([en, fan]) => `  - ${en} \u2192 ${fan}`).join("\n")
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
    "You are the Empyrean Translator \u2014 a world-class literary localization engine for the epic high-fantasy novel ONYX STORM (English source).",
    "You translate the source text into a professionally localized edition that reads as NATIVE fiction in the target market \u2014 never as word-swapped English. You follow every phase below, in order, before producing your output.",
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
    "# PART C \u2014 PER-LANGUAGE CONFIG",
    `DIALOGUE MARKS:\n${dialogueMarks}`,
    `FORMALITY SYSTEM: ${cfg ? `${cfg.formality.system} \u2014 informal: ${cfg.formality.informal}, formal: ${cfg.formality.formal}. ${cfg.formality.note}` : "(none)"}`,
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
    "1. Return ONLY the translated text \u2014 no explanations, no notes, no metadata, no markdown fences, and no quotation marks around the reply.",
    "2. Preserve paragraph breaks, speaker turns and dialogue lines 1:1 with the source.",
    "3. Use the language's dialogue punctuation (P10) and telepathy markers (P16).",
    "4. For script languages (non-Latin scripts): ZERO Latin-script words may remain, except the allowed names listed in the Name Map.",
    "5. Translate chapter titles and headings with the same fidelity as body text.",
    "6. The result must read like it was written in the target language by a native literary translator.",
  ].join("\n");
}

// ════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════

// FIX 2a: paragraph-aware chunking (identical logic to translateContent.ts so
// both paths produce the same boundaries — never mid-sentence).
export function chunkText(text: string, maxWords: number): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  const chunks: string[] = [];
  let currentParas: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (currentParas.length > 0) {
      chunks.push(currentParas.join("\n\n"));
      currentParas = [];
      currentWords = 0;
    }
  };

  for (const para of paragraphs) {
    const paraWords = para.split(/\s+/).filter(Boolean).length;

    if (paraWords > maxWords) {
      flush();
      const sentences = para.match(/[^.!?\u06D4\u3002\uFF01\uFF1F]+[.!?\u06D4\u3002\uFF01\uFF1F]+["'\u00BB\u300D\u300F]?\s*|[^.!?\u06D4\u3002\uFF01\uFF1F]+$/g) || [para];
      let sentenceBuf = "";
      let sentenceWords = 0;
      for (const sentence of sentences) {
        const w = sentence.split(/\s+/).filter(Boolean).length;
        if (sentenceBuf && sentenceWords + w > maxWords) {
          chunks.push(sentenceBuf.trim());
          sentenceBuf = sentence;
          sentenceWords = w;
        } else {
          sentenceBuf += sentence;
          sentenceWords += w;
        }
      }
      if (sentenceBuf.trim()) chunks.push(sentenceBuf.trim());
      continue;
    }

    if (currentWords + paraWords > maxWords && currentParas.length > 0) {
      flush();
    }
    currentParas.push(para);
    currentWords += paraWords;
  }
  flush();

  return chunks;
}

// ════════════════════════════════════════════════════════════
// Bible Pass — Lock glossary terms with placeholders before AI
// ════════════════════════════════════════════════════════════

interface BiblePassResult {
  lockedText: string;
  placeholders: Map<string, string>;
}

function applyBiblePassServer(text: string, targetLanguage: string): BiblePassResult {
  const glossary = glossaryData.magicMilitary as Record<string, Record<string, string>>;
  const properNouns = glossaryData.properNouns as Record<string, string[]>;
  const langIndex = [
    "en", "ar", "ur", "fr", "ja", "es", "hi", "tr", "zh", "ru", "ko", "de",
    "ks", "ro", "sw", "it", "la", "id", "ne", "bn", "pt",
  ];
  const idx = langIndex.indexOf(targetLanguage);

  let result = text;
  const placeholders = new Map<string, string>();
  let phIdx = 0;

  // Lock proper nouns
  for (const [term] of Object.entries(properNouns)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("\\b" + escaped + "\\b", "g");
    if (regex.test(result)) {
      const translated = properNouns[term]?.[idx] || properNouns[term]?.[0] || term;
      const ph = "__PH" + phIdx++ + "__";
      placeholders.set(ph, translated);
      result = result.replace(regex, ph);
    }
  }

  // Lock fantasy/military terms
  for (const term of Object.keys(glossary)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp("\\b" + escaped + "\\b", "gi");
    if (regex.test(result)) {
      const translation = glossary[term]?.[targetLanguage] || glossary[term]?.["en"] || term;
      if (translation !== term) {
        const ph = "__PH" + phIdx++ + "__";
        placeholders.set(ph, translation);
        result = result.replace(regex, ph);
      }
    }
  }

  return { lockedText: result, placeholders };
}

/**
 * Restore Bible-Pass placeholder tokens back to their locked target-language
 * values. HARDENED (Phase D2): repairs mangled tokens ("__PH2__" → "PH2",
 * "__ PH2 __", "__PHO__") by index — insertion order of the placeholders
 * map IS the token numbering — so a locked name can never vanish.
 */
function restorePlaceholdersServer(text: string, placeholders: Map<string, string>): string {
  let result = text;
  for (const [ph, value] of placeholders) {
    result = result.split(ph).join(value);
  }
  if (placeholders.size === 0) return result;

  const entries = [...placeholders.entries()];

  // Repair mangled underscore forms: "__PH2__", "__ PH2 __", "__PHO" (O/0 and l/1 confusion fixed by index lookup)
  result = result.replace(/_{0,4}\s*PH\s*([0-9OQoIl]{1,3})\s*_{0,4}/gi, (m, digits: string) => {
    const normalized = digits.replace(/[OQoIl]/g, (c) => (c.toLowerCase() === "l" ? "1" : "0"));
    const idx = parseInt(normalized, 10);
    if (Number.isInteger(idx) && idx >= 0 && idx < entries.length) {
      return entries[idx][1];
    }
    return m;
  });

  // Repair fully bare tokens: "PH2" (model stripped the underscores)
  result = result.replace(/(^|[^A-Za-z0-9])PH\s*([0-9OQoIl]{1,3})(?![A-Za-z0-9])/g, (m, pre: string, digits: string) => {
    const normalized = digits.replace(/[OQoIl]/g, (c) => (c.toLowerCase() === "l" ? "1" : "0"));
    const idx = parseInt(normalized, 10);
    if (Number.isInteger(idx) && idx >= 0 && idx < entries.length) {      return `${pre}${entries[idx][1]}`;
    }
    return m;
  });

  return result;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLastSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(-2).join(" ");
}

async function callGemini(
  keys: string[],
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; model: string; usage: unknown }> {
  for (const key of keys) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(GEMINI_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: GEMINI_MODEL,
            messages: [
              { role: "system" as const, content: systemPrompt },
              { role: "user" as const, content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 4000,
          }),
        });

        if (res.ok) {
          const data: { choices?: { message?: { content?: string } }[]; model?: string; usage?: unknown } = await res.json();
          const text = data.choices?.[0]?.message?.content;
          if (!text) break;
          const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
          return {
            text: cleaned,
            model: data.model || GEMINI_MODEL,
            usage: data.usage,
          };
        }

        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 10000));
          continue;
        }
        if (res.status >= 500) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
          continue;
        }
        break;
      } catch {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
      }
    }
  }
  throw new Error("All Gemini keys exhausted for this chunk");
}

// ════════════════════════════════════════════════════════════
// Chunk processing helper (called by processLanguage, not by
// processChunk — this avoids the circular reference)
// ════════════════════════════════════════════════════════════

interface ChunkResult {
  skipped: boolean;
  chunkIndex: number;
  completed: number;
  total: number;
  allDone: boolean;
}

async function processChunkInternal(
  ctx: any,
  projectId: Id<"projects">,
  langCode: string,
  chunkIndex: number,
): Promise<ChunkResult> {
  // C2: Check cancellation before doing any work
  const project = await ctx.runQuery(api.queries.getProjectRaw, { projectId });
  if (!project) throw new Error("Project not found");
  if (project.status === "cancelled") return { skipped: true, chunkIndex, completed: 0, total: 0, allDone: false };

  const existingChunks: Array<{
    _id: Id<"chunks">;
    chunkIndex: number;
    status: string;
    sourceText: string;
    translatedText?: string;
  }> = await ctx.runQuery(api.queries.getChunksForLang, {
    projectId,
    langCode,
  });

  const existing = existingChunks.find(
    (c: { chunkIndex: number; status: string }) => c.chunkIndex === chunkIndex
  );
  if (existing?.status === "done" && existing.translatedText) {
    return { skipped: true, chunkIndex, completed: 0, total: 0, allDone: false };
  }

  // FIX #2: Use stored sourceText from chunk record instead of re-chunking fullText.
  // This eliminates the double-chunking bug where startTranslation chunks once,
  // then processChunkInternal re-chunks from fullText (producing different boundaries).
  let sourceText: string;
  if (existing?.sourceText) {
    sourceText = existing.sourceText;
  } else {
    // Fallback: compute total chunks count from fullText, but still upsert with this sourceText
    const sourceChunks = chunkText(project.fullText, CHUNK_SIZE);
    sourceText = sourceChunks[chunkIndex] || "";
    if (!sourceText) return { skipped: true, chunkIndex, completed: 0, total: 0, allDone: false };
  }

  // Total chunks count for progress reporting
  const totalChunks = Math.max(
    existingChunks.length,
    Math.ceil(project.fullText.split(/\s+/).length / CHUNK_SIZE)
  );

  // ── FIX #1: Slide window context (P21 book-wide consistency) ──
  let previousContext: string | undefined;
  if (chunkIndex > 0) {
    const prevChunk = existingChunks.find(
      (c: { chunkIndex: number; status: string; translatedText?: string }) =>
        c.chunkIndex === chunkIndex - 1 && c.status === "done"
    );
    if (prevChunk?.translatedText) {
      previousContext = extractLastSentences(prevChunk.translatedText);
    }
  }

  const keys = [
    process.env.Gemini_API_Key_1,
    process.env.Gemini_API_Key_2,
    process.env.Gemini_API_Key_3,
    process.env.Gemini_API_Key_4,
    process.env.Gemini_API_Key_5,
  ].filter((k): k is string => !!k);

  if (keys.length === 0) throw new Error("No Gemini API keys configured");

  // ── FIX #1: Bible Pass — Lock glossary terms before AI sees them ──
  const { lockedText, placeholders } = applyBiblePassServer(sourceText, langCode);

  // ── Send to Gemini with locked text ──
  const systemPrompt = buildSystemPrompt(langCode, "standard");
  let userContent = lockedText;
  if (previousContext) {
    userContent = `Previous chunk ended with: ${previousContext}\n\nContinue seamlessly.\n\n${userContent}`;
  }

  const geminiResult = await callGemini(keys, systemPrompt, userContent);

  // ── FIX #1: Post-Processing Pipeline ──
  // Step 1: Restore glossary placeholders (AI may have changed them)
  let processedText = restorePlaceholdersServer(geminiResult.text, placeholders);

  // Step 2: Apply cultural filters (P6/P13/P14)
  processedText = applyCulturalFilters(processedText, langCode, "standard");

  // Step 3: Format dragon telepathy *thoughts* → 「」/【】 (P16)
  processedText = processedText.replace(/\*([^*]+)\*/g, (_: string, thought: string) =>
    formatDragonTelepathy(thought, langCode)
  );

  // Step 4: Add RTL marker for RTL languages (P8)
  if (isRTLLang(langCode) && !processedText.startsWith("\u200F")) {
    processedText = `\u200F${processedText}`;
  }

  // ── FIX #1: Run QA checks (P1-P23 code-level verification) ──
  let qaScore = 0;
  let qaOverall = "unknown";
  try {
    const qaReport = runQA(sourceText, processedText, langCode, []);
    qaScore = qaReport.score;
    qaOverall = qaReport.overall;
    console.log(`[QA] ${langCode} chunk ${chunkIndex}: ${qaReport.score}/100 — ${qaReport.summary[0]}`);
  } catch (e) {
    console.warn(`[QA] Failed for ${langCode} chunk ${chunkIndex}:`, e);
  }

  // Save translated chunk (with post-processed text and QA results)
  const usageWithQA = {
    ...(geminiResult.usage as Record<string, unknown>),
    qaScore,
    qaOverall,
  };

  if (existing) {
    await ctx.runMutation(api.mutations.updateChunk, {
      chunkId: existing._id,
      translatedText: processedText,
      status: "done",
      model: geminiResult.model,
      usage: usageWithQA,
    });
  } else {
    const chunkId: Id<"chunks"> = await ctx.runMutation(api.mutations.upsertChunk, {
      projectId,
      langCode,
      chunkIndex,
      sourceText,
    });
    await ctx.runMutation(api.mutations.updateChunk, {
      chunkId,
      translatedText: processedText,
      status: "done",
      model: geminiResult.model,
      usage: usageWithQA,
    });
  }

  // Count completed chunks
  const allChunks: Array<{ status: string; chunkIndex: number; translatedText?: string }> =
    await ctx.runQuery(api.queries.getChunksForLang, { projectId, langCode });
  const completedCount = allChunks.filter(
    (c: { status: string }) => c.status === "done"
  ).length;

  const translations: Array<{
    _id: Id<"translations">;
    langCode: string;
    startedAt?: number;
  }> = await ctx.runQuery(api.queries.getTranslationsRaw, { projectId });
  const translation = translations.find(
    (t: { langCode: string }) => t.langCode === langCode
  );

  if (completedCount >= totalChunks) {
    const mergedText = allChunks
      .sort(
        (a: { chunkIndex: number }, b: { chunkIndex: number }) =>
          a.chunkIndex - b.chunkIndex
      )
      .map((c: { translatedText?: string }) => c.translatedText || "")
      .join("\n\n");

    if (translation) {
      await ctx.runMutation(api.mutations.updateTranslation, {
        translationId: translation._id,
        status: "complete",
        completedChunks: completedCount,
        mergedText,
        completedAt: Date.now(),
      });
    }
  } else if (translation) {
    await ctx.runMutation(api.mutations.updateTranslation, {
      translationId: translation._id,
      status: "in_progress",
      completedChunks: completedCount,
      startedAt: translation.startedAt || Date.now(),
    });
  }

  return {
    skipped: false,
    chunkIndex,
    completed: completedCount,
    total: totalChunks,
    allDone: completedCount >= totalChunks,
  };
}

// ════════════════════════════════════════════════════════════
// ACTION: startTranslation — Kick off autonomous queue
// ════════════════════════════════════════════════════════════

export const startTranslation = action({
  args: {
    projectId: v.id("projects"),
    langCodes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ started: boolean; languages: number; totalChunks: number }> => {
    const project = await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    });
    if (!project) throw new Error("Project not found");

    // H10: Prevent duplicate chains — if already translating, skip
    if (project.status === "translating") {
      return { started: false, languages: 0, totalChunks: 0 };
    }

    // Use selected languages or fall back to all
    const selectedLangs = (args.langCodes && args.langCodes.length > 0) ? args.langCodes : LANGUAGES;

    const sourceChunks = chunkText(project.fullText, CHUNK_SIZE);
    const totalChunks = sourceChunks.length;

    // Create translation records for selected languages
    for (const lang of selectedLangs) {
      await ctx.runMutation(api.mutations.upsertTranslation, {
        projectId: args.projectId,
        langCode: lang,
        totalChunks,
      });
    }

    // Create chunk records for selected languages
    for (const lang of selectedLangs) {
      for (let i = 0; i < totalChunks; i++) {
        await ctx.runMutation(api.mutations.upsertChunk, {
          projectId: args.projectId,
          langCode: lang,
          chunkIndex: i,
          sourceText: sourceChunks[i],
        });
      }
    }

    // Update project status
    await ctx.runMutation(api.mutations.updateProject, {
      projectId: args.projectId,
      status: "translating",
    });

    // Start processing first selected language
    await ctx.scheduler.runAfter(0, api.translateQueue.processLanguage, {
      projectId: args.projectId,
      langCode: selectedLangs[0],
      chunkIndex: 0,
    });

    return { started: true, languages: selectedLangs.length, totalChunks };
  },
});

// ════════════════════════════════════════════════════════════
// ACTION: processLanguage — Process chunks for a language,
// then chain to the next language via scheduler
// ════════════════════════════════════════════════════════════

export const processLanguage = action({
  args: {
    projectId: v.id("projects"),
    langCode: v.string(),
    chunkIndex: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    const project = await ctx.runQuery(api.queries.getProjectRaw, {
      projectId: args.projectId,
    });
    if (!project || project.status === "cancelled") return;

    const sourceChunks = chunkText(project.fullText, CHUNK_SIZE);

    // Process this chunk
    const result = await processChunkInternal(
      ctx,
      args.projectId,
      args.langCode,
      args.chunkIndex,
    );

    // C2: Re-check cancellation after chunk processing (Gemini call may take 30s+)
    const recheck = await ctx.runQuery(api.queries.getProjectRaw, { projectId: args.projectId });
    if (!recheck || recheck.status === "cancelled") return;

    if (result.allDone) {
      // Language done — merge chunks, schedule PDF generation
      // (generatePdf chains to next language or ZIP after saving PDF)
      const allChunks: Array<{ chunkIndex: number; translatedText?: string }> =
        await ctx.runQuery(api.queries.getChunksForLang, {
          projectId: args.projectId,
          langCode: args.langCode,
        });
      const mergedText = allChunks
        .sort((a: { chunkIndex: number }, b: { chunkIndex: number }) => a.chunkIndex - b.chunkIndex)
        .map((c: { translatedText?: string }) => c.translatedText || "")
        .join("\n\n");

      // Find the translation record for this language
      const translations: Array<{ _id: Id<"translations">; langCode: string }> =
        await ctx.runQuery(api.queries.getTranslationsRaw, { projectId: args.projectId });
      const translation = translations.find(
        (t: { langCode: string }) => t.langCode === args.langCode
      );

      if (translation) {
        await ctx.runMutation(api.mutations.updateTranslation, {
          translationId: translation._id,
          status: "generating_pdf",
          completedChunks: allChunks.length,
          mergedText,
          pdfGenerating: true,
        });

        // Schedule PDF generation (it chains to next lang or ZIP)
        await ctx.scheduler.runAfter(0, api.generatePdf.generateTranslatedPdf, {
          projectId: args.projectId,
          langCode: args.langCode,
          translationId: translation._id,
          mergedText,
        });
      }
    } else if (!result.skipped) {
      // More chunks — schedule next
      await ctx.scheduler.runAfter(0, api.translateQueue.processLanguage, {
        projectId: args.projectId,
        langCode: args.langCode,
        chunkIndex: args.chunkIndex + 1,
      });
    } else {
      // Skipped — move to next chunk or language
      if (args.chunkIndex + 1 < sourceChunks.length) {
        await ctx.scheduler.runAfter(0, api.translateQueue.processLanguage, {
          projectId: args.projectId,
          langCode: args.langCode,
          chunkIndex: args.chunkIndex + 1,
        });
      } else {
        // All chunks skipped for this language — schedule PDF generation
        const allChunks: Array<{ chunkIndex: number; translatedText?: string }> =
          await ctx.runQuery(api.queries.getChunksForLang, {
            projectId: args.projectId,
            langCode: args.langCode,
          });
        const mergedText = allChunks
          .sort((a: { chunkIndex: number }, b: { chunkIndex: number }) => a.chunkIndex - b.chunkIndex)
          .map((c: { translatedText?: string }) => c.translatedText || "")
          .join("\n\n");

        const translations: Array<{ _id: Id<"translations">; langCode: string }> =
          await ctx.runQuery(api.queries.getTranslationsRaw, { projectId: args.projectId });
        const translation = translations.find(
          (t: { langCode: string }) => t.langCode === args.langCode
        );

        if (translation) {
          await ctx.runMutation(api.mutations.updateTranslation, {
            translationId: translation._id,
            status: "generating_pdf",
            completedChunks: allChunks.length,
            mergedText,
            pdfGenerating: true,
          });
          await ctx.scheduler.runAfter(0, api.generatePdf.generateTranslatedPdf, {
            projectId: args.projectId,
            langCode: args.langCode,
            translationId: translation._id,
            mergedText,
          });
        }
      }
    }
  },
});

// ════════════════════════════════════════════════════════════
// ACTION: cancelTranslation — Stop the autonomous queue
// ════════════════════════════════════════════════════════════

export const cancelTranslation = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<{ cancelled: boolean }> => {
    await ctx.runMutation(api.mutations.updateProject, {
      projectId: args.projectId,
      status: "cancelled",
    });
    return { cancelled: true };
  },
});
