import { FileText, ChevronRight, History } from "lucide-react";
import type { Doc, Id } from "../../convex/_generated/dataModel";

/**
 * YourJobsPanel — PHASE 2 "Your jobs" (spec E / identity scheme).
 *
 * Lists THIS DEVICE's own past/active jobs (via getResumableJobs({clientId}) —
 * never another client's). Opening one ADOPTS it: the client rebinds the job
 * to this tab (adoptJob mutation) and lands on the live job view with
 * Resume/Pause/Retry/ZIP/Export controls already present there.
 */
export function YourJobsPanel({
  open,
  jobs,
  currentProjectId,
  onOpenJob,
  onClose,
}: {
  open: boolean;
  jobs: Doc<"projects">[] | undefined;
  currentProjectId: Id<"projects"> | null;
  onOpenJob: (projectId: Id<"projects">) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const rows = (jobs ?? []).filter((j) => j._id !== currentProjectId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(4,4,12,0.72)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: "rgba(10,10,22,0.97)", border: "1px solid rgba(0,229,255,0.18)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(0,229,255,0.1)" }}>
          <History className="size-4" style={{ color: "#00e5ff" }} />
          <span className="text-sm font-semibold">Your jobs — this device</span>
          <button onClick={onClose} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
        <div className="max-h-[60vh] overflow-auto divide-y" style={{ borderColor: "rgba(0,229,255,0.06)" }}>
          {rows.length === 0 && (
            <div className="px-4 py-6 text-xs text-muted-foreground text-center">
              No previous jobs on this device yet.
            </div>
          )}
          {rows.map((j) => (
            <button
              key={j._id}
              onClick={() => onOpenJob(j._id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/20 transition-colors"
            >
              <FileText className="size-4 shrink-0" style={{ color: "#a78bfa" }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{j.fileName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {j.pageCount} pages • {j.wordCount.toLocaleString()} words • {new Date(j.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full border shrink-0"
                style={{
                  color:
                    j.status === "all_translated" || j.status === "complete"
                      ? "#34d399"
                      : j.status === "translating"
                        ? "#00e5ff"
                        : j.status === "error"
                          ? "#ff4757"
                          : "rgba(255,255,255,0.4)",
                  borderColor:
                    j.status === "all_translated" || j.status === "complete"
                      ? "rgba(52,211,153,0.4)"
                      : j.status === "translating"
                        ? "rgba(0,229,255,0.4)"
                        : "rgba(255,255,255,0.12)",
                }}
              >
                {j.status === "all_translated" ? "complete" : j.status}
              </span>
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="px-4 py-2 text-[9px] text-muted-foreground" style={{ borderTop: "1px solid rgba(0,229,255,0.06)" }}>
          Opening a job adopts it into this tab — live progress, Resume, Pause, Retry, ZIP and Export all continue here.
        </div>
      </div>
    </div>
  );
}
