import { logger } from "../../lib/logger";
import { storeProgramIngestionSourceFile } from "./fileStore";
import { getQuestionNormalizationProvider } from "./providers.normalization";
import { buildExtractionAudit, extractDocumentForJob } from "./pipeline";
import { segmentQuestionsFromExtractedDocument } from "./segmentation";
import {
  DbProgramIngestionRepository,
  type ProgramIngestionRepository,
} from "./repository";
import type {
  AttachIngestionSourceFileInput,
  AttachIngestionSourceFileResult,
  CreateIngestionJobInput,
  CreateIngestionJobResult,
  IngestionJobState,
  IngestionJobSummary,
  RunIngestionStageInput,
} from "./types";

export class ProgramIngestionService {
  constructor(private readonly repository: ProgramIngestionRepository) {}

  async createUploadJob(input: CreateIngestionJobInput): Promise<CreateIngestionJobResult> {
    const { job, draft } = await this.repository.createJob(input);

    logger.info(
      {
        jobId: job.id,
        draftId: draft.id,
        visibility: job.visibility,
        classId: job.classId,
      },
      "Created program ingestion job",
    );

    return {
      jobId: job.id,
      draftId: draft.id,
      status: job.status,
    };
  }

  async getJobState(jobId: string): Promise<IngestionJobState | null> {
    return this.repository.getJobState(jobId);
  }

  async attachSourceFile(jobId: string, input: AttachIngestionSourceFileInput): Promise<AttachIngestionSourceFileResult> {
    const existing = await this.repository.getJobState(jobId);
    if (!existing) {
      throw new Error("Program ingestion job not found.");
    }

    const stored = await storeProgramIngestionSourceFile(jobId, input.fileName, input.contentBase64);
    const asset = await this.repository.createAsset(jobId, {
      assetType: "original_pdf",
      path: stored.path,
      mimeType: input.mimeType ?? null,
    });

    logger.info({ jobId, assetId: asset.assetId, path: asset.path, sizeBytes: stored.sizeBytes }, "Attached program ingestion source file");
    return asset;
  }

  async runStage(jobId: string, input: RunIngestionStageInput): Promise<{ jobId: string; status: string; stage: string }> {
    const existing = await this.repository.getJobState(jobId);
    if (!existing) {
      throw new Error("Program ingestion job not found.");
    }

    if (input.stage === "extractDocument") {
      await this.repository.updateJobStage(jobId, {
        status: "extracting",
        stage: input.stage,
      });

      const extracted = await extractDocumentForJob(existing);
      await this.repository.updateDraftExtractedDocument(jobId, extracted);
      const extractionAudit = buildExtractionAudit(extracted);
      await this.repository.updateDraftExtractionReport(jobId, extractionAudit);
      await this.repository.updateJobStage(jobId, {
        status: "auditing",
        stage: "auditExtraction",
      });

      logger.info({ jobId, stage: input.stage, provider: extracted.extractionProvider }, "Completed document extraction stage");

      return {
        jobId,
        status: "auditing",
        stage: "auditExtraction",
      };
    }

    const audit = existing.draft.extractionReport;
    if (input.stage === "segmentQuestions") {
      const extractedDocument = existing.draft.extractedDocument;
      if (!extractedDocument) {
        throw new Error("Cannot run segmentQuestions before extractDocument has produced an extracted document.");
      }

      await this.repository.updateJobStage(jobId, {
        status: "segmenting",
        stage: input.stage,
      });

      const blocks = segmentQuestionsFromExtractedDocument(extractedDocument);
      await this.repository.replaceQuestionBlocks(jobId, blocks);
      await this.repository.updateJobStage(jobId, {
        status: "reviewing",
        stage: input.stage,
      });

      logger.info({ jobId, stage: input.stage, questionBlockCount: blocks.length }, "Completed question segmentation stage");

      return {
        jobId,
        status: "reviewing",
        stage: input.stage,
      };
    }

    if (input.stage === "normalizeQuestions") {
      if (existing.questions.length === 0) {
        throw new Error("Cannot run normalizeQuestions before segmentQuestions has produced question blocks.");
      }

      await this.repository.updateJobStage(jobId, {
        status: "normalizing",
        stage: input.stage,
      });

      const provider = getQuestionNormalizationProvider();
      const analyses = await Promise.all(
        existing.questions.map((question) => provider.normalize(question.rawExtractedBlock)),
      );
      await this.repository.updateNormalizedQuestions(jobId, analyses);
      await this.repository.updateJobStage(jobId, {
        status: "reviewing",
        stage: input.stage,
      });

      logger.info({ jobId, stage: input.stage, normalizedQuestionCount: analyses.length, provider: provider.name }, "Completed question normalization stage");

      return {
        jobId,
        status: "reviewing",
        stage: input.stage,
      };
    }

    if (!audit) {
      throw new Error("Cannot run auditExtraction before extractDocument has produced an extraction report.");
    }

    await this.repository.updateJobStage(jobId, {
      status: "reviewing",
      stage: input.stage,
    });

    logger.info({ jobId, stage: input.stage, quality: audit.quality }, "Completed extraction audit stage");

    return {
      jobId,
      status: "reviewing",
      stage: input.stage,
    };
  }

  async listJobs(): Promise<IngestionJobSummary[]> {
    const rows = await this.repository.listJobs();
    return rows
      .sort((a, b) => b.job.updatedAt.localeCompare(a.job.updatedAt))
      .map(({ job, draft }) => ({
        jobId: job.id,
        draftId: draft.id,
        status: job.status,
        stage: job.stage,
        visibility: job.visibility,
        sourceFileName: job.sourceFileName,
        title: draft.title,
        updatedAt: job.updatedAt,
      }));
  }
}

export const programIngestionService = new ProgramIngestionService(
  new DbProgramIngestionRepository(),
);
