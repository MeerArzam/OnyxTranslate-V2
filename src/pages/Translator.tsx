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
  Camera,
} from "lucide-react";
// Convex hooks imported below with storage replacement
import {
  runLocalizedTranslationPipeline,

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
  const parsePdfAction = useAction(api.parsePdf.parseUploadedPdf);
  const startTranslationAction = useAction(api.translateQueue.startTranslation);
  const cancelTranslationAction = useAction(api.translateQueue.cancelTranslation);
  const translateImageAction = useAction(api.translateImage.translateImage);

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

  // ─── Translation flow (autonomous queue) ───
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [flowPhase, setFlowPhase] = useState<
    "idle" | "translating" | "translation-done" | "generating-pdf" | "all-complete"
  >("idle");
  const [copiedPreview, setCopiedPreview] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const [currentPreviewLangCode, setCurrentPreviewLangCode] = useState<string | null>(null);

  // ─── Derived state from Convex ───
  const activeTranslations = convexTranslations ?? [];
  const completedCount = activeTranslations.filter((t) => t.status === "complete").length;
  const isAllComplete = convexProject?.status === "all_translated" || (activeTranslations.length > 0 && completedCount >= activeTranslations.length);
  const inProgressTranslation = activeTranslations.find((t) => t.status === "in_progress");
  const previewTranslation = currentPreviewLangCode
    ? activeTranslations.find((t) => t.langCode === currentPreviewLangCode)
    : inProgressTranslation ?? activeTranslations.find((t) => t.status === "complete");
  const currentTranslation = previewTranslation?.mergedText ?? null;
  const currentLang = targetLanguages.find((t) => t.code === (previewTranslation?.langCode ?? inProgressTranslation?.langCode));
  const currentLanguageIndex = currentLang ? targetLanguages.indexOf(currentLang) : -1;

  // Derive completedLanguages for display from Convex
  const completedLanguages: CompletedLanguage[] = activeTranslations
    .filter((t) => t.status === "complete")
    .map((t) => {
      const lang = targetLanguages.find((l) => l.code === t.langCode)!;
      return {
        index: targetLanguages.indexOf(lang),
        code: lang.code,
        name: lang.name,
        nativeName: lang.nativeName,
        translatedText: t.mergedText ?? "",
      };
    });

  // ─── PDF generation ───
  const [pdfProgress, setPdfProgress] = useState<PDFGenerationProgress | null>(null);
  const [currentPdfBlob, setCurrentPdfBlob] = useState<Blob | null>(null);



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

  // ─── Selected languages for translation ───
  const [selectedLangCodes, setSelectedLangCodes] = useState<string[]>([]);
  const allSelected = selectedLangCodes.length === targetLanguages.length;
  const toggleAllLangs = useCallback(() => {
    if (allSelected) {
      setSelectedLangCodes([]);
    } else {
      setSelectedLangCodes(targetLanguages.map((l) => l.code));
    }
  }, [allSelected]);
  const toggleLang = useCallback((code: string) => {
    setSelectedLangCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }, []);

  // ─── Target market context (P6/P7/P13/P14 sensitivity filters) ───
  const [marketContext, setMarketContext] = useState<
    "standard" | "high-censorship" | "romance-focused" | "conservative"
  >("standard");

  // ─── ZIP ───
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  // ─── Image / Camera Translation ───
  const [imageMode, setImageMode] = useState<"none" | "upload" | "camera">("none");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [currentImageBase64, setCurrentImageBase64] = useState("");
  const [imageTranslation, setImageTranslation] = useState<{
    extracted: string;
    translated: string;
    langCode: string;
  } | null>(null);
  const [isTranslatingImage, setIsTranslatingImage] = useState(false);
  const [imageSelectedLangs, setImageSelectedLangs] = useState<string[]>([]);

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

      // Detect project state from Convex (derived state auto-updates via reactive queries)
      if (convexProject?.status === "all_translated") {
        setFlowPhase("all-complete");
        setIsTranslating(false);
      } else if (convexProject?.status === "translating") {
        setFlowPhase("translating");
        setIsTranslating(true);
      } else {
        setFlowPhase("idle");
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

      // Server-side re-parse with proper text merging (fixes broken words/missing letters)
      setParsePhase("parsing");
      setParseProgress({ current: header.totalPages, total: header.totalPages });

      let serverPageData = allPageData;
      let serverFullText = fullText;
      let serverWordCount = fullText.split(/\s+/).filter(Boolean).length;

      try {
        const serverResult = await parsePdfAction({ pdfStorageId: storageId });
        // Use server-parsed data if it returned valid results
        if (serverResult.fullText && serverResult.fullText.length > 10) {
          serverFullText = serverResult.fullText;
          serverWordCount = serverResult.wordCount;
          // Map server page data to client PDFPageData format
          serverPageData = serverResult.pageData.map((p: any) => ({
            num: p.num,
            text: p.text,
            textItems: (p.textItems || []).map((it: any) => ({
              str: it.str,
              // Convert PDF bottom-origin coords to top-origin for client rendering
              x: it.x,
              y: p.pageHeight - it.y - it.height,
              width: it.width,
              height: it.height,
              fontName: it.fontName,
            })),
            pageWidth: p.pageWidth,
            pageHeight: p.pageHeight,
          }));
          // Update page data and texts from server result
          setPageData(serverPageData);
          const serverTexts = serverPageData.map((p) => p.text);
          setOriginalPageTexts(serverTexts);
          setSourceText(serverFullText);
        }
      } catch (serverErr) {
        // Server parse failed — fall back to browser-parsed data
        console.warn("Server-side parse failed, using browser result:", serverErr);
      }

      // Create project record in Convex DB with the best available data
      const newProjectId = await createProjectMutation({
        fileName: file.name,
        pageCount: header.totalPages,
        wordCount: serverWordCount,
        pdfStorageId: storageId,
        pageData: serverPageData,
        fullText: serverFullText,
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
  }, [projectId, deleteProjectMutation, storePdfAction, createProjectMutation, parsePdfAction]);

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
    if (!convexProject) return;
    const data = {
      project: {
        fileName: convexProject.fileName,
        pageCount: convexProject.pageCount,
        wordCount: convexProject.wordCount,
        status: convexProject.status,
      },
      translations: activeTranslations.map((t) => ({
        langCode: t.langCode,
        status: t.status,
        totalChunks: t.totalChunks,
        completedChunks: t.completedChunks,
      })),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `onyx-translate-progress-${convexProject.fileName.replace(/\.pdf$/i, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [convexProject, activeTranslations]);
  const handleImportProgress = useCallback(async () => {
    // Import is not needed with Convex — data persists server-side.
    // If user wants to restore, they just reopen the app.
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
    setIsTranslating(false);
    setTranslationError(null);
    setFlowPhase("idle");
    setPdfProgress(null);
    setCurrentPdfBlob(null);
    setCurrentQaReport(null);
    setTranslationMode(null);
    setCurrentPreviewLangCode(null);
  }, []);

  // ─── Image / Camera Handlers ───

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new window.Image();
        img.onload = () => {
          // Downscale to max 1024px width to save memory (Android 5 safe)
          const canvas = document.createElement("canvas");
          const maxWidth = 1024;
          const scale = Math.min(1, maxWidth / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
          setImagePreview(canvas.toDataURL("image/jpeg", 0.7));
          setCurrentImageBase64(base64);
          setImageMode("upload");
          setImageTranslation(null);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const translateCurrentImage = useCallback(
    async (langCode: string) => {
      if (!currentImageBase64 || !langCode) return;
      setIsTranslatingImage(true);
      setImageTranslation(null);
      try {
        const result = await translateImageAction({
          imageBase64: currentImageBase64,
          langCode,
        });
        if (result.ok) {
          setImageTranslation({
            extracted: result.extractedText,
            translated: result.extractedText,
            langCode,
          });
        } else {
          console.error("Image translation failed:", result.error);
        }
      } catch (err) {
        console.error("Image translation error:", err);
      }
      setIsTranslatingImage(false);
    },
    [currentImageBase64, translateImageAction]
  );

  const translateImageMultiLang = useCallback(async () => {
    if (!currentImageBase64 || imageSelectedLangs.length === 0) return;
    setIsTranslatingImage(true);
    setImageTranslation(null);
    const results: Array<{ langCode: string; text: string }> = [];
    for (const lang of imageSelectedLangs) {
      try {
        const result = await translateImageAction({
          imageBase64: currentImageBase64,
          langCode: lang,
        });
        if (result.ok) {
          results.push({ langCode: lang, text: result.extractedText });
        }
      } catch (err) {
        console.error(`Image translation to ${lang} failed:`, err);
      }
    }
    if (results.length > 0) {
      setImageTranslation({
        extracted: results.map((r) => `[${r.langCode.toUpperCase()}]\n${r.text}`).join("\n\n"),
        translated: results.map((r) => `[${r.langCode.toUpperCase()}]\n${r.text}`).join("\n\n"),
        langCode: imageSelectedLangs.join(","),
      });
    }
    setIsTranslatingImage(false);
  }, [currentImageBase64, imageSelectedLangs, translateImageAction]);

  const clearImage = useCallback(() => {
    setImagePreview(null);
    setCurrentImageBase64("");
    setImageTranslation(null);
    setImageMode("none");
    setImageSelectedLangs([]);
  }, []);

  // ─── Cleanup on unmount ───
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  // ─── Autonomous Translation Queue ───

  const startTranslation = useCallback(async () => {
    if (!sourceText.trim()) return;
    try {
      setIsTranslating(true);
      setFlowPhase("translating");
      setTranslationError(null);

      // If no project exists (pasted text, not PDF), create one now
      let activeProjectId = projectId;
      if (!activeProjectId) {
        activeProjectId = await createProjectMutation({
          fileName: "Pasted Text",
          pageCount: 1,
          wordCount: sourceText.split(/\s+/).filter(Boolean).length,
          pageData: [],
          fullText: sourceText,
          parsedPages: 1,
          status: "ready",
        });
        setProjectId(activeProjectId);
      }

      const langs = selectedLangCodes.length > 0 ? selectedLangCodes : targetLanguages.map((l) => l.code);
      await startTranslationAction({ projectId: activeProjectId, langCodes: langs });
    } catch (error) {
      setTranslationError(
        error instanceof Error ? error.message : "Failed to start translation"
      );
      setIsTranslating(false);
      setFlowPhase("idle");
    }
  }, [sourceText, projectId, selectedLangCodes, startTranslationAction, createProjectMutation]);

  // ─── Retranslate: cancel queue, delete language chunks, restart queue ───

  const handleRetranslate = useCallback(
    async (langCode: string) => {
      if (!projectId) return;
      try {
        setIsTranslating(true);
        setFlowPhase("translating");
        setTranslationError(null);
        // Delete old chunks for this language
        await deleteChunksForLangMutation({ projectId, langCode });
        // Restart autonomous queue
        await startTranslationAction({ projectId, langCodes: [langCode] });
      } catch (error) {
        setTranslationError(
          error instanceof Error ? error.message : "Retranslate failed"
        );
        setIsTranslating(false);
        setFlowPhase("idle");
      }
    },
    [projectId, deleteChunksForLangMutation, startTranslationAction]
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
    const lang = currentLang;
    if (!lang) return;

    // Prefer server-generated PDF from Convex Storage
    if (previewTranslation?.pdfUrl) {
      window.open(previewTranslation.pdfUrl, "_blank");
      return;
    }

    // Fall back to client-side PDF generation
    if (!currentTranslation || !originalArrayBuffer || !pageData.length || !originalPageTexts.length)
      return;

    setFlowPhase("generating-pdf");
    setPdfProgress(null);

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
    currentLang,
    previewTranslation,
    pdfFileName,
  ]);

  // ─── ZIP Download ───

  const handleDownloadAllZIP = useCallback(async () => {
    // Prefer server-generated ZIP from Convex Storage
    if (convexProject?.zipUrl) {
      window.open(convexProject.zipUrl, "_blank");
      return;
    }

    if (completedLanguages.length === 0) return;
    const allCompleted = [...completedLanguages];

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
    convexProject,
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
  const nextLang = null; // No Continue button in autonomous mode

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

                {/* ─── Image / Camera Translation ─── */}
                {!isUploading && !pdfFileName && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Image / Camera
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed cursor-pointer transition-all duration-200 hover:bg-muted/30" style={{ borderColor: 'rgba(167,139,250,0.3)' }}>
                        <Image className="size-3.5" style={{ color: '#a78bfa' }} />
                        <span className="text-[10px] font-medium">Upload Image</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageUpload}
                        />
                      </label>
                      <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed cursor-pointer transition-all duration-200 hover:bg-muted/30" style={{ borderColor: 'rgba(52,211,153,0.3)' }}>
                        <Camera className="size-3.5" style={{ color: '#34d399' }} />
                        <span className="text-[10px] font-medium">Take Photo</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={handleImageUpload}
                        />
                      </label>
                    </div>

                    {/* Image Preview */}
                    {imagePreview && (
                      <div className="p-3 rounded-lg border" style={{ background: 'rgba(10,10,22,0.8)', borderColor: 'rgba(0,229,255,0.15)' }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] font-semibold" style={{ color: '#00e5ff' }}>Image Preview</span>
                          <button
                            onClick={clearImage}
                            className="text-[9px] text-red-400 hover:text-red-300 transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                        <img
                          src={imagePreview}
                          alt="Uploaded"
                          className="max-h-40 w-full rounded object-contain mb-2"
                        />
                        {/* Multi-select language chips for image */}
                        <div className="space-y-1.5 mb-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Translate to</span>
                            <button
                              onClick={() => {
                                if (imageSelectedLangs.length === targetLanguages.length) {
                                  setImageSelectedLangs([]);
                                } else {
                                  setImageSelectedLangs(targetLanguages.map((l) => l.code));
                                }
                              }}
                              className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-muted/40"
                              style={{ color: imageSelectedLangs.length === targetLanguages.length ? '#ff4757' : '#a78bfa' }}
                            >
                              {imageSelectedLangs.length === targetLanguages.length ? 'Clear' : 'All'}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {targetLanguages.map((lang) => {
                              const isImgSel = imageSelectedLangs.includes(lang.code);
                              return (
                                <button
                                  key={lang.code}
                                  onClick={() => {
                                    setImageSelectedLangs((prev) =>
                                      prev.includes(lang.code)
                                        ? prev.filter((c) => c !== lang.code)
                                        : [...prev, lang.code]
                                    );
                                  }}
                                  className="px-2 py-0.5 rounded text-[9px] font-medium transition-all border"
                                  style={{
                                    background: isImgSel ? 'rgba(167,139,250,0.15)' : 'transparent',
                                    borderColor: isImgSel ? 'rgba(167,139,250,0.5)' : 'rgba(255,255,255,0.08)',
                                    color: isImgSel ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                                  }}
                                >
                                  {lang.code.toUpperCase()}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {imageSelectedLangs.length > 0 && !isTranslatingImage && (
                          <button
                            onClick={translateImageMultiLang}
                            className="w-full py-1.5 rounded text-[10px] font-medium transition-all border"
                            style={{
                              background: 'rgba(167,139,250,0.15)',
                              borderColor: 'rgba(167,139,250,0.5)',
                              color: '#a78bfa',
                            }}
                          >
                            Translate to {imageSelectedLangs.length} language{imageSelectedLangs.length > 1 ? 's' : ''}
                          </button>
                        )}
                        {isTranslatingImage && (
                          <div className="flex items-center gap-2 text-[10px] py-1">
                            <Loader2 className="size-3 animate-spin" style={{ color: '#00e5ff' }} />
                            <span style={{ color: '#00e5ff' }}>Extracting and translating text via Gemini…</span>
                          </div>
                        )}
                        {imageTranslation && !isTranslatingImage && (
                          <div className="space-y-2 mt-2">
                            <div className="p-2.5 rounded-lg bg-muted/30 border border-border/30">
                              <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Translated Text</div>
                              <div className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ direction: ['ar', 'ur', 'ks'].includes(imageTranslation.langCode) ? 'rtl' : 'ltr' }}>
                                {imageTranslation.translated}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(imageTranslation.translated).catch(() => {});
                                }}
                                className="flex-1 text-[9px] py-1.5 rounded border border-border/30 hover:bg-muted/30 transition-colors"
                              >
                                Copy Translation
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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
                    {/* Language Picker */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Languages ({selectedLangCodes.length}/{targetLanguages.length})
                        </span>
                        <button
                          onClick={toggleAllLangs}
                          className="text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-muted/40"
                          style={{ color: allSelected ? '#ff4757' : '#00e5ff' }}
                        >
                          {allSelected ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {targetLanguages.map((lang) => {
                          const isSelected = selectedLangCodes.includes(lang.code);
                          return (
                            <button
                              key={lang.code}
                              onClick={() => toggleLang(lang.code)}
                              className="px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-150 border"
                              style={{
                                background: isSelected ? 'rgba(0,229,255,0.15)' : 'transparent',
                                borderColor: isSelected ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.08)',
                                color: isSelected ? '#00e5ff' : 'rgba(255,255,255,0.4)',
                              }}
                            >
                              {lang.code.toUpperCase()}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <Button
                      onClick={startTranslation}
                      className="w-full h-9"
                      size="default"
                      disabled={selectedLangCodes.length === 0}
                    >
                      <Globe className="size-3.5 mr-2" />
                      {selectedLangCodes.length === 0
                        ? "Select languages to begin"
                        : `Begin Translation (${selectedLangCodes.length} language${selectedLangCodes.length > 1 ? "s" : ""})`}
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
                      {completedLanguages.length}/{activeTranslations.length || targetLanguages.length}
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${(completedLanguages.length / Math.max(activeTranslations.length, 1)) * 100}%`,
                      }}
                    />
                  </div>

                  {activeTranslations.some((t) => t.status === "generating_pdf") && (
                    <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                      <Loader2 className="size-2.5 animate-spin" style={{ color: '#a78bfa' }} />
                      <span>PDFs generating in background…</span>
                    </div>
                  )}

                  <ScrollArea className="max-h-[320px]">
                    <div className="space-y-1">
                      {targetLanguages.map((lang) => {
                        const t = activeTranslations.find((tr) => tr.langCode === lang.code);
                        const isComplete = t?.status === "complete";
                        const isActive = t?.status === "in_progress";
                        const isGeneratingPdf = t?.status === "generating_pdf" || t?.pdfGenerating;
                        const progress = t ? (t.completedChunks / Math.max(t.totalChunks, 1)) * 100 : 0;
                        const pct = isComplete ? 100 : Math.round(progress);

                        return (
                          <div
                            key={lang.code}
                            className="flex items-center gap-2 py-1 px-2 rounded-md text-[11px] hover:bg-primary/5 cursor-pointer transition-colors"
                            onClick={() => {
                              if (isComplete || isActive || isGeneratingPdf) setCurrentPreviewLangCode(lang.code);
                            }}
                          >
                            {isComplete ? (
                              <CheckCircle2 className="size-3 shrink-0" style={{ color: '#00e5ff' }} />
                            ) : isActive ? (
                              <Loader2 className="size-3 shrink-0 text-primary animate-spin" />
                            ) : isGeneratingPdf ? (
                              <Loader2 className="size-3 shrink-0 animate-spin" style={{ color: '#a78bfa' }} />
                            ) : (
                              <div className="size-3 rounded-full border border-muted-foreground/30 shrink-0" />
                            )}
                            <span className="min-w-0 truncate flex-1">
                              <span className="font-medium">{lang.name}</span>
                              <span className="text-muted-foreground ml-1">
                                {lang.nativeName}
                              </span>
                            </span>
                            {isActive && (
                              <Badge variant="secondary" className="text-[8px] animate-pulse">
                                {pct}%
                              </Badge>
                            )}
                            {t?.pdfGenerating && (
                              <Badge variant="secondary" className="text-[8px] animate-pulse" style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
                                PDF…
                              </Badge>
                            )}
                            {isComplete && (
                              <Badge variant="outline" className="text-[8px] shrink-0" style={{ borderColor: 'rgba(0,229,255,0.3)' }}>
                                Done
                              </Badge>
                            )}
                            {!isComplete && !isActive && (
                              <span className="text-[9px] text-muted-foreground font-mono">
                                {pct}%
                              </span>
                            )}
                            {(isComplete || isActive) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRetranslate(lang.code);
                                }}
                                disabled={isTranslating}
                                className="shrink-0 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-cyan-500/10 hover:text-cyan-400 disabled:pointer-events-none disabled:opacity-40"
                                title={`Retranslate ${lang.name}`}
                              >
                                <RotateCcw className="size-2.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>

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

                          {isTranslating && (
                            <div className="text-center text-[10px] text-muted-foreground py-1.5 rounded-lg bg-primary/5 border border-primary/10">
                              Translating all languages automatically...
                            </div>
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

                {flowPhase === "translating" && isTranslating && (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center">
                      <div className="relative mb-4">
                        <div className="size-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto" />
                        <Globe className="size-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <h3 className="text-sm font-semibold mb-1">
                        Autonomous Translation Running
                      </h3>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        {completedCount} of {targetLanguages.length} languages complete
                      </p>
                      {inProgressTranslation && (
                        <div className="space-y-2">
                          <div className="w-48 h-1.5 rounded-full bg-muted overflow-hidden mx-auto">
                            <div
                              className="h-full rounded-full bg-primary transition-all duration-300"
                              style={{
                                width: `${(inProgressTranslation.completedChunks / Math.max(inProgressTranslation.totalChunks, 1)) * 100}%`,
                              }}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {targetLanguages.find((l) => l.code === inProgressTranslation.langCode)?.name} — Chunk {inProgressTranslation.completedChunks}/{inProgressTranslation.totalChunks}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-2 flex-wrap mt-3">
                        <Badge variant="secondary" className="text-[9px]">
                          Gemini 23-Phase AI
                        </Badge>
                        <Badge variant="outline" className="text-[9px]">
                          Server-Side Queue
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
                          {(previewTranslation?.pdfUrl || (originalArrayBuffer && pageData.length > 0)) && (
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
