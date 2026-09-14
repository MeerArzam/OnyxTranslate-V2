#!/usr/bin/env python3
"""Phase 2 wiring: UploadJobCard + YourJobsPanel + header Import/Export/Your-jobs."""
import io, sys

PATH = "src/pages/Translator.tsx"
src = io.open(PATH, "r", encoding="utf-8").read()

def replace_once(haystack, old, new, label):
    if old not in haystack:
        print(f"MISS: {label}")
        sys.exit(1)
    return haystack.replace(old, new, 1)

# 1) Imports for the two new components
src = replace_once(
    src,
    'import { HistoryPanel } from "@/components/HistoryPanel";',
    'import { HistoryPanel } from "@/components/HistoryPanel";\n'
    'import { UploadJobCard } from "@/components/UploadJobCard";\n'
    'import { YourJobsPanel } from "@/components/YourJobsPanel";',
    "component imports",
)

# 2) Replace the old uploadError box with: UploadJobCard + staging + error box
old_error_block = """                {uploadError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-yellow-500/5 border border-yellow-500/20 text-[11px]">
                    <AlertCircle className="size-3.5 text-yellow-500 shrink-0 mt-0.5" />
                    <span>{uploadError}</span>
                  </div>
                )}
"""
new_error_block = """                {/* PHASE 2: server-first upload card — % progress, stage chips,
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
"""
src = replace_once(src, old_error_block, new_error_block, "upload error block")

# 3) Header buttons: Import / Export / Your jobs — insert before the History button
old_header = """            <div className="flex items-center gap-1 ml-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setShowHistory(true)}
                title="Translation History"
              >
                <Clock className="size-3.5" style={{ color: '#a78bfa' }} />
              </Button>
"""
new_header = """            <div className="flex items-center gap-1 ml-1">
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
"""
src = replace_once(src, old_header, new_header, "header buttons")

# 4) Hidden import input + YourJobsPanel mount, before <HistoryPanel .../>
old_tail = """      {/* History Panel */}
      <HistoryPanel
        open={showHistory}
        onClose={() => setShowHistory(false)}
        sessionId={sessionId}
      />
"""
new_tail = """      {/* PHASE 2: hidden import file input (raw POST → server validation) */}
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
"""
src = replace_once(src, old_tail, new_tail, "tail mount")

# 5) ZIP row in job view: add Export button beside Download ZIP (unconditional)
old_zip = """              <Button
                onClick={handleDownloadAllZIP}
                disabled={!convexProject.zipUrl || isDownloadingZip}
                className="flex-1 h-9 btn-royal-hover"
              >
                <Package className="size-3.5 mr-2" />
                {convexProject.zipUrl ? "Download ZIP" : "ZIP ready when all languages finish"}
              </Button>
"""
new_zip = """              <Button
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
"""
src = replace_once(src, old_zip, new_zip, "zip row")

# 6) buildZipNowAction declaration (after buildExportAction)
old_export_decl = "  const buildExportAction = useAction(api.exportProject.buildExportArtifact);"
new_export_decl = """  const buildExportAction = useAction(api.exportProject.buildExportArtifact);
  const buildZipNowAction = useAction(api.exportProject.buildZipNow);"""
src = replace_once(src, old_export_decl, new_export_decl, "buildZipNow decl")

io.open(PATH, "w", encoding="utf-8").write(src)
print("ALL PATCHES APPLIED")
