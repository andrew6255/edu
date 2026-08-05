/**
 * Classroom Service — Data layer for the Classes feature
 *
 * Uses global_docs store for all entities:
 *   - teacher_classes: class definitions
 *   - teacher_class_members: class membership
 *   - teacher_class_codes: join codes (1-min expiry)
 *   - class_sessions: sessions within classes
 *   - session_sheets: sheets within sessions
 *   - sheet_strokes: stroke data per sheet/layer
 *   - sheet_access: write-access configuration per sheet
 */

import {
  getGlobalDoc,
  setGlobalDoc,
  updateGlobalDoc,
  deleteGlobalDoc,
  queryGlobalDocs,
  type DocData,
} from '@/lib/supabaseDocStore';
import { requireSupabase } from '@/lib/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type ClassStatus = 'active' | 'ended';
export type SessionStatus = 'scheduled' | 'active' | 'ended';
export type SheetType = 'group' | 'individual' | 'personal';
export type SheetOwnerType = 'teacher' | 'student';

export interface TeacherClass {
  id: string;
  teacherId: string;
  teacherName: string;
  name: string;
  subject: string;
  status: ClassStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherClassNote {
  classId: string;
  teacherId: string;
  note: string;
  updatedAt: string;
}

export interface TeacherStudent {
  id: string;
  teacherId: string;
  studentId: string;
  username: string;
  fullName: string;
  email: string;
  createdAt: string;
}

export interface TeacherStudentCode {
  id: string;
  teacherId: string;
  teacherName: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

export interface TeacherStudentReport {
  id: string;
  teacherId: string;
  studentId: string;
  title: string;
  report: string;
  createdAt: string;
}

export interface ClassMember {
  id: string;
  classId: string;
  userId: string;
  username: string;
  fullName: string;
  role: 'student' | 'teacher_assistant';
  joinedAt: string;
  kickedAt: string | null;
}

export interface ClassCode {
  id: string;
  classId: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  createdBy: string;
}

export interface ClassSession {
  id: string;
  classId: string;
  name: string;
  date: string;
  status: SessionStatus;
  participantIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSheet {
  id: string;
  sessionId: string;
  classId: string;
  name: string;
  type: SheetType;
  createdBy: string;
  ownerType: SheetOwnerType;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SheetStrokeData {
  id: string;
  sheetId: string;
  userId: string;
  layerId: string;
  strokes: unknown[];
  updatedAt: string;
}

export interface SheetAccess {
  sheetId: string;
  masterAccess: boolean;
  studentAccess: Record<string, boolean>;
  /** Group-sheet per-participant section heights in px, keyed by userId ('teacher' for the teacher's own section). */
  sectionHeights: Record<string, number>;
}

/** Layer id used for the teacher's own broadcast layer on group/individual sheets. */
export const TEACHER_LAYER_ID = 'teacher';

/** Layer id the teacher writes to when annotating directly on a specific student's individual sheet. */
export function annotationLayerId(studentId: string): string {
  return `annot_${studentId}`;
}

export function isAnnotationLayer(layerId: string): boolean {
  return layerId.startsWith('annot_');
}

export function studentIdFromAnnotationLayer(layerId: string): string {
  return layerId.slice('annot_'.length);
}

// ─── Collection Names ───────────────────────────────────────────────────────────

const COL = {
  CLASSES: 'teacher_classes',
  MEMBERS: 'teacher_class_members',
  CODES: 'teacher_class_codes',
  SESSIONS: 'class_sessions',
  SHEETS: 'session_sheets',
  STROKES: 'sheet_strokes',
  ACCESS: 'sheet_access',
  NOTES: 'teacher_class_notes',
  STUDENTS: 'teacher_students',
  STUDENT_CODES: 'teacher_student_codes',
  REMOVED_STUDENTS: 'teacher_removed_students',
  STUDENT_REPORTS: 'teacher_student_reports',
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generate6DigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function now(): string {
  return new Date().toISOString();
}

function docToClass(d: DocData): TeacherClass {
  return {
    id: String(d.id ?? ''),
    teacherId: String(d.teacherId ?? ''),
    teacherName: String(d.teacherName ?? ''),
    name: String(d.name ?? ''),
    subject: String(d.subject ?? ''),
    status: d.status === 'ended' ? 'ended' : 'active',
    createdAt: String(d.createdAt ?? ''),
    updatedAt: String(d.updatedAt ?? ''),
  };
}

function docToMember(d: DocData): ClassMember {
  return {
    id: String(d.id ?? ''),
    classId: String(d.classId ?? ''),
    userId: String(d.userId ?? ''),
    username: String(d.username ?? ''),
    fullName: String(d.fullName ?? ''),
    role: d.role === 'teacher_assistant' ? 'teacher_assistant' : 'student',
    joinedAt: String(d.joinedAt ?? ''),
    kickedAt: d.kickedAt ? String(d.kickedAt) : null,
  };
}

function docToCode(d: DocData): ClassCode {
  return {
    id: String(d.id ?? ''),
    classId: String(d.classId ?? ''),
    code: String(d.code ?? ''),
    createdAt: String(d.createdAt ?? ''),
    expiresAt: String(d.expiresAt ?? ''),
    createdBy: String(d.createdBy ?? ''),
  };
}

function docToSession(d: DocData): ClassSession {
  return {
    id: String(d.id ?? ''),
    classId: String(d.classId ?? ''),
    name: String(d.name ?? ''),
    date: String(d.date ?? ''),
    status: d.status === 'scheduled' ? 'scheduled' : d.status === 'ended' ? 'ended' : 'active',
    participantIds: Array.isArray(d.participantIds) ? (d.participantIds as string[]) : [],
    createdBy: String(d.createdBy ?? ''),
    createdAt: String(d.createdAt ?? ''),
    updatedAt: String(d.updatedAt ?? ''),
  };
}

function docToSheet(d: DocData): SessionSheet {
  return {
    id: String(d.id ?? ''),
    sessionId: String(d.sessionId ?? ''),
    classId: String(d.classId ?? ''),
    name: String(d.name ?? ''),
    type: d.type === 'group' ? 'group' : d.type === 'individual' ? 'individual' : 'personal',
    createdBy: String(d.createdBy ?? ''),
    ownerType: d.ownerType === 'student' ? 'student' : 'teacher',
    ownerId: String(d.ownerId ?? ''),
    createdAt: String(d.createdAt ?? ''),
    updatedAt: String(d.updatedAt ?? ''),
    deletedAt: d.deletedAt ? String(d.deletedAt) : null,
  };
}

function docToStrokeData(d: DocData): SheetStrokeData {
  return {
    id: String(d.id ?? ''),
    sheetId: String(d.sheetId ?? ''),
    userId: String(d.userId ?? ''),
    layerId: String(d.layerId ?? ''),
    strokes: Array.isArray(d.strokes) ? d.strokes : [],
    updatedAt: String(d.updatedAt ?? ''),
  };
}

function docToAccess(d: DocData): SheetAccess {
  return {
    sheetId: String(d.sheetId ?? ''),
    masterAccess: d.masterAccess === true,
    studentAccess: (d.studentAccess && typeof d.studentAccess === 'object' && !Array.isArray(d.studentAccess))
      ? d.studentAccess as Record<string, boolean>
      : {},
    sectionHeights: (d.sectionHeights && typeof d.sectionHeights === 'object' && !Array.isArray(d.sectionHeights))
      ? d.sectionHeights as Record<string, number>
      : {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEACHER CLASS OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function createTeacherClass(
  teacherId: string,
  teacherName: string,
  name: string,
  subject: string,
  privateNote = '',
): Promise<TeacherClass> {
  const id = `tc_${uid()}`;
  const data: TeacherClass = {
    id, teacherId, teacherName, name, subject,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  await setGlobalDoc(COL.CLASSES, id, data as unknown as DocData);
  if (privateNote.trim()) await setTeacherClassNote(id, teacherId, privateNote);
  return data;
}

export async function getTeacherClassNote(classId: string): Promise<string> {
  const raw = await getGlobalDoc(COL.NOTES, `tcn_${classId}`);
  return raw ? String(raw.note ?? '') : '';
}

export async function setTeacherClassNote(classId: string, teacherId: string, note: string): Promise<void> {
  const data: TeacherClassNote = { classId, teacherId, note: note.trim(), updatedAt: now() };
  await setGlobalDoc(COL.NOTES, `tcn_${classId}`, data as unknown as DocData);
}

export async function getTeacherStudents(teacherId: string): Promise<TeacherStudent[]> {
  const rows = await queryGlobalDocs(COL.STUDENTS, [{ field: 'teacherId', op: 'eq', value: teacherId }]);
  return rows.map(({ data }) => ({
    id: String(data.id ?? ''), teacherId: String(data.teacherId ?? ''), studentId: String(data.studentId ?? ''),
    username: String(data.username ?? ''), fullName: String(data.fullName ?? ''), email: String(data.email ?? ''),
    createdAt: String(data.createdAt ?? ''),
  })).sort((a, b) => (a.fullName || a.username).localeCompare(b.fullName || b.username));
}

export async function getRemovedTeacherStudentIds(teacherId: string): Promise<string[]> {
  const rows = await queryGlobalDocs(COL.REMOVED_STUDENTS, [{ field: 'teacherId', op: 'eq', value: teacherId }]);
  return rows.map(row => String(row.data.studentId ?? '')).filter(Boolean);
}

export async function removeTeacherStudent(teacherId: string, studentId: string): Promise<void> {
  const id = `trs_${teacherId}_${studentId}`;
  await setGlobalDoc(COL.REMOVED_STUDENTS, id, { id, teacherId, studentId, removedAt: now() });
  await deleteGlobalDoc(COL.STUDENTS, `ts_${teacherId}_${studentId}`).catch(() => undefined);
  const classes = await getTeacherClassesByTeacher(teacherId);
  await Promise.all(classes.map(async cls => {
    const member = await getGlobalDoc(COL.MEMBERS, `tcm_${cls.id}_${studentId}`);
    if (member && !member.kickedAt) await kickStudent(cls.id, studentId);
  }));
}

export async function listTeacherStudentReports(teacherId: string, studentId: string): Promise<TeacherStudentReport[]> {
  const rows = await queryGlobalDocs(COL.STUDENT_REPORTS, [
    { field: 'teacherId', op: 'eq', value: teacherId },
    { field: 'studentId', op: 'eq', value: studentId },
  ]);
  return rows.map(({ data }) => ({
    id: String(data.id ?? ''), teacherId: String(data.teacherId ?? ''), studentId: String(data.studentId ?? ''),
    title: String(data.title ?? ''), report: String(data.report ?? ''), createdAt: String(data.createdAt ?? ''),
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createTeacherStudentReport(teacherId: string, studentId: string, title: string, report: string): Promise<TeacherStudentReport> {
  const data: TeacherStudentReport = { id: `tsr_${uid()}`, teacherId, studentId, title: title.trim(), report: report.trim(), createdAt: now() };
  await setGlobalDoc(COL.STUDENT_REPORTS, data.id, data as unknown as DocData);
  return data;
}

export async function generateTeacherStudentCode(teacherId: string, teacherName: string): Promise<TeacherStudentCode> {
  const createdAt = now();
  const data: TeacherStudentCode = {
    id: `tsc_${teacherId}_${uid()}`, teacherId, teacherName, code: generate6DigitCode(), createdAt,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await setGlobalDoc(COL.STUDENT_CODES, data.id, data as unknown as DocData);
  return data;
}

export async function joinTeacherByStudentCode(code: string): Promise<{ teacherId: string; teacherName: string } | null> {
  const { data, error } = await requireSupabase().rpc('join_teacher_by_student_code_rpc', { p_code: code });
  if (error || !data) return null;
  const result = data as Record<string, unknown>;
  return { teacherId: String(result.teacherId ?? ''), teacherName: String(result.teacherName ?? 'your teacher') };
}

export async function getTeacherClassById(classId: string): Promise<TeacherClass | null> {
  const raw = await getGlobalDoc(COL.CLASSES, classId);
  return raw ? docToClass(raw) : null;
}

export async function getTeacherClassesByTeacher(teacherId: string): Promise<TeacherClass[]> {
  const rows = await queryGlobalDocs(COL.CLASSES, [{ field: 'teacherId', op: 'eq', value: teacherId }]);
  return rows.map(r => docToClass(r.data)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function renameTeacherClass(classId: string, newName: string): Promise<void> {
  await updateGlobalDoc(COL.CLASSES, classId, { name: newName, updatedAt: now() });
}

export async function updateTeacherClassDetails(classId: string, teacherId: string, name: string, subject: string, note: string): Promise<void> {
  await updateGlobalDoc(COL.CLASSES, classId, { name: name.trim(), subject: subject.trim(), updatedAt: now() });
  await setTeacherClassNote(classId, teacherId, note);
}

export async function endTeacherClass(classId: string): Promise<void> {
  await updateGlobalDoc(COL.CLASSES, classId, { status: 'ended', updatedAt: now() });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASS MEMBER OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function addClassMember(
  classId: string,
  userId: string,
  username: string,
  fullName: string,
  role: 'student' | 'teacher_assistant' = 'student',
): Promise<ClassMember> {
  const id = `tcm_${classId}_${userId}`;
  // Check if already exists (re-joining after kick)
  const existing = await getGlobalDoc(COL.MEMBERS, id);
  if (existing) {
    // Re-activate if previously kicked
    await updateGlobalDoc(COL.MEMBERS, id, { kickedAt: null, joinedAt: now(), role } as unknown as DocData);
    return docToMember({ ...existing, kickedAt: null, joinedAt: now(), role });
  }
  const data: ClassMember = {
    id, classId, userId, username, fullName,
    role,
    joinedAt: now(),
    kickedAt: null,
  };
  await setGlobalDoc(COL.MEMBERS, id, data as unknown as DocData);
  return data;
}

export async function getClassMembers(classId: string): Promise<ClassMember[]> {
  const rows = await queryGlobalDocs(COL.MEMBERS, [{ field: 'classId', op: 'eq', value: classId }]);
  return rows.map(r => docToMember(r.data));
}

export async function getActiveClassMembers(classId: string): Promise<ClassMember[]> {
  const all = await getClassMembers(classId);
  return all.filter(m => !m.kickedAt);
}

export async function kickStudent(classId: string, studentId: string): Promise<void> {
  const id = `tcm_${classId}_${studentId}`;
  await updateGlobalDoc(COL.MEMBERS, id, { kickedAt: now() } as unknown as DocData);
}

export async function getStudentClassIds(userId: string): Promise<string[]> {
  const rows = await queryGlobalDocs(COL.MEMBERS, [{ field: 'userId', op: 'eq', value: userId }]);
  return rows.map(r => docToMember(r.data))
    .filter(m => !m.kickedAt)
    .map(m => m.classId);
}

export async function getStudentClasses(userId: string): Promise<{ active: TeacherClass[]; archived: TeacherClass[] }> {
  // Get all memberships for this student (including kicked)
  const memberRows = await queryGlobalDocs(COL.MEMBERS, [{ field: 'userId', op: 'eq', value: userId }]);
  const members = memberRows.map(r => docToMember(r.data));
  if (members.length === 0) return { active: [], archived: [] };

  const classIds = [...new Set(members.map(m => m.classId))];
  const classes: TeacherClass[] = [];
  for (const cid of classIds) {
    const raw = await getGlobalDoc(COL.CLASSES, cid);
    if (raw) classes.push(docToClass(raw));
  }

  const kickedClassIds = new Set(members.filter(m => m.kickedAt).map(m => m.classId));

  const active: TeacherClass[] = [];
  const archived: TeacherClass[] = [];
  for (const cls of classes) {
    if (cls.status === 'ended') {
      archived.push(cls);
    } else if (kickedClassIds.has(cls.id)) {
      // Kicked but class still active — student still sees it (frozen) in active list
      active.push(cls);
    } else {
      active.push(cls);
    }
  }

  active.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  archived.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { active, archived };
}

export async function isStudentKicked(classId: string, userId: string): Promise<boolean> {
  const id = `tcm_${classId}_${userId}`;
  const raw = await getGlobalDoc(COL.MEMBERS, id);
  if (!raw) return false;
  return !!raw.kickedAt;
}

export async function deleteStudentClassMembership(classId: string, userId: string): Promise<void> {
  const id = `tcm_${classId}_${userId}`;
  await deleteGlobalDoc(COL.MEMBERS, id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// JOIN CODE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateClassCode(classId: string, createdBy: string): Promise<ClassCode> {
  const id = `tcc_${classId}_${uid()}`;
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 60_000).toISOString(); // 1 minute
  const data: ClassCode = {
    id, classId,
    code: generate6DigitCode(),
    createdAt, expiresAt, createdBy,
  };
  await setGlobalDoc(COL.CODES, id, data as unknown as DocData);
  return data;
}

export async function validateClassCode(code: string): Promise<{ classId: string } | null> {
  const rows = await queryGlobalDocs(COL.CODES, [{ field: 'code', op: 'eq', value: code }]);
  if (rows.length === 0) return null;
  // Find a non-expired code
  const currentTime = new Date().toISOString();
  for (const row of rows) {
    const codeData = docToCode(row.data);
    if (codeData.expiresAt > currentTime) {
      return { classId: codeData.classId };
    }
  }
  return null; // All codes with this value are expired
}

/**
 * Joins a class by its 6-digit code via the `join_class_by_code_rpc` security-definer
 * function (see classroom_rls.sql) — teacher_class_codes is not directly SELECTable by
 * students, so redemption has to happen server-side. The caller's identity is derived
 * server-side from the authenticated session (`auth.uid()`), not from `userId`.
 */
export async function joinClassByCode(
  userId: string,
  username: string,
  fullName: string,
  code: string,
): Promise<{ class: TeacherClass; member: ClassMember } | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('join_class_by_code_rpc', {
    p_code: code,
    p_username: username,
    p_full_name: fullName,
  });
  if (error) {
    console.warn('[classroomService] joinClassByCode RPC error:', error.message);
    return null;
  }
  const cls = docToClass(data as DocData);
  const member = await getGlobalDoc(COL.MEMBERS, `tcm_${cls.id}_${userId}`);
  if (!member) return null;
  return { class: cls, member: docToMember(member) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function createSession(
  classId: string,
  name: string,
  date: string,
  status: SessionStatus,
  participantIds: string[],
  createdBy: string,
): Promise<ClassSession> {
  const id = `cs_${uid()}`;
  const data: ClassSession = {
    id, classId, name, date, status, participantIds, createdBy,
    createdAt: now(),
    updatedAt: now(),
  };
  await setGlobalDoc(COL.SESSIONS, id, data as unknown as DocData);
  return data;
}

export async function getClassSessions(classId: string): Promise<ClassSession[]> {
  const rows = await queryGlobalDocs(COL.SESSIONS, [{ field: 'classId', op: 'eq', value: classId }]);
  return rows.map(r => docToSession(r.data)).sort((a, b) => b.date.localeCompare(a.date));
}

export async function getSessionById(sessionId: string): Promise<ClassSession | null> {
  const raw = await getGlobalDoc(COL.SESSIONS, sessionId);
  return raw ? docToSession(raw) : null;
}

export async function updateSession(sessionId: string, updates: Partial<Pick<ClassSession, 'name' | 'date' | 'status' | 'participantIds'>>): Promise<void> {
  await updateGlobalDoc(COL.SESSIONS, sessionId, { ...updates, updatedAt: now() } as unknown as DocData);
}

export async function deleteSession(sessionId: string): Promise<void> {
  // Delete all sheets in this session
  const sheets = await queryGlobalDocs(COL.SHEETS, [{ field: 'sessionId', op: 'eq', value: sessionId }]);
  for (const sheet of sheets) {
    await deleteSheet(sheet.data.id as string);
  }
  await deleteGlobalDoc(COL.SESSIONS, sessionId);
}

export async function getStudentSessions(userId: string, classId: string): Promise<ClassSession[]> {
  const sessions = await getClassSessions(classId);
  return sessions.filter(s => s.participantIds.includes(userId));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function createSheet(
  sessionId: string,
  classId: string,
  name: string,
  type: SheetType,
  createdBy: string,
  ownerType: SheetOwnerType,
  ownerId: string,
): Promise<SessionSheet> {
  const id = `ss_${uid()}`;
  const data: SessionSheet = {
    id, sessionId, classId, name, type, createdBy, ownerType, ownerId,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await setGlobalDoc(COL.SHEETS, id, data as unknown as DocData);
  // Initialize access (all off by default)
  if (type === 'group' || type === 'individual') {
    await setSheetAccess(id, false, {});
  }
  return data;
}

export async function getSessionSheets(
  sessionId: string,
  userId: string,
  userRole: 'teacher' | 'student',
): Promise<SessionSheet[]> {
  const rows = await queryGlobalDocs(COL.SHEETS, [{ field: 'sessionId', op: 'eq', value: sessionId }]);
  const sheets = rows.map(r => docToSheet(r.data)).filter(s => !s.deletedAt);

  if (userRole === 'teacher') {
    // Teacher sees all sheets except student personal sheets
    return sheets.filter(s => !(s.type === 'personal' && s.ownerType === 'student'));
  }
  // Student sees: group, individual, and their own personal sheets
  return sheets.filter(s =>
    s.type === 'group' ||
    s.type === 'individual' ||
    (s.type === 'personal' && s.ownerType === 'student' && s.ownerId === userId)
  );
}

export async function getSheetById(sheetId: string): Promise<SessionSheet | null> {
  const raw = await getGlobalDoc(COL.SHEETS, sheetId);
  return raw ? docToSheet(raw) : null;
}

export async function renameSheet(sheetId: string, newName: string): Promise<void> {
  await updateGlobalDoc(COL.SHEETS, sheetId, { name: newName, updatedAt: now() });
}

export async function deleteSheet(sheetId: string): Promise<void> {
  // Delete all stroke data for this sheet
  const strokeRows = await queryGlobalDocs(COL.STROKES, [{ field: 'sheetId', op: 'eq', value: sheetId }]);
  for (const row of strokeRows) {
    await deleteGlobalDoc(COL.STROKES, row.id);
  }
  // Delete access config
  await deleteGlobalDoc(COL.ACCESS, `sa_${sheetId}`).catch(() => {});
  // Delete the sheet itself
  await deleteGlobalDoc(COL.SHEETS, sheetId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET STROKES
// ═══════════════════════════════════════════════════════════════════════════════

export async function saveSheetStrokes(
  sheetId: string,
  userId: string,
  layerId: string,
  strokes: unknown[],
): Promise<void> {
  const id = `sst_${sheetId}_${layerId}`;
  const data: SheetStrokeData = {
    id, sheetId, userId, layerId, strokes,
    updatedAt: now(),
  };
  await setGlobalDoc(COL.STROKES, id, data as unknown as DocData);
}

export async function getSheetStrokes(sheetId: string, layerId?: string): Promise<SheetStrokeData[]> {
  const rows = await queryGlobalDocs(COL.STROKES, [{ field: 'sheetId', op: 'eq', value: sheetId }]);
  const all = rows.map(r => docToStrokeData(r.data));
  if (layerId) return all.filter(s => s.layerId === layerId);
  return all;
}

export async function pollSheetUpdates(sheetId: string, since: string): Promise<SheetStrokeData[]> {
  const all = await getSheetStrokes(sheetId);
  return all.filter(s => s.updatedAt > since);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHEET ACCESS
// ═══════════════════════════════════════════════════════════════════════════════

export async function getSheetAccess(sheetId: string): Promise<SheetAccess> {
  const id = `sa_${sheetId}`;
  const raw = await getGlobalDoc(COL.ACCESS, id);
  if (!raw) return { sheetId, masterAccess: false, studentAccess: {}, sectionHeights: {} };
  return docToAccess(raw);
}

export async function setSheetAccess(
  sheetId: string,
  masterAccess: boolean,
  studentAccess: Record<string, boolean>,
  sectionHeights?: Record<string, number>,
): Promise<void> {
  const id = `sa_${sheetId}`;
  const existing = sectionHeights ? undefined : await getGlobalDoc(COL.ACCESS, id);
  const data: SheetAccess = {
    sheetId,
    masterAccess,
    studentAccess,
    sectionHeights: sectionHeights ?? (existing ? docToAccess(existing).sectionHeights : {}),
  };
  await setGlobalDoc(COL.ACCESS, id, data as unknown as DocData);
}

export async function toggleStudentAccess(
  sheetId: string,
  studentId: string,
  hasAccess: boolean,
): Promise<void> {
  const current = await getSheetAccess(sheetId);
  current.studentAccess[studentId] = hasAccess;
  await setSheetAccess(sheetId, current.masterAccess, current.studentAccess, current.sectionHeights);
}

export async function toggleMasterAccess(sheetId: string, masterAccess: boolean): Promise<void> {
  const current = await getSheetAccess(sheetId);
  // When master is toggled, set all students to the same value
  const updated: Record<string, boolean> = {};
  for (const key of Object.keys(current.studentAccess)) {
    updated[key] = masterAccess;
  }
  await setSheetAccess(sheetId, masterAccess, updated, current.sectionHeights);
}

export async function setSectionHeight(sheetId: string, userId: string, height: number): Promise<void> {
  const current = await getSheetAccess(sheetId);
  current.sectionHeights[userId] = height;
  await setSheetAccess(sheetId, current.masterAccess, current.studentAccess, current.sectionHeights);
}

export async function canStudentWrite(sheetId: string, studentId: string): Promise<boolean> {
  const access = await getSheetAccess(sheetId);
  if (!access.masterAccess) return false;
  return access.studentAccess[studentId] === true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function adminAddStudentToClass(
  classId: string,
  userId: string,
  username: string,
  fullName: string,
): Promise<ClassMember> {
  return addClassMember(classId, userId, username, fullName);
}

export async function adminRemoveStudentFromClass(classId: string, studentId: string): Promise<void> {
  await deleteStudentClassMembership(classId, studentId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARTICIPANT COLORS (for group sheets)
// ═══════════════════════════════════════════════════════════════════════════════

const PARTICIPANT_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#84cc16', // lime
  '#d946ef', // fuchsia
];

export function getParticipantColor(index: number): string {
  return PARTICIPANT_COLORS[index % PARTICIPANT_COLORS.length];
}

/** Teacher always gets the first color (blue) */
export function getTeacherColor(): string {
  return '#1e293b';
}
