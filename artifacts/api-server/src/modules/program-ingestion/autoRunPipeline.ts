import { logger } from "../../lib/logger";
import { programIngestionService } from "./service";
import type { IngestionJobStatus } from "./types";

/**
 * Runs the entire ingestion pipeline asynchronously for a personal program.
 * Captures any errors and updates the job's stage/status to failed.
 */
export async function runPersonalProgramPipeline(jobId: string): Promise<void> {
  try {
    logger.info({ jobId }, "Starting automated personal program pipeline");

    // Stage 1: Extraction
    await programIngestionService.runStage(jobId, { stage: "extractDocument" });
    
    // Stage 2: Audit
    await programIngestionService.runStage(jobId, { stage: "auditExtraction" });

    // Stage 3: Segmentation
    await programIngestionService.runStage(jobId, { stage: "segmentQuestions" });

    // Stage 4: Normalization
    await programIngestionService.runStage(jobId, { stage: "normalizeQuestions" });

    // Stage 5: Structuring
    await programIngestionService.runStage(jobId, { stage: "structureDraft" });

    // Stage 6: Publish (which sets it to 'ready' or 'published')
    await programIngestionService.publishJob(jobId);

    logger.info({ jobId }, "Successfully completed personal program pipeline");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred during pipeline execution.";
    logger.error({ jobId, err: error }, "Failed to complete personal program pipeline");
    
    try {
      // Direct update to repository since service doesn't expose a raw status setter
      // But we can reach into repository if we must, or we can use a helper if we have it.
      // Wait, let's look at how to set the job to failed.
      // We might need to add a small method in service or just assume we have access to repo.
      // I'll dynamically import the repo here to set it if needed.
      const { DbProgramIngestionRepository } = await import("./repository");
      const repo = new DbProgramIngestionRepository();
      await repo.updateJobStage(jobId, {
        status: "failed",
        stage: "failed",
      });
      // We also need to save the errorMessage somewhere if we want to show it.
      // Let's add an explicit method in repository for failing a job.
      await repo.setJobError(jobId, message);
    } catch (fallbackError) {
      logger.error({ jobId, err: fallbackError }, "Failed to update job status to failed");
    }
  }
}
