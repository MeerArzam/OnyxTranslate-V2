/**
 * P4 local fixture test — pure functions, NO deployment needed.
 * Fixture: Arabic, Urdu, Kashmiri, French, German, Hindi, Bengali, Japanese,
 * English (spec Phase 4 acceptance gate).
 */
import {
  LANGUAGE_RULES,
  filterGeneratedArtifacts,
  normalizePunctuationForLanguage,
  evaluateLanguageQA,
  assembleWithBoundaryRepair,
} from "../convex/languageRules.ts";

let pass = 0, fail = 0;
const check = (name, cond, evidence) => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} :: ${JSON.stringify(evidence).slice(0, 300)}`); }
};

// ── 4.1 Artifact filter ──────────────────────────────────────────────────
const dirty = "\u3010Paragraph 9\u3011 \u0627\u0644\u0641\u0642\u0631\u0629 \u0627\u0644\u0623\u0648\u0644\u0649 \u062A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0646\u0635 \u0639\u0631\u0628\u064A \u0623\u0635\u064A\u0644.\nParagraph 12: \u0647\u0630\u0627 \u0646\u0635 \u0623\u062E\u0631.\nTranslation: \u0648\u0647\u0630\u0627 \u0645\u0627 \u0643\u0627\u0646 \u064A\u062C\u0628 \u0625\u0632\u0627\u0644\u062A\u0647.\n<<<ONYX_TRANSLATION_A_START>>> \u0633\u0631\u0627\u0628 \u062F\u0627\u062E\u0644\u064A";
const ar = filterGeneratedArtifacts(dirty);
check("4.1 removes \u3010Paragraph 9\u3011", !ar.text.includes("\u3010Paragraph 9\u3011"), ar);
check("4.1 removes 'Paragraph 12:'", !ar.text.includes("Paragraph 12:"), ar);
check("4.1 removes 'Translation:'", !ar.text.includes("Translation:"), ar);
check("4.1 removes ONYX marker", !ar.text.includes("ONYX_TRANSLATION"), ar);
check("4.1 PRESERVES real Arabic prose", ar.text.includes("\u0627\u0644\u0641\u0642\u0631\u0629 \u0627\u0644\u0623\u0648\u0644\u0649"), ar.text);
check("4.1 logs removals with kinds", ar.removals.length >= 4 && ar.removals.every((r) => r.kind), ar.removals);

// Source-authored label preserved (prose containing the word, not label-shaped)
const authored = "The word paragraph appears in this English sentence normally.";
const auth = filterGeneratedArtifacts(authored);
check("4.1 does NOT touch prose containing 'paragraph'", auth.text === authored, auth);

// ── 4.2 Punctuation normalization ────────────────────────────────────────
const urPolluted = "\u0627\u0631\u062F\u0648 \u062C\u0645\u0644\u06C1 \u300C\u0627\u0633 \u0637\u0631\u062D\u300D \u063A\u0644\u0637 \u0628\u0631\u0627\u06A9\u0679\u0633 \u06A9\u06D2 \u0633\u0627\u062A\u06BE\u3002";
const urFixed = normalizePunctuationForLanguage(urPolluted, "ur");
check("4.2 ur: no CJK corner brackets", !urFixed.includes("\u300C") && !urFixed.includes("\u300D"), urFixed);
check("4.2 ur: quotes replaced with \u201C\u201D", urFixed.includes("\u201C") && urFixed.includes("\u201D"), urFixed);
check("4.2 ur: CJK full stop replaced", !urFixed.includes("\u3002"), urFixed);

const jaNative = "\u5F7C\u306F\u300C\u884C\u304F\u300D\u3068\u8A00\u3063\u305F\u3002";
const jaFixed = normalizePunctuationForLanguage(jaNative, "ja");
check("4.2 ja: CJK brackets PRESERVED (native)", jaFixed.includes("\u300C") && jaFixed === jaNative, jaFixed);

for (const lang of Object.keys(LANGUAGE_RULES)) {
  if (lang === "ja" || lang === "zh") continue;
  const probe = normalizePunctuationForLanguage("x\u300Cy\u300Dz\u3002", lang);
  check(`4.2 ${lang}: no CJK pollution`, !probe.includes("\u300C") && !probe.includes("\u300D") && !probe.includes("\u3002"), probe);
}

// ── 4.3 Language QA ──────────────────────────────────────────────────────
const urGood = "\u062E\u062F\u0627 \u06A9\u06D2 \u0644\u06CC\u06D2 \u0627\u06CC\u06A9 \u062E\u0648\u0628\u0635\u0648\u0631\u062A \u062C\u0645\u0644\u06C1 \u06C1\u06D2\u06D4 \u0627\u0631\u062F\u0648 \u0645\u06CC\u06BA \u062A\u0631\u062C\u0645\u06C1 \u0627\u0633 \u0637\u0631\u062D \u06C1\u0648\u062A\u0627 \u06C1\u06D2\u06D4";
const qaUr = evaluateLanguageQA("ur", "A beautiful sentence for translation.", urGood);
check("4.3 ur good passes", qaUr.ok, qaUr);

const urEnglish = "This is just untranslated English text with words.";
const qaUrEn = evaluateLanguageQA("ur", "Some source.", urEnglish);
check("4.3 ur English echo REJECTED", !qaUrEn.ok && qaUrEn.failures.some((f) => f.includes("script") || f.includes("English")), qaUrEn);

const ksEnglish = "Kashmiri output that is mostly English words remains rejected.";
const qaKs = evaluateLanguageQA("ks", "Source text here.", ksEnglish);
check("4.3 ks mostly-English REJECTED", !qaKs.ok, qaKs);

const arGood = "\u0647\u0630\u0627 \u0646\u0635 \u0639\u0631\u0628\u064A \u062C\u0645\u064A\u0644 \u064A\u062D\u062A\u0648\u064A \u0639\u0644\u0649 \u0643\u0644\u0645\u0627\u062A \u0648\u0627\u0636\u062D\u0629 \u0648\u0645\u062A\u0631\u0627\u062F\u0641\u0627\u062A \u0645\u062A\u0639\u062F\u062F\u0629 \u0644\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0627\u0644\u062C\u0648\u062F\u0629.";
const qaAr = evaluateLanguageQA("ar", "Beautiful clear source text with words.", arGood);
check("4.3 ar good passes", qaAr.ok, qaAr);

const qaDelim = evaluateLanguageQA("ur", "src", urGood + " <<<ONYX_CHUNK_A_END>>>");
check("4.3 delimiter leak rejected", !qaDelim.ok, qaDelim);

const jaGood = "\u5F7C\u306F\u9759\u304B\u306B\u9858\u3063\u305F\u3002\u661F\u3005\u304C\u8F1D\u3044\u3066\u3044\u305F\u3002";
const qaJa = evaluateLanguageQA("ja", "He wished quietly. The stars were shining.", jaGood);
check("4.3 ja good passes", qaJa.ok, qaJa);

const frGood = "Il a march\u00E9 dans la nuit noire, en silence, vers la porte.";
const qaFr = evaluateLanguageQA("fr", "He walked into the dark night, silently, toward the door.", frGood);
check("4.3 fr good passes", qaFr.ok, qaFr);

const deGood = "Er ging in die dunkle Nacht, schweigend, zur T\u00FCr hinaus.";
const qaDe = evaluateLanguageQA("de", "He walked into the dark night, silently, out the door.", deGood);
check("4.3 de good passes", qaDe.ok, qaDe);

const hiGood = "\u0935\u0939 \u0930\u093E\u0924 \u0915\u0947 \u0938\u0928\u094D\u0928\u093E\u091F\u0947 \u092E\u0947\u0902 \u0926\u0930\u0935\u093E\u091C\u093C\u0947 \u0924\u0915 \u091A\u0932\u0924\u093E \u0930\u0939\u093E\u0964";
const qaHi = evaluateLanguageQA("hi", "He kept walking in the silence of night to the door.", hiGood);
check("4.3 hi good passes", qaHi.ok, qaHi);

const bnGood = "\u0986\u09AE\u09BF \u09A6\u09B0\u099C\u09BE \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u09B9\u09BE\u0981\u099F\u09C7 \u09A5\u0995\u09B2\u09BE\u09AE, \u09A8\u09BF\u09B0\u09AC\u09BE\u09A4 \u09B0\u09BE\u09A4\u09C7\u0964";
const qaBn = evaluateLanguageQA("bn", "I kept walking to the door in the silent night.", bnGood);
check("4.3 bn good passes", qaBn.ok, qaBn);

const qaEmpty = evaluateLanguageQA("ur", "source", "   ");
check("4.3 empty rejected", !qaEmpty.ok, qaEmpty);

const qaRepl = evaluateLanguageQA("ur", "source", urGood + " \uFFFD\uFFFD");
check("4.3 replacement glyphs rejected", !qaRepl.ok, qaRepl);

// ── 4.4 Boundary repair ──────────────────────────────────────────────────
const parts = ["He walked toward the", "door in silence.", "Then he stopped."];
const joined = assembleWithBoundaryRepair(parts);
check("4.4 mid-sentence join repaired (space, no blank line)", joined.includes("the door") && !joined.includes("the\n\ndoor"), joined);
check("4.4 sentence boundary keeps paragraph break", joined.includes("silence.\n\nThen"), joined);

const cjkParts = ["\u5F7C\u306F\u6271\u306B\u5411\u304B\u3063\u305F", "\u30C9\u30A2\u3092\u9759\u304B\u306B\u958B\u3051\u305F\u3002"];
const cjkJoined = assembleWithBoundaryRepair(cjkParts);
check("4.4 non-Latin scripts never falsely joined", cjkJoined.includes("\n\n"), cjkJoined);

console.log(`\n== P4 fixture: ${pass} passed, ${fail} failed ==`);
process.exit(fail === 0 ? 0 : 1);
