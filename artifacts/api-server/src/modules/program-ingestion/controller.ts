import type { Request, Response, NextFunction } from "express";
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
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const file = files?.["file"]?.[0];
    const answersFile = files?.["answersFile"]?.[0];

    if (!file) {
      res.status(400).json({ error: "PDF file is required" });
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

    // ─── Step 1: Render PDF pages to PNG for vision ─────────────────────────
    console.log("[extractIqPdf] Rendering PDF pages to PNG...");
    const { stdout } = await execFileAsync(pythonCmd, [scriptPath, file.path, "--render"], {
      maxBuffer: 100 * 1024 * 1024,
      windowsHide: true,
    });

    const extractedData = JSON.parse(stdout) as {
      pages: Array<{ page: number; pngBase64: string; images: string[] }>;
    };

    // Clean up temp file
    await fs.unlink(file.path).catch(console.warn);

    if (!extractedData.pages || extractedData.pages.length === 0) {
      throw new Error("Could not extract any pages from the PDF.");
    }

    // Collect all per-page images (individual extracted images) for later embedding
    const allPageImages: Array<{ page: number; images: string[] }> = extractedData.pages.map(p => ({
      page: p.page,
      images: p.images || [],
    }));

    // ─── Step 2: Parse answer key if provided ───────────────────────────────
    let answerMap: Record<number, string> = {}; // questionNumber -> "A"|"B"|"C"...

    if (answersFile) {
      console.log("[extractIqPdf] Parsing answer key file...");
      let answersText = "";

      if (answersFile.mimetype === "application/pdf") {
        // Extract text from the answers PDF
        const { stdout: ansStdout } = await execFileAsync(pythonCmd, [scriptPath, answersFile.path], {
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
        });
        const ansData = JSON.parse(ansStdout) as { pages: Array<{ text: string }> };
        answersText = ansData.pages.map(p => p.text).join("\n");
        await fs.unlink(answersFile.path).catch(console.warn);
      } else {
        // Read as text file
        answersText = await fs.readFile(answersFile.path, "utf-8");
        await fs.unlink(answersFile.path).catch(console.warn);
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
              console.log(`[extractIqPdf] Parsed ${Object.keys(answerMap).length} answers from key`);
            } catch (e) {
              console.warn("[extractIqPdf] Failed to parse answer key JSON:", e);
            }
          }
        }
      }
    }

    // ─── Step 3: Vision-based question extraction per page ──────────────────
    console.log(`[extractIqPdf] Extracting questions from ${extractedData.pages.length} pages using vision...`);

    const VISION_MODEL = "qwen/qwen3.6-27b";
    const allQuestions: any[] = [];

    // Process one page at a time — high-res PNGs can be large
    for (let pageIdx = 0; pageIdx < extractedData.pages.length; pageIdx++) {
      const page = extractedData.pages[pageIdx];
      console.log(`[extractIqPdf] Processing page ${page.page}/${extractedData.pages.length}...`);

      const visionPrompt = `You are an expert at extracting Multiple Choice Questions from exam/test page images.

Analyze the page image carefully and extract ALL MCQ questions visible. We have drawn red boxes and labels (e.g. [IMG_0], [IMG_1]) around all images/figures on the page.

For each question:

1. **Images Categorization (CRITICAL)**: You MUST categorize EVERY SINGLE RED LABEL (e.g. [IMG_0], [IMG_1]) on the page. Every red label MUST appear in exactly one of these arrays: 
   - 'promptImageLabels': If the image belongs to the question prompt or is a diagram/figure for the question.
   - 'choices': If the image is one of the answer choices.
   - 'irrelevantImages': If the image is irrelevant noise, a page number, or a meaningless line.

2. **Images in the Question**: If there is a diagram/figure for the question, you MUST put its red label in the "promptImageLabels" array. DO NOT skip this! Example: ["[IMG_0]"].

3. **Question text**: Extract the full question prompt text.

4. **Choices**: Extract ALL answer choices IN STRICT ALPHABETICAL ORDER (A, B, C, D, E). 
   - CRITICAL: You MUST match the correct red label to the correct letter option exactly as they appear on the page!
   - Example: If Option A is an image labeled [IMG_3] and Option B is an image labeled [IMG_1], your choices array MUST be exactly: ["[IMG_3]", "[IMG_1]", ...]
   - Do NOT just list the images in numerical order. Respect the A, B, C, D order on the page.

4. **Choice count**: Make sure you capture the EXACT number of choices shown for each question. Do not assume all questions have 4 or 5 choices.

5. **Question numbering**: Note the question number as shown on the page.

Return a JSON object with a "questions" array. Each question object:
{
  "questionNumber": 1,
  "promptImageLabels": ["[IMG_0]"],
  "promptRawText": "The full question text",
  "hasQuestionImage": true/false,
  "choices": ["choice A text", "[IMG_2]", ...],
  "choiceHasImage": [false, true, false, false],
  "irrelevantImages": ["[IMG_4]"],
  "pageNumber": ${page.page}
}

Rules:
- Extract questions in order as numbered on the page
- Be precise with mathematical notation
- You must use the red [IMG_X] labels exactly as they appear on the page!
- Return ONLY valid JSON, no markdown fences`;

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
              console.warn(`[extractIqPdf] Rate limit hit on page ${page.page} (status ${visionRes.status}). Retrying in ${waitMs/1000}s... Error: ${errText.slice(0,100)}`);
              await new Promise(r => setTimeout(r, waitMs));
              retryCount++;
              continue; // Try again
            }

            console.error(`[extractIqPdf] Vision API error for page ${page.page}: status=${visionRes.status}`, errText);
            break; // Break the while loop on fatal errors (e.g. 401 auth error)
          }

          const visionPayload = await visionRes.json() as any;
          let responseText = visionPayload.choices?.[0]?.message?.content?.trim();
          
          if (!responseText) {
            console.warn(`[extractIqPdf] Empty response for page ${page.page}`);
            break;
          }

          console.log(`[extractIqPdf] Page ${page.page} response length: ${responseText.length} chars`);

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
                console.warn(`[extractIqPdf] Failed to parse vision response for page ${page.page}. First 500 chars:`, responseText.slice(0, 500));
                break;
              }
            } else {
              console.warn(`[extractIqPdf] Could not parse response for page ${page.page}. First 500 chars:`, responseText.slice(0, 500));
              break;
            }
          }
        } catch (err) {
          console.error(`[extractIqPdf] Error processing page ${page.page}:`, err);
          break; // Network errors
        }
      }

      if (success) {
        console.log(`[extractIqPdf] Page ${page.page}: extracted ${pageQuestions.length} questions`);
        pageQuestions.forEach((q: any) => {
          q.pageNumber = page.page;
        });
        allQuestions.push(...pageQuestions);
      } else {
        console.warn(`[extractIqPdf] Failed to extract questions from page ${page.page} after ${retryCount} retries.`);
      }
    }

    if (allQuestions.length === 0) {
      throw new Error("No questions could be extracted from the PDF. The vision model could not identify any MCQs.");
    }

    // ─── Step 4: Build final question objects with answers & images ──────────
    console.log(`[extractIqPdf] Building ${allQuestions.length} question objects...`);

    // Combine all page image dictionaries into one map
    const imageMap: Record<string, string> = {};
    for (const pi of allPageImages) {
      if (pi.images && typeof pi.images === 'object' && !Array.isArray(pi.images)) {
        Object.assign(imageMap, pi.images);
      }
    }

    // Helper to robustly extract [IMG_X] key even if AI missed brackets
    const getImgKey = (str: string) => {
      const match = str.match(/IMG_\d+/);
      return match ? `[${match[0]}]` : null;
    };

    // Pre-calculate which images were used in choices to find unused/orphan images
    const usedImages = new Set<string>();
    allQuestions.forEach((q: any) => {
      const choices = Array.isArray(q.choices) ? q.choices : [];
      choices.forEach((choice: string) => {
        const key = getImgKey(choice);
        if (key) usedImages.add(key);
      });
    });

    // Group unused images by page
    const pageToUnusedImages: Record<number, string[]> = {};
    for (const pi of allPageImages) {
      const pageKeys = Object.keys(pi.images || {});
      pageToUnusedImages[pi.page] = pageKeys.filter(k => !usedImages.has(k));
    }

    const formattedQuestions = allQuestions.map((q: any, i: number) => {
      const choices: string[] = Array.isArray(q.choices) ? q.choices : [];
      const qNum = typeof q.questionNumber === "number" ? q.questionNumber : i + 1;

      // Assign extracted images to placeholders in choices robustly
      const finalChoices = choices.map((choice: string) => {
        const key = getImgKey(choice);
        if (key && imageMap[key]) {
          return imageMap[key]; // Replace entire choice with base64 string
        }
        return choice;
      });

      // Determine correct answer from answer map
      let correctChoiceIndex = -1;
      const answerLetter = answerMap[qNum];
      if (answerLetter) {
        const idx = answerLetter.charCodeAt(0) - "A".charCodeAt(0);
        if (idx >= 0 && idx < finalChoices.length) {
          correctChoiceIndex = idx;
        }
      }

      const blocks: any[] = [];
      let rawText = q.promptRawText || "";
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
        }
      };

      // Add images from explicit labels (robust match)
      for (const m of imgLabels) {
        if (typeof m === 'string') {
          const key = getImgKey(m);
          if (key && imageMap[key]) {
            addBlockIfNew(key);
            // Mark as used so aggressive fallback doesn't duplicate it
            const idx = pageToUnusedImages[q.pageNumber]?.indexOf(key);
            if (idx > -1) pageToUnusedImages[q.pageNumber].splice(idx, 1);
          }
        }
      }

      // Add fallback images found in text
      if (textImgMatches) {
        for (const m of textImgMatches) {
          const key = getImgKey(m);
          if (key && imageMap[key]) {
            addBlockIfNew(key);
            const idx = pageToUnusedImages[q.pageNumber]?.indexOf(key);
            if (idx > -1) pageToUnusedImages[q.pageNumber].splice(idx, 1);
          }
        }
      }

      // We no longer aggressively inject unused images because the AI is explicitly categorizing irrelevant images.
      // We rely completely on promptImageLabels and the text fallback above.

      return {
        promptRawText: rawText,
        promptBlocks: blocks,
        interaction: {
          type: "mcq",
          choices: finalChoices,
          correctChoiceIndex,
        },
        hasQuestionImage: q.hasQuestionImage || false,
        pageNumber: q.pageNumber,
        questionNumber: qNum,
      };
    });

    console.log(`[extractIqPdf] Done! Extracted ${formattedQuestions.length} questions, ${Object.keys(answerMap).length} answers applied.`);
    res.json({ questions: formattedQuestions });

  } catch (error) {
    console.error("extractIqPdf error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: message });
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
    console.error("generateIqQuestionDetails error:", error);
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
