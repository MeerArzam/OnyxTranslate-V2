import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    sessionId: v.string(),
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
});
