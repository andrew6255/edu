import { requireSupabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClassRow {
  id: string;
  teacher_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ClassMemberRow {
  class_id: string;
  user_id: string;
  role: 'student' | 'teacher_assistant';
  created_at: string;
}

export interface TeacherInfo {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

// ─── My Teachers (via admin_teacher_assignments) ─────────────────────────────

export async function getMyTeachers(): Promise<TeacherInfo[]> {
  const supabase = requireSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('admin_teacher_assignments')
    .select('teacher_id')
    .eq('admin_id', user.id);
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const teacherIds = data.map((r: { teacher_id: string }) => r.teacher_id);
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, username, first_name, last_name, email')
    .in('id', teacherIds);
  if (profilesError) throw profilesError;
  return (profiles ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id ?? ''),
    username: String(p.username ?? ''),
    first_name: String(p.first_name ?? ''),
    last_name: String(p.last_name ?? ''),
    email: String(p.email ?? ''),
  }));
}

// ─── Classes CRUD ────────────────────────────────────────────────────────────

export async function listClasses(): Promise<ClassRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClassRow[];
}

export async function createClass(id: string, name: string, teacherId: string): Promise<void> {
  const supabase = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase.from('classes').insert({
    id, name, teacher_id: teacherId, created_at: now, updated_at: now,
  });
  if (error) throw error;
}

