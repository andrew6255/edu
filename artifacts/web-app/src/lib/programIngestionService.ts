export type ProgramIngestionVisibility = 'public' | 'private';
export type ProgramIngestionStage = 'extractDocument' | 'auditExtraction' | 'segmentQuestions' | 'normalizeQuestions' | 'structureDraft';
export type IngestionJobStatus = 'uploaded' | 'extracting' | 'auditing' | 'structuring' | 'segmenting' | 'normalizing' | 'reviewing' | 'ready' | 'failed' | 'published';
export type ReviewStatus = 'ai_ok' | 'needs_review' | 'fixed_by_admin';

export interface CreateProgramIngestionJobInput {
  adminUserId: string;
  visibility: ProgramIngestionVisibility;
  sourceFileName: string;
  classId?: string | null;
  title?: string;
  gradeBand?: string | null;
  adminNote?: string;
}

export interface CreateProgramIngestionJobResult {
  jobId: string;
  draftId: string;
  status: string;
}

export interface IngestionJobSummary {
  jobId: string;
  draftId: string;
  status: IngestionJobStatus;
  stage: string | null;
  visibility: ProgramIngestionVisibility;
  sourceFileName: string;
  title: string;
  updatedAt: string;
}

export interface IngestionQuestion {
  id: string;
  jobId: string;
  draftId: string;
  nodeId: string | null;
  questionOrder: number;
  normalizedQuestion: Record<string, unknown> | null;
  rawExtractedBlock: { id: string; page: number; rawText: string; questionLabel?: string; notes?: string[] };
  confidence: number | null;
  reviewStatus: ReviewStatus;
  flags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface IngestionJobState {
  job: {
    id: string;
    status: IngestionJobStatus;
    stage: string | null;
    sourceFileName: string;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  };
  draft: {
    id: string;
    title: string;
    subject: string;
    gradeBand: string | null;
    draftStatus: string;
    hierarchy?: Array<{ id: string; type: string; title: string; children: Array<{ id: string; type: string; title: string; children: unknown[]; questionRefs?: string[] }>; questionRefs?: string[] }>;
    aiSessionMeta?: { model?: string; lastRunAt?: string; summary?: string } | null;
    extractedDocument?: { pages?: Array<{ page: number; fullText?: string | null }> } | null;
    extractionReport: {
      quality: string;
      titleGuess?: string;
      subjectGuess?: string;
      warnings: Array<{ code: string; severity: string; message: string }>;
    } | null;
  };
  questions: IngestionQuestion[];
  messages: unknown[];
  assets: unknown[];
}

function getProgramIngestionApiBase(): string {
  let explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  if (explicit && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    explicit = explicit.replace('localhost', window.location.hostname);
  }
  const base = explicit && explicit.length > 0 ? explicit.replace(/\/+$/, '') : '';
  return `${base}/api/program-ingestion`;
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected file reader result.'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] ?? '' : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

async function expectJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      const endpoint = (() => { try { return new URL(response.url).pathname; } catch { return response.url; } })();
      const returnedHtml = /^\s*(?:<!doctype|<html)/i.test(text);
      const explanation = returnedHtml
        ? `The API returned an HTML page for ${endpoint}. The API server is probably running an older build without this endpoint, or the request was sent to the frontend server. Restart the API server and try again.`
        : `The API returned a non-JSON response for ${endpoint}.`;
      throw new Error(`${explanation} (HTTP ${response.status})`);
    }
  }
  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function createProgramIngestionJob(input: CreateProgramIngestionJobInput): Promise<CreateProgramIngestionJobResult> {
  const response = await fetch(getProgramIngestionApiBase(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return expectJson<CreateProgramIngestionJobResult>(response);
}

export async function uploadProgramIngestionSource(jobId: string, file: File): Promise<{ assetId: string; path: string; mimeType: string | null }> {
  const contentBase64 = await readFileAsBase64(file);
  const response = await fetch(`${getProgramIngestionApiBase()}/${encodeURIComponent(jobId)}/source`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      contentBase64,
    }),
  });
  return expectJson<{ assetId: string; path: string; mimeType: string | null }>(response);
}

