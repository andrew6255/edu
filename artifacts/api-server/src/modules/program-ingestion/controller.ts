import type { Request, Response, NextFunction } from "express";
import { programIngestionService } from "./service";
import {
  parseAttachIngestionSourceFileInput,
  parseCreateIngestionJobInput,
  parseRunIngestionStageInput,
} from "./validation";
import { logger } from "../../lib/logger";
import { evaluateQuestionAnomalies } from "./anomalyEngine";
import { getOrganizerProvider } from "./providers.organizer";
import type { OrganizerRequest } from "./organizer";

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

export async function organizeProgramQuestions(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Partial<OrganizerRequest> | undefined;
    if (!body || typeof body.programId !== "string" || !body.programId.trim()) throw new Error("programId is required.");
    if (typeof body.programSubject !== "string" || !body.programSubject.trim()) throw new Error("programSubject is required.");
    if (!Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 0) throw new Error("baseRevision must be a non-negative integer.");
    if (!Array.isArray(body.currentTree)) throw new Error("currentTree must be an array.");
    if (!Array.isArray(body.incomingQuestions) || body.incomingQuestions.length === 0) throw new Error("incomingQuestions must contain at least one question.");
    const ids = new Set<string>();
    for (const question of body.incomingQuestions) {
      if (!question || typeof question.id !== "string" || !question.id.trim() || typeof question.text !== "string" || !question.text.trim()) throw new Error("Every incoming question requires a unique id and text.");
      if (ids.has(question.id)) throw new Error(`Duplicate incoming question ID: ${question.id}`);
      ids.add(question.id);
    }
    const provider = getOrganizerProvider();
    const result = await provider.organize(body as OrganizerRequest);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown organizer error";
    res.status(400).json({ error: message });
  }
}

// ─── Personal Program Endpoints ─────────────────────────────────────────────────

