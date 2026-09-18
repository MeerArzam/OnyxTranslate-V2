/**
 * Phase 2 contract validator — LOCAL fixture run (honest label:
 * LOCAL_SIMULATED, not a runtime deployment test; the deployment-level
 * proof lives in Phase 5's REAL matrix).
 *
 * Run: bun scripts/fixtureContractCheck.ts
 */
import {
  parseContractResponse,
  validateChunkResponse,
  validatePairItems,
  lockedTermsForChunk,
} from "../convex/translationContract.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const LOCKED = [{ en: "Signet", target: "Sceau" }];

// ── parseContractResponse ──────────────────────────────────────────────────
console.log("\n[1] parseContractResponse");
const good = parseContractResponse(
  '{"translation":"Le dragon rugit.","selfCheck":{"fullyTargetLanguage":true,"noMarkers":true,"completeSentences":true,"glossaryRespected":true}}',
);
check("valid single accepted", good.ok && good.kind === "single");
if (good.ok && good.kind === "single") {
  check("translation extracted", good.value.translation === "Le dragon rugit.");
}

const goodPair = parseContractResponse(
  '{"items":[{"chunkIndex":0,"translation":"Un.","selfCheck":{"fullyTargetLanguage":true,"noMarkers":true,"completeSentences":true,"glossaryRespected":true}},{"chunkIndex":1,"translation":"Deux.","selfCheck":{"fullyTargetLanguage":true,"noMarkers":true,"completeSentences":true,"glossaryRespected":true}}]}',
);
check("valid pair accepted", goodPair.ok && goodPair.kind === "pair");

const fenced = parseContractResponse('```json\n{"translation":"x","selfCheck":{"fullyTargetLanguage":true,"noMarkers":true,"completeSentences":true,"glossaryRespected":true}}\n```');
check("markdown fence rejected (invalid_json)", !fenced.ok && fenced.reason === "invalid_json", JSON.stringify(fenced));

const prose = parseContractResponse("Here is the translation: Le dragon rugit.");
check("prose reply rejected", !prose.ok);

const emptyTr = parseContractResponse('{"translation":"  ","selfCheck":{"fullyTargetLanguage":true,"noMarkers":true,"completeSentences":true,"glossaryRespected":true}}');
check("empty translation rejected", !emptyTr.ok);

const missingSC = parseContractResponse('{"translation":"ok"}');
check("missing selfCheck rejected", !missingSC.ok);

const nonBool = parseContractResponse('{"translation":"ok","selfCheck":{"fullyTargetLanguage":"yes","noMarkers":true,"completeSentences":true,"glossaryRespected":true}}');
check("non-boolean selfCheck rejected", !nonBool.ok);

// ── validateChunkResponse ladder ───────────────────────────────────────────
console.log("\n[2] validateChunkResponse — decision ladder");
const mk = (translation: string, sc?: Partial<Record<string, boolean>>) =>
  ({
    ok: true as const,
    kind: "single" as const,
    value: {
      translation,
      selfCheck: {
        fullyTargetLanguage: true,
        noMarkers: true,
        completeSentences: true,
        glossaryRespected: true,
        ...sc,
      },
    },
  });

const vAccept = validateChunkResponse({
  parse: mk("La dragonne veille. 【tag】"), // bracket decor is prose, not a marker pattern
  langCode: "fr",
  sourceText: "The dragon keeps watch over the gate.",
  lockedTerms: [],
  alreadyRetried: false,
});
check("clean text accepted", vAccept.action === "accept");

const vMarker = validateChunkResponse({
  parse: mk("Paragraph 9: Le dragon veille."),
  langCode: "fr",
  sourceText: "The dragon keeps watch over the gate.",
  lockedTerms: [],
  alreadyRetried: false,
});
check("marker → retry_strict (1st)", vMarker.action === "retry_strict");
const vMarker2 = validateChunkResponse({ parse: mk("Paragraph 9: Le dragon veille."), langCode: "fr", sourceText: "x", lockedTerms: [], alreadyRetried: true });
check("marker → needs_review (after retry)", vMarker2.action === "needs_review");

const vFalse = validateChunkResponse({
  parse: mk("Le dragon veille.", { glossaryRespected: false }),
  langCode: "fr",
  sourceText: "x",
  lockedTerms: [],
  alreadyRetried: true,
});
check("false selfCheck → needs_review after retry", vFalse.action === "needs_review");

const longEnglish = Array.from({ length: 40 }, (_, i) => `word${i % 7}`).join(" ");
const vEcho = validateChunkResponse({
  parse: mk(longEnglish),
  langCode: "ja",
  sourceText: longEnglish,
  lockedTerms: [],
  alreadyRetried: true,
});
check("English source echo detected", vEcho.action === "needs_review");

