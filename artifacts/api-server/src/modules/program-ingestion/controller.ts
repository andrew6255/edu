import type { Request, Response } from "express";
import { programIngestionService } from "./service";
import {
  parseAttachIngestionSourceFileInput,
  parseCreateIngestionJobInput,
  parseRunIngestionStageInput,
} from "./validation";

function getJobId(req: Request): string {
  const rawJobId = req.params["jobId"];
  return typeof rawJobId === "string" ? rawJobId : Array.isArray(rawJobId) ? rawJobId[0] ?? "" : "";
}

export async function createProgramIngestionJob(req: Request, res: Response): Promise<void> {
  try {
    const input = parseCreateIngestionJobInput(req.body);
    const created = await programIngestionService.createUploadJob(input);
    res.status(201).json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function listProgramIngestionJobs(_req: Request, res: Response): Promise<void> {
  const jobs = await programIngestionService.listJobs();
  res.json({ jobs });
}

export async function getProgramIngestionJob(req: Request, res: Response): Promise<void> {
  const jobId = getJobId(req);
  const state = await programIngestionService.getJobState(jobId);

  if (!state) {
    res.status(404).json({ error: "Program ingestion job not found." });
    return;
  }

  res.json(state);
}

export async function attachProgramIngestionSourceFile(req: Request, res: Response): Promise<void> {
  try {
    const jobId = getJobId(req);
    const input = parseAttachIngestionSourceFileInput(req.body);
    const result = await programIngestionService.attachSourceFile(jobId, input);
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
}

export async function runProgramIngestionStage(req: Request, res: Response): Promise<void> {
  try {
    const jobId = getJobId(req);
    const input = parseRunIngestionStageInput(req.body);
    const result = await programIngestionService.runStage(jobId, input);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
}

export async function updateProgramIngestionQuestion(req: Request, res: Response): Promise<void> {
  try {
    const jobId = getJobId(req);
    const questionId = typeof req.params["questionId"] === "string" ? req.params["questionId"] : "";
    const { reviewStatus, normalizedQuestion } = req.body ?? {};
    await programIngestionService.updateQuestion(jobId, questionId, { reviewStatus, normalizedQuestion });
    res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
}

export async function publishProgramIngestionJob(req: Request, res: Response): Promise<void> {
  try {
    const jobId = getJobId(req);
    const result = await programIngestionService.publishJob(jobId);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
}

// ─── Personal Program Endpoints ─────────────────────────────────────────────────

import { runPersonalProgramPipeline } from "./autoRunPipeline";

export async function createPersonalProgramJob(req: Request, res: Response): Promise<void> {
  try {
    const { uid, title, fileName, mimeType, contentBase64, contentHash } = req.body;
    
    // 1. Create a private ingestion job
    const created = await programIngestionService.createUploadJob({
      adminUserId: uid, // Use the user's uid as adminUserId
      visibility: "private",
      sourceFileName: fileName,
      title: title,
    });

    // 2. Attach the source file
    await programIngestionService.attachSourceFile(created.jobId, {
      fileName,
      mimeType,
      contentBase64,
    });

    // 3. Fire background pipeline
    runPersonalProgramPipeline(created.jobId).catch((err) => {
      console.error("Personal program pipeline background error:", err);
    });

    res.status(201).json({
      jobId: created.jobId,
      programId: created.jobId, // Since we don't know it until published, return jobId as programId placeholder
      status: created.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}

export async function getPersonalProgramStatus(req: Request, res: Response): Promise<void> {
  try {
    const jobId = getJobId(req);
    const state = await programIngestionService.getJobState(jobId);
    if (!state) {
      res.status(404).json({ error: "Personal program not found" });
      return;
    }

    res.json({
      status: state.job.status,
      stage: state.job.stage,
      errorMessage: state.job.errorMessage,
      programData: state.job.status === "published" && state.draft.hierarchy.length > 0
        ? {
            title: state.draft.title,
            subject: state.draft.subject,
            chapters: state.draft.hierarchy.map((chapter: any) => ({
              id: chapter.id,
              title: chapter.title,
              topics: (chapter.children || []).map((topic: any) => ({
                id: topic.id,
                title: topic.title,
                questionTypeTitle: topic.questionTypeTitle,
                questionIds: topic.questionRefs || [],
              })),
            })),
            questions: state.questions.map((q: any) => ({
              id: q.id,
              questionLabel: q.normalizedQuestion?.questionLabel || `${q.questionOrder + 1}`,
              rawText: q.rawExtractedBlock?.rawText || "",
              page: q.rawExtractedBlock?.page || 1,
              difficulty: q.normalizedQuestion?.difficulty || "medium",
              normalizedQuestion: q.normalizedQuestion,
            })),
            totalQuestions: state.questions.length,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
export async function getPersonalProgramDebug(req: Request, res: Response): Promise<void> {
  try {
    const jobId = getJobId(req);
    const state = await programIngestionService.getJobState(jobId);
    if (!state) {
      res.status(404).json({ error: "Personal program not found" });
      return;
    }
    
    // Return the complete raw state for debugging
    res.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ error: message });
  }
}