import { runPersonalProgramPipeline } from "./autoRunPipeline";
import { jobQueue } from "../../lib/jobQueue";

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

    // 3. Fire background pipeline via asynchronous job queue with concurrency control and retries
    jobQueue.enqueue(created.jobId, async (updateProgress) => {
      await runPersonalProgramPipeline(created.jobId, updateProgress);
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

    const providerMeta = (state.job.providerMeta as Record<string, any>) || {};

    res.json({
      status: state.job.status,
      stage: state.job.stage,
      errorMessage: state.job.errorMessage,
      progress: providerMeta.progress || 0,
      progressMessage: providerMeta.progressMessage || "",
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
  // ── Streaming NDJSON setup ────────────────────────────────────────────────
  // Each progress line: {"progress":{"icon":"...","message":"...","detail":"..."}}
  // Final line:          {"result":{"questions":[...]}}
  // Error line:          {"error":"..."}
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendProgress = (icon: string, message: string, detail?: string, stats?: { totalPages?: number; currentPage?: number; totalQuestions?: number }) => {
    res.write(JSON.stringify({ progress: { icon, message, detail: detail ?? "", stats: stats ?? {} } }) + "\n");
    if (typeof (res as any).flush === "function") (res as any).flush();
  };

  const sendError = (message: string) => {
    res.write(JSON.stringify({ error: message }) + "\n");
    res.end();
  };

  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const questionFiles = files?.["file"] ?? [];
    const answerFiles = files?.["answersFile"] ?? [];
    const answersFile = answerFiles[0];

    if (questionFiles.length === 0) {
      sendError("At least one questions file is required");
      return;
    }

    const apiKeyEnv = process.env["GROQ_API_KEY"];
    if (!apiKeyEnv) throw new Error("GROQ_API_KEY is not configured.");
    const apiKeys = apiKeyEnv.split(',').map(k => k.trim()).filter(k => k);
    
    // Helper to get next key round-robin style
    let keyIndex = 0;
    const getNextApiKey = () => {
      const key = apiKeys[keyIndex % apiKeys.length];
      keyIndex++;
      return key;
    };
    const VISION_MODEL = "qwen/qwen3.6-27b";

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const pathMod = await import("node:path");
    const fs = await import("node:fs/promises");

    const execFileAsync = promisify(execFile);
    const scriptPath = pathMod.resolve(process.cwd(), "src/modules/program-ingestion/pdf_extractor.py");

    // Find Python
    const py312Path = "C:\\\\Users\\\\antoi\\\\AppData\\\\Local\\\\Programs\\\\Python\\\\Python312\\\\python.exe";
    let pythonCmd = "python";
    try { await fs.access(py312Path); pythonCmd = py312Path; } catch {}

    // ─── Step 1: Render document pages to PNG for vision ─────────────────────────
    sendProgress("📄", "Rendering document pages…", `Combining ${questionFiles.length} question source file(s)`);
    logger.info({ fileCount: questionFiles.length }, "[extractIqPdf] Rendering question sources...");
    const extractedData: {
      pages: Array<{ page: number; pngBase64: string; images: Record<string, string>; imageMetadata?: Record<string, any> }>;
    } = { pages: [] };
    for (const [sourceIndex, questionFile] of questionFiles.entries()) {
      try {
        sendProgress("📄", `Rendering question source ${sourceIndex + 1}/${questionFiles.length}…`, questionFile.originalname);
        const { stdout } = await execFileAsync(pythonCmd, [scriptPath, questionFile.path, "--render"], {
          maxBuffer: 100 * 1024 * 1024,
          windowsHide: true,
        });
        const sourceData = JSON.parse(stdout) as typeof extractedData;
        const pageOffset = extractedData.pages.length;
        extractedData.pages.push(...(sourceData.pages ?? []).map((page, pageIndex) => ({ ...page, page: pageOffset + pageIndex + 1 })));
      } finally {
        await fs.unlink(questionFile.path).catch(e => logger.warn({ err: e }, "Failed to unlink question source"));
      }
    }

    if (!extractedData.pages || extractedData.pages.length === 0) {
      throw new Error("Could not extract any pages from the uploaded question files.");
    }

    // Collect all per-page images and metadata for later embedding
    const allPageImages = extractedData.pages.map(p => ({
      page: p.page,
      images: p.images || {},
      imageMetadata: p.imageMetadata || {},
    }));

    // ─── Step 2: Parse answer key if provided ───────────────────────────────
    let answerMap: Record<number, string> = {}; // questionNumber -> "A"|"B"|"C"...

    if (answersFile) {
      sendProgress("🔑", "Parsing answer key…", "Extracting answers from key file using AI");
      logger.info("[extractIqPdf] Parsing answer key file...");
      let answersText = "";

      for (const [answerIndex, answerFile] of answerFiles.entries()) {
        try {
          let sourceText = "";
          if (answerFile.mimetype.startsWith("text/") || /\.(txt|csv|json|md)$/i.test(answerFile.originalname)) {
            sourceText = await fs.readFile(answerFile.path, "utf-8");
          } else if (answerFile.mimetype.startsWith("image/")) {
            const { stdout: renderedStdout } = await execFileAsync(pythonCmd, [scriptPath, answerFile.path, "--render"], {
              maxBuffer: 50 * 1024 * 1024,
              windowsHide: true,
            });
            const rendered = JSON.parse(renderedStdout) as { pages: Array<{ pngBase64: string }> };
            for (const page of rendered.pages ?? []) {
              const visionResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { Authorization: `Bearer ${getNextApiKey()}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: VISION_MODEL,
                  temperature: 0,
                  messages: [{ role: "user", content: [
                    { type: "text", text: "Transcribe this answer key or marking scheme exactly. Preserve question numbers and answer letters/text. Return transcription only." },
                    { type: "image_url", image_url: { url: `data:image/png;base64,${page.pngBase64}` } },
                  ] }],
                }),
              });
              if (!visionResponse.ok) throw new Error(`Could not read answer image ${answerFile.originalname}`);
              const visionPayload = await visionResponse.json() as any;
              sourceText += `\n${visionPayload.choices?.[0]?.message?.content ?? ""}`;
            }
          } else {
            const { stdout: documentStdout } = await execFileAsync(pythonCmd, [scriptPath, answerFile.path], {
              maxBuffer: 50 * 1024 * 1024,
              windowsHide: true,
            });
            const documentData = JSON.parse(documentStdout) as { pages: Array<{ text: string }> };
            sourceText = documentData.pages.map(page => page.text).join("\n");
          }
          if (sourceText.trim()) {
            answersText += `\n\n--- ANSWER SOURCE ${answerIndex + 1}: ${answerFile.originalname} ---\n${sourceText}`;
          }
        } finally {
          await fs.unlink(answerFile.path).catch(e => logger.warn({ err: e }, "Failed to unlink answer file"));
        }
      }

      if (answersText.trim()) {
        // Use LLM to parse the answer key (handles any format)
        const answerParsePrompt = `You are an answer key parser. Parse the following answer key and return a JSON object mapping question numbers to their correct answer letters.

The answer key may be in any format (e.g. "1. B", "1) B", "Q1: B", "1-B", etc.). Extract just the question number and the answer letter (A, B, C, D, E, etc.).

Answer key:
${answersText}

Return ONLY a JSON object like {"answers": {"1": "B", "2": "A", "3": "D"}} with no other text.`;

        const answerRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${getNextApiKey()}`,
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            temperature: 0.0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "You output valid JSON only." },
              { role: "user", content: answerParsePrompt },
            ],
          }),
        });

        if (answerRes.ok) {
          const ansPayload = await answerRes.json() as any;
          const ansText = ansPayload.choices?.[0]?.message?.content?.trim();
          if (ansText) {
            try {
              const parsed = JSON.parse(ansText);
              const rawAnswers = parsed.answers || parsed;
              for (const [key, val] of Object.entries(rawAnswers)) {
                const num = parseInt(key, 10);
                if (Number.isFinite(num) && typeof val === "string") {
                  answerMap[num] = val.toUpperCase().trim();
                }
              }
              logger.info({ count: Object.keys(answerMap).length }, "[extractIqPdf] Parsed answers from key");
            } catch (e) {
              logger.warn({ err: e }, "[extractIqPdf] Failed to parse answer key JSON");
            }
          }
        }
      }
    }

    // ─── Step 3: Vision-based question extraction per page ──────────────────
    const totalPages = extractedData.pages.length;
    sendProgress("🔍", `Starting vision extraction…`, `${totalPages} page${totalPages !== 1 ? 's' : ''} to process`, { totalPages, currentPage: 0, totalQuestions: 0 });
    logger.info({ totalPages }, "[extractIqPdf] Extracting questions using vision...");

    const allQuestions: any[] = [];

    // Process one page at a time — high-res PNGs can be large
    for (let pageIdx = 0; pageIdx < extractedData.pages.length; pageIdx++) {
      const page = extractedData.pages[pageIdx];
      sendProgress(
        "🧠",
        `AI Vision — Page ${page.page} of ${totalPages}`,
        `Identifying questions, choices & diagrams on page ${page.page}`,
        { totalPages, currentPage: page.page, totalQuestions: allQuestions.length }
      );
      logger.info({ page: page.page, totalPages }, "[extractIqPdf] Processing page...");

      const visionPrompt = `You are an expert at extracting Multiple Choice Questions (MCQs) from exam/test page images.

We have drawn RED BOXES with WHITE-BACKGROUND LABELS (e.g. [IMG_0], [IMG_1]) around every image/figure detected on this page. Each label is printed in large red text above its red box.

Your job: extract every MCQ on this page and correctly assign each [IMG_X] label to the right location.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 1 — EVERY RED LABEL MUST BE CATEGORIZED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every [IMG_X] label visible on the page MUST appear in exactly one of:
  • "promptImageLabels" — if it is a diagram/figure that belongs to the question body
  • "choices" — if it IS one of the answer options (A, B, C, D, E)
  • "irrelevantImages" — if it is a page border, page number, decorative noise, or watermark

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 2 — IMAGE-ONLY CHOICES (MOST CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When a choice option is an IMAGE (not text), you MUST use its [IMG_X] label as the choice value.
❌ WRONG:  "choices": ["(A)", "(B)", "(C)", "(D)"]   ← These are NEVER acceptable
❌ WRONG:  "choices": ["A", "B", "C", "D"]
✅ CORRECT: "choices": ["[IMG_3]", "[IMG_1]", "[IMG_4]", "[IMG_2]"]

Example scenario — 4 image choices on the page:
  Option A → image labeled [IMG_3]
  Option B → image labeled [IMG_1]
  Option C → image labeled [IMG_4]
  Option D → image labeled [IMG_2]
Correct output: "choices": ["[IMG_3]", "[IMG_1]", "[IMG_4]", "[IMG_2]"]
Note: The order follows A→B→C→D on the PAGE, NOT the numerical order of [IMG_X] labels!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 3 — PRESERVE EXACT CHOICE ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Always output choices in A→B→C→D→E order as shown on the page.
Do NOT reorder images by their [IMG_X] number. Match each image to its option letter by position on the page.
The image that appears next to "A)" goes in choices[0], next to "B)" goes in choices[1], etc.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 4 — QUESTION IMAGES vs CHOICE IMAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• If an image appears ABOVE or WITHIN the question text → "promptImageLabels"
• If an image appears NEXT TO or BELOW a choice letter (A, B, C, D) → put its label in "choices" at the correct index
• If a question has BOTH a prompt image AND image choices, they go in separate arrays

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return a JSON object with a "questions" array. Each question:
{
  "questionNumber": 1,
  "promptRawText": "The full question stem text (no [IMG_X] tokens in here)",
  "promptImageLabels": ["[IMG_0]"],
  "hasQuestionImage": true,
  "choices": ["choice A text or [IMG_X]", "choice B text or [IMG_X]", ...],
  "choiceHasImage": [false, true, false, false],
  "irrelevantImages": ["[IMG_5]"],
  "pageNumber": ${page.page}
}

Additional rules:
- Extract questions in the numbered order shown on the page
- Be precise with mathematical notation and symbols
- Use the [IMG_X] labels EXACTLY as printed (including brackets)
- Return ONLY valid JSON — no markdown fences, no commentary`;

      let retryCount = 0;
      const maxRetries = 10;
      let pageQuestions: any[] = [];
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          const visionRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${getNextApiKey()}`,
            },
            body: JSON.stringify({
              model: VISION_MODEL,
              temperature: 0.1,
              max_tokens: 3500, // Keep this low so Input + Max < 8000 (Groq TPM free limit)
              reasoning_effort: "none",
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: visionPrompt },
                    {
                      type: "image_url",
                      image_url: { url: `data:image/png;base64,${page.pngBase64}` },
                    },
                  ],
                },
              ],
            }),
          });

          if (!visionRes.ok) {
            const errText = await visionRes.text();
            
            if (visionRes.status === 429 || visionRes.status === 413) {
              // If we haven't tried all keys yet for this page, retry almost instantly with the next key.
              // If we have exhausted all keys (retryCount >= apiKeys.length - 1), then we actually wait.
              const waitMs = retryCount >= (apiKeys.length - 1) ? 15000 + (retryCount * 5000) : 500; 
              logger.warn({ page: page.page, status: visionRes.status, err: errText.slice(0,100) }, "[extractIqPdf] Rate limit hit. Retrying...");
              await new Promise(r => setTimeout(r, waitMs));
              retryCount++;
              continue; // Try again
            }

            logger.error({ page: page.page, status: visionRes.status, err: errText }, "[extractIqPdf] Vision API error");
            break; // Break the while loop on fatal errors (e.g. 401 auth error)
          }

          const visionPayload = await visionRes.json() as any;
          let responseText = visionPayload.choices?.[0]?.message?.content?.trim();
          
          if (!responseText) {
            logger.warn({ page: page.page }, "[extractIqPdf] Empty response for page");
            break;
          }

          logger.info({ page: page.page, length: responseText.length }, "[extractIqPdf] Page response received");

          if (responseText.includes("</think>")) {
            responseText = responseText.split("</think>").pop()?.trim() || responseText;
          }

          try {
            const parsed = JSON.parse(responseText);
            pageQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
            success = true;
          } catch {
            const fenced = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (fenced) {
              try {
                const parsed = JSON.parse(fenced[1]);
                pageQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
                success = true;
              } catch (e2) {
                logger.warn({ page: page.page, sample: responseText.slice(0, 500) }, "[extractIqPdf] Failed to parse vision response");
                break;
              }
            } else {
              logger.warn({ page: page.page, sample: responseText.slice(0, 500) }, "[extractIqPdf] Could not parse response");
              break;
            }
          }
        } catch (err) {
          logger.error({ page: page.page, err }, "[extractIqPdf] Error processing page");
          break; // Network errors
        }
      }

      if (success) {
        logger.info({ page: page.page, extractedCount: pageQuestions.length }, "[extractIqPdf] Page extracted questions");
        pageQuestions.forEach((q: any) => {
          q.pageNumber = page.page;
        });
        allQuestions.push(...pageQuestions);
        sendProgress(
          "✓",
          `Completed Page ${page.page} of ${totalPages}`,
          `Found ${pageQuestions.length} questions on this page (${allQuestions.length} total so far)`,
          { totalPages, currentPage: page.page, totalQuestions: allQuestions.length }
        );
      } else {
        logger.warn({ page: page.page, retries: retryCount }, "[extractIqPdf] Failed to extract questions from page after retries");
      }
    }

    if (allQuestions.length === 0) {
      throw new Error("No questions could be extracted from the PDF. The vision model could not identify any MCQs.");
    }

    // ─── Step 4: Build final question objects with answers & images ──────────
    sendProgress("⚙️", `Building question objects…`, `Assembling ${allQuestions.length} extracted questions with answers & images`, { totalPages, currentPage: totalPages, totalQuestions: allQuestions.length });
    logger.info({ totalQuestions: allQuestions.length }, "[extractIqPdf] Building question objects...");

    // Combine all page image dictionaries and spatial metadata into global maps
    const imageMap: Record<string, string> = {};
    const metadataMap: Record<string, { bbox: number[]; nearestTextBefore: string; nearestChoiceLabel: string | null; pageNumber: number }> = {};
    
    for (const pi of allPageImages) {
      if (pi.images && typeof pi.images === 'object' && !Array.isArray(pi.images)) {
        Object.assign(imageMap, pi.images);
      }
      if (pi.imageMetadata && typeof pi.imageMetadata === 'object') {
        for (const [k, v] of Object.entries(pi.imageMetadata)) {
          metadataMap[k] = { ...v, pageNumber: pi.page };
        }
      }
    }

    // Helper to robustly extract [IMG_X] key even if AI missed brackets
    const getImgKey = (str: string) => {
      const match = str.match(/IMG_\d+/);
      return match ? `[${match[0]}]` : null;
    };

    // Track which images are explicitly matched to prevent orphan noise
    const matchedImages = new Set<string>();

    const formattedQuestions = allQuestions.map((q: any, i: number) => {
      const choices: string[] = Array.isArray(q.choices) ? q.choices : [];
      const qNum = typeof q.questionNumber === "number" ? q.questionNumber : i + 1;
      const pageNum = q.pageNumber || 1;
      let rawText = q.promptRawText || "";

      // Deterministic Proximity Correction: check if any image on this page belongs to choices or prompt programmatically
      const pageImages = Object.entries(metadataMap).filter(([, meta]) => meta.pageNumber === pageNum);

      // Sort pageImages by their bbox Y position (top-to-bottom) for predictable assignment order
      const pageImagesSorted = [...pageImages].sort(([, a], [, b]) => {
        const ay = a.bbox?.[1] ?? 0;
        const by = b.bbox?.[1] ?? 0;
        return ay - by;
      });

      const finalChoices = choices.map((choice: string, idx: number) => {
        const choiceLetter = String.fromCharCode(65 + idx); // A, B, C, D...

        // Pass 1: AI explicitly assigned an [IMG_X] label to this choice → trust it
        const key = getImgKey(choice);
        if (key && imageMap[key]) {
          matchedImages.add(key);
          return imageMap[key];
        }

        // Pass 2: The AI returned "(A)", "(B)", "(C)" etc. — detect these placeholder strings
        // and replace with image found via proximity metadata (nearestChoiceLabel)
        const isPlaceholder = /^\s*[\(\[]?[A-Ea-e][\)\]]?\s*$/.test(choice.trim());
        if (isPlaceholder) {
          // Find an unmatched image whose nearestChoiceLabel matches this choice letter
          for (const [imgKey, meta] of pageImagesSorted) {
            if (!matchedImages.has(imgKey) && meta.nearestChoiceLabel === choiceLetter) {
              matchedImages.add(imgKey);
              return imageMap[imgKey];
            }
          }
          // Secondary: if no label match, try assigning by Y-position order among unmatched images
          // that have no nearestChoiceLabel (pure image grids)
          const unlabeled = pageImagesSorted.filter(([imgKey, meta]) =>
            !matchedImages.has(imgKey) && !meta.nearestChoiceLabel
          );
          if (unlabeled.length > 0) {
            // Assign the idx-th unmatched unlabeled image to this choice slot
            const unassigned = pageImagesSorted.filter(([imgKey, meta]) =>
              !matchedImages.has(imgKey) && meta.nearestChoiceLabel === null
            );
            if (unassigned.length > 0) {
              const [firstKey] = unassigned[0];
              matchedImages.add(firstKey);
              return imageMap[firstKey];
            }
          }
        }

        // Pass 3: Standard proximity fallback for non-placeholder text choices
        for (const [imgKey, meta] of pageImagesSorted) {
          if (!matchedImages.has(imgKey) && meta.nearestChoiceLabel === choiceLetter) {
            const qPrefix = `${qNum}.`;
            if (rawText.startsWith(qPrefix) || meta.nearestTextBefore.includes(qPrefix) || (meta.nearestTextBefore.length > 5 && rawText.includes(meta.nearestTextBefore.slice(0, 20)))) {
              matchedImages.add(imgKey);
              return imageMap[imgKey];
            }
          }
        }

        // Pass 4: Strip leading choice-label prefix from text choices.
        // "A) 6" → "6",  "B. 7" → "7",  "(C) text" → "text"
        // Only strip when the leading letter matches the EXPECTED letter for this slot,
        // so we don't accidentally strip a chemistry answer like "A molecule..."
        const prefixPattern = new RegExp(
          `^\\s*[\\(\\[]?${choiceLetter}[\\)\\]\\.\\:\\s]\\s*`,
          'i'
        );
        const strippedChoice = choice.replace(prefixPattern, '').trim();
        // Never return an empty string — fall back to original if stripping removes everything
        return strippedChoice || choice;
      });

      // Final pass: remove any choices that are still pure letter placeholders like "A", "(B)", "C)"
      // after all recovery passes (these mean the AI could not resolve the image and left a stub).
      // We keep them as-is but mark them for review; they'll appear as text stubs in the UI.
      const cleanedFinalChoices = finalChoices.map((ch, idx) => {
        const letter = String.fromCharCode(65 + idx);
        // Pure letter placeholder: single letter, optional parens/brackets/dot — replace with empty string so UI renders nothing
        const isPureLetter = /^\s*[\(\[]?[A-Ea-e][\)\]\.\:]?\s*$/.test(typeof ch === 'string' ? ch : '');
        if (isPureLetter && typeof ch === 'string' && !ch.startsWith('data:')) {
          // Return empty text — better than showing "(A)" as a meaningless choice
          return '';
        }
        return ch;
      });

      // Determine correct answer from answer map
      let correctChoiceIndex = -1;
      const answerLetter = answerMap[qNum];
      if (answerLetter) {
        const idx = answerLetter.charCodeAt(0) - "A".charCodeAt(0);
        if (idx >= 0 && idx < cleanedFinalChoices.length) {
          correctChoiceIndex = idx;
        }
      }

      const blocks: any[] = [];
      const imgLabels = Array.isArray(q.promptImageLabels) ? q.promptImageLabels : [];

      // Extract images from text as fallback
      const textImgMatches = rawText.match(/\[?IMG_\d+\]?/g);
      rawText = rawText.replace(/\[?IMG_\d+\]?/g, '').trim();
      
      if (rawText) {
        blocks.push({ type: "text", text: rawText });
      }

      const addBlockIfNew = (key: string) => {
        if (!blocks.some(b => b.type === 'image' && b.url === imageMap[key])) {
          blocks.push({ type: "image", url: imageMap[key] });
          matchedImages.add(key);
        }
      };

      // Add images from explicit labels (robust match)
      for (const m of imgLabels) {
        if (typeof m === 'string') {
          const key = getImgKey(m);
          if (key && imageMap[key]) {
            addBlockIfNew(key);
          }
        }
      }

      // Add fallback images found in text
      if (textImgMatches) {
        for (const m of textImgMatches) {
          const key = getImgKey(m);
          if (key && imageMap[key]) {
            addBlockIfNew(key);
          }
        }
      }

      // Deterministic Proximity Fallback for prompt images: if an image on this page matches question number prefix
      for (const [imgKey, meta] of pageImages) {
        if (!matchedImages.has(imgKey) && !meta.nearestChoiceLabel) {
          const qPrefix = `${qNum}.`;
          if ((rawText.startsWith(qPrefix) && meta.nearestTextBefore.includes(qPrefix)) || (meta.nearestTextBefore.length > 10 && rawText.includes(meta.nearestTextBefore.slice(0, 15)))) {
            addBlockIfNew(imgKey);
          }
        }
      }

      // Anomaly Detection Engine: assign reviewStatus and flags
      const { reviewStatus, flags } = evaluateQuestionAnomalies({
        correctChoiceIndex,
        hasAnswerMap: Object.keys(answerMap).length > 0,
        blocks,
        choices: cleanedFinalChoices,
        hasQuestionImage: q.hasQuestionImage,
      });

      return {
        promptRawText: rawText,
        promptBlocks: blocks,
        interaction: {
          type: "mcq",
          choices: cleanedFinalChoices,
          correctChoiceIndex,
        },
        hasQuestionImage: q.hasQuestionImage || blocks.some(b => b.type === 'image'),
        pageNumber: pageNum,
        questionNumber: qNum,
        reviewStatus,
        flags,
      };
    });

    // ─── Step 5: Deep Vision Review — Pass A (Vision AI vs Original PDF) ────────
    // For each page, we send the original annotated page PNG + the extracted questions
    // to the vision model. It compares what it sees on the page vs what was extracted,
    // then returns a set of corrections. This catches: wrong choice text, missing images,
    // wrong image slot assignment, mis-read question text, etc.
    const reviewTotalPages = extractedData.pages.length;
    sendProgress("🔎", "Vision Review Pass A…", `AI comparing PDF pages vs extracted questions (${formattedQuestions.length} questions)`, { totalPages, currentPage: totalPages, totalQuestions: formattedQuestions.length });

    try {
      for (let pageIdx = 0; pageIdx < extractedData.pages.length; pageIdx++) {
        const reviewPage = extractedData.pages[pageIdx];
        const pageQs = formattedQuestions.filter((fq: any) => fq.pageNumber === reviewPage.page);
        if (pageQs.length === 0) continue;

        sendProgress("🔎", `Vision Review — Page ${reviewPage.page}/${reviewTotalPages}`, `Cross-checking ${pageQs.length} question(s) on page ${reviewPage.page} against original PDF`, { totalPages, currentPage: totalPages, totalQuestions: formattedQuestions.length });

        // Build compact question representation for the review prompt (no data URIs)
        const pageQsForReview = pageQs.map((fq: any, localIdx: number) => ({
          globalIdx: formattedQuestions.indexOf(fq),
          questionNumber: fq.questionNumber,
          promptRawText: fq.promptRawText,
          choices: fq.interaction.choices.map((c: string) =>
            typeof c === 'string' && c.startsWith('data:') ? '[IMAGE]' : c
          ),
          choiceCount: fq.interaction.choices.length,
        }));

        const visionReviewPrompt = `You are a quality-control AI that verifies MCQ extractions from an exam PDF page.

I extracted the following questions from the PDF page shown in the image. Your job: compare what you see on the PDF page with what was extracted, and fix any errors.

Extracted questions (JSON):
${JSON.stringify(pageQsForReview, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT TO CHECK AND FIX:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **Question text accuracy**: Does the extracted promptRawText match what is written on the page? Fix any mis-reads, missing words, or truncations.

2. **Choice text accuracy**: Does each choice text match the actual choice on the page? Fix mis-reads. 
   - If a choice on the page is an IMAGE (not text), use "[IMAGE]" — do NOT write text for image choices.
   - If a choice has a label prefix like "A) 6" but the actual answer is just "6", strip the prefix.
   - If a choice slot has "(A)", "(B)" etc. as the extracted value but the real choice is an image, mark it as "[IMAGE]".

3. **Choice count**: Verify the number of choices matches what you see on the page. If wrong, correct the count (add empty strings "" for missing slots, do not invent answers).

4. **Issue flags**: For each question, set "needsHumanReview" to true and populate "issues" array if:
   - You cannot confidently verify the answer content (image choices you cannot compare by text)
   - The extracted text has a significant mismatch you cannot fully auto-correct
   - A choice slot says "[IMAGE]" but you're unsure which image goes there
   - The question number sequence seems broken or duplicated

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT (JSON object with "corrections" array):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "corrections": [
    {
      "globalIdx": number,
      "promptRawText": "corrected question text",
      "choices": ["corrected choice A", "corrected choice B", ...],
      "needsHumanReview": false,
      "issues": []
    }
  ]
}

Rules:
- Only include questions that have corrections or issues in the "corrections" array (skip unchanged questions)
- Never invent or hallucinate answer content — if uncertain, set needsHumanReview: true
- Preserve "[IMAGE]" placeholders exactly
- Return ONLY valid JSON, no markdown fences`;

        try {
          let reviewRetries = 0;
          while (reviewRetries < 4) {
            const reviewRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getNextApiKey()}`,
              },
              body: JSON.stringify({
                model: VISION_MODEL,
                temperature: 0.0,
                max_tokens: 3000,
                reasoning_effort: "none",
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: visionReviewPrompt },
                      {
                        type: "image_url",
                        image_url: { url: `data:image/png;base64,${reviewPage.pngBase64}` },
                      },
                    ],
                  },
                ],
              }),
            });

            if (!reviewRes.ok) {
              if (reviewRes.status === 429) {
                const waitMs = 15000 + (reviewRetries * 5000);
                await new Promise(r => setTimeout(r, waitMs));
                reviewRetries++;
                continue;
              }
              break;
            }

            const reviewPayload = await reviewRes.json() as any;
            let reviewText = reviewPayload.choices?.[0]?.message?.content?.trim();
            if (!reviewText) break;

            // Strip <think> tags if present
            if (reviewText.includes("</think>")) {
              reviewText = reviewText.split("</think>").pop()?.trim() || reviewText;
            }

            try {
              // Parse JSON (handle fenced blocks)
              let parsed: any;
              try {
                parsed = JSON.parse(reviewText);
              } catch {
                const fenced = reviewText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
                if (fenced) parsed = JSON.parse(fenced[1]);
                else throw new Error("unparseable");
              }

              const corrections: any[] = Array.isArray(parsed) ? parsed : (parsed.corrections || []);

              for (const corr of corrections) {
                const fq = formattedQuestions[corr.globalIdx];
                if (!fq) continue;

                // Apply text corrections
                if (typeof corr.promptRawText === 'string' && corr.promptRawText.trim()) {
                  fq.promptRawText = corr.promptRawText.trim();
                  const firstText = fq.promptBlocks.find((b: any) => b.type === 'text');
                  if (firstText) firstText.text = fq.promptRawText;
                }

                // Apply choice corrections (never overwrite real data: image URIs)
                if (Array.isArray(corr.choices) && corr.choices.length === fq.interaction.choices.length) {
                  fq.interaction.choices = fq.interaction.choices.map((orig: string, ci: number) => {
                    const corrected = corr.choices[ci];
                    if (typeof orig === 'string' && orig.startsWith('data:')) return orig; // preserve images
                    if (typeof corrected === 'string' && corrected !== '[IMAGE]') return corrected;
                    return orig;
                  });
                }

                // Apply human-review flags from vision model
                if (corr.needsHumanReview === true) {
                  if (!fq.flags) fq.flags = [];
                  fq.reviewStatus = "FLAGGED_FOR_REVIEW";
                  if (Array.isArray(corr.issues) && corr.issues.length > 0) {
                    for (const issue of corr.issues) {
                      const flagStr = `VISION_REVIEW: ${issue}`;
                      if (!fq.flags.includes(flagStr)) fq.flags.push(flagStr);
                    }
                  } else {
                    if (!fq.flags.includes("VISION_REVIEW_UNCERTAIN")) {
                      fq.flags.push("VISION_REVIEW_UNCERTAIN");
                    }
                  }
                }
              }

              logger.info({ page: reviewPage.page, corrections: corrections.length }, "[extractIqPdf] Vision review Pass A applied corrections");
              break; // Success — move to next page
            } catch {
              logger.warn({ page: reviewPage.page }, "[extractIqPdf] Vision review Pass A: failed to parse response");
              break;
            }
          }
        } catch (pageReviewErr) {
          logger.warn({ page: reviewPage.page, err: pageReviewErr }, "[extractIqPdf] Vision review Pass A: page skipped");
        }
      }
    } catch (visionReviewErr) {
      logger.warn({ err: visionReviewErr }, "[extractIqPdf] Vision review Pass A failed, continuing");
    }

    // ─── Step 5 Pass B: Text LLM audit — flag residual issues ───────────────────
    // After vision corrections, a fast text LLM does a final structural audit and
    // flags anything that still looks suspicious for human review.
    sendProgress("✅", "Vision Review Pass B…", "Final structural audit & flagging any remaining issues", { totalPages, currentPage: totalPages, totalQuestions: formattedQuestions.length });

    try {
      const textOnlyForAudit = formattedQuestions.map((fq: any, i: number) => ({
        idx: i,
        questionNumber: fq.questionNumber,
        promptRawText: fq.promptRawText,
        choices: fq.interaction.choices.map((c: string) =>
          typeof c === 'string' && c.startsWith('data:') ? '[IMAGE]' : c
        ),
        choiceCount: fq.interaction.choices.length,
        alreadyFlagged: fq.reviewStatus === "FLAGGED_FOR_REVIEW",
        existingFlags: fq.flags || [],
      }));

      const auditPrompt = `You are a final quality-auditor for MCQ extraction from PDFs. A vision AI already reviewed and corrected these questions. Your job: a final check for structural and textual issues.

For each question, check:
1. Are any text choices still starting with letter prefixes like "A) ...", "B) ...", "(C) ..."? Flag as "LABEL_PREFIX_LEAK"
2. Is any choice an empty string "" where it shouldn't be (suggesting a missing image or text)? Flag as "EMPTY_CHOICE_SLOT"
3. Does the question text seem truncated, incomplete or non-sensical? Flag as "QUESTION_TEXT_SUSPECT"  
4. Are there fewer than 2 choices? Flag as "FEW_CHOICES"
5. Do the choices seem inconsistent in format (e.g., some are [IMAGE] and some are text in a question that should be all-image)? Flag as "MIXED_CHOICE_FORMAT"

Return a JSON object:
{
  "audits": [
    {
      "idx": number,
      "needsHumanReview": boolean,
      "flags": ["FLAG_NAME", ...]
    }
  ]
}

Only include questions with issues. Return ONLY valid JSON, no fences.

Questions:
${JSON.stringify(textOnlyForAudit, null, 2)}`;

      const auditRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${getNextApiKey()}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.0,
          max_tokens: 2000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You output valid JSON only." },
            { role: "user", content: auditPrompt },
          ],
        }),
      });

      if (auditRes.ok) {
        const auditPayload = await auditRes.json() as any;
        const auditText = auditPayload.choices?.[0]?.message?.content?.trim();
        if (auditText) {
          let parsed: any;
          try { parsed = JSON.parse(auditText); }
          catch {
             const match = auditText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
             if (match) parsed = JSON.parse(match[1]);
             else parsed = { audits: [] };
          }
          const audits: any[] = Array.isArray(parsed) ? parsed : (parsed.audits || []);
          let auditFlagged = 0;
          for (const audit of audits) {
            const fq = formattedQuestions[audit.idx];
            if (!fq) continue;
            if (audit.needsHumanReview || (audit.flags && audit.flags.length > 0)) {
              fq.reviewStatus = "FLAGGED_FOR_REVIEW";
              if (!fq.flags) fq.flags = [];
              for (const flag of (audit.flags || [])) {
                if (!fq.flags.includes(flag)) fq.flags.push(flag);
              }
              auditFlagged++;
            }
          }
          logger.info({ flagged: auditFlagged, total: formattedQuestions.length }, "[extractIqPdf] Vision review Pass B: audit complete");
        }
      }
    } catch (auditErr) {
      logger.warn({ err: auditErr }, "[extractIqPdf] Vision review Pass B: audit failed, continuing");
    }

    // Post-check for orphan images across pages
    const totalImages = Object.keys(imageMap).length;
    const orphanCount = totalImages - matchedImages.size;
    if (orphanCount > 0) {
      logger.warn({ orphanCount, totalImages }, "[extractIqPdf] Anomaly: Detected orphan images on PDF");
    }

    const answeredCount = Object.keys(answerMap).length;
    sendProgress("✅", `Done! ${formattedQuestions.length} questions extracted`, answeredCount > 0 ? `${answeredCount} answers applied from key` : "No answer key applied", { totalPages, currentPage: totalPages, totalQuestions: formattedQuestions.length });
    logger.info({ questionCount: formattedQuestions.length, answerCount: answeredCount }, "[extractIqPdf] Done! Extracted questions and applied answers.");

    res.write(JSON.stringify({ result: { questions: formattedQuestions } }) + "\n");
    res.end();

  } catch (error) {
    logger.error({ err: error }, "extractIqPdf error");
    const message = error instanceof Error ? error.message : "Unknown error";
    sendError(message);
  }
}

