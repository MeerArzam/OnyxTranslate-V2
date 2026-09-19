import { CheckCircle2, Loader2, Circle, XCircle } from "lucide-react";
import type { Doc } from "../../convex/_generated/dataModel";

/**
 * UploadJobCard — PHASE 2 UI.
 *
 * Live, honest server-side progress for an upload job:
 *  - % progress while the browser POSTs raw bytes
 *  - per-stage chips driven by the uploadJobs row (uploaded → processing →
 *    parsed → ready → translating → generating_pdf → assembling_zip → complete)
 *  - "Safe to close" ONLY after the server ACK (status past `uploaded`)
 *  - real provider/platform errors shown verbatim, with the job ID, never
 *    converted into fake app limits
 */

const STAGES = [
  "uploaded",
  "processing",
  "parsed",
  "ready",
  "translating",
  "generating_pdf",
  "assembling_zip",
  "complete",
] as const;

export const UPLOAD_STAGES = STAGES;

export function UploadJobCard({
  job,
  fileName,
  uploadPercent,
  onCancel,
}: {
  job: Doc<"uploadJobs"> | null | undefined;
  fileName: string | null;
  uploadPercent: number | null;
  onCancel?: () => void;
}) {
  if (!job && uploadPercent === null) return null;

  const status = job?.status;
  const stageIdx = status ? STAGES.indexOf(status as (typeof STAGES)[number]) : -1;
  const handoffAck = stageIdx >= 1; // anything past "uploaded" = server has the file
  const failed = status === "error";
  const cancelled = status === "cancelled";

  return (
    <div
      className="p-3 rounded-xl mt-2"
      style={{ background: "rgba(10,10,22,0.85)", border: "1px solid rgba(0,229,255,0.15)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#00e5ff" }}>
          Server upload — {fileName ?? job?.fileName ?? ""}
        </span>
        {uploadPercent !== null && uploadPercent < 100 && (
          <button
            onClick={onCancel}
            className="text-[9px] px-2 py-0.5 rounded border transition-colors hover:bg-muted/30"
            style={{ borderColor: "rgba(255,71,87,0.4)", color: "#ff4757" }}
          >
            Cancel
          </button>
        )}
      </div>

      {uploadPercent !== null && uploadPercent < 100 && (
        <>
          <div className="h-2 rounded-full bg-muted overflow-hidden mb-1">
            <div
              className="h-full rounded-full royal-shimmer transition-all duration-200"
              style={{ width: `${uploadPercent}%`, background: "linear-gradient(90deg, #00e5ff, #a78bfa)" }}
            />
          </div>
          <div className="flex items-center justify-between text-[9px] text-muted-foreground">
            <span>Uploading raw file — {uploadPercent}%</span>
            <span>{(job?.fileSize ?? 0) > 19 * 1024 * 1024 ? "direct upload (large file)" : "single request"}</span>
          </div>
        </>
      )}

      {/* Per-stage chips — driven by the uploadJobs row */}
      {job && (
        <div className="flex flex-wrap gap-1 mt-2">
          {STAGES.map((stage) => {
            const done = failed ? stageIdx > STAGES.indexOf(stage) : stageIdx > STAGES.indexOf(stage) || status === "complete";
            const active = !failed && stageIdx === STAGES.indexOf(stage);
            return (
              <span
                key={stage}
                className="text-[8px] px-1.5 py-0.5 rounded-full border font-medium"
                style={{
                  color: done ? "#34d399" : active ? "#00e5ff" : "rgba(255,255,255,0.3)",
                  borderColor: done ? "rgba(52,211,153,0.4)" : active ? "rgba(0,229,255,0.5)" : "rgba(255,255,255,0.1)",
                  background: active ? "rgba(0,229,255,0.08)" : "transparent",
                }}
              >
                {done ? "✓ " : ""}
                {stage}
              </span>
            );
          })}
        </div>
      )}

      {/* Error — verbatim + job id + retry hint (retry reuses the same key) */}
      {(failed || cancelled) && job?.error && (
        <div className="mt-2 flex items-start gap-2 text-[10px]" style={{ color: "#ff4757" }}>
          <XCircle className="size-3 shrink-0 mt-0.5" />
          <span>
            {job.error} — job …{String(job._id).slice(-6)}
            {failed ? ". Retry from “Unfinished uploads” keeps the same job (no duplicates)." : ""}
          </span>
        </div>
      )}

      {/* PHYSICS, stated honestly — only after the server ACK */}
      {handoffAck && !failed && !cancelled && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: "#34d399" }}>
          <CheckCircle2 className="size-3" />
          <span>Safe to close — server is working. Parsing, translation, PDFs and ZIP continue without this tab.</span>
        </div>
      )}

      {/* Pre-ACK honest physics note */}
      {job && !handoffAck && !failed && (
        <div className="mt-2 flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" style={{ color: "#a78bfa" }} />
          <span>Keep this tab open until the server confirms the handoff (seconds–2 min, platform limit).</span>
        </div>
      )}

      {job && !failed && !cancelled && (
        <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground">
          <Circle className="size-2" style={{ color: "#34d399" }} />
          <span>
            job …{String(job._id).slice(-6)} • {(job.fileSize / (1024 * 1024)).toFixed(1)}MB •{" "}
            {job.uploadPath === 2 || job.fileSize > 19 * 1024 * 1024
              ? "direct upload path (large file)"
              : "single-request upload"}
          </span>
        </div>
      )}
    </div>
  );
}
