export interface CharacterVoice {
  name: string;
  description: string;
  internalThought: string;
  dialogueStyle: string;
  tone: string;
  pronounRules: string;
  examples: {
    possessive: string;
    command: string;
    declaration: string;
  };
}

export interface VoiceOverride {
  examples: {
    possessive?: string;
    command?: string;
    declaration?: string;
  };
}

export const characterVoices: Record<string, CharacterVoice> = {
  violet: {
    name: "Violet Sorrengail",
    description: "Analytical, internal monologue heavy, determined, righteous fury",
    internalThought:
      "Use longer, complex sentence structures. Layer introspection with sharp observations. Balance vulnerability with fierce determination.",
    dialogueStyle:
      "Sharp, defensive vernacular for external dialogue. Quick retorts that mask emotional depth. Uses precise vocabulary.",
    tone:
      "Intelligent and passionate. Her voice carries the weight of knowledge and the fire of someone who refuses to be underestimated.",
    pronounRules:
      "Use 'I' with authority in internal thoughts. Use 'we/us' when addressing allies. Formal 'you' with authority figures.",
    examples: {
      possessive: "This is mine to decide",
      command: "Stand down. Now.",
      declaration: "I am not afraid of what I am becoming.",
    },
  },
  xaden: {
    name: "Xaden Riorson",
    description: "Clipped, arrogant, icily possessive, sarcastic",
    internalThought:
      "Short, declarative sentences. Military precision in thought. Suppressed emotion leaking through controlled prose.",
    dialogueStyle:
      "Short, declarative sentences. Avoid polite/formal honorifics when speaking to Violet. Use deep, possessive pronouns.",
    tone:
      "Dangerous and magnetic. Every word carries weight and unspoken intensity. When he speaks, the temperature drops.",
    pronounRules:
      "Use 'mine' as possessive. Use 'you' not 'your' for emphasis. Never use honorifics with Violet.",
    examples: {
      possessive: "You are mine.",
      command: "Don't. Move.",
      declaration: "I will burn the world before I let it touch you.",
    },
  },
  ridoc: {
    name: "Ridoc Gamlyn",
    description: "Modern, sarcastic, comedic relief",
    internalThought:
      "Less internal monologue. More external processing. Uses humor to deflect and observe.",
    dialogueStyle:
      "Sacrifice literal English jokes for culturally equivalent humor. Quick wit and observational comedy.",
    tone:
      "The friend who makes you laugh while the world burns. Sharp, self-deprecating, surprisingly insightful.",
    pronounRules:
      "Casual with everyone. First name basis. Uses 'bro' or cultural equivalent with friends.",
    examples: {
      possessive: "My bad decisions are my own, thank you very much",
      command: "Run. Just... run.",
      declaration: "I'm not dying for this. But I might die because of you anyway.",
    },
  },
  dain: {
    name: "Dain Aetos",
    description: "Controlled, political, strategic",
    internalThought:
      "Measured and calculating. Weighs every word for political impact. Masks emotion behind duty.",
    dialogueStyle:
      "Formal and precise. Uses titles and protocol. Words carefully chosen to maintain appearances.",
    tone:
      "The politician in the room. Smooth exterior hiding deeper currents of loyalty and conflict.",
    pronounRules:
      "Formal with superiors. Slightly less formal with equals. Never casual.",
    examples: {
      possessive: "The responsibility is mine, Commander",
      command: "State your intentions clearly.",
      declaration: "Duty demands sacrifice. You know this.",
    },
  },
  imogen: {
    name: "Imogen Cardaran",
    description: "Loyal, fierce, emotionally guarded",
    internalThought:
      "Sharp and protective. Thinks in terms of threats and allies. Emotions locked behind walls of loyalty.",
    dialogueStyle:
      "Direct and unflinching. Rarely wastes words. When she speaks, it matters.",
    tone:
      "The warrior poet. Fierce loyalty expressed through action more than words.",
    pronounRules:
      "Casual with inner circle. Formal with outsiders. Never weak.",
    examples: {
      possessive: "These are my people",
      command: "Touch them and die.",
      declaration: "Loyalty is earned, not demanded.",
    },
  },
  brennan: {
    name: "Brennan Sorrengail",
    description: "Protective older brother, burdened leader",
    internalThought:
      "Weight of leadership. Constant worry masked by duty. Thinks in terms of protection and strategy.",
    dialogueStyle:
      "Brotherly warmth undercut by command presence. Protective without being patronizing.",
    tone:
      "The weight of the world on his shoulders, but he'll carry it so you don't have to.",
    pronounRules:
      "Casual with Violet (brother). Formal with subordinates. Authoritative with everyone.",
    examples: {
      possessive: "My sister is not your sacrifice",
      command: "Report to me immediately.",
      declaration: "Someone has to hold the line.",
    },
  },
};

