/**
 * Local OCR Pipeline — Phase 1
 * ================================
 * Calls the local Python OCR server (tools/ocr/ocr_server.py) running at
 * http://localhost:5100 — no cloud API needed.
 *
 * The server uses:
 *   • PyMuPDF  — for digital PDFs with an embedded text layer (fast & perfect)
 *   • Tesseract OCR — fallback for scanned pages / image-based PDFs and photos
 *
 * Phase output is written to:
 *   <project_root>/output_phase_1.json
 *
 * and also returned to the browser as JSON.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PipelineDebugLog {
  createdAt: string;
  fileName: string;
  title: string;
  phases: {
    phase1_ocr?: Phase1OcrResult;
    phase2_questions?: Phase2QuestionsResult;
    phase3_organized?: Phase3OrganizedResult;
    phase4_interactive?: Phase4InteractiveResult;
  };
}

export interface Phase1OcrResult {
  completedAt: string;
  rawText: string;
  pageCount: number;
  pages: Array<{
    page: number;
    method: 'pymupdf_text_layer' | 'tesseract_ocr';
    char_count: number;
    text: string;
  }>;
  methodsUsed: string[];
  source: {
    fileName: string;
    title: string;
    mimeType: string;
    sizeBytes: number;
  };
}

export interface Phase2QuestionsResult {
  completedAt: string;
  topics: Array<{
    id: string;
    title: string;
    questions: DetectedQuestion[];
  }>;
}

export interface DetectedQuestion {
  id: string;
  label?: string;
  rawText: string;
  page?: number;
  // Phase 2 additions
  answerFromPdf?: boolean;
  rawAnswerText?: string | null;
  modelAnswer?: string;
  // Phase 3 additions (set after enrichment)
  solution?: string;
  solutionPlan?: string;
  hint?: string;
  gradingSchema?: GradingCriterion[];
}

export interface GradingCriterion {
  criterion: string;
  points: number;
  deductionOnError: string;
}

export interface Phase3OrganizedResult {
  completedAt: string;
  topics: OrganizedTopic[];
}

export interface OrganizedTopic {
  id: string;
  title: string;
  questionIds: string[];
}

export interface Phase4InteractiveResult {
  completedAt: string;
  questions: InteractiveQuestion[];
}

export interface InteractiveQuestion {
  id: string;
  rawText: string;
  promptBlocks: Array<{ type: 'text' | 'math'; text?: string; latex?: string }>;
  interaction: {
    type: 'freeform' | 'numeric' | 'mcq';
    [key: string]: unknown;
  };
  difficulty: 'easy' | 'medium' | 'hard';
  solution?: string | null;
  hint?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OCR_SERVER_URL = import.meta.env.VITE_OCR_SERVER_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
  ? `http://${window.location.hostname}:5100`
  : 'http://127.0.0.1:5100');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a File to base64 (without the data-URL prefix) */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

// ─── Health check ────────────────────────────────────────────────────────────

