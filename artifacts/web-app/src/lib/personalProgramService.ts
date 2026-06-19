/**
 * Personal Program Service
 *
 * Handles:
 *  - Creating personal programs from uploaded PDFs/images
 *  - Content-hash deduplication (same file → same program)
 *  - Listing user's personal programs
 *  - Polling processing status
 *  - Per-question whiteboard persistence (save/load strokes)
 */

import { getUserDoc, setUserDoc, listUserDocs, type DocData } from './supabaseDocStore';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type PersonalProgramStatus = 'processing' | 'ready' | 'failed';

/**
 * Granular stage written by the client pipeline at each real async milestone.
 * Used by ProcessingDetailsModal to show true progress.
 */
export type ProcessingStage =
  | 'uploading'          // 10% — saving initial record to Supabase
  | 'ocr'               // 35% — OCR server reading PDF
  | 'extracting_questions' // 65% — AI extracting questions via Groq
  | 'building_program'  // 85% — assembling chapters/topics structure
  | 'saving';           // 95% — writing finished programData to Supabase

export interface PersonalProgramMeta {
  programId: string;
  jobId: string;
  title: string;
  coverEmoji: string;
  status: PersonalProgramStatus;
  /** Granular in-progress stage — only meaningful when status === 'processing' */
  processingStage?: ProcessingStage;
  contentHash: string;
  sourceFileName: string;
  createdAt: string;
  errorMessage?: string;
  /** Once ready, contains the structured program data */
  programData?: PersonalProgramData | null;
}

export interface PersonalProgramQuestion {
  id: string;
  questionLabel?: string;
  rawText: string;
  page: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  context?: string;
  subQuestions?: Array<{
    label?: string;
    rawText: string;
  }>;
  promptBlocks?: Array<{ type: string; text?: string; latex?: string }>;
  normalizedQuestion?: Record<string, unknown> | null;
}

export interface PersonalProgramChapter {
  id: string;
  title: string;
  topics: Array<{
    id: string;
    title: string;
    questionTypeTitle?: string;
    questionIds: string[];
  }>;
}

export interface PersonalProgramData {
  title: string;
  subject: string;
  chapters: PersonalProgramChapter[];
  questions: PersonalProgramQuestion[];
  totalQuestions: number;
}

export interface WhiteboardPageData {
  id: string;
  strokes: unknown[];
  annotations?: unknown[];
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const COLLECTION_PERSONAL_PROGRAMS = 'personal_programs';
const COLLECTION_PERSONAL_WHITEBOARDS = 'personal_whiteboards';

function getApiBase(): string {
  let explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  if (explicit && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    explicit = explicit.replace('localhost', window.location.hostname);
  }
  const base = explicit && explicit.length > 0 ? explicit.replace(/\/+$/, '') : '';
  return `${base}/api/program-ingestion`;
}

// ─── Content Hashing ────────────────────────────────────────────────────────────

export async function computeFileHash(file: File): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fallback on error
    }
  }
  return `fallback-${file.name}-${file.size}-${file.lastModified}`;
}

// ─── Program Creation ───────────────────────────────────────────────────────────

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') { reject(new Error('Unexpected result.')); return; }
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

/**
 * Check if a program with this content hash already exists.
 * Returns the program meta if found, null if not.
 */
export async function findProgramByHash(uid: string, contentHash: string): Promise<PersonalProgramMeta | null> {
  const docs = await listUserDocs(uid, COLLECTION_PERSONAL_PROGRAMS);
  const match = docs.find(d => (d.data as any)?.contentHash === contentHash);
  if (match) return match.data as unknown as PersonalProgramMeta;
  return null;
}

export async function createPersonalProgram(
  uid: string,
  title: string,
  file: File,
): Promise<PersonalProgramMeta> {
  const contentHash = await computeFileHash(file);

  let finalTitle = title || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

  // Enforce unique title
  const docs = await listUserDocs(uid, COLLECTION_PERSONAL_PROGRAMS);
  const existingTitles = new Set(docs.map(d => (d.data as any)?.title));
  
  if (existingTitles.has(finalTitle)) {
    let counter = 1;
    while (existingTitles.has(`${finalTitle} (${counter})`)) {
      counter++;
    }
    finalTitle = `${finalTitle} (${counter})`;
  }

  // Generate a local ID instead of calling the backend
  let jobId: string;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    jobId = crypto.randomUUID();
  } else {
    jobId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  const programId = jobId;

  const meta: PersonalProgramMeta = {
    programId,
    jobId,
    title: finalTitle,
    coverEmoji: '📄',
    status: 'processing',
    contentHash,
    sourceFileName: file.name,
    createdAt: new Date().toISOString(),
  };

  // Store in user_docs
  await setUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, meta.jobId, meta as unknown as DocData);

  return meta;
}

// ─── Program Listing & Status ───────────────────────────────────────────────────

