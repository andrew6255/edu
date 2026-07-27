import { logger } from "../../lib/logger";
import { programIngestionService } from "./service";
import type { IngestionJobStatus } from "./types";

/**
 * Runs the entire ingestion pipeline asynchronously for a personal program.
 * Captures any errors and updates the job's stage/status to failed.
 */
export async function runPersonalProgramPipeline(
  jobId: string,
  updateProgress?: (progress: number, message: string) => Promise<void>
): Promise<void> {
  try {
    logger.info({ jobId }, "Starting automated personal program pipeline");
    if (updateProgress) await updateProgress(10, "Stage 1/5: Extracting PDF document...");

    // Stage 1: Extraction
    await programIngestionService.runStage(jobId, { stage: "extractDocument" });
    
    if (updateProgress) await updateProgress(30, "Stage 2/5: Auditing extraction and quality check...");
    // Stage 2: Audit
    await programIngestionService.runStage(jobId, { stage: "auditExtraction" });

    if (updateProgress) await updateProgress(50, "Stage 3/5: Segmenting questions and diagrams...");
    // Stage 3: Segmentation
    await programIngestionService.runStage(jobId, { stage: "segmentQuestions" });

    if (updateProgress) await updateProgress(70, "Stage 4/5: Normalizing questions with AI...");
    // Stage 4: Normalization
    await programIngestionService.runStage(jobId, { stage: "normalizeQuestions" });

    if (updateProgress) await updateProgress(90, "Stage 5/5: Structuring draft chapters and topics...");
    // Stage 5: Structuring
    await programIngestionService.runStage(jobId, { stage: "structureDraft" });

    if (updateProgress) await updateProgress(95, "Publishing program...");
    // Stage 6: Publish (which sets it to 'ready' or 'published')
    await programIngestionService.publishJob(jobId);

    if (updateProgress) await updateProgress(100, "Program published successfully!");
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
