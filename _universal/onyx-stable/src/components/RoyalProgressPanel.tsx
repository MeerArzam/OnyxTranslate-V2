import { CheckCircle2, Loader2, Circle, FileText, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface LanguageStatus {
  code: string;
  name: string;
  nativeName: string;
  status: "pending" | "translating" | "generating_pdf" | "complete";
  chunksDone: number;
  chunksTotal: number;
  wordCount: number;
}

interface RoyalProgressPanelProps {
  languages: LanguageStatus[];
  activeIndex: number;
  overallProgress: number;
  projectName: string;
  isPaused?: boolean;
  onResume?: () => void;
  onPause?: () => void;
  onDownload?: () => void;
  onStartFresh?: () => void;
}

export default function RoyalProgressPanel({
  languages,
  activeIndex,
  overallProgress,
  projectName,
  isPaused,
  onResume,
  onPause,
  onDownload,
  onStartFresh,
}: RoyalProgressPanelProps) {
  const active = languages[activeIndex];
  const completedCount = languages.filter((l) => l.status === "complete").length;
  const hasStarted = languages.some((l) => l.status !== "pending");

  return (
    <div className="flex flex-col gap-3 p-4 w-full">
      {/* ── ACTIVE BANNER ── */}
      {active && active.status !== "complete" && hasStarted && (
        <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-950/80 to-gray-950/90 p-4 animate-royal-glow">
          {/* Top row: language name */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
              <span className="text-yellow-300 font-bold text-lg sm:text-xl tracking-wide">
                {active.nativeName || active.name}
              </span>
              <span className="text-purple-300/70 text-sm">
                ({active.name})
              </span>
            </div>
            <span className="text-purple-300/70 text-sm font-mono">
              {activeIndex + 1} / {languages.length}
            </span>
          </div>

          {/* Chunk counter */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-xs sm:text-sm">
              Chunk {active.chunksDone} of {active.chunksTotal}
            </span>
            <span className="text-yellow-400/80 text-xs sm:text-sm font-mono">
              {active.chunksTotal > 0
                ? Math.round((active.chunksDone / active.chunksTotal) * 100)
                : 0}
              %
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-3 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-purple-600 via-yellow-400 to-purple-600"
              style={{
                width: `${
                  active.chunksTotal > 0
                    ? (active.chunksDone / active.chunksTotal) * 100
                    : 0
                }%`,
                backgroundSize: "200% auto",
                animation: "royal-shimmer 2s linear infinite",
              }}
            />
          </div>
        </div>
      )}

      {/* ── OVERALL PROGRESS ── */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-gray-300 text-sm font-medium">Overall</span>
          </div>
          <span className="text-yellow-300 text-sm font-bold font-mono">
            {completedCount} / {languages.length} languages
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-600 to-yellow-500 transition-all duration-700"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      </div>

      {/* ── ACTION BUTTONS (when paused) ── */}
      {isPaused && hasStarted && (
        <div className="flex gap-2">
          {onResume && (
            <button
              onClick={onResume}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: "linear-gradient(135deg, rgba(167,139,250,0.2), rgba(250,204,21,0.15))",
                border: "1px solid rgba(167,139,250,0.4)",
                color: "#a78bfa",
              }}
            >
              <Loader2 className="w-3.5 h-3.5" /> Resume
            </button>
          )}
          {onDownload && completedCount > 0 && (
            <button
              onClick={onDownload}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all"
              style={{
                background: "rgba(52,211,153,0.1)",
                border: "1px solid rgba(52,211,153,0.3)",
                color: "#34d399",
              }}
            >
              Download Done
            </button>
          )}
          {onStartFresh && (
            <button
              onClick={onStartFresh}
              className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-all"
              style={{
                background: "rgba(255,71,87,0.08)",
                border: "1px solid rgba(255,71,87,0.25)",
                color: "#ff4757",
              }}
            >
              <Circle className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {/* ── LANGUAGE QUEUE ── */}
      <div className="flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto pr-1">
        {languages.map((lang, i) => {
          const isActive = i === activeIndex && lang.status === "translating";
          const isComplete = lang.status === "complete";
          const isGenerating = lang.status === "generating_pdf";

          return (
            <div
              key={lang.code}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-300",
                isActive &&
                  "bg-purple-900/30 border border-purple-500/40 animate-royal-pulse",
                isComplete && "bg-gray-900/30 opacity-60",
                !isActive && !isComplete && "bg-transparent"
              )}
            >
              {/* Status icon */}
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {isComplete ? (
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                ) : isActive ? (
                  <Loader2 className="w-5 h-5 text-yellow-400 animate-spin" />
                ) : isGenerating ? (
                  <FileText className="w-5 h-5 text-blue-400 animate-pulse" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-600" />
                )}
              </div>

              {/* Language name */}
              <div className="flex-1 min-w-0">
                <span
                  className={cn(
                    "text-sm truncate block",
                    isComplete && "text-green-300/80",
                    isActive && "text-yellow-300 font-medium",
                    !isActive && !isComplete && "text-gray-500"
                  )}
                >
                  {lang.nativeName || lang.name}
                </span>
              </div>

              {/* Right side: chunk count or checkmark */}
              <div className="flex-shrink-0">
                {isComplete ? (
                  <span className="text-green-400/70 text-xs font-mono">
                    {lang.wordCount.toLocaleString()}w
                  </span>
                ) : isActive ? (
                  <span className="text-yellow-400/80 text-xs font-mono">
                    {lang.chunksDone}/{lang.chunksTotal}
                  </span>
                ) : isGenerating ? (
                  <span className="text-blue-400/70 text-xs">PDF</span>
                ) : (
                  <span className="text-gray-700 text-xs">&mdash;</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
