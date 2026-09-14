/**
 * Per-language localization configuration (Part C of the 18-phase spec).
 * One JSON file per language under src/data/localization/.
 *
 * Loaded by the VLY AI system-prompt builder (vlyTranslate.ts) and the QA
 * engine (qa.ts) so every phase has the language's rules available in code.
 */

import ur from "./ur.json";
import ar from "./ar.json";
import fr from "./fr.json";
import ja from "./ja.json";
import es from "./es.json";
import hi from "./hi.json";
import tr from "./tr.json";
import zh from "./zh.json";
import ru from "./ru.json";
import ko from "./ko.json";
import de from "./de.json";
import ks from "./ks.json";
import ro from "./ro.json";
import sw from "./sw.json";
import it from "./it.json";
import la from "./la.json";
import id from "./id.json";
import ne from "./ne.json";
import bn from "./bn.json";
import pt from "./pt.json";

export interface LocalizationConfig {
  code: string;
  name: string;
  nativeName: string;
  /** Script family: Arabic, Latin, Japanese, Devanagari, Chinese, Cyrillic, Hangul, Bengali */
  script: string;
  /** Right-to-left layout for ur/ar/ks */
  rtl: boolean;
  dialogue: {
    open: string;
    close: string;
    note: string;
  };
  formality: {
    system: string;
    informal: string;
    formal: string;
    note: string;
  };
  /** English expletive → culturally appropriate equivalent/euphemism (P14) */
  profanity: Record<string, string>;
  /** English rank → natural local military vocabulary (P15) */
  ranks: Record<string, string>;
  /** Coherent magic-system hierarchy note (P9) */
  magicSystem: string;
  /** Fan-nomenclature overrides for zh/ko/ru (P20) */
  fanNames: Record<string, string>;
  /** Back-cover blurb adapted to the market's selling points (P21) */
  blurb: string;
  styleSheet: {
    register: string;
    sentenceLength: string;
    gender: string;
    archaic: string;
    numerals: string;
  };
  /** Proper-noun transliterations from the locked samples (P2) */
  names: Record<string, string>;
}

const CONFIGS: Record<string, LocalizationConfig> = {
  ur: ur as LocalizationConfig,
  ar: ar as LocalizationConfig,
  fr: fr as LocalizationConfig,
  ja: ja as LocalizationConfig,
  es: es as LocalizationConfig,
  hi: hi as LocalizationConfig,
  tr: tr as LocalizationConfig,
  zh: zh as LocalizationConfig,
  ru: ru as LocalizationConfig,
  ko: ko as LocalizationConfig,
  de: de as LocalizationConfig,
  ks: ks as LocalizationConfig,
  ro: ro as LocalizationConfig,
  sw: sw as LocalizationConfig,
  it: it as LocalizationConfig,
  la: la as LocalizationConfig,
  id: id as LocalizationConfig,
  ne: ne as LocalizationConfig,
  bn: bn as LocalizationConfig,
  pt: pt as LocalizationConfig,
};

export const LOCALIZATION_LANGUAGES = Object.keys(CONFIGS);

export function getLocalizationConfig(langCode: string): LocalizationConfig | null {
  return CONFIGS[langCode] ?? null;
}

/**
 * Languages written in non-Latin scripts must contain zero Latin-script words
 * outside the allowed proper-noun list (P8 success criterion).
 */
export function isScriptLanguage(langCode: string): boolean {
  const cfg = CONFIGS[langCode];
  if (!cfg) return false;
  return cfg.script !== "Latin";
}

export function getBlurb(langCode: string): string | null {
  return CONFIGS[langCode]?.blurb ?? null;
}
