import { useState, useCallback, useRef } from "react";
import JSZip from "jszip";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Globe,
  AlertCircle,
  AlertTriangle,
  Zap,
  Gauge,
} from "lucide-react";
import {
  runTranslationPipeline,
  generateSampleText,
  type TranslationResult,
} from "@/lib/translator/engine";
import {
  parsePDF,
  splitTextIntoChunks,
  validateTextForTranslation,
  type PDFParseError,
} from "@/lib/translator/pdfParser";

const targetLanguages = [
  { code: "ur", name: "Urdu", nativeName: "\u0627\u0631\u062f\u0648", script: "Arabic" },
  { code: "ar", name: "Arabic", nativeName: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", script: "Arabic" },
  { code: "fr", name: "French", nativeName: "Fran\u00e7ais", script: "Latin" },
  { code: "ja", name: "Japanese", nativeName: "\u65e5\u672c\u8a9e", script: "Japanese" },
  { code: "es", name: "Spanish", nativeName: "Espa\u00f1ol", script: "Latin" },
  { code: "hi", name: "Hindi", nativeName: "\u0939\u093f\u0928\u094d\u0926\u0940", script: "Devanagari" },
  { code: "tr", name: "Turkish", nativeName: "T\u00fcrk\u00e7e", script: "Latin" },
  { code: "zh", name: "Chinese", nativeName: "\u4e2d\u6587", script: "Chinese" },
  { code: "ru", name: "Russian", nativeName: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439", script: "Cyrillic" },
  { code: "ko", name: "Korean", nativeName: "\ud55c\uad6d\uc5b4", script: "Hangul" },
  { code: "de", name: "German", nativeName: "Deutsch", script: "Latin" },
  { code: "ks", name: "Kashmiri", nativeName: "\u0915\u0949\u0936\u0941\u0930", script: "Arabic" },
  { code: "ro", name: "Romanian", nativeName: "Rom\u00e2n\u0103", script: "Latin" },
  { code: "sw", name: "Swahili", nativeName: "Kiswahili", script: "Latin" },
  { code: "it", name: "Italian", nativeName: "Italiano", script: "Latin" },
  { code: "la", name: "Latin", nativeName: "Latina", script: "Latin" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", script: "Latin" },
  { code: "ne", name: "Nepali", nativeName: "\u0928\u0947\u092a\u093e\u0932\u0940", script: "Devanagari" },
  { code: "bn", name: "Bangla", nativeName: "\u09ac\u09be\u0982\u09b2\u09be", script: "Bengali" },
  { code: "pt", name: "Portuguese", nativeName: "Portugu\u00eas", script: "Latin" },
];

interface BatchResult {
  languageCode: string;
  languageName: string;
  nativeName: string;
  script: string;
  status: "pending" | "translating" | "completed" | "error";
  result?: TranslationResult;
  error?: string;
}

export default function Translator() {
  // Source text state
  const [sourceText, setSourceText] = useState("");
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([]);

  // PDF upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Batch translation state
  const [translateAll, setTranslateAll] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [expandedLanguages, setExpandedLanguages] = useState<Set<string>>(new Set());

  // ZIP download state
  const [isDownloading, setIsDownloading] = useState(false);

  // --- PDF Upload ---

  const handleFileSelect = useCallback(async (file: File | null) => {
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setPdfFileName(null);
    setPdfPageCount(null);
    setPdfWarnings([]);
    setParseProgress({ current: 0, total: 0 });

    try {
      const parsed = await parsePDF(file, (current, total) => {
        setParseProgress({ current, total });
      });

      const finalText = parsed.text;

      setSourceText(finalText);
      setPdfFileName(file.name);
      setPdfPageCount(parsed.numPages);
      setPdfWarnings(parsed.warnings);
      setParseProgress(null);

      const validation = validateTextForTranslation(finalText);
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
    setBatchResults([]);
    setTranslateAll(false);
    setParseProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const loadSample = useCallback(() => {
    setSourceText(generateSampleText());
    setPdfFileName(null);
    setPdfPageCount(null);
    setPdfWarnings([]);
    setUploadError(null);
  }, []);

  // --- Parallel Batch Translation (All 20 Languages at once) ---

  const handleTranslateAll = useCallback(async () => {
    if (!sourceText.trim()) return;

    setIsBatchRunning(true);
    setTranslateAll(true);

    // Initialize all languages as pending
    const initialResults: BatchResult[] = targetLanguages.map((lang) => ({
      languageCode: lang.code,
      languageName: lang.name,
      nativeName: lang.nativeName,
      script: lang.script,
      status: "pending" as const,
    }));
    setBatchResults(initialResults);

    // Process all 20 languages in parallel
    const translationTasks = targetLanguages.map(async (lang, index) => {
      // Mark as translating
      setBatchResults((prev) =>
        prev.map((r, idx) =>
          idx === index ? { ...r, status: "translating" as const } : r
        )
      );

      try {
        const config = {
          sourceText: sourceText.trim(),
          targetLanguage: lang.code,
          marketContext: "standard",
          chapterNumber: 1,
        };

        const translationResult = await runTranslationPipeline(config);

        setBatchResults((prev) =>
          prev.map((r, idx) =>
            idx === index
              ? { ...r, status: "completed" as const, result: translationResult }
              : r
          )
        );
      } catch (error) {
        setBatchResults((prev) =>
          prev.map((r, idx) =>
            idx === index
              ? {
                  ...r,
                  status: "error" as const,
                  error: error instanceof Error ? error.message : "Translation failed",
                }
              : r
          )
        );
      }
    });

    // Wait for all to complete
    await Promise.all(translationTasks);
    setIsBatchRunning(false);
  }, [sourceText]);

  // --- ZIP Download ---

  const handleDownloadZIP = useCallback(async () => {
    const completedResults = batchResults.filter((r) => r.status === "completed" && r.result);
    if (completedResults.length === 0) return;

    setIsDownloading(true);

    try {
      const zip = new JSZip();
      const folderName = pdfFileName
        ? pdfFileName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "_")
        : "translations";
      const folder = zip.folder(folderName) || zip;

      for (const batchResult of completedResults) {
        if (!batchResult.result) continue;
        const langCode = batchResult.languageCode;
        const langName = batchResult.languageName;

        const fileName = `translated_${langCode}_${langName.toLowerCase().replace(/\s+/g, "_")}.txt`;
        folder.file(fileName, batchResult.result.translatedText);

        if (batchResult.result.csvData) {
          const allItems = [
            ...batchResult.result.csvData.mapNames.map((item) => ({ type: "Map", ...item })),
            ...batchResult.result.csvData.runeCaptions.map((item) => ({ type: "Rune", ...item })),
            ...batchResult.result.csvData.endpaperText.map((item) => ({ type: "Endpaper", ...item })),
          ];
          if (allItems.length > 0) {
            const csvRows = [
              ["Type", "Original", "Translated"],
              ...allItems.map((item) => [item.type, item.original, item.translated]),
            ];
            folder.file(`localization_${langCode}.csv`, csvRows.map((r) => r.join(",")).join("\n"));
          }
        }

        if (batchResult.result.voiceNotes && batchResult.result.voiceNotes.length > 0) {
          const voiceNotesText = batchResult.result.voiceNotes
            .map((n) => `Character: ${n.character}\nLine: "${n.line}"\nDirection: ${n.instruction}\nEmotion: ${n.emotionalContext}\n---`)
            .join("\n\n");
          folder.file(`voice_notes_${langCode}.txt`, voiceNotesText);
        }
      }

      const summaryLines = [
        "Onyx Translate - Batch Translation Report",
        "=".repeat(50),
        `Source: ${pdfFileName || "Text input"}`,
        `Languages: ${completedResults.length}`,
        `Date: ${new Date().toISOString()}`,
        "",
        "Language Summary:",
        ...completedResults.map((r) => `  ${r.languageName} (${r.languageCode}): Quality ${r.result?.report?.overallScore || 0}/100`),
        "",
        "Warnings:",
        ...pdfWarnings.map((w) => `  - ${w}`),
      ];
      folder.file("REPORT.txt", summaryLines.join("\n"));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${folderName}_translations.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("ZIP download failed:", error);
    } finally {
      setIsDownloading(false);
    }
  }, [batchResults, pdfFileName, pdfWarnings]);

  // --- Helpers ---

  const toggleLanguageExpand = useCallback((code: string) => {
    setExpandedLanguages((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const wordCount = sourceText.split(/\s+/).filter((w) => w.length > 0).length;
  const completedBatchCount = batchResults.filter((r) => r.status === "completed").length;
  const translatingBatchCount = batchResults.filter((r) => r.status === "translating").length;
  const pendingBatchCount = batchResults.filter((r) => r.status === "pending").length;
  const errorBatchCount = batchResults.filter((r) => r.status === "error").length;

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
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Languages className="size-4 text-primary-foreground" />
            </div>
            <div>
              <span className="text-base font-semibold tracking-tight">Onyx Translate</span>
              <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">18-Phase Localization Pipeline</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px]">20 Languages</Badge>
            <Badge variant="outline" className="text-[10px]">Personal Use</Badge>
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
          {/* Left Panel - Controls */}
          <div className="space-y-4">
            {/* Step 1: Upload PDF */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">1</span>
                  Upload English PDF
                </CardTitle>
                <CardDescription className="text-xs">Upload your manuscript or paste text directly</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
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
                        {parseProgress
                          ? `Parsing page ${parseProgress.current} of ${parseProgress.total}...`
                          : "Reading PDF..."}
                      </span>
                      {parseProgress && parseProgress.total > 0 && (
                        <div className="w-40 h-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-200"
                            style={{ width: `${(parseProgress.current / parseProgress.total) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ) : pdfFileName ? (
                    <>
                      <div className="size-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                        <FileUp className="size-5 text-green-500" />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-medium">{pdfFileName}</p>
                        {pdfPageCount && (
                          <p className="text-[10px] text-muted-foreground">{pdfPageCount} pages \u2022 {wordCount.toLocaleString()} words</p>
                        )}
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={(e) => { e.stopPropagation(); clearSource(); }}>
                        <X className="size-3 mr-1" /> Remove
                      </Button>
                    </>
                  ) : (
                    <>
                      <Upload className="size-6 text-muted-foreground/40" />
                      <p className="text-xs font-medium">Drop PDF here or click to browse</p>
                      <p className="text-[10px] text-muted-foreground">Supports text-based PDFs up to 50MB</p>
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
                    <AlertTriangle className="size-3.5 text-blue-500 shrink-0 mt-0.5" />
                    <div>{pdfWarnings.map((w, i) => (<p key={i}>{w}</p>))}</div>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Source Text</span>
                    <Button variant="ghost" size="sm" onClick={loadSample} className="text-[10px] h-6">
                      <Sparkles className="size-2.5 mr-1" /> Sample
                    </Button>
                  </div>
                  <Textarea
                    value={sourceText}
                    onChange={(e) => { setSourceText(e.target.value); if (pdfFileName) setPdfFileName(null); }}
                    placeholder="Paste your chapter text here or upload a PDF above..."
                    className="min-h-[140px] resize-none font-mono text-xs leading-relaxed"
                  />
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{wordCount.toLocaleString()} words</span>
                    <span>{sourceText.length.toLocaleString()} chars</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Translate */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className="size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">2</span>
                  Translate to All 20 Languages
                </CardTitle>
                <CardDescription className="text-xs">All languages processed in parallel with maximum speed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={handleTranslateAll}
                  disabled={!sourceText.trim() || isBatchRunning || isUploading}
                  className="w-full h-10"
                  size="lg"
                >
                  {isBatchRunning ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Translating {completedBatchCount + translatingBatchCount}/20...
                    </>
                  ) : (
                    <>
                      <Zap className="size-4 mr-2" />
                      Translate All Languages
                    </>
                  )}
                </Button>

                {(translateAll || isBatchRunning) && (
                  <div className="space-y-2">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${((completedBatchCount + errorBatchCount) / 20) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>
                        {completedBatchCount}/20 done
                        {translatingBatchCount > 0 && <span className="text-primary"> \u2022 {translatingBatchCount} in progress</span>}
                        {errorBatchCount > 0 && <span className="text-red-500"> \u2022 {errorBatchCount} failed</span>}
                      </span>
                      <span>{pendingBatchCount} remaining</span>
                    </div>

                    {/* Download ZIP button */}
                    {!isBatchRunning && completedBatchCount > 0 && (
                      <Button onClick={handleDownloadZIP} disabled={isDownloading} className="w-full h-9" variant="default">
                        {isDownloading ? (
                          <><Loader2 className="size-3.5 mr-2 animate-spin" /> Creating ZIP...</>
                        ) : (
                          <><Package className="size-3.5 mr-2" /> Download All as ZIP ({completedBatchCount} languages)</>
                        )}
                      </Button>
                    )}

                    {/* Language list */}
                    <ScrollArea className="max-h-[280px]">
                      <div className="space-y-0.5">
                        {batchResults.map((br) => {
                          const isExpanded = expandedLanguages.has(br.languageCode);
                          return (
                            <div key={br.languageCode}>
                              <div
                                className={`flex items-center gap-2 py-1.5 px-2 rounded-md text-[11px] transition-colors ${
                                  br.status === "translating" ? "bg-primary/5 animate-pulse" :
                                  br.status === "completed" ? "hover:bg-muted/50 cursor-pointer" :
                                  br.status === "error" ? "bg-red-500/5" : ""
                                }`}
                                onClick={() => br.status === "completed" && toggleLanguageExpand(br.languageCode)}
                              >
                                {br.status === "translating" && <Loader2 className="size-3 text-primary animate-spin shrink-0" />}
                                {br.status === "completed" && <CheckCircle2 className="size-3 text-green-500 shrink-0" />}
                                {br.status === "error" && <XCircle className="size-3 text-red-500 shrink-0" />}
                                {br.status === "pending" && <Clock className="size-3 text-muted-foreground/40 shrink-0" />}
                                <span className="flex-1 min-w-0 truncate">
                                  {br.languageName}
                                  <span className="text-muted-foreground ml-1">{br.nativeName}</span>
                                </span>
                                <Badge variant="secondary" className="text-[9px] shrink-0">{br.script}</Badge>
                                {br.status === "completed" && (
                                  <ChevronDown className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                )}
                              </div>
                              {isExpanded && br.result && (
                                <div className="ml-5 mb-1.5 p-2.5 rounded-lg bg-muted/30 border border-border/40">
                                  <div className="flex items-center gap-2 mb-1.5">
                                    <Badge variant="secondary" className="text-[9px]">Quality: {br.result.report.overallScore}/100</Badge>
                                    <Badge variant="outline" className="text-[9px]">{br.result.phases.length} phases</Badge>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground line-clamp-3 whitespace-pre-wrap leading-relaxed">
                                    {br.result.translatedText.substring(0, 400)}...
                                  </div>
                                </div>
                              )}
                              {br.error && <div className="ml-5 mb-1 text-[10px] text-red-500">{br.error}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Preview */}
          <div className="min-h-0">
            <Card className="h-full min-h-[600px]">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Globe className="size-4 text-muted-foreground" />
                    Translation Preview
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    {isBatchRunning && (
                      <Badge variant="secondary" className="text-[10px]">
                        <Loader2 className="size-2.5 mr-1 animate-spin" />
                        {translatingBatchCount} languages processing
                      </Badge>
                    )}
                    {completedBatchCount === 20 && !isBatchRunning && (
                      <Badge variant="default" className="text-[10px] bg-green-600">
                        <CheckCircle2 className="size-2.5 mr-1" /> All Complete
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-3">
                {completedBatchCount > 0 && !isBatchRunning ? (
                  <ScrollArea className="h-[calc(100vh-200px)]">
                    <div className="space-y-6">
                      {batchResults.filter((r) => r.status === "completed" && r.result).map((br) => (
                        <div key={br.languageCode} className="space-y-2">
                          <div className="flex items-center gap-2 sticky top-0 bg-background/95 backdrop-blur-sm py-2 z-10">
                            <CheckCircle2 className="size-3.5 text-green-500" />
                            <span className="text-sm font-semibold">{br.languageName}</span>
                            <span className="text-xs text-muted-foreground">{br.nativeName}</span>
                            <Badge variant="secondary" className="text-[9px]">{br.script}</Badge>
                            <Badge variant="outline" className="text-[9px]">{br.result?.report.overallScore}/100</Badge>
                            {["ar", "ur", "ks"].includes(br.languageCode) && <Badge variant="outline" className="text-[9px]">RTL</Badge>}
                          </div>
                          <div className="whitespace-pre-wrap font-serif text-[13px] leading-[1.8] p-4 rounded-xl bg-muted/20 border border-border/30 text-foreground/90">
                            {br.result?.translatedText || ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : isBatchRunning ? (
                  <div className="flex items-center justify-center h-[calc(100vh-200px)]">
                    <div className="text-center">
                      <div className="relative mb-4">
                        <div className="size-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto" />
                        <Zap className="size-5 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                      </div>
                      <h3 className="text-sm font-semibold mb-1">Translating All Languages</h3>
                      <p className="text-xs text-muted-foreground">
                        {completedBatchCount} completed \u2022 {translatingBatchCount} in progress \u2022 {pendingBatchCount} pending
                      </p>
                      <div className="mt-3 h-1 w-48 rounded-full bg-muted overflow-hidden mx-auto">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${((completedBatchCount + errorBatchCount) / 20) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[calc(100vh-200px)]">
                    <div className="text-center">
                      <div className="size-14 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
                        <Languages className="size-7 text-muted-foreground/40" />
                      </div>
                      <h3 className="text-sm font-semibold mb-1.5">Ready to Translate</h3>
                      <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                        Upload a PDF or paste English text, then click "Translate All Languages" to process through all 20 languages in parallel.
                      </p>
                      <div className="flex items-center justify-center gap-2 mt-4">
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => fileInputRef.current?.click()}>
                          <Upload className="size-3 mr-1.5" /> Upload PDF
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={loadSample}>
                          <Sparkles className="size-3 mr-1.5" /> Load Sample
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}