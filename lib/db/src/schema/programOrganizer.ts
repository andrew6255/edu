import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const programVersionsTable = pgTable("program_versions", {
  id: text("id").primaryKey(), programId: text("program_id").notNull(), versionNumber: integer("version_number").notNull(),
  status: text("status").notNull(), revision: integer("revision").notNull().default(0), baseVersionId: text("base_version_id"),
  snapshot: jsonb("snapshot").notNull(), createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [uniqueIndex("program_versions_program_number_idx").on(table.programId, table.versionNumber)]);

export const programOrganizerProfilesTable = pgTable("program_organizer_profiles", {
  programId: text("program_id").primaryKey(), subject: text("subject").notNull(), namingLanguage: text("naming_language"),
  maximumPreferredDepth: integer("maximum_preferred_depth"), minimumCategorySize: integer("minimum_category_size").notNull().default(1),
  allowSingleQuestionCategories: boolean("allow_single_question_categories").notNull().default(true), terminologyMode: text("terminology_mode").notNull().default("concept"),
  customInstructions: text("custom_instructions"), memorySummary: text("memory_summary"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programIngestionBatchesTable = pgTable("program_ingestion_batches", {
  id: text("id").primaryKey(), programId: text("program_id").notNull(), draftVersionId: text("draft_version_id").notNull(), ingestionJobId: text("ingestion_job_id"),
  status: text("status").notNull(), baseRevision: integer("base_revision").notNull(), createdBy: text("created_by").notNull(), appliedRevision: integer("applied_revision"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programIngestionSourcesTable = pgTable("program_ingestion_sources", {
  id: text("id").primaryKey(), batchId: text("batch_id").notNull(), role: text("role").notNull(), fileName: text("file_name").notNull(),
  assetPath: text("asset_path").notNull(), mimeType: text("mime_type"), sourceOrder: integer("source_order").notNull().default(0), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programStructureProposalsTable = pgTable("program_structure_proposals", {
  id: text("id").primaryKey(), batchId: text("batch_id").notNull(), baseRevision: integer("base_revision").notNull(), status: text("status").notNull().default("pending"),
  previewTree: jsonb("preview_tree").notNull(), summary: text("summary"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const programStructureOperationsTable = pgTable("program_structure_operations", {
  id: text("id").primaryKey(), proposalId: text("proposal_id").notNull(), operationOrder: integer("operation_order").notNull(), operationType: text("operation_type").notNull(),
  payload: jsonb("payload").notNull(), rationale: text("rationale"), confidence: numeric("confidence"), decision: text("decision").notNull().default("pending"),
  decidedBy: text("decided_by"), decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const questionPlacementProposalsTable = pgTable("question_placement_proposals", {
  id: text("id").primaryKey(), proposalId: text("proposal_id").notNull(), questionId: text("question_id").notNull(), destinationCategoryId: text("destination_category_id").notNull(),
  alternativeCategoryIds: jsonb("alternative_category_ids").notNull(), rationale: text("rationale").notNull(), confidence: numeric("confidence").notNull(),
  subjectConfidence: numeric("subject_confidence"), answerConfidence: numeric("answer_confidence"), answerProvenance: text("answer_provenance").notNull().default("missing"),
  likelyDuplicate: boolean("likely_duplicate").notNull().default(false), decision: text("decision").notNull().default("pending"), decidedBy: text("decided_by"), decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const programOrganizerDecisionsTable = pgTable("program_organizer_decisions", {
  id: text("id").primaryKey(), programId: text("program_id").notNull(), batchId: text("batch_id"), decisionType: text("decision_type").notNull(),
  proposedValue: jsonb("proposed_value"), acceptedValue: jsonb("accepted_value"), summary: text("summary").notNull(), createdBy: text("created_by").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

