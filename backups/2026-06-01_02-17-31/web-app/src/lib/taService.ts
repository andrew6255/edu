import { requireSupabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TAClassRow {
  id: string;
  name: string;
  teacher_id: string;
  teacher_username: string;
  created_at: string;
}

export interface SubmissionRow {
  attempt_id: string;
  quiz_id: string;
  quiz_title: string;
  student_id: string;
  student_username: string;
  answers: Record<string, unknown> | null;
  score: number | null;
  status: 'in_progress' | 'submitted' | 'graded';
  submitted_at: string | null;
  time_limit_minutes: number | null;
  questions: unknown[];
}

export interface QuestionProgressRow {
  user_id: string;
  content_id: string;
  question_id: string;
  solved: boolean;
  answer: unknown;
  is_correct: boolean | null;
  manually_graded: boolean;
  graded_by: string | null;
  graded_at: string | null;
  last_answered_at: string | null;
}

// ─── My Classes (via class_members where role = teacher_assistant) ────────────

export async function getTAClasses(): Promise<TAClassRow[]> {
  const supabase = requireSupabase();
  const { data: memberships, error: mErr } = await supabase
    .from('class_members')
    .select('class_id')
    .eq('role', 'teacher_assistant');
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

  const teacherIds = [...new Set((classes as { teacher_id: string }[]).map(c => c.teacher_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', teacherIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  return (classes as Record<string, unknown>[]).map(c => ({
    id: String(c.id),
    name: String(c.name),
    teacher_id: String(c.teacher_id),
    teacher_username: pMap.get(String(c.teacher_id)) ?? '',
    created_at: String(c.created_at),
  }));
}

// ─── Submissions to Grade ────────────────────────────────────────────────────

export async function getClassSubmissions(classId: string): Promise<SubmissionRow[]> {
  const supabase = requireSupabase();

  // get quizzes + assignments in class
  const { data: contentRows } = await supabase
    .from('class_content')
    .select('id, title, content_type, questions')
    .eq('class_id', classId)
    .in('content_type', ['quiz', 'assignment'])
    .is('deleted_at', null);
  if (!contentRows || contentRows.length === 0) return [];

  const quizIds = (contentRows as { id: string }[]).map(c => c.id);
  const contentMap = new Map((contentRows as Record<string, unknown>[]).map(c => [
    String(c.id),
    { title: String(c.title), questions: Array.isArray(c.questions) ? c.questions : [] },
  ]));

  // get quiz attempts
  const { data: attempts } = await supabase
    .from('quiz_attempts')
    .select('*')
    .in('quiz_id', quizIds)
    .order('submitted_at', { ascending: false });
  if (!attempts || attempts.length === 0) return [];

  const studentIds = [...new Set((attempts as { student_id: string }[]).map(a => a.student_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', studentIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  return (attempts as Record<string, unknown>[]).map(a => {
    const cm = contentMap.get(String(a.quiz_id));
    return {
      attempt_id: String(a.id),
      quiz_id: String(a.quiz_id),
      quiz_title: cm?.title ?? '',
      student_id: String(a.student_id),
      student_username: pMap.get(String(a.student_id)) ?? String(a.student_id),
      answers: (a.answers as Record<string, unknown>) ?? null,
      score: typeof a.score === 'number' ? a.score : null,
      status: a.status as 'in_progress' | 'submitted' | 'graded',
      submitted_at: typeof a.submitted_at === 'string' ? a.submitted_at : null,
      time_limit_minutes: typeof a.time_limit_minutes === 'number' ? a.time_limit_minutes : null,
      questions: cm?.questions ?? [],
    };
  });
}

// ─── Class Content for TA ─────────────────────────────────────────────────────

export interface TAContentRow {
  id: string;
  content_type: 'program' | 'assignment' | 'quiz';
  title: string;
  subject: string;
  status: 'draft' | 'published';
  cover_emoji: string | null;
  questions_count: number;
  time_limit_minutes: number | null;
  created_at: string;
}

export async function getTAClassContent(classId: string): Promise<TAContentRow[]> {
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
    title: String(r.title ?? ''),
    subject: String(r.subject ?? ''),
    status: r.status as 'draft' | 'published',
    cover_emoji: typeof r.cover_emoji === 'string' ? r.cover_emoji : null,
    questions_count: Array.isArray(r.questions) ? r.questions.length : 0,
    time_limit_minutes: typeof r.time_limit_minutes === 'number' ? r.time_limit_minutes : null,
    created_at: String(r.created_at),
  }));
}