export async function updateClass(id: string, name: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('classes').update({
    name, updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

export async function deleteClass(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('classes').delete().eq('id', id);
  if (error) throw error;
}

// ─── Class Members CRUD ──────────────────────────────────────────────────────

export async function listClassMembers(classId: string): Promise<ClassMemberRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('class_members')
    .select('*')
    .eq('class_id', classId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClassMemberRow[];
}

export async function addClassMember(classId: string, userId: string, role: 'student' | 'teacher_assistant'): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('class_members').upsert({
    class_id: classId, user_id: userId, role, created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function removeClassMember(classId: string, userId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('class_members').delete().eq('class_id', classId).eq('user_id', userId);
  if (error) throw error;
}

// ─── Class Content CRUD ─────────────────────────────────────────────────────

export type ContentType = 'program' | 'assignment' | 'quiz';

export interface ClassContentRow {
  id: string;
  class_id: string;
  content_type: ContentType;
  status: 'draft' | 'published';
  title: string;
  subject: string;
  grade_band: string | null;
  cover_emoji: string | null;
  builder_spec: unknown;
  toc: unknown;
  annotations: unknown;
  program_meta: unknown;
  question_banks_by_chapter: unknown;
  ranked_total_question_count: number;
  questions: unknown;
  time_limit_minutes: number | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listClassContent(classId: string): Promise<ClassContentRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('class_content')
    .select('*')
    .eq('class_id', classId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClassContentRow[];
}

export async function createClassContent(row: {
  id: string;
  class_id: string;
  content_type: ContentType;
  title: string;
  subject?: string;
  cover_emoji?: string;
  questions?: unknown;
  time_limit_minutes?: number | null;
  created_by?: string;
}): Promise<void> {
  const supabase = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase.from('class_content').insert({
    id: row.id,
    class_id: row.class_id,
    content_type: row.content_type,
    status: 'draft',
    title: row.title,
    subject: row.subject ?? 'mathematics',
    cover_emoji: row.cover_emoji ?? (row.content_type === 'program' ? '📘' : row.content_type === 'assignment' ? '📝' : '📋'),
    questions: row.questions ?? null,
    time_limit_minutes: row.time_limit_minutes ?? null,
    created_by: row.created_by ?? null,
    created_at: now,
    updated_at: now,
  });
  if (error) throw error;
}

export async function updateClassContent(id: string, updates: Partial<{
  title: string;
  subject: string;
  cover_emoji: string;
  questions: unknown;
  time_limit_minutes: number | null;
  builder_spec: unknown;
  toc: unknown;
  annotations: unknown;
  program_meta: unknown;
  question_banks_by_chapter: unknown;
  ranked_total_question_count: number;
}>): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('class_content').update({
    ...updates,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

export async function toggleClassContentStatus(id: string, newStatus: 'draft' | 'published'): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('class_content').update({
    status: newStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

export async function softDeleteClassContent(id: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('class_content').update({
    deleted_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

// ─── Teacher-scoped queries (for admin managing a specific teacher) ──────────

export async function listClassesForTeacher(teacherId: string): Promise<ClassRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('teacher_id', teacherId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClassRow[];
}

export interface TeacherUserRow {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'student' | 'teacher_assistant';
  class_ids: string[];
  class_names: string[];
}

export async function listAllUsersForTeacher(teacherId: string): Promise<TeacherUserRow[]> {
  const supabase = requireSupabase();
  // 1. Get all classes for this teacher
  const { data: classes, error: classError } = await supabase
    .from('classes')
    .select('id, name')
    .eq('teacher_id', teacherId);
  if (classError) throw classError;
  if (!classes || classes.length === 0) return [];

  const classIds = classes.map((c: Record<string, unknown>) => String(c.id));
  const classNameMap = new Map(classes.map((c: Record<string, unknown>) => [String(c.id), String(c.name)]));

  // 2. Get all members across those classes
  const { data: members, error: memberError } = await supabase
    .from('class_members')
    .select('class_id, user_id, role')
    .in('class_id', classIds);
  if (memberError) throw memberError;
  if (!members || members.length === 0) return [];

  // 3. Aggregate by user
  const userMap = new Map<string, { role: 'student' | 'teacher_assistant'; class_ids: string[] }>();
  for (const m of members as Array<{ class_id: string; user_id: string; role: string }>) {
    const existing = userMap.get(m.user_id);
    if (existing) {
      existing.class_ids.push(m.class_id);
      // Use highest role (TA > student)
      if (m.role === 'teacher_assistant') existing.role = 'teacher_assistant';
    } else {
      userMap.set(m.user_id, { role: m.role as 'student' | 'teacher_assistant', class_ids: [m.class_id] });
    }
  }

  // 4. Fetch profiles
  const userIds = Array.from(userMap.keys());
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, first_name, last_name, email')
    .in('id', userIds);
  if (profileError) throw profileError;

  return (profiles ?? []).map((p: Record<string, unknown>) => {
    const info = userMap.get(String(p.id))!;
    return {
      user_id: String(p.id ?? ''),
      username: String(p.username ?? ''),
      first_name: String(p.first_name ?? ''),
      last_name: String(p.last_name ?? ''),
      email: String(p.email ?? ''),
      role: info.role,
      class_ids: info.class_ids,
      class_names: info.class_ids.map(id => classNameMap.get(id) || id),
    };
  });
}

export async function updateClassMemberRole(classId: string, userId: string, newRole: 'student' | 'teacher_assistant'): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('class_members')
    .update({ role: newRole })
    .eq('class_id', classId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function removeUserFromAllTeacherClasses(teacherId: string, userId: string): Promise<void> {
  const supabase = requireSupabase();
  const { data: classes } = await supabase.from('classes').select('id').eq('teacher_id', teacherId);
  if (!classes || classes.length === 0) return;
  const classIds = classes.map((c: Record<string, unknown>) => String(c.id));
  const { error } = await supabase.from('class_members').delete().in('class_id', classIds).eq('user_id', userId);
  if (error) throw error;
}

// ─── Profiles helper: fetch students / TAs for picker ────────────────────────

export async function getProfilesByRole(role: string): Promise<TeacherInfo[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, first_name, last_name, email')
    .eq('role', role)
    .order('username', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id ?? ''),
    username: String(p.username ?? ''),
    first_name: String(p.first_name ?? ''),
    last_name: String(p.last_name ?? ''),
    email: String(p.email ?? ''),
  }));
}
