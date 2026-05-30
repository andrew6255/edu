import { pgTable, text, integer, timestamp, jsonb, numeric } from "drizzle-orm/pg-core";

export const profilesTable = pgTable("profiles", {
  id: text("id").primaryKey(),
  role: text("role").notNull(),
});

export const programIngestionJobsTable = pgTable("program_ingestion_jobs", {
  id: text("id").primaryKey(),
  adminUserId: text("admin_user_id").notNull(),
  classId: text("class_id"),
  visibility: text("visibility").notNull(),
  status: text("status").notNull(),
  stage: text("stage"),
  sourceFilePath: text("source_file_path").notNull(),
  sourceFileName: text("source_file_name").notNull(),
  providerMeta: jsonb("provider_meta"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programIngestionDraftsTable = pgTable("program_ingestion_drafts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  gradeBand: text("grade_band"),
  visibility: text("visibility").notNull(),
  classId: text("class_id"),
  draftStatus: text("draft_status").notNull(),
  extractedDocument: jsonb("extracted_document"),
  extractionReport: jsonb("extraction_report"),
  hierarchy: jsonb("hierarchy").notNull(),
  aiSessionMeta: jsonb("ai_session_meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programIngestionQuestionsTable = pgTable("program_ingestion_questions", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  draftId: text("draft_id").notNull(),
  nodeId: text("node_id"),
  questionOrder: integer("question_order").notNull(),
  normalizedQuestion: jsonb("normalized_question"),
  rawExtractedBlock: jsonb("raw_extracted_block").notNull(),
  confidence: numeric("confidence"),
  reviewStatus: text("review_status").notNull(),
  flags: jsonb("flags").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programIngestionChatMessagesTable = pgTable("program_ingestion_chat_messages", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  role: text("role").notNull(),
  message: text("message").notNull(),
  patchSummary: jsonb("patch_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programIngestionAssetsTable = pgTable("program_ingestion_assets", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  assetType: text("asset_type").notNull(),
  path: text("path").notNull(),
  page: integer("page"),
  regionId: text("region_id"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
