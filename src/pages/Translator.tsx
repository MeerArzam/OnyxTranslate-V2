import { useState, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Languages,
  Play,
  Download,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  FileText,
  Volume2,
  BarChart3,
  Sparkles,
  Shield,
  BookOpen,
  CheckCircle2,
  XCircle,
  Clock,
  Globe,
  Upload,
  FileUp,
  X,
  Package,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "react-router";
import {
  runTranslationPipeline,
  generateSampleText,
  type TranslationPhase,
  type TranslationResult,
  type TranslationReport,
} from "@/lib/translator/engine";
import {
  parsePDF,
  splitTextIntoChunks,
  validateTextForTranslation,
  type PDFParseError,
} from "@/lib/translator/pdfParser";

const targetLanguages = [
  { code: "ar", name: "Arabic", nativeName: "العربية", script: "Arabic" },
  { code: "ur", name: "Urdu", nativeName: "اردو", script: "Arabic" },
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

const marketContexts = [
  { id: "standard", name: "Standard", description: "No special filters" },
  {
    id: "high-censorship",
    name: "High Censorship",
    description: "Turkey, Arabic markets",
  },
  {
    id: "romance-focused",
    name: "Romance Focused",
    description: "Korean, Japanese markets",
  },
  {
    id: "conservative",
    name: "Conservative",
    description: "Strict cultural norms",
  },
];

interface BatchResult {
  languageCode: string;
  languageName: string;
  status: "pending" | "translating" | "completed" | "error";
  result?: TranslationResult;
  error?: string;
}

export default function Translator() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Source text state
  const [sourceText, setSourceText] = useState("");
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);

  // PDF upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Translation state
  const [targetLanguage, setTargetLanguage] = useState("");
  const [marketContext, setMarketContext] = useState("standard");
  const [isTranslating, setIsTranslating] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("translation");

  // Batch translation state
  const [translateAll, setTranslateAll] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number>(-1);
  const [isBatchRunning, setIsBatchRunning] = useState(false);

  // Collapse state for batch results
  const [expandedLanguages, setExpandedLanguages] = useState<Set<string>>(new Set());

  // --- PDF Upload Handlers ---

  const handleFileSelect = useCallback(async (file: File | null) => {
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setPdfFileName(null);
    setPdfPageCount(null);

    try {
      const parsed = await parsePDF(file);

      // Split into chunks if too large
      const chunks = splitTextIntoChunks(parsed.text, 5000);
      const finalText = chunks.length === 1 ? parsed.text : chunks.join("\n\n--- PAGE BREAK ---\n\n");

      setSourceText(finalText);
      setPdfFileName(file.name);
      setPdfPageCount(parsed.numPages);

      // Validate
      const validation = validateTextForTranslation(finalText);
      if (!validation.valid) {
        setUploadError(validation.errors.join(" "));
      } else if (validation.warnings.length > 0) {
        setUploadError(validation.warnings.join(" "));
      }
    } catch (err) {
      const pdfError = err as PDFParseError;
      setUploadError(pdfError.message || "Failed to parse PDF. Please try again.");
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      handleFileSelect(file);
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
    setUploadError(null);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const loadSample = useCallback(() => {
    setSourceText(generateSampleText());
    setPdfFileName(null);
    setPdfPageCount(null);
    setUploadError(null);
  }, []);

  // --- Single Translation ---

  const handleTranslate = useCallback(async () => {
    if (!sourceText.trim() || !targetLanguage) return;

    setIsTranslating(true);
    setResult(null);

    const config = {
      sourceText: sourceText.trim(),
      targetLanguage,
      marketContext,
      chapterNumber: 1,
    };

    try {
      const translationResult = await runTranslationPipeline(config);
      setResult(translationResult);
      setActiveTab("translation");
    } catch (error) {
      console.error("Translation failed:", error);
      setUploadError(
        `Translation failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsTranslating(false);
    }
  }, [sourceText, targetLanguage, marketContext]);

  // --- Batch Translation (All Languages) ---

  const handleTranslateAll = useCallback(async () => {
    if (!sourceText.trim()) return;

    setIsBatchRunning(true);
    setTranslateAll(true);
    setCurrentBatchIndex(0);

    const initialResults: BatchResult[] = targetLanguages.map((lang) => ({
      languageCode: lang.code,
      languageName: lang.name,
      status: "pending",
    }));

    setBatchResults([...initialResults]);

    for (let i = 0; i < targetLanguages.length; i++) {
      const lang = targetLanguages[i];
      setCurrentBatchIndex(i);

      setBatchResults((prev) =>
        prev.map((r, idx) =>
          idx === i ? { ...r, status: "translating" as const } : r
        )
      );

      try {
        const config = {
          sourceText: sourceText.trim(),
          targetLanguage: lang.code,
          marketContext,
          chapterNumber: 1,
        };

        const translationResult = await runTranslationPipeline(config);

        setBatchResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ...r, status: "completed" as const, result: translationResult }
              : r
          )
        );
      } catch (error) {
        setBatchResults((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  status: "error" as const,
                  error: error instanceof Error ? error.message : "Translation failed",
                }
              : r
          )
        );
      }
    }

    setIsBatchRunning(false);
  }, [sourceText, marketContext]);

  const toggleLanguageExpand = useCallback((code: string) => {
    setExpandedLanguages((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  // --- Export Handlers ---

  const handleCopy = useCallback(() => {
    if (result?.translatedText) {
      navigator.clipboard.writeText(result.translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [result]);

  const handleDownloadCSV = useCallback(() => {
    if (!result?.csvData) return;
    const allItems = [
      ...result.csvData.mapNames.map((item) => ({ type: "Map", ...item })),
      ...result.csvData.runeCaptions.map((item) => ({ type: "Rune", ...item })),
      ...result.csvData.endpaperText.map((item) => ({ type: "Endpaper", ...item })),
    ];
    const rows = [
      ["Type", "Original", "Translated"],
      ...allItems.map((item) => [item.type, item.original, item.translated]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `localization-data-${targetLanguage || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, targetLanguage]);

  const handleDownloadText = useCallback(() => {
    if (!result?.translatedText) return;
    const blob = new Blob([result.translatedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translated-chapter-${targetLanguage || "unknown"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, targetLanguage]);

  const handleDownloadAllTexts = useCallback(() => {
    const completedResults = batchResults.filter((r) => r.status === "completed" && r.result);
    if (completedResults.length === 0) return;

    for (const batchResult of completedResults) {
      if (!batchResult.result) continue;
      const blob = new Blob([batchResult.result.translatedText], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `translated-${batchResult.languageName.toLowerCase()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [batchResults]);

  const handleDownloadAllCSVs = useCallback(() => {
    const completedResults = batchResults.filter((r) => r.status === "completed" && r.result);
    if (completedResults.length === 0) return;

    for (const batchResult of completedResults) {
      if (!batchResult.result?.csvData) continue;
      const allItems = [
        ...batchResult.result.csvData.mapNames.map((item) => ({ type: "Map", ...item })),
        ...batchResult.result.csvData.runeCaptions.map((item) => ({ type: "Rune", ...item })),
        ...batchResult.result.csvData.endpaperText.map((item) => ({ type: "Endpaper", ...item })),
      ];
      const rows = [
        ["Type", "Original", "Translated"],
        ...allItems.map((item) => [item.type, item.original, item.translated]),
      ];
      const csv = rows.map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `localization-${batchResult.languageName.toLowerCase()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [batchResults]);

  // --- Helpers ---

  const getPhaseIcon = (status: TranslationPhase["status"]) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="size-4 text-green-500" />;
      case "active":
        return <Loader2 className="size-4 text-primary animate-spin" />;
      case "error":
        return <XCircle className="size-4 text-red-500" />;
      default:
        return <Clock className="size-4 text-muted-foreground/40" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-green-500";
    if (score >= 75) return "text-yellow-500";
    return "text-red-500";
  };

  const wordCount = sourceText
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  const completedBatchCount = batchResults.filter(
    (r) => r.status === "completed"
  ).length;

  const errorBatchCount = batchResults.filter((r) => r.status === "error").length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-border/40">
        <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              <div className="size-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
                <Languages className="size-4 text-primary-foreground" />
              </div>
              <span className="text-base font-semibold tracking-tight hidden sm:block">
                Empyrean Translator
              </span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            {user?.name && (
              <span className="text-sm text-muted-foreground">{user.name}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/dashboard")}
            >
              Dashboard
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
          {/* Left Panel - Controls */}
          <div className="space-y-4">
            {/* PDF Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload className="size-4" />
                  Upload PDF
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload an English PDF manuscript (max 20MB)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={`
                    relative flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed
                    cursor-pointer transition-all duration-200
                    ${
                      isDragOver
                        ? "border-primary bg-primary/5 scale-[1.02]"
                        : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-muted/30"
                    }
                    ${isUploading ? "pointer-events-none opacity-60" : ""}
                  `}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="size-8 text-primary animate-spin" />
                      <span className="text-sm text-muted-foreground">
                        Parsing PDF...
                      </span>
                    </>
                  ) : pdfFileName ? (
                    <>
                      <div className="size-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                        <FileUp className="size-6 text-green-500" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium">{pdfFileName}</p>
                        {pdfPageCount && (
                          <p className="text-xs text-muted-foreground">
                            {pdfPageCount} pages • {wordCount.toLocaleString()} words
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearSource();
                        }}
                      >
                        <X className="size-3 mr-1" />
                        Remove
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="size-12 rounded-xl bg-muted/50 flex items-center justify-center">
                        <FileUp className="size-6 text-muted-foreground/40" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium">
                          Drop a PDF here or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Supports text-based PDFs up to 20MB
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {uploadError && (
                  <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-xs">
                    <AlertCircle className="size-4 text-yellow-500 shrink-0 mt-0.5" />
                    <span>{uploadError}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Source Text (manual paste / extracted from PDF) */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Source Text</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadSample}
                    className="text-xs h-7"
                  >
                    <Sparkles className="size-3 mr-1" />
                    Load sample
                  </Button>
                </div>
                <CardDescription className="text-xs">
                  {pdfFileName
                    ? "Text extracted from PDF. Edit below if needed."
                    : "Or paste your English manuscript (max 5,000 words per batch)"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={sourceText}
                  onChange={(e) => {
                    setSourceText(e.target.value);
                    if (pdfFileName) setPdfFileName(null);
                  }}
                  placeholder="Paste your chapter text here or upload a PDF above..."
                  className="min-h-[200px] resize-none font-mono text-sm leading-relaxed"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{wordCount.toLocaleString()} words</span>
                  <span>{sourceText.length.toLocaleString()} characters</span>
                </div>
              </CardContent>
            </Card>

            {/* Target Language */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Target Language</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {targetLanguages.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        <div className="flex items-center gap-2">
                          <span>{lang.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {lang.nativeName}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-[10px] ml-auto"
                          >
                            {lang.script}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {targetLanguage && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Globe className="size-3" />
                    <span>
                      {targetLanguages.find((l) => l.code === targetLanguage)
                        ?.script}{" "}
                      script
                      {["ar", "ur", "ks"].includes(targetLanguage)
                        ? " • RTL"
                        : " • LTR"}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Market Context */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Market Context</CardTitle>
                <CardDescription className="text-xs">
                  Adjust sensitivity filters for target markets
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  value={marketContext}
                  onValueChange={setMarketContext}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {marketContexts.map((ctx) => (
                      <SelectItem key={ctx.id} value={ctx.id}>
                        <div>
                          <div className="font-medium">{ctx.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {ctx.description}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="space-y-2">
              <Button
                onClick={handleTranslate}
                disabled={!sourceText.trim() || !targetLanguage || isTranslating || isBatchRunning}
                className="w-full h-11"
                size="lg"
              >
                {isTranslating ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Translating...
                  </>
                ) : (
                  <>
                    <Play className="size-4 mr-2" />
                    Translate to Selected Language
                  </>
                )}
              </Button>

              <Button
                onClick={handleTranslateAll}
                disabled={!sourceText.trim() || isTranslating || isBatchRunning}
                variant="default"
                className="w-full h-11 bg-gradient-to-r from-primary via-primary/90 to-primary/80 hover:from-primary/90 hover:via-primary/80 hover:to-primary/70"
                size="lg"
              >
                {isBatchRunning ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Translating {currentBatchIndex + 1}/{targetLanguages.length}...
                  </>
                ) : (
                  <>
                    <Package className="size-4 mr-2" />
                    Translate to All 20 Languages
                  </>
                )}
              </Button>
            </div>

            {/* Batch Progress */}
            {translateAll && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    {isBatchRunning ? (
                      <Loader2 className="size-4 text-primary animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4 text-green-500" />
                    )}
                    {isBatchRunning
                      ? `Translating (${completedBatchCount}/${targetLanguages.length})`
                      : "Batch Complete"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Overall progress bar */}
                  <div className="mb-4">
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{
                          width: `${(completedBatchCount / targetLanguages.length) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                      <span>
                        {completedBatchCount} completed
                        {errorBatchCount > 0 && (
                          <span className="text-red-500">
                            {" • "}
                            {errorBatchCount} failed
                          </span>
                        )}
                      </span>
                      <span>
                        {targetLanguages.length - completedBatchCount - errorBatchCount}{" "}
                        remaining
                      </span>
                    </div>
                  </div>

                  {/* Download all buttons */}
                  {!isBatchRunning && completedBatchCount > 0 && (
                    <div className="flex gap-2 mb-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs flex-1"
                        onClick={handleDownloadAllTexts}
                      >
                        <Download className="size-3 mr-1" />
                        All Texts
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs flex-1"
                        onClick={handleDownloadAllCSVs}
                      >
                        <FileText className="size-3 mr-1" />
                        All CSVs
                      </Button>
                    </div>
                  )}

                  <ScrollArea className="max-h-[240px]">
                    <div className="space-y-1">
                      {batchResults.map((br) => {
                        const lang = targetLanguages.find(
                          (l) => l.code === br.languageCode
                        );
                        const isExpanded = expandedLanguages.has(br.languageCode);

                        return (
                          <div key={br.languageCode}>
                            <div
                              className={`flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors ${
                                br.status === "translating"
                                  ? "bg-primary/5"
                                  : br.status === "completed"
                                    ? "hover:bg-muted/50 cursor-pointer"
                                    : br.status === "error"
                                      ? "bg-red-500/5"
                                      : ""
                              }`}
                              onClick={() => {
                                if (br.status === "completed") {
                                  toggleLanguageExpand(br.languageCode);
                                }
                              }}
                            >
                              {br.status === "translating" && (
                                <Loader2 className="size-4 text-primary animate-spin shrink-0" />
                              )}
                              {br.status === "completed" && (
                                <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                              )}
                              {br.status === "error" && (
                                <XCircle className="size-4 text-red-500 shrink-0" />
                              )}
                              {br.status === "pending" && (
                                <Clock className="size-4 text-muted-foreground/40 shrink-0" />
                              )}

                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium">
                                  {lang?.name}{" "}
                                  <span className="text-muted-foreground font-normal">
                                    {lang?.nativeName}
                                  </span>
                                </div>
                                {br.error && (
                                  <div className="text-[10px] text-red-500 truncate">
                                    {br.error}
                                  </div>
                                )}
                              </div>

                              {br.status === "completed" && (
                                <ChevronDown
                                  className={`size-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                                />
                              )}
                            </div>

                            {/* Expanded view: show result for single language */}
                            {isExpanded && br.result && (
                              <div className="ml-6 mb-2 p-3 rounded-lg bg-muted/30 border border-border/40">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant="secondary" className="text-[10px]">
                                    Quality: {br.result.report.overallScore}/100
                                  </Badge>
                                </div>
                                <div className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap leading-relaxed">
                                  {br.result.translatedText.substring(0, 500)}...
                                </div>
                                <div className="flex gap-2 mt-2">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 text-[10px]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const blob = new Blob(
                                        [br.result!.translatedText],
                                        { type: "text/plain;charset=utf-8" }
                                      );
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = `translated-${br.languageName.toLowerCase()}.txt`;
                                      a.click();
                                      URL.revokeObjectURL(url);
                                    }}
                                  >
                                    <Download className="size-3 mr-1" />
                                    .txt
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Single result phase progress */}
            {result && !translateAll && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-500" />
                    Pipeline Complete
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="max-h-[300px]">
                    <div className="space-y-1">
                      {result.phases.map((phase) => (
                        <div
                          key={phase.id}
                          className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
                        >
                          {getPhaseIcon(phase.status)}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">
                              {phase.name}
                            </div>
                            {phase.notes && (
                              <div className="text-[10px] text-muted-foreground truncate">
                                {phase.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Panel - Output */}
          <div className="min-h-0 relative">
            {!result && !isTranslating && !isBatchRunning && !translateAll ? (
              <Card className="h-full min-h-[600px] flex items-center justify-center">
                <CardContent className="text-center">
                  <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                    <Languages className="size-8 text-muted-foreground/40" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Ready to Translate</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Upload a PDF manuscript or paste your source text. Then choose
                    a single target language or translate to all 20 languages at
                    once. The 18-phase pipeline handles glossary mapping, voice
                    adaptation, cultural filtering, and script formatting.
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-6">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="size-3.5 mr-1.5" />
                      Upload PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={loadSample}>
                      <Sparkles className="size-3.5 mr-1.5" />
                      Load sample
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base">Translation Output</CardTitle>
                      {targetLanguage && !translateAll && (
                        <Badge variant="secondary">
                          {targetLanguages.find(
                            (l) => l.code === targetLanguage
                          )?.name}
                        </Badge>
                      )}
                      {translateAll && (
                        <Badge variant="secondary">
                          All 20 Languages
                        </Badge>
                      )}
                      {marketContext !== "standard" && (
                        <Badge
                          variant="outline"
                          className="text-yellow-600 border-yellow-600/30"
                        >
                          <Shield className="size-3 mr-1" />
                          {marketContexts.find((c) => c.id === marketContext)?.name}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadText}
                        className="h-8"
                        disabled={!result}
                      >
                        <Download className="size-3.5 mr-1" />
                        Text
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadCSV}
                        className="h-8"
                        disabled={!result}
                      >
                        <FileText className="size-3.5 mr-1" />
                        CSV
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopy}
                        className="h-8"
                        disabled={!result}
                      >
                        {copied ? (
                          <Check className="size-3.5 mr-1 text-green-500" />
                        ) : (
                          <Copy className="size-3.5 mr-1" />
                        )}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="h-full"
                  >
                    <TabsList className="mb-4">
                      <TabsTrigger value="translation">
                        <FileText className="size-3.5 mr-1.5" />
                        Translation
                      </TabsTrigger>
                      <TabsTrigger value="report">
                        <BarChart3 className="size-3.5 mr-1.5" />
                        Report
                      </TabsTrigger>
                      <TabsTrigger value="voices">
                        <Volume2 className="size-3.5 mr-1.5" />
                        Voice Notes
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="translation" className="mt-0">
                      <ScrollArea className="h-[calc(100vh-320px)]">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <div className="whitespace-pre-wrap font-serif text-[15px] leading-[1.8] p-6 rounded-xl bg-muted/30 border border-border/40">
                            {result?.translatedText || (
                              <span className="text-muted-foreground italic">
                                {isBatchRunning
                                  ? `Translating to ${targetLanguages[currentBatchIndex]?.name || "..."}...`
                                  : "Translation will appear here..."}
                              </span>
                            )}
                          </div>
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="report" className="mt-0">
                      <ScrollArea className="h-[calc(100vh-320px)]">
                        {result?.report && (
                          <div className="space-y-6 p-1">
                            <ReportSection report={result.report} />
                          </div>
                        )}
                        {!result?.report && (
                          <div className="text-center py-12 text-muted-foreground">
                            <BarChart3 className="size-8 mx-auto mb-3 opacity-40" />
                            <p className="text-sm">Report will appear after translation.</p>
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent value="voices" className="mt-0">
                      <ScrollArea className="h-[calc(100vh-320px)]">
                        <div className="space-y-3 p-1">
                          {result?.voiceNotes.map((note, i) => (
                            <div
                              key={i}
                              className="p-4 rounded-xl bg-muted/30 border border-border/40"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Volume2 className="size-4 text-primary" />
                                <span className="text-sm font-semibold">
                                  {note.character}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] ml-auto"
                                >
                                  {note.emotionalContext}
                                </Badge>
                              </div>
                              <div className="text-sm italic text-muted-foreground mb-2">
                                &ldquo;{note.line}&rdquo;
                              </div>
                              <div className="text-xs text-foreground bg-background/50 rounded-lg p-2.5">
                                <strong>Direction:</strong> {note.instruction}
                              </div>
                            </div>
                          ))}
                          {(!result?.voiceNotes ||
                            result.voiceNotes.length === 0) && (
                            <div className="text-center py-12 text-muted-foreground">
                              <Volume2 className="size-8 mx-auto mb-3 opacity-40" />
                              <p className="text-sm">
                                No dialogue detected in this text segment.
                              </p>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}

            {/* Single translation overlay */}
            {isTranslating && (
              <Card className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center">
                <CardContent className="text-center">
                  <div className="relative">
                    <div className="size-20 rounded-full border-4 border-primary/20 border-t-primary animate-spin mx-auto" />
                    <Sparkles className="size-6 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <h3 className="text-lg font-semibold mt-6 mb-2">
                    Running 18-Phase Pipeline
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Applying glossary mapping, voice adaptation, cultural
                    filtering...
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportSection({ report }: { report: TranslationReport }) {
  const scores = [
    {
      label: "Overall Quality",
      value: report.overallScore,
      icon: BarChart3,
    },
    {
      label: "Character Consistency",
      value: report.characterConsistency,
      icon: BookOpen,
    },
    {
      label: "Cultural Compliance",
      value: report.culturalCompliance,
      icon: Globe,
    },
    {
      label: "Narrative Flow",
      value: report.narrativeFlow,
      icon: FileText,
    },
    {
      label: "Glossary Adherence",
      value: report.glossaryAdherence,
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold mb-4">Quality Scores</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {scores.map((score) => (
            <div
              key={score.label}
              className="p-4 rounded-xl bg-muted/30 border border-border/40"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <score.icon className="size-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{score.label}</span>
                </div>
                <span
                  className={`text-lg font-bold ${getScoreColor(score.value)}`}
                >
                  {score.value}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-1000"
                  style={{ width: `${score.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="size-4 text-yellow-500" />
            Warnings
          </h3>
          <div className="space-y-2">
            {report.warnings.map((warning, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-sm"
              >
                {warning}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.recommendations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 className="size-4 text-green-500" />
            Recommendations
          </h3>
          <div className="space-y-2">
            {report.recommendations.map((rec, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 text-sm"
              >
                {rec}
              </div>
            ))}
          </div>
        </div>
      )}

      {report.issues.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <XCircle className="size-4 text-red-500" />
            Issues
          </h3>
          <div className="space-y-2">
            {report.issues.map((issue, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-sm"
              >
                {issue}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold mb-3">Export Options</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-xl bg-muted/30 border border-border/40 text-center">
            <FileText className="size-6 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm font-medium">CSV Export</div>
            <div className="text-xs text-muted-foreground mt-1">
              Map names, rune captions, endpaper text
            </div>
          </div>
          <div className="p-4 rounded-xl bg-muted/30 border border-border/40 text-center">
            <Volume2 className="size-6 mx-auto mb-2 text-muted-foreground" />
            <div className="text-sm font-medium">Voice Notes</div>
            <div className="text-xs text-muted-foreground mt-1">
              Audiobook narrator instructions
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getScoreColor(score: number) {
  if (score >= 90) return "text-green-500";
  if (score >= 75) return "text-yellow-500";
  return "text-red-500";
}