export const languageSpecificVoices: Record<string, Record<string, VoiceOverride>> = {
  ar: {
    violet: {
      examples: {
        possessive: "هذا قراري أنا",
        command: "قف. الآن.",
        declaration: "لست خائفة مما أصبح عليه.",
      },
    },
    xaden: {
      examples: {
        possessive: "أنتِ لي.",
        command: "لا. تتحرك.",
        declaration: "سأحرق العالم قبل أن أسمح له بلمسك.",
      },
    },
    ridoc: {
      examples: {
        possessive: "قراراتي السيئة خاصة بي، شكراً جزيلاً",
        command: "اهرب. فقط... اهرب.",
        declaration: "لن أموت من أجل هذا. لكن قد أموت بسببك.",
      },
    },
  },
  ja: {
    violet: {
      examples: {
        possessive: "これは私が決める",
        command: "動くな。今すぐ。",
        declaration: "自分が何になるのか怖くない。",
      },
    },
    xaden: {
      examples: {
        possessive: "お前は俺のものだ。",
        command: "動くな。",
        declaration: "世界を焼き払っても、お前を守る。",
      },
    },
    ridoc: {
      examples: {
        possessive: "俺のバカな決断は俺だけのもの",
        command: "走れ。ただ走れ。",
        declaration: "死にに行くのは嫌だが、お前のおかげで死ぬかもしれない。",
      },
    },
  },
  fr: {
    violet: {
      examples: {
        possessive: "C'est ma décision",
        command: "Arrête. Maintenant.",
        declaration: "Je n'ai pas peur de ce que je deviens.",
      },
    },
    xaden: {
      examples: {
        possessive: "Tu es à moi.",
        command: "Ne bouge pas.",
        declaration: "Je brûlerai le monde avant de le laisser te toucher.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Mes mauvaises décisions m'appartiennent, merci beaucoup",
        command: "Cours. Juste... cours.",
        declaration: "Je ne mourrai pas pour ça. Mais je pourrais mourir à cause de toi.",
      },
    },
  },
  de: {
    violet: {
      examples: {
        possessive: "Das ist meine Entscheidung",
        command: "Steh still. Jetzt.",
        declaration: "Ich habe keine Angst davor, was ich werde.",
      },
    },
    xaden: {
      examples: {
        possessive: "Du bist mein.",
        command: "Beweg dich nicht.",
        declaration: "Ich werde die Welt niederbrennen, bevor ich sie dich berühren lasse.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Meine schlechten Entscheidungen gehören mir, danke sehr",
        command: "Renn. Einfach... renn.",
        declaration: "Ich sterbe nicht dafür. Aber ich könnte wegen dir sterben.",
      },
    },
  },
  ko: {
    violet: {
      examples: {
        possessive: "이건 내가 결정하는 거야",
        command: "움직이지 마. 지금 당장.",
        declaration: "내가 무엇이 되어가는지 두렵지 않아.",
      },
    },
    xaden: {
      examples: {
        possessive: "너는 내 것이다.",
        command: "움직이지 마.",
        declaration: "세계를 불태워서라도 널 지키겠다.",
      },
    },
    ridoc: {
      examples: {
        possessive: "내 잘못된 결정은 내 거야, 고마워",
        command: "뛰어. 그냥... 뛰어.",
        declaration: "이걸 위해 죽진 않겠어. 하지만 네 때문에 죽을 수도 있어.",
      },
    },
  },
  zh: {
    violet: {
      examples: {
        possessive: "这是我的决定",
        command: "站住。现在。",
        declaration: "我不怕我正在变成什么。",
      },
    },
    xaden: {
      examples: {
        possessive: "你是我的。",
        command: "不许动。",
        declaration: "我会焚烧世界，也不让它碰你。",
      },
    },
    ridoc: {
      examples: {
        possessive: "我的错误决定属于我自己，谢谢",
        command: "跑。快跑。",
        declaration: "我不会为此而死。但可能会因你而死。",
      },
    },
  },
  es: {
    violet: {
      examples: {
        possessive: "Esta es mi decisión",
        command: "Alto. Ahora.",
        declaration: "No tengo miedo de lo que estoy convirtiéndome.",
      },
    },
    xaden: {
      examples: {
        possessive: "Eres mía.",
        command: "No te muevas.",
        declaration: "Quemaré el mundo antes de dejar que te toque.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Mis malas decisiones son mías, muchas gracias",
        command: "Corre. Solo... corre.",
        declaration: "No moriré por esto. Pero podría morir por ti.",
      },
    },
  },
  hi: {
    violet: {
      examples: {
        possessive: "यह मेरा फैसला है",
        command: "रुको। अभी।",
        declaration: "मैं डरती नहीं कि मैं क्या बन रही हूँ।",
      },
    },
    xaden: {
      examples: {
        possessive: "तुम मेरी हो।",
        command: "हिलो मत।",
        declaration: "मैं दुनिया जला दूँगा इससे पहले कि वह तुम्हें छू ले।",
      },
    },
    ridoc: {
      examples: {
        possessive: "मेरे बुरे फैसले मेरे हैं, शुक्रिया",
        command: "भागो। बस... भागो।",
        declaration: "मैं इसके लिए नहीं मरूँगा। लेकिन तुम्हारी वजह से मर सकता हूँ।",
      },
    },
  },
  tr: {
    violet: {
      examples: {
        possessive: "Bu benim kararım",
        command: "Dur. Şimdi.",
        declaration: "Ne olduğumdan korkmuyorum.",
      },
    },
    xaden: {
      examples: {
        possessive: "Sen benimsin.",
        command: "Hareket etme.",
        declaration: "Dünyayı yakacağım, sana dokunmasına izin vermeden önce.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Kötü kararlarım bana ait, çok teşekkürler",
        command: "Kaç. Sadece... kaç.",
        declaration: "Bunun için ölmeyeceğim. Ama senin yüzünden ölebilirim.",
      },
    },
  },
  ru: {
    violet: {
      examples: {
        possessive: "Это моё решение",
        command: "Стоять. Сейчас.",
        declaration: "Я не боюсь того, чем становлюсь.",
      },
    },
    xaden: {
      examples: {
        possessive: "Ты моя.",
        command: "Не двигайся.",
        declaration: "Я сожгу мир, прежде чем позволю ему тебя коснуться.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Мои плохие решения — мои, спасибо большое",
        command: "Беги. Просто... беги.",
        declaration: "Я не умру за это. Но могу умереть из-за тебя.",
      },
    },
  },
  pt: {
    violet: {
      examples: {
        possessive: "Esta é a minha decisão",
        command: "Pare. Agora.",
        declaration: "Não tenho medo do que estou me tornando.",
      },
    },
    xaden: {
      examples: {
        possessive: "Você é minha.",
        command: "Não se mova.",
        declaration: "Queimarei o mundo antes de deixá-lo te tocar.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Minhas más decisões são minhas, muito obrigado",
        command: "Corra. Só... corra.",
        declaration: "Não morrerei por isso. Mas posso morrer por você.",
      },
    },
  },
  it: {
    violet: {
      examples: {
        possessive: "Questa è la mia decisione",
        command: "Fermati. Ora.",
        declaration: "Non ho paura di ciò che sto diventando.",
      },
    },
    xaden: {
      examples: {
        possessive: "Sei mia.",
        command: "Non muoverti.",
        declaration: "Brucierò il mondo prima di lasciargli toccarti.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Le mie cattive decisioni sono mie, grazie mille",
        command: "Corri. Solo... corri.",
        declaration: "Non morirò per questo. Ma potrei morire a causa tua.",
      },
    },
  },
  id: {
    violet: {
      examples: {
        possessive: "Ini keputusanku",
        command: "Berhenti. Sekarang.",
        declaration: "Aku takut dengan apa yang aku jadi.",
      },
    },
    xaden: {
      examples: {
        possessive: "Kau milikku.",
        command: "Jangan bergerak.",
        declaration: "Aku akan membakar dunia sebelum membiarkannya menyentuhmu.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Keputusan burukku milikku sendiri, terima kasih",
        command: "Lari. Hanya... lari.",
        declaration: "Aku tidak akan mati untuk ini. Tapi aku mungkin mati karenamu.",
      },
    },
  },
  ne: {
    violet: {
      examples: {
        possessive: "यो मेरो निर्णय हो",
        command: "रोक। अहिले।",
        declaration: "म डर्दिन कि म के बन्दैछु।",
      },
    },
    xaden: {
      examples: {
        possessive: "तिमी मेरी हौ।",
        command: "हल्ला नगर।",
        declaration: "म संसार जलाउँछु यसलाई तिमीलाई छुन नदिन।",
      },
    },
    ridoc: {
      examples: {
        possessive: "मेरा खराब निर्णय मेरा हुन्, धन्यवाद",
        command: "भाग। बस... भाग।",
        declaration: "म यसको लागि मर्दिन। तर तिम्रो कारण मर्न सक्छु।",
      },
    },
  },
  bn: {
    violet: {
      examples: {
        possessive: "এটা আমার সিদ্ধান্ত",
        command: "থাম। এখনই।",
        declaration: "আমি ভয় পাই না আমি কী হচ্ছি।",
      },
    },
    xaden: {
      examples: {
        possessive: "তুমি আমার।",
        command: "নড়ো না।",
        declaration: "আমি পৃথিবী পুড়িয়ে দেব এর আগে এটা তোমাকে স্পর্শ করতে দিই।",
      },
    },
    ridoc: {
      examples: {
        possessive: "আমার খারাপ সিদ্ধান্ত আমার, অনেক ধন্যবাদ",
        command: "দৌড়াও। শুধু... দৌড়াও।",
        declaration: "আমি এর জন্য মরব না। কিন্তু তোমার কারণে মরতে পারি।",
      },
    },
  },
  sw: {
    violet: {
      examples: {
        possessive: "Hii ni uamuzi wangu",
        command: "Simama. Sasa hivi.",
        declaration: "Sioogopi ninachokuwa.",
      },
    },
    xaden: {
      examples: {
        possessive: "Wewe ni wangu.",
        command: "Usitetemee.",
        declaration: "Nitawaka dunia kabla ya kuiacha ikigusa wewe.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Maamuzi yangu mabovu ni yangu, asante sana",
        command: "Kimbia. Tu... kimbia.",
        declaration: "Sitanikufa kwa hii. Lakini ninaweza kufa kwa ajili yako.",
      },
    },
  },
  la: {
    violet: {
      examples: {
        possessive: "Haec mea sententia est",
        command: "Siste. Nunc.",
        declaration: "Non timeo quid fiam.",
      },
    },
    xaden: {
      examples: {
        possessive: "Tu mea es.",
        command: "Ne moveas.",
        declaration: "Mundum comburam antequam te tangat.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Meae malae sententiae meae sunt, gratias multas",
        command: "Curre. Tantum... curre.",
        declaration: "Non moriar pro hoc. Sed propter te mori possum.",
      },
    },
  },
  ks: {
    violet: {
      examples: {
        possessive: "یہ میرا فیصلہ ہے",
        command: "رکو۔ ابھی۔",
        declaration: "میں نہیں ڈرتی کہ میں کیا بن رہی ہوں۔",
      },
    },
    xaden: {
      examples: {
        possessive: "تم میری ہو۔",
        command: "ہلنا مت۔",
        declaration: "میں دنیا جلا دوں گا اس سے پہلے کہ وہ تمہیں چھو لے۔",
      },
    },
    ridoc: {
      examples: {
        possessive: "میرے برے فیصلے میرے ہیں، شکریہ",
        command: "بھاگو۔ بس... بھاگو۔",
        declaration: "میں اس کیلئے نہیں مروں گا۔ لیکن تمہاری وجہ سے مر سکتا ہوں۔",
      },
    },
  },
  ro: {
    violet: {
      examples: {
        possessive: "Aceasta este decizia mea",
        command: "Opreste-te. Acum.",
        declaration: "Nu mi-e teama de ce devin.",
      },
    },
    xaden: {
      examples: {
        possessive: "Esti a mea.",
        command: "Nu te misca.",
        declaration: "Voi arde lumea inainte de a o lasa sa te atinga.",
      },
    },
    ridoc: {
      examples: {
        possessive: "Deciziile mele proaste sunt ale mele, multumesc mult",
        command: "Alearga. Doar... alearga.",
        declaration: "Nu voi muri pentru asta. Dar as putea muri din cauza ta.",
      },
    },
  },
};

export function getCharacterVoice(
  character: string,
  language: string
): CharacterVoice {
  const baseVoice = characterVoices[character.toLowerCase()] || characterVoices.violet;
  const langOverrides = languageSpecificVoices[language]?.[character.toLowerCase()];
  
  return {
    ...baseVoice,
    examples: {
      ...baseVoice.examples,
      ...(langOverrides?.examples?.possessive && { possessive: langOverrides.examples.possessive }),
      ...(langOverrides?.examples?.command && { command: langOverrides.examples.command }),
      ...(langOverrides?.examples?.declaration && { declaration: langOverrides.examples.declaration }),
    },
  };
}

export function detectCharacterInText(text: string): string[] {
  const characters = ["Violet", "Xaden", "Ridoc", "Dain", "Imogen", "Brennan"];
  return characters.filter((char) => text.includes(char));
}
