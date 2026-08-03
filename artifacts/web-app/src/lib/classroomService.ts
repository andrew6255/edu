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

export interface ClassMember {
  id: string;
  classId: string;
  userId: string;
  username: string;
  fullName: string;
  role: 'student';
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
    role: 'student',
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
): Promise<TeacherClass> {
  const id = `tc_${uid()}`;
  const data: TeacherClass = {
    id, teacherId, teacherName, name, subject,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  await setGlobalDoc(COL.CLASSES, id, data as unknown as DocData);
  return data;
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
): Promise<ClassMember> {
  const id = `tcm_${classId}_${userId}`;
  // Check if already exists (re-joining after kick)
  const existing = await getGlobalDoc(COL.MEMBERS, id);
  if (existing) {
    // Re-activate if previously kicked
    await updateGlobalDoc(COL.MEMBERS, id, { kickedAt: null, joinedAt: now() } as unknown as DocData);
    return docToMember({ ...existing, kickedAt: null, joinedAt: now() });
  }
  const data: ClassMember = {
    id, classId, userId, username, fullName,
    role: 'student',
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

export async function joinClassByCode(
  userId: string,
  username: string,
  fullName: string,
  code: string,
): Promise<{ class: TeacherClass; member: ClassMember } | null> {
  const validation = await validateClassCode(code);
  if (!validation) return null;

  const cls = await getTeacherClassById(validation.classId);
  if (!cls || cls.status === 'ended') return null;

  const member = await addClassMember(validation.classId, userId, username, fullName);
  return { class: cls, member };
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
  if (!raw) return { sheetId, masterAccess: false, studentAccess: {} };
  return docToAccess(raw);
}

export async function setSheetAccess(
  sheetId: string,
  masterAccess: boolean,
  studentAccess: Record<string, boolean>,
): Promise<void> {
  const id = `sa_${sheetId}`;
  const data: SheetAccess = { sheetId, masterAccess, studentAccess };
  await setGlobalDoc(COL.ACCESS, id, data as unknown as DocData);
}

export async function toggleStudentAccess(
  sheetId: string,
  studentId: string,
  hasAccess: boolean,
): Promise<void> {
  const current = await getSheetAccess(sheetId);
  current.studentAccess[studentId] = hasAccess;
  await setSheetAccess(sheetId, current.masterAccess, current.studentAccess);
}

export async function toggleMasterAccess(sheetId: string, masterAccess: boolean): Promise<void> {
  const current = await getSheetAccess(sheetId);
  // When master is toggled, set all students to the same value
  const updated: Record<string, boolean> = {};
  for (const key of Object.keys(current.studentAccess)) {
    updated[key] = masterAccess;
  }
  await setSheetAccess(sheetId, masterAccess, updated);
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
