import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Languages,
  Loader2,
  FileUp,
  X,
  Package,
  CheckCircle2,
  XCircle,
  Globe,
  AlertCircle,
  Upload,
  RotateCcw,
  ChevronRight,
  BookOpen,
  Image,
  FileDown,
  CheckCheck,
  Copy,
  Check,
  FlaskConical,
  ListChecks,
} from "lucide-react";
// Convex hooks imported below with storage replacement
import {
  runLocalizedTranslationPipeline,
  prepareLanguageModel,
  releaseLanguageModel,
  generateSampleText,
  type TranslationMode,
} from "@/lib/translator/engine";
import type { QAReport } from "@/lib/translator/qa";
import type { NeuralProgressCallback } from "@/lib/translator/neural";
import {
  runBaselineTests,
  type BaselineSummary,
} from "@/lib/translator/baseline";
import {
  parsePDFHeader,
  parsePDFBatch,
  validateTextForTranslation,
  PARSE_BATCH_SIZE,
  type PDFParseError,
  type PDFPageData,
  getPDFJS,
} from "@/lib/translator/pdfParser";
import {
  generateTranslatedPDF,
  type PDFGenerationProgress,
} from "@/lib/translator/pdfGenerator";
import {
  mergeChunkTexts,
  chunkPageTexts,
  type TranslationChunk,
} from "@/lib/translator/storage";
import { useQuery, useMutation, useAction } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";

