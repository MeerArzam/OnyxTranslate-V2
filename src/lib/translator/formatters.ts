export interface ScriptConfig {
  code: string;
  name: string;
  direction: "ltr" | "rtl";
  italicReplacement: string;
  quotes: { open: string; close: string };
  ellipsis: string;
  emDash: string;
  formatThought: (text: string) => string;
  formatDialogue: (speaker: string, text: string) => string;
  formatEmphasis: (text: string) => string;
}

export const scriptConfigs: Record<string, ScriptConfig> = {
  ar: {
    code: "ar",
    name: "Arabic",
    direction: "rtl",
    italicReplacement: "\u3010",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `\u3010${text}\u3011`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `\u3010${text}\u3011`,
  },
  ur: {
    code: "ur",
    name: "Urdu",
    direction: "rtl",
    italicReplacement: "\u3010",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `\u3010${text}\u3011`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `\u3010${text}\u3011`,
  },
  ks: {
    code: "ks",
    name: "Kashmiri",
    direction: "rtl",
    italicReplacement: "\u3010",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `\u3010${text}\u3011`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `\u3010${text}\u3011`,
  },
  ja: {
    code: "ja",
    name: "Japanese",
    direction: "ltr",
    italicReplacement: "\u300C",
    quotes: { open: "\u300C", close: "\u300D" },
    ellipsis: "\u2026\u2026",
    emDash: "\u2014\u2014",
    formatThought: (text) => `\u300C${text}\u300D`,
    formatDialogue: (speaker, text) => `${speaker}\u300C${text}\u300D`,
    formatEmphasis: (text) => `\u300C${text}\u300D`,
  },
  zh: {
    code: "zh",
    name: "Chinese",
    direction: "ltr",
    italicReplacement: "\u300C",
    quotes: { open: "\u300C", close: "\u300D" },
    ellipsis: "\u2026\u2026",
    emDash: "\u2014\u2014",
    formatThought: (text) => `\u300C${text}\u300D`,
    formatDialogue: (speaker, text) => `${speaker}\u300C${text}\u300D`,
    formatEmphasis: (text) => `\u300C${text}\u300D`,
  },
  ko: {
    code: "ko",
    name: "Korean",
    direction: "ltr",
    italicReplacement: "\u300C",
    quotes: { open: "\u300C", close: "\u300D" },
    ellipsis: "\u2026\u2026",
    emDash: "\u2014\u2014",
    formatThought: (text) => `\u300C${text}\u300D`,
    formatDialogue: (speaker, text) => `${speaker}\u300C${text}\u300D`,
    formatEmphasis: (text) => `\u300C${text}\u300D`,
  },
  fr: {
    code: "fr",
    name: "French",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker} : \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `*${text}*`,
  },
  de: {
    code: "de",
    name: "German",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u201E", close: "\u201C" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u201E${text}\u201C`,
    formatEmphasis: (text) => `*${text}*`,
  },
  es: {
    code: "es",
    name: "Spanish",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `*${text}*`,
  },
  hi: {
    code: "hi",
    name: "Hindi",
    direction: "ltr",
    italicReplacement: "\u300C",
    quotes: { open: "\u300C", close: "\u300D" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `\u300C${text}\u300D`,
    formatDialogue: (speaker, text) => `${speaker}: \u300C${text}\u300D`,
    formatEmphasis: (text) => `\u300C${text}\u300D`,
  },
  tr: {
    code: "tr",
    name: "Turkish",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u201C", close: "\u201D" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u201C${text}\u201D`,
    formatEmphasis: (text) => `*${text}*`,
  },
  ru: {
    code: "ru",
    name: "Russian",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `*${text}*`,
  },
  pt: {
    code: "pt",
    name: "Portuguese",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `*${text}*`,
  },
  ro: {
    code: "ro",
    name: "Romanian",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `*${text}*`,
  },
  it: {
    code: "it",
    name: "Italian",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `*${text}*`,
  },
  id: {
    code: "id",
    name: "Indonesian",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u201C", close: "\u201D" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u201C${text}\u201D`,
    formatEmphasis: (text) => `*${text}*`,
  },
  ne: {
    code: "ne",
    name: "Nepali",
    direction: "ltr",
    italicReplacement: "\u300C",
    quotes: { open: "\u300C", close: "\u300D" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `\u300C${text}\u300D`,
    formatDialogue: (speaker, text) => `${speaker}: \u300C${text}\u300D`,
    formatEmphasis: (text) => `\u300C${text}\u300D`,
  },
  bn: {
    code: "bn",
    name: "Bangla",
    direction: "ltr",
    italicReplacement: "\u300C",
    quotes: { open: "\u300C", close: "\u300D" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `\u300C${text}\u300D`,
    formatDialogue: (speaker, text) => `${speaker}: \u300C${text}\u300D`,
    formatEmphasis: (text) => `\u300C${text}\u300D`,
  },
  sw: {
    code: "sw",
    name: "Swahili",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u201C", close: "\u201D" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u201C${text}\u201D`,
    formatEmphasis: (text) => `*${text}*`,
  },
  la: {
    code: "la",
    name: "Latin",
    direction: "ltr",
    italicReplacement: "*",
    quotes: { open: "\u00AB", close: "\u00BB" },
    ellipsis: "\u2026",
    emDash: "\u2014",
    formatThought: (text) => `*${text}*`,
    formatDialogue: (speaker, text) => `${speaker}: \u00AB${text}\u00BB`,
    formatEmphasis: (text) => `*${text}*`,
  },
};

export function getScriptConfig(language: string): ScriptConfig {
  return (
    scriptConfigs[language] || {
      code: language,
      name: language,
      direction: "ltr",
      italicReplacement: "*",
      quotes: { open: '"', close: '"' },
      ellipsis: "\u2026",
      emDash: "\u2014",
      formatThought: (text) => `*${text}*`,
      formatDialogue: (speaker, text) => `${speaker}: "${text}"`,
      formatEmphasis: (text) => `*${text}*`,
    }
  );
}

export function isRTL(language: string): boolean {
  return ["ar", "ur", "ks"].includes(language);
}

export function formatDragonTelepathy(
  text: string,
  language: string
): string {
  const config = getScriptConfig(language);
  if (config.direction === "rtl") {
    return `\u3010${text}\u3011`;
  }
  return `\u300C${text}\u300D`;
}

export function formatQuote(text: string, language: string): string {
  const config = getScriptConfig(language);
  return `${config.quotes.open}${text}${config.quotes.close}`;
}

export function formatEllipse(text: string, language: string): string {
  const config = getScriptConfig(language);
  return `${text}${config.ellipsis}`;
}

export function formatDash(text: string, language: string): string {
  const config = getScriptConfig(language);
  return `${text} ${config.emDash}`;
}

export function processRTLText(text: string): string {
  const rtlChars = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  let result = "";
  let currentSegment = "";
  let isRTL = false;

  for (const char of text) {
    const charIsRTL = rtlChars.test(char);
    if (charIsRTL !== isRTL && currentSegment) {
      result += isRTL ? reverseString(currentSegment) : currentSegment;
      currentSegment = "";
    }
    currentSegment += char;
    isRTL = charIsRTL;
  }

  if (currentSegment) {
    result += isRTL ? reverseString(currentSegment) : currentSegment;
  }

  return result;
}

function reverseString(str: string): string {
  return str.split("").reverse().join("");
}

export function preserveLineBreaks(
  original: string,
  translated: string
): string {
  const originalLines = original.split("\n");
  const translatedWords = translated.split(/\s+/);
  let wordIndex = 0;

  return originalLines
    .map((line) => {
      if (line.trim() === "") return "";
      const wordsInLine = line.trim().split(/\s+/).length;
      const lineWords = translatedWords.slice(wordIndex, wordIndex + wordsInLine);
      wordIndex += wordsInLine;
      return lineWords.join(" ");
    })
    .join("\n");
}
