import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Clock, Download, Trash2, CheckCircle2, Loader2 } from "lucide-react";

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}

export function HistoryPanel({ open, onClose, sessionId }: HistoryPanelProps) {
  const history = useQuery(
    api.queries.getHistory,
    sessionId ? { sessionId } : "skip"
  );
  const deleteHistoryMutation = useMutation(api.history.deleteHistory);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 transition-opacity"
        style={{ WebkitTapHighlightColor: "transparent" }}
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="relative w-full max-w-md h-full flex flex-col overflow-hidden"
        style={{
          background: "rgba(6,6,14,0.98)",
          borderLeft: "1px solid rgba(0,229,255,0.15)",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.5), -2px 0 10px rgba(0,229,255,0.05)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid rgba(0,229,255,0.1)" }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="size-8 rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(0,229,255,0.15), rgba(167,139,250,0.15))",
                border: "1px solid rgba(0,229,255,0.2)",
              }}
            >
              <Clock className="size-4" style={{ color: "#00e5ff" }} />
            </div>
            <div>
              <span className="text-sm font-semibold">Translation History</span>
              <span className="text-[10px] text-muted-foreground block">
                {history?.length ?? 0} translation{(history?.length ?? 0) !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="size-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <X className="size-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 px-4 py-3">
          {!history ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mb-2" />
              <span className="text-xs">Loading history...</span>
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Clock className="size-8 mb-3 opacity-30" />
              <span className="text-xs">No translation history yet</span>
              <span className="text-[10px] mt-1 opacity-60">Start a translation to see it here</span>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => {
                const isComplete = entry.status === "complete";
                const date = new Date(entry.createdAt);
                return (
                  <div
                    key={entry._id}
                    className="rounded-lg p-3 transition-all"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(0,229,255,0.08)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isComplete ? (
                          <CheckCircle2 className="size-3.5 shrink-0" style={{ color: "#34d399" }} />
                        ) : (
                          <Loader2 className="size-3.5 shrink-0 animate-spin" style={{ color: "#a78bfa" }} />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{entry.fileName}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {entry.pageCount} pages &bull; {entry.wordCount.toLocaleString()} words
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteHistoryMutation({ historyId: entry._id })}
                        className="size-5 rounded flex items-center justify-center shrink-0 transition-colors hover:bg-red-500/10"
                        title="Remove from history"
                      >
                        <Trash2 className="size-2.5 text-muted-foreground hover:text-red-400" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-muted-foreground">
                        {entry.languagesCompleted}/{20} languages &bull;{" "}
                        {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isComplete && entry.zipUrl && (
                        <a
                          href={entry.zipUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
                          style={{
                            color: "#00e5ff",
                            background: "rgba(0,229,255,0.08)",
                            border: "1px solid rgba(0,229,255,0.15)",
                          }}
                        >
                          <Download className="size-2.5" /> ZIP
                        </a>
                      )}
                    </div>
                    {/* Status bar */}
                    <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${(entry.languagesCompleted / 20) * 100}%`,
                          background: isComplete
                            ? "linear-gradient(90deg, #34d399, #00e5ff)"
                            : "linear-gradient(90deg, #a78bfa, #00e5ff)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