/**
 * POST /api/program-ingestion/iq-question-details
 * Uses Groq to analyze a question and return IQ parameters + explanation.
 */
export async function generateIqQuestionDetails(req: Request, res: Response): Promise<void> {
  try {
    const { promptText, choices, correctChoiceIndex, nodeIq } = req.body;
    if (!promptText) {
      res.status(400).json({ error: "promptText is required" });
      return;
    }

    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured.");
    }

    const choicesText = Array.isArray(choices) && choices.length > 0
      ? choices.map((c: string, i: number) => `${String.fromCharCode(65 + i)}) ${c}${i === correctChoiceIndex ? ' (CORRECT)' : ''}`).join('\n')
      : '';

    const prompt = `You are an educational assessment expert. Analyze this question and provide IQ-related parameters.

Question: ${promptText}
${choicesText ? `Choices:\n${choicesText}` : ''}
Base Node IQ Level: ${nodeIq || 80}

Respond with a JSON object (no markdown, no code fences) containing:
- "questionIq": number - Precise decimal estimate of the question's IQ difficulty (MUST be a number between ${nodeIq || 80} and ${(nodeIq || 80) + 10})
- "maxIqGain": number - Maximum IQ gain for correct answer (max 2.0, usually between 0.5-2.0 based on difficulty)
- "iqGainDecayRate": number - How much IQ gain decreases per time interval (usually 0.05-0.2)
- "iqGainDecayIntervalSec": number - Time interval for decay in seconds (usually 10)
- "iqLossBase": number - Base IQ loss for wrong answer (usually 1-5 based on difficulty)
- "iqLossScaleFactor": number - Scale factor for IQ-relative loss (usually 0.03-0.08)
- "explanation": string - A concise 1-2 sentence explanation of why the correct answer is correct and why other answers are wrong. Be direct and to the point.
- "category": string - MUST be exactly one of: "Fluid Reasoning", "Quantitative Reasoning", "Verbal Reasoning", "Working Memory".

Return ONLY valid JSON.`;

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const groqRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!groqRes.ok) {
      const errorText = await groqRes.text();
      throw new Error(`Groq request failed: ${errorText}`);
    }

    const groqData = await groqRes.json() as any;
    const responseText = groqData.choices?.[0]?.message?.content?.trim();
    if (!responseText) {
      throw new Error("Groq response empty");
    }

    // Parse JSON from response (strip markdown fences if present)
    let cleaned = responseText;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const parsed = JSON.parse(cleaned);

    res.json({
      questionIq: typeof parsed.questionIq === 'number' ? parsed.questionIq : nodeIq || 80,
      maxIqGain: typeof parsed.maxIqGain === 'number' ? Math.min(2, parsed.maxIqGain) : 2,
      iqGainDecayRate: typeof parsed.iqGainDecayRate === 'number' ? parsed.iqGainDecayRate : 0.1,
      iqGainDecayIntervalSec: typeof parsed.iqGainDecayIntervalSec === 'number' ? parsed.iqGainDecayIntervalSec : 10,
      iqLossBase: typeof parsed.iqLossBase === 'number' ? parsed.iqLossBase : 3,
      iqLossScaleFactor: typeof parsed.iqLossScaleFactor === 'number' ? parsed.iqLossScaleFactor : 0.05,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
      category: typeof parsed.category === 'string' ? parsed.category : 'Fluid Reasoning',
    });

  } catch (error) {
    logger.error({ err: error }, "generateIqQuestionDetails error");
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}

