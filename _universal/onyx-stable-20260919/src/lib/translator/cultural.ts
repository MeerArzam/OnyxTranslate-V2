export interface CulturalRule {
  id: string;
  name: string;
  description: string;
  appliesTo: string[];
  category: "profanity" | "intimacy" | "political" | "religious" | "sensitivity";
  filter: (text: string, lang: string) => string;
}

export interface MarketContext {
  id: string;
  name: string;
  description: string;
  rules: string[];
}

export const marketContexts: MarketContext[] = [
  {
    id: "standard",
    name: "Standard",
    description: "Standard translation with minimal cultural adaptation",
    rules: [],
  },
  {
    id: "high-censorship",
    name: "High Censorship",
    description: "For markets with strict content regulations (Turkey, Arabic markets)",
    rules: ["profanity", "intimacy", "political", "religious"],
  },
  {
    id: "romance-focused",
    name: "Romance Focused",
    description: "Enhanced romantic language for markets that prefer subtle expression (Korean, Japanese)",
    rules: ["intimacy"],
  },
  {
    id: "conservative",
    name: "Conservative",
    description: "For highly conservative markets with strict cultural norms",
    rules: ["profanity", "intimacy", "political", "religious", "sensitivity"],
  },
];

const profanityReplacements: Record<string, Record<string, string>> = {
  en: {
    "holy shit": "by the gods",
    "damn": "blast",
    "hell": "the beyond",
    "ass": "rear",
    "bastard": "scoundrel",
    "shit": "drake dung",
    "fuck": "blasted",
    "damn it": "blast it all",
  },
  ar: {
    "holy shit": "يا إلهي",
    "damn": "لعنة",
    "hell": "جهنم",
    "bastard": "حقير",
    "shit": "تبول",
    "fuck": "اللعنة",
    "damn it": "تباً لذلك",
  },
  ja: {
    "holy shit": "なんてこと",
    "damn": "くそ",
    "hell": "地獄",
    "bastard": "間抜け",
    "shit": "クソ",
    "fuck": "ちくしょう",
    "damn it": "くそっ",
  },
  fr: {
    "holy shit": "par les dieux",
    "damn": "merde",
    "hell": "enfer",
    "bastard": "canaille",
    "shit": "merde",
    "fuck": "putain",
    "damn it": "bon sang",
  },
  de: {
    "holy shit": "bei den Göttern",
    "damn": "verdammt",
    "hell": "Hölle",
    "bastard": "Schurke",
    "shit": "Mist",
    "fuck": "verfickt",
    "damn it": "verdammt noch mal",
  },
  ko: {
    "holy shit": "세상에",
    "damn": "씨발",
    "hell": "지옥",
    "bastard": "이 자식",
    "shit": "시발",
    "fuck": "지랄",
    "damn it": "아 씨",
  },
  zh: {
    "holy shit": "天哪",
    "damn": "该死",
    "hell": "地狱",
    "bastard": "混蛋",
    "shit": "狗屎",
    "fuck": "他妈的",
    "damn it": "该死的",
  },
  es: {
    "holy shit": "por los dioses",
    "damn": "maldición",
    "hell": "infierno",
    "bastard": "canalla",
    "shit": "mierda",
    "fuck": "joder",
    "damn it": "por el amor de",
  },
  hi: {
    "holy shit": "हे भगवान",
    "damn": "शापित",
    "hell": "नरक",
    "bastard": "कमीना",
    "shit": "बकवास",
    "fuck": "साला",
    "damn it": "बकवास",
  },
  tr: {
    "holy shit": "tanrım",
    "damn": "lanet",
    "hell": "cehennem",
    "bastard": "alçak",
    "shit": "bok",
    "fuck": "lanet olası",
    "damn it": "lanet olsun",
  },
  ru: {
    "holy shit": "боже мой",
    "damn": "чёрт",
    "hell": "ад",
    "bastard": " каналья",
    "shit": "дерьмо",
    "fuck": "чёрт",
    "damn it": "чёрт побери",
  },
  pt: {
    "holy shit": "pelos deuses",
    "damn": "maldição",
    "hell": "inferno",
    "bastard": "canalha",
    "shit": "merda",
    "fuck": "caralho",
    "damn it": "droga",
  },
  it: {
    "holy shit": "per gli dei",
    "damn": " dannazione",
    "hell": "inferno",
    "bastard": "canaglia",
    "shit": "merda",
    "fuck": "cazzo",
    "damn it": "dannazione",
  },
  id: {
    "holy shit": "ya Tuhan",
    "damn": "sialan",
    "hell": "neraka",
    "bastard": "brengsek",
    "shit": "tai",
    "fuck": "anjing",
    "damn it": "sial",
  },
  ne: {
    "holy shit": "हे भगवान",
    "damn": "श्रापित",
    "hell": "नरक",
    "bastard": "बदमाश",
    "shit": "बकवास",
    "fuck": "साला",
    "damn it": "बकवास",
  },
  bn: {
    "holy shit": "হে ঈশ্বর",
    "damn": "অভিশাপ",
    "hell": "নরক",
    "bastard": "পোলাপাইন",
    "shit": "গু খাওয়া",
    "fuck": "বাল",
    "damn it": "অভিশাপ",
  },
  sw: {
    "holy shit": "Mungu wangu",
    "damn": "laana",
    "hell": "jahanam",
    "bastard": "mtu wa chini",
    "shit": "kinyesi",
    "fuck": "shinda",
    "damn it": "laana",
  },
  la: {
    "holy shit": "di immortales",
    "damn": "furcifer",
    "hell": "Tartarus",
    "bastard": "verbero",
    "shit": "stercus",
    "fuck": "futue",
    "damn it": "furcifer",
  },
  ks: {
    "holy shit": "یا خدا",
    "damn": "لعنت",
    "hell": "جهنم",
    "bastard": "حقیر",
    "shit": "تبوال",
    "fuck": "اللعنة",
    "damn it": "تباً لذلك",
  },
  ro: {
    "holy shit": "doamne ferește",
    "damn": "blestemat",
    "hell": "iad",
    "bastard": "netrebnic",
    "shit": "căcat",
    "fuck": "pula",
    "damn it": "dracului",
  },
};

