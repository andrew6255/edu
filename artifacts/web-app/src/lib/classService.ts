import { getGlobalDoc, setGlobalDoc, updateGlobalDoc, deleteGlobalDoc, queryGlobalDocs, resolveArrayUnion } from '@/lib/supabaseDocStore';
import { requireSupabase } from '@/lib/supabase';

export interface ClassData {
  id: string;
  name: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  code: string;
  studentIds: string[];
  createdAt: string;
  description?: string;
}

function generateCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function createClass(teacherId: string, teacherName: string, data: {
  name: string; subject: string; description?: string;
}): Promise<ClassData> {
  const id = `class_${Date.now()}`;
  const classData: ClassData = {
    id, teacherId, teacherName,
    name: data.name, subject: data.subject,
    description: data.description || '',
    code: generateCode(),
    studentIds: [],
    createdAt: new Date().toISOString(),
  };
  await setGlobalDoc('classes', id, classData as any);
  return classData;
}

export async function getClassById(classId: string): Promise<ClassData | null> {
  const raw = await getGlobalDoc('classes', classId);
  if (!raw) return null;
  return raw as any as ClassData;
}

export async function getAllClasses(): Promise<ClassData[]> {
  const rows = await queryGlobalDocs('classes');
  return rows.map(r => r.data as any as ClassData);
}

export async function joinClassByCode(uid: string, code: string): Promise<ClassData | null> {
  const rows = await queryGlobalDocs('classes', [{ field: 'code', op: 'eq', value: code.toUpperCase() }]);
  if (rows.length === 0) return null;
  const classData = rows[0].data as any as ClassData;
  const classId = rows[0].id;
  const studentIds = resolveArrayUnion(classData as any, 'studentIds', uid);
  await updateGlobalDoc('classes', classId, { studentIds });
  // Update user profile classId via Supabase profiles table
  const supabase = requireSupabase();
  await supabase.from('profiles').update({ class_id: classId }).eq('id', uid);
  return classData;
}

export async function removeStudentFromClass(classId: string, studentId: string): Promise<void> {
  const raw = await getGlobalDoc('classes', classId);
  if (raw) {
    const data = raw as any;
    const students = Array.isArray(data.studentIds) ? (data.studentIds as string[]).filter(s => s !== studentId) : [];
    await updateGlobalDoc('classes', classId, { studentIds: students });
  }
  const supabase = requireSupabase();
  await supabase.from('profiles').update({ class_id: null }).eq('id', studentId);
}

export async function deleteClass(classId: string): Promise<void> {
  await deleteGlobalDoc('classes', classId);
}

export async function updateClass(classId: string, updates: Partial<ClassData>): Promise<void> {
  await updateGlobalDoc('classes', classId, updates as Record<string, unknown>);
}
