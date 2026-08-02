import { useState, useCallback, useRef } from "react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Languages,
  Download,
  Loader2,
  FileText,
  Sparkles,
  Upload,
  FileUp,
  X,
  Package,
  CheckCircle2,
  XCircle,
  Globe,
  AlertCircle,
  ArrowRight,
  StepForward,
  RotateCcw,
  ChevronRight,
  BookOpen,
  Image,
  FileDown,
  CheckCheck,
} from "lucide-react";
import {
  runTranslationPipeline,
  generateSampleText,
  type TranslationResult,
} from "@/lib/translator/engine";
import {
  parsePDF,
  validateTextForTranslation,
  type PDFParseError,
  type PDFPageData,
} from "@/lib/translator/pdfParser";
import {
  generateTranslatedPDF,
  extractPageTexts,
  type PDFGenerationProgress,
} from "@/lib/translator/pdfGenerator";

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
  result?: TranslationResult;
}

export default function Translator() {
  // Source state
  const [sourceText, setSourceText] = useState("");
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);
  const [originalArrayBuffer, setOriginalArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [pageData, setPageData] = useState<PDFPageData[]>([]);
  const [originalPageTexts, setOriginalPageTexts] = useState<string[]>([]);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Translation flow state
  const [currentLanguageIndex, setCurrentLanguageIndex] = useState<number>(-1);
  const [isTranslating, setIsTranslating] = useState(false);
  const [currentTranslation, setCurrentTranslation] = useState<TranslationResult | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [completedLanguages, setCompletedLanguages] = useState<CompletedLanguage[]>([]);
  const [flowPhase, setFlowPhase] = useState<"idle" | "translating" | "translation-done" | "generating-pdf" | "all-complete">("idle");

  // PDF generation state
  const [pdfProgress, setPdfProgress] = useState<PDFGenerationProgress | null>(null);
  const [currentPdfBlob, setCurrentPdfBlob] = useState<Blob | null>(null);

  // ZIP download state
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  // --- PDF Upload ---

  const handleFileSelect = useCallback(async (file: File | null) => {
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setPdfFileName(null);
    setPdfPageCount(null);
    setPdfWarnings([]);
    setParseProgress(null);
    setOriginalArrayBuffer(null);
    setPageData([]);
    setOriginalPageTexts([]);
    resetFlow();

    try {
      const parsed = await parsePDF(file, (current, total) => {
        setParseProgress({ current, total });
      });

      setSourceText(parsed.text);
      setPdfFileName(file.name);
      setPdfPageCount(parsed.numPages);
      setPdfWarnings(parsed.warnings);
      setOriginalArrayBuffer(parsed.arrayBuffer);
      setPageData(parsed.pageData);
      setOriginalPageTexts(extractPageTexts(parsed.pageData));
      setParseProgress(null);

      const validation = validateTextForTranslation(parsed.text);
      if (!validation.valid) {
        setUploadError(validation.errors.join(" "));
      }
    } catch (err) {
      const pdfError = err as PDFParseError;
      setUploadError(pdfError.message || "Failed to parse PDF.");
      setParseProgress(null);
    } finally {
      setIsUploading(false);
    }
  }, []);

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

  const clearSource = useCallback(() => {
    setSourceText("");
    setPdfFileName(null);
    setPdfPageCount(null);
    setPdfWarnings([]);
    setUploadError(null);
    setOriginalArrayBuffer(null);
    setPageData([]);
    setOriginalPageTexts([]);
    resetFlow();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const loadSample = useCallback(() => {
    setSourceText(generateSampleText());
    setPdfFileName(null);
    setPdfPageCount(null);
    setPdfWarnings([]);
    setUploadError(null);
    setOriginalArrayBuffer(null);
    setPageData([]);
    setOriginalPageTexts([]);
    resetFlow();
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
  }, []);

  // --- Step-by-Step Translation ---

  const startTranslation = useCallback(async () => {
    if (!sourceText.trim() || currentLanguageIndex >= 0) return;

    setIsTranslating(true);
    setFlowPhase("translating");
    setCurrentLanguageIndex(0);
    setTranslationError(null);

    await translateCurrentLanguage(0);
  }, [sourceText, currentLanguageIndex]);

  const translateCurrentLanguage = useCallback(async (langIndex: number) => {
    if (langIndex >= targetLanguages.length) {
      setFlowPhase("all-complete");
      setIsTranslating(false);
      return;
    }

    setIsTranslating(true);
    setFlowPhase("translating");
    setCurrentLanguageIndex(langIndex);
    setTranslationError(null);
    setCurrentPdfBlob(null);

    const lang = targetLanguages[langIndex];

    try {
      const config = {
        sourceText: sourceText.trim(),
        targetLanguage: lang.code,
        marketContext: "standard",
        chapterNumber: 1,
      };

      const result = await runTranslationPipeline(config);
      setCurrentTranslation(result);
      setFlowPhase("translation-done");
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : "Translation failed");
      setFlowPhase("translation-done");
    } finally {
      setIsTranslating(false);
    }
  }, [sourceText]);

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
          translatedText: currentTranslation.translatedText,
          pdfBlob: currentPdfBlob || undefined,
          result: currentTranslation,
        },
      ]);
    }

    setCurrentTranslation(null);
    setCurrentPdfBlob(null);
    setPdfProgress(null);

    const nextIndex = currentLanguageIndex + 1;
    if (nextIndex >= targetLanguages.length) {
      setFlowPhase("all-complete");
      setCurrentLanguageIndex(targetLanguages.length);
    } else {
      await translateCurrentLanguage(nextIndex);
    }
  }, [currentTranslation, currentLanguageIndex, currentPdfBlob]);

  // --- PDF Generation ---

  const handleDownloadPDF = useCallback(async () => {
    if (!currentTranslation || !originalArrayBuffer || !pageData.length || !originalPageTexts.length) return;

    setFlowPhase("generating-pdf");
    setPdfProgress(null);
    const lang = targetLanguages[currentLanguageIndex];

    try {
      const blob = await generateTranslatedPDF(
        originalArrayBuffer,
        pageData,
        originalPageTexts,
        currentTranslation.translatedText,
        lang.code,
        (progress) => {
          setPdfProgress({ ...progress });
        }
      );

      setCurrentPdfBlob(blob);

      // Trigger download
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
      setTranslationError(error instanceof Error ? error.message : "PDF generation failed");
      setFlowPhase("translation-done");
    }
  }, [currentTranslation, originalArrayBuffer, pageData, originalPageTexts, currentLanguageIndex, pdfFileName]);

  // --- ZIP Download (Final) ---

  const handleDownloadAllZIP = useCallback(async () => {
    const allCompleted = [
      ...completedLanguages,
      ...(currentTranslation && currentLanguageIndex >= 0 && currentLanguageIndex < targetLanguages.length
        ? [{
            index: currentLanguageIndex,
            code: targetLanguages[currentLanguageIndex].code,
            name: targetLanguages[currentLanguageIndex].name,
            nativeName: targetLanguages[currentLanguageIndex].nativeName,
            translatedText: currentTranslation.translatedText,
            pdfBlob: currentPdfBlob || undefined,
            result: currentTranslation,
          }]
        : []),
    ];

    if (allCompleted.length === 0) return;

    setIsDownloadingZip(true);

    try {
      const zip = new JSZip();
      const folderName = pdfFileName
        ? pdfFileName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")
        : "onyx_translate_all";
      const folder = zip.folder(folderName) || zip;

      for (const completed of allCompleted) {
        const langCode = completed.code;
        const langName = completed.name;

        // Add text translation
        folder.file(`translated_${langCode}_${langName.toLowerCase().replace(/\s+/g, "_")}.txt`, completed.translatedText);

        // Add PDF if available
        if (completed.pdfBlob) {
          folder.file(`${folderName}_${langCode}.pdf`, completed.pdfBlob);
        } else if (originalArrayBuffer && pageData.length && originalPageTexts.length) {
          // Generate PDF on-the-fly
          try {
            const pdfBlob = await generateTranslatedPDF(
              originalArrayBuffer,
              pageData,
              originalPageTexts,
              completed.translatedText,
              langCode,
              () => {} // silent progress
            );
            folder.file(`${folderName}_${langCode}.pdf`, pdfBlob);
            // Update cached blob
            setCompletedLanguages((prev) =>
              prev.map((c) => (c.code === langCode ? { ...c, pdfBlob } : c))
            );
          } catch {
            // PDF generation failed, include text only
          }
        }

        // Add CSV data
        if (completed.result?.csvData) {
          const csvRows = [["Type", "Original", "Translated"]];
          for (const item of completed.result.csvData.mapNames) {
            csvRows.push(["Map", item.original, item.translated]);
          }
          for (const item of completed.result.csvData.runeCaptions) {
            csvRows.push(["Rune", item.original, item.translated]);
          }
          for (const item of completed.result.csvData.endpaperText) {
            csvRows.push(["Endpaper", item.original, item.translated]);
          }
          folder.file(`localization_${langCode}.csv`, csvRows.map((r) => r.join(",")).join("\n"));
        }

        // Voice notes
        if (completed.result?.voiceNotes?.length) {
          const notesText = completed.result.voiceNotes
            .map((n) => `Character: ${n.character}\nLine: "${n.line}"\nDirection: ${n.instruction}\nEmotion: ${n.emotionalContext}\n---`)
            .join("\n\n");
          folder.file(`voice_notes_${langCode}.txt`, notesText);
        }
      }

      // Summary report
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
        ...(pdfWarnings.length ? ["Warnings:", ...pdfWarnings.map((w) => `  - ${w}`), ""] : []),
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
  }, [completedLanguages, currentTranslation, currentLanguageIndex, currentPdfBlob, originalArrayBuffer, pageData, originalPageTexts, pdfFileName, pdfPageCount, pdfWarnings, sourceText]);

  // --- Helpers ---

  const wordCount = sourceText.split(/\s+/).filter((w) => w.length > 0).length;
  const currentLang = currentLanguageIndex >= 0 && currentLanguageIndex < targetLanguages.length
    ? targetLanguages[currentLanguageIndex]
    : null;
  const nextLangIndex = currentLanguageIndex >= 0 ? currentLanguageIndex + 1 : 0;
  const nextLang = nextLangIndex < targetLanguages.length ? targetLanguages[nextLangIndex] : null;

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
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Languages className="size-4 text-primary-foreground" />
            </div>
            <div>
              <span className="text-base font-semibold tracking-tight">Onyx Translate</span>
              <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">PDF Localization Tool</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">Images Preserved</Badge>
            <Badge variant="outline" className="text-[10px]">{targetLanguages.length} Languages</Badge>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
          {/* Left Panel - Controls */}
          <div className="space-y-4">
            {/* Step 1: Upload */}
            <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border/30 bg-muted/30">
                <div className="flex items-center gap-2">
                  <span className="size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0">1</span>
                  <span className="text-xs font-semibold">Upload English PDF</span>
                  {pdfFileName && <CheckCircle2 className="size-3.5 text-green-500 ml-auto" />}
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
                        {parseProgress && parseProgress.total > 0
                          ? `Extracting text from page ${parseProgress.current} of ${parseProgress.total}...`
                          : "Loading PDF..."}
                      </span>
                      {parseProgress && parseProgress.total > 0 && (
                        <div className="w-40 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${Math.min((parseProgress.current / parseProgress.total) * 100, 100)}%` }} />
                        </div>
                      )}
                      {parseProgress && parseProgress.total > 0 && (
                        <span className="text-[10px] text-muted-foreground/70">{parseProgress.current} / {parseProgress.total} pages</span>
                      )}
                    </div>
                  ) : pdfFileName ? (
                    <>
                      <div className="size-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <FileUp className="size-5 text-green-500" />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium">{pdfFileName}</p>
                        <p className="text-[10px] text-muted-foreground">{pdfPageCount} pages • {wordCount.toLocaleString()} words</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={(e) => { e.stopPropagation(); clearSource(); }}>
                          <X className="size-3 mr-1" /> Remove
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <Upload className="size-6 text-muted-foreground/40" />
                      <p className="text-xs font-medium">Drop PDF here or click to browse</p>
                      <p className="text-[10px] text-muted-foreground">All images preserved in output PDFs</p>
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
                    <div className="text-[10px]">{pdfWarnings.map((w, i) => (<p key={i}>{w}</p>))}</div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Or Paste Text</span>
                    <Button variant="ghost" size="sm" onClick={loadSample} className="text-[10px] h-6">
                      <Sparkles className="size-2.5 mr-1" /> Sample
                    </Button>
                  </div>
                  <Textarea
                    value={sourceText}
                    onChange={(e) => { setSourceText(e.target.value); if (pdfFileName) { clearSource(); } }}
                    placeholder="Paste your text here or upload a PDF..."
                    className="min-h-[100px] resize-none font-mono text-xs leading-relaxed"
                  />
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{wordCount.toLocaleString()} words</span>
                    <span>{sourceText.length.toLocaleString()} chars</span>
                  </div>
                </div>

                {sourceText.trim() && flowPhase === "idle" && (
                  <Button onClick={startTranslation} className="w-full h-9" size="default">
                    <Globe className="size-3.5 mr-2" />
                    Begin Translation Journey
                  </Button>
                )}
              </div>
            </div>

            {/* Progress Panel */}
            {flowPhase !== "idle" && (
              <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/30 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0">2</span>
                    <span className="text-xs font-semibold">Translation Progress</span>
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                      {completedLanguages.length}/{targetLanguages.length}
                    </span>
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${(completedLanguages.length / targetLanguages.length) * 100}%` }} />
                  </div>

                  {/* Current language status */}
                  <div className="space-y-1.5">
                    {isTranslating && currentLang && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
                        <Loader2 className="size-3.5 text-primary animate-spin shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate">{currentLang.name}</p>
                          <p className="text-[9px] text-muted-foreground">Translating...</p>
                        </div>
                        <Badge variant="secondary" className="text-[9px] shrink-0 ml-auto">{currentLang.nativeName}</Badge>
                      </div>
                    )}

                    {flowPhase === "generating-pdf" && currentLang && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-500/5 border border-blue-500/20">
                        <Loader2 className="size-3.5 text-blue-500 animate-spin shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate">Generating PDF...</p>
                          <p className="text-[9px] text-muted-foreground">
                            {pdfProgress?.message || `Processing ${currentLang.name}`}
                          </p>
                        </div>
                        {pdfProgress && (
                          <div className="text-[9px] text-muted-foreground shrink-0 font-mono">{pdfProgress.currentPage}/{pdfProgress.totalPages}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Completed languages list */}
                  {completedLanguages.length > 0 && (
                    <ScrollArea className="max-h-[200px]">
                      <div className="space-y-0.5">
                        {completedLanguages.map((cl, idx) => (
                          <div key={cl.code} className="flex items-center gap-2 py-1.5 px-2 rounded-md text-[11px] bg-green-500/5">
                            <CheckCircle2 className="size-3 text-green-500 shrink-0" />
                            <span className="min-w-0 truncate flex-1">
                              <span className="font-medium">{cl.name}</span>
                              <span className="text-muted-foreground ml-1">{cl.nativeName}</span>
                            </span>
                            <Badge variant="outline" className="text-[8px] shrink-0">
                              {cl.pdfBlob ? "PDF" : "Text"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}

                  {/* Action buttons */}
                  <div className="space-y-1.5 pt-1">
                    {flowPhase === "translation-done" && currentLang && !isTranslating && (
                      <>
                        {/* Download PDF button */}
                        <Button
                          onClick={handleDownloadPDF}
                          className="w-full h-9 text-xs"
                          variant="default"
                        >
                          <FileDown className="size-3.5 mr-2" /> Download {currentLang.name} PDF
                        </Button>

                        {/* Continue button */}
                        {nextLang ? (
                          <Button
                            onClick={handleContinue}
                            className="w-full h-9 text-xs"
                            variant="outline"
                          >
                            Continue to {nextLang.name}
                            <ChevronRight className="size-3.5 ml-2" />
                            <Badge variant="secondary" className="text-[9px] ml-1">{nextLang.nativeName}</Badge>
                          </Button>
                        ) : (
                          <Button
                            onClick={handleContinue}
                            className="w-full h-9 text-xs"
                            variant="outline"
                          >
                            <CheckCheck className="size-3.5 mr-2" /> Finalize All Translations
                          </Button>
                        )}
                      </>
                    )}

                    {flowPhase === "all-complete" && (
                      <>
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
                          <CheckCheck className="size-4 text-green-500 shrink-0" />
                          <span className="text-[11px] font-medium">All {targetLanguages.length} languages completed!</span>
                        </div>

                        <Button
                          onClick={handleDownloadAllZIP}
                          disabled={isDownloadingZip}
                          className="w-full h-10 text-sm"
                          variant="default"
                          size="lg"
                        >
                          {isDownloadingZip ? (
                            <><Loader2 className="size-4 mr-2 animate-spin" /> Creating ZIP...</>
                          ) : (
                            <><Package className="size-4 mr-2" /> Download All PDFs as ZIP</>
                          )}
                        </Button>

                        <Button
                          onClick={clearSource}
                          className="w-full h-9 text-xs"
                          variant="outline"
                        >
                          <RotateCcw className="size-3.5 mr-2" /> Start Over
                        </Button>
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
                    {flowPhase === "translating" && currentLang && `Translating to ${currentLang.name}`}
                    {flowPhase === "translation-done" && currentLang && `${currentLang.name} Translation`}
                    {flowPhase === "generating-pdf" && currentLang && `Generating ${currentLang.name} PDF`}
                    {flowPhase === "all-complete" && "All Translations Complete"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {flowPhase === "translating" && currentLang && (
                    <Badge variant="secondary" className="text-[9px] animate-pulse">
                      <Loader2 className="size-2.5 mr-1 animate-spin" />
                      18-Phase Pipeline
                    </Badge>
                  )}
                  {flowPhase === "translation-done" && currentLang && (
                    <Badge variant="default" className="text-[9px] bg-green-600">
                      <CheckCircle2 className="size-2.5 mr-1" /> Ready
                    </Badge>
                  )}
                  {flowPhase === "all-complete" && (
                    <Badge variant="default" className="text-[9px] bg-green-600">
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
                      <h3 className="text-sm font-semibold mb-1.5">Onyx Translate</h3>
                      <p className="text-xs text-muted-foreground">
                        Upload your English PDF, and we'll translate it step-by-step into all 20 languages — preserving every image, illustration, and visual element from the original.
                      </p>
                      <div className="flex items-center justify-center gap-2 mt-4">
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
                          <Upload className="size-3 mr-1.5" /> Upload PDF
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={loadSample}>
                          <Sparkles className="size-3 mr-1.5" /> Load Sample
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5 justify-center mt-3 text-[10px] text-muted-foreground">
                        <CheckCircle2 className="size-2.5 text-green-500" /> Images preserved
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5 text-green-500" /> 18-phase localization
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5 text-green-500" /> PDF download per language
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
                      <h3 className="text-sm font-semibold mb-1">Translating to {currentLang.name}</h3>
                      <p className="text-[11px] text-muted-foreground mb-2">{currentLang.nativeName}</p>
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-[9px]">18-Phase Pipeline</Badge>
                        <Badge variant="outline" className="text-[9px]">{currentLang.script} Script</Badge>
                      </div>
                    </div>
                  </div>
                )}

                {flowPhase === "generating-pdf" && currentLang && pdfProgress && (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center">
                      <Loader2 className="size-8 text-blue-500 animate-spin mx-auto mb-3" />
                      <h3 className="text-sm font-semibold mb-1">{pdfProgress.message}</h3>
                      <div className="w-40 h-1.5 rounded-full bg-muted overflow-hidden mx-auto mt-2">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-200" style={{ width: `${(pdfProgress.currentPage / pdfProgress.totalPages) * 100}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Rendering pages with original images + translated text overlay</p>
                    </div>
                  </div>
                )}

                {flowPhase === "translation-done" && currentTranslation && currentLang && !isTranslating && (
                  <ScrollArea className="h-[calc(100vh-220px)]">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="default" className="text-[10px]">{currentLang.name} {currentLang.nativeName}</Badge>
                        <Badge variant="secondary" className="text-[9px]">{currentLang.script} Script</Badge>
                        {["ar", "ur", "ks"].includes(currentLang.code) && <Badge variant="outline" className="text-[9px]">RTL</Badge>}
                        <Badge variant="outline" className="text-[9px]">Quality: {currentTranslation.report.overallScore}/100</Badge>
                      </div>
                      <div className="whitespace-pre-wrap font-serif text-[13px] leading-[1.8] p-4 rounded-xl bg-muted/20 border border-border/30 text-foreground/90">
                        {currentTranslation.translatedText}
                      </div>
                    </div>
                  </ScrollArea>
                )}

                {flowPhase === "all-complete" && (
                  <div className="flex items-center justify-center h-[400px]">
                    <div className="text-center max-w-sm">
                      <div className="size-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                        <CheckCheck className="size-8 text-green-500" />
                      </div>
                      <h3 className="text-lg font-bold mb-1">All Translations Complete!</h3>
                      <p className="text-xs text-muted-foreground mb-2">
                        {sourceText.split(/\s+/).filter(Boolean).length.toLocaleString()} words translated into {targetLanguages.length} languages
                      </p>
                      <div className="flex items-center justify-center gap-1.5 text-[10px]">
                        <CheckCircle2 className="size-2.5 text-green-500" /> {completedLanguages.length + 1} languages
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5 text-green-500" /> Download individual PDFs
                        <span className="mx-1">•</span>
                        <CheckCircle2 className="size-2.5 text-green-500" /> or all as ZIP
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