export async function runProgramIngestionStage(jobId: string, stage: ProgramIngestionStage): Promise<{ jobId: string; status: string; stage: string }> {
  const response = await fetch(`${getProgramIngestionApiBase()}/${encodeURIComponent(jobId)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage }),
  });
  return expectJson<{ jobId: string; status: string; stage: string }>(response);
}

export async function listProgramIngestionJobs(): Promise<IngestionJobSummary[]> {
  const response = await fetch(getProgramIngestionApiBase());
  const data = await expectJson<{ jobs: IngestionJobSummary[] }>(response);
  return data.jobs;
}

export async function getProgramIngestionJob(jobId: string): Promise<IngestionJobState> {
  const response = await fetch(`${getProgramIngestionApiBase()}/${encodeURIComponent(jobId)}`);
  return expectJson<IngestionJobState>(response);
}

export async function updateIngestionQuestion(
  jobId: string,
  questionId: string,
  updates: { reviewStatus?: ReviewStatus; normalizedQuestion?: Record<string, unknown> },
): Promise<void> {
  const response = await fetch(`${getProgramIngestionApiBase()}/${encodeURIComponent(jobId)}/questions/${encodeURIComponent(questionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  await expectJson<unknown>(response);
}

export async function publishIngestionJob(jobId: string): Promise<{ programId: string }> {
  const response = await fetch(`${getProgramIngestionApiBase()}/${encodeURIComponent(jobId)}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return expectJson<{ programId: string }>(response);
}

export async function generateEmojiWithLlm(name: string, subject: string): Promise<string> {
  const response = await fetch(`${getProgramIngestionApiBase()}/emoji`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, subject }),
  });
  const data = await expectJson<{ emoji: string }>(response);
  return data.emoji;
}

export type QuestionPdfProgress = {
  icon: string;
  message: string;
  detail?: string;
  stats?: {
    stage?: 'rendering' | 'answers' | 'extracting' | 'building' | 'reviewing' | 'auditing' | 'complete';
    stageCurrent?: number;
    stageTotal?: number;
    totalFiles?: number;
    processedFiles?: number;
    totalPages?: number;
    currentPage?: number;
    totalQuestions?: number;
    answersFound?: number;
    retry?: number;
    operation?: string;
    model?: string;
    fileName?: string;
    page?: number;
    attempt?: number;
    maxAttempts?: number;
    operationElapsedMs?: number;
    httpStatus?: number;
    rateLimitWaitSeconds?: number;
    requestTimeoutSeconds?: number;
    lastError?: string;
  };
  sequence?: number;
  serverTime?: string;
  elapsedMs?: number;
};

export type QuestionExtractionJob = {
  id: string;
  programId: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  progress: QuestionPdfProgress | null;
  history: QuestionPdfProgress[];
  result: Record<string, unknown> | null;
  error: string | null;
};

/**
 * Runs the audited document extractor with one or more question sources and
 * any number of marking-scheme sources. The endpoint streams JSONL updates.
 */
export async function extractQuestionPdfs(
  questionFiles: File[],
  answerFiles: File[],
  onProgress?: (progress: QuestionPdfProgress) => void,
  job?: { id: string; programId: string },
): Promise<Record<string, unknown>> {
  const form = new FormData();
  for (const questionFile of questionFiles) form.append('file', questionFile);
  for (const answerFile of answerFiles) form.append('answersFile', answerFile);
  if (job) {
    form.append('jobId', job.id);
    form.append('programId', job.programId);
  }

  const extractionUrl = `${getProgramIngestionApiBase()}/extract-iq-pdf`;
  let response: Response;
  try {
    response = await fetch(extractionUrl, { method: 'POST', body: form });
  } catch (error) {
    throw new Error(`Could not reach the question extraction service at ${extractionUrl}. Make sure the local API server is running.${error instanceof Error ? ` (${error.message})` : ''}`);
  }
  if (!response.ok || !response.body) {
    throw new Error((await response.text()) || `Question extraction failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: Record<string, unknown> | null = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { progress?: QuestionPdfProgress; error?: string; result?: Record<string, unknown> } & Record<string, unknown>;
      if (event.error) throw new Error(event.error);
      if (event.progress) onProgress?.(event.progress);
      if (event.result) finalResult = event.result;
      else if (!event.progress) finalResult = event;
    }
    if (done) break;
  }
  if (!finalResult) throw new Error('Question extraction completed without a result.');
  return finalResult;
}

export async function getQuestionExtractionJob(jobId: string): Promise<QuestionExtractionJob> {
  const response = await fetch(`${getProgramIngestionApiBase()}/extract-iq-pdf/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
  return expectJson<QuestionExtractionJob>(response);
}

export async function cancelQuestionExtractionJob(jobId: string): Promise<QuestionExtractionJob> {
  const response = await fetch(`${getProgramIngestionApiBase()}/extract-iq-pdf/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  return expectJson<QuestionExtractionJob>(response);
}

export type OrganizerTreeNode = { id: string; title: string; kind: 'folder' | 'category'; children: OrganizerTreeNode[] };
export type OrganizerPlacement = { id: string; questionId: string; destinationCategoryId: string; alternativeCategoryIds: string[]; confidence: number; rationale: string; decision: 'pending' | 'approved' | 'rejected' | 'edited' };
export type OrganizerOperation = { id: string; type: 'create_node' | 'rename_node' | 'move_node' | 'reorder_node' | 'delete_node'; decision: 'pending' | 'approved' | 'rejected' | 'edited'; [key: string]: unknown };
export type OrganizerAssessment = { questionId: string; detectedSubject: string; subjectConfidence: number; likelyDuplicateQuestionId: string | null; duplicateConfidence: number };
export type OrganizerResult = { baseRevision: number; previewTree: OrganizerTreeNode[]; operations: OrganizerOperation[]; placements: OrganizerPlacement[]; assessments: OrganizerAssessment[]; summary: string; provider: string };

export async function organizeProgramQuestions(input: {
  programId: string;
  programSubject: string;
  baseRevision: number;
  currentTree: OrganizerTreeNode[];
  incomingQuestions: Array<{ id: string; text: string; answerText?: string; flags?: string[] }>;
  existingQuestions?: Array<{ id: string; text: string; answerText?: string }>;
}): Promise<OrganizerResult> {
  const response = await fetch(`${getProgramIngestionApiBase()}/organize-questions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  return expectJson<OrganizerResult>(response);
}
