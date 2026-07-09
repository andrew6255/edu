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
  const response = await fetch(`${OCR_SERVER_URL}/ocr/phase1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(600_000), // 10-minute timeout for large/math-heavy PDFs
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      contentBase64,
      title,
    }),
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

// ─── Phase 3: Question Enrichment ────────────────────────────────────────────

/**
 * Returns the API server base URL, replacing 'localhost' with the actual
 * window hostname when running outside of localhost (e.g. on GitHub Pages).
 * Falls back gracefully to an empty string so fetch errors are caught below.
 */
function getPhase3ApiBase(): string {
  let url = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim() ?? '';
  if (url && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    url = url.replace('localhost', window.location.hostname);
  }
  return url.replace(/\/+$/, '');
}

/**
 * Phase 3 – Question Enrichment
 *
 * For each question type topic, sends all questions to the api-server which
 * calls Groq to generate: step-by-step solutions, grading schemas, and hints.
 *
 * @param topics       The topics+questions output from Phase 2
 * @param onProgress   Optional progress callback
 */
export async function runPhase3Enrichment(
  topics: Phase2QuestionsResult['topics'],
  onProgress?: (msg: string) => void,
): Promise<Phase2QuestionsResult['topics']> {
  // Collect all questions across all topics
  const allQuestions: Array<{ id: string; rawText: string; modelAnswer: string; answerFromPdf: boolean }> = [];
  for (const topic of topics) {
    for (const q of topic.questions) {
      allQuestions.push({
        id: q.id,
        rawText: q.rawText,
        modelAnswer: q.modelAnswer ?? '',
        answerFromPdf: q.answerFromPdf ?? false,
      });
    }
  }

  if (allQuestions.length === 0) return topics;

  const apiBase = getPhase3ApiBase();
  if (!apiBase) {
    console.warn('[Phase 3] No API server URL configured — skipping enrichment.');
    return topics;
  }

  onProgress?.(`⚙️ Phase 3: Generating solutions & grading schemas for ${allQuestions.length} question(s)...`);

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/program-ingestion/enrich-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions: allQuestions }),
    });
  } catch (networkErr) {
    console.warn('[Phase 3] Network error reaching API server — continuing without enrichment.', networkErr);
    return topics;
  }

  if (!response.ok) {
    const errText = await response.text();
    console.warn('[Phase 3] Enrichment failed:', errText, '— continuing without enrichment.');
    return topics; // Non-fatal: return unenriched topics
  }

  const data = await response.json() as { enriched: Record<string, {
    solution: string;
    solutionPlan: string;
    hint: string;
    gradingSchema: GradingCriterion[];
    modelAnswer: string;
    answerFromPdf: boolean;
  }> };

  const enriched = data.enriched ?? {};

  // Merge enrichment data back into each question
  const enrichedTopics = topics.map((topic) => ({
    ...topic,
    questions: topic.questions.map((q) => {
      const e = enriched[q.id];
      if (!e) return q;
      return { ...q, solution: e.solution, solutionPlan: e.solutionPlan, hint: e.hint, gradingSchema: e.gradingSchema };
    }),
  }));

  onProgress?.(`✅ Phase 3 complete! Solutions and grading schemas generated.`);
  return enrichedTopics;
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