export async function checkOcrServerHealth(): Promise<{
  ok: boolean;
  tesseractAvailable: boolean;
  pymupdfVersion: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${OCR_SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, tesseractAvailable: false, pymupdfVersion: '', error: `HTTP ${res.status}` };
    const data = await res.json() as { status: string; tesseract_available: boolean; pymupdf_version: string };
    return {
      ok: data.status === 'ok',
      tesseractAvailable: data.tesseract_available,
      pymupdfVersion: data.pymupdf_version,
    };
  } catch (err) {
    return {
      ok: false,
      tesseractAvailable: false,
      pymupdfVersion: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Phase 1: OCR ────────────────────────────────────────────────────────────

/**
 * Phase 1 – OCR
 *
 * Sends the file to the local Python OCR server. The server:
 *   1. Uses PyMuPDF to read the text layer of each PDF page
 *   2. Falls back to Tesseract OCR for pages with insufficient text (scanned)
 *   3. Writes the full result to output_phase_1.json at the project root
 *
 * @param file        The PDF or image file to process
 * @param title       Human-readable title for the program
 * @param onProgress  Optional callback to receive status messages
 */
export async function runPhase1Ocr(
  file: File,
  title: string,
  onProgress?: (msg: string) => void,
  forceOcr?: boolean
): Promise<Phase1OcrResult> {
  onProgress?.('🔍 Checking OCR server...');

  // 1. Health check first — give a clear error if server is not running
  const health = await checkOcrServerHealth();
  if (!health.ok) {
    throw new Error(
      `OCR server is not running at ${OCR_SERVER_URL}.\n\n` +
      `Please start it by running:\n` +
      `  tools\\ocr\\start_ocr_server.bat\n\n` +
      `Error: ${health.error ?? 'connection refused'}`
    );
  }

  onProgress?.(`📄 Server ready (PyMuPDF ${health.pymupdfVersion}, Tesseract: ${health.tesseractAvailable ? '✅' : '❌'}). Converting file...`);

  // 2. Convert file to base64
  const contentBase64 = await fileToBase64(file);

  onProgress?.('⚙️ Running OCR (PyMuPDF + Tesseract)... This may take 10–60 seconds for large files.');

  // 3. Send to OCR server — allow up to 10 minutes for heavy pix2text inference
  const payload = {
    fileName: file.name,
    mimeType: file.type || 'application/pdf',
    contentBase64,
    title,
    forceOcr: !!forceOcr
  };
  const response = await fetch(`${OCR_SERVER_URL}/ocr/phase1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(600_000), // 10-minute timeout for large/math-heavy PDFs
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `OCR server error (HTTP ${response.status})`;
    try {
      const errJson = JSON.parse(errText) as { error?: string };
      if (errJson.error) errMsg = errJson.error;
    } catch { /* ignore */ }
    throw new Error(errMsg);
  }

  const data = await response.json() as {
    phase: string;
    created_at: string;
    source: { file_name: string; title: string; mime_type: string; size_bytes: number };
    result: {
      pages: Array<{ page: number; method: string; char_count: number; text: string }>;
      full_text: string;
      page_count: number;
      methods_used: string[];
    };
    debug: { tesseract_available: boolean; pymupdf_version: string };
  };

  onProgress?.(`✅ OCR complete! ${data.result.page_count} page(s) extracted. Methods: ${data.result.methods_used.join(', ')}`);

  return {
    completedAt: new Date().toISOString(),
    rawText: data.result.full_text,
    pageCount: data.result.page_count,
    pages: data.result.pages as Phase1OcrResult['pages'],
    methodsUsed: data.result.methods_used,
    source: {
      fileName: data.source.file_name,
      title: data.source.title,
      mimeType: data.source.mime_type,
      sizeBytes: data.source.size_bytes,
    },
  };
}

// ─── Phase 2: Questions Extraction ──────────────────────────────────────────────

/**
 * Phase 2 – Questions Extraction
 *
 * Sends the parsed OCR text to the local Python server, which uses Groq
 * to extract exactly written questions into JSON format.
 *
 * @param text        The full extracted text from Phase 1
 * @param onProgress  Optional callback to receive status messages
 */
export async function runPhase2Questions(
  text: string,
  onProgress?: (msg: string) => void,
): Promise<Phase2QuestionsResult> {
  onProgress?.('🧠 Running Phase 2: Extracting questions using Groq API...');

  const response = await fetch(`${OCR_SERVER_URL}/ocr/phase2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `Phase 2 error (HTTP ${response.status})`;
    try {
      const errJson = JSON.parse(errText) as { error?: string };
      if (errJson.error) errMsg = errJson.error;
    } catch { /* ignore */ }
    throw new Error(errMsg);
  }

  const data = await response.json() as {
    phase: string;
    created_at: string;
    result: { topics: Phase2QuestionsResult['topics'] };
  };

  const qCount = data.result.topics?.reduce((sum, t) => sum + (t.questions?.length || 0), 0) || 0;
  onProgress?.(`✅ Phase 2 complete! Found ${qCount} question(s) across ${data.result.topics?.length || 0} topic(s).`);

  return {
    completedAt: data.created_at,
    topics: data.result.topics || [],
  };
}

// ─── Phase 3: Question Enrichment (direct Groq call) ─────────────────────────

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Use the fast 8B model for Phase 3 — it has a 500k token/day limit vs 100k
// for the 70B model, preventing it from exhausting the shared daily budget
// that Phase 2 (Python OCR server) also draws from.
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function buildEnrichmentPrompt(questionText: string, modelAnswer: string): string {
  return (
    'You are an expert tutor. Analyze this question and correct answer.\n\n' +
    'QUESTION:\n' + questionText + '\n\n' +
    'CORRECT ANSWER:\n' + modelAnswer + '\n\n' +
    'Return JSON with these exact keys: solution, solutionPlan, hint, gradingSchema.\n' +
    'solution: Concise step-by-step worked solution (max 150 words).\n' +
    'solutionPlan: High-level bullet plan, NO details, 3-5 bullets.\n' +
    'hint: Single hint that nudges WITHOUT giving the answer.\n' +
    'gradingSchema: array of 2-5 criteria objects, points must sum to 100.\n\n' +
    'CRITICAL: You MUST write the solution, solutionPlan, hint, and gradingSchema in the EXACT SAME LANGUAGE as the provided question and answer text. If the question is in French, all your output must be in French. Do not translate into English.\n' +
    'CRITICAL: You MUST wrap all math, equations, and symbols in $...$ (inline) or $$...$$ (display) delimiters.'
  );
}

/**
 * Repair a JSON string that Groq may have produced with:
 *  1. Literal control characters inside string values (e.g. raw newlines)
 *  2. Invalid escape sequences inside string values (e.g. \$ \( \{ from LaTeX)
 *
 * Walks the raw text character-by-character, tracking whether we are inside
 * a quoted string so that structural whitespace is left untouched.
 */
function sanitizeJson(raw: string): string {
  // Characters that are valid after \ inside a JSON string
  const VALID_AFTER_BACKSLASH = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);
  const CTRL_ESCAPE: Record<string, string> = {
    '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f',
  };

  let out = '';
  let inString = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      i++;
      continue;
    }

    // ── inside a JSON string ──────────────────────────────────────────────
    if (ch === '\\') {
      const next = raw[i + 1] ?? '';

      if (next === 'u') {
        // \uXXXX — validate 4 hex digits
        const hex = raw.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += '\\u' + hex;
          i += 6;
        } else {
          // bad \u — double the backslash and re-process from next char
          out += '\\\\';
          i++;
        }
        continue;
      }

      if (VALID_AFTER_BACKSLASH.has(next)) {
        // valid escape sequence — pass through unchanged
        out += '\\' + next;
        i += 2;
      } else {
        // invalid escape (e.g. \$, \(, \{, \|) — double the backslash
        // so it becomes a literal backslash character in the parsed string
        out += '\\\\';
        i++; // consume only the backslash; next char is processed normally
      }
      continue;
    }

    if (ch === '"') {
      // end of string
      inString = false;
      out += ch;
      i++;
      continue;
    }

    const code = raw.charCodeAt(i);
    if (code <= 0x1F) {
      // literal control character inside a string — escape it
      out += CTRL_ESCAPE[ch] ?? `\\u${code.toString(16).padStart(4, '0')}`;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}


/** Sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function enrichOneQuestion(
  questionText: string,
  modelAnswer: string,
  answerFromPdf: boolean,
  apiKey: string,
  retries = 4,
): Promise<{
  solution: string;
  solutionPlan: string;
  hint: string;
  gradingSchema: GradingCriterion[];
  modelAnswer: string;
  answerFromPdf: boolean;
}> {
  let lastErr: unknown;
  let delay = 8000; // start at 8s on first 429

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 1500,
        messages: [
          { role: 'system', content: 'Output only valid JSON with keys: solution, solutionPlan, hint, gradingSchema. BE CONCISE.' },
          { role: 'user', content: buildEnrichmentPrompt(questionText, modelAnswer) },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    // Rate-limited or temporarily unavailable — wait and retry
    if (response.status === 429 || response.status === 503) {
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : delay;
      console.warn(`[Phase 3] ${response.status} — waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${retries}`);
      await sleep(waitMs);
      delay = Math.min(delay * 2, 60000); // cap at 60s
      lastErr = new Error(`Groq enrichment failed: ${response.status}`);
      continue;
    }


    if (!response.ok) {
      const errText = await response.text();
      console.error(`Groq 400 error payload:`, errText);
      throw new Error(`Groq enrichment failed: ${response.status} - ${errText}`);
    }

    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    let raw = (payload.choices?.[0]?.message?.content ?? '').trim();
    // Strip markdown fences
    if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    // Sanitise control characters before parsing
    raw = sanitizeJson(raw);

    const parsed = JSON.parse(raw) as {
      solution?: string; solutionPlan?: string; hint?: string; gradingSchema?: GradingCriterion[];
    };

    const schema = (parsed.gradingSchema ?? []).filter(
      (c) => typeof c.criterion === 'string' && typeof c.points === 'number',
    );

    // Normalise points to sum to 100
    const total = schema.reduce((s, c) => s + c.points, 0);
    if (total !== 100 && total > 0) {
      const factor = 100 / total;
      let remaining = 100;
      schema.forEach((c, i) => {
        if (i < schema.length - 1) { c.points = Math.round(c.points * factor); remaining -= c.points; }
        else { c.points = remaining; }
      });
    }

    return {
      solution: parsed.solution ?? ('The correct answer is: ' + modelAnswer),
      solutionPlan: parsed.solutionPlan ?? 'Understand, apply method, verify',
      hint: parsed.hint ?? 'Re-read the question and identify the method.',
      gradingSchema: schema.length > 0
        ? schema
        : [{ criterion: 'Correct answer', points: 100, deductionOnError: 'All marks deducted' }],
      modelAnswer,
      answerFromPdf,
    };
  }

  throw lastErr ?? new Error('Groq enrichment failed after retries');
}

/**
 * Phase 3 – Question Enrichment (runs directly in the browser via Groq API)
 *
 * Calls Groq with VITE_GROQ_API_KEY to generate step-by-step solutions,
 * grading schemas, and hints for each question. No API server required.
 *
 * @param topics       The topics+questions output from Phase 2
 * @param onProgress   Optional progress callback
 */