const intimacyEuphemisms: Record<string, Record<string, string>> = {
  ar: {
    "they became one": "اصط Momentum",
    "she melted into his embrace": "ذابت في أحضانه",
    "their bodies entwined": "تشابكت أجسادهما",
    "skin against skin": "جلد على جلد",
    "his touch consumed her": "لمسته استهلكتها",
  },
  ja: {
    "they became one": "二人は一つになった",
    "she melted into his embrace": "彼の腕に溶け込んだ",
    "their bodies entwined": "体が絡み合った",
    "skin against skin": "肌が触れ合い",
    "his touch consumed her": "彼の触碰に包まれた",
  },
  fr: {
    "they became one": "ils ne faisaient qu'un",
    "she melted into his embrace": "elle fond dans ses bras",
    "their bodies entwined": "leurs corps s'entrelaçaient",
    "skin against skin": "peau contre peau",
    "his touch consumed her": "son toucher la consumait",
  },
  de: {
    "they became one": "sie wurden eins",
    "she melted into his embrace": "sie schmolz in seinen Armen",
    "their bodies entwined": "ihre Körper verschrankten sich",
    "skin against skin": "Haut an Haut",
    "his touch consumed her": "seine Berührung verschlang sie",
  },
  ko: {
    "they became one": "두 사람은 하나가 되었다",
    "she melted into his embrace": "그의 품에 녹아들었다",
    "their bodies entwined": "몸이 얽혔다",
    "skin against skin": "살이 맞닿았다",
    "his touch consumed her": "그의 손길에 삼켜졌다",
  },
  zh: {
    "they became one": "两人合二为一",
    "she melted into his embrace": "她融化在他的怀抱中",
    "their bodies entwined": "身体交缠在一起",
    "skin against skin": "肌肤相亲",
    "his touch consumed her": "他的触碰吞噬了她",
  },
  es: {
    "they became one": "se convirtieron en uno",
    "she melted into his embrace": "se derritió en sus brazos",
    "their bodies entwined": "sus cuerpos se enredaron",
    "skin against skin": "piel contra piel",
    "his touch consumed her": "su toque la consumía",
  },
  hi: {
    "they became one": "वे एक हो गए",
    "she melted into his embrace": "वह उसकी बाहों में पिघल गई",
    "their bodies entwined": "उनके शरीर आपस में जुड़ गए",
    "skin against skin": "त्वचा से त्वचा",
    "his touch consumed her": "उसका स्पर्श उसे निगल गया",
  },
  tr: {
    "they became one": "bir oldular",
    "she melted into his embrace": "kollarında eridi",
    "their bodies entwined": "bedenleri birbirine dolandı",
    "skin against skin": "ten tene",
    "his touch consumed her": "dokunuşu onu yutuyordu",
  },
  ru: {
    "they became one": "они стали одним",
    "she melted into his embrace": "она растаяла в его объятиях",
    "their bodies entwined": "их тела переплелись",
    "skin against skin": "кожа к коже",
    "his touch consumed her": "его прикосновение поглощало её",
  },
  pt: {
    "they became one": "eles se tornaram um",
    "she melted into his embrace": "ela derreteu em seus braços",
    "their bodies entwined": "seus corpos se entrelaçaram",
    "skin against skin": "pele contra pele",
    "his touch consumed her": "seu toque a consumia",
  },
  it: {
    "they became one": "diventarono uno",
    "she melted into his embrace": "si disciolse nelle sue braccia",
    "their bodies entwined": "i loro corpi si intrecciarono",
    "skin against skin": "pelle contro pelle",
    "his touch consumed her": "il suo tocco la consumava",
  },
  id: {
    "they became one": "mereka menjadi satu",
    "she melted into his embrace": "dia meleleh dalam pelukannya",
    "their bodies entwined": "tubuh mereka terjalin",
    "skin against skin": "kulit menempel kulit",
    "his touch consumed her": "sentuhannya melahapnya",
  },
  ne: {
    "they became one": "उनी एक भए",
    "she melted into his embrace": "उनको खोल्मा घुलिन्",
    "their bodies entwined": "उनका शरीर आपसमा जोडिए",
    "skin against skin": "छाला छालामा",
    "his touch consumed her": "उनको छोएले उनलाई निल्यो",
  },
  bn: {
    "they became one": "তারা এক হয়ে গেল",
    "she melted into his embrace": "সে তার কোলে গলে গেল",
    "their bodies entwined": "তাদের শরীর জড়িয়ে পড়ল",
    "skin against skin": "ত্বক ত্বকের স্পর্শে",
    "his touch consumed her": "তার স্পর্শ তাকে গ্রাস করল",
  },
  sw: {
    "they became one": "walikuwa mmoja",
    "she melted into his embrace": "ilimwagika katika mikono yake",
    "their bodies entwined": "miili yao ilifungana",
    "skin against skin": "ngozi dhidi ya ngozi",
    "his touch consumed her": "mguso wake ulimmeza",
  },
  la: {
    "they became one": "facti sunt unum",
    "she melted into his embrace": "in complexu eius liquescebat",
    "their bodies entwined": "corpora connectebantur",
    "skin against skin": "pellis ad pellem",
    "his touch consumed her": "tactus eius eam consumebat",
  },
  ks: {
    "they became one": "ون ایک ہو گئے",
    "she melted into his embrace": "وہ اس کی گود میں پگھل گئی",
    "their bodies entwined": "ان کے جسم آپس میں جڑ گئے",
    "skin against skin": "جلد پر جلد",
    "his touch consumed her": "اس کا چھونا اسے نگل گیا",
  },
  ro: {
    "they became one": "au devenit unul",
    "she melted into his embrace": "s-a topit in bratele lui",
    "their bodies entwined": "corpurile lor s-au împletit",
    "skin against skin": "piele pe piele",
    "his touch consumed her": "atingerea lui o consuma",
  },
};

