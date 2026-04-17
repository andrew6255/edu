import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMyClasses,
  getClassContent,
  getMyQuizAttempt,
  startQuizAttempt,
  saveQuizAnswers,
  submitQuizAttempt,
  type StudentClass,
  type StudentContentItem,
  type QuizAttemptRow,
} from '@/lib/studentService';
import { getMyClassStats, type MyClassStats } from '@/lib/statsService';

const ACCENT = '#3b82f6';

const cardStyle: React.CSSProperties = {
  background: '#1e293b', borderRadius: 10, border: '1px solid #334155', overflow: 'hidden',
};

interface Question {
  id: string;
  prompt: string;
  answer?: string;
  type?: string;
  manually_graded?: boolean;
}

interface ClassesViewProps {
  pendingContentId?: string | null;
  pendingContentType?: string | null;
  onPendingHandled?: () => void;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function ClassesView({ pendingContentId, pendingContentType, onPendingHandled }: ClassesViewProps = {}) {
  const { user, userData } = useAuth();
  const [classes, setClasses] = useState<StudentClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState<StudentClass | null>(null);
  const [content, setContent] = useState<StudentContentItem[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentFilter, setContentFilter] = useState<'all' | 'program' | 'assignment' | 'quiz'>('all');

  // quiz state
  const [activeQuiz, setActiveQuiz] = useState<StudentContentItem | null>(null);
  const [attempt, setAttempt] = useState<QuizAttemptRow | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  // assignment viewing
  const [viewingAssignment, setViewingAssignment] = useState<StudentContentItem | null>(null);

  // stats
  const [myStats, setMyStats] = useState<MyClassStats | null>(null);

  useEffect(() => {
    loadClasses();
  }, []);

  // Handle pending content from universe deep-link
  useEffect(() => {
    if (!pendingContentId || !pendingContentType || loading) return;
    // Find the content item across all classes
    async function openPending() {
      try {
        const { getAllMyContent } = await import('@/lib/studentService');
        const allContent = await getAllMyContent();
        const item = allContent.find(c => c.id === pendingContentId);
        if (!item) { onPendingHandled?.(); return; }
        // Map to StudentContentItem shape
        const mapped: StudentContentItem = {
          id: item.id,
          class_id: item.class_id,
          content_type: item.content_type,
          title: item.title,
          subject: item.subject,
          cover_emoji: item.cover_emoji,
          questions: item.questions,
          time_limit_minutes: item.time_limit_minutes,
          builder_spec: item.builder_spec,
          toc: item.toc,
          annotations: item.annotations,
          program_meta: item.program_meta,
          question_banks_by_chapter: item.question_banks_by_chapter,
          ranked_total_question_count: item.ranked_total_question_count,
          created_at: item.created_at,
        };
        if (pendingContentType === 'quiz') openQuiz(mapped);
        else if (pendingContentType === 'assignment') setViewingAssignment(mapped);
      } catch (e) { console.error('Failed to open pending content:', e); }
      finally { onPendingHandled?.(); }
    }
    openPending();
  }, [pendingContentId, pendingContentType, loading]);

  async function loadClasses() {
    setLoading(true);
    try { setClasses(await getMyClasses()); } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function openClass(cls: StudentClass) {
    setSelectedClass(cls);
    setLoadingContent(true);
    setMyStats(null);
    try {
      const [c, s] = await Promise.all([getClassContent(cls.id), getMyClassStats(cls.id)]);
      setContent(c);
      setMyStats(s);
    } catch (e) { console.error(e); }
    finally { setLoadingContent(false); }
  }

  // ─── Quiz Logic ──────────────────────────────────────────────────────────

  async function openQuiz(item: StudentContentItem) {
    if (!user) return;
    try {
      const existing = await getMyQuizAttempt(item.id);
      if (existing && (existing.status === 'submitted' || existing.status === 'graded')) {
        setAttempt(existing);
        setActiveQuiz(item);
        setQuizSubmitted(true);
        setAnswers((existing.answers ?? {}) as Record<string, string>);
        return;
      }
      if (existing && existing.status === 'in_progress') {
        setAttempt(existing);
        setActiveQuiz(item);
        setQuizSubmitted(false);
        setAnswers((existing.answers ?? {}) as Record<string, string>);
        startTimer(existing);
        return;
      }
      // no attempt yet — confirm start
      if (!window.confirm(`Start quiz "${item.title}"?${item.time_limit_minutes ? ` Time limit: ${item.time_limit_minutes} minutes.` : ''} You only get one attempt.`)) return;
      const att = await startQuizAttempt(item.id, user.uid, item.time_limit_minutes);
      setAttempt(att);
      setActiveQuiz(item);
      setQuizSubmitted(false);
      setAnswers({});
      startTimer(att);
    } catch (e) {
      window.alert('Failed to open quiz: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  function startTimer(att: QuizAttemptRow) {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!att.time_limit_minutes) { setTimeLeft(null); return; }
    const deadline = new Date(att.started_at).getTime() + att.time_limit_minutes * 60000;
    function tick() {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0 && timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    tick();
    timerRef.current = window.setInterval(tick, 1000);
  }

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  // auto-submit when time runs out
  useEffect(() => {
    if (timeLeft === 0 && attempt && !quizSubmitted) {
      handleSubmitQuiz();
    }
  }, [timeLeft]);

  async function handleSaveQuiz() {
    if (!attempt) return;
    try { await saveQuizAnswers(attempt.id, answers); } catch (e) { console.error(e); }
  }

  const handleSubmitQuiz = useCallback(async () => {
    if (!attempt || quizSubmitted) return;
    if (timeLeft !== 0 && !window.confirm('Submit quiz? You cannot change your answers after.')) return;
    try {
      await submitQuizAttempt(attempt.id, answers);
      setQuizSubmitted(true);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    } catch (e) {
      window.alert('Submit failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [attempt, answers, quizSubmitted, timeLeft]);

  async function closeQuiz() {
    // Auto-submit if not already submitted
    if (attempt && !quizSubmitted) {
      try {
        await submitQuizAttempt(attempt.id, answers);
      } catch (e) { console.error('Auto-submit on exit failed:', e); }
    }
    setActiveQuiz(null);
    setAttempt(null);
    setAnswers({});
    setQuizSubmitted(false);
    setTimeLeft(null);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  // Auto-submit on page unload (browser close/refresh)
  useEffect(() => {
    if (!attempt || quizSubmitted) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      // Best-effort submit via sendBeacon
      e.preventDefault();
      e.returnValue = 'You have an active quiz. Leaving will submit it.';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [attempt, quizSubmitted]);

  // ─── Quiz Rendering ─────────────────────────────────────────────────────

  if (activeQuiz && attempt) {
    const questions: Question[] = Array.isArray(activeQuiz.questions) ? activeQuiz.questions as Question[] : [];
    const mins = timeLeft != null ? Math.floor(timeLeft / 60) : null;
    const secs = timeLeft != null ? timeLeft % 60 : null;
    const isUrgent = timeLeft != null && timeLeft <= 60;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
        {/* Quiz header */}
        <div style={{ padding: '12px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, color: 'white', fontSize: 16 }}>📋 {activeQuiz.title}</h3>
            <div style={{ color: '#64748b', fontSize: 11 }}>{questions.length} questions{quizSubmitted ? ' · Submitted' : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {timeLeft != null && !quizSubmitted && (
              <span style={{
                fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace',
                color: isUrgent ? '#ef4444' : '#f59e0b',
                animation: isUrgent ? 'pulse 1s infinite' : 'none',
              }}>
                {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
              </span>
            )}
            {!quizSubmitted && (
              <>
                <button onClick={handleSaveQuiz} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>Save</button>
                <button onClick={handleSubmitQuiz} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#10b981', cursor: 'pointer' }}>Submit</button>
              </>
            )}
            <button onClick={closeQuiz} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef444455', color: '#f87171', cursor: 'pointer' }}>
              {quizSubmitted ? 'Close' : 'Exit'}
            </button>
          </div>
        </div>

        {/* Quiz score banner (if graded) */}
        {attempt.status === 'graded' && attempt.score != null && (
          <div style={{ padding: '10px 18px', background: 'rgba(16,185,129,0.1)', borderBottom: '1px solid rgba(16,185,129,0.3)', textAlign: 'center' }}>
            <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: 18 }}>Score: {attempt.score}</span>
          </div>
        )}

        {/* Questions */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {questions.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>No questions in this quiz.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {questions.map((q, i) => (
                <div key={q.id} style={{ ...cardStyle, padding: '14px 16px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', marginBottom: 6 }}>Question {i + 1}{q.manually_graded ? ' · Manual grading' : ''}</div>
                  <div style={{ color: 'white', fontSize: 14, marginBottom: 10, lineHeight: 1.5 }}>{q.prompt}</div>
                  {quizSubmitted ? (
                    <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.3)', color: '#e2e8f0', fontSize: 13 }}>
                      Your answer: <strong>{answers[q.id] || '(no answer)'}</strong>
                    </div>
                  ) : (
                    <input
                      value={answers[q.id] || ''}
                      onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder="Type your answer..."
                      style={{ width: '100%', padding: '10px 13px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Assignment Viewing ─────────────────────────────────────────────────

  if (viewingAssignment) {
    const questions: Question[] = Array.isArray(viewingAssignment.questions) ? viewingAssignment.questions as Question[] : [];
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, color: 'white', fontSize: 16 }}>📝 {viewingAssignment.title}</h3>
            <div style={{ color: '#64748b', fontSize: 11 }}>{questions.length} questions · {viewingAssignment.subject}</div>
          </div>
          <button onClick={() => setViewingAssignment(null)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>← Back</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {questions.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>No questions in this quest.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {questions.map((q, i) => (
                <div key={q.id} style={{ ...cardStyle, padding: '14px 16px' }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', marginBottom: 6 }}>Question {i + 1}</div>
                  <div style={{ color: 'white', fontSize: 14, lineHeight: 1.5 }}>{q.prompt}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Class Detail ───────────────────────────────────────────────────────

  if (selectedClass) {
    const filtered = contentFilter === 'all' ? content : content.filter(c => c.content_type === contentFilter);
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0, color: 'white', fontSize: 17 }}>🏫 {selectedClass.name}</h3>
              <div style={{ color: '#64748b', fontSize: 11 }}>
                Teacher: <span style={{ color: '#10b981' }}>{selectedClass.teacher_username || selectedClass.teacher_name}</span>
                {' · '}{content.length} item{content.length !== 1 ? 's' : ''}
              </div>
            </div>
            <button onClick={() => { setSelectedClass(null); setContent([]); }} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>← Back</button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'program', 'assignment', 'quiz'] as const).map(f => {
              const count = f === 'all' ? content.length : content.filter(c => c.content_type === f).length;
              return (
                <button key={f} onClick={() => setContentFilter(f)} style={{
                  padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 'bold', fontFamily: 'inherit',
                  background: contentFilter === f ? `${ACCENT}22` : 'transparent',
                  border: `1px solid ${contentFilter === f ? `${ACCENT}55` : '#33415555'}`,
                  color: contentFilter === f ? ACCENT : '#64748b', cursor: 'pointer',
                }}>
                  {f === 'all' ? 'All' : f === 'program' ? '📘 Programs' : f === 'assignment' ? '📝 Quests' : '📋 Quizzes'} ({count})
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {/* Stats banner */}
          {myStats && !loadingContent && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {[
                { label: 'Quizzes Taken', value: myStats.quizzes_taken, icon: '📋', color: '#f59e0b' },
                { label: 'Avg Score', value: myStats.quizzes_graded > 0 ? myStats.avg_score : '—', icon: '⭐', color: '#10b981' },
                { label: 'Questions Solved', value: myStats.questions_solved, icon: '✅', color: '#3b82f6' },
                { label: 'Correct', value: myStats.questions_correct, icon: '🎯', color: '#a78bfa' },
              ].map(s => (
                <div key={s.label} style={{ flex: '1 1 100px', ...cardStyle, padding: '10px 12px', textAlign: 'center', minWidth: 80 }}>
                  <div style={{ fontSize: 18, marginBottom: 2 }}>{s.icon}</div>
                  <div style={{ color: s.color, fontWeight: 'bold', fontSize: 18 }}>{s.value}</div>
                  <div style={{ color: '#64748b', fontSize: 10, fontWeight: 'bold' }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {loadingContent ? (
            <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>📚</div>
              <div>No content available yet.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map(item => {
                const typeIcon = item.content_type === 'program' ? '📘' : item.content_type === 'assignment' ? '📝' : '📋';
                const typeLabel = item.content_type === 'program' ? 'Program' : item.content_type === 'assignment' ? 'Quest' : 'Quiz';
                const qCount = Array.isArray(item.questions) ? item.questions.length : 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (item.content_type === 'quiz') openQuiz(item);
                      else if (item.content_type === 'assignment') setViewingAssignment(item);
                      // programs: use existing program map view via custom event
                      else if (item.content_type === 'program') {
                        window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'programMap', programId: item.id } }));
                      }
                    }}
                    style={{ ...cardStyle, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}
                  >
                    <div style={{ fontSize: 26, flexShrink: 0 }}>{item.cover_emoji || typeIcon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{item.title}</div>
                      <div style={{ color: '#64748b', fontSize: 11 }}>
                        {typeLabel} · {item.subject}
                        {item.content_type !== 'program' && ` · ${qCount} question${qCount !== 1 ? 's' : ''}`}
                        {item.content_type === 'quiz' && item.time_limit_minutes && ` · ${item.time_limit_minutes}min`}
                      </div>
                    </div>
                    <span style={{ color: '#475569', fontSize: 18 }}>→</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Classes List ───────────────────────────────────────────────────────

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
        <h2 style={{ margin: 0, color: 'white', fontSize: 18 }}>🏫 My Classes</h2>
        <div style={{ color: '#64748b', fontSize: 12 }}>{classes.length} enrolled class{classes.length !== 1 ? 'es' : ''}</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {loading ? (
          <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30 }}>Loading classes...</div>
        ) : classes.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🏫</div>
            <div>You're not enrolled in any classes yet.</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>Ask your admin to add you to a class.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {classes.map(cls => (
              <button
                key={cls.id}
                onClick={() => openClass(cls)}
                style={{ ...cardStyle, padding: '16px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                  background: `hsl(${(cls.name.charCodeAt(0) || 65) * 37 % 360}, 50%, 25%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 'bold', color: 'white',
                }}>
                  🏫
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'white', fontWeight: 'bold', fontSize: 15 }}>{cls.name}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>
                    Teacher: <span style={{ color: '#10b981' }}>{cls.teacher_username || cls.teacher_name}</span>
                  </div>
                </div>
                <span style={{ color: '#475569', fontSize: 18 }}>→</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