export async function runPhase3Enrichment(
  topics: Phase2QuestionsResult['topics'],
  onProgress?: (msg: string) => void,
): Promise<Phase2QuestionsResult['topics']> {
  // Collect all questions, generating stable ids for any that are missing one
  const allQuestions: Array<{ id: string; rawText: string; modelAnswer: string; answerFromPdf: boolean }> = [];
  let autoIdx = 0;
  for (const topic of topics) {
    for (const q of topic.questions) {
      allQuestions.push({
        id: q.id ?? `auto_${autoIdx++}`,
        rawText: q.rawText ?? '',
        modelAnswer: q.modelAnswer ?? '',
        answerFromPdf: q.answerFromPdf ?? false,
      });
    }
  }

  if (allQuestions.length === 0) return topics;

  const apiKey = (import.meta.env.VITE_GROQ_API_KEY as string | undefined)?.trim();
  if (!apiKey) {
    console.warn('[Phase 3] VITE_GROQ_API_KEY not set — skipping enrichment.');
    return topics;
  }

  onProgress?.(`⚙️ Phase 3: Generating solutions & grading schemas for ${allQuestions.length} question(s)...`);

  const enriched: Record<string, {
    solution: string; solutionPlan: string; hint: string;
    gradingSchema: GradingCriterion[]; modelAnswer: string; answerFromPdf: boolean;
  }> = {};

  // Process ONE at a time with a gap to avoid Groq rate limits (6000 TPM limit)
  let done = 0;
  for (const q of allQuestions) {
    try {
      if (done > 0) await sleep(15000); // 15s between requests to stay under 6000 TPM limit
      enriched[q.id] = await enrichOneQuestion(q.rawText, q.modelAnswer, q.answerFromPdf, apiKey);
    } catch (err) {
      console.error('[Phase 3] Failed for ' + q.id + ':', err);
      enriched[q.id] = {
        solution: 'The correct answer is: ' + q.modelAnswer,
        solutionPlan: 'Understand, apply method, verify',
        hint: 'Re-read the question.',
        gradingSchema: [{ criterion: 'Correct answer', points: 100, deductionOnError: 'All marks deducted' }],
        modelAnswer: q.modelAnswer,
        answerFromPdf: q.answerFromPdf,
      };
    }
    done++;
    onProgress?.(`⚙️ Phase 3: Enriched ${done}/${allQuestions.length} question(s)...`);
  }

  // Build a lookup from original q.id to the auto-assigned id we used
  // so we can match back even when q.id was undefined
  let autoLookupIdx = 0;
  const idMap = new Map<string | undefined, string>();
  for (const topic of topics) {
    for (const q of topic.questions) {
      const assignedId = q.id ?? `auto_${autoLookupIdx++}`;
      idMap.set(q.id, assignedId);
    }
  }

  // Merge enrichment data back into each question
  const enrichedTopics = topics.map((topic) => ({
    ...topic,
    questions: topic.questions.map((q) => {
      const assignedId = idMap.get(q.id) ?? q.id;
      const e = assignedId != null ? enriched[assignedId] : undefined;
      if (!e) return q;
      return { ...q, solution: e.solution, solutionPlan: e.solutionPlan, hint: e.hint, gradingSchema: e.gradingSchema };
    }),
  }));

  onProgress?.(`✅ Phase 3 complete! Solutions and grading schemas generated.`);
  return enrichedTopics;
}