export const generateEmoji = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, subject } = req.body;
    
    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured.");
    }

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const prompt = `You are a helpful assistant. Provide exactly one single emoji that best represents an educational program or course with the name "${name}" and the subject "${subject}". Output ONLY the single emoji character. Do not output any other text, spaces, or quotes.`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.8,
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq request failed with status ${response.status}`);
    }

    const payload = await response.json() as any;
    let emoji = payload.choices?.[0]?.message?.content?.trim();
    if (!emoji || emoji.length === 0) {
      emoji = "📚";
    }

    // Attempt to strip out any non-emoji characters just in case
    const match = emoji.match(/\p{Emoji}/u);
    if (match) {
      emoji = match[0];
    } else {
      emoji = "📚";
    }

    res.status(200).json({ emoji });
  } catch (error) {
    next(error);
  }
};

// ─── Phase 3: Question Enrichment ────────────────────────────────────────────

import { enrichQuestionsBatch } from "./providers.grading";

/**
 * POST /api/program-ingestion/enrich-questions
 * Body: { questions: Array<{ id, rawText, modelAnswer, answerFromPdf }> }
 * Returns: { enriched: Record<questionId, EnrichedQuestionData> }
 */
export async function enrichQuestions(req: Request, res: Response): Promise<void> {
  try {
    const { questions } = req.body as {
      questions?: Array<{ id: string; rawText: string; modelAnswer: string; answerFromPdf: boolean }>;
    };

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({ error: "questions array is required and must not be empty." });
      return;
    }

    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) {
      res.status(500).json({ error: "GROQ_API_KEY is not configured on the server." });
      return;
    }

    const enriched = await enrichQuestionsBatch(questions, apiKey, 3);
    res.json({ enriched });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
