import { deleteGlobalDoc, getGlobalDoc, queryGlobalDocs, setGlobalDoc, updateGlobalDoc, type DocData } from './supabaseDocStore';
import { requireSupabase } from './supabase';
import type { Stroke } from '@/components/FullScreenWorkspace';

export interface Homework {
  id: string; classId: string; teacherId: string; title: string; fileName: string; fileUrl: string; filePath: string;
  storageBucket?: string; dueAt: string; createdAt: string; updatedAt: string;
}
export interface HomeworkAttachment { id: string; name: string; url: string; path: string; storageBucket?: string; uploadedAt: string; }
export interface HomeworkSheet { id: string; name: string; strokes: Stroke[]; createdAt: string; updatedAt: string; }
export interface HomeworkSubmission {
  id: string; homeworkId: string; classId: string; studentId: string; sheets: HomeworkSheet[]; attachments: HomeworkAttachment[];
  submittedAt: string | null; updatedAt: string; strokes?: Stroke[];
}
const HOMEWORKS = 'class_homeworks';
const SUBMISSIONS = 'homework_submissions';
const PRIVATE_BUCKET = 'classroom-homework';
const now = () => new Date().toISOString();
const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const safe = (name: string) => name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'file';

async function createSignedUrl(path: string, bucket = PRIVATE_BUCKET): Promise<string> {
  const { data, error } = await requireSupabase().storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}
async function refreshPrivateUrl(path: string, bucket: string | undefined, currentUrl: string): Promise<string> {
  return bucket ? createSignedUrl(path, bucket) : currentUrl;
}
async function upload(file: File, path: string) {
  const storage = requireSupabase().storage.from(PRIVATE_BUCKET);
  const { error } = await storage.upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return createSignedUrl(path);
}
function toHomework(data: DocData): Homework { return data as unknown as Homework; }
function toSubmission(data: DocData): HomeworkSubmission {
  const raw = data as Record<string, unknown>;
  const timestamp = String(raw.updatedAt ?? now());
  const legacyStrokes = Array.isArray(raw.strokes) ? raw.strokes as Stroke[] : [];
  return {
    ...(data as unknown as HomeworkSubmission),
    sheets: Array.isArray(raw.sheets) ? raw.sheets as HomeworkSheet[] : legacyStrokes.length ? [{ id: 'legacy-sheet', name: 'Sheet 1', strokes: legacyStrokes, createdAt: timestamp, updatedAt: timestamp }] : [],
    attachments: Array.isArray(raw.attachments) ? (raw.attachments as Array<Partial<HomeworkAttachment>>).map((file, index) => ({ ...file, id: file.id ?? `legacy-file-${index}` } as HomeworkAttachment)) : [],
  };
}

