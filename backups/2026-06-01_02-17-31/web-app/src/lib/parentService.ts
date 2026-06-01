import { requireSupabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LinkedStudent {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
}

export interface ParentClassRow {
  id: string;
  name: string;
  teacher_username: string;
}

export interface ParentQuizScore {
  quiz_id: string;
  quiz_title: string;
  score: number | null;
  status: 'in_progress' | 'submitted' | 'graded';
  submitted_at: string | null;
}

export interface ParentClassStats {
  class_id: string;
  quizzes_taken: number;
  quizzes_graded: number;
  avg_score: number;
  questions_solved: number;
  questions_correct: number;
}

// ─── Get Linked Student(s) ───────────────────────────────────────────────────

export async function getLinkedStudent(): Promise<LinkedStudent | null> {
  const students = await getLinkedStudents();
  return students.length > 0 ? students[0] : null;
}

export async function getLinkedStudents(): Promise<LinkedStudent[]> {
  const supabase = requireSupabase();
  const { data: links, error } = await supabase
    .from('parent_student_links')
    .select('student_id');
  if (error) throw error;
  if (!links || links.length === 0) return [];

  const ids = links.map(l => (l as { student_id: string }).student_id);
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, username, first_name, last_name, email')
    .in('id', ids);
  if (pErr) throw pErr;
  return (profiles || []).map(p => {
    const r = p as Record<string, unknown>;
    return {
      id: String(r.id),
      username: String(r.username ?? ''),
      first_name: String(r.first_name ?? ''),
      last_name: String(r.last_name ?? ''),
      email: String(r.email ?? ''),
    };
  });
}

// ─── Student's Classes ───────────────────────────────────────────────────────

export async function getStudentClasses(studentId: string): Promise<ParentClassRow[]> {
  const supabase = requireSupabase();
  const { data: memberships } = await supabase
    .from('class_members')
    .select('class_id')
    .eq('user_id', studentId)
    .eq('role', 'student');
  if (!memberships || memberships.length === 0) return [];

  const classIds = memberships.map((m: { class_id: string }) => m.class_id);
  const { data: classes } = await supabase
    .from('classes')
    .select('*')
    .in('id', classIds)
    .order('created_at', { ascending: false });
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
    teacher_username: pMap.get(String(c.teacher_id)) ?? '',
  }));
}

// ─── Quiz Scores for Student in a Class ──────────────────────────────────────

export async function getStudentQuizScores(classId: string, studentId: string): Promise<ParentQuizScore[]> {
  const supabase = requireSupabase();
  const { data: quizzes } = await supabase
    .from('class_content')
    .select('id, title')
    .eq('class_id', classId)
    .eq('content_type', 'quiz')
    .eq('status', 'published')
    .is('deleted_at', null);
  if (!quizzes || quizzes.length === 0) return [];

  const quizIds = (quizzes as { id: string }[]).map(q => q.id);
  const quizTitleMap = new Map((quizzes as { id: string; title: string }[]).map(q => [q.id, q.title]));

  const { data: attempts } = await supabase
    .from('quiz_attempts')
    .select('*')
    .in('quiz_id', quizIds)
    .eq('student_id', studentId);

  return (attempts ?? []).map((a: Record<string, unknown>) => ({
    quiz_id: String(a.quiz_id),
    quiz_title: quizTitleMap.get(String(a.quiz_id)) ?? '',
    score: typeof a.score === 'number' ? a.score : null,
    status: a.status as 'in_progress' | 'submitted' | 'graded',
    submitted_at: typeof a.submitted_at === 'string' ? a.submitted_at : null,
  }));
}

// ─── Content Progress (programs, assignments, quizzes) ──────────────────────

export interface ContentProgressItem {
  content_id: string;
  content_type: 'program' | 'assignment' | 'quiz';
  title: string;
  class_name: string;
  total_questions: number;
  answered_questions: number;
  correct_questions: number;
  pct: number;
  quiz_status?: 'in_progress' | 'submitted' | 'graded' | null;
  quiz_score?: number | null;
}