const targetLanguages = [
  { code: "ur", name: "Urdu", nativeName: "اردو", script: "Arabic" },
  { code: "ar", name: "Arabic", nativeName: "العربية", script: "Arabic" },
  { code: "fr", name: "French", nativeName: "Français", script: "Latin" },
  { code: "ja", name: "Japanese", nativeName: "日本語", script: "Japanese" },
  { code: "es", name: "Spanish", nativeName: "Español", script: "Latin" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", script: "Devanagari" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", script: "Latin" },
  { code: "zh", name: "Chinese", nativeName: "中文", script: "Chinese" },
  { code: "ru", name: "Russian", nativeName: "Русский", script: "Cyrillic" },
  { code: "ko", name: "Korean", nativeName: "한국어", script: "Hangul" },
  { code: "de", name: "German", nativeName: "Deutsch", script: "Latin" },
  { code: "ks", name: "Kashmiri", nativeName: "कॉशुर", script: "Arabic" },
  { code: "ro", name: "Romanian", nativeName: "Română", script: "Latin" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili", script: "Latin" },
  { code: "it", name: "Italian", nativeName: "Italiano", script: "Latin" },
  { code: "la", name: "Latin", nativeName: "Latina", script: "Latin" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", script: "Latin" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली", script: "Devanagari" },
  { code: "bn", name: "Bangla", nativeName: "বাংলা", script: "Bengali" },
  { code: "pt", name: "Portuguese", nativeName: "Português", script: "Latin" },
];

interface CompletedLanguage {
  index: number;
  code: string;
  name: string;
  nativeName: string;
  translatedText: string;
  pdfBlob?: Blob;
  qaReport?: QAReport;
  mode?: TranslationMode;
}

export default function Translator() {
  // ─── Convex server-side AI action ───
  const translateChunkAction = useAction(api.translate.translateChunk);
  const storePdfAction = useAction(api.upload.storePdf);

  // ─── Convex database state ───
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);
  const createProjectMutation = useMutation(api.mutations.createProject);
  const deleteProjectMutation = useMutation(api.mutations.deleteProject);
  const upsertChunkMutation = useMutation(api.mutations.upsertChunk);
  const updateChunkMutation = useMutation(api.mutations.updateChunk);
  const upsertTranslationMutation = useMutation(api.mutations.upsertTranslation);
  const updateTranslationMutation = useMutation(api.mutations.updateTranslation);
  const deleteChunksForLangMutation = useMutation(api.mutations.deleteChunksForLang);

  // ─── Convex reactive subscriptions ───
  const latestProject = useQuery(api.queries.getLatestProject);
  const convexProject = useQuery(
    api.queries.getProject,
    projectId ? { projectId } : "skip"
  );
  const convexTranslations = useQuery(
    api.queries.getProjectTranslations,
    projectId ? { projectId } : "skip"
  );

  // ─── Source state ───
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [pageData, setPageData] = useState<PDFPageData[]>([]);
  const [originalPageTexts, setOriginalPageTexts] = useState<string[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [originalArrayBuffer, setOriginalArrayBuffer] = useState<ArrayBuffer | null>(null);

  // ─── Upload state ───
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ current: number; total: number } | null>(null);
  const [parsePhase, setParsePhase] = useState<"idle" | "loading" | "parsing" | "done">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Translation flow ───
  const [currentLanguageIndex, setCurrentLanguageIndex] = useState<number>(-1);
  const [isTranslating, setIsTranslating] = useState(false);
  const [currentTranslation, setCurrentTranslation] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [completedLanguages, setCompletedLanguages] = useState<CompletedLanguage[]>([]);
  const [flowPhase, setFlowPhase] = useState<
    "idle" | "translating" | "translation-done" | "generating-pdf" | "all-complete"
  >("idle");
  const [translationProgress, setTranslationProgress] = useState<{
    current: number;
    total: number;
    phase: string;
  } | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  // ─── PDF generation ───
  const [pdfProgress, setPdfProgress] = useState<PDFGenerationProgress | null>(null);
  const [currentPdfBlob, setCurrentPdfBlob] = useState<Blob | null>(null);

  // ─── Neural model state ───
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [isNeural, setIsNeural] = useState(false);

  // ─── 23-phase Gemini QA state ───
  const [currentQaReport, setCurrentQaReport] = useState<QAReport | null>(null);
  const [translationMode, setTranslationMode] = useState<TranslationMode | null>(null);
  const [translationModel, setTranslationModel] = useState<string | null>(null);
  const [translationUsage, setTranslationUsage] = useState<{
    credits?: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  } | null>(null);
  const [showAllQaPhases, setShowAllQaPhases] = useState(false);

  // ─── Baseline test state (Part 2 of the 23-phase spec) ───
  const [baselineSummary, setBaselineSummary] = useState<BaselineSummary | null>(null);
  const [baselineRunning, setBaselineRunning] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);

  // ─── Target market context (P6/P7/P13/P14 sensitivity filters) ───
  const [marketContext, setMarketContext] = useState<
    "standard" | "high-censorship" | "romance-focused" | "conservative"
  >("standard");

  // ─── ZIP ───
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  // ─── Resume state ───
  const [hasSavedProgress, setHasSavedProgress] = useState(false);
  const [savedFileName, setSavedFileName] = useState<string | null>(null);

  // ─── Persistence warnings ───
  const [dbWarning, setDbWarning] = useState<string | null>(null);

  // ─── Check for saved progress on mount via Convex ───
  useEffect(() => {
    if (latestProject && latestProject.parsedPages > 0) {
      setHasSavedProgress(true);
      setSavedFileName(latestProject.fileName);
      setProjectId(latestProject._id);
    }
  }, [latestProject]);

  // ─── Convex connectivity check ───
  useEffect(() => {
    // Convex is always available if the app loads — no local DB health check needed
  }, []);


  // ─── Resume saved progress from Convex ───
  const handleResume = useCallback(async () => {
    try {
      if (!latestProject) {
        setHasSavedProgress(false);
        return;
      }

      setIsUploading(true);
      setUploadError(null);
      setParsePhase("loading");
      setParseProgress({ current: latestProject.parsedPages, total: latestProject.pageCount });

      // Restore project state from Convex
      setSourceText(latestProject.fullText);
      setPdfFileName(latestProject.fileName);
      setPdfPageCount(latestProject.pageCount);
      setPdfWarnings([]);
      setPageData(latestProject.pageData);
      setOriginalPageTexts(latestProject.pageData.map((p: any) => p.text));
      setOriginalArrayBuffer(null);
      setProjectId(latestProject._id);

      // Load saved translations from Convex
      if (convexTranslations && convexTranslations.length > 0) {
        const completed: CompletedLanguage[] = [];
        for (const lang of targetLanguages) {
          const translation = convexTranslations.find((t) => t.langCode === lang.code);
          if (translation?.status === "complete" && translation.mergedText) {
            completed.push({
              index: targetLanguages.indexOf(lang),
              code: lang.code,
              name: lang.name,
              nativeName: lang.nativeName,
              translatedText: translation.mergedText,
            });
          }
        }

        if (completed.length > 0) {
          setCompletedLanguages(completed);
          if (completed.length >= targetLanguages.length) {
            setFlowPhase("all-complete");
            setCurrentLanguageIndex(targetLanguages.length);
          } else {
            setFlowPhase("idle");
            setCurrentLanguageIndex(-1);
          }
        } else {
          setFlowPhase("idle");
          setCurrentLanguageIndex(-1);
        }
      } else {
        setFlowPhase("idle");
        setCurrentLanguageIndex(-1);
      }

      setParsePhase("done");
      setParseProgress(null);
      setIsUploading(false);
      setHasSavedProgress(false);
    } catch (err) {
      console.error("Failed to resume:", err);
      setUploadError("Failed to resume saved progress. Starting fresh.");
      setHasSavedProgress(false);
      setIsUploading(false);
    }
  }, [latestProject, convexTranslations]);

  // ─── PDF Upload (chunked) ───
  const handleFileSelect = useCallback(async (file: File | null) => {
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setParseProgress(null);
    setParsePhase("loading");
    resetFlow();
    // Discard any previous saved progress when uploading a new file
    if (projectId) {
      await deleteProjectMutation({ projectId }).catch(() => {});
    }
    setHasSavedProgress(false);

    try {
      // Step 1: Parse header (fast — no page processing)
      const header = await parsePDFHeader(file);

      setPdfFileName(file.name);
      setPdfPageCount(header.totalPages);
      setOriginalArrayBuffer(header.arrayBuffer);

      setParsePhase("parsing");
      setParseProgress({ current: 0, total: header.totalPages });

      // Step 2: Parse pages in batches of PARSE_BATCH_SIZE
      const allPageData: PDFPageData[] = [];
      const allPageTexts: string[] = [];

      for (
        let batchStart = 1;
        batchStart <= header.totalPages;
        batchStart += PARSE_BATCH_SIZE
      ) {
        const batchEnd = Math.min(batchStart + PARSE_BATCH_SIZE - 1, header.totalPages);
        const batchResults = await parsePDFBatch(header.pdf, batchStart, batchEnd);

        for (const result of batchResults) {
          allPageData.push(result);
          allPageTexts.push(result.text);
        }

        allPageData.sort((a, b) => a.num - b.num);

        const incrementalText = allPageTexts.filter(Boolean).join("\n\n").trim();

        setParseProgress({ current: batchEnd, total: header.totalPages });
        setPageData([...allPageData]);
        setOriginalPageTexts([...allPageTexts]);
        setSourceText(incrementalText);
      }

      // Final text
      const fullText = allPageTexts.filter(Boolean).join("\n\n").trim();
      setSourceText(fullText);

      // Update warnings
      const warnings: string[] = [];
      const pagesWithText = allPageTexts.filter((t) => t.length > 10).length;
      if (fullText.length < 10) {
        setUploadError(
          "The PDF does not contain extractable text. It may be a scanned/image-based PDF."
        );
        setIsUploading(false);
        setParsePhase("idle");
        return;
      }
      if (pagesWithText < header.totalPages * 0.3 && header.totalPages > 5) {
        warnings.push(
          `Only ${pagesWithText} of ${header.totalPages} pages contain extractable text.`
        );
      }
      setPdfWarnings(warnings);

      // Upload PDF to Convex File Storage
      const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        return btoa(binary);
      };

      const pdfBase64 = arrayBufferToBase64(header.arrayBuffer);
      setParsePhase("parsing");
      setParseProgress({ current: header.totalPages, total: header.totalPages });

      const { storageId } = await storePdfAction({
        fileName: file.name,
        pdfBase64,
      });

      // Create project record in Convex DB
      const newProjectId = await createProjectMutation({
        fileName: file.name,
        pageCount: header.totalPages,
        wordCount: fullText.split(/\s+/).filter(Boolean).length,
        pdfStorageId: storageId,
        pageData: allPageData,
        fullText,
        parsedPages: header.totalPages,
        status: "ready",
      });

      setProjectId(newProjectId);

      const validation = validateTextForTranslation(fullText);
      if (!validation.valid) {
        setUploadError(validation.errors.join(" "));
      }

      setParsePhase("done");
      setParseProgress(null);
    } catch (err) {
      const pdfError = err as PDFParseError;
      setUploadError(pdfError.message || "Failed to parse PDF.");
      setParseProgress(null);
      setParsePhase("idle");
    } finally {
      setIsUploading(false);
    }
  }, [projectId, deleteProjectMutation, storePdfAction, createProjectMutation]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFileSelect(e.dataTransfer.files[0]);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // ─── Export / Import Progress ───
  const handleExportProgress = useCallback(async () => {
    // With Convex, data is stored server-side — export is a no-op placeholder
    // Future: export project data as JSON from Convex queries
  }, []);
  const handleImportProgress = useCallback(async () => {
    // With Convex, data is stored server-side — import is a no-op placeholder
    // Future: import project data into Convex from a JSON file
  }, []);
  const clearSource = useCallback(async () => {
    if (projectId) {
      await deleteProjectMutation({ projectId }).catch(() => {});
    }
    setProjectId(null);
    setSourceText("");
    setPdfFileName(null);
    setPdfPageCount(null);
    setPdfWarnings([]);
    setUploadError(null);
    setOriginalArrayBuffer(null);
    setPageData([]);
    setOriginalPageTexts([]);
    setParsePhase("idle");
    setHasSavedProgress(false);
    resetFlow();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [projectId, deleteProjectMutation]);

  const loadSample = useCallback(() => {
    setSourceText(generateSampleText());
    setPdfFileName(null);
    setPdfPageCount(null);
    setPdfWarnings([]);
    setUploadError(null);
    setOriginalArrayBuffer(null);
    setPageData([]);
    setOriginalPageTexts([]);
    setParsePhase("done");
    resetFlow();
  }, []);

  const handleRunBaseline = useCallback(() => {
    setBaselineRunning(true);
    // Defer so the button spinner paints before the (sync) QA pass runs
    window.setTimeout(() => {
      try {
        setBaselineSummary(runBaselineTests());
      } finally {
        setBaselineRunning(false);
      }
    }, 30);
  }, []);

  const resetFlow = useCallback(() => {
    setCurrentLanguageIndex(-1);
    setIsTranslating(false);
    setCurrentTranslation(null);
    setTranslationError(null);
    setCompletedLanguages([]);
    setFlowPhase("idle");
    setPdfProgress(null);
    setCurrentPdfBlob(null);
    setTranslationProgress(null);
    setCurrentQaReport(null);
    setTranslationMode(null);
  }, []);

  // ─── Cleanup model on unmount ───
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      releaseLanguageModel().catch(() => {});
    };
  }, []);

  // ─── Step-by-Step Translation ───

  const startTranslation = useCallback(async () => {
    if (!sourceText.trim() || currentLanguageIndex >= 0) return;
    await translateCurrentLanguage(0);
  }, [sourceText, currentLanguageIndex]);

  const translateCurrentLanguage = useCallback(
    async (langIndex: number, force = false) => {
      // Skip languages already completed in this session (e.g. restored after
      // a resume) so they are never re-translated or added twice to the list.
      // With force=true (retranslate) the skip is bypassed on purpose.
      const completedCodes = new Set(completedLanguages.map((c) => c.code));
      while (
        langIndex < targetLanguages.length &&
        completedCodes.has(targetLanguages[langIndex].code) &&
        !force
      ) {
        langIndex++;
      }

      if (langIndex >= targetLanguages.length) {
        setFlowPhase("all-complete");
        return;
      }

      setIsTranslating(true);
      setFlowPhase("translating");
      setCurrentLanguageIndex(langIndex);
      setTranslationError(null);
      setCurrentPdfBlob(null);
      setTranslationModel(null);
      setTranslationUsage(null);

      const lang = targetLanguages[langIndex];

      try {
        // ── Load neural model for this language ──
        const neuralAvailable = await prepareLanguageModel(
          lang.code,
          (phase, msg) => {
            setModelStatus(msg);
          }
        );
        setIsNeural(neuralAvailable);
        setModelStatus(null);

        // A forced retranslate wipes the old saved chunks + cached PDF first
        // so the new run starts fresh from chunk 0.
        if (force) {
          await deleteChunksForLangMutation({ projectId: projectId!, langCode: lang.code }).catch(() => {});
        }

        // Check if we already have saved translations for this language
        const saved = convexTranslations?.find((t) => t.langCode === lang.code);

        if (!force && saved?.status === "complete" && saved.mergedText) {
          // Use saved translation
          setCurrentTranslation(saved.mergedText);
          setCurrentQaReport(null);
          setTranslationMode(null);
          setTranslationModel(null);
          setTranslationUsage(null);
          setTranslationProgress({
            current: saved.totalChunks,
            total: saved.totalChunks,
            phase: "Complete (restored from save)",
          });
        } else {
          // Translate in chunks
          const pageTexts = originalPageTexts.length > 0
            ? originalPageTexts
            : sourceText.split("\n\n");

          const pageRanges = chunkPageTexts(pageTexts, 2000);
          const totalChunks = pageRanges.length;
          const chunks: TranslationChunk[] = [];
          let mergedText = "";
          let slidingContext: string | undefined = undefined;

          // Helper: extract last 2 sentences from translated text for P21 sliding window
          const extractLastSentences = (text: string): string => {
            // Split on sentence-ending punctuation (handles English . ! ? and Urdu ؟ !)
            const sentences = text.split(/(?<=[.!?؟])\s+/).filter(Boolean);
            return sentences.slice(-2).join(" ");
          };

          // Determine starting chunk (always start from 0 with Convex)
          let startChunk = 0;

          for (let ci = startChunk; ci < totalChunks; ci++) {
            const range = pageRanges[ci];
            setTranslationProgress({
              current: ci,
              total: totalChunks,
              phase: `Translating pages ${range.pageStart + 1}-${range.pageEnd + 1}`,
            });

            // Combine text for this chunk
            const chunkText = pageTexts
              .slice(range.pageStart, range.pageEnd + 1)
              .join("\n\n");

            // Primary engine: Gemini AI with 23-phase prompt.
            // Glossary Mode as automatic fallback. QA runs after every chunk.
            const result = await runLocalizedTranslationPipeline(
              {
                sourceText: chunkText,
                targetLanguage: lang.code,
                marketContext,
                chapterNumber: 1,
                previousContext: slidingContext,
              },
              (phase, msg) => {
                setTranslationProgress((prev) => prev ? { ...prev, phase: msg } : null);
              },
              // Server-side AI via Convex action (Gemini, server-side keys)
              async ({ text, langCode, marketContext: mc, previousContext: pc }) => {
                const res = await translateChunkAction({
                  text,
                  langCode,
                  marketContext: mc,
                  previousContext: pc,
                });
                return {
                  ok: res.ok,
                  text: res.text,
                  model: res.model,
                  usage: res.usage
                    ? {
                        promptTokens: res.usage.promptTokens ?? undefined,
                        completionTokens: res.usage.completionTokens ?? undefined,
                        totalTokens: res.usage.totalTokens ?? undefined,
                      }
                    : undefined,
                };
              }
            );

            const chunk: TranslationChunk = {
              langCode: lang.code,
              langName: lang.name,
              langNativeName: lang.nativeName,
              translatedText: result.translatedText,
              pageStart: range.pageStart,
              pageEnd: range.pageEnd,
              chunkIndex: ci,
              complete: true,
            };

            chunks.push(chunk);

            // P21: Update sliding window context for next chunk
            slidingContext = extractLastSentences(result.translatedText);

            // Save to Convex DB after each chunk
            const merged = mergeChunkTexts(chunks);
            mergedText = merged;
            if (projectId) {
              // Upsert chunk record
              const chunkId = await upsertChunkMutation({
                projectId,
                langCode: lang.code,
                chunkIndex: ci,
                sourceText: chunkText,
              });
              await updateChunkMutation({
                chunkId,
                translatedText: result.translatedText,
                status: "done",
                model: result.model,
                usage: result.usage,
              });
              // Upsert or update translation record
              const translationId = await upsertTranslationMutation({
                projectId,
                langCode: lang.code,
                totalChunks,
              });
              await updateTranslationMutation({
                translationId,
                status: ci === totalChunks - 1 ? "complete" : "in_progress",
                completedChunks: ci + 1,
                mergedText: merged,
                ...(ci === totalChunks - 1 ? { completedAt: Date.now() } : {}),
              });
            }

            // Cache the latest QA report so refresh never loses it
            if (result.qaReport) {
              setCurrentQaReport(result.qaReport);
              setTranslationMode(result.mode ?? (neuralAvailable ? "neural" : "glossary"));
              setTranslationModel(result.model ?? null);
              setTranslationUsage(result.usage ?? null);
              // QA report stored in React state (Convex doesn't store QA reports)
            }

            setTranslationProgress({
              current: ci + 1,
              total: totalChunks,
              phase: `Chunk ${ci + 1}/${totalChunks} saved`,
            });
          }

          setCurrentTranslation(mergedText);
        }

        // Dispose model to free memory before next language
        await releaseLanguageModel();

        setFlowPhase("translation-done");
      } catch (error) {
        // Always release model on error
        await releaseLanguageModel();
        setTranslationError(
          error instanceof Error ? error.message : "Translation failed"
        );
        setFlowPhase("translation-done");
      } finally {
        setIsTranslating(false);
        setModelStatus(null);
      }
    },
    [sourceText, originalPageTexts, completedLanguages, marketContext, projectId, convexTranslations, deleteChunksForLangMutation, upsertChunkMutation, updateChunkMutation, upsertTranslationMutation, updateTranslationMutation, translateChunkAction]
  );

  const handleContinue = useCallback(async () => {
    // Save current translation to completed list
    if (currentTranslation && currentLanguageIndex >= 0) {
      const lang = targetLanguages[currentLanguageIndex];
      setCompletedLanguages((prev) => [
        ...prev,
        {
          index: currentLanguageIndex,
          code: lang.code,
          name: lang.name,
          nativeName: lang.nativeName,
          translatedText: currentTranslation,
          pdfBlob: currentPdfBlob || undefined,
          qaReport: currentQaReport || undefined,
          mode: translationMode || undefined,
        },
      ]);
    }

    setCurrentTranslation(null);
    setCurrentPdfBlob(null);
    setPdfProgress(null);
    setTranslationProgress(null);
    setCurrentQaReport(null);
    setTranslationMode(null);
    setTranslationModel(null);
    setTranslationUsage(null);

    const nextIndex = currentLanguageIndex + 1;
    if (nextIndex >= targetLanguages.length) {
      setFlowPhase("all-complete");
      setCurrentLanguageIndex(targetLanguages.length);
    } else {
      await translateCurrentLanguage(nextIndex);
    }
  }, [currentTranslation, currentLanguageIndex, currentPdfBlob, currentQaReport, translationMode, translateCurrentLanguage]);

  // ─── Retranslate an already-completed language from the original source ───

  const handleRetranslate = useCallback(
    async (langCode: string) => {
      if (isTranslating) return;

      // Case 1: Language is in completedLanguages (sidebar Retranslate button)
      const completedTarget = completedLanguages.find((c) => c.code === langCode);
      if (completedTarget) {
        // Drop it from the completed list so it can be re-added on Continue
        setCompletedLanguages((prev) =>
          prev.filter((c) => c.code !== langCode)
        );

        // Clear the current-view state so the old result disappears
        setCurrentTranslation(null);
        setCurrentPdfBlob(null);
        setPdfProgress(null);
        setTranslationProgress(null);
        setTranslationError(null);
        setCurrentQaReport(null);
        setTranslationMode(null);
        setTranslationModel(null);
        setTranslationUsage(null);

        await translateCurrentLanguage(completedTarget.index, true);
        return;
      }

      // Case 2: Language is the current language in preview panel (translation-done phase,
      // but not yet added to completedLanguages — user hasn't clicked Continue yet)
      const currentIdx = targetLanguages.findIndex((t) => t.code === langCode);
      if (currentIdx >= 0) {
        // Clear the current-view state
        setCurrentTranslation(null);
        setCurrentPdfBlob(null);
        setPdfProgress(null);
        setTranslationProgress(null);
        setTranslationError(null);
        setCurrentQaReport(null);
        setTranslationMode(null);
        setTranslationModel(null);
        setTranslationUsage(null);

        await translateCurrentLanguage(currentIdx, true);
        return;
      }
    },
    [completedLanguages, isTranslating, translateCurrentLanguage, targetLanguages]
  );

  // ─── Copy current translation to clipboard ───

  const handleCopyTranslation = useCallback(async () => {
    if (!currentTranslation) return;
    // Clipboard has size limits; copy only the first 10,000 words.
    const words = currentTranslation.trim().split(/\s+/);
    const copyText =
      words.length > 10000 ? words.slice(0, 10000).join(" ") : currentTranslation;
    try {
      await navigator.clipboard.writeText(copyText);
    } catch {
      // Fallback for older browsers / non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = copyText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedPreview(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedPreview(false);
    }, 2000);
  }, [currentTranslation]);

  // ─── PDF Generation ───

  const handleDownloadPDF = useCallback(async () => {
    if (!currentTranslation || !originalArrayBuffer || !pageData.length || !originalPageTexts.length)
      return;

    setFlowPhase("generating-pdf");
    setPdfProgress(null);
    const lang = targetLanguages[currentLanguageIndex];

    try {
      const blob = await generateTranslatedPDF(
        originalArrayBuffer,
        pageData,
        originalPageTexts,
        currentTranslation,
        lang.code,
        (progress) => {
          setPdfProgress({ ...progress });
        }
      );

      setCurrentPdfBlob(blob);

      // PDF blob is cached in React state for the current session
      // Convex stores the original PDF; translated PDFs are generated on demand

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = pdfFileName
        ? pdfFileName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")
        : "translation";
      a.download = `${safeName}_${lang.code}_${lang.name.toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      setFlowPhase("translation-done");
      setPdfProgress(null);
    } catch (error) {
      console.error("PDF generation failed:", error);
      setTranslationError(
        error instanceof Error ? error.message : "PDF generation failed"
      );
      setFlowPhase("translation-done");
    }
  }, [
    currentTranslation,
    originalArrayBuffer,
    pageData,
    originalPageTexts,
    currentLanguageIndex,
    pdfFileName,
  ]);

  // ─── ZIP Download ───

  const handleDownloadAllZIP = useCallback(async () => {
    const allCompleted = [
      ...completedLanguages,
      ...(currentTranslation &&
      currentLanguageIndex >= 0 &&
      currentLanguageIndex < targetLanguages.length
        ? [
            {
              index: currentLanguageIndex,
              code: targetLanguages[currentLanguageIndex].code,
              name: targetLanguages[currentLanguageIndex].name,
              nativeName: targetLanguages[currentLanguageIndex].nativeName,
              translatedText: currentTranslation,
              pdfBlob: currentPdfBlob || undefined,
            },
          ]
        : []),
    ];

    if (allCompleted.length === 0) return;

    setIsDownloadingZip(true);

    try {
      // Lazy-load JSZip only when the user clicks "Download All ZIP" — keeps
      // the ~100KB library out of the initial page load.
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folderName = pdfFileName
        ? pdfFileName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")
        : "onyx_translate_all";
      const folder = zip.folder(folderName) || zip;

      for (const completed of allCompleted) {
        const langCode = completed.code;
        const langName = completed.name;

        folder.file(
          `translated_${langCode}_${langName.toLowerCase().replace(/\s+/g, "_")}.txt`,
          completed.translatedText
        );

        // 1) Use the blob already in memory
        // 2) Regenerate if needed (worker makes this fast)
        let pdfBlob: Blob | null | undefined = completed.pdfBlob;
        if (
          !pdfBlob &&
          originalArrayBuffer &&
          pageData.length &&
          originalPageTexts.length
        ) {
          try {
            pdfBlob = await generateTranslatedPDF(
              originalArrayBuffer,
              pageData,
              originalPageTexts,
              completed.translatedText,
              langCode,
              () => {}
            );
          } catch {
            // PDF generation failed, include text only
          }
        }
        if (pdfBlob) {
          folder.file(`${folderName}_${langCode}.pdf`, pdfBlob);
        }
      }

      const summary = [
        "Onyx Translate - Complete Batch Report",
        "=".repeat(50),
        `Source: ${pdfFileName || "Text input"}`,
        `Pages: ${pdfPageCount || "N/A"}`,
        `Words: ${sourceText.split(/\s+/).filter(Boolean).length.toLocaleString()}`,
        `Languages: ${allCompleted.length} of ${targetLanguages.length}`,
        `Date: ${new Date().toISOString()}`,
        "",
        "Completed Languages:",
        ...allCompleted.map((c) => {
          const lang = targetLanguages[c.index];
          return `  [${c.index + 1}/${targetLanguages.length}] ${c.name} (${c.code}) - ${lang?.script || ""}${c.pdfBlob ? " ✓ PDF" : " ✓ Text"}`;
        }),
        "",
        "Generated by Onyx Translate",
      ];
      folder.file("REPORT.txt", summary.join("\n"));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folderName}_all_${allCompleted.length}_languages.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("ZIP download failed:", error);
    } finally {
      setIsDownloadingZip(false);
    }
  }, [
    completedLanguages,
    currentTranslation,
    currentLanguageIndex,
    currentPdfBlob,
    originalArrayBuffer,
    pageData,
    originalPageTexts,
    pdfFileName,
    pdfPageCount,
    sourceText,
  ]);

  // ─── Helpers ───

  // Compute word count from whatever text source is available.
  // During PDF upload, sourceText may not be set yet, so fall back to pageTexts.
  const wordCount = (() => {
    if (sourceText.trim()) {
      return sourceText.split(/\s+/).filter((w) => w.length > 0).length;
    }
    if (originalPageTexts.length > 0) {
      return originalPageTexts
        .join(" ")
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
    }
    return 0;
  })();
  const currentLang =
    currentLanguageIndex >= 0 && currentLanguageIndex < targetLanguages.length
      ? targetLanguages[currentLanguageIndex]
      : null;
  const nextLangIndex = currentLanguageIndex >= 0 ? currentLanguageIndex + 1 : 0;
  const nextLang =
    nextLangIndex < targetLanguages.length ? targetLanguages[nextLangIndex] : null;

  // ─── Render ───

  return (
    <div className="min-h-screen bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl" style={{ background: 'rgba(6,6,14,0.85)', borderBottom: '1px solid rgba(0,229,255,0.10)' }}>
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg neon-glow flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00e5ff, #a78bfa)' }}>
              <Languages className="size-4 text-primary-foreground" />
            </div>
            <div>
              <span className="text-base font-semibold tracking-tight">
                Onyx Translate
              </span>
              <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">
                PDF Localization Tool
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]" style={{ borderColor: 'rgba(0,229,255,0.3)' }}>
              Images Preserved
            </Badge>
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: 'rgba(0,229,255,0.3)', color: '#00e5ff' }}>
              {targetLanguages.length} Languages
            </Badge>
            <div className="flex items-center gap-1 ml-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[9px] px-1.5 sm:text-[10px]"
                onClick={handleExportProgress}
                title="Export saved progress to a file — use this to move work between the preview and the published site"
              >
                <FileUp className="size-3 mr-1" /> Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[9px] px-1.5 sm:text-[10px]"
                onClick={handleImportProgress}
                title="Import a progress file to resume your work here"
              >
                <FileDown className="size-3 mr-1" /> Import
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-6">
        {dbWarning && (
          <div className="mb-4 flex items-center justify-between p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/20 text-[11px]">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-3.5 text-yellow-500 shrink-0" />
              <span>{dbWarning}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={handleExportProgress}>
                Export Now
              </Button>
              <Button variant="ghost" size="sm" className="h-6 text-[9px]" onClick={() => setDbWarning(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          {/* Left Panel */}
          <div className="space-y-4">
            {/* Step 1: Upload */}
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="size-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 neon-glow" style={{ background: 'linear-gradient(135deg, #00e5ff, #a78bfa)', color: '#06060e' }}>
                    1
                  </span>
                  <span className="text-xs font-semibold">Upload English PDF</span>
                  {pdfFileName && (
                    <CheckCircle2 className="size-3.5 ml-auto" style={{ color: '#00e5ff' }} />
                  )}
                </div>
              </div>
              <div className="p-3 space-y-3">
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => !isUploading && fileInputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                    isDragOver
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/30"
                  } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
                >
                  {isUploading ? (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="size-6 text-primary animate-spin" />
                      <span className="text-xs text-muted-foreground">
                        {parsePhase === "loading"
                          ? "Loading PDF..."
                          : parseProgress && parseProgress.total > 0
                            ? `Parsing page ${parseProgress.current} of ${parseProgress.total}...`
                            : "Preparing..."}
                      </span>
                      {parseProgress && parseProgress.total > 0 && (
                        <div className="w-40 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-200"
                            style={{
                              width: `${Math.min((parseProgress.current / parseProgress.total) * 100, 100)}%`,
                            }}
                          />
                        </div>
                      )}
                      {parseProgress && parseProgress.total > 0 && (
                        <span className="text-[10px] text-muted-foreground/70">
                          {parseProgress.current} / {parseProgress.total} pages
                        </span>
                      )}
                    </div>
                  ) : pdfFileName ? (
                    <>
                      <div className="size-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(0,229,255,0.1)' }}>
                        <FileUp className="size-5" style={{ color: '#00e5ff' }} />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium">{pdfFileName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {pdfPageCount} pages • {wordCount.toLocaleString()} words
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearSource();
                          }}
                        >
                          <X className="size-3 mr-1" /> Remove
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload className="size-6 text-muted-foreground/40" />
                      <p className="text-xs font-medium">
                        Drop PDF here or click to browse
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        All images preserved in output PDFs
                      </p>
                    </>
                  )}
                </div>

                {uploadError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-[11px]">
                    <AlertCircle className="size-3.5 text-yellow-500 shrink-0 mt-0.5" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {pdfWarnings.length > 0 && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[11px]">
                    <Image className="size-3.5 text-blue-500 shrink-0 mt-0.5" />
                    <div className="text-[10px]">
                      {pdfWarnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Transfer progress between preview and published site */}
                {!hasSavedProgress && !isUploading && !pdfFileName && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[11px]">
                      <Globe className="size-3.5 text-blue-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-blue-600">
                          Uploaded in the Freebuff preview?
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Work is saved only in the tab where you uploaded it. To
                          continue on the published site,{" "}
                          <strong>Export</strong> a progress file here, then{" "}
                          <strong>Import</strong> it on{" "}
                          <strong>oyxtranslate.freebuff.app</strong>.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleExportProgress}
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-[11px]"
                      >
                        <FileUp className="size-3 mr-1" /> Export Progress
                      </Button>
                      <Button
                        onClick={handleImportProgress}
                        variant="outline"
                        size="sm"
                        className="flex-1 h-8 text-[11px]"
                      >
                        <FileDown className="size-3 mr-1" /> Import Progress
                      </Button>
                    </div>
                  </div>
                )}

                {/* Resume saved progress */}
                {hasSavedProgress && !isUploading && !pdfFileName && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-2.5 rounded-lg text-[11px]" style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.10)' }}>
                      <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" style={{ color: '#00e5ff' }} />
                      <span>
                        Found saved progress for <strong>{savedFileName}</strong>.
                        Resume where you left off?
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleResume}
                        className="flex-1 h-8 text-[11px]"
                        size="sm"
                      >
                        <Loader2 className="size-3 mr-1" /> Resume
                      </Button>
                      <Button
                        onClick={() => {
                          if (projectId) deleteProjectMutation({ projectId });
                          setProjectId(null);
                          setHasSavedProgress(false);
                        }}
                        variant="outline"
                        className="h-8 text-[11px]"
                        size="sm"
                      >
                        Start Fresh
                      </Button>
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Or Paste Text
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-6"
                      onClick={handleRunBaseline}
                      disabled={baselineRunning}
                      title="Verify the locked baseline sentence across all 20 languages (23-phase QA)"
                    >
                      {baselineRunning ? (
                        <Loader2 className="size-2.5 animate-spin" />
                      ) : (
                        <FlaskConical className="size-2.5" />
                      )}{" "}
                      Baseline
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[10px] h-6"
                      onClick={loadSample}
                    >
                      Sample
                    </Button>
                  </div>
                  <Textarea
                    value={sourceText}
                    onChange={async (e) => {
                      setSourceText(e.target.value);
                      if (pdfFileName) {
                        clearSource();
                      } else if (e.target.value.trim()) {
                        // Discard saved progress when pasting new text
                        if (projectId) await deleteProjectMutation({ projectId }).catch(() => {});
                        setHasSavedProgress(false);
                        resetFlow();
                      }
                    }}
                    placeholder="Paste your text here or upload a PDF..."
                    className="min-h-[100px] resize-none font-mono text-xs leading-relaxed"
                  />

                  {baselineSummary && (
                    <div className="mt-2 space-y-1.5 text-left">
                      <button
                        className="w-full flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1.5 text-[10px] font-semibold"
                        onClick={() => setBaselineOpen((v) => !v)}
                      >
                        <ListChecks className="size-3 text-primary" />
                        Baseline: {baselineSummary.passed} pass · {baselineSummary.warned}{" "}
                        warn · {baselineSummary.failed} fail · avg{" "}
                        {baselineSummary.averageScore}/100
                        <span className="ml-auto text-muted-foreground">
                          {baselineOpen ? "▾" : "▸"}
                        </span>
                      </button>
                      {baselineOpen && (
                        <ScrollArea className="max-h-[180px] rounded-lg border border-border/40">
                          <div className="divide-y divide-border/40">
                            {baselineSummary.results.map((r) => (
                              <div key={r.langCode} className="px-2.5 py-1.5 text-[10px]">
                                <div className="flex items-center gap-1.5">
                                  {r.overall === "pass" ? (
                                    <CheckCircle2 className="size-3 shrink-0" style={{ color: '#00e5ff' }} />
                                  ) : r.overall === "warn" ? (
                                    <AlertCircle className="size-3 text-amber-500 shrink-0" />
                                  ) : (
                                    <XCircle className="size-3 text-red-500 shrink-0" />
                                  )}
                                  <span className="font-medium">
                                    {r.name}{" "}
                                    <span className="text-muted-foreground font-normal">
                                      {r.nativeName}
                                    </span>
                                  </span>
                                  <span
                                    className={`ml-auto font-mono ${
                                      r.overall === "pass"
                                        ? "text-cyan-400"
                                        : r.overall === "warn"
                                          ? "text-yellow-400"
                                          : "text-red-400"
                                    }`}
                                  >
                                    {r.score}/100
                                  </span>
                                </div>
                                {r.summary.filter((s) => s.includes("✗") || s.includes("⚠")).length > 0 && (
                                  <div className="mt-0.5 space-y-0.5 pl-4.5 text-[9px] text-muted-foreground leading-snug">
                                    {r.summary
                                      .filter((s) => s.includes("✗") || s.includes("⚠"))
                                      .slice(0, 3)
                                      .map((s, i) => (
                                        <div key={i}>{s}</div>
                                      ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      )}
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{wordCount.toLocaleString()} words</span>
                    <span>{sourceText.length.toLocaleString()} chars</span>
                  </div>
                </div>

                {sourceText.trim() && flowPhase === "idle" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
                        Target Market
                      </span>
                      <Select
                        value={marketContext}
                        onValueChange={(v) =>
                          setMarketContext(
                            v as "standard" | "high-censorship" | "romance-focused" | "conservative"
                          )
                        }
                      >
                        <SelectTrigger className="w-full h-8 text-xs">
                          <SelectValue placeholder="Market context" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">
                            Standard — global literary fantasy
                          </SelectItem>
                          <SelectItem value="high-censorship">
                            High Censorship — Turkey / Arabic markets
                          </SelectItem>
                          <SelectItem value="romance-focused">
                            Romance Focused — Korea / Japan
                          </SelectItem>
                          <SelectItem value="conservative">
                            Conservative — strict cultural norms
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                      {marketContext === "standard" &&
                        "Publish-grade localization: profanity mapped, intimacy handled per language norms."}
                      {marketContext === "high-censorship" &&
                        "P6/P7/P13/P14 tightened: intimacy strictly implied, profanity euphemized, political/religious content adapted."}
                      {marketContext === "romance-focused" &&
                        "P13 tuned for fated-pair chemistry with cultural subtlety (Korea / Japan norms)."}
                      {marketContext === "conservative" &&
                        "Full sensitivity pass: profanity, intimacy, political, religious and sensitivity filters applied."}
                    </p>
                    <Button
                      onClick={startTranslation}
                      className="w-full h-9"
                      size="default"
                    >
                      <Globe className="size-3.5 mr-2" />
                      Begin Translation Journey
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Progress Panel */}
            {flowPhase !== "idle" && (
              <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="size-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 neon-glow" style={{ background: 'linear-gradient(135deg, #00e5ff, #a78bfa)', color: '#06060e' }}>
                      2
                    </span>
                    <span className="text-xs font-semibold">
                      Translation Progress
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                      {completedLanguages.length}/{targetLanguages.length}
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${(completedLanguages.length / targetLanguages.length) * 100}%`,
                      }}
                    />
                  </div>

                  <div className="space-y-1.5">
                    {modelStatus && isTranslating && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                        <Loader2 className="size-3.5 text-yellow-500 animate-spin shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate text-yellow-600">
                            {modelStatus}
                          </p>
                        </div>
                      </div>
                    )}

                    {isTranslating && currentLang && !modelStatus && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                        <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate">
                            {currentLang.name}
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            {translationProgress?.phase || "Translating..."}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-auto">
                          {isNeural && (
                            <Badge variant="default" className="text-[8px] bg-blue-600">
                              Neural MT
                            </Badge>
                          )}
                          <Badge
                            variant="secondary"
                            className="text-[9px]"
                          >
                            {currentLang.nativeName}
                          </Badge>
                        </div>
                      </div>
                    )}

                    {flowPhase === "generating-pdf" && currentLang && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
                        <Loader2 className="size-3.5 text-blue-500 animate-spin shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate">
                            Generating PDF...
                          </p>
                          <p className="text-[9px] text-muted-foreground">
                            {pdfProgress?.message || `Processing ${currentLang.name}`}
                          </p>
                        </div>
                        {pdfProgress && (
                          <div className="text-[9px] text-muted-foreground shrink-0 font-mono">
                            {pdfProgress.currentPage}/{pdfProgress.totalPages}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {completedLanguages.length > 0 && (
                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-0.5">
                        {completedLanguages.map((cl) => (
                          <div
                            key={cl.code}
                            className="flex items-center gap-2 py-1.5 px-2 rounded-md text-[11px]" style={{ background: 'rgba(0,229,255,0.04)' }}
                          >
                            <CheckCircle2 className="size-3 shrink-0" style={{ color: '#00e5ff' }} />
                            <span className="min-w-0 truncate flex-1">
                              <span className="font-medium">{cl.name}</span>
                              <span className="text-muted-foreground ml-1">
                                {cl.nativeName}
                              </span>
                            </span>
                            {cl.qaReport && (
                              <Badge
                                variant="outline"
                                className={`text-[8px] shrink-0 ${
                                  cl.qaReport.overall === "pass"
                                    ? "text-cyan-400 border-cyan-500/30"
                                    : cl.qaReport.overall === "warn"
                                      ? "text-yellow-400 border-yellow-500/30"
                                      : "text-red-400 border-red-500/30"
                                }`}
                                title={`QA ${cl.qaReport.score}/100 — ${cl.qaReport.checks.filter((c) => c.status === "pass").length} phases pass`}
                              >
                                QA {cl.qaReport.score}
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-[8px] shrink-0">
                              {cl.pdfBlob ? "PDF" : "Text"}
                            </Badge>
                            <button
                              onClick={() => handleRetranslate(cl.code)}
                              disabled={
                                isTranslating || flowPhase === "generating-pdf"
                              }
                              className="shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-cyan-500/10 hover:text-cyan-400 disabled:pointer-events-none disabled:opacity-40"
                              title={`Retranslate ${cl.name} from the original source`}
                            >
                              <RotateCcw className="size-2.5" />
                              Retranslate
                            </button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}

                  {flowPhase === "translation-done" &&
                    currentQaReport &&
                    currentLang &&
                    !isTranslating && (
                      <div className="rounded-lg border border-border/40 bg-muted/20 p-2 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <CheckCircle2 className="size-3 shrink-0" style={{ color: '#00e5ff' }} />
                          <span className="text-[10px] font-semibold">
                            23-Phase QA
                          </span>
                          <span
                            className={`text-[10px] font-mono ml-auto ${
                              currentQaReport.overall === "pass"
                                ? "text-cyan-400"
                                : currentQaReport.overall === "warn"
                                  ? "text-yellow-400"
                                  : "text-red-400"
                            }`}
                          >
                            {currentQaReport.score}/100
                          </span>
                          {translationMode && (
                            <Badge variant="outline" className="text-[8px] w-full">
                              {translationMode === "vly"
                                ? `Gemini 3.6 Flash · 23 phases${translationModel ? ` · ${translationModel}` : ""}`
                                : translationMode === "neural"
                                  ? "Neural MT + phases"
                                  : "Glossary Mode · word-swap fallback"}
                            </Badge>
                          )}
                        </div>
                        {translationMode === "vly" &&
                          translationUsage &&
                          (translationUsage.totalTokens != null ||
                            translationUsage.credits != null) && (
                            <div className="flex items-center gap-1 text-[9px] text-muted-foreground font-mono">
                              <span>⚡</span>
                              <span>
                                {translationUsage.credits != null
                                  ? `${translationUsage.credits} credits used`
                                  : `~${(translationUsage.totalTokens ?? 0).toLocaleString()} tokens used`}
                              </span>
                            </div>
                          )}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setShowAllQaPhases((v) => !v)}
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted/40 transition-colors"
                          >
                            <ListChecks className="size-2.5" />
                            {showAllQaPhases ? "Hide passes" : "Show all phases"}
                          </button>
                          <span className="text-[9px] text-muted-foreground ml-auto">
                            {currentQaReport.checks.filter((c) => c.status === "pass").length}/
                            {currentQaReport.checks.length} pass
                          </span>
                        </div>
                        <ScrollArea className="max-h-[130px]">
                          <div className="space-y-0.5">
                            {(showAllQaPhases
                              ? currentQaReport.checks
                              : currentQaReport.checks.filter((c) => c.status !== "pass")
                            ).map((c) => (
                              <div
                                key={c.label}
                                className="flex items-start gap-1.5 text-[9px] leading-snug"
                              >
                                <span
                                  className={`shrink-0 font-semibold ${
                                    c.status === "pass"
                                      ? "text-cyan-400"
                                      : c.status === "fail"
                                        ? "text-red-400"
                                        : "text-amber-500"
                                  }`}
                                >
                                  {c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : "⚠️"}{" "}
                                  {c.label}
                                </span>
                                <span className="text-muted-foreground">
                                  {c.detail}
                                </span>
                              </div>
                            ))}
                            {!showAllQaPhases &&
                              currentQaReport.checks.every((c) => c.status === "pass") && (
                                <p className="text-[9px] text-cyan-400">
                                  All phases pass ✓
                                </p>
                              )}
                          </div>
                        </ScrollArea>
                      </div>
                    )}

                  <div className="space-y-1.5 pt-1">
                    {flowPhase === "translation-done" &&
                      currentLang &&
                      !isTranslating && (
                        <>
                          {originalArrayBuffer && pageData.length > 0 ? (
                            <Button
                              onClick={handleDownloadPDF}
                              className="w-full h-9 text-xs"
                              variant="default"
                            >
                              <FileDown className="size-3.5 mr-2" /> Download{" "}
                              {currentLang.name} PDF
                            </Button>
                          ) : (
                            <div className="text-center text-[10px] text-muted-foreground py-1.5 rounded-lg bg-muted/30">
                              PDF download needs a PDF source — upload your PDF to
                              get image-preserved translated PDFs
                            </div>
                          )}

                          {nextLang ? (
                            <Button
                              onClick={handleContinue}
                              className="w-full h-9 text-xs"
                              variant="outline"
                            >
                              Continue to {nextLang.name}
                              <ChevronRight className="size-3.5 ml-2" />
                              <Badge variant="secondary" className="text-[9px] ml-1">
                                {nextLang.nativeName}
                              </Badge>
                            </Button>
                          ) : (
                            <Button
                              onClick={handleContinue}
                              className="w-full h-9 text-xs"
                              variant="outline"
                            >
                              <CheckCheck className="size-3.5 mr-2" /> Finalize All
                            </Button>
                          )}
                        </>
                      )}

                    {flowPhase === "all-complete" && (
                      <>
                        <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.15)' }}>
                          <CheckCheck className="size-4 shrink-0" style={{ color: '#00e5ff' }} />
                          <span className="text-[11px] font-medium neon-text">
                            All {targetLanguages.length} languages completed!
                          </span>
                        </div>

                        <Button
                          onClick={handleDownloadAllZIP}
                          disabled={isDownloadingZip}
                          className="w-full h-10 text-sm"
                          variant="default"
                          size="lg"
                        >
                          {isDownloadingZip ? (
                            <>
                              <Loader2 className="size-4 mr-2 animate-spin" /> Creating
                              ZIP...
                            </>
                          ) : (
                            <>
                              <Package className="size-4 mr-2" /> Download All PDFs as
                              ZIP
                            </>
                          )}
                        </Button>

                        <Button
                          onClick={clearSource}
                          className="w-full h-9 text-xs"
                          variant="outline"
                        >
                          <RotateCcw className="size-3.5 mr-2" /> Start Over
                        </Button>

                        <div className="flex gap-2">
                          <Button
                            onClick={handleExportProgress}
                            className="flex-1 h-8 text-[10px]"
                            variant="outline"
                          >
                            📤 Export Progress
                          </Button>
                          <Button
                            onClick={handleImportProgress}
                            className="flex-1 h-8 text-[10px]"
                            variant="outline"
                          >
                            📥 Import Progress
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  {translationError && !isTranslating && (
                    <div className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 border border-red-500/20 text-[11px]">
                      <XCircle className="size-3.5 text-red-500 shrink-0 mt-0.5" />
                      <span>{translationError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - Preview */}
          <div className="min-h-0">
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden h-full min-h-[500px]">
              <div className="px-4 py-3 border-b border-border/30 bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">
                    {flowPhase === "idle" && "Translation Preview"}
                    {flowPhase === "translating" &&
                      currentLang &&
                      `Translating to ${currentLang.name}`}
                    {flowPhase === "translation-done" &&
                      currentLang &&
                      `${currentLang.name} Translation`}
                    {flowPhase === "generating-pdf" &&
                      currentLang &&
                      `Generating ${currentLang.name} PDF`}
                    {flowPhase === "all-complete" && "All Translations Complete"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {currentTranslation && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-[10px] gap-1.5"
                      onClick={handleCopyTranslation}
                      title="Copy first 10,000 words of this translation to the clipboard"
                    >
                      {copiedPreview ? (
                        <>
                          <Check className="size-3" style={{ color: '#00e5ff' }} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" /> Copy
                        </>
                      )}
                    </Button>
                  )}
                  {flowPhase === "translating" && currentLang && (
                    <Badge variant="secondary" className="text-[9px] animate-pulse">
                      <Loader2 className="size-2.5 mr-1 animate-spin" />
                      Gemini 23-Phase AI
                    </Badge>
                  )}
                  {flowPhase === "translation-done" && currentLang && (
                    <Badge variant="default" className="text-[9px]" style={{ background: 'linear-gradient(135deg, #00e5ff, #a78bfa)', color: '#06060e' }}>
                      <CheckCircle2 className="size-2.5 mr-1" /> Gemini Done
                    </Badge>
                  )}
                  {flowPhase === "all-complete" && (
                    <Badge variant="default" className="text-[9px]" style={{ background: 'linear-gradient(135deg, #00e5ff, #a78bfa)', color: '#06060e' }}>
                      <CheckCheck className="size-2.5 mr-1" /> Complete
                    </Badge>
                  )}
                </div>
              </div>
              <div className="p-4">
                {flowPhase === "idle" && (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center max-w-sm">
                      <div className="size-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <Languages className="size-7 text-muted-foreground/40" />
                      </div>
                      <h3 className="text-sm font-semibold mb-1.5">
                        Onyx Translate
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Upload your English PDF, and we'll translate it step-by-step
                        into all 20 languages — preserving every image, illustration,
                        and visual element from the original.
                      </p>
                      <div className="flex items-center justify-center gap-2 mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="size-3 mr-1.5" /> Upload PDF
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={loadSample}
                        >
                          Load Sample
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5 justify-center mt-3 text-[10px] text-muted-foreground">
                        <CheckCircle2 className="size-2.5" style={{ color: '#00e5ff' }} /> Images
                        preserved
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5" style={{ color: '#00e5ff' }} /> 23-phase
                        localization
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5" style={{ color: '#00e5ff' }} /> PDF
                        download per language
                      </div>
                    </div>
                  </div>
                )}

                {flowPhase === "translating" && isTranslating && currentLang && (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center">
                      <div className="relative mb-4">
                        <div className="size-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto" />
                        <Globe className="size-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <h3 className="text-sm font-semibold mb-1">
                        Translating to {currentLang.name}
                      </h3>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        {currentLang.nativeName}
                      </p>
                      {translationProgress && (
                        <div className="space-y-2">
                          <div className="w-48 h-1.5 rounded-full bg-muted overflow-hidden mx-auto">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-300"
                              style={{
                                width: `${(translationProgress.current / Math.max(translationProgress.total, 1)) * 100}%`,
                              }}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {translationProgress.phase}
                          </p>
                          <p className="text-[9px] text-muted-foreground font-mono">
                            Chunk{" "}
                            {Math.min(translationProgress.current + 1, translationProgress.total)}{" "}
                            of {translationProgress.total}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-2 flex-wrap mt-3">
                        <Badge variant="secondary" className="text-[9px]">
                          Gemini 23-Phase AI
                        </Badge>
                        <Badge variant="outline" className="text-[9px]">
                          {currentLang.script} Script
                        </Badge>
                      </div>
                    </div>
                  </div>
                )}

                {flowPhase === "generating-pdf" && currentLang && pdfProgress && (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center">
                      <Loader2 className="size-8 text-blue-500 animate-spin mx-auto mb-3" />
                      <h3 className="text-sm font-semibold mb-1">
                        {pdfProgress.message}
                      </h3>
                      <div className="w-40 h-1.5 rounded-full bg-muted overflow-hidden mx-auto mt-2">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-200"
                          style={{
                            width: `${(pdfProgress.currentPage / pdfProgress.totalPages) * 100}%`,
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Rendering pages with original images + translated text
                        overlay
                      </p>
                    </div>
                  </div>
                )}

                {flowPhase === "translation-done" &&
                  currentTranslation &&
                  currentLang &&
                  !isTranslating && (
                    <ScrollArea className="h-[calc(100vh-220px)]">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="default" className="text-[10px]">
                            {currentLang.name} {currentLang.nativeName}
                          </Badge>
                          <Badge variant="secondary" className="text-[9px]">
                            {currentLang.script} Script
                          </Badge>
                          {["ar", "ur", "ks"].includes(currentLang.code) && (
                            <Badge variant="outline" className="text-[9px]">
                              RTL
                            </Badge>
                          )}
                        </div>
                        <div className="whitespace-pre-wrap font-serif text-[13px] leading-[1.8] p-4 rounded-xl neon-border" style={{ background: '#0a0a16' }}>
                          {currentTranslation}
                        </div>
                        <div className="flex gap-2 pt-2">
                          {originalArrayBuffer && pageData.length > 0 && (
                            <Button onClick={handleDownloadPDF} size="sm" className="h-8 text-[11px] neon-glow">
                              <FileDown className="size-3 mr-1" /> Download {currentLang.name} PDF
                            </Button>
                          )}
                          <Button onClick={() => handleRetranslate(currentLang.code)} variant="outline" size="sm" className="h-8 text-[11px]" disabled={isTranslating}>
                            <RotateCcw className="size-3 mr-1" /> Retranslate
                          </Button>
                        </div>
                      </div>
                    </ScrollArea>
                  )}

                {flowPhase === "all-complete" && (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center max-w-sm">
                      <div className="size-16 rounded-full neon-glow-strong flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, rgba(0,229,255,0.15), rgba(167,139,250,0.15))' }}>
                        <CheckCheck className="size-8" style={{ color: '#00e5ff' }} />
                      </div>
                      <h3 className="text-lg font-bold mb-1 neon-text">
                        All Translations Complete!
                      </h3>
                      <p className="text-xs text-muted-foreground mb-2">
                        {sourceText
                          .split(/\s+/)
                          .filter(Boolean)
                          .length.toLocaleString()}{" "}
                        words translated into {targetLanguages.length} languages
                      </p>
                      <div className="flex items-center justify-center gap-1.5 text-[10px]">
                        <CheckCircle2 className="size-2.5" style={{ color: '#00e5ff' }} />{" "}
                        {completedLanguages.length} languages
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5" style={{ color: '#00e5ff' }} /> Download
                        individual PDFs
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5" style={{ color: '#00e5ff' }} /> or all as
                        ZIP
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
