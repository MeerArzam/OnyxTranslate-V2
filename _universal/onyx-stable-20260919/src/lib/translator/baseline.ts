/**
 * Baseline Test module (Part 2 of the 18-phase spec).
 *
 * "The system must generate these exact contextual meanings for the baseline
 * test" — one reference translation per target language, locked from the
 * approved samples. This module stores those references and runs a
 * per-language verification: the QA engine (qa.ts) is executed against each
 * reference, plus name-spelling, script/RTL and dialogue-mark spot checks.
 * The result is a report card the user can inspect per language.
 */

import { getLocalizationConfig } from "../../data/localization";
import { runQA, type QAReport } from "./qa";

/** The locked baseline sentence every market must reproduce contextually. */
export const BASELINE_SOURCE =
  `Violet wakes up in Aretia confused, with a ring and a note from Xaden: "Don't look for me." ` +
  `She realizes she is married, but her husband is lost in the dark.`;

/**
 * Locked reference translations (native literary quality, not word-swapped).
 * The first 13 entries come from the approved samples; the remaining 7 use
 * the same per-language name spellings from src/data/localization/*.json.
 */
export const BASELINE_EXPECTATIONS: Record<string, string> = {
  ur: `وایلیٹ آریٹیا میں گھبراہٹ کے ساتھ جاگتی ہے، ایک انگوٹھی اور زیدن کا ایک نوٹ اس کے پاس ہے: "مجھے مت ڈھونڈو۔" وہ سمجھتی ہے کہ اس کی شادی ہو چکی ہے، لیکن اس کا شوہر اندھیرے میں کھو چکا ہے۔`,
  ar: `تستيقظ فايوليت في آريتيا في حالة من الارتباك، مع خاتم وملاحظة من زيدن: "لا تبحثي عني." وتدرك أنها متزوجة، لكن زوجها ضاع في الظلام.`,
  fr: `Violet se réveille à Aretia, confuse, avec une bague et un mot de Xaden : "Ne me cherche pas." Elle réalise qu'elle est mariée, mais que son mari est perdu dans les ténèbres.`,
  ja: `ヴァイオレットは混乱しながらアレティアで目を覚ます。指には指輪があり、ゼイデンからのメモが残されていた。「私を探さないで」。彼女は自分が結婚していること、しかし夫が闇に飲み込まれたことを理解する。`,
  es: `Violet despierta en Aretia, confundida, con un anillo y una nota de Xaden: "No me busques". Se da cuenta de que está casada, pero su esposo está perdido en la oscuridad.`,
  hi: `वायलेट एरेटिया में उलझन में जागती है, ज़ैडेन की एक अंगूठी और एक नोट उसके पास है: "मुझे मत ढूंढो।" उसे पता चलता है कि उसकी शादी हो गई है, लेकिन उसका पति अंधकार में खो गया है।`,
  tr: `Violet, Aretia'da kafası karışık bir şekilde uyanır, elinde bir yüzük ve Xaden'den bir not vardır: "Beni arama." Evli olduğunu fark eder, ancak kocası karanlıkta kaybolmuştur.`,
  zh: `维奥莱特在阿雷蒂亚困惑地醒来，手上戴着戒指，还有谢顿的纸条："别来找我。"她意识到自己已经结婚，但丈夫已迷失在黑暗中。`,
  ru: `Вайолет приходит в себя в Аретии, ошеломленная, с кольцом и запиской от Ксадена: "Не ищи меня." Она понимает, что замужем, но ее муж потерян во тьме.`,
  ko: `바이올렛은 혼란스러운 상태로 아레티아에서 깨어난다. 반지와 제이든의 쪽지가 있다: "나를 찾지 마." 그녀는 결혼했지만, 남편이 어둠 속에 사라졌음을 깨닫는다.`,
  de: `Violet erwacht verwirrt in Aretia, mit einem Ring und einer Nachricht von Xaden: "Such mich nicht." Sie erkennt, dass sie verheiratet ist, aber ihr Ehemann in der Dunkelheit verloren ist.`,
  ks: `وائلٹ ایرٹیا مَنٛز پَریشانہٕ جاگِتھ، اَکھ گَژھ تہٕ زیرن ہنٛز اَکھ نوس: 'مےٚ پرَنس مُتھ۔' تَسی سمجھان چھِ زِ تَسی خانٛدر کَرِتھ چھِ، مگر تِس ہنٛد خانٛدر دَرٕ اندھارَس مَنٛز گۆمُتھ۔`,
  ro: `Violet se trezește în Aretia, confuză, cu un inel și un bilet de la Xaden: "Nu mă căuta." Își dă seama că este căsătorită, dar soțul ei s-a pierdut în întuneric.`,
  sw: `Violet anaamka Aretia akiwa amechanganyikiwa, akiwa na pete na ujumbe kutoka kwa Xaden: "Usinitafute." Anatambua kwamba ameolewa, lakini mumewe amepotea gizani.`,
  it: `Violeta si sveglia ad Aretia confusa, con un anello e un biglietto di Xaden: "Non cercarmi." Si rende conto di essere sposata, ma suo marito è perduto nell'oscurità.`,
  la: `Violet in Aretia confusa evigilat, anulo et litteris Xaden: "Ne me quaesiveris." Intellegit se nuptam esse, sed maritus eius in tenebris perit.`,
  id: `Violet terbangun di Aretia dengan bingung, dengan cincin dan pesan dari Xaden: "Jangan cari aku." Dia menyadari bahwa dia sudah menikah, tetapi suaminya hilang dalam kegelapan.`,
  ne: `वायलेट एरेटियामा अलमल्लिँदै ब्युँझिन्छ, ज़ैडेनको एउटा औंठी र एउटा नोट उनको साथ छ: "मलाई नखोज।" उसलाई थाहा हुन्छ कि उसको विवाह भइसकेको छ, तर उनको पति अँध्यारोमा हराएका छन्।`,
  bn: `ভায়োলেট আরেটিয়ায় বিভ্রান্ত অবস্থায় জেগে ওঠে, একটি আংটি এবং জেইডেনের একটি নোট তার কাছে: "আমাকে খুঁজো না।" সে বুঝতে পারে যে সে বিবাহিত, কিন্তু তার স্বামী অন্ধকারে হারিয়ে গেছে।`,
  pt: `Violeta acorda em Aretia confusa, com um anel e um bilhete de Xaden: "Não me procure." Ela percebe que está casada, mas seu marido está perdido na escuridão.`,
};

