import type {
  AiExtractionAudit,
  AiQuestionAnalysis,
  AttachIngestionSourceFileResult,
  CreateIngestionJobInput,
  ExtractedQuestionBlock,
  IngestionAsset,
  IngestionChatMessage,
  IngestionDraft,
  IngestionJob,
  IngestionJobState,
  IngestionQuestion,
} from "./types";

import { and, desc, eq } from "drizzle-orm";
import {
  db,
  profilesTable,
  programIngestionAssetsTable,
  programIngestionChatMessagesTable,
  programIngestionDraftsTable,
  programIngestionJobsTable,
  programIngestionQuestionsTable,
} from "@workspace/db";

export interface ProgramIngestionRepository {
  createJob(input: CreateIngestionJobInput): Promise<{ job: IngestionJob; draft: IngestionDraft }>;
  getJobState(jobId: string): Promise<IngestionJobState | null>;
  listJobs(): Promise<Array<{ job: IngestionJob; draft: IngestionDraft }>>;
  appendMessage(message: IngestionChatMessage): Promise<void>;
  replaceQuestionBlocks(jobId: string, blocks: ExtractedQuestionBlock[]): Promise<void>;
  updateNormalizedQuestions(jobId: string, analyses: AiQuestionAnalysis[]): Promise<void>;
  createAsset(jobId: string, input: { assetType: IngestionAsset["assetType"]; path: string; mimeType?: string | null; page?: number | null; regionId?: string | null }): Promise<AttachIngestionSourceFileResult>;
  updateJobStage(jobId: string, input: { status: IngestionJob["status"]; stage: string | null }): Promise<void>;
  updateDraftExtractedDocument(jobId: string, document: IngestionDraft["extractedDocument"]): Promise<void>;
  updateDraftExtractionReport(jobId: string, report: AiExtractionAudit): Promise<void>;
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function mapJob(row: typeof programIngestionJobsTable.$inferSelect): IngestionJob {
  return {
    id: row.id,
    adminUserId: row.adminUserId,
    classId: row.classId,
    visibility: row.visibility as IngestionJob["visibility"],
    status: row.status as IngestionJob["status"],
    stage: row.stage,
    sourceFilePath: row.sourceFilePath,
    sourceFileName: row.sourceFileName,
    providerMeta: (row.providerMeta as Record<string, unknown> | null) ?? null,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapDraft(row: typeof programIngestionDraftsTable.$inferSelect): IngestionDraft {
  return {
    id: row.id,
    jobId: row.jobId,
    title: row.title,
    subject: "mathematics",
    gradeBand: row.gradeBand,
    visibility: row.visibility as IngestionDraft["visibility"],
    classId: row.classId,
    draftStatus: row.draftStatus as IngestionDraft["draftStatus"],
    extractedDocument: (row.extractedDocument as IngestionDraft["extractedDocument"]) ?? null,
    extractionReport: (row.extractionReport as IngestionDraft["extractionReport"]) ?? null,
    hierarchy: (row.hierarchy as IngestionDraft["hierarchy"]) ?? [],
    aiSessionMeta: (row.aiSessionMeta as IngestionDraft["aiSessionMeta"]) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapQuestion(row: typeof programIngestionQuestionsTable.$inferSelect): IngestionQuestion {
  return {
    id: row.id,
    jobId: row.jobId,
    draftId: row.draftId,
    nodeId: row.nodeId,
    questionOrder: row.questionOrder,
    normalizedQuestion: (row.normalizedQuestion as IngestionQuestion["normalizedQuestion"]) ?? null,
    rawExtractedBlock: row.rawExtractedBlock as IngestionQuestion["rawExtractedBlock"],
    confidence: row.confidence == null ? null : Number(row.confidence),
    reviewStatus: row.reviewStatus as IngestionQuestion["reviewStatus"],
    flags: Array.isArray(row.flags) ? (row.flags as string[]) : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapMessage(row: typeof programIngestionChatMessagesTable.$inferSelect): IngestionChatMessage {
  return {
    id: row.id,
    jobId: row.jobId,
    role: row.role as IngestionChatMessage["role"],
    message: row.message,
    patchSummary: (row.patchSummary as IngestionChatMessage["patchSummary"]) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapAsset(row: typeof programIngestionAssetsTable.$inferSelect): IngestionAsset {
  return {
    id: row.id,
    jobId: row.jobId,
    assetType: row.assetType as IngestionAsset["assetType"],
    path: row.path,
    page: row.page,
    regionId: row.regionId,
    mimeType: row.mimeType,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DbProgramIngestionRepository implements ProgramIngestionRepository {
  async createJob(input: CreateIngestionJobInput): Promise<{ job: IngestionJob; draft: IngestionDraft }> {
    const now = new Date().toISOString();
    const jobId = makeId("ing");
    const draftId = makeId("draft");

    const titleBase = input.title?.trim() || input.sourceFileName.replace(/\.[^.]+$/, "").trim() || "Untitled Program Import";

    const creator = await db
      .select({ id: profilesTable.id, role: profilesTable.role })
      .from(profilesTable)
      .where(eq(profilesTable.id, input.adminUserId))
      .limit(1);

    const creatorRole = creator[0]?.role;
    if (creatorRole !== "admin" && creatorRole !== "superadmin") {
      throw new Error("Only admins and superadmins can create programs or upload files.");
    }

    const job: IngestionJob = {
      id: jobId,
      adminUserId: input.adminUserId,
      classId: input.classId ?? null,
      visibility: input.visibility,
      status: "uploaded",
      stage: "createJob",
      sourceFilePath: input.sourceFilePath ?? `/program-ingestion/pending/${jobId}`,
      sourceFileName: input.sourceFileName,
      providerMeta: input.adminNote ? { adminNote: input.adminNote } : null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    const draft: IngestionDraft = {
      id: draftId,
      jobId,
      title: titleBase,
      subject: "mathematics",
      gradeBand: input.gradeBand ?? null,
      visibility: input.visibility,
      classId: input.classId ?? null,
      draftStatus: "draft",
      extractedDocument: null,
      extractionReport: null,
      hierarchy: [],
      aiSessionMeta: null,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(programIngestionJobsTable).values({
      id: job.id,
      adminUserId: job.adminUserId,
      classId: job.classId,
      visibility: job.visibility,
      status: job.status,
      stage: job.stage,
      sourceFilePath: job.sourceFilePath,
      sourceFileName: job.sourceFileName,
      providerMeta: job.providerMeta,
      errorMessage: job.errorMessage,
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt),
    });

    await db.insert(programIngestionDraftsTable).values({
      id: draft.id,
      jobId: draft.jobId,
      title: draft.title,
      subject: draft.subject,
      gradeBand: draft.gradeBand,
      visibility: draft.visibility,
      classId: draft.classId,
      draftStatus: draft.draftStatus,
      extractedDocument: draft.extractedDocument,
      extractionReport: draft.extractionReport,
      hierarchy: draft.hierarchy,
      aiSessionMeta: draft.aiSessionMeta,
      createdAt: new Date(draft.createdAt),
      updatedAt: new Date(draft.updatedAt),
    });

    return { job, draft };
  }

  async getJobState(jobId: string): Promise<IngestionJobState | null> {
    const [jobRow] = await db
      .select()
      .from(programIngestionJobsTable)
      .where(eq(programIngestionJobsTable.id, jobId))
      .limit(1);

    const [draftRow] = await db
      .select()
      .from(programIngestionDraftsTable)
      .where(eq(programIngestionDraftsTable.jobId, jobId))
      .limit(1);

    if (!jobRow || !draftRow) return null;

    const questionRows = await db
      .select()
      .from(programIngestionQuestionsTable)
      .where(eq(programIngestionQuestionsTable.jobId, jobId));

    const messageRows = await db
      .select()
      .from(programIngestionChatMessagesTable)
      .where(eq(programIngestionChatMessagesTable.jobId, jobId))
      .orderBy(programIngestionChatMessagesTable.createdAt);

    const assetRows = await db
      .select()
      .from(programIngestionAssetsTable)
      .where(eq(programIngestionAssetsTable.jobId, jobId))
      .orderBy(programIngestionAssetsTable.createdAt);

    return {
      job: mapJob(jobRow),
      draft: mapDraft(draftRow),
      questions: questionRows.map(mapQuestion),
      messages: messageRows.map(mapMessage),
      assets: assetRows.map(mapAsset),
    };
  }

  async listJobs(): Promise<Array<{ job: IngestionJob; draft: IngestionDraft }>> {
    const rows = await db
      .select({ job: programIngestionJobsTable, draft: programIngestionDraftsTable })
      .from(programIngestionJobsTable)
      .innerJoin(programIngestionDraftsTable, eq(programIngestionDraftsTable.jobId, programIngestionJobsTable.id))
      .orderBy(desc(programIngestionJobsTable.updatedAt));

    return rows.map((row: { job: typeof programIngestionJobsTable.$inferSelect; draft: typeof programIngestionDraftsTable.$inferSelect }) => ({
      job: mapJob(row.job),
      draft: mapDraft(row.draft),
    }));
  }

  async appendMessage(message: IngestionChatMessage): Promise<void> {
    const existingState = await this.getJobState(message.jobId);
    if (!existingState) {
      throw new Error(`Program ingestion job ${message.jobId} not found.`);
    }

    await db.insert(programIngestionChatMessagesTable).values({
      id: message.id,
      jobId: message.jobId,
      role: message.role,
      message: message.message,
      patchSummary: message.patchSummary,
      createdAt: new Date(message.createdAt),
    });
  }

  async replaceQuestionBlocks(jobId: string, blocks: ExtractedQuestionBlock[]): Promise<void> {
    const existingState = await this.getJobState(jobId);
    if (!existingState) {
      throw new Error(`Program ingestion job ${jobId} not found.`);
    }

    await db.delete(programIngestionQuestionsTable).where(eq(programIngestionQuestionsTable.jobId, jobId));

    if (blocks.length === 0) {
      return;
    }

    await db.insert(programIngestionQuestionsTable).values(
      blocks.map((block, index) => ({
        id: block.id,
        jobId,
        draftId: existingState.draft.id,
        nodeId: null,
        questionOrder: index,
        normalizedQuestion: null,
        rawExtractedBlock: block,
        confidence: block.splitConfidence == null ? null : String(block.splitConfidence),
        reviewStatus: "needs_review",
        flags: [] as string[],
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
  }

  async updateNormalizedQuestions(jobId: string, analyses: AiQuestionAnalysis[]): Promise<void> {
    const existingState = await this.getJobState(jobId);
    if (!existingState) {
      throw new Error(`Program ingestion job ${jobId} not found.`);
    }

    for (const analysis of analyses) {
      const blockId = analysis.normalizedQuestion?.id;
      if (!blockId) continue;

      await db
        .update(programIngestionQuestionsTable)
        .set({
          normalizedQuestion: analysis.normalizedQuestion,
          confidence: String(analysis.confidence),
          reviewStatus: analysis.autoGradable ? "ai_ok" : "needs_review",
          flags: analysis.warnings,
          updatedAt: new Date(),
        })
        .where(and(eq(programIngestionQuestionsTable.jobId, jobId), eq(programIngestionQuestionsTable.id, blockId)));
    }
  }

  async createAsset(jobId: string, input: { assetType: IngestionAsset["assetType"]; path: string; mimeType?: string | null; page?: number | null; regionId?: string | null }): Promise<AttachIngestionSourceFileResult> {
    const existingState = await this.getJobState(jobId);
    if (!existingState) {
      throw new Error(`Program ingestion job ${jobId} not found.`);
    }

    const assetId = makeId("asset");
    await db.insert(programIngestionAssetsTable).values({
      id: assetId,
      jobId,
      assetType: input.assetType,
      path: input.path,
      page: input.page ?? null,
      regionId: input.regionId ?? null,
      mimeType: input.mimeType ?? null,
      createdAt: new Date(),
    });

    return {
      assetId,
      path: input.path,
      mimeType: input.mimeType ?? null,
    };
  }

  async updateJobStage(jobId: string, input: { status: IngestionJob["status"]; stage: string | null }): Promise<void> {
    const existingState = await this.getJobState(jobId);
    if (!existingState) {
      throw new Error(`Program ingestion job ${jobId} not found.`);
    }

    await db
      .update(programIngestionJobsTable)
      .set({
        status: input.status,
        stage: input.stage,
        updatedAt: new Date(),
      })
      .where(eq(programIngestionJobsTable.id, jobId));
  }

  async updateDraftExtractedDocument(jobId: string, document: IngestionDraft["extractedDocument"]): Promise<void> {
    const existingState = await this.getJobState(jobId);
    if (!existingState) {
      throw new Error(`Program ingestion job ${jobId} not found.`);
    }

    await db
      .update(programIngestionDraftsTable)
      .set({
        extractedDocument: document,
        updatedAt: new Date(),
      })
      .where(eq(programIngestionDraftsTable.jobId, jobId));
  }

  async updateDraftExtractionReport(jobId: string, report: AiExtractionAudit): Promise<void> {
    const existingState = await this.getJobState(jobId);
    if (!existingState) {
      throw new Error(`Program ingestion job ${jobId} not found.`);
    }

    await db
      .update(programIngestionDraftsTable)
      .set({
        extractionReport: report,
        updatedAt: new Date(),
      })
      .where(eq(programIngestionDraftsTable.jobId, jobId));
  }
}