export async function listMyPersonalPrograms(uid: string): Promise<PersonalProgramMeta[]> {
  const docs = await listUserDocs(uid, COLLECTION_PERSONAL_PROGRAMS);
  return docs.map(d => d.data as unknown as PersonalProgramMeta)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/**
 * Poll user_docs for status updates.
 */
export async function refreshPersonalProgramStatus(uid: string, jobId: string): Promise<PersonalProgramMeta> {
  const existing = await getUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId);
  if (!existing) throw new Error('Personal program not found in user docs.');
  return existing as unknown as PersonalProgramMeta;
}

/**
 * Write a granular processing stage to the Supabase doc.
 * Called by the client pipeline between async steps so the UI can show real progress.
 */
export async function updateProcessingStage(
  uid: string,
  jobId: string,
  stage: ProcessingStage,
): Promise<void> {
  const existing = await getUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId);
  if (!existing) return;
  await setUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId, {
    ...existing,
    processingStage: stage,
  });
}

export async function renamePersonalProgram(uid: string, jobId: string, newTitle: string): Promise<PersonalProgramMeta> {
  const docs = await listUserDocs(uid, COLLECTION_PERSONAL_PROGRAMS);
  const existingTitles = new Set(docs.map(d => (d.data as any)?.title).filter(t => t));
  
  let finalTitle = newTitle.trim();
  // We only care about collisions with OTHER programs
  // Let's do a simple check. If they rename to same name it's fine.
  // We handle that by filtering out the current job's title from the set:
  const otherDocs = docs.filter(d => d.id !== jobId);
  const otherTitles = new Set(otherDocs.map(d => (d.data as any)?.title).filter(t => t));

  if (otherTitles.has(finalTitle)) {
    let counter = 1;
    while (otherTitles.has(`${finalTitle} (${counter})`)) {
      counter++;
    }
    finalTitle = `${finalTitle} (${counter})`;
  }

  const existing = await getUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId);
  if (!existing) throw new Error('Personal program not found');
  const updated: PersonalProgramMeta = {
    ...(existing as unknown as PersonalProgramMeta),
    title: finalTitle,
  };
  await setUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId, updated as unknown as DocData);
  return updated;
}

export async function updatePersonalProgramData(
  uid: string, 
  jobId: string, 
  title: string, 
  coverEmoji: string, 
  programData: PersonalProgramData
): Promise<PersonalProgramMeta> {
  const existing = await getUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId);
  if (!existing) throw new Error('Personal program not found');
  const updated: PersonalProgramMeta = {
    ...(existing as unknown as PersonalProgramMeta),
    title,
    coverEmoji,
    programData,
  };
  await setUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId, updated as unknown as DocData);
  return updated;
}

export async function deletePersonalProgram(uid: string, jobId: string): Promise<void> {
  const { deleteUserDoc } = await import('./supabaseDocStore');
  await deleteUserDoc(uid, COLLECTION_PERSONAL_PROGRAMS, jobId);
  // Also clean up any whiteboard data for this program
  const wbDocs = await listUserDocs(uid, COLLECTION_PERSONAL_WHITEBOARDS);
  const toDelete = wbDocs.filter(d => (d.data as any)?.programId === jobId);
  for (const doc of toDelete) {
    await deleteUserDoc(uid, COLLECTION_PERSONAL_WHITEBOARDS, doc.id);
  }
}

// ─── Whiteboard Persistence ─────────────────────────────────────────────────────

function whiteboardDocId(programId: string, questionId: string): string {
  return `${programId}__${questionId}`;
}

export async function saveQuestionWhiteboard(
  uid: string,
  programId: string,
  questionId: string,
  pages: WhiteboardPageData[],
): Promise<void> {
  const docId = whiteboardDocId(programId, questionId);
  await setUserDoc(uid, COLLECTION_PERSONAL_WHITEBOARDS, docId, {
    programId,
    questionId,
    pages,
    updatedAt: new Date().toISOString(),
  });
}

export async function loadQuestionWhiteboard(
  uid: string,
  programId: string,
  questionId: string,
): Promise<WhiteboardPageData[] | null> {
  const docId = whiteboardDocId(programId, questionId);
  const doc = await getUserDoc(uid, COLLECTION_PERSONAL_WHITEBOARDS, docId);
  if (!doc) return null;
  return (doc.pages as WhiteboardPageData[]) ?? null;
}

/**
 * Get set of question IDs that have whiteboard data (answered).
 */
export async function getAnsweredQuestionIds(
  uid: string,
  programId: string,
): Promise<Set<string>> {
  const docs = await listUserDocs(uid, COLLECTION_PERSONAL_WHITEBOARDS);
  const ids = new Set<string>();
  for (const doc of docs) {
    const data = doc.data as any;
    if (data?.programId === programId && data?.questionId) {
      // Only count as answered if there are actual strokes
      const pages = data.pages as WhiteboardPageData[] | undefined;
      if (pages && pages.some(p => p.strokes && (p.strokes as unknown[]).length > 0)) {
        ids.add(data.questionId);
      }
    }
  }
  return ids;
}
