import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import {
  getLinkedStudent,
  getStudentClasses,
  getStudentQuizScores,
  getStudentClassStats,
  getStudentContentProgress,
  getStudentTeacherChats,
  type LinkedStudent,
  type ParentClassRow,
  type ParentQuizScore,
  type ParentClassStats,
  type ContentProgressItem,
  type ParentTeacherChat,
} from '@/lib/parentService';
import ChatWidget from '@/components/ChatWidget';
import { requireSupabase } from '@/lib/supabase';

const COLOR = '#ec4899';
const COLOR_DIM = '#ec489955';

const cardStyle: React.CSSProperties = {
  background: '#1e293b', borderRadius: 10, border: '1px solid #334155',
};

export default function ParentPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();

  const [student, setStudent] = useState<LinkedStudent | null>(null);
  const [classes, setClasses] = useState<ParentClassRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [noLink, setNoLink] = useState(false);

  // chat
  const [showChat, setShowChat] = useState(false);
  const [teacherChats, setTeacherChats] = useState<ParentTeacherChat[]>([]);
  const [selectedChat, setSelectedChat] = useState<ParentTeacherChat | null>(null);

  // content progress
  const [contentProgress, setContentProgress] = useState<ContentProgressItem[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [progressFilter, setProgressFilter] = useState<'all' | 'program' | 'assignment' | 'quiz'>('all');

  // class detail
  const [selectedClass, setSelectedClass] = useState<ParentClassRow | null>(null);
  const [quizScores, setQuizScores] = useState<ParentQuizScore[]>([]);
  const [classStats, setClassStats] = useState<ParentClassStats | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // redirect guard
  useEffect(() => {
    if (!loading && !user) setLocation('/auth');
    if (!loading && userData && userData.role !== 'parent') setLocation('/auth');
  }, [user, userData, loading]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoadingData(true);
    try {
      const s = await getLinkedStudent();
      if (!s) { setNoLink(true); setLoadingData(false); return; }
      setStudent(s);
      const [cls, chats] = await Promise.all([getStudentClasses(s.id), getStudentTeacherChats(s.id)]);
      setClasses(cls);
      setTeacherChats(chats);
      // load content progress in background
      setLoadingProgress(true);
      getStudentContentProgress(s.id).then(p => setContentProgress(p)).catch(e => console.error(e)).finally(() => setLoadingProgress(false));
    } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }

  async function openClass(cls: ParentClassRow) {
    if (!student) return;
    setSelectedClass(cls);
    setLoadingDetail(true);
    try {
      const [scores, stats] = await Promise.all([
        getStudentQuizScores(cls.id, student.id),
        getStudentClassStats(cls.id, student.id),
      ]);
      setQuizScores(scores);
      setClassStats(stats);
    } catch (e) { console.error(e); }
    finally { setLoadingDetail(false); }
  }

  if (loading || loadingData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👨‍👩‍👧</div>
          <div>Loading parent panel...</div>
        </div>
      </div>
    );
  }

  if (noLink) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8', maxWidth: 400, padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <h2 style={{ color: 'white', margin: '0 0 10px' }}>No Student Linked</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>
            Your parent account is not linked to any student yet. Ask the super admin to set up the parent-student link, or have your child link their account to yours.
          </p>
          <button
            onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
            style={{
              marginTop: 20, padding: '10px 24px', borderRadius: 8, fontSize: 13, fontWeight: 'bold',
              fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444',
              color: '#f87171', cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // ─── Class Detail ──────────────────────────────────────────────────────

  if (selectedClass && student) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', background: '#1e293b', borderBottom: `2px solid ${COLOR}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: COLOR, marginBottom: 2 }}>👨‍👩‍👧 PARENT PANEL</div>
              <h2 style={{ margin: 0, color: 'white', fontSize: 18 }}>🏫 {selectedClass.name}</h2>
              <div style={{ color: '#64748b', fontSize: 11 }}>
                Child: <span style={{ color: COLOR }}>{student.username || student.first_name}</span>
                {' · '}Teacher: <span style={{ color: '#10b981' }}>{selectedClass.teacher_username}</span>
              </div>
            </div>
            <button onClick={() => { setSelectedClass(null); setQuizScores([]); setClassStats(null); }} style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer',
            }}>← Back</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {loadingDetail ? (
            <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30 }}>Loading...</div>
          ) : (
            <>
              {/* Stats banner */}
              {classStats && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Quizzes Taken', value: classStats.quizzes_taken, icon: '📋', color: '#f59e0b' },
                    { label: 'Avg Score', value: classStats.quizzes_graded > 0 ? classStats.avg_score : '—', icon: '⭐', color: '#10b981' },
                    { label: 'Questions Solved', value: classStats.questions_solved, icon: '✅', color: '#3b82f6' },
                    { label: 'Correct', value: classStats.questions_correct, icon: '🎯', color: '#a78bfa' },
                  ].map(s => (
                    <div key={s.label} style={{ flex: '1 1 100px', ...cardStyle, padding: '10px 12px', textAlign: 'center', minWidth: 80 }}>
                      <div style={{ fontSize: 18, marginBottom: 2 }}>{s.icon}</div>
                      <div style={{ color: s.color, fontWeight: 'bold', fontSize: 18 }}>{s.value}</div>
                      <div style={{ color: '#64748b', fontSize: 10, fontWeight: 'bold' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Quiz scores */}
              <h3 style={{ color: 'white', fontSize: 14, margin: '0 0 10px' }}>📋 Quiz Scores</h3>
              {quizScores.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#64748b', marginTop: 20 }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>📋</div>
                  <div>No quiz attempts yet.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {quizScores.map((qs, i) => {
                    const statusColor = qs.status === 'graded' ? '#10b981' : qs.status === 'submitted' ? '#f59e0b' : '#64748b';
                    return (
                      <div key={`${qs.quiz_id}-${i}`} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{qs.quiz_title}</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>
                            {qs.submitted_at ? new Date(qs.submitted_at).toLocaleDateString() : 'In progress'}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: qs.score != null ? '#10b981' : '#64748b', fontWeight: 'bold', fontSize: 16 }}>
                            {qs.score != null ? qs.score : '—'}
                          </div>
                          <span style={{
                            fontSize: 9, fontWeight: 'bold', padding: '2px 6px', borderRadius: 4,
                            background: `${statusColor}22`, border: `1px solid ${statusColor}55`, color: statusColor,
                          }}>{qs.status}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── Main: Child Overview + Classes ────────────────────────────────────

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', background: '#1e293b', borderBottom: `2px solid ${COLOR}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 'bold', color: COLOR, marginBottom: 2 }}>👨‍👩‍👧 PARENT PANEL</div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 18 }}>My Child's Progress</h2>
            <div style={{ color: '#64748b', fontSize: 12 }}>Logged in as {userData?.username || 'Parent'}</div>
          </div>
          <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
            style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {/* Child card */}
        {student && (
          <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 50, height: 50, borderRadius: '50%', flexShrink: 0,
              background: `hsl(${(student.username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 'bold', color: 'white', fontSize: 20,
            }}>
              {(student.username[0] || '?').toUpperCase()}
            </div>
            <div>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{student.username || `${student.first_name} ${student.last_name}`}</div>
              <div style={{ color: '#64748b', fontSize: 12 }}>{student.email}</div>
              <div style={{ color: COLOR, fontSize: 11, fontWeight: 'bold', marginTop: 2 }}>
                {classes.length} class{classes.length !== 1 ? 'es' : ''} enrolled
              </div>
            </div>
          </div>
        )}

        {/* Chat rooms per teacher */}
        {student && teacherChats.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ color: 'white', fontSize: 14, margin: '0 0 8px' }}>💬 Teacher Chats</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {teacherChats.map(tc => (
                <button key={tc.class_id} onClick={() => { setSelectedChat(tc); setShowChat(true); }} style={{
                  ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                  cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
                }}>
                  <div style={{ fontSize: 20 }}>💬</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{tc.class_name}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Teacher: {tc.teacher_username}</div>
                  </div>
                  <span style={{ color: '#475569', fontSize: 16 }}>→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Content Progress */}
        <h3 style={{ color: 'white', fontSize: 14, margin: '0 0 8px' }}>📊 Content Progress</h3>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {(['all', 'program', 'assignment', 'quiz'] as const).map(f => {
            const count = f === 'all' ? contentProgress.length : contentProgress.filter(c => c.content_type === f).length;
            return (
              <button key={f} onClick={() => setProgressFilter(f)} style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 'bold', fontFamily: 'inherit',
                background: progressFilter === f ? `${COLOR}22` : 'transparent',
                border: `1px solid ${progressFilter === f ? COLOR_DIM : '#33415555'}`,
                color: progressFilter === f ? COLOR : '#64748b', cursor: 'pointer',
              }}>
                {f === 'all' ? 'All' : f === 'program' ? '📘 Programs' : f === 'assignment' ? '📝 Quests' : '📋 Quizzes'} ({count})
              </button>
            );
          })}
        </div>
        {loadingProgress ? (
          <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading progress...</div>
        ) : (() => {
          const filtered = progressFilter === 'all' ? contentProgress : contentProgress.filter(c => c.content_type === progressFilter);
          return filtered.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: 20 }}>No content yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {filtered.map(item => {
                const icon = item.content_type === 'program' ? '📘' : item.content_type === 'assignment' ? '📝' : '📋';
                const barColor = item.pct >= 100 ? '#10b981' : item.pct > 0 ? '#3b82f6' : '#475569';
                return (
                  <div key={item.content_id} style={{ ...cardStyle, padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{item.title}</div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{item.class_name} · {item.answered_questions}/{item.total_questions} answered{item.quiz_score != null ? ` · Score: ${item.quiz_score}` : ''}</div>
                      </div>
                      <span style={{ color: barColor, fontWeight: 'bold', fontSize: 14 }}>{item.pct}%</span>
                    </div>
                    <div style={{ width: '100%', height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${item.pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: '0.5s' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Classes */}
        <h3 style={{ color: 'white', fontSize: 14, margin: '0 0 10px' }}>🏫 Classes</h3>
        {classes.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', marginTop: 20 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>🏫</div>
            <div>Your child is not enrolled in any classes yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {classes.map(cls => (
              <button key={cls.id} onClick={() => openClass(cls)} style={{
                ...cardStyle, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: `hsl(${(cls.name.charCodeAt(0) || 65) * 37 % 360}, 50%, 25%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                }}>
                  🏫
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{cls.name}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>
                    Teacher: <span style={{ color: '#10b981' }}>{cls.teacher_username}</span>
                  </div>
                </div>
                <span style={{ color: '#475569', fontSize: 18 }}>→</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat overlay */}
      {showChat && user && student && selectedChat && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column' }}>
          <ChatWidget
            userId={user.uid}
            username={userData?.username || ''}
            classId={`parent_${student.id}`}
            color={COLOR}
            onClose={() => { setShowChat(false); setSelectedChat(null); }}
          />
        </div>
      )}
    </div>
  );
}