export const culturalRules: CulturalRule[] = [
  {
    id: "profanity-replacement",
    name: "Profanity Replacement",
    description: "Replace explicit profanity with culturally appropriate alternatives",
    appliesTo: ["ar", "tr", "id", "ks", "ne", "bn"],
    category: "profanity",
    filter: (text: string, lang: string) => {
      const replacements = profanityReplacements[lang] || profanityReplacements.en;
      let result = text;
      for (const [key, value] of Object.entries(replacements)) {
        const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        result = result.replace(regex, value);
      }
      return result;
    },
  },
  {
    id: "intimacy-euphemism",
    name: "Intimacy Euphemism",
    description: "Replace explicit romantic content with poetic euphemisms",
    appliesTo: ["ar", "tr", "id", "ks", "ne", "bn", "ja", "ko", "zh"],
    category: "intimacy",
    filter: (text: string, lang: string) => {
      const euphemisms = intimacyEuphemisms[lang] || {};
      let result = text;
      
      const explicitPatterns = [
        /naked/gi,
        /bare skin/gi,
        /his cock/gi,
        /her breasts/gi,
        /sexually/gi,
        /orgasm/gi,
        /intercourse/gi,
      ];
      
      for (const pattern of explicitPatterns) {
        result = result.replace(pattern, (match) => {
          const keys = Object.keys(euphemisms);
          if (keys.length > 0) {
            return euphemisms[keys[Math.floor(Math.random() * keys.length)]];
          }
          return match;
        });
      }
      
      return result;
    },
  },
  {
    id: "political-reframe",
    name: "Political Sensitivity Reframe",
    description: "Reframe political debates using archaic, high-fantasy diplomatic language",
    appliesTo: ["ar", "tr", "id", "ks", "ru"],
    category: "political",
    filter: (text: string) => {
      const politicalTerms: Record<string, string> = {
        "rebellion": "uprising of the old ways",
        "revolution": "great reckoning",
        "coup": "seizure of the throne",
        "democracy": "council of voices",
        "tyranny": "iron rule",
        "oppression": "the weight of chains",
        "freedom fighters": "warriors of the dawn",
        "government": "the ruling council",
        "politics": "courtly maneuverings",
        "power struggle": "battle for the throne",
      };
      
      let result = text;
      for (const [key, value] of Object.entries(politicalTerms)) {
        const regex = new RegExp(key, "gi");
        result = result.replace(regex, value);
      }
      return result;
    },
  },
  {
    id: "religious-sensitivity",
    name: "Religious Sensitivity",
    description: "Adjust religious references for local markets",
    appliesTo: ["ar", "ks", "tr", "id", "ne", "bn"],
    category: "religious",
    filter: (text: string, lang: string) => {
      const religiousTerms: Record<string, Record<string, string>> = {
        ar: {
          "god": "الله",
          "gods": "الآلهة",
          "holy": "مقدس",
          "sacred": "مقدس",
          "divine": "إلهي",
          "prayer": "دعاء",
          "temple": "معبد",
          "church": "كنيسة",
          "faith": "إيمان",
        },
        tr: {
          "god": "Tanrı",
          "gods": "tanrılar",
          "holy": "kutsal",
          "sacred": "kutsal",
          "divine": "ilahi",
          "prayer": "dua",
          "temple": "tapınak",
          "church": "kilise",
          "faith": "inanç",
        },
        id: {
          "god": "Tuhan",
          "gods": "dewa",
          "holy": "suci",
          "sacred": "suci",
          "divine": "ilahi",
          "prayer": "doa",
          "temple": "kuil",
          "church": "gereja",
          "faith": "iman",
        },
      };
      
      const replacements = religiousTerms[lang] || religiousTerms.ar;
      let result = text;
      for (const [key, value] of Object.entries(replacements)) {
        const regex = new RegExp(`\\b${key}\\b`, "gi");
        result = result.replace(regex, value);
      }
      return result;
    },
  },
  {
    id: "sensitivity-adjustment",
    name: "Sensitivity Adjustment",
    description: "Adjust sensitive content for conservative markets",
    appliesTo: ["ar", "ks", "tr", "id", "ne", "bn"],
    category: "sensitivity",
    filter: (text: string) => {
      const sensitiveTerms: Record<string, string> = {
        "blood": "crimson ichor",
        "death": "passing",
        "kill": "dispatch",
        "murder": "dark deed",
        "suicide": "final act",
        "torture": "great suffering",
        "slave": "bound servant",
        "slavery": "bondage",
        "racist": "prejudiced",
        "homosexual": "one who loves differently",
        "gay": "joyful soul",
      };
      
      let result = text;
      for (const [key, value] of Object.entries(sensitiveTerms)) {
        const regex = new RegExp(`\\b${key}\\b`, "gi");
        result = result.replace(regex, value);
      }
      return result;
    },
  },
];

export function applyCulturalFilters(
  text: string,
  language: string,
  marketContext: string
): string {
  const context = marketContexts.find((c) => c.id === marketContext);
  if (!context || context.rules.length === 0) return text;
  
  let result = text;
  for (const ruleId of context.rules) {
    const rule = culturalRules.find((r) => r.id === ruleId);
    if (rule && rule.appliesTo.includes(language)) {
      result = rule.filter(result, language);
    }
  }
  
  return result;
}

export function detectExplicitContent(text: string): boolean {
  const explicitPatterns = [
    /\bnaked\b/i,
    /\bbare skin\b/i,
    /\bsexually\b/i,
    /\bintercourse\b/i,
    /\borgasm\b/i,
    /\bintimate\b.*\bparts?\b/i,
    /\bgenital\b/i,
    /\bbreast\b.*\btouch/i,
  ];
  
  return explicitPatterns.some((pattern) => pattern.test(text));
}

export function getEuphemism(
  language: string,
  type: "romantic" | "intimate" = "romantic"
): string {
  const euphemisms = intimacyEuphemisms[language] || {};
  const keys = Object.keys(euphemisms);
  if (keys.length === 0) return "they drew close";
  return euphemisms[keys[Math.floor(Math.random() * keys.length)]];
}
