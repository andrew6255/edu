import { requireSupabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StudentClass {
  id: string;
  name: string;
  teacher_id: string;
  teacher_username: string;
  teacher_name: string;
  created_at: string;
}

export interface StudentContentItem {
  id: string;
  class_id: string;
  content_type: 'program' | 'assignment' | 'quiz';
  title: string;
  subject: string;
  cover_emoji: string | null;
  questions: unknown;
  time_limit_minutes: number | null;
  builder_spec: unknown;
  toc: unknown;
  annotations: unknown;
  program_meta: unknown;
  question_banks_by_chapter: unknown;
  ranked_total_question_count: number;
  created_at: string;
}

export interface QuizAttemptRow {
  id: string;
  quiz_id: string;
  student_id: string;
  started_at: string;
  submitted_at: string | null;
  time_limit_minutes: number | null;
  answers: Record<string, unknown> | null;
  score: number | null;
  status: 'in_progress' | 'submitted' | 'graded';
}

// ─── My Classes ──────────────────────────────────────────────────────────────

export async function getMyClasses(): Promise<StudentClass[]> {
  const supabase = requireSupabase();
  // class_members RLS allows students to read their own memberships
  const { data: memberships, error: mErr } = await supabase
    .from('class_members')
    .select('class_id')
    .eq('role', 'student');
  if (mErr) throw mErr;
  if (!memberships || memberships.length === 0) return [];

  const classIds = memberships.map((m: { class_id: string }) => m.class_id);
  const { data: classes, error: cErr } = await supabase
    .from('classes')
    .select('*')
    .in('id', classIds)
    .order('created_at', { ascending: false });
  if (cErr) throw cErr;
  if (!classes || classes.length === 0) return [];

  // fetch teacher profiles
  const teacherIds = [...new Set((classes as { teacher_id: string }[]).map(c => c.teacher_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, first_name, last_name')
    .in('id', teacherIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [
    String(p.id), { username: String(p.username ?? ''), name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() }
  ]));

  return (classes as Record<string, unknown>[]).map(c => ({
    id: String(c.id),
    name: String(c.name),
    teacher_id: String(c.teacher_id),
    teacher_username: pMap.get(String(c.teacher_id))?.username || '',
    teacher_name: pMap.get(String(c.teacher_id))?.name || '',
    created_at: String(c.created_at),
  }));
}

// ─── Class Content (published only via RLS) ──────────────────────────────────

export async function getClassContent(classId: string): Promise<StudentContentItem[]> {
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
    class_id: String(r.class_id),
    content_type: r.content_type as 'program' | 'assignment' | 'quiz',
    title: String(r.title ?? ''),
    subject: String(r.subject ?? ''),
    cover_emoji: typeof r.cover_emoji === 'string' ? r.cover_emoji : null,
    questions: r.questions,
    time_limit_minutes: typeof r.time_limit_minutes === 'number' ? r.time_limit_minutes : null,
    builder_spec: r.builder_spec,
    toc: r.toc,
    annotations: r.annotations,
    program_meta: r.program_meta,
    question_banks_by_chapter: r.question_banks_by_chapter,
    ranked_total_question_count: typeof r.ranked_total_question_count === 'number' ? r.ranked_total_question_count : 0,
    created_at: String(r.created_at),
  }));
}

// ─── Quiz Attempts ───────────────────────────────────────────────────────────

export async function getMyQuizAttempt(quizId: string): Promise<QuizAttemptRow | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('*')
    .eq('quiz_id', quizId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapAttempt(data as Record<string, unknown>) : null;
}