export async function getStudentContentProgress(studentId: string): Promise<ContentProgressItem[]> {
  const supabase = requireSupabase();

  // Get student's classes
  const { data: memberships } = await supabase.from('class_members').select('class_id').eq('user_id', studentId).eq('role', 'student');
  if (!memberships || memberships.length === 0) return [];

  const classIds = memberships.map((m: { class_id: string }) => m.class_id);
  const { data: classes } = await supabase.from('classes').select('id, name').in('id', classIds);
  const classNameMap = new Map((classes ?? []).map((c: Record<string, unknown>) => [String(c.id), String(c.name)]));

  const { data: contentRows } = await supabase
    .from('class_content')
    .select('id, class_id, content_type, title, questions')
    .in('class_id', classIds)
    .eq('status', 'published')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (!contentRows || contentRows.length === 0) return [];

  const contentIds = (contentRows as { id: string }[]).map(c => c.id);

  // Get question progress
  const { data: progress } = await supabase.from('class_question_progress').select('content_id, question_id, solved, is_correct').in('content_id', contentIds).eq('user_id', studentId);
  const progressByContent = new Map<string, { answered: number; correct: number }>();
  (progress ?? []).forEach((p: Record<string, unknown>) => {
    const cid = String(p.content_id);
    const existing = progressByContent.get(cid) || { answered: 0, correct: 0 };
    if (p.solved) existing.answered++;
    if (p.is_correct) existing.correct++;
    progressByContent.set(cid, existing);
  });

  // Get quiz attempts
  const quizContentIds = (contentRows as Record<string, unknown>[]).filter(c => c.content_type === 'quiz').map(c => String(c.id));
  let quizAttemptMap = new Map<string, { status: string; score: number | null }>();
  if (quizContentIds.length > 0) {
    const { data: attempts } = await supabase.from('quiz_attempts').select('quiz_id, status, score').in('quiz_id', quizContentIds).eq('student_id', studentId);
    quizAttemptMap = new Map((attempts ?? []).map((a: Record<string, unknown>) => [
      String(a.quiz_id),
      { status: String(a.status), score: typeof a.score === 'number' ? a.score : null },
    ]));
  }

  return (contentRows as Record<string, unknown>[]).map(c => {
    const questions = Array.isArray(c.questions) ? c.questions : [];
    const total = questions.length;
    const prog = progressByContent.get(String(c.id));
    const answered = prog?.answered ?? 0;
    const correct = prog?.correct ?? 0;
    const attempt = quizAttemptMap.get(String(c.id));
    return {
      content_id: String(c.id),
      content_type: c.content_type as 'program' | 'assignment' | 'quiz',
      title: String(c.title),
      class_name: classNameMap.get(String(c.class_id)) || '',
      total_questions: total,
      answered_questions: answered,
      correct_questions: correct,
      pct: total > 0 ? Math.round((answered / total) * 100) : (attempt?.status === 'submitted' || attempt?.status === 'graded' ? 100 : 0),
      quiz_status: attempt?.status as ContentProgressItem['quiz_status'] ?? null,
      quiz_score: attempt?.score ?? null,
    };
  });
}

// ─── Get teachers for multiple chat rooms ──────────────────────────────────

export interface ParentTeacherChat {
  class_id: string;
  class_name: string;
  teacher_id: string;
  teacher_username: string;
}

export async function getStudentTeacherChats(studentId: string): Promise<ParentTeacherChat[]> {
  const supabase = requireSupabase();
  const { data: memberships } = await supabase.from('class_members').select('class_id').eq('user_id', studentId).eq('role', 'student');
  if (!memberships || memberships.length === 0) return [];

  const classIds = memberships.map((m: { class_id: string }) => m.class_id);
  const { data: classes } = await supabase.from('classes').select('id, name, teacher_id').in('id', classIds);
  if (!classes || classes.length === 0) return [];

  const teacherIds = [...new Set((classes as { teacher_id: string }[]).map(c => c.teacher_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', teacherIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  return (classes as Record<string, unknown>[]).map(c => ({
    class_id: String(c.id),
    class_name: String(c.name),
    teacher_id: String(c.teacher_id),
    teacher_username: pMap.get(String(c.teacher_id)) ?? '',
  }));
}

// ─── Aggregate Stats for Student in a Class ──────────────────────────────────

export async function getStudentClassStats(classId: string, studentId: string): Promise<ParentClassStats> {
  const supabase = requireSupabase();

  const { data: contentRows } = await supabase
    .from('class_content')
    .select('id')
    .eq('class_id', classId)
    .is('deleted_at', null);
  const contentIds = (contentRows ?? []).map((r: { id: string }) => r.id);

  let quizzes_taken = 0, quizzes_graded = 0, total_score = 0;
  if (contentIds.length > 0) {
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('*')
      .in('quiz_id', contentIds)
      .eq('student_id', studentId);
    (attempts ?? []).forEach((a: Record<string, unknown>) => {
      if (a.status === 'submitted' || a.status === 'graded') quizzes_taken++;
      if (a.status === 'graded' && typeof a.score === 'number') { quizzes_graded++; total_score += a.score; }
    });
  }

  let questions_solved = 0, questions_correct = 0;
  if (contentIds.length > 0) {
    const { data: progress } = await supabase
      .from('class_question_progress')
      .select('*')
      .in('content_id', contentIds)
      .eq('user_id', studentId);
    (progress ?? []).forEach((p: Record<string, unknown>) => {
      if (p.solved) questions_solved++;
      if (p.is_correct) questions_correct++;
    });
  }

  return {
    class_id: classId,
    quizzes_taken,
    quizzes_graded,
    avg_score: quizzes_graded > 0 ? Math.round(total_score / quizzes_graded * 10) / 10 : 0,
    questions_solved,
    questions_correct,
  };
}
