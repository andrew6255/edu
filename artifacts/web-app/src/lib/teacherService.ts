import { requireSupabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TeacherClassRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  student_count: number;
  content_count: number;
}

export interface ClassStudentRow {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: 'student' | 'teacher_assistant';
}

export interface TeacherContentRow {
  id: string;
  content_type: 'program' | 'assignment' | 'quiz';
  status: 'draft' | 'published';
  title: string;
  subject: string;
  cover_emoji: string | null;
  questions: unknown;
  time_limit_minutes: number | null;
  created_at: string;
}

export interface StudentQuizResult {
  student_id: string;
  username: string;
  quiz_id: string;
  quiz_title: string;
  score: number | null;
  status: 'in_progress' | 'submitted' | 'graded';
  submitted_at: string | null;
}

// ─── My Classes ──────────────────────────────────────────────────────────────

export async function getTeacherClasses(): Promise<TeacherClassRow[]> {
  const supabase = requireSupabase();
  const { data: classes, error } = await supabase
    .from('classes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (!classes || classes.length === 0) return [];

  const classIds = (classes as { id: string }[]).map(c => c.id);

  // count students per class
  const { data: members } = await supabase
    .from('class_members')
    .select('class_id, role')
    .in('class_id', classIds);
  const studentCounts = new Map<string, number>();
  (members ?? []).forEach((m: Record<string, unknown>) => {
    if (m.role === 'student') {
      const cid = String(m.class_id);
      studentCounts.set(cid, (studentCounts.get(cid) ?? 0) + 1);
    }
  });

  // count content per class
  const { data: contentRows } = await supabase
    .from('class_content')
    .select('class_id')
    .in('class_id', classIds)
    .is('deleted_at', null);
  const contentCounts = new Map<string, number>();
  (contentRows ?? []).forEach((r: Record<string, unknown>) => {
    const cid = String(r.class_id);
    contentCounts.set(cid, (contentCounts.get(cid) ?? 0) + 1);
  });

  return (classes as Record<string, unknown>[]).map(c => ({
    id: String(c.id),
    name: String(c.name),
    created_at: String(c.created_at),
    updated_at: String(c.updated_at),
    student_count: studentCounts.get(String(c.id)) ?? 0,
    content_count: contentCounts.get(String(c.id)) ?? 0,
  }));
}

// ─── Class Students ──────────────────────────────────────────────────────────

export async function getClassStudents(classId: string): Promise<ClassStudentRow[]> {
  const supabase = requireSupabase();
  const { data: members, error } = await supabase
    .from('class_members')
    .select('user_id, role')
    .eq('class_id', classId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!members || members.length === 0) return [];

  const userIds = (members as { user_id: string }[]).map(m => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, first_name, last_name, email')
    .in('id', userIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), p]));
  const roleMap = new Map((members as { user_id: string; role: string }[]).map(m => [m.user_id, m.role]));

  return userIds.map(uid => {
    const p = pMap.get(uid) ?? {};
    return {
      user_id: uid,
      username: String(p.username ?? ''),
      first_name: String(p.first_name ?? ''),
      last_name: String(p.last_name ?? ''),
      email: String(p.email ?? ''),
      role: (roleMap.get(uid) ?? 'student') as 'student' | 'teacher_assistant',
    };
  });
}

// ─── Class Content (read-only for teacher) ───────────────────────────────────

export async function getTeacherClassContent(classId: string): Promise<TeacherContentRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('class_content')
    .select('*')
    .eq('class_id', classId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    content_type: r.content_type as 'program' | 'assignment' | 'quiz',
    status: r.status as 'draft' | 'published',
    title: String(r.title ?? ''),
    subject: String(r.subject ?? ''),
    cover_emoji: typeof r.cover_emoji === 'string' ? r.cover_emoji : null,
    questions: r.questions,
    time_limit_minutes: typeof r.time_limit_minutes === 'number' ? r.time_limit_minutes : null,
    created_at: String(r.created_at),
  }));
}

// ─── All Users across teacher's classes ──────────────────────────────────────

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