export async function startQuizAttempt(quizId: string, studentId: string, timeLimitMinutes: number | null): Promise<QuizAttemptRow> {
  const supabase = requireSupabase();
  const id = 'qa_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('quiz_attempts')
    .insert({
      id, quiz_id: quizId, student_id: studentId,
      started_at: now, time_limit_minutes: timeLimitMinutes,
      answers: {}, status: 'in_progress', created_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return mapAttempt(data as Record<string, unknown>);
}

export async function saveQuizAnswers(attemptId: string, answers: Record<string, unknown>): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('quiz_attempts')
    .update({ answers })
    .eq('id', attemptId);
  if (error) throw error;
}

export async function submitQuizAttempt(attemptId: string, answers: Record<string, unknown>): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('quiz_attempts')
    .update({
      answers,
      submitted_at: new Date().toISOString(),
      status: 'submitted',
    })
    .eq('id', attemptId);
  if (error) throw error;
}

// ─── All content across all classes ──────────────────────────────────────────

export async function getAllMyContent(): Promise<(StudentContentItem & { class_name: string })[]> {
  const supabase = requireSupabase();
  const { data: memberships, error: mErr } = await supabase.from('class_members').select('class_id').eq('role', 'student');
  if (mErr) throw mErr;
  if (!memberships || memberships.length === 0) return [];

  const classIds = memberships.map((m: { class_id: string }) => m.class_id);
  const { data: classes } = await supabase.from('classes').select('id, name').in('id', classIds);
  const classNameMap = new Map((classes ?? []).map((c: Record<string, unknown>) => [String(c.id), String(c.name)]));

  const { data, error } = await supabase
    .from('class_content')
    .select('*')
    .in('class_id', classIds)
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    class_id: String(r.class_id),
    class_name: classNameMap.get(String(r.class_id)) || '',
    content_type: r.content_type as 'program' | 'assignment' | 'quiz',
    title: String(r.title ?? ''),
    subject: String(r.subject ?? ''),
    cover_emoji: typeof r.cover_emoji === 'string' ? r.cover_emoji : null,
    questions: r.questions,
    time_limit_minutes: typeof r.time_limit_minutes === 'number' ? r.time_limit_minutes : null,
    builder_spec: r.builder_spec,
    toc: r.toc,
    annotations: r.annotations,
    program_meta: r.program_meta,
    question_banks_by_chapter: r.question_banks_by_chapter,
    ranked_total_question_count: typeof r.ranked_total_question_count === 'number' ? r.ranked_total_question_count : 0,
    created_at: String(r.created_at),
  }));
}

export async function getMyRunningQuizzes(): Promise<{ running: (StudentContentItem & { class_name: string })[]; finished: { quiz_id: string; score: number | null; status: string }[] }> {
  const allContent = await getAllMyContent();
  const quizzes = allContent.filter(c => c.content_type === 'quiz');
  
  const supabase = requireSupabase();
  const quizIds = quizzes.map(q => q.id);
  if (quizIds.length === 0) return { running: [], finished: [] };

  const { data: attempts } = await supabase.from('quiz_attempts').select('quiz_id, status, score').in('quiz_id', quizIds);
  const attemptMap = new Map((attempts ?? []).map((a: Record<string, unknown>) => [String(a.quiz_id), a]));

  const running = quizzes.filter(q => !attemptMap.has(q.id) || (attemptMap.get(q.id) as Record<string, unknown>)?.status === 'in_progress');
  const finished = (attempts ?? [])
    .filter((a: Record<string, unknown>) => a.status === 'submitted' || a.status === 'graded')
    .map((a: Record<string, unknown>) => ({
      quiz_id: String(a.quiz_id),
      score: typeof a.score === 'number' ? a.score : null,
      status: String(a.status),
    }));

  return { running, finished };
}

function mapAttempt(r: Record<string, unknown>): QuizAttemptRow {
  return {
    id: String(r.id),
    quiz_id: String(r.quiz_id),
    student_id: String(r.student_id),
    started_at: String(r.started_at),
    submitted_at: typeof r.submitted_at === 'string' ? r.submitted_at : null,
    time_limit_minutes: typeof r.time_limit_minutes === 'number' ? r.time_limit_minutes : null,
    answers: (r.answers as Record<string, unknown>) ?? null,
    score: typeof r.score === 'number' ? r.score : null,
    status: r.status as 'in_progress' | 'submitted' | 'graded',
  };
}
