import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import {
  getLinkedStudents,
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
import { redeemLinkingCode, unlinkStudent } from '@/lib/linkingService';
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

  const [students, setStudents] = useState<LinkedStudent[]>([]);
  const [student, setStudent] = useState<LinkedStudent | null>(null);
  const [classes, setClasses] = useState<ParentClassRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Link / manage state
  const [managePanelOpen, setManagePanelOpen] = useState(false);
  const [linkCode, setLinkCode] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkSuccess, setLinkSuccess] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);

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

  useEffect(() => { loadStudents(); }, []);

  async function loadStudents() {
    setLoadingData(true);
    try {
      const all = await getLinkedStudents();
      setStudents(all);
      if (all.length > 0) {
        const s = all[0];
        setStudent(s);
        await loadStudentData(s);
      }
    } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }

  async function loadStudentData(s: LinkedStudent) {
    try {
      const [cls, chats] = await Promise.all([getStudentClasses(s.id), getStudentTeacherChats(s.id)]);
      setClasses(cls);
      setTeacherChats(chats);
      setLoadingProgress(true);
      getStudentContentProgress(s.id).then(p => setContentProgress(p)).catch(e => console.error(e)).finally(() => setLoadingProgress(false));
    } catch (e) { console.error(e); }
  }

  async function switchStudent(s: LinkedStudent) {
    setStudent(s);
    setSelectedClass(null);
    setQuizScores([]);
    setClassStats(null);
    setContentProgress([]);
    setClasses([]);
    setTeacherChats([]);
    await loadStudentData(s);
  }

  async function handleRedeemCode() {
    if (!user || !linkCode.trim()) return;
    setLinkLoading(true); setLinkError(''); setLinkSuccess('');
    try {
      const result = await redeemLinkingCode(user.uid, linkCode.trim());
      setLinkSuccess(`Linked to ${result.studentName}!`);
      setLinkCode('');
      await loadStudents();
      setManagePanelOpen(false);
    } catch (e: any) {
      setLinkError(e.message || 'Failed to link.');
    } finally { setLinkLoading(false); }
  }

  async function handleUnlink(studentId: string) {
    if (!user) return;
    if (!confirm('Are you sure you want to unlink this student?')) return;
    try {
      await unlinkStudent(user.uid, studentId);
      const remaining = students.filter(s => s.id !== studentId);
      setStudents(remaining);
      if (student?.id === studentId) {
        if (remaining.length > 0) {
          setStudent(remaining[0]);
          await loadStudentData(remaining[0]);
        } else {
          setStudent(null);
          setClasses([]);
          setTeacherChats([]);
          setContentProgress([]);
        }
      }
    } catch (e) { console.error('Unlink error:', e); }
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

  if (students.length === 0 && !loadingData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8', maxWidth: 400, padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
          <h2 style={{ color: 'white', margin: '0 0 10px' }}>Link a Student Account</h2>
          <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
            Ask your child to generate a linking code from their student account, then enter it below.
          </p>
          {linkError && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>{linkError}</div>}
          {linkSuccess && <div style={{ color: '#86efac', fontSize: 13, marginBottom: 10, padding: '8px 12px', background: 'rgba(16,185,129,0.1)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.3)' }}>{linkSuccess}</div>}
          <input
            value={linkCode}
            onChange={e => setLinkCode(e.target.value.toUpperCase())}
            placeholder="Enter 6-digit code"
            onKeyDown={e => e.key === 'Enter' && handleRedeemCode()}
            style={{
              width: '100%', padding: '12px 14px', marginBottom: 10, borderRadius: 8,
              border: '1px solid #475569', background: 'rgba(0,0,0,0.5)', color: 'white',
              boxSizing: 'border-box', fontSize: 20, fontFamily: 'monospace',
              textAlign: 'center', letterSpacing: 6, outline: 'none',
            }}
          />
          <button
            onClick={handleRedeemCode}
            disabled={linkLoading || !linkCode.trim()}
            style={{
              width: '100%', padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 'bold',
              fontFamily: 'inherit', cursor: linkLoading ? 'not-allowed' : 'pointer',
              background: 'rgba(236,72,153,0.2)', border: '1px solid rgba(236,72,153,0.5)',
              color: '#f9a8d4', marginBottom: 16,
            }}
          >
            {linkLoading ? 'Linking...' : 'Link Student'}
          </button>
          <button
            onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
            style={{
              padding: '10px 24px', borderRadius: 8, fontSize: 13, fontWeight: 'bold',
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button onClick={() => setManagePanelOpen(!managePanelOpen)}
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'rgba(236,72,153,0.15)', border: `1px solid ${COLOR_DIM}`, color: '#f9a8d4', cursor: 'pointer' }}>
              {managePanelOpen ? '✕ Close' : '⚙ Manage Students'}
            </button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>
              Sign Out
            </button>
          </div>
        </div>
        {/* Student selector */}
        {students.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {students.map(s => (
              <button key={s.id} onClick={() => switchStudent(s)} style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
                background: student?.id === s.id ? `${COLOR}22` : 'transparent',
                border: `1px solid ${student?.id === s.id ? COLOR_DIM : '#33415555'}`,
                color: student?.id === s.id ? COLOR : '#64748b', cursor: 'pointer',
              }}>
                {s.username || s.first_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {/* Manage Students Panel */}
        {managePanelOpen && (
          <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
            <h3 style={{ color: 'white', fontSize: 14, margin: '0 0 12px' }}>Manage Linked Students</h3>
            {/* Code entry */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Enter a code from your child's account to link:</div>
              {linkError && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 6, padding: '6px 10px', background: 'rgba(239,68,68,0.1)', borderRadius: 6 }}>{linkError}</div>}
              {linkSuccess && <div style={{ color: '#86efac', fontSize: 12, marginBottom: 6, padding: '6px 10px', background: 'rgba(16,185,129,0.1)', borderRadius: 6 }}>{linkSuccess}</div>}
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={linkCode}
                  onChange={e => setLinkCode(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  onKeyDown={e => e.key === 'Enter' && handleRedeemCode()}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: 6, border: '1px solid #475569',
                    background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 16, fontFamily: 'monospace',
                    textAlign: 'center', letterSpacing: 4, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <button onClick={handleRedeemCode} disabled={linkLoading || !linkCode.trim()} style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
                  background: 'rgba(236,72,153,0.2)', border: '1px solid rgba(236,72,153,0.5)', color: '#f9a8d4',
                  cursor: linkLoading ? 'not-allowed' : 'pointer',
                }}>
                  {linkLoading ? '...' : 'Link'}
                </button>
              </div>
            </div>
            {/* Current students with unlink */}
            {students.length > 0 && (
              <div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Linked students:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {students.map(s => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                        background: `hsl(${(s.username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'bold', color: 'white', fontSize: 12,
                      }}>{(s.username[0] || '?').toUpperCase()}</div>
                      <div style={{ flex: 1, color: 'white', fontSize: 13, fontWeight: 'bold' }}>{s.username || `${s.first_name} ${s.last_name}`}</div>
                      <button onClick={() => handleUnlink(s.id)} style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 'bold', fontFamily: 'inherit',
                        background: 'transparent', border: '1px solid #ef444455', color: '#f87171', cursor: 'pointer',
                      }}>Unlink</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
