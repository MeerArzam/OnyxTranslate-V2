import { useState, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, CheckCircle2, Loader2, FileText } from "lucide-react";
import type { Id } from "../../convex/_generated/dataModel";

interface Language {
  code: string;
  name: string;
  nativeName: string;
}

interface TranslationEntry {
  langCode: string;
  status: string;
  totalChunks: number;
  completedChunks: number;
  mergedText?: string | null;
  pdfUrl?: string | null;
  pdfGenerating?: boolean | null;
}

interface LanguageAccordionProps {
  projectId: Id<"projects">;
  languages: Language[];
  translations: TranslationEntry[];
  activeLangCode: string | null;
  onLanguageSelect?: (langCode: string) => void;
}

const RTL_LANGS = ["ar", "ur", "ks"];

export function LanguageAccordion({
  projectId,
  languages,
  translations,
  activeLangCode,
  onLanguageSelect,
}: LanguageAccordionProps) {
  const [expandedLang, setExpandedLang] = useState<string | null>(activeLangCode);

  // Auto-expand the active language
  if (activeLangCode && expandedLang !== activeLangCode) {
    // Only auto-expand, don't collapse others
  }

  const toggle = useCallback((code: string) => {
    setExpandedLang((prev) => (prev === code ? null : code));
    onLanguageSelect?.(code);
  }, [onLanguageSelect]);

  return (
    <div className="space-y-1">
      {languages.map((lang) => {
        const t = translations.find((tr) => tr.langCode === lang.code);
        if (!t) return null;

        const isComplete = t.status === "complete";
        const isActive = t.status === "in_progress";
        const isPdf = t.status === "generating_pdf" || t.pdfGenerating;
        const isExpanded = expandedLang === lang.code || (isActive && expandedLang === null);
        const isRtl = RTL_LANGS.includes(lang.code);
        const wordCount = t.mergedText
          ? t.mergedText.split(/\s+/).filter(Boolean).length
          : 0;
        const pct = isComplete
          ? 100
          : Math.round((t.completedChunks / Math.max(t.totalChunks, 1)) * 100);

        return (
          <div key={lang.code}>
            {/* Accordion trigger */}
            <button
              onClick={() => toggle(lang.code)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-left"
              style={{
                background: isExpanded
                  ? "rgba(0,229,255,0.05)"
                  : "rgba(255,255,255,0.01)",
                border: `1px solid ${isExpanded ? "rgba(0,229,255,0.12)" : "rgba(255,255,255,0.04)"}`,
              }}
            >
              <ChevronRight
                className="size-3 shrink-0 transition-transform duration-200"
                style={{
                  color: isExpanded ? "#00e5ff" : "rgba(255,255,255,0.3)",
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                }}
              />
              <span className="text-xs font-medium min-w-0 truncate" style={{ color: isExpanded ? "#e2e8f0" : "rgba(255,255,255,0.6)" }}>
                {lang.nativeName}
              </span>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {lang.name}
              </span>
              <span className="ml-auto shrink-0 flex items-center gap-1">
                {isComplete ? (
                  <CheckCircle2 className="size-3" style={{ color: "#34d399" }} />
                ) : isActive ? (
                  <Loader2 className="size-3 animate-spin" style={{ color: "#00e5ff" }} />
                ) : isPdf ? (
                  <FileText className="size-3" style={{ color: "#a78bfa" }} />
                ) : (
                  <div className="size-2 rounded-full border" style={{ borderColor: "rgba(255,255,255,0.15)" }} />
                )}
              </span>
              {wordCount > 0 && (
                <span className="text-[9px] text-muted-foreground shrink-0 font-mono">
                  {wordCount.toLocaleString()}w
                </span>
              )}
            </button>

            {/* Accordion content */}
            {isExpanded && (
              <div
                className="mx-3 mb-1 rounded-lg overflow-hidden accordion-content"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(0,229,255,0.06)",
                }}
              >
                {/* Mini progress when active */}
                {isActive && (
                  <div className="px-3 py-1.5" style={{ borderBottom: "1px solid rgba(0,229,255,0.06)" }}>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span style={{ color: "#00e5ff" }}>
                        Chunk {t.completedChunks}/{t.totalChunks}
                      </span>
                      <span className="text-muted-foreground">&bull;</span>
                      <span style={{ color: "#00e5ff" }}>{pct}%</span>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden mt-1" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          background: "linear-gradient(90deg, #00e5ff, #a78bfa)",
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Translated text */}
                {t.mergedText ? (
                  <ScrollArea className="max-h-[400px]">
                    <div
                      className="p-3 text-xs leading-relaxed whitespace-pre-wrap"
                      style={{
                        direction: isRtl ? "rtl" : "ltr",
                        textAlign: isRtl ? "right" : "left",
                        fontFamily: "serif",
                        lineHeight: "1.7",
                      }}
                    >
                      {t.mergedText}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="p-3 text-[10px] text-muted-foreground italic">
                    {isActive ? "Translating..." : isPdf ? "Generating PDF..." : "Pending"}
                  </div>
                )}

                {/* PDF download link */}
                {isComplete && t.pdfUrl && (
                  <div className="px-3 py-2" style={{ borderTop: "1px solid rgba(0,229,255,0.06)" }}>
                    <a
                      href={t.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded text-[10px] font-medium transition-colors"
                      style={{
                        color: "#00e5ff",
                        background: "rgba(0,229,255,0.06)",
                        border: "1px solid rgba(0,229,255,0.15)",
                      }}
                    >
                      <FileText className="size-2.5" /> Download PDF
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