/** Names that must appear in the localized spelling (P2 spot check). */
const BASELINE_NAMES = ["Violet", "Xaden", "Aretia"] as const;

/** Ranges covering the scripts used by the 20 target languages. */
const SCRIPT_RANGES: Array<[RegExp, string]> = [
  [/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/, "Arabic script"],
  [/[\u3040-\u30FF\u3400-\u9FFF]/, "CJK/Japanese script"],
  [/[\u0400-\u04FF]/, "Cyrillic script"],
  [/[\uAC00-\uD7AF]/, "Hangul script"],
  [/[\u0900-\u097F]/, "Devanagari script"],
  [/[\u0980-\u09FF]/, "Bengali script"],
];

export interface BaselineResult {
  langCode: string;
  name: string;
  nativeName: string;
  script: string;
  rtl: boolean;
  score: number;
  overall: "pass" | "warn" | "fail";
  qa: QAReport;
  /** Names from the locked map that did NOT appear in the reference text */
  missingNames: string[];
  /** Script/RTL/dialogue spot-check issues */
  scriptIssues: string[];
  summary: string[];
}

export interface BaselineSummary {
  total: number;
  passed: number;
  warned: number;
  failed: number;
  averageScore: number;
  results: BaselineResult[];
}

function detectScript(text: string): string | null {
  for (const [range, label] of SCRIPT_RANGES) {
    if (range.test(text)) return label;
  }
  return null;
}

/**
 * Run the baseline verification for all 20 languages.
 *
 * For each language we:
 *   1. Run the full QA engine (all 23 phase checks) against the locked
 *      reference translation.
 *   2. Spot-check that Violet / Xaden / Aretia appear in the locked
 *      localized spelling from the name map (P2).
 *   3. Spot-check the script actually renders (P8) and, for RTL languages,
 *      that the text is in an RTL script.
 */
export function runBaselineTests(): BaselineSummary {
  const results: BaselineResult[] = [];

  for (const [langCode, expected] of Object.entries(BASELINE_EXPECTATIONS)) {
    const cfg = getLocalizationConfig(langCode);
    const qa = runQA(BASELINE_SOURCE, expected, langCode);

    const missingNames: string[] = [];
    if (cfg) {
      for (const name of BASELINE_NAMES) {
        const localized = cfg.names[name];
        if (localized && !expected.includes(localized)) {
          missingNames.push(`${name} (${localized})`);
        }
      }
    }

    const scriptIssues: string[] = [];
    const detectedScript = detectScript(expected);
    if (cfg) {
      if (cfg.rtl) {
        const rtlRange = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
        if (!rtlRange.test(expected)) {
          scriptIssues.push("RTL script characters missing");
        }
      }
      if (cfg.script !== "Latin" && !detectedScript) {
        scriptIssues.push(`${cfg.script} script characters missing`);
      }
    }

    // Compose a score: QA score minus penalties for hard failures
    let score = qa.score;
    let overall: BaselineResult["overall"] = qa.overall;
    if (missingNames.length > 0) score -= missingNames.length * 8;
    if (scriptIssues.length > 0) score -= scriptIssues.length * 5;
    score = Math.max(0, Math.min(100, score));
    if (score < 60) overall = "fail";
    else if (missingNames.length > 0 || scriptIssues.length > 0 || qa.overall !== "pass") {
      overall = "warn";
    }

    const summary = [
      `${score}/100 — ${qa.checks.filter((c) => c.status === "pass").length}/23 phases pass`,
      ...qa.checks
        .filter((c) => c.status !== "pass")
        .map((c) => `${c.label} ${c.status === "fail" ? "✗" : "⚠"} ${c.detail}`),
      ...missingNames.map((n) => `P2 ✗ locked name missing: ${n}`),
      ...scriptIssues.map((s) => `P8 ⚠ ${s}`),
    ];

    results.push({
      langCode,
      name: cfg?.name ?? langCode,
      nativeName: cfg?.nativeName ?? "",
      script: cfg?.script ?? "Latin",
      rtl: cfg?.rtl ?? false,
      score,
      overall,
      qa,
      missingNames,
      scriptIssues,
      summary,
    });
  }

  const passed = results.filter((r) => r.overall === "pass").length;
  const warned = results.filter((r) => r.overall === "warn").length;
  const failed = results.filter((r) => r.overall === "fail").length;
  const averageScore = Math.round(
    results.reduce((sum, r) => sum + r.score, 0) / Math.max(results.length, 1)
  );

  return { total: results.length, passed, warned, failed, averageScore, results };
}
