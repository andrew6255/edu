import { requireSupabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StudentQuizScore {
  quiz_id: string;
  quiz_title: string;
  student_id: string;
  student_username: string;
  score: number | null;
  status: 'in_progress' | 'submitted' | 'graded';
  submitted_at: string | null;
}

export interface ClassLeaderboardEntry {
  student_id: string;
  username: string;
  quizzes_taken: number;
  quizzes_graded: number;
  total_score: number;
  avg_score: number;
  questions_solved: number;
}

export interface MyClassStats {
  class_id: string;
  quizzes_taken: number;
  quizzes_graded: number;
  total_score: number;
  avg_score: number;
  questions_solved: number;
  questions_correct: number;
}

// ─── Student: my stats per class ─────────────────────────────────────────────

export async function getMyClassStats(classId: string): Promise<MyClassStats> {
  const supabase = requireSupabase();

  // quiz attempts for content in this class
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
      .in('quiz_id', contentIds);
    (attempts ?? []).forEach((a: Record<string, unknown>) => {
      if (a.status === 'submitted' || a.status === 'graded') quizzes_taken++;
      if (a.status === 'graded' && typeof a.score === 'number') { quizzes_graded++; total_score += a.score; }
    });
  }

  // question progress
  let questions_solved = 0, questions_correct = 0;
  if (contentIds.length > 0) {
    const { data: progress } = await supabase
      .from('class_question_progress')
      .select('*')
      .in('content_id', contentIds);
    (progress ?? []).forEach((p: Record<string, unknown>) => {
      if (p.solved) questions_solved++;
      if (p.is_correct) questions_correct++;
    });
  }

  return {
    class_id: classId,
    quizzes_taken,
    quizzes_graded,
    total_score,
    avg_score: quizzes_graded > 0 ? Math.round(total_score / quizzes_graded * 10) / 10 : 0,
    questions_solved,
    questions_correct,
  };
}

// ─── Admin/Teacher: class leaderboard ────────────────────────────────────────

export async function getClassLeaderboard(classId: string): Promise<ClassLeaderboardEntry[]> {
  const supabase = requireSupabase();

  // get student members
  const { data: members } = await supabase
    .from('class_members')
    .select('user_id')
    .eq('class_id', classId)
    .eq('role', 'student');
  if (!members || members.length === 0) return [];
  const studentIds = members.map((m: { user_id: string }) => m.user_id);

  // get profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', studentIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  // get content IDs for this class
  const { data: contentRows } = await supabase
    .from('class_content')
    .select('id')
    .eq('class_id', classId)
    .is('deleted_at', null);
  const contentIds = (contentRows ?? []).map((r: { id: string }) => r.id);

  // quiz attempts
  const attemptsMap = new Map<string, { taken: number; graded: number; total: number }>();
  if (contentIds.length > 0) {
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('*')
      .in('quiz_id', contentIds)
      .in('student_id', studentIds);
    (attempts ?? []).forEach((a: Record<string, unknown>) => {
      const sid = String(a.student_id);
      const entry = attemptsMap.get(sid) ?? { taken: 0, graded: 0, total: 0 };
      if (a.status === 'submitted' || a.status === 'graded') entry.taken++;
      if (a.status === 'graded' && typeof a.score === 'number') { entry.graded++; entry.total += a.score; }
      attemptsMap.set(sid, entry);
    });
  }

  // question progress
  const progressMap = new Map<string, number>();
  if (contentIds.length > 0) {
    const { data: progress } = await supabase
      .from('class_question_progress')
      .select('*')
      .in('content_id', contentIds)
      .in('user_id', studentIds);
    (progress ?? []).forEach((p: Record<string, unknown>) => {
      const uid = String(p.user_id);
      if (p.solved) progressMap.set(uid, (progressMap.get(uid) ?? 0) + 1);
    });
  }

  const entries: ClassLeaderboardEntry[] = studentIds.map(sid => {
    const att = attemptsMap.get(sid) ?? { taken: 0, graded: 0, total: 0 };
    return {
      student_id: sid,
      username: pMap.get(sid) ?? sid,
      quizzes_taken: att.taken,
      quizzes_graded: att.graded,
      total_score: att.total,
      avg_score: att.graded > 0 ? Math.round(att.total / att.graded * 10) / 10 : 0,
      questions_solved: progressMap.get(sid) ?? 0,
    };
  });

  entries.sort((a, b) => b.avg_score - a.avg_score || b.questions_solved - a.questions_solved);
  return entries;
}

// ─── Admin: quiz scores for a specific quiz ──────────────────────────────────

export async function getQuizScores(quizId: string): Promise<StudentQuizScore[]> {
  const supabase = requireSupabase();

  const { data: quizRow } = await supabase.from('class_content').select('title').eq('id', quizId).single();
  const quizTitle = (quizRow as Record<string, unknown> | null)?.title as string ?? '';

  const { data: attempts, error } = await supabase
    .from('quiz_attempts')
    .select('*')
    .eq('quiz_id', quizId);
  if (error) throw error;
  if (!attempts || attempts.length === 0) return [];

  const studentIds = [...new Set((attempts as { student_id: string }[]).map(a => a.student_id))];
  const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', studentIds);
  const pMap = new Map((profiles ?? []).map((p: Record<string, unknown>) => [String(p.id), String(p.username ?? '')]));

  return (attempts as Record<string, unknown>[]).map(a => ({
    quiz_id: quizId,
    quiz_title: quizTitle,
    student_id: String(a.student_id),
    student_username: pMap.get(String(a.student_id)) ?? String(a.student_id),
    score: typeof a.score === 'number' ? a.score : null,
    status: a.status as 'in_progress' | 'submitted' | 'graded',
    submitted_at: typeof a.submitted_at === 'string' ? a.submitted_at : null,
  }));
}
