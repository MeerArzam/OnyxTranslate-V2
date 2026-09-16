import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    sessionId: v.optional(v.string()),
    // PHASE 2: durable device + tab identity. clientId survives reopens;
    // tabSessionId isolates two tabs of the same device (existing C1 rule).
    clientId: v.optional(v.string()),
    tabSessionId: v.optional(v.string()),
    fileName: v.string(),
    pageCount: v.number(),
    wordCount: v.number(),
    pdfStorageId: v.optional(v.string()),
    pageData: v.any(),
    fullText: v.string(),
    parsedPages: v.number(),
    status: v.string(),
    zipStorageId: v.optional(v.string()),
    zipUrl: v.optional(v.string()),
    // PHASE 2: pending-upload staging (set at uploadJob creation, cleared at parse)
    uploadJobId: v.optional(v.id("uploadJobs")),
    // FIX (1MiB limit): when parsed pageData exceeds Convex's 1MiB document
    // value cap, createProject stores it in Storage and records the ref here
    // (pageData on the row is then the empty fallback). Always additive.
    pageDataStorageId: v.optional(v.id("_storage")),
    // FIX (1MiB limit): same offload mechanism for very large fullText.
    fullTextStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_client", ["clientId"]),

  chunks: defineTable({
    projectId: v.id("projects"),
    langCode: v.string(),
    chunkIndex: v.number(),
    sourceText: v.string(),
    translatedText: v.optional(v.string()),
    status: v.string(),
    model: v.optional(v.string()),
    usage: v.optional(v.any()),
  })
    .index("by_project_lang", ["projectId", "langCode", "chunkIndex"])
    .index("by_project_status", ["projectId", "status"]),

  translations: defineTable({
    projectId: v.id("projects"),
    langCode: v.string(),
    status: v.string(),
    totalChunks: v.number(),
    completedChunks: v.number(),
    mergedText: v.optional(v.string()),
    pdfStorageId: v.optional(v.string()),
    pdfUrl: v.optional(v.string()),
    pdfGenerating: v.optional(v.boolean()),
    pdfProgress: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    // Watchdog heartbeat: timestamp of the last completed chunk (FIX 5a)
    lastChunkAt: v.optional(v.number()),
  }).index("by_project_lang", ["projectId", "langCode"]),

  imageTranslations: defineTable({
    projectId: v.optional(v.id("projects")),
    imageBase64: v.string(),
    extractedText: v.optional(v.string()),
    translatedText: v.optional(v.string()),
    targetLangCode: v.string(),
    status: v.string(),
    createdAt: v.number(),
  }),

  history: defineTable({
    sessionId: v.string(),
    projectId: v.id("projects"),
    fileName: v.string(),
    pageCount: v.number(),
    wordCount: v.number(),
    status: v.string(),
    languagesCompleted: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    zipUrl: v.optional(v.string()),
  }).index("by_session", ["sessionId"]),

  jobs: defineTable({
    projectId: v.id("projects"),
    type: v.string(),
    langCode: v.optional(v.string()),
    chunkIndex: v.optional(v.number()),
    status: v.string(),
    error: v.optional(v.string()),
    scheduledFor: v.number(),
    createdAt: v.number(),
  })
    .index("by_status_scheduled", ["status", "scheduledFor"])
    .index("by_project", ["projectId"]),

  // ══ PHASE 2: server-first upload pipeline ══
  // One row per PDF upload. Statuses: uploaded → processing → parsed →
  // ready → translating → generating_pdf → assembling_zip → complete | error | cancelled.
  // processStage + heartbeat give the UI honest per-stage progress; the idempotency
  // key makes retries (Path 1 double-submit, finalize re-fire) never duplicate.
  uploadJobs: defineTable({
    clientId: v.string(),
    tabSessionId: v.optional(v.string()),
    fileName: v.string(),
    fileSize: v.number(),
    storageId: v.optional(v.id("_storage")),
    projectId: v.optional(v.id("projects")),
    status: v.string(),
    // parsed → chunked → translating → generating_pdf → assembling_zip → complete
    processStage: v.optional(v.string()),
    // PHASE 3: which browser→server transport created this job (1 = single
    // HTTP action ≤19MB, 2 = direct Storage POST). Honest observability.
    uploadPath: v.optional(v.number()),
    // monotonic counter: a scheduled stage run is only valid if stageSeq matches
    stageSeq: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    error: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    langCodes: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_status", ["status"]),

  // ══ PHASE 2: Path 2 staging for large files (>19MB) ══
  // Created BEFORE the browser POSTs the raw file to Storage, so an interrupted
  // upload leaves a durable record the client can offer to resume/discard.
  // Orphans older than 24h are swept.
  pendingUploads: defineTable({
    clientId: v.string(),
    tabSessionId: v.optional(v.string()),
    uploadJobId: v.id("uploadJobs"),
    fileName: v.string(),
    fileSize: v.number(),
    langCodes: v.optional(v.array(v.string())),
    status: v.string(), // staging | uploaded | finalized | abandoned
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_status", ["status"]),

  // ══ PHASE 2: server-generated JSON export artifacts ══
  exportArtifacts: defineTable({
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    kind: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_project", ["projectId"]),

  // ══ PHASE 3: short-TTL download tokens for export artifacts ══
  // Browsers ignore the anchor `download` attribute on cross-origin URLs, so
  // exports are served through /downloadExport with a Content-Disposition
  // filename. The token keeps projectId → storageId resolution server-side.
  exportTokens: defineTable({
    token: v.string(),
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    expiresAt: v.number(),
  }).index("by_token", ["token"]),

  // LIVE TEST: per-language live verification results (one row per language,
  // upserted by the saveLiveTest mutation after each Gemini round-trip).
  liveTests: defineTable({
    langCode: v.string(),
    langName: v.string(),
    nativeName: v.string(),
    script: v.string(),
    rtl: v.boolean(),
    status: v.string(), // pending | running | pass | warn | fail
    score: v.optional(v.number()),
    output: v.optional(v.string()),
    qaSummary: v.optional(v.array(v.string())),
    issueCount: v.optional(v.number()),
    missingNames: v.optional(v.array(v.string())),
    scriptIssues: v.optional(v.array(v.string())),
    model: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    testedAt: v.number(),
  }).index("by_lang", ["langCode"]),
});
