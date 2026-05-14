import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTeacherClasses,
  getClassStudents,
  getTeacherClassContent,
  getClassQuizResults,
  getAllTeacherUsers,
  getStudentParentLinks,
  type TeacherClassRow,
  type ClassStudentRow,
  type TeacherContentRow,
  type StudentQuizResult,
  type TeacherUserRow,
  type StudentParentInfo,
} from '@/lib/teacherService';
import { getClassLeaderboard, type ClassLeaderboardEntry } from '@/lib/statsService';
import ChatWidget from '@/components/ChatWidget';
import SettingsLauncher from '@/components/settings/SettingsLauncher';
import { requireSupabase } from '@/lib/supabase';
import { listFreeformReviewsForUsers, type FreeformReviewRow } from '@/lib/freeformReviewService';

const COLOR = '#10b981';
const COLOR_DIM = '#10b98155';

const cardStyle: React.CSSProperties = {
  background: '#1e293b', borderRadius: 10, border: '1px solid #334155',
};

type TopTab = 'classes' | 'users' | 'parents';
type ClassTab = 'students' | 'content' | 'results' | 'leaderboard' | 'chat' | 'freeformReview';

export default function TeacherPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();

  const [topTab, setTopTab] = useState<TopTab>('classes');
  const [classes, setClasses] = useState<TeacherClassRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // all users
  const [allUsers, setAllUsers] = useState<TeacherUserRow[]>([]);
  const [loadingAllUsers, setLoadingAllUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // parent reports
  const [parentLinks, setParentLinks] = useState<StudentParentInfo[]>([]);
  const [loadingParents, setLoadingParents] = useState(false);
  const [parentClassFilter, setParentClassFilter] = useState('all');
  const [selectedParentChat, setSelectedParentChat] = useState<StudentParentInfo | null>(null);

  // class detail
  const [selectedClass, setSelectedClass] = useState<TeacherClassRow | null>(null);
  const [classTab, setClassTab] = useState<ClassTab>('students');

  // students
  const [students, setStudents] = useState<ClassStudentRow[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // content
  const [content, setContent] = useState<TeacherContentRow[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);

  // quiz results
  const [quizResults, setQuizResults] = useState<StudentQuizResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultFilter, setResultFilter] = useState<string>('all');

  // leaderboard
  const [leaderboard, setLeaderboard] = useState<ClassLeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  const [freeformReviews, setFreeformReviews] = useState<FreeformReviewRow[]>([]);
  const [loadingFreeformReviews, setLoadingFreeformReviews] = useState(false);

  // redirect guard
  useEffect(() => {
    if (!loading && !user) setLocation('/auth');
    if (!loading && userData && userData.role !== 'teacher') setLocation('/auth');
  }, [user, userData, loading]);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoadingData(true);
    try { setClasses(await getTeacherClasses()); } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }

  async function loadUsers() {
    setLoadingAllUsers(true);
    try { setAllUsers(await getAllTeacherUsers()); } catch (e) { console.error(e); }
    finally { setLoadingAllUsers(false); }
  }

  async function loadParentLinks() {
    setLoadingParents(true);
    try { setParentLinks(await getStudentParentLinks()); } catch (e) { console.error(e); }
    finally { setLoadingParents(false); }
  }

  function switchTopTab(t: TopTab) {
    setTopTab(t);
    setSelectedClass(null);
    setSelectedParentChat(null);
    if (t === 'users' && allUsers.length === 0) loadUsers();
    if (t === 'parents' && parentLinks.length === 0) loadParentLinks();
  }

  async function openClass(cls: TeacherClassRow) {
    setSelectedClass(cls);
    setClassTab('students');
    setStudents([]);
    setContent([]);
    setQuizResults([]);
    setLeaderboard([]);
    setLoadingStudents(true);
    try { setStudents(await getClassStudents(cls.id)); } catch (e) { console.error(e); }
    finally { setLoadingStudents(false); }
  }

  async function loadTab(tab: ClassTab) {
    if (!selectedClass) return;
    setClassTab(tab);
    if (tab === 'content' && content.length === 0) {
      setLoadingContent(true);
      try { setContent(await getTeacherClassContent(selectedClass.id)); } catch (e) { console.error(e); }
      finally { setLoadingContent(false); }
    }
    if (tab === 'results' && quizResults.length === 0) {
      setLoadingResults(true);
      try { setQuizResults(await getClassQuizResults(selectedClass.id)); } catch (e) { console.error(e); }
      finally { setLoadingResults(false); }
    }
    if (tab === 'leaderboard' && leaderboard.length === 0) {
      setLoadingLeaderboard(true);
      try { setLeaderboard(await getClassLeaderboard(selectedClass.id)); } catch (e) { console.error(e); }
      finally { setLoadingLeaderboard(false); }
    }
    if (tab === 'freeformReview' && freeformReviews.length === 0) {
      setLoadingFreeformReviews(true);
      try {
        const userIds = students.filter((student) => student.role === 'student').map((student) => student.user_id);
        setFreeformReviews(await listFreeformReviewsForUsers(userIds));
      } catch (e) { console.error(e); }
      finally { setLoadingFreeformReviews(false); }
    }
  }

  if (loading || loadingData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <SettingsLauncher compact />
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
          <div>Loading teacher panel...</div>
        </div>
      </div>
    );
  }

  // ─── Class Detail ──────────────────────────────────────────────────────

  if (selectedClass) {
    const uniqueQuizIds = [...new Set(quizResults.map(r => r.quiz_id))];
    const filteredResults = resultFilter === 'all' ? quizResults : quizResults.filter(r => r.quiz_id === resultFilter);

    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
        <SettingsLauncher compact />
        {/* Header */}
        <div style={{ padding: '14px 20px', background: '#1e293b', borderBottom: `2px solid ${COLOR}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: COLOR, marginBottom: 2 }}>📖 TEACHER PANEL</div>
              <h2 style={{ margin: 0, color: 'white', fontSize: 18 }}>🏫 {selectedClass.name}</h2>
              <div style={{ color: '#64748b', fontSize: 11 }}>
                {selectedClass.student_count} student{selectedClass.student_count !== 1 ? 's' : ''}
                {' · '}{selectedClass.content_count} content item{selectedClass.content_count !== 1 ? 's' : ''}
              </div>
            </div>
            <button onClick={() => setSelectedClass(null)} style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer',
            }}>← Back</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
            {([
              { id: 'students' as const, icon: '👥', label: `Students (${students.length})` },
              { id: 'content' as const, icon: '📚', label: 'Content' },
              { id: 'results' as const, icon: '📋', label: 'Quiz Results' },
              { id: 'freeformReview' as const, icon: '📝', label: `Freeform Review (${freeformReviews.length})` },
              { id: 'leaderboard' as const, icon: '🏆', label: 'Leaderboard' },
              { id: 'chat' as const, icon: '💬', label: 'Chat' },
            ]).map(t => (
              <button key={t.id} onClick={() => loadTab(t.id)} style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
                background: classTab === t.id ? `${COLOR}33` : 'transparent',
                border: `1px solid ${classTab === t.id ? COLOR_DIM : 'transparent'}`,
                color: classTab === t.id ? COLOR : '#64748b', cursor: 'pointer',
              }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

          {/* Students tab */}
          {classTab === 'students' && (
            loadingStudents ? <Loader /> : students.length === 0 ? <Empty icon="👥" text="No students enrolled." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {students.map(s => {
                  const rolePill = s.role === 'teacher_assistant'
                    ? { label: 'TA', color: '#06b6d4' } : { label: 'Student', color: '#3b82f6' };
                  return (
                    <div key={s.user_id} style={{ ...cardStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: `hsl(${(s.username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'bold', color: 'white', fontSize: 13,
                      }}>
                        {(s.username[0] || '?').toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{s.username || `${s.first_name} ${s.last_name}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{s.email}</div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5,
                        background: `${rolePill.color}22`, border: `1px solid ${rolePill.color}55`, color: rolePill.color,
                      }}>{rolePill.label}</span>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Content tab */}
          {classTab === 'content' && (
            loadingContent ? <Loader /> : content.length === 0 ? <Empty icon="📚" text="No content created yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {content.map(item => {
                  const typeIcon = item.content_type === 'program' ? '📘' : item.content_type === 'assignment' ? '📝' : '📋';
                  const typeLabel = item.content_type === 'program' ? 'Program' : item.content_type === 'assignment' ? 'Quest' : 'Quiz';
                  const statusColor = item.status === 'published' ? '#10b981' : '#f59e0b';
                  const qCount = Array.isArray(item.questions) ? item.questions.length : 0;
                  return (
                    <div key={item.id} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 22, flexShrink: 0 }}>{item.cover_emoji || typeIcon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{item.title}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>
                          {typeLabel} · {item.subject}
                          {item.content_type !== 'program' && ` · ${qCount} question${qCount !== 1 ? 's' : ''}`}
                          {item.content_type === 'quiz' && item.time_limit_minutes && ` · ${item.time_limit_minutes}min`}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5,
                        background: `${statusColor}22`, border: `1px solid ${statusColor}55`, color: statusColor,
                      }}>{item.status}</span>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Quiz Results tab */}
          {classTab === 'results' && (
            loadingResults ? <Loader /> : quizResults.length === 0 ? <Empty icon="📋" text="No quiz attempts yet." /> : (
              <>
                {/* quiz filter */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
                  <button onClick={() => setResultFilter('all')} style={pillBtn(resultFilter === 'all')}>All ({quizResults.length})</button>
                  {uniqueQuizIds.map(qid => {
                    const title = quizResults.find(r => r.quiz_id === qid)?.quiz_title ?? qid;
                    const count = quizResults.filter(r => r.quiz_id === qid).length;
                    return <button key={qid} onClick={() => setResultFilter(qid)} style={pillBtn(resultFilter === qid)}>{title} ({count})</button>;
                  })}
                </div>
                {/* results table */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', padding: '6px 14px', gap: 10, color: '#64748b', fontSize: 10, fontWeight: 'bold' }}>
                    <div style={{ flex: 1 }}>Student</div>
                    <div style={{ width: 120 }}>Quiz</div>
                    <div style={{ width: 60, textAlign: 'center' }}>Score</div>
                    <div style={{ width: 70, textAlign: 'center' }}>Status</div>
                  </div>
                  {filteredResults.map((r, i) => {
                    const statusColor = r.status === 'graded' ? '#10b981' : r.status === 'submitted' ? '#f59e0b' : '#64748b';
                    return (
                      <div key={`${r.student_id}-${r.quiz_id}-${i}`} style={{ ...cardStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, color: 'white', fontWeight: 'bold', fontSize: 13 }}>{r.username}</div>
                        <div style={{ width: 120, color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.quiz_title}</div>
                        <div style={{ width: 60, textAlign: 'center', color: '#10b981', fontWeight: 'bold', fontSize: 13 }}>
                          {r.score != null ? r.score : '—'}
                        </div>
                        <span style={{
                          width: 70, textAlign: 'center',
                          fontSize: 10, fontWeight: 'bold', padding: '2px 6px', borderRadius: 5,
                          background: `${statusColor}22`, border: `1px solid ${statusColor}55`, color: statusColor,
                        }}>{r.status}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )
          )}

          {classTab === 'freeformReview' && (
            loadingFreeformReviews ? <Loader /> : freeformReviews.length === 0 ? <Empty icon="📝" text="No freeform submissions yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {freeformReviews.map((review) => (
                  <div key={review.id} style={{ ...cardStyle, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{review.questionText || 'Untitled freeform response'}</div>
                      <div style={{ color: review.status === 'pending_review' ? '#93c5fd' : (review.correct ? '#34d399' : '#fca5a5'), fontSize: 11, fontWeight: 'bold' }}>
                        {review.status === 'pending_review' ? 'Pending review' : (review.correct ? 'Accepted' : 'Rejected')}
                      </div>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8 }}>
                      {new Date(review.createdAt).toLocaleString()} · mode: {review.gradingMode} · provider: {review.provider ?? '—'}
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{review.answerText}</div>
                    {review.feedbackText ? (
                      <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'pre-wrap' }}>{review.feedbackText}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )
          )}

          {/* Chat tab */}
          {classTab === 'chat' && user && selectedClass && (
            <div style={{ height: 'calc(100vh - 200px)' }}>
              <ChatWidget
                userId={user.uid}
                username={userData?.username || ''}
                classId={selectedClass.id}
                color={COLOR}
                onClose={() => setClassTab('students')}
              />
            </div>
          )}

          {/* Leaderboard tab */}
          {classTab === 'leaderboard' && (
            loadingLeaderboard ? <Loader /> : leaderboard.length === 0 ? <Empty icon="🏆" text="No student data yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', padding: '6px 14px', gap: 10, color: '#64748b', fontSize: 10, fontWeight: 'bold' }}>
                  <div style={{ width: 28 }}>#</div>
                  <div style={{ flex: 1 }}>Student</div>
                  <div style={{ width: 70, textAlign: 'center' }}>Avg Score</div>
                  <div style={{ width: 70, textAlign: 'center' }}>Quizzes</div>
                  <div style={{ width: 70, textAlign: 'center' }}>Qs Solved</div>
                </div>
                {leaderboard.map((entry, i) => (
                  <div key={entry.student_id} style={{ ...cardStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, color: i < 3 ? '#fbbf24' : '#64748b', fontWeight: 'bold', fontSize: 13 }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                    </div>
                    <div style={{ flex: 1, color: 'white', fontWeight: 'bold', fontSize: 13 }}>{entry.username}</div>
                    <div style={{ width: 70, textAlign: 'center', color: '#10b981', fontWeight: 'bold', fontSize: 13 }}>
                      {entry.quizzes_graded > 0 ? entry.avg_score : '—'}
                    </div>
                    <div style={{ width: 70, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{entry.quizzes_taken}</div>
                    <div style={{ width: 70, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{entry.questions_solved}</div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    );
  }

  // ─── Main Layout with top tabs ──────────────────────────────────────

  const filteredAllUsers = allUsers.filter(u => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.first_name.toLowerCase().includes(q);
  });

  const uniqueParentClassNames = [...new Set(parentLinks.flatMap(l => l.class_names))];
  const filteredParentLinks = parentClassFilter === 'all' ? parentLinks : parentLinks.filter(l => l.class_names.includes(parentClassFilter));

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      <SettingsLauncher compact />
      {/* Header */}
      <div style={{ padding: '16px 20px', background: '#1e293b', borderBottom: `2px solid ${COLOR}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: COLOR }}>📖</span> Teacher
              <span style={{ fontSize: 11, background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, borderRadius: 6, padding: '2px 8px', fontWeight: 'normal' }}>{userData?.username || 'teacher'}</span>
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadAll} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>↺ Refresh</button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
              style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>Sign Out</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([{ id: 'classes' as TopTab, icon: '🏫', label: `Classes (${classes.length})` }, { id: 'users' as TopTab, icon: '👥', label: `Users${allUsers.length ? ` (${allUsers.length})` : ''}` }, { id: 'parents' as TopTab, icon: '👨‍👩‍👧', label: 'Parent Reports' }]).map(t => (
            <button key={t.id} onClick={() => switchTopTab(t.id)} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: topTab === t.id ? `${COLOR}33` : 'transparent',
              border: `1px solid ${topTab === t.id ? COLOR_DIM : 'transparent'}`,
              color: topTab === t.id ? COLOR : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

        {/* ── USERS TAB ── */}
        {topTab === 'users' && (
          <div>
            <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search users..."
              style={{ width: '100%', padding: '10px 13px', marginBottom: 12, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
            {loadingAllUsers ? <Loader /> : filteredAllUsers.length === 0 ? <Empty icon="👥" text="No students or TAs yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filteredAllUsers.map(u => {
                  const rp = u.role === 'teacher_assistant' ? { l: 'TA', c: '#06b6d4' } : { l: 'Student', c: '#3b82f6' };
                  return (
                    <div key={u.user_id} style={{ ...cardStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: `hsl(${(u.username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: 13 }}>{(u.username[0] || '?').toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{u.username || `${u.first_name} ${u.last_name}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {u.email} <span style={{ color: '#475569' }}>·</span>
                          {u.class_names.map((cn, i) => <span key={i} style={{ background: '#0f172a', padding: '0 5px', borderRadius: 3, fontSize: 10 }}>{cn}</span>)}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5, background: `${rp.c}22`, border: `1px solid ${rp.c}55`, color: rp.c }}>{rp.l}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PARENT REPORTS TAB ── */}
        {topTab === 'parents' && !selectedParentChat && (
          <div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
              <button onClick={() => setParentClassFilter('all')} style={pillBtn(parentClassFilter === 'all')}>All ({parentLinks.length})</button>
              {uniqueParentClassNames.map(cn => (
                <button key={cn} onClick={() => setParentClassFilter(cn)} style={pillBtn(parentClassFilter === cn)}>{cn} ({parentLinks.filter(l => l.class_names.includes(cn)).length})</button>
              ))}
            </div>
            {loadingParents ? <Loader /> : filteredParentLinks.length === 0 ? <Empty icon="👨‍👩‍👧" text="No parent-student links found." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filteredParentLinks.map(l => (
                  <button key={`${l.student_id}-${l.parent_id}`} onClick={() => setSelectedParentChat(l)} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}>
                    <div style={{ fontSize: 22, flexShrink: 0 }}>👨‍👩‍👧</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>Student: {l.student_username}</div>
                      <div style={{ color: '#64748b', fontSize: 11 }}>Parent: {l.parent_username} ({l.parent_email})</div>
                      <div style={{ color: '#475569', fontSize: 10, marginTop: 2 }}>{l.class_names.join(', ')}</div>
                    </div>
                    <span style={{ color: COLOR, fontSize: 14, fontWeight: 'bold' }}>💬</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Parent chat */}
        {topTab === 'parents' && selectedParentChat && user && (
          <div>
            <button onClick={() => setSelectedParentChat(null)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer', marginBottom: 12 }}>← Back</button>
            <div style={{ ...cardStyle, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Chat: {selectedParentChat.student_username}'s Parent</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>Parent: {selectedParentChat.parent_username} · Student: {selectedParentChat.student_username}</div>
            </div>
            <div style={{ height: 'calc(100vh - 280px)' }}>
              <ChatWidget userId={user.uid} username={userData?.username || ''} classId={`parent_${selectedParentChat.student_id}`} color={COLOR} onClose={() => setSelectedParentChat(null)} />
            </div>
          </div>
        )}

        {/* ── CLASSES TAB ── */}
        {topTab === 'classes' && !selectedClass && (
          classes.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🏫</div>
              <div>No classes assigned to you yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Ask your admin to create a class for you.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {classes.map(cls => (
                <button key={cls.id} onClick={() => openClass(cls)} style={{
                  ...cardStyle, padding: '16px', display: 'flex', alignItems: 'center', gap: 14,
                  cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit',
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                    background: `hsl(${(cls.name.charCodeAt(0) || 65) * 37 % 360}, 50%, 25%)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
                  }}>🏫</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 15 }}>{cls.name}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>
                      {cls.student_count} student{cls.student_count !== 1 ? 's' : ''}
                      {' · '}{cls.content_count} content item{cls.content_count !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span style={{ color: '#475569', fontSize: 18 }}>→</span>
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Loader() {
  return <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30 }}>Loading...</div>;
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
    </div>
  );
}

function pillBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 'bold', fontFamily: 'inherit',
    background: active ? '#10b98122' : 'transparent',
    border: `1px solid ${active ? '#10b98155' : '#33415555'}`,
    color: active ? '#10b981' : '#64748b', cursor: 'pointer',
  };
}
