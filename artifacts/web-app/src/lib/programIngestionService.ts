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
  const explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
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
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}`;
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