// ─── Phase 2 (Category-Aware): Extract + Classify Questions ─────────────────

export interface ExtractedQuestion {
  id: string;
  rawText: string;
  modelAnswer: string;
  answerFromPdf: boolean;
}

export interface ClassificationResult {
  questions: Array<{
    question: ExtractedQuestion;
    suggestedCategory: string; // category name (matches one of the provided category names)
    confidence: 'high' | 'medium' | 'low';
  }>;
}

/**
 * Phase 2 (Category-Aware) — Extract questions from OCR text with smart
 * sub-question grouping, then classify into the provided category names.
 *
 * Sub-question grouping rules:
 *  - If sub-questions share a common main prompt (e.g. "On tire ensemble cartes...")
 *    treat the whole exercise as ONE question unit.
 *  - If sub-questions are independent statements that can stand alone
 *    (e.g. true/false items, independent fill-in-the-blank), split them.
 */
export async function extractAndClassifyQuestions(
  ocrText: string,
  categoryNames: string[],
  onProgress?: (msg: string) => void,
): Promise<ClassificationResult> {
  onProgress?.('🤖 Extracting questions from document...');

  // Step A: extract questions via the OCR server (same as Phase 2)
  const phase2Result = await runPhase2Questions(ocrText, onProgress);

  // Flatten all detected questions across topics
  const allQuestions: ExtractedQuestion[] = [];
  for (const topic of phase2Result.topics) {
    for (const q of topic.questions) {
      allQuestions.push({
        id: q.id,
        rawText: q.rawText,
        modelAnswer: q.modelAnswer ?? '',
        answerFromPdf: q.answerFromPdf ?? false,
      });
    }
  }

  if (allQuestions.length === 0) {
    onProgress?.('⚠️ No questions found in document.');
    return { questions: [] };
  }

  onProgress?.(`🏷️ Classifying ${allQuestions.length} question(s) into categories: ${categoryNames.join(', ')}...`);

  const apiKey = (import.meta.env.VITE_GROQ_API_KEY as string | undefined)?.trim();
  if (!apiKey) {
    console.warn('[Classification] VITE_GROQ_API_KEY not set — assigning all to first category.');
    return {
      questions: allQuestions.map((q) => ({
        question: q,
        suggestedCategory: categoryNames[0] ?? 'Uncategorized',
        confidence: 'low' as const,
      })),
    };
  }

  const categoriesJson = JSON.stringify(categoryNames);
  const questionsJson = JSON.stringify(
    allQuestions.map((q, i) => ({ index: i, text: q.rawText.slice(0, 400) })),
    null,
    2,
  );

  const classifyPrompt =
    `You are an expert teacher. Classify each of the following questions into exactly one of these categories:\n` +
    `CATEGORIES: ${categoriesJson}\n\n` +
    `QUESTIONS:\n${questionsJson}\n\n` +
    `Rules:\n` +
    `1. For each question, pick the most appropriate category from the list above.\n` +
    `2. Only use category names from the provided list — do NOT invent new ones.\n` +
    `3. If a question could fit multiple categories, pick the best match.\n` +
    `4. Return a JSON array with objects: { "index": <number>, "category": "<category name>", "confidence": "high"|"medium"|"low" }\n` +
    `Return ONLY the JSON array, no other text.`;

  let classified: Array<{ index: number; category: string; confidence: string }> = [];

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: 'Output only valid JSON. No markdown fences.' },
          { role: 'user', content: classifyPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (response.ok) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      let raw = (payload.choices?.[0]?.message?.content ?? '').trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      raw = sanitizeJson(raw);
      // Groq with json_object mode may wrap in {"result": [...]} — handle both
      const parsed = JSON.parse(raw);
      classified = Array.isArray(parsed) ? parsed : (parsed.result ?? parsed.classifications ?? []);
    }
  } catch (err) {
    console.error('[Classification] Groq call failed:', err);
  }

  // Build lookup: index → suggested category
  const lookup = new Map<number, { category: string; confidence: string }>();
  for (const item of classified) {
    if (typeof item.index === 'number' && typeof item.category === 'string') {
      lookup.set(item.index, { category: item.category, confidence: item.confidence ?? 'medium' });
    }
  }

  onProgress?.('✅ Classification complete!');

  return {
    questions: allQuestions.map((q, i) => {
      const found = lookup.get(i);
      const rawCat = found?.category ?? '';
      // Validate the category name — fall back to first available if unknown
      const suggestedCategory = categoryNames.includes(rawCat)
        ? rawCat
        : (categoryNames[0] ?? 'Uncategorized');
      return {
        question: q,
        suggestedCategory,
        confidence: (['high', 'medium', 'low'].includes(found?.confidence ?? '')
          ? found!.confidence
          : 'low') as 'high' | 'medium' | 'low',
      };
    }),
  };
}

// ─── Debug Log Utilities ─────────────────────────────────────────────────────

export function createDebugLog(fileName: string, title: string): PipelineDebugLog {
  return {
    createdAt: new Date().toISOString(),
    fileName,
    title,
    phases: {},
  };
}

/**
 * NOTE: The canonical output file is output_phase_1.json written by the Python
 * server at the project root. This browser-side helper is only for convenience
 * if you want a second copy in your Downloads folder.
 */
export function saveDebugLogToFile(log: PipelineDebugLog): void {
  const json = JSON.stringify(log, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = log.title.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.download = `ocr_debug_${safeName}_${ts}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