export async function getAllTeacherUsers(): Promise<TeacherUserRow[]> {
  const supabase = requireSupabase();
  const { data: classes } = await supabase.from('classes').select('id, name').order('created_at', { ascending: false });
  if (!classes || classes.length === 0) return [];

  const classIds = (classes as { id: string }[]).map(c => c.id);
  const classNameMap = new Map((classes as { id: string; name: string }[]).map(c => [c.id, c.name]));

  const { data: members } = await supabase.from('class_members').select('class_id, user_id, role').in('class_id', classIds);
  if (!members || members.length === 0) return [];

  const userMap = new Map<string, { role: 'student' | 'teacher_assistant'; class_ids: string[] }>();
  for (const m of members as Array<{ class_id: string; user_id: string; role: string }>) {
    const existing = userMap.get(m.user_id);
    if (existing) {
      existing.class_ids.push(m.class_id);
      if (m.role === 'teacher_assistant') existing.role = 'teacher_assistant';
    } else {
      userMap.set(m.user_id, { role: m.role as 'student' | 'teacher_assistant', class_ids: [m.class_id] });
    }
  }

  const userIds = Array.from(userMap.keys());
  const { data: profiles } = await supabase.from('profiles').select('id, username, first_name, last_name, email').in('id', userIds);

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

// ─── Student-Parent links for parent reports ─────────────────────────────────

export interface StudentParentInfo {
  student_id: string;
  student_username: string;
  parent_id: string;
  parent_username: string;
  parent_email: string;
  class_names: string[];
}

export async function getStudentParentLinks(): Promise<StudentParentInfo[]> {
  const users = await getAllTeacherUsers();
  const studentIds = users.filter(u => u.role === 'student').map(u => u.user_id);
  if (studentIds.length === 0) return [];

  const supabase = requireSupabase();
  const { data: links } = await supabase.from('parent_student_links').select('parent_id, student_id').in('student_id', studentIds);
  if (!links || links.length === 0) return [];

  const parentIds = (links as { parent_id: string }[]).map(l => l.parent_id);
  const { data: parentProfiles } = await supabase.from('profiles').select('id, username, email').in('id', parentIds);
  const parentMap = new Map((parentProfiles ?? []).map((p: Record<string, unknown>) => [String(p.id), { username: String(p.username ?? ''), email: String(p.email ?? '') }]));

  const studentMap = new Map(users.map(u => [u.user_id, u]));

  return (links as { parent_id: string; student_id: string }[]).map(l => {
    const student = studentMap.get(l.student_id);
    const parent = parentMap.get(l.parent_id);
    return {
      student_id: l.student_id,
      student_username: student?.username ?? l.student_id,
      parent_id: l.parent_id,
      parent_username: parent?.username ?? l.parent_id,
      parent_email: parent?.email ?? '',
      class_names: student?.class_names ?? [],
    };
  });
}

// ─── Quiz Results for a Class ────────────────────────────────────────────────

export async function getClassQuizResults(classId: string): Promise<StudentQuizResult[]> {
  const supabase = requireSupabase();

  // get quizzes in this class
  const { data: quizzes } = await supabase
    .from('class_content')
    .select('id, title')
    .eq('class_id', classId)
    .eq('content_type', 'quiz')
    .is('deleted_at', null);
  if (!quizzes || quizzes.length === 0) return [];

  const quizIds = (quizzes as { id: string }[]).map(q => q.id);
  const quizTitleMap = new Map((quizzes as { id: string; title: string }[]).map(q => [q.id, q.title]));

  const { data: attempts } = await supabase
    .from('quiz_attempts')
    .select('*')
    .in('quiz_id', quizIds);
  if (!attempts || attempts.length === 0) return [];

  const studentIds = [...new Set((attempts as { student_id: string }[]).map(a => a.student_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', studentIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  return (attempts as Record<string, unknown>[]).map(a => ({
    student_id: String(a.student_id),
    username: pMap.get(String(a.student_id)) ?? String(a.student_id),
    quiz_id: String(a.quiz_id),
    quiz_title: quizTitleMap.get(String(a.quiz_id)) ?? '',
    score: typeof a.score === 'number' ? a.score : null,
    status: a.status as 'in_progress' | 'submitted' | 'graded',
    submitted_at: typeof a.submitted_at === 'string' ? a.submitted_at : null,
  }));
}