const vWrongLang = validateChunkResponse({
  parse: mk("This is still plain English text, obviously not translated."),
  langCode: "ru",
  sourceText: "Short source.",
  lockedTerms: [],
  alreadyRetried: true,
});
check("wrong language detected (ru got English)", vWrongLang.action === "needs_review");

const vGloss = validateChunkResponse({
  parse: mk("Le sceau brille. Signet intact."),
  langCode: "fr",
  sourceText: "The Signet glows.",
  lockedTerms: LOCKED,
  alreadyRetried: false,
});
check("glossary TARGET_FORM present → accept", vGloss.action === "accept");

const vGlossMissing = validateChunkResponse({
  parse: mk("Le gardien brille, mais le terme verrouillé a disparu."),
  langCode: "fr",
  sourceText: "The Signet glows.",
  lockedTerms: LOCKED,
  alreadyRetried: true,
});
check("glossary TARGET_FORM missing → needs_review", vGlossMissing.action === "needs_review");

const vGlossEnglish = validateChunkResponse({
  parse: mk("The Signet glows brightly in the dark."),
  langCode: "fr",
  sourceText: "The Signet glows.",
  lockedTerms: LOCKED,
  alreadyRetried: true,
});
check("English term left untranslated → needs_review", vGlossEnglish.action === "needs_review");

// RTL contract: detector must never demand reversal — Urdu script must pass.
const vRTL = validateChunkResponse({
  parse: mk("اچھا، یہ اردو متن ہے۔ اس میں نشانات نہیں ہیں۔"),
  langCode: "ur",
  sourceText: "Well, this is English source text for the fixture.",
  lockedTerms: [],
  alreadyRetried: false,
});
check("RTL (Urdu) logical text accepted — never reversed by code", vRTL.action === "accept");

// ── lockedTermsForChunk ────────────────────────────────────────────────────
console.log("\n[3] lockedTermsForChunk");
const terms = lockedTermsForChunk("fr", "Violet gripped her Signet. The Venin retreated.");
check("present terms extracted", terms.some((t) => t.en === "Signet") && terms.some((t) => t.en === "Venin"));
check("absent terms excluded", !terms.some((t) => t.en === "Irid"));
check("target form is French", terms.find((t) => t.en === "Signet")?.target === "Sceau", JSON.stringify(terms));

// ── validatePairItems ──────────────────────────────────────────────────────
console.log("\n[4] validatePairItems");
const scOK = { fullyTargetLanguage: true, noMarkers: true, completeSentences: true, glossaryRespected: true };
const pOK = validatePairItems({
  pair: {
    items: [
      { chunkIndex: 3, translation: "Premier morceau.", selfCheck: { ...scOK } },
      { chunkIndex: 4, translation: "Deuxième morceau.", selfCheck: { ...scOK } },
    ],
  },
  expectedIndexes: [3, 4],
  sources: ["First chunk.", "Second chunk."],
  langCode: "fr",
  lockedTerms: [],
});
check("valid pair → both translations", pOK.ok && pOK.translations[0] === "Premier morceau." && pOK.translations[1] === "Deuxième morceau.");

const pWrongIdx = validatePairItems({
  pair: {
    items: [
      { chunkIndex: 0, translation: "x", selfCheck: { ...scOK } },
      { chunkIndex: 1, translation: "y", selfCheck: { ...scOK } },
    ],
  },
  expectedIndexes: [3, 4],
  sources: ["a", "b"],
  langCode: "fr",
  lockedTerms: [],
});
check("chunkIndex mismatch → split fallback", !pWrongIdx.ok);

const pOneBad = validatePairItems({
  pair: {
    items: [
      { chunkIndex: 3, translation: "Sentence 2: bad marker", selfCheck: { ...scOK } },
      { chunkIndex: 4, translation: "Bon texte.", selfCheck: { ...scOK } },
    ],
  },
  expectedIndexes: [3, 4],
  sources: ["a", "b"],
  langCode: "fr",
  lockedTerms: [],
});
check("one bad half poisons the pair", !pOneBad.ok);

// ── NEVER-REWRITE proof: validator output is the model's text verbatim ─────
console.log("\n[5] never-rewrite guarantee");
const quirky = "Le dragon — et nul autre — veille.";
const vQuirk = validateChunkResponse({
  parse: mk(quirky),
  langCode: "fr",
  sourceText: "The dragon — and no other — keeps watch.",
  lockedTerms: [],
  alreadyRetried: false,
});
check("literary em-dashes preserved verbatim", vQuirk.action === "accept" && vQuirk.action === "accept" && (vQuirk as { translation: string }).translation === quirky);

console.log(`\n=== LOCAL_SIMULATED fixture: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
