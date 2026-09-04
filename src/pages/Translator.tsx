import { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
  Clock,
  Zap,
  Circle,
} from "lucide-react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { LanguageAccordion } from "@/components/LanguageAccordion";
import RoyalProgressPanel from "@/components/RoyalProgressPanel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
// Convex hooks imported below with storage replacement
import {
  generateSampleText,
  type TranslationMode,
} from "@/lib/translator/engine";
import type { QAReport } from "@/lib/translator/qa";
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
  // ─── C1: Session isolation (per-tab, stored in sessionStorage) ───
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "ssr-fallback";
    const existing = sessionStorage.getItem("onyx-session-id");
    if (existing) return existing;
    const newId = crypto.randomUUID();
    sessionStorage.setItem("onyx-session-id", newId);
    return newId;
  });

  // ─── Convex server-side actions ───
  const storePdfAction = useAction(api.upload.storePdf);
  const parsePdfAction = useAction(api.parsePdf.parseUploadedPdf);
  const translateLanguageAction = useAction(api.translateContent.translateLanguage);
  const cancelTranslationAction = useAction(api.translateQueue.cancelTranslation);
  const translateImageAction = useAction(api.translateImage.translateImage);

  // ─── Convex database state ───
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);
  const createProjectMutation = useMutation(api.mutations.createProject);
  const deleteProjectMutation = useMutation(api.mutations.deleteProject);
  const deleteChunksForLangMutation = useMutation(api.mutations.deleteChunksForLang);

  // ─── Convex reactive subscriptions ───
  const latestProject = useQuery(api.queries.getLatestProject, { sessionId });
  const convexProject = useQuery(
    api.queries.getProject,
    projectId ? { projectId, sessionId } : "skip"
  );
  const convexTranslations = useQuery(
    api.queries.getProjectTranslations,
    projectId ? { projectId, sessionId } : "skip"
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
  // C6: flowPhase derived from Convex DB — no local state needed
  const [copiedPreview, setCopiedPreview] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  const [currentPreviewLangCode, setCurrentPreviewLangCode] = useState<string | null>(null);

  // C6: Derived flowPhase from Convex DB (no local state)
  const flowPhase = useMemo(() => {
    const project = convexProject;
    if (!project) {
      // No project yet — check if latestProject has progress
      if (latestProject && latestProject.status !== "ready") {
        if (latestProject.status === "all_translated" || latestProject.status === "complete") return "all-complete" as const;
        if (latestProject.status === "translating") return "translating" as const;
      }
      return "idle" as const;
    }
    const s = project.status;
    if (s === "all_translated" || s === "complete") return "all-complete" as const;
    if (s === "translating" || s === "parsing") return "translating" as const;
    // cancelled = paused — still show progress panel
    if (s === "cancelled" && (convexTranslations?.length ?? 0) > 0) return "translating" as const;
    return "idle" as const;
  }, [convexProject, latestProject, convexTranslations]);

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

  // ─── RoyalProgressPanel derived state ───
  const languageStatuses = useMemo(() => {
    return targetLanguages.map((lang) => {
      const translation = activeTranslations.find((t) => t.langCode === lang.code);
      return {
        code: lang.code,
        name: lang.name,
        nativeName: lang.nativeName,
        status: (translation?.status ?? "pending") as "pending" | "translating" | "generating_pdf" | "complete",
        chunksDone: translation?.completedChunks ?? 0,
        chunksTotal: translation?.totalChunks ?? 0,
        wordCount: translation?.mergedText ? translation.mergedText.split(/\s+/).filter(Boolean).length : 0,
      };
    });
  }, [activeTranslations]);

  const activeLangIndex = useMemo(() => {
    const idx = languageStatuses.findIndex((l) => l.status === "translating");
    return idx >= 0 ? idx : languageStatuses.findIndex((l) => l.status === "pending");
  }, [languageStatuses]);

  const overallProgress = useMemo(() => {
    if (!languageStatuses.length) return 0;
    const completed = languageStatuses.filter((l) => l.status === "complete").length;
    return Math.round((completed / languageStatuses.length) * 100);
  }, [languageStatuses]);

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

  // ─── History Panel ───
  const [showHistory, setShowHistory] = useState(false);
  const saveHistoryMutation = useMutation(api.history.saveToHistory);

  // ─── Auto-load project on mount via Convex ───
  useEffect(() => {
    if (!latestProject) return;
    // Auto-restore project state — no Resume button needed
    setProjectId(latestProject._id);
    setSourceText(latestProject.fullText);
    setPdfFileName(latestProject.fileName);
    setPdfPageCount(latestProject.pageCount);
    setPageData(latestProject.pageData);
    setOriginalPageTexts(latestProject.pageData.map((p: any) => p.text));
    setParsePhase("done");
  }, [latestProject]);

  // C6: Auto-sync isTranslating with Convex DB state
  useEffect(() => {
    if (!convexProject) return;
    if (convexProject.status === "all_translated" || convexProject.status === "complete") {
      setIsTranslating(false);
    } else if (convexProject.status === "translating") {
      setIsTranslating(true);
    } else if (convexProject.status === "cancelled" || convexProject.status === "ready" || convexProject.status === "error") {
      setIsTranslating(false);
    }
  }, [convexProject]);

  // Update history on completion
  useEffect(() => {
    if (!convexProject || !isAllComplete) return;
    saveHistoryMutation({
      sessionId,
      projectId: convexProject._id,
      fileName: convexProject.fileName,
      pageCount: convexProject.pageCount,
      wordCount: convexProject.wordCount,
      status: "complete",
      languagesCompleted: completedCount,
      zipUrl: convexProject.zipUrl,
    });
  }, [isAllComplete, convexProject, completedCount, sessionId, saveHistoryMutation]);




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
    // progress state managed by Convex

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
        sessionId,
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
  }, [projectId, sessionId, deleteProjectMutation, storePdfAction, createProjectMutation, parsePdfAction]);

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
    const exportData = {
      type: "onyx-translate-project" as const,
      version: 1,
      exportedAt: new Date().toISOString(),
      project: {
        fileName: convexProject.fileName,
        pageCount: convexProject.pageCount,
        wordCount: convexProject.wordCount,
        fullText: convexProject.fullText,
        status: convexProject.status,
      },
      translations: activeTranslations.map((t) => ({
        langCode: t.langCode,
        totalChunks: t.totalChunks,
        completedChunks: t.completedChunks,
        mergedText: t.mergedText,
        status: t.status,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `onyx-translate-${convexProject.fileName.replace(/\.pdf$/i, "")}-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [convexProject, activeTranslations]);

  const importProjectAction = useAction(api.importProject.importProject);
  const handleImportProgress = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const result = await importProjectAction({
          sessionId,
          exportJson: text,
        });
        if (result.success && result.projectId) {
          // Switch to the imported project
          setProjectId(result.projectId);
          setTranslationError(null);
          setIsTranslating(false);
          setCurrentPreviewLangCode(null);
          // Auto-select imported languages so Begin button is ready
          const importedLangs = (result as any).importedLangCodes || [];
          if (importedLangs.length > 0) {
            setSelectedLangCodes(importedLangs);
            setCurrentPreviewLangCode(importedLangs[0]);
          }
          toast.success(
            `Imported ${(result as any).fileName || "project"} — ${importedLangs.length} language(s) ready`,
          );
        }
      } catch (err) {
        setTranslationError(`Import failed: ${err instanceof Error ? err.message : "invalid file"}`);
      }
    };
    input.click();
  }, [importProjectAction, sessionId]);
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
    // progress state managed by Convex
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
    if (!sourceText.trim()) {
      setTranslationError("No text to translate — upload a PDF or paste text first");
      return;
    }
    if (isTranslating) {
      setTranslationError("Translation already in progress");
      return;
    }

    try {
      setIsTranslating(true);
      setTranslationError(null);

      // If no project exists (pasted text, not PDF), create one now
      let activeProjectId = projectId;
      if (!activeProjectId) {

        activeProjectId = await createProjectMutation({
          sessionId,
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
      if (langs.length === 0) {
        setTranslationError("Select at least one language");
        setIsTranslating(false);
        return;
      }


      // UNIFIED: One action call kicks off the chain — each language chains to the next via scheduler
      await translateLanguageAction({
        projectId: activeProjectId,
        langCode: langs[0],
        marketContext,
        nextLangCode: langs.length > 1 ? langs[1] : undefined,
        remainingLangs: langs.length > 2 ? langs.slice(2) : undefined,
      });

      // Save to history
      saveHistoryMutation({
        sessionId,
        projectId: activeProjectId,
        fileName: pdfFileName || "Pasted Text",
        pageCount: pdfPageCount || 1,
        wordCount: sourceText.split(/\s+/).filter(Boolean).length,
        status: "in_progress",
        languagesCompleted: 0,
      });
    } catch (error) {
      console.error("Translation action failed:", error);
      setTranslationError(
        error instanceof Error ? error.message : "Failed to start translation"
      );
      setIsTranslating(false);
    }
  }, [sourceText, projectId, sessionId, selectedLangCodes, translateLanguageAction, createProjectMutation, marketContext, isTranslating, flowPhase]);

  // ─── Retranslate: cancel queue, delete language chunks, restart queue ───

  const handlePause = useCallback(async () => {
    if (!projectId) return;
    try {
      await cancelTranslationAction({ projectId });
      setIsTranslating(false);
      // Don't change flowPhase — keep showing progress panel
    } catch (error) {
      console.error("Failed to pause:", error);
    }
  }, [projectId, cancelTranslationAction]);

  const handleRetranslate = useCallback(
    async (langCode: string) => {
      if (!projectId) return;
      try {
        setIsTranslating(true);
        setTranslationError(null);
        // Delete old chunks for this language
        await deleteChunksForLangMutation({ projectId, langCode });
        // Restart autonomous queue
        await translateLanguageAction({ projectId, langCode, marketContext });
      } catch (error) {
        setTranslationError(
          error instanceof Error ? error.message : "Retranslate failed"
        );
        setIsTranslating(false);
      }
    },
    [projectId, deleteChunksForLangMutation, translateLanguageAction, marketContext]
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

      setPdfProgress(null);
    } catch (error) {
      console.error("PDF generation failed:", error);
      setTranslationError(
        error instanceof Error ? error.message : "PDF generation failed"
      );
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
    <div className="min-h-screen bg-background text-foreground app-bg-pattern">
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
              <span className="text-base font-semibold tracking-tight logo-gradient">
                Onyx Translate
              </span>
              <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">
                PDF Localization Tool
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Status Badge — Royal */}
            <div
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                flowPhase === "idle" && "border-gray-700 bg-gray-800/50 text-gray-400",
                flowPhase === "translating" && "border-yellow-500/50 bg-yellow-900/30 text-yellow-300 animate-royal-glow",
                flowPhase === "all-complete" && "border-green-500/50 bg-green-900/30 text-green-300",
              )}
            >
              {flowPhase === "idle" && <Circle className="w-3 h-3" />}
              {flowPhase === "translating" && <Loader2 className="w-3 h-3 animate-spin" />}
              {flowPhase === "all-complete" && <CheckCircle2 className="w-3 h-3" />}
              <span>
                {flowPhase === "idle" && "Ready"}
                {flowPhase === "translating" && `Translating (${completedCount}/${activeTranslations.length || targetLanguages.length})`}
                {flowPhase === "all-complete" && "All Complete"}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px]" style={{ borderColor: 'rgba(0,229,255,0.3)', color: '#00e5ff' }}>
              <Zap className="size-2.5 mr-1" /> Gemini
            </Badge>
            <Badge variant="outline" className="text-[10px] hidden sm:inline-flex" style={{ borderColor: 'rgba(0,229,255,0.3)', color: '#00e5ff' }}>
              {targetLanguages.length} Languages
            </Badge>
            <div className="flex items-center gap-1 ml-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setShowHistory(true)}
                title="Translation History"
              >
                <Clock className="size-3.5" style={{ color: '#a78bfa' }} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[9px] px-1.5 sm:text-[10px]"
                onClick={handleExportProgress}
                title="Export progress"
              >
                <FileUp className="size-3 mr-1" /> Export
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[9px] px-1.5 sm:text-[10px]"
                onClick={handleImportProgress}
                title="Import progress"
              >
                <FileDown className="size-3 mr-1" /> Import
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-6">

        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          {/* Left Panel */}
          <div className="space-y-4">
            {/* Step 1: Upload */}
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden royal-card">
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

                {/* Auto-resume indicator — show when project exists but flowPhase hasn't caught up yet */}
                {latestProject && convexProject && !isUploading && !pdfFileName && activeTranslations.length > 0 && flowPhase === "idle" && convexProject.status !== "ready" && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 p-2.5 rounded-lg text-[11px]" style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.10)' }}>
                      <CheckCircle2 className="size-3.5 shrink-0 mt-0.5" style={{ color: '#00e5ff' }} />
                      <span>
                        Previous translation detected — <strong>{completedCount}/{activeTranslations.length}</strong> languages done.
                        Server is still working.
                      </span>
                    </div>
                    <Button
                      onClick={() => {
                        setIsTranslating(true);
                      }}
                      className="w-full h-8 text-[11px]"
                      size="sm"
                    >
                      <Globe className="size-3 mr-1" /> View Progress
                    </Button>
                    <Button
                      onClick={() => {
                        if (projectId) deleteProjectMutation({ projectId });
                        setProjectId(null);
                      }}
                      variant="outline"
                      className="w-full h-8 text-[11px]"
                      size="sm"
                    >
                      <RotateCcw className="size-3 mr-1" /> Start Fresh
                    </Button>
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
                        // progress state managed by Convex
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
                      className="w-full h-9 btn-royal-hover"
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

            {/* ─── ROYAL PROGRESS PANEL ─── */}
            {flowPhase !== "idle" && (
              <div
                className="rounded-xl overflow-hidden"
                style={{
                  background: 'rgba(10,10,22,0.9)',
                  border: '1px solid rgba(0,229,255,0.12)',
                  boxShadow: '0 0 20px rgba(167,139,250,0.06), inset 0 1px 0 rgba(0,229,255,0.05)',
                }}
              >
                <RoyalProgressPanel
                  languages={languageStatuses}
                  activeIndex={activeLangIndex}
                  overallProgress={overallProgress}
                  projectName={convexProject?.fileName ?? "Untitled"}
                  isPaused={!isTranslating && flowPhase === "translating" && completedCount > 0}
                  onResume={() => {
                    setIsTranslating(true);
                    if (projectId) { const incomplete = activeTranslations.filter((t) => t.status !== "complete").map((t) => t.langCode); if (incomplete.length > 0) { translateLanguageAction({ projectId, langCode: incomplete[0], marketContext, nextLangCode: incomplete.length > 1 ? incomplete[1] : undefined, remainingLangs: incomplete.length > 2 ? incomplete.slice(2) : undefined }); } };
                  }}
                  onPause={handlePause}
                  onDownload={handleDownloadAllZIP}
                  onStartFresh={clearSource}
                />
                {translationError && !isTranslating && (
                  <div className="mx-4 mb-4 flex items-start gap-1.5 p-1.5 rounded bg-red-500/5 border border-red-500/20 text-[10px]">
                    <XCircle className="size-2.5 text-red-500 shrink-0 mt-0.5" />
                    <span>{translationError}</span>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* ─── RIGHT PANEL: Preview + Language Accordion ─── */}
          <div className="space-y-4 min-w-0">
            {(flowPhase !== "idle" || (convexTranslations && convexTranslations.length > 0)) && (
              <div
                className="rounded-xl overflow-hidden flex flex-col royal-card"
                style={{
                  background: 'rgba(10,10,22,0.9)',
                  border: '1px solid rgba(0,229,255,0.12)',
                  boxShadow: '0 0 20px rgba(0,229,255,0.04), inset 0 1px 0 rgba(0,229,255,0.05)',
                  minHeight: '500px',
                }}
              >
                {/* Preview Header */}
                <div
                  className="px-4 py-3 flex items-center justify-between shrink-0"
                  style={{ borderBottom: '1px solid rgba(0,229,255,0.08)' }}
                >
                  <div className="flex items-center gap-2">
                    <span className="size-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #00e5ff, #a78bfa)', color: '#06060e' }}>
                      3
                    </span>
                    <span className="text-xs font-semibold">Preview</span>
                    {currentLang && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#00e5ff', background: 'rgba(0,229,255,0.08)' }}>
                        {currentLang.name} ({currentLanguageIndex + 1}/{activeTranslations.length || targetLanguages.length})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleCopyTranslation}
                    disabled={!currentTranslation}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border disabled:opacity-30"
                    style={{
                      color: copiedPreview ? '#34d399' : '#a78bfa',
                      borderColor: copiedPreview ? 'rgba(52,211,153,0.3)' : 'rgba(167,139,250,0.3)',
                      background: copiedPreview ? 'rgba(52,211,153,0.08)' : 'rgba(167,139,250,0.08)',
                    }}
                  >
                    {copiedPreview ? <Check className="size-3" /> : <Copy className="size-3" />}
                    {copiedPreview ? 'Copied' : 'Copy'}
                  </button>
                </div>

                {/* Live preview text */}
                <div className="flex-1 overflow-auto">
                  {currentTranslation ? (
                    <div
                      className="p-4 text-sm leading-relaxed whitespace-pre-wrap min-h-[200px]"
                      style={{
                        direction: (currentLang && ['ar', 'ur', 'ks'].includes(currentLang.code)) ? 'rtl' : 'ltr',
                        textAlign: (currentLang && ['ar', 'ur', 'ks'].includes(currentLang.code)) ? 'right' : 'left',
                        lineHeight: '1.8',
                        color: 'rgba(226,232,240,0.85)',
                      }}
                    >
                      {currentTranslation}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                      <Loader2 className="size-5 animate-spin mb-2" style={{ color: '#a78bfa' }} />
                      <span className="text-xs">
                        {inProgressTranslation ? `Translating ${targetLanguages.find((l) => l.code === inProgressTranslation.langCode)?.name}...` : 'Waiting for translation...'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Language Accordion */}
                {projectId && (
                  <div
                    className="shrink-0"
                    style={{ borderTop: '1px solid rgba(0,229,255,0.08)' }}
                  >
                    <LanguageAccordion
                      projectId={projectId}
                      languages={targetLanguages}
                      translations={activeTranslations.map((t) => ({
                        langCode: t.langCode,
                        status: t.status,
                        totalChunks: t.totalChunks,
                        completedChunks: t.completedChunks,
                        mergedText: t.mergedText,
                        pdfUrl: t.pdfUrl,
                        pdfGenerating: t.pdfGenerating,
                      }))}
                      activeLangCode={currentPreviewLangCode ?? inProgressTranslation?.langCode ?? null}
                      onLanguageSelect={(code) => setCurrentPreviewLangCode(code)}
                    />
                  </div>
                )}

                {/* Download ZIP when all complete */}
                {isAllComplete && (
                  <div className="p-4" style={{ borderTop: '1px solid rgba(52,211,153,0.15)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="size-4" style={{ color: '#34d399' }} />
                      <span className="text-xs font-semibold" style={{ color: '#34d399' }}>
                        {completedCount} translation{completedCount !== 1 ? 's' : ''} complete!
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={handleDownloadAllZIP} className="flex-1 h-8 text-[11px]" disabled={isDownloadingZip}>
                        <Package className="size-3 mr-1.5" /> Download All ZIP
                      </Button>
                      <Button onClick={clearSource} variant="outline" className="h-8 text-[11px]">
                        <RotateCcw className="size-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
      {/* History Panel */}
      <HistoryPanel
        open={showHistory}
        onClose={() => setShowHistory(false)}
        sessionId={sessionId}
      />
    </div>
  );
}
