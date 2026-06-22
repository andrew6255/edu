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

// ─── IQ Games Specific Endpoints ──────────────────────────────────────────────

export async function extractMcqFromText(req: Request, res: Response): Promise<void> {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      res.status(400).json({ error: "Text is required" });
      return;
    }

    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured.");
    }

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const prompt = `You are an expert curriculum developer. Given the following raw text extracted from an Olympiad/IQ test PDF, identify all the Multiple Choice Questions (MCQs).
Extract them into a JSON array of objects, where each object has the following structure:
{
  "promptRawText": "The question text",
  "interaction": {
    "type": "mcq",
    "choices": ["Choice A text", "Choice B text", "Choice C text", "Choice D text", "Choice E text"],
    "correctChoiceIndex": 0
  }
}
If the correct answer is not explicitly given in the text, make your best guess for the correctChoiceIndex, but prioritize capturing the question and options accurately.
Make sure the choices array only contains the text of the option, without the A) or B) prefix. Output ONLY valid JSON array and nothing else.

Raw text:
${text}
`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output valid JSON arrays. Since response_format requires an object, output an object with a 'questions' key containing the array." },
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq request failed with status ${response.status}: ${errorText}`);
    }

    const payload = await response.json() as any;
    let responseText = payload.choices?.[0]?.message?.content?.trim();
    
    if (!responseText) {
      throw new Error("Groq response did not include any text content.");
    }

    const trimmed = responseText.trim();
    let jsonArray;
    try {
      const parsed = JSON.parse(trimmed);
      jsonArray = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } catch (e) {
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      const toParse = fenced ? fenced[1].trim() : trimmed;
      const parsed = JSON.parse(toParse);
      jsonArray = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    }

    const formattedQuestions = jsonArray.map((item: any) => ({
      promptRawText: item.promptRawText,
      interaction: item.interaction
    }));

    res.json({ questions: formattedQuestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export async function extractIqPdf(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "PDF file is required" });
      return;
    }

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const path = await import("node:path");
    
    const execFileAsync = promisify(execFile);
    const scriptPath = path.resolve(process.cwd(), "src/modules/program-ingestion/pdf_extractor.py");
    
    // Prefer the Python312 that has PyMuPDF installed, otherwise fallback to python
    const fs = await import("node:fs/promises");
    const py312Path = "C:\\\\Users\\\\antoi\\\\AppData\\\\Local\\\\Programs\\\\Python\\\\Python312\\\\python.exe";
    let pythonCmd = "python";
    try {
        await fs.access(py312Path);
        pythonCmd = py312Path;
    } catch(e) {}
    
    // Run python script
    const { stdout } = await execFileAsync(pythonCmd, [scriptPath, file.path], {
      maxBuffer: 50 * 1024 * 1024,
      windowsHide: true,
    });
    
    const extractedData = JSON.parse(stdout);
    
    // Clean up temp file
    await fs.unlink(file.path).catch(console.warn);

    // Prepare full text for Groq
    const allText = extractedData.pages.map((p: any) => p.text).join("\n\n");
    // Collect all images to heuristically assign later
    let allImages: string[] = [];
    extractedData.pages.forEach((p: any) => {
        if (p.images && p.images.length > 0) {
            allImages.push(...p.images);
        }
    });

    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const prompt = `You are an expert curriculum developer. Given the following raw text extracted from an Olympiad/IQ test PDF, identify all the Multiple Choice Questions (MCQs).
Extract them into a JSON array of objects, where each object has the following structure:
{
  "promptRawText": "The question text",
  "interaction": {
    "type": "mcq",
    "choices": ["Choice A text", "Choice B text", "Choice C text", "Choice D text", "Choice E text"],
    "correctChoiceIndex": 0
  }
}
If the correct answer is not explicitly given in the text, make your best guess for the correctChoiceIndex. If you absolutely cannot guess, use -1.
Output ONLY a valid JSON object containing a "questions" array.

Raw text:
${allText}
`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You output valid JSON containing a 'questions' array." },
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq request failed with status ${response.status}: ${errorText}`);
    }

    const payload = await response.json() as any;
    let responseText = payload.choices?.[0]?.message?.content?.trim();
    if (!responseText) throw new Error("Groq response empty");

    let jsonArray;
    try {
      const parsed = JSON.parse(responseText);
      jsonArray = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    } catch (e) {
      jsonArray = [];
    }

    // Heuristic image assignment: just assign sequentially for now if there are images
    const formattedQuestions = jsonArray.map((item: any, i: number) => {
       const resObj: any = {
          promptRawText: item.promptRawText,
          interaction: item.interaction
       };
       if (i < allImages.length) {
           resObj.imageUrl = allImages[i];
       }
       return resObj;
    });

    res.json({ questions: formattedQuestions });

  } catch (error) {
    console.error("extractIqPdf error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
