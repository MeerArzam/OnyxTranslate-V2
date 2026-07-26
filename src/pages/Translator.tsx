import { useState, useCallback, useRef, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
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
  ChevronRight,
  RotateCcw,
  Sparkles,
  Shield,
  BookOpen,
  CheckCircle2,
  XCircle,
  Clock,
  Globe,
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

export default function Translator() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sourceText, setSourceText] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [marketContext, setMarketContext] = useState("standard");
  const [isTranslating, setIsTranslating] = useState(false);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [activePhase, setActivePhase] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("translation");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadSample = useCallback(() => {
    setSourceText(generateSampleText());
  }, []);

  const handleTranslate = useCallback(async () => {
    if (!sourceText.trim() || !targetLanguage) return;

    setIsTranslating(true);
    setResult(null);
    setActivePhase(null);

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
    } finally {
      setIsTranslating(false);
      setActivePhase(null);
    }
  }, [sourceText, targetLanguage, marketContext]);

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
    a.download = `localization-data-${targetLanguage}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, targetLanguage]);

  const handleDownloadText = useCallback(() => {
    if (!result?.translatedText) return;
    const blob = new Blob([result.translatedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translated-chapter-${targetLanguage}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, targetLanguage]);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
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
              <span className="text-sm text-muted-foreground">
                {user.name}
              </span>
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
            {/* Source Text */}
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
                  Paste your English manuscript (max 5,000 words per batch)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  ref={textareaRef}
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="Paste your chapter text here..."
                  className="min-h-[240px] resize-none font-mono text-sm leading-relaxed"
                />
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {sourceText.split(/\s+/).filter(Boolean).length} words
                  </span>
                  <span>
                    {sourceText.length.toLocaleString()} characters
                  </span>
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
                          <Badge variant="secondary" className="text-[10px] ml-auto">
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
                      {targetLanguages.find((l) => l.code === targetLanguage)?.script}{" "}
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
                <Select value={marketContext} onValueChange={setMarketContext}>
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

            {/* Translate Button */}
            <Button
              onClick={handleTranslate}
              disabled={!sourceText.trim() || !targetLanguage || isTranslating}
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
                  Run 18-Phase Pipeline
                </>
              )}
            </Button>

            {/* Phase Progress */}
            {result && (
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
          <div className="min-h-0">
            {!result && !isTranslating ? (
              <Card className="h-full min-h-[600px] flex items-center justify-center">
                <CardContent className="text-center">
                  <div className="size-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                    <Languages className="size-8 text-muted-foreground/40" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">
                    Ready to Translate
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Paste your source text, select a target language, and run the
                    18-phase translation pipeline. The engine will handle
                    glossary mapping, voice adaptation, cultural filtering, and
                    script formatting.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base">
                        Translation Output
                      </CardTitle>
                      {targetLanguage && (
                        <Badge variant="secondary">
                          {targetLanguages.find(
                            (l) => l.code === targetLanguage
                          )?.name}
                        </Badge>
                      )}
                      {marketContext !== "standard" && (
                        <Badge variant="outline" className="text-yellow-600 border-yellow-600/30">
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
                      >
                        <Download className="size-3.5 mr-1" />
                        Text
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadCSV}
                        className="h-8"
                      >
                        <FileText className="size-3.5 mr-1" />
                        CSV
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopy}
                        className="h-8"
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

                    <TabsContent
                      value="translation"
                      className="mt-0"
                    >
                      <ScrollArea className="h-[calc(100vh-320px)]">
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <div className="whitespace-pre-wrap font-serif text-[15px] leading-[1.8] p-6 rounded-xl bg-muted/30 border border-border/40">
                            {result?.translatedText}
                          </div>
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent
                      value="report"
                      className="mt-0"
                    >
                      <ScrollArea className="h-[calc(100vh-320px)]">
                        {result?.report && (
                          <div className="space-y-6 p-1">
                            <ReportSection report={result.report} />
                          </div>
                        )}
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent
                      value="voices"
                      className="mt-0"
                    >
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
