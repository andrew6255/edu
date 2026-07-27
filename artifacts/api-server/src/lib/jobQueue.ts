import { logger } from "./logger";
import { DbProgramIngestionRepository } from "../modules/program-ingestion/repository";

export interface JobProgress {
  progress: number; // 0 to 100
  message: string;
}

type JobTask = (updateProgress: (progress: number, message: string) => Promise<void>) => Promise<any>;

interface QueuedJob {
  jobId: string;
  task: JobTask;
  retries: number;
  maxRetries: number;
}

class JobQueueManager {
  private queue: QueuedJob[] = [];
  private activeCount = 0;
  private readonly maxConcurrent = 2; // Limit concurrent AI / Python OCR processes
  private repository = new DbProgramIngestionRepository();

  public async enqueue(jobId: string, task: JobTask, maxRetries = 3): Promise<void> {
    logger.info({ jobId }, "Job enqueued in background queue");
    this.queue.push({ jobId, task, retries: 0, maxRetries });
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.activeCount >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const job = this.queue.shift();
    if (!job) return;

    this.activeCount++;
    logger.info({ jobId: job.jobId, activeCount: this.activeCount }, "Starting job processing");

    const updateProgress = async (progress: number, message: string) => {
      try {
        const state = await this.repository.getJobState(job.jobId);
        const existingMeta = (state?.job.providerMeta as Record<string, any>) || {};
        await this.repository.updateJobStage(job.jobId, {
          stage: "processing",
          providerMeta: {
            ...existingMeta,
            progress,
            progressMessage: message,
            updatedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        logger.warn({ jobId: job.jobId, err }, "Failed to update job progress in database");
      }
    };

    try {
      await updateProgress(5, "Job started in worker queue...");
      await job.task(updateProgress);
      await updateProgress(100, "Completed successfully!");
      logger.info({ jobId: job.jobId }, "Job completed successfully");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error in background job";
      logger.error({ jobId: job.jobId, err: error, retries: job.retries }, "Job failed during execution");

      if (job.retries < job.maxRetries && (errMsg.includes("429") || errMsg.includes("rate limit") || errMsg.includes("timeout"))) {
        job.retries++;
        const backoffMs = Math.pow(2, job.retries) * 3000;
        logger.warn({ jobId: job.jobId, retries: job.retries, backoffMs }, "Transient rate limit hit. Retrying job with backoff...");
        setTimeout(() => {
          this.queue.push(job);
          this.processNext();
        }, backoffMs);
      } else {
        try {
          await this.repository.setJobError(job.jobId, errMsg);
          await this.repository.updateJobStage(job.jobId, {
            status: "failed",
            stage: "failed",
          });
        } catch (dbErr) {
          logger.error({ jobId: job.jobId, err: dbErr }, "Failed to set job error state in DB");
        }
      }
    } finally {
      this.activeCount--;
      this.processNext();
    }
  }

  public getQueueStatus(): { active: number; pending: number } {
    return {
      active: this.activeCount,
      pending: this.queue.length,
    };
  }
}

export const jobQueue = new JobQueueManager();
