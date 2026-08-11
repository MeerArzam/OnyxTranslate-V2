/**
 * Neural Machine Translation module using @xenova/transformers.
 *
 * - Forces WASM backend (numThreads=1) for low-end device / Android compatibility.
 * - Loads ONE language model at a time; disposes it before loading the next.
 * - Loaded at runtime from /public/vendor (outside the Vite module graph), so
 *   the initial page load, the dev-server cold start, and `vite build` never
 *   touch the ~40MB onnxruntime CJS tree.
 * - Falls back to glossary simulation for languages without ONNX Opus-MT models.
 */

import { VENDOR_URLS, loadVendorModule } from "./vendor";

// Minimal surface of transformers.js that we use. The full library (a ~900 KB
// webpack ES-module bundle with onnxruntime baked in) is served from
// /public/vendor and loaded via a runtime URL import ONLY when a translation
// starts — it is kept out of the Vite module graph.
interface TransformersModule {
  env: {
    allowRemoteModels?: boolean;
    allowLocalModels?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    backends?: any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: (...args: any[]) => Promise<any>;
}

let _transformersPromise: Promise<TransformersModule> | null = null;

async function getTransformers(): Promise<TransformersModule> {
  if (!_transformersPromise) {
    // The vendored file is an ES module (`export { … }` build), so it is loaded
    // with a URL import — exactly like pdf.js. It uses `self`/DOMMatrix, which
    // are always available in browsers (only missing in Node.js).
    _transformersPromise = loadVendorModule<TransformersModule>(VENDOR_URLS.transformers);
  }
  return _transformersPromise;
}

// ─── Model registry ──────────────────────────────────────────────────────────
// Maps ISO 639-1 codes to Hugging Face Opus-MT model IDs.
// Languages without an Opus-MT model use the fallback glossary simulation.

export interface ModelEntry {
  modelId: string | null; // null → use fallback simulation
  label: string;
}

const MODEL_REGISTRY: Record<string, ModelEntry> = {
  ur: { modelId: null, label: "Urdu" },           // No Opus-MT; use fallback
  ar: { modelId: "Helsinki-NLP/opus-mt-en-ar", label: "Arabic" },
  fr: { modelId: "Helsinki-NLP/opus-mt-en-fr", label: "French" },
  ja: { modelId: "Helsinki-NLP/opus-mt-en-jap", label: "Japanese" },
  es: { modelId: "Helsinki-NLP/opus-mt-en-es", label: "Spanish" },
  hi: { modelId: "Helsinki-NLP/opus-mt-en-hi", label: "Hindi" },
  tr: { modelId: "Helsinki-NLP/opus-mt-en-tr", label: "Turkish" },
  zh: { modelId: "Helsinki-NLP/opus-mt-en-zh", label: "Chinese" },
  ru: { modelId: "Helsinki-NLP/opus-mt-en-ru", label: "Russian" },
  ko: { modelId: "Helsinki-NLP/opus-mt-en-koa", label: "Korean" },
  de: { modelId: "Helsinki-NLP/opus-mt-en-de", label: "German" },
  ks: { modelId: null, label: "Kashmiri" },        // No Opus-MT; use fallback
  ro: { modelId: "Helsinki-NLP/opus-mt-en-ro", label: "Romanian" },
  sw: { modelId: "Helsinki-NLP/opus-mt-en-sw", label: "Swahili" },
  it: { modelId: "Helsinki-NLP/opus-mt-en-it", label: "Italian" },
  la: { modelId: null, label: "Latin" },            // No Opus-MT; use fallback
  id: { modelId: "Helsinki-NLP/opus-mt-en-ind", label: "Indonesian" },
  ne: { modelId: null, label: "Nepali" },           // No Opus-MT; use fallback
  bn: { modelId: "Helsinki-NLP/opus-mt-en-ben", label: "Bangla" },
  pt: { modelId: "Helsinki-NLP/opus-mt-en-pt", label: "Portuguese" },
};

/**
 * Returns true if a real neural model exists for this language code.
 */
export function hasNeuralModel(langCode: string): boolean {
  return MODEL_REGISTRY[langCode]?.modelId !== null && MODEL_REGISTRY[langCode]?.modelId !== undefined;
}

// ─── Active pipeline state ───────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activePipeline: any = null;
let activeLangCode: string | null = null;

export type NeuralProgressCallback = (
  phase: "loading-model" | "translating" | "done" | "disposing" | "fallback",
  message: string
) => void;

/**
 * Load the translation model for a specific language.
 * If a different language was loaded before, disposes it first.
 *
 * IMPORTANT: Models are loaded lazily from the Hugging Face Hub via WASM.
 * The first load of each language downloads ~300 MB; subsequent loads use
 * the browser Cache API.
 */
export async function loadModel(
  langCode: string,
  onProgress?: NeuralProgressCallback
): Promise<boolean> {
  const entry = MODEL_REGISTRY[langCode];

  // No model available → caller should use fallback
  if (!entry?.modelId) {
    onProgress?.("fallback", `No neural model for ${entry?.label || langCode}; using glossary simulation`);
    return false;
  }

  // Already loaded for this language
  if (activeLangCode === langCode && activePipeline) {
    onProgress?.("done", `${entry.label} model already loaded`);
    return true;
  }

  // Dispose previous model to free RAM (2 GB limit)
  await disposeModel(onProgress);

  onProgress?.("loading-model", `Loading ${entry.label} model (${entry.modelId})…`);

  const transformers = await getTransformers();
  const { env, pipeline } = transformers;

  // ── Force WASM backend, single thread ──
  env.allowRemoteModels = true;
  env.allowLocalModels = false;

  // Configure WASM for low-end devices (2 GB RAM constraint). The
  // `env.backends.onnx.wasm` object is created lazily by the library, so we
  // create it explicitly to guarantee numThreads = 1 is applied everywhere.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const backends = (env.backends ?? {}) as Record<string, any>;
  const onnxBackend = (backends.onnx ?? {}) as Record<string, any>;
  const wasmConfig = (onnxBackend.wasm ?? {}) as Record<string, any>;
  wasmConfig.numThreads = 1;
  onnxBackend.wasm = wasmConfig;
  backends.onnx = onnxBackend;
  env.backends = backends;

  try {
    activePipeline = await pipeline("translation", entry.modelId, {
      // Quantized models are smaller and faster on CPU
      quantized: true,
    });
    activeLangCode = langCode;
    onProgress?.("done", `${entry.label} model loaded`);
    return true;
  } catch (err) {
    console.error(`Failed to load model ${entry.modelId}:`, err);
    onProgress?.("fallback", `Model load failed for ${entry.label}; using glossary simulation`);
    activePipeline = null;
    activeLangCode = null;
    return false;
  }
}

/**
 * Translate a chunk of English text using the loaded neural model.
 * Returns the translated text, or null if no model is loaded.
 */
export async function translateChunk(
  text: string,
  langCode: string,
  onProgress?: NeuralProgressCallback
): Promise<string | null> {
  if (!activePipeline || activeLangCode !== langCode) {
    return null;
  }

  if (!text.trim()) return "";

  onProgress?.("translating", `Neural translation → ${MODEL_REGISTRY[langCode]?.label || langCode}`);

  try {
    // Opus-MT models have a max input of ~512 tokens.
    // Split long text into sentences and translate in batches.
    const sentences = splitIntoSentences(text);
    const translatedParts: string[] = [];

    // Process sentences in groups of ~100 words to stay under token limit
    let currentBatch: string[] = [];
    let batchWordCount = 0;

    for (const sentence of sentences) {
      const sentenceWords = sentence.split(/\s+/).filter(Boolean).length;

      if (batchWordCount + sentenceWords > 200 && currentBatch.length > 0) {
        // Translate current batch
        const batchText = currentBatch.join(" ");
        const result = await activePipeline(batchText, {
          // Ensure we don't exceed model max length
          max_length: 512,
        });
        translatedParts.push(result[0]?.translation_text || batchText);
        currentBatch = [];
        batchWordCount = 0;
      }

      currentBatch.push(sentence);
      batchWordCount += sentenceWords;
    }

    // Translate remaining batch
    if (currentBatch.length > 0) {
      const batchText = currentBatch.join(" ");
      const result = await activePipeline(batchText, {
        max_length: 512,
      });
      translatedParts.push(result[0]?.translation_text || batchText);
    }

    return translatedParts.join(" ");
  } catch (err) {
    console.error("Neural translation error:", err);
    onProgress?.("fallback", "Neural translation failed; partial results may be used");
    return null;
  }
}

/**
 * Dispose the currently loaded model to free memory.
 * Must be called before loading a different language's model.
 */
export async function disposeModel(
  onProgress?: NeuralProgressCallback
): Promise<void> {
  if (activePipeline) {
    onProgress?.("disposing", `Disposing ${MODEL_REGISTRY[activeLangCode || ""]?.label || "previous"} model…`);
    try {
      await activePipeline.dispose();
    } catch {
      // Disposal is best-effort
    }
    activePipeline = null;
    activeLangCode = null;

    // Force garbage collection hint (not guaranteed but helps in some runtimes)
    if (typeof globalThis !== "undefined" && "gc" in globalThis) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).gc();
      } catch {
        // Ignore
      }
    }
  }
}

/**
 * Get the current state for debugging / UI display.
 */
export function getModelState(): { loaded: boolean; langCode: string | null; label: string | null } {
  return {
    loaded: !!activePipeline,
    langCode: activeLangCode,
    label: activeLangCode ? MODEL_REGISTRY[activeLangCode]?.label ?? null : null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Split text into sentences, respecting common abbreviations and quoted speech.
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end-of-string.
  // Preserve quotation marks and em-dashes as part of sentences.
  const raw = text.split(/(?<=[.!?…]["'」』""''）)]*)\s+/);
  // Merge very short fragments (abbreviations) with the next sentence
  const merged: string[] = [];
  for (const part of raw) {
    if (!part.trim()) continue;
    if (merged.length > 0 && part.trim().length < 5 && !/[.!?]$/.test(part.trim())) {
      merged[merged.length - 1] += " " + part;
    } else {
      merged.push(part.trim());
    }
  }
  return merged.filter(Boolean);
}