// ─── Student-Parent Links for TA ─────────────────────────────────────────────

export interface TAStudentParentInfo {
  student_id: string;
  student_username: string;
  parent_id: string;
  parent_username: string;
  parent_email: string;
  class_names: string[];
}

export async function getStudentParentLinksForTA(): Promise<TAStudentParentInfo[]> {
  const supabase = requireSupabase();
  const classes = await getTAClasses();
  if (classes.length === 0) return [];

  const classIds = classes.map(c => c.id);
  const classNameMap = new Map(classes.map(c => [c.id, c.name]));

  const { data: members } = await supabase.from('class_members').select('class_id, user_id').eq('role', 'student').in('class_id', classIds);
  if (!members || members.length === 0) return [];

  // aggregate student → class names
  const studentClassMap = new Map<string, string[]>();
  for (const m of members as { class_id: string; user_id: string }[]) {
    const existing = studentClassMap.get(m.user_id) || [];
    existing.push(classNameMap.get(m.class_id) || m.class_id);
    studentClassMap.set(m.user_id, existing);
  }

  const studentIds = Array.from(studentClassMap.keys());
  const { data: links } = await supabase.from('parent_student_links').select('parent_id, student_id').in('student_id', studentIds);
  if (!links || links.length === 0) return [];

  const parentIds = (links as { parent_id: string }[]).map(l => l.parent_id);
  const allIds = [...new Set([...studentIds, ...parentIds])];
  const { data: profiles } = await supabase.from('profiles').select('id, username, email').in('id', allIds);
  const profileMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), { username: String(p.username ?? ''), email: String(p.email ?? '') }]));

  return (links as { parent_id: string; student_id: string }[]).map(l => ({
    student_id: l.student_id,
    student_username: profileMap.get(l.student_id)?.username ?? l.student_id,
    parent_id: l.parent_id,
    parent_username: profileMap.get(l.parent_id)?.username ?? l.parent_id,
    parent_email: profileMap.get(l.parent_id)?.email ?? '',
    class_names: studentClassMap.get(l.student_id) ?? [],
  }));
}

// ─── Grade a Quiz Attempt ────────────────────────────────────────────────────

export async function gradeQuizAttempt(attemptId: string, score: number): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('quiz_attempts')
    .update({ score, status: 'graded' })
    .eq('id', attemptId);
  if (error) throw error;
}

// ─── Grade Individual Question Progress ──────────────────────────────────────

export async function gradeQuestionProgress(
  userId: string, contentId: string, questionId: string,
  isCorrect: boolean, graderId: string,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('class_question_progress')
    .upsert({
      user_id: userId,
      content_id: contentId,
      question_id: questionId,
      is_correct: isCorrect,
      manually_graded: true,
      graded_by: graderId,
      graded_at: new Date().toISOString(),
      solved: true,
    });
  if (error) throw error;
}

// ─── Get Question Progress for a Content+Student ─────────────────────────────

export async function getStudentQuestionProgress(
  contentId: string, studentId: string,
): Promise<QuestionProgressRow[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('class_question_progress')
    .select('*')
    .eq('content_id', contentId)
    .eq('user_id', studentId);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    user_id: String(r.user_id),
    content_id: String(r.content_id),
    question_id: String(r.question_id),
    solved: !!r.solved,
    answer: r.answer,
    is_correct: typeof r.is_correct === 'boolean' ? r.is_correct : null,
    manually_graded: !!r.manually_graded,
    graded_by: typeof r.graded_by === 'string' ? r.graded_by : null,
    graded_at: typeof r.graded_at === 'string' ? r.graded_at : null,
    last_answered_at: typeof r.last_answered_at === 'string' ? r.last_answered_at : null,
  }));
}
