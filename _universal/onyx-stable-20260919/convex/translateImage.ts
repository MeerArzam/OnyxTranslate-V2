"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const LANGUAGE_NAMES: Record<string, string> = {
  ur: "Urdu",
  ar: "Arabic",
  fr: "French",
  ja: "Japanese",
  es: "Spanish",
  hi: "Hindi",
  tr: "Turkish",
  zh: "Chinese",
  ru: "Russian",
  ko: "Korean",
  de: "German",
  ks: "Kashmiri",
  ro: "Romanian",
  sw: "Swahili",
  it: "Italian",
  la: "Latin",
  id: "Indonesian",
  ne: "Nepali",
  bn: "Bangla",
  pt: "Portuguese",
};

export const translateImage = action({
  args: {
    imageBase64: v.string(),
    langCode: v.string(),
  },
  handler: async (ctx, args) => {
    const langName = LANGUAGE_NAMES[args.langCode] || args.langCode;

    const systemPrompt = [
      "You are an expert OCR and translation engine.",
      "Tasks:",
      "1. Extract ALL text from the provided image accurately, preserving the original layout and formatting.",
      "2. Translate the extracted text into " + langName + ".",
      "3. Preserve the original formatting, line breaks, and structure.",
      "4. If the text is already in the target language, return it unchanged.",
      "5. For RTL languages (Urdu, Arabic, Kashmiri), output properly formatted RTL text.",
      "6. Return ONLY the translated text — no explanations, no notes, no markdown fences.",
    ].join("\n");

    // Read all 5 Gemini keys
    const keys = [
      process.env.Gemini_API_Key_1,
      process.env.Gemini_API_Key_2,
      process.env.Gemini_API_Key_3,
      process.env.Gemini_API_Key_4,
      process.env.Gemini_API_Key_5,
    ].filter((k): k is string => !!k);

    if (keys.length === 0) {
      return { ok: false, extractedText: "", error: "No Gemini API keys configured" };
    }

    let lastError = "";

    for (const key of keys) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(GEMINI_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gemini-3.6-flash",
              messages: [
                { role: "system" as const, content: systemPrompt },
                {
                  role: "user" as const,
                  content: [
                    {
                      type: "text" as const,
                      text: "Extract and translate the text in this image into " + langName + ".",
                    },
                    {
                      type: "image_url" as const,
                      image_url: {
                        url: "data:image/jpeg;base64," + args.imageBase64,
                      },
                    },
                  ],
                },
              ],
              temperature: 0.3,
              max_tokens: 4096,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content ?? "";
            if (!text) {
              lastError = "Empty response from Gemini";
              break;
            }
            // Strip accidental markdown fences
            const cleaned = text
              .replace(/^```[a-z]*\n?/i, "")
              .replace(/\n?```$/i, "")
              .trim();

            // Save to Convex DB
            try {
              await ctx.runMutation(api.mutations.saveImageTranslation, {
                imageBase64: args.imageBase64,
                extractedText: cleaned,
                translatedText: cleaned,
                langCode: args.langCode,
                status: "complete",
              });
            } catch {
              // DB save failed — still return the result
            }

            return {
              ok: true,
              extractedText: cleaned,
              model: "gemini-3.6-flash",
              usage: data.usage ?? null,
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
          const body = await res.text();
          lastError = `HTTP ${res.status}: ${body.slice(0, 150)}`;
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        }
      }
    }

    return { ok: false, extractedText: "", error: `All Gemini keys exhausted. Last: ${lastError}` };
  },
});
