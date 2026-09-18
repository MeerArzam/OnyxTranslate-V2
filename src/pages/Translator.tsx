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
  CheckCheck,
  Copy,
  Check,
  FlaskConical,
  ListChecks,
  Camera,
  Clock,
  Zap,
  Circle,
  FileText,
  CloudUpload,
  Type,
  FolderOpen,
  Plus,
  DatabaseBackup,
  Download,
} from "lucide-react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { UploadJobCard } from "@/components/UploadJobCard";
import { YourJobsPanel } from "@/components/YourJobsPanel";
import { LanguageAccordion } from "@/components/LanguageAccordion";
import RoyalProgressPanel from "@/components/RoyalProgressPanel";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
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
import { useQuery, useMutation, useAction, useConvex } from "convex/react";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
// PHASE 2: server-first identity + hybrid upload + server-side export/import
import { getClientId, getTabSessionId, listStagingRecords, deleteStagingRecord, saveStagingRecord, type UploadStagingRecord } from "@/lib/identity";
import {
  uploadAndCreateJob,
  uploadLargeFile,
  uploadAndImport,
  PATH1_MAX_BYTES,
  fetchExportBlobUrl,
} from "@/lib/translator/serverUpload";

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
  // ─── PHASE 2 identity: durable device id + per-tab session id ───
  // localStorage `onyx-client-id` (device, durable) + sessionStorage
  // `onyx-tab-session-id` (tab, fresh). The legacy `onyx-session-id` key is
  // kept as this tab's session value so existing session-scoped queries
  // (C1 isolation, history) continue to work unchanged.
  const [clientId] = useState(() => getClientId());
  const [sessionId] = useState(() => {
    if (typeof window === "undefined") return "ssr-fallback";
    const tab = getTabSessionId();
    const legacy = sessionStorage.getItem("onyx-session-id");
    if (legacy === tab) return tab;
    sessionStorage.setItem("onyx-session-id", tab);
    return tab;
  });
  const tabSessionId = sessionId; // one value, two names — clarity at call sites

  // ─── Convex server-side actions ───
  const parsePdfAction = useAction(api.parsePdf.parseUploadedPdf);
  const translateLanguageAction = useAction(api.translateContent.translateLanguage);
  const cancelTranslationAction = useAction(api.translateQueue.cancelTranslation);
  const translateImageAction = useAction(api.translateImage.translateImage);
  // ADAPTIVE PARALLEL PIPELINE (feature flag routing): Begin uses the
  // adaptive dispatcher (parallel, rate-limited, resumable, quota-aware);
  // on a verified failure the user can fall back to the legacy chain.
  const startAdaptiveAction = useAction(api.adaptiveJobs.startAdaptiveTranslation);

  const convexClient = useConvex();

  // ─── Convex database state ───
  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);
  const createProjectMutation = useMutation(api.mutations.createProject);
  const deleteProjectMutation = useMutation(api.mutations.deleteProject);
  const deleteChunksForLangMutation = useMutation(api.mutations.deleteChunksForLang);

  // ─── Convex reactive subscriptions ───
  const latestProject = useQuery(api.queries.getLatestProject, { sessionId });
  // Phase E3: recent jobs for this session (compact cards)
  const sessionProjects = useQuery(api.queries.getSessionProjects, { sessionId });
  const convexProject = useQuery(
    api.queries.getProject,
    projectId ? { projectId, sessionId } : "skip"
  );
  // ADAPTIVE PIPELINE: honest pipeline-state strip (governor, quota, workers)
  const adaptiveRateRow = useQuery(
    api.queries.getProjectRateSummary,
    projectId ? { projectId } : "skip"
  );
  // RELIABILITY PASS: honest server-side job state (P1/P5) — drives the
  // Resume Server Job button and the hosting-paused / stalled banners.
  const serverJobStatus = useQuery(
    api.resumeServerProject.getServerJobStatus,
    projectId ? { projectId } : "skip"
  );
  const resumeServerProjectAction = useAction(api.resumeServerProject.resumeServerProject);
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

  // ─── Phase E: Google-style segmented tabs (Documents | Text | Images) ───
  const [inputTab, setInputTab] = useState<"documents" | "text" | "images">("documents");
  const [view, setView] = useState<"input" | "job">("input");

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

  // Phase E2: job view is state-driven (never gates on local flowPhase)
  const isJobView = view === "job" && (flowPhase !== "idle" || (convexTranslations?.length ?? 0) > 0);

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

  // ─── PHASE 2: server-first upload state ───
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [activeUploadJobId, setActiveUploadJobId] = useState<Id<"uploadJobs"> | null>(null);
  const [serverHandoffAck, setServerHandoffAck] = useState(false);
  const [activeUploadError, setActiveUploadError] = useState<string | null>(null);
  const [pendingStaging, setPendingStaging] = useState<UploadStagingRecord[]>([]);
  const [showYourJobs, setShowYourJobs] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadStartRef = useRef<number>(0);

  // PHASE 2: this device's own past/active jobs (never another device's).
  const resumableJobs = useQuery(api.identity.getResumableJobs, { clientId, limit: 12 });
  // Live progress for an in-flight upload job (status + stage chips).
  const activeUploadJob = useQuery(
    api.identity.getUploadJob,
    activeUploadJobId ? { uploadJobId: activeUploadJobId, clientId } : "skip"
  );

  // PHASE 2: interrupted uploads (staging records) → "Resume upload / Discard".
  useEffect(() => {
    listStagingRecords().then((rows) => {
      if (rows.length > 0) setPendingStaging(rows);
    });
  }, []);

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
    // FIX (1MiB limit): if pageData/fullText were offloaded to Storage, fetch
    // them from their storage URLs before restoring (small projects: identical
    // synchronous restore, unchanged).
    const p = latestProject as typeof latestProject & {
      pageDataStorageId?: string;
      fullTextStorageId?: string;
    };
    const applyProject = (fullText: string, pageData: any[]) => {
      setProjectId(latestProject._id);
      setSourceText(fullText);
      setPdfFileName(latestProject.fileName);
      setPdfPageCount(latestProject.pageCount);
      setPageData(pageData);
      setOriginalPageTexts(pageData.map((pg: any) => pg.text));
      setParsePhase("done");
    };
    const inlinePageData = (latestProject.pageData ?? []) as any[];
    const needsFetch =
      (!latestProject.fullText && p.fullTextStorageId) ||
      (inlinePageData.length === 0 && p.pageDataStorageId);
    if (!needsFetch) {
      applyProject(latestProject.fullText, inlinePageData);
      return;
    }
    (async () => {
      try {
        let fullText = latestProject.fullText || "";
        let pageData = inlinePageData;
        if (p.fullTextStorageId && !fullText) {
          const r = await convexClient.query(api.sourceData.getSourceDataUrls, { projectId: latestProject._id });
          const url = (r as { fullTextUrl?: string | null }).fullTextUrl;
          if (url) fullText = (JSON.parse(await (await fetch(url)).text()) as string) ?? "";
        }
        if (p.pageDataStorageId && pageData.length === 0) {
          const r = await convexClient.query(api.sourceData.getSourceDataUrls, { projectId: latestProject._id });
          const url = (r as { pageDataUrl?: string | null }).pageDataUrl;
          if (url) pageData = (JSON.parse(await (await fetch(url)).text()) as unknown[]) ?? [];
        }
        applyProject(fullText, pageData);
      } catch (err) {
        console.error("[Onyx] source-data fetch failed, restoring inline only:", err);
        applyProject(latestProject.fullText, inlinePageData);
      }
    })();
  }, [latestProject, convexClient]);

  // Phase E2: land on the Job view whenever this session has a job running
  // or finished (not a fresh "ready" upload the user hasn't started yet).
  useEffect(() => {
    if (latestProject && latestProject.status !== "ready") {
      setView("job");
    }
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




  // ─── PHASE 2: SERVER-FIRST upload — the browser only picks the file and
  // POSTs raw bytes. Parsing/chunking/translation/PDF/ZIP all run server-side.
  // NO artificial limits: every file processes; real errors surface verbatim.
  const handleFileSelect = useCallback(async (file: File | null) => {
    if (!file) {
      console.debug("[Onyx] handleFileSelect: no file provided");
      return;
    }
    console.debug("[Onyx] handleFileSelect", { name: file.name, size: file.size });

    setIsUploading(true);
    setUploadError(null);
    setActiveUploadError(null);
    setUploadPercent(0);
    setServerHandoffAck(false);
    setParseProgress(null);
    setParsePhase("loading");
    resetFlow();
    // Discard any previous saved progress when uploading a new file
    if (projectId) {
      await deleteProjectMutation({ projectId }).catch(() => {});
    }

    const controller = new AbortController();
    uploadAbortRef.current = controller;
    uploadStartRef.current = Date.now();

    // PHASE 2 staging record — persisted BEFORE any network work (spec A), so
    // an interrupted upload can be offered as "Resume upload" on reopen.
    const idempotencyKey = crypto.randomUUID();
    await saveStagingRecord({
      uploadId: idempotencyKey,
      fileName: file.name,
      size: file.size,
      langCodes: selectedLangCodes,
      path: file.size <= PATH1_MAX_BYTES ? 1 : 2,
      createdAt: Date.now(),
    });

    try {
      setParsePhase("parsing");
      // NO client parsing — the file is posted RAW. The server parses with the
      // production parser (x-gap merge + paragraph clustering).
      if (file.size <= PATH1_MAX_BYTES) {
        // PATH 1 — ONE request: raw POST → server stores + schedules processing.
        const handle = await uploadAndCreateJob({
          file,
          clientId,
          tabSessionId,
          langCodes: selectedLangCodes,
          idempotencyKey,
          onProgress: (loaded, total) => setUploadPercent(Math.round((loaded / total) * 100)),
          signal: controller.signal,
        });
        await deleteStagingRecord(idempotencyKey);
        setActiveUploadJobId(handle.uploadJobId);
        setUploadPercent(100);
        setPdfFileName(file.name);
        setParsePhase("done");
      } else {
        // PATH 2 — staged direct upload with progress % + cancel.
        const handle = await uploadLargeFile({
          file,
          clientId,
          tabSessionId,
          langCodes: selectedLangCodes,
          convex: { mutation: (ref, args) => convexClient.mutation(ref as never, args as never) },
          onProgress: (loaded, total) => setUploadPercent(Math.round((loaded / total) * 100)),
          signal: controller.signal,
        });
        await deleteStagingRecord(idempotencyKey);
        setActiveUploadJobId(handle.uploadJobId);
        setUploadPercent(100);
        setPdfFileName(file.name);
        setParsePhase("done");
      }
      // The reactive `activeUploadJob` subscription drives the per-stage chips
      // and the "Safe to close" indicator once the server ACKs the handoff.
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Onyx] upload failed:", message);
      setActiveUploadError(message);
      setUploadError(message);
      setParsePhase("idle");
    } finally {
      uploadAbortRef.current = null;
      setIsUploading(false);
    }
  }, [projectId, clientId, tabSessionId, selectedLangCodes, deleteProjectMutation]);

  // PHASE 2: cancel an in-flight upload (real cancel — aborts the XHR).
  const handleCancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
    setActiveUploadError("Upload cancelled");
    setUploadPercent(null);
  }, []);

  // PHASE 2: when the server pipeline attaches a project to the upload job,
  // adopt it into this tab — the tab may close any time after the ACK.
  useEffect(() => {
    const pid = activeUploadJob?.projectId;
    if (pid && !projectId) {
      setProjectId(pid as Id<"projects">);
      setView("job");
    }
    if (
      activeUploadJob &&
      ["processing", "parsed", "ready", "translating", "generating_pdf", "assembling_zip", "complete"].includes(activeUploadJob.status)
    ) {
      setServerHandoffAck(true);
    }
  }, [activeUploadJob, projectId]);

  // PHASE 2 EXPORT — server assembles the FULL JSON backup (metadata, fullText,
  // pageData coordinates, parsedPages, chunks, translations + statuses,
  // langCodes) into Convex Storage; the browser only triggers the save.
  // Unconditional: works idle, paused, mid-translation, or complete.
  const buildExportAction = useAction(api.exportProject.buildExportArtifact);
  const buildZipNowAction = useAction(api.exportProject.buildZipNow);
  const issueExportToken = useMutation(api.artifactMutations.issueExportToken); // server-defined as mutation
  const [isExporting, setIsExporting] = useState(false);
  const handleExportBackup = useCallback(async () => {
    if (!projectId) {
      toast.info("Nothing to export yet — upload a PDF or start a project first.");
      return;
    }
    setIsExporting(true);
    try {
      // PHASE 3 client-path fix: browsers ignore the anchor `download`
      // attribute on cross-origin URLs, so the old direct-storage anchor
      // never produced a download event. Build server-side, then fetch through
      // the token endpoint and save from a same-origin blob URL.
      const artifact = await buildExportAction({ projectId });
      if (!artifact.ok) throw new Error("Server failed to assemble the export artifact");
      const { blobUrl } = await fetchExportBlobUrl({
        projectId,
        fileName: `${(pdfFileName || "onyx-project").replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")}_backup.json`,
        issueToken: issueExportToken,
      });
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${(pdfFileName || "onyx-project").replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")}_backup.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      toast.success("Export ready — JSON backup downloaded.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[Onyx] export failed:", message);
      toast.error(`Export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  }, [projectId, pdfFileName, buildExportAction, issueExportToken]);

  // PHASE 2 IMPORT — one raw POST; server validates before any write and
  // restores the project server-side. Browser may close once the toast shows.
  const importInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const handleImportFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setIsImporting(true);
      try {
        const res = await uploadAndImport({ file, clientId, tabSessionId });
        setProjectId(res.jobId as Id<"projects">);
        setCurrentPreviewLangCode(res.importedLangCodes[0] ?? null);
        setView("job");
        toast.success(`Imported ${file.name} — ${res.importedLangCodes.length} language(s) ready. Server is restoring progress.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[Onyx] import failed:", message);
        toast.error(`Import failed: ${message}`);
      } finally {
        setIsImporting(false);
        if (importInputRef.current) importInputRef.current.value = "";
      }
    },
    [clientId, tabSessionId]
  );

  // PHASE 2: adopt one of THIS DEVICE's past jobs from a previous tab/session.
  const adoptJobMutation = useMutation(api.identity.adoptJob);
  const handleAdoptJob = useCallback(
    async (pid: Id<"projects">) => {
      try {
        await adoptJobMutation({ projectId: pid, clientId, tabSessionId, sessionId });
        setProjectId(pid);
        setShowYourJobs(false);
        setView("job");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not open that job");
      }
    },
    [adoptJobMutation, clientId, tabSessionId, sessionId]
  );

  // PHASE 2: retry a failed upload with the SAME idempotency key (no duplicates).
  const handleRetryUpload = useCallback(
    async (stagingRec: UploadStagingRecord) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pdf,application/pdf";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        setIsUploading(true);
        setActiveUploadError(null);
        setUploadPercent(0);
        setServerHandoffAck(false);
        try {
          if (file.size <= PATH1_MAX_BYTES) {
            const handle = await uploadAndCreateJob({
              file,
              clientId,
              tabSessionId,
              langCodes: stagingRec.langCodes,
              idempotencyKey: stagingRec.uploadId, // SAME key → no duplicate jobs
              onProgress: (loaded, total) => setUploadPercent(Math.round((loaded / total) * 100)),
            });
            await deleteStagingRecord(stagingRec.uploadId);
            setActiveUploadJobId(handle.uploadJobId);
            setUploadPercent(100);
            setPdfFileName(file.name);
            setParsePhase("done");
          } else {
            const handle = await uploadLargeFile({
              file,
              clientId,
              tabSessionId,
              langCodes: stagingRec.langCodes,
              convex: { mutation: (ref, args) => convexClient.mutation(ref as never, args as never) },
              onProgress: (loaded, total) => setUploadPercent(Math.round((loaded / total) * 100)),
            });
            await deleteStagingRecord(stagingRec.uploadId);
            setActiveUploadJobId(handle.uploadJobId);
            setUploadPercent(100);
            setPdfFileName(file.name);
            setParsePhase("done");
          }
          setPendingStaging((prev) => prev.filter((r) => r.uploadId !== stagingRec.uploadId));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setActiveUploadError(message);
          toast.error(`Retry failed: ${message}`);
        } finally {
          setIsUploading(false);
        }
      };
      input.click();
    },
    [clientId, tabSessionId, convexClient]
  );

  const handleDiscardStaging = useCallback(async (uploadId: string) => {
    await deleteStagingRecord(uploadId);
    setPendingStaging((prev) => prev.filter((r) => r.uploadId !== uploadId));
  }, []);


  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
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

  const startTranslation = useCallback(
    async () => {
    const text = sourceText;
    const langs = selectedLangCodes.length > 0 ? selectedLangCodes : targetLanguages.map((l) => l.code);
    const existingProjectId = projectId;
    if (!text.trim()) {
      setTranslationError("No text to translate — upload a PDF or paste text first");
      return;
    }
    if (isTranslating) {
      setTranslationError("Translation already in progress");
      return;
    }

    try {      setIsTranslating(true);
      setTranslationError(null);

      // If no project exists (pasted text, not PDF), create one now
      let activeProjectId = existingProjectId;
      if (!activeProjectId) {


        activeProjectId = await createProjectMutation({
          sessionId,
          fileName: "Pasted Text",
          pageCount: 1,
          wordCount: text.split(/\s+/).filter(Boolean).length,
          pageData: [],
          fullText: text,
          parsedPages: 1,
          status: "ready",
        });
        setProjectId(activeProjectId);

      }

      if (langs.length === 0) {
        setTranslationError("Select at least one language");
        setIsTranslating(false);
        return;
      }


      // ── ADAPTIVE PARALLEL PIPELINE (default): one action enqueues every
      // (language, chunk) as an idempotent job and starts the server-side
      // dispatcher — parallel, rate-limited, resumable, quota-aware. The
      // browser can close; the server continues.
      try {
        const adaptive = await startAdaptiveAction({
          projectId: activeProjectId,
          langCodes: langs,
        });
        if (!adaptive.started) {
          throw new Error("adaptive_start_failed");
        }
        console.debug("[Onyx] adaptive dispatcher started", {
          projectId: activeProjectId,
          jobs: adaptive.totalJobs,
        });
      } catch (adaptiveErr) {
        // Fallback (visible in console + toast): legacy scheduler chain.
        console.warn(
          "[Onyx] adaptive start failed — falling back to legacy chain",
          adaptiveErr
        );
        toast.error(
          "Adaptive pipeline unavailable — using legacy chain. " +
            (adaptiveErr instanceof Error ? adaptiveErr.message : "")
        );
        await translateLanguageAction({
          projectId: activeProjectId,
          langCode: langs[0],
          marketContext,
          nextLangCode: langs.length > 1 ? langs[1] : undefined,
          remainingLangs: langs.length > 2 ? langs.slice(2) : undefined,
        });
      }

      // Phase E2: job starts → land on the Job view
      setView("job");

      // Save to history
      saveHistoryMutation({
        sessionId,
        projectId: activeProjectId,
        fileName: pdfFileName || "Pasted Text",
        pageCount: pdfPageCount || 1,
        wordCount: text.split(/\s+/).filter(Boolean).length,
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
  }, [sourceText, projectId, sessionId, selectedLangCodes, translateLanguageAction, startAdaptiveAction, createProjectMutation, marketContext, isTranslating, flowPhase, pdfFileName, pdfPageCount, saveHistoryMutation]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      console.debug("[Onyx] handleDrop fired", file ? `${file.name} (${file.size} bytes)` : "(no file)");
      handleFileSelect(file || null);
    },
    [handleFileSelect]
  );

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

  // FIX 5b: Watchdog resume — find languages that died mid-flight (stalled
  // heartbeat or left incomplete after a crash) and re-invoke the server
  // chain from the first incomplete one. Also revives a project stuck on
  // "translating" with no active server work.
  // RELIABILITY PASS (P1): safe server-side recovery — never resets progress,
  // never duplicates jobs; shows the recovery report from the server.
  const handleResumeServerJob = useCallback(async () => {
    if (!projectId) return;
    try {
      setIsTranslating(true);
      setTranslationError(null);
      const langs =
        activeTranslations.map((t) => t.langCode).length > 0
          ? activeTranslations.map((t) => t.langCode)
          : selectedLangCodes;
      const report = (await resumeServerProjectAction({
        projectId,
        langCodes: langs,
      })) as {
        ok: boolean;
        reason?: string;
        promoted?: number;
        reclaimed?: number;
        done?: number;
        pending?: number;
      };
      if (report.ok) {
        toast.success(
          `Server job resumed — ${report.done ?? 0} done, ${report.pending ?? 0} pending` +
            (report.reclaimed ? `, ${report.reclaimed} stale claim(s) reclaimed` : "") +
            ". Server continues even if you close this page (while the hosting deployment is active).",
        );
      } else {
        toast.info(`Recovery: ${report.reason ?? "nothing to resume"}`);
      }
    } catch (err) {
      console.error("Resume Server Job failed:", err);
      setTranslationError(err instanceof Error ? err.message : "Resume Server Job failed");
    } finally {
      setIsTranslating(false);
    }
  }, [projectId, activeTranslations, selectedLangCodes, resumeServerProjectAction]);

  const resumeStalled = useCallback(async () => {
    if (!projectId || isTranslating) return;
    try {
      // ADAPTIVE projects: a kick to startAdaptiveTranslation resumes the
      // dispatcher directly (idempotent enqueue — completed chunks are never
      // re-translated; pending/failed jobs continue where they stopped).
      const isAdaptive = (convexProject as { translationMode?: string } | undefined)
        ?.translationMode === "adaptive_parallel";
      if (isAdaptive) {
        const langs = activeTranslations.map((t) => t.langCode);
        setIsTranslating(true);
        setTranslationError(null);
        await startAdaptiveAction({ projectId, langCodes: langs });
        toast.success("Resumed adaptive pipeline — server continues even if you close this page.");
        return;
      }
      const stalled = (await convexClient.query(api.queries.getStalledLanguages, {
        projectId,
        sessionId,
      })) as string[];
      const incomplete = activeTranslations
        .filter((t) => t.status !== "complete")
        .map((t) => t.langCode);
      // Prefer server-confirmed stalled languages, else any incomplete
      const queue = stalled.length > 0 ? stalled : incomplete;
      if (queue.length === 0) {
        toast.info("Nothing to resume — all languages are complete.");
        return;
      }
      setIsTranslating(true);
      setTranslationError(null);
      await translateLanguageAction({
        projectId,
        langCode: queue[0],
        marketContext,
        nextLangCode: queue.length > 1 ? queue[1] : undefined,
        remainingLangs: queue.length > 2 ? queue.slice(2) : undefined,
      });
      toast.success(`Resuming translation — ${queue.length} language(s) remaining.`);
    } catch (err) {
      console.error("Resume failed:", err);
      setTranslationError(err instanceof Error ? err.message : "Resume failed");
      setIsTranslating(false);
    }
  }, [projectId, isTranslating, sessionId, activeTranslations, translateLanguageAction, startAdaptiveAction, convexProject, marketContext, convexClient]);

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
    <div className="min-h-screen bg-background text-foreground app-bg-pattern safe-pad">
      {/* Sonner toast viewport — toasts were previously invisible (never mounted) */}
      <Toaster
        position="top-center"
        theme="dark"
        toastOptions={{
          style: {
            background: "rgba(12,12,24,0.95)",
            border: "1px solid rgba(0,229,255,0.25)",
            color: "#e8e8f0",
          },
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl" style={{ background: 'rgba(6,6,14,0.85)', borderBottom: '1px solid rgba(0,229,255,0.10)' }}>
        <div className="w-full max-w-[1100px] mx-auto px-4 md:px-6 min-h-14 py-2 flex flex-wrap items-center justify-between gap-y-1">
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
              {/* PHASE 2: Your jobs — this device's resumable/active jobs */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] gap-1"
                onClick={() => setShowYourJobs(true)}
                title="Your jobs on this device"
              >
                <FolderOpen className="size-3.5" style={{ color: '#00e5ff' }} />
                <span className="hidden sm:inline">Your jobs</span>
              </Button>
              {/* PHASE 2: Export — server-built JSON backup, unconditional */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] gap-1"
                onClick={handleExportBackup}
                disabled={isExporting || !projectId}
                title="Export JSON backup (server-built, works anytime)"
              >
                {isExporting ? <Loader2 className="size-3.5 animate-spin" /> : <DatabaseBackup className="size-3.5" style={{ color: '#34d399' }} />}
                <span className="hidden sm:inline">Export</span>
              </Button>
              {/* PHASE 2: Import — one raw POST, server-validated */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] gap-1"
                onClick={() => importInputRef.current?.click()}
                disabled={isImporting}
                title="Import a project JSON backup"
              >
                {isImporting ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" style={{ color: '#a78bfa' }} />}
                <span className="hidden sm:inline">Import</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setShowHistory(true)}
                title="Translation History"
              >
                <Clock className="size-3.5" style={{ color: '#a78bfa' }} />
              </Button>
              <a
                href="#/overview"
                className="h-6 text-[9px] px-1.5 sm:text-[10px] inline-flex items-center justify-center gap-1 rounded-md hover:bg-accent hover:text-accent-foreground"
                style={{ color: "#00e5ff" }}
                title="Live codebase documentation dashboard"
              >
                📋 Overview
              </a>
            </div>
          </div>
        </div>
      </header>

      <div className="w-full max-w-[1100px] mx-auto px-4 md:px-6 py-4 md:py-6">

        {/* ═══ PHASE E: JOB-CENTRIC HOME VIEW ═══ */}
        {isJobView && convexProject ? (
          <div className="space-y-4">
            {/* Job header card */}
            <div className="rounded-xl royal-card overflow-hidden">
              <div className="px-4 py-3.5 flex flex-wrap items-center gap-3">
                <div className="size-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgba(0,229,255,0.08)' }}>
                  <FileText className="size-5" style={{ color: '#00e5ff' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{convexProject.fileName}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {convexProject.pageCount} pages • {convexProject.wordCount.toLocaleString()} words
                  </p>
                </div>
                {/* OnyxTranslate's server-side strength, made visible */}
                <Badge variant="outline" className="text-[10px]" style={{ borderColor: 'rgba(52,211,153,0.4)', color: '#34d399' }}>
                  <CloudUpload className="size-2.5 mr-1" /> Continues even if you close this page — reopen anytime
                </Badge>
                {/* PHASE 3: honest transport observability — which path carried
                    this file to the server (visible even after the upload card
                    auto-hides; independent of no-artificial-limits policy) */}
                {activeUploadJob && (
                  <Badge variant="outline" className="text-[10px]" style={{ borderColor: 'rgba(0,229,255,0.35)', color: '#00e5ff' }}>
                    {activeUploadJob.uploadPath === 2 || (activeUploadJob.fileSize ?? 0) > 19 * 1024 * 1024
                      ? `Large file (${((activeUploadJob.fileSize ?? 0) / (1024 * 1024)).toFixed(1)} MB) — direct upload path`
                      : `Single-request upload (${((activeUploadJob.fileSize ?? 0) / (1024 * 1024)).toFixed(1)} MB)`}
                  </Badge>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-[11px]"
                  onClick={() => {
                    clearSource();
                    setView("input");
                  }}
                >
                  <Plus className="size-3 mr-1" /> New Translation
                </Button>
              </div>
              {/* Overall progress bar */}
              <div className="px-4 pb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Overall progress — {completedCount}/{targetLanguages.length} languages
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: '#00e5ff' }}>{overallProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full royal-shimmer transition-all duration-500"
                    style={{ width: `${overallProgress}%`, background: 'linear-gradient(90deg, #00e5ff, #a78bfa)' }}
                  />
                </div>
              </div>
            </div>

            {/* Per-language job rows */}
            <div className="rounded-xl royal-card overflow-hidden">
              <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
                Languages
              </div>
              <div className="divide-y" style={{ borderColor: 'rgba(0,229,255,0.05)' }}>
                {languageStatuses.map((lang) => {
                  const t = activeTranslations.find((tr) => tr.langCode === lang.code);
                  const isDone = lang.status === "complete";
                  const statusColor =
                    lang.status === "complete" ? '#34d399' :
                    lang.status === "generating_pdf" ? '#fbbf24' :
                    lang.status === "translating" ? '#00e5ff' : 'rgba(255,255,255,0.25)';
                  return (
                    <div key={lang.code} className="px-4 py-2.5 flex items-center gap-3">
                      {isDone ? (
                        <CheckCircle2 className="size-3.5 shrink-0" style={{ color: statusColor }} />
                      ) : lang.status === "translating" ? (
                        <Loader2 className="size-3.5 shrink-0 animate-spin" style={{ color: statusColor }} />
                      ) : (
                        <Circle className="size-3.5 shrink-0" style={{ color: statusColor }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{lang.name} <span className="text-muted-foreground font-normal">{lang.nativeName}</span></p>
                        {lang.chunksTotal > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            {lang.chunksDone}/{lang.chunksTotal} chunks • {lang.wordCount.toLocaleString()} words
                          </p>
                        )}
                      </div>
                      {isDone && (t as { pdfUrl?: string | null } | undefined)?.pdfUrl && (
                        <a
                          href={(t as { pdfUrl?: string | null }).pdfUrl!}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] px-2 py-1 rounded border transition-colors hover:bg-muted/30"
                          style={{ borderColor: 'rgba(52,211,153,0.35)', color: '#34d399' }}
                        >
                          <Download className="size-2.5 inline mr-1" /> PDF
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ZIP — driven purely from Convex state, never flowPhase */}
            <div className="rounded-xl royal-card p-4 flex flex-wrap items-center gap-3">
              <Button
                onClick={handleDownloadAllZIP}
                disabled={!convexProject.zipUrl || isDownloadingZip}
                className="flex-1 h-9 btn-royal-hover"
              >
                <Package className="size-3.5 mr-2" />
                {convexProject.zipUrl ? "Download ZIP" : "ZIP ready when all languages finish"}
              </Button>
              {/* PHASE 2: server-side ZIP assembly on demand (works mid-flight) */}
              {!convexProject.zipUrl && (
                <Button
                  onClick={async () => {
                    if (!projectId) return;
                    setIsDownloadingZip(true);
                    try {
                      await buildZipNowAction({ projectId });
                      toast.success("ZIP assembled server-side — download ready.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "ZIP assembly failed");
                    } finally {
                      setIsDownloadingZip(false);
                    }
                  }}
                  variant="outline"
                  className="h-9 text-[11px]"
                  disabled={isDownloadingZip}
                >
                  {isDownloadingZip ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Package className="size-3.5 mr-1" />}
                  Assemble now
                </Button>
              )}
              {/* PHASE 2: Export JSON backup — unconditional (idle/paused/mid-flight/complete) */}
              <Button
                onClick={handleExportBackup}
                variant="outline"
                className="h-9 text-[11px]"
                disabled={isExporting}
              >
                {isExporting ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <DatabaseBackup className="size-3.5 mr-1" />}
                Export backup
              </Button>
              {translationError && (
                <span className="text-[10px] text-red-400">{translationError}</span>
              )}
            </div>

            {/* Recent jobs (this session) */}
            {(sessionProjects?.length ?? 0) > 1 && (
              <div className="rounded-xl royal-card overflow-hidden">
                <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={{ borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
                  Recent jobs
                </div>
                <div className="divide-y" style={{ borderColor: 'rgba(0,229,255,0.05)' }}>
                  {sessionProjects!.filter((p) => p._id !== convexProject._id).slice(0, 5).map((p) => (
                    <button
                      key={p._id}
                      onClick={() => {
                        setProjectId(p._id);
                        setView("job");
                      }}
                      className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-muted/20 transition-colors"
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-xs font-medium truncate flex-1">{p.fileName}</span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full border shrink-0"
                        style={{
                          color: p.status === "all_translated" ? '#34d399' : p.status === "translating" ? '#00e5ff' : 'rgba(255,255,255,0.4)',
                          borderColor: p.status === "all_translated" ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.12)',
                        }}
                      >
                        {p.status === "all_translated" ? "complete" : p.status}
                      </span>
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4 md:gap-6">
          {/* Left Panel */}
          <div className="space-y-4 min-w-0">
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
                {/* Phase E: Google-style segmented input tabs */}
                <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
                  {(["documents", "text", "images"] as const).map((tab) => {
                    const active = inputTab === tab;
                    return (
                      <button
                        key={tab}
                        onClick={() => setInputTab(tab)}
                        className="flex-1 py-1.5 rounded-md text-[10px] font-medium transition-all duration-150"
                        style={{
                          background: active ? 'rgba(0,229,255,0.15)' : 'transparent',
                          color: active ? '#00e5ff' : 'rgba(255,255,255,0.45)',
                          border: `1px solid ${active ? 'rgba(0,229,255,0.4)' : 'transparent'}`,
                        }}
                      >
                        {tab === "documents" ? "PDF Document" : tab === "text" ? "Paste Text" : "Image / Camera"}
                      </button>
                    );
                  })}
                </div>
                {inputTab === "documents" && (<>
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

                {/* PHASE 2: server-first upload card — % progress, stage chips,
                    honest physics ("Safe to close" only after the server ACK),
                    verbatim errors with the job ID. */}
                <UploadJobCard
                  job={activeUploadJob}
                  fileName={pdfFileName}
                  uploadPercent={uploadPercent}
                  onCancel={handleCancelUpload}
                />

                {/* PHASE 2: interrupted-upload resume offers (staging records) */}
                {pendingStaging.length > 0 && (
                  <div className="p-3 rounded-xl space-y-2" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)' }}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#a78bfa' }}>Unfinished uploads</span>
                    {pendingStaging.map((rec) => (
                      <div key={rec.uploadId} className="flex items-center gap-2">
                        <FileUp className="size-3.5 shrink-0" style={{ color: '#a78bfa' }} />
                        <span className="text-[10px] truncate flex-1">{rec.fileName}</span>
                        <button onClick={() => handleRetryUpload(rec)} className="text-[9px] px-2 py-0.5 rounded border" style={{ borderColor: 'rgba(0,229,255,0.4)', color: '#00e5ff' }}>
                          Resume upload
                        </button>
                        <button onClick={() => handleDiscardStaging(rec.uploadId)} className="text-[9px] px-2 py-0.5 rounded border" style={{ borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)' }}>
                          Discard
                        </button>
                      </div>
                    ))}
                  </div>
                )}

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

                </>
                )}
                {/* ─── Image / Camera Translation ─── */}
                {inputTab === "images" && (
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

                {inputTab === "text" && (
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
                )}

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
                  onResume={resumeStalled}
                  onPause={handlePause}
                  onDownload={handleDownloadAllZIP}
                  onStartFresh={clearSource}
                />
                {/* ADAPTIVE PIPELINE: honest server-state strip (no fake progress) */}
                {adaptiveRateRow && adaptiveRateRow.translationMode === "adaptive_parallel" && (
                  <div className="mx-4 mb-3 px-3 py-2 rounded-lg text-[10px]" style={{ background: "rgba(0,229,255,0.04)", border: "1px solid rgba(0,229,255,0.10)" }}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span style={{ color: "#00e5ff" }}>{adaptiveRateRow.jobsDone}/{adaptiveRateRow.jobsTotal} jobs</span>
                      {adaptiveRateRow.jobsWaiting > 0 && <span style={{ color: "#fbbf24" }}>{adaptiveRateRow.jobsWaiting} waiting (backoff)</span>}
                      {adaptiveRateRow.jobsFailed > 0 && <span className="text-red-400">{adaptiveRateRow.jobsFailed} failed</span>}
                      <span className="text-muted-foreground">workers {adaptiveRateRow.workerLimit} · target {adaptiveRateRow.targetRpm} req/min · {adaptiveRateRow.requestsToday}/{adaptiveRateRow.dailyBudget} requests today</span>
                      {adaptiveRateRow.governorState === "daily_paused" && adaptiveRateRow.governorResumeAt && <span style={{ color: "#fbbf24" }}>quota reached — auto-resumes {new Date(adaptiveRateRow.governorResumeAt).toLocaleTimeString()} · progress saved</span>}
                      {adaptiveRateRow.governorState === "waiting_retry" && <span style={{ color: "#fbbf24" }}>Waiting for Gemini quota — progress is saved.</span>}
                    </div>
                  </div>
                )}
                {/* RELIABILITY PASS: honest platform/stall states + Resume Server Job */}
                {serverJobStatus && serverJobStatus.found && (serverJobStatus.totalJobs > 0 || serverJobStatus.status === "translating") && (
                  <div className="mx-4 mb-3 px-3 py-2 rounded-lg text-[10px] flex flex-wrap items-center gap-x-3 gap-y-1" style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.12)" }}>
                    <span className="text-muted-foreground">
                      server jobs {serverJobStatus.doneJobs}/{serverJobStatus.totalJobs} done · {serverJobStatus.pendingJobs} pending · {serverJobStatus.claimedJobs} claimed · {serverJobStatus.retryWaitJobs} retry-wait
                    </span>
                    {serverJobStatus.requestsToday > 0 && (
                      <span className="text-muted-foreground">{serverJobStatus.requestsToday}/{serverJobStatus.dailyBudget} requests today</span>
                    )}
                    {serverJobStatus.governorState === "daily_paused" && (
                      <span style={{ color: "#fbbf24" }}>
                        Daily quota paused — resumes {serverJobStatus.governorResumeAt ? new Date(serverJobStatus.governorResumeAt).toLocaleString() : "after midnight Pacific"}.
                      </span>
                    )}
                    {!serverJobStatus.serverAlive && serverJobStatus.status !== "all_translated" && serverJobStatus.status !== "complete" && (
                      <span style={{ color: "#f87171" }}>
                        Server job status not currently confirmed (hosting deployment may be paused).
                      </span>
                    )}
                    {!serverJobStatus.serverAlive && serverJobStatus.totalJobs > 0 && (
                      <button
                        onClick={handleResumeServerJob}
                        className="px-2 py-0.5 rounded font-medium transition-all border"
                        style={{ color: "#a78bfa", borderColor: "rgba(167,139,250,0.35)", background: "rgba(167,139,250,0.08)" }}
                      >
                        Resume Server Job
                      </button>
                    )}
                    {serverJobStatus.lastDispatcherError && (
                      <span className="text-red-400" title={serverJobStatus.lastDispatcherError}>last dispatcher error: {serverJobStatus.lastDispatcherError.slice(0, 80)}</span>
                    )}
                  </div>
                )}
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
        )}
      </div>
      {/* PHASE 2: hidden import file input (raw POST → server validation) */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => handleImportFile(e.target.files?.[0] || null)}
      />

      {/* PHASE 2: Your jobs drawer — adopt a device job into this tab */}
      <YourJobsPanel
        open={showYourJobs}
        jobs={resumableJobs}
        currentProjectId={projectId}
        onOpenJob={handleAdoptJob}
        onClose={() => setShowYourJobs(false)}
      />

      {/* History Panel */}
      <HistoryPanel
        open={showHistory}
        onClose={() => setShowHistory(false)}
        sessionId={sessionId}
      />
    </div>
  );
}
