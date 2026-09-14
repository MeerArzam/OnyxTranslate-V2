import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    sessionId: v.optional(v.string()),
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
    createdAt: v.number(),
  }).index("by_session", ["sessionId"]),

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