export async function getHomework(id: string): Promise<Homework | null> {
  const raw = await getGlobalDoc(HOMEWORKS, id);
  if (!raw) return null;
  const homework = toHomework(raw);
  return { ...homework, fileUrl: await refreshPrivateUrl(homework.filePath, homework.storageBucket, homework.fileUrl) };
}
export async function listClassHomeworks(classId: string): Promise<Homework[]> {
  const rows = await queryGlobalDocs(HOMEWORKS, [{ field: 'classId', op: 'eq', value: classId }]);
  const homeworks = await Promise.all(rows.map(async row => {
    const homework = toHomework(row.data);
    return { ...homework, fileUrl: await refreshPrivateUrl(homework.filePath, homework.storageBucket, homework.fileUrl) };
  }));
  return homeworks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function createHomework(classId: string, teacherId: string, title: string, dueAt: string, pdf: File): Promise<Homework> {
  if (pdf.type !== 'application/pdf' && !pdf.name.toLowerCase().endsWith('.pdf')) throw new Error('Homework must be a PDF file.');
  const id = `hw_${uid()}`;
  const filePath = `classrooms/${classId}/homeworks/${id}/${safe(pdf.name)}`;
  const fileUrl = await upload(pdf, filePath);
  const timestamp = now();
  const data: Homework = { id, classId, teacherId, title: title.trim() || pdf.name.replace(/\.pdf$/i, ''), fileName: pdf.name, fileUrl, filePath, storageBucket: PRIVATE_BUCKET, dueAt, createdAt: timestamp, updatedAt: timestamp };
  await setGlobalDoc(HOMEWORKS, id, data as unknown as DocData);
  return data;
}
export async function updateHomeworkDeadline(id: string, dueAt: string): Promise<void> { await updateGlobalDoc(HOMEWORKS, id, { dueAt, updatedAt: now() }); }
export async function getHomeworkSubmission(homeworkId: string, studentId: string): Promise<HomeworkSubmission | null> {
  const raw = await getGlobalDoc(SUBMISSIONS, `hws_${homeworkId}_${studentId}`);
  if (!raw) return null;
  const submission = toSubmission(raw);
  return { ...submission, attachments: await Promise.all(submission.attachments.map(async file => ({ ...file, url: await refreshPrivateUrl(file.path, file.storageBucket, file.url) }))) };
}
export async function listHomeworkSubmissions(homeworkId: string): Promise<HomeworkSubmission[]> {
  const rows = await queryGlobalDocs(SUBMISSIONS, [{ field: 'homeworkId', op: 'eq', value: homeworkId }]);
  const submissions = await Promise.all(rows.map(async row => {
    const submission = toSubmission(row.data);
    return { ...submission, attachments: await Promise.all(submission.attachments.map(async file => ({ ...file, url: await refreshPrivateUrl(file.path, file.storageBucket, file.url) }))) };
  }));
  return submissions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveHomeworkSubmission(homework: Homework, studentId: string, sheetsOrStrokes: HomeworkSheet[] | Stroke[], attachments: HomeworkAttachment[], _legacySubmit?: boolean): Promise<HomeworkSubmission> {
  if (Date.now() > new Date(homework.dueAt).getTime()) throw new Error('The submission deadline has passed.');
  const id = `hws_${homework.id}_${studentId}`;
  const existing = await getHomeworkSubmission(homework.id, studentId);
  const sheets = sheetsOrStrokes.length > 0 && !('name' in sheetsOrStrokes[0])
    ? [{ id: 'legacy-sheet', name: 'Sheet 1', strokes: sheetsOrStrokes as Stroke[], createdAt: existing?.updatedAt ?? now(), updatedAt: now() }]
    : sheetsOrStrokes as HomeworkSheet[];
  const data: HomeworkSubmission = { id, homeworkId: homework.id, classId: homework.classId, studentId, sheets, attachments, submittedAt: existing?.submittedAt ?? now(), updatedAt: now() };
  await setGlobalDoc(SUBMISSIONS, id, data as unknown as DocData);
  return data;
}
export async function deleteHomeworkSubmissionIfEmpty(homeworkId: string, studentId: string): Promise<void> {
  await deleteGlobalDoc(SUBMISSIONS, `hws_${homeworkId}_${studentId}`);
}
export async function uploadHomeworkAttachment(homework: Homework, studentId: string, file: File): Promise<HomeworkAttachment> {
  if (Date.now() > new Date(homework.dueAt).getTime()) throw new Error('The submission deadline has passed.');
  const id = `file_${uid()}`;
  const path = `classrooms/${homework.classId}/homeworks/${homework.id}/submissions/${studentId}/${id}_${safe(file.name)}`;
  return { id, name: file.name, path, storageBucket: PRIVATE_BUCKET, url: await upload(file, path), uploadedAt: now() };
}
export async function deleteHomeworkAttachment(path: string, bucket?: string): Promise<void> {
  const { error } = await requireSupabase().storage.from(bucket ?? 'program-assets').remove([path]);
  if (error) throw error;
}
