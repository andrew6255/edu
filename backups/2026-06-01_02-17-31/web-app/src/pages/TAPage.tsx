import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTAClasses,
  getClassSubmissions,
  gradeQuizAttempt,
  getTAClassContent,
  getStudentParentLinksForTA,
  type TAClassRow,
  type SubmissionRow,
  type TAContentRow,
  type TAStudentParentInfo,
} from '@/lib/taService';
import ChatWidget from '@/components/ChatWidget';
import SettingsLauncher from '@/components/settings/SettingsLauncher';
import { requireSupabase } from '@/lib/supabase';

const COLOR = '#06b6d4';
const COLOR_DIM = '#06b6d455';

const cardStyle: React.CSSProperties = {
  background: '#1e293b', borderRadius: 10, border: '1px solid #334155',
};

type TopTab = 'classes' | 'parents';
type ClassDetailTab = 'submissions' | 'content';
type SubFilter = 'all' | 'submitted' | 'graded';

export default function TAPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();

  const [topTab, setTopTab] = useState<TopTab>('classes');
  const [classes, setClasses] = useState<TAClassRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // parent reports
  const [parentLinks, setParentLinks] = useState<TAStudentParentInfo[]>([]);
  const [loadingParents, setLoadingParents] = useState(false);
  const [selectedParentChat, setSelectedParentChat] = useState<TAStudentParentInfo | null>(null);

  // class detail
  const [selectedClass, setSelectedClass] = useState<TAClassRow | null>(null);
  const [classDetailTab, setClassDetailTab] = useState<ClassDetailTab>('submissions');
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [subFilter, setSubFilter] = useState<SubFilter>('all');
  const [classContentItems, setClassContentItems] = useState<TAContentRow[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);

  // chat
  const [showChat, setShowChat] = useState(false);

  // grading modal
  const [gradingSub, setGradingSub] = useState<SubmissionRow | null>(null);
  const [gradeScore, setGradeScore] = useState('');
  const [grading, setGrading] = useState(false);

  // redirect guard
  useEffect(() => {
    if (!loading && !user) setLocation('/auth');
    if (!loading && userData && userData.role !== 'teacher_assistant') setLocation('/auth');
  }, [user, userData, loading]);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoadingData(true);
    try { setClasses(await getTAClasses()); } catch (e) { console.error(e); }
    finally { setLoadingData(false); }
  }

  async function openClass(cls: TAClassRow) {
    setSelectedClass(cls);
    setClassDetailTab('submissions');
    setSubmissions([]);
    setClassContentItems([]);
    setSubFilter('all');
    setLoadingSubs(true);
    try { setSubmissions(await getClassSubmissions(cls.id)); } catch (e) { console.error(e); }
    finally { setLoadingSubs(false); }
  }

  async function loadClassContent(classId: string) {
    if (classContentItems.length > 0) return;
    setLoadingContent(true);
    try { setClassContentItems(await getTAClassContent(classId)); } catch (e) { console.error(e); }
    finally { setLoadingContent(false); }
  }

  function openGrading(sub: SubmissionRow) {
    setGradingSub(sub);
    setGradeScore(sub.score != null ? String(sub.score) : '');
  }

  async function handleGrade() {
    if (!gradingSub || gradeScore === '') return;
    const score = parseFloat(gradeScore);
    if (isNaN(score)) { window.alert('Please enter a valid number.'); return; }
    setGrading(true);
    try {
      await gradeQuizAttempt(gradingSub.attempt_id, score);
      setSubmissions(prev => prev.map(s =>
        s.attempt_id === gradingSub.attempt_id ? { ...s, score, status: 'graded' } : s
      ));
      setGradingSub(null);
    } catch (e) {
      window.alert('Failed: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setGrading(false);
    }
  }

  if (loading || loadingData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <SettingsLauncher compact />
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✏️</div>
          <div>Loading TA panel...</div>
        </div>
      </div>
    );
  }

  // ─── Grading Modal ─────────────────────────────────────────────────────

  function renderGradingModal() {
    if (!gradingSub) return null;
    const questions = Array.isArray(gradingSub.questions) ? gradingSub.questions as { id: string; prompt: string; answer?: string; manually_graded?: boolean }[] : [];
    return (
      <>
        <div onClick={() => setGradingSub(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(560px, 94vw)',
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          border: `2px solid ${COLOR}`, zIndex: 1001,
        }}>
          <h2 style={{ margin: '0 0 4px', color: 'white', fontSize: 17 }}>
            ✏️ Grade: {gradingSub.quiz_title}
          </h2>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 14 }}>
            Student: <span style={{ color: COLOR }}>{gradingSub.student_username}</span>
            {gradingSub.submitted_at && ` · Submitted ${new Date(gradingSub.submitted_at).toLocaleString()}`}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', marginBottom: 14 }}>
            {questions.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {questions.map((q, i) => {
                  const studentAnswer = gradingSub.answers?.[q.id];
                  return (
                    <div key={q.id} style={{ ...cardStyle, padding: '12px 14px' }}>
                      <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>
                        Q{i + 1}{q.manually_graded ? ' · Manual grading' : ''}
                      </div>
                      <div style={{ color: 'white', fontSize: 13, marginBottom: 6 }}>{q.prompt}</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 120, padding: '6px 10px', borderRadius: 6, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
                          <div style={{ color: '#64748b', fontSize: 9, fontWeight: 'bold' }}>STUDENT ANSWER</div>
                          <div style={{ color: '#e2e8f0', fontSize: 12, marginTop: 2 }}>{studentAnswer != null ? String(studentAnswer) : '(no answer)'}</div>
                        </div>
                        {q.answer && (
                          <div style={{ flex: 1, minWidth: 120, padding: '6px 10px', borderRadius: 6, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                            <div style={{ color: '#64748b', fontSize: 9, fontWeight: 'bold' }}>CORRECT ANSWER</div>
                            <div style={{ color: '#10b981', fontSize: 12, marginTop: 2 }}>{q.answer}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>No question details available.</div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #334155', paddingTop: 14 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Score</label>
            <input
              type="number" value={gradeScore} onChange={e => setGradeScore(e.target.value)}
              placeholder="Enter score..."
              autoFocus
              style={{ width: '100%', padding: '10px 13px', marginBottom: 12, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setGradingSub(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleGrade} disabled={grading || gradeScore === ''} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {grading ? 'Saving...' : 'Save Grade'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Class Detail ──────────────────────────────────────────────────────

  if (selectedClass) {
    const needsGrading = submissions.filter(s => s.status === 'submitted');
    const graded = submissions.filter(s => s.status === 'graded');
    const filtered = subFilter === 'all' ? submissions.filter(s => s.status !== 'in_progress')
      : subFilter === 'submitted' ? needsGrading : graded;

    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
        <SettingsLauncher compact />
        {/* Header */}
        <div style={{ padding: '14px 20px', background: '#1e293b', borderBottom: `2px solid ${COLOR}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: COLOR, marginBottom: 2 }}>✏️ TA PANEL</div>
              <h2 style={{ margin: 0, color: 'white', fontSize: 18 }}>🏫 {selectedClass.name}</h2>
              <div style={{ color: '#64748b', fontSize: 11 }}>
                Teacher: <span style={{ color: '#10b981' }}>{selectedClass.teacher_username}</span>
                {' · '}{needsGrading.length} to grade · {graded.length} graded
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setShowChat(true)} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
                background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, cursor: 'pointer',
              }}>💬 Chat</button>
              <button onClick={() => setSelectedClass(null)} style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
                background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer',
              }}>← Back</button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
            <button onClick={() => setClassDetailTab('submissions')} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
              background: classDetailTab === 'submissions' ? `${COLOR}33` : 'transparent',
              border: `1px solid ${classDetailTab === 'submissions' ? COLOR_DIM : 'transparent'}`,
              color: classDetailTab === 'submissions' ? COLOR : '#64748b', cursor: 'pointer',
            }}>📋 Submissions ({submissions.filter(s => s.status !== 'in_progress').length})</button>
            <button onClick={() => { setClassDetailTab('content'); if (selectedClass) loadClassContent(selectedClass.id); }} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
              background: classDetailTab === 'content' ? `${COLOR}33` : 'transparent',
              border: `1px solid ${classDetailTab === 'content' ? COLOR_DIM : 'transparent'}`,
              color: classDetailTab === 'content' ? COLOR : '#64748b', cursor: 'pointer',
            }}>📚 Content</button>
          </div>

          {/* Sub-filter for submissions */}
          {classDetailTab === 'submissions' && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              {([
                { id: 'all' as SubFilter, label: `All (${submissions.filter(s => s.status !== 'in_progress').length})` },
                { id: 'submitted' as SubFilter, label: `⏳ Needs Grading (${needsGrading.length})`, highlight: needsGrading.length > 0 },
                { id: 'graded' as SubFilter, label: `✅ Graded (${graded.length})` },
              ]).map(f => (
                <button key={f.id} onClick={() => setSubFilter(f.id)} style={{
                  padding: '5px 10px', borderRadius: 5, fontSize: 10, fontWeight: 'bold', fontFamily: 'inherit',
                  background: subFilter === f.id ? `${COLOR}22` : (f as { highlight?: boolean }).highlight ? 'rgba(249,115,22,0.08)' : 'transparent',
                  border: `1px solid ${subFilter === f.id ? COLOR_DIM : (f as { highlight?: boolean }).highlight ? '#f9731655' : '#33415555'}`,
                  color: subFilter === f.id ? COLOR : (f as { highlight?: boolean }).highlight ? '#f97316' : '#64748b', cursor: 'pointer',
                }}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

          {/* Submissions tab */}
          {classDetailTab === 'submissions' && (
            loadingSubs ? (
              <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30 }}>Loading submissions...</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>{subFilter === 'submitted' ? '⏳' : '✅'}</div>
                <div>{subFilter === 'submitted' ? 'No submissions awaiting grading.' : 'No submissions yet.'}</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(sub => {
                  const statusColor = sub.status === 'graded' ? '#10b981' : '#f59e0b';
                  const qCount = Array.isArray(sub.questions) ? sub.questions.length : 0;
                  return (
                    <div key={sub.attempt_id} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: `hsl(${(sub.student_username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'bold', color: 'white', fontSize: 13,
                      }}>
                        {(sub.student_username[0] || '?').toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{sub.student_username}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>
                          {sub.quiz_title} · {qCount} Q{qCount !== 1 ? 's' : ''}
                          {sub.submitted_at && ` · ${new Date(sub.submitted_at).toLocaleDateString()}`}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5,
                        background: `${statusColor}22`, border: `1px solid ${statusColor}55`, color: statusColor,
                      }}>
                        {sub.status === 'graded' ? `Score: ${sub.score}` : 'Awaiting grade'}
                      </span>
                      <button onClick={() => openGrading(sub)} style={{
                        padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
                        background: sub.status === 'submitted' ? `${COLOR}22` : 'transparent',
                        border: `1px solid ${sub.status === 'submitted' ? COLOR_DIM : '#334155'}`,
                        color: sub.status === 'submitted' ? COLOR : '#94a3b8', cursor: 'pointer',
                      }}>
                        {sub.status === 'submitted' ? '✏️ Grade' : '👁️ View'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Content tab */}
          {classDetailTab === 'content' && (
            loadingContent ? (
              <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30 }}>Loading content...</div>
            ) : classContentItems.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
                <div style={{ fontSize: 30, marginBottom: 8 }}>📚</div>
                <div>No content in this class yet.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {classContentItems.map(item => {
                  const typeIcon = item.content_type === 'program' ? '📘' : item.content_type === 'assignment' ? '📝' : '📋';
                  const typeLabel = item.content_type === 'program' ? 'Program' : item.content_type === 'assignment' ? 'Quest' : 'Quiz';
                  const statusColor = item.status === 'published' ? '#10b981' : '#f59e0b';
                  return (
                    <div key={item.id} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ fontSize: 22, flexShrink: 0 }}>{item.cover_emoji || typeIcon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{item.title}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>
                          {typeLabel} · {item.subject}
                          {item.content_type !== 'program' && ` · ${item.questions_count} question${item.questions_count !== 1 ? 's' : ''}`}
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
        </div>

        {/* Chat overlay */}
        {showChat && user && selectedClass && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 900, display: 'flex', flexDirection: 'column' }}>
            <ChatWidget
              userId={user.uid}
              username={userData?.username || ''}
              classId={selectedClass.id}
              color={COLOR}
              onClose={() => setShowChat(false)}
            />
          </div>
        )}

        {renderGradingModal()}
      </div>
    );
  }

  // ─── Main Layout ────────────────────────────────────────────────────────

  function switchTopTab(t: TopTab) {
    setTopTab(t);
    setSelectedClass(null);
    setSelectedParentChat(null);
    if (t === 'parents' && parentLinks.length === 0) {
      setLoadingParents(true);
      getStudentParentLinksForTA().then(l => setParentLinks(l)).catch(e => console.error(e)).finally(() => setLoadingParents(false));
    }
  }

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 'bold', fontFamily: 'inherit',
    background: active ? `${COLOR}22` : 'transparent',
    border: `1px solid ${active ? COLOR_DIM : '#33415555'}`,
    color: active ? COLOR : '#64748b', cursor: 'pointer',
  });

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      <SettingsLauncher compact />
      {/* Header */}
      <div style={{ padding: '16px 20px', background: '#1e293b', borderBottom: `2px solid ${COLOR}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0, color: 'white', fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: COLOR }}>✏️</span> TA
            <span style={{ fontSize: 11, background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, borderRadius: 6, padding: '2px 8px', fontWeight: 'normal' }}>{userData?.username || 'TA'}</span>
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadAll} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>↺ Refresh</button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
              style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>Sign Out</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([{ id: 'classes' as TopTab, icon: '🏫', label: `Classes (${classes.length})` }, { id: 'parents' as TopTab, icon: '👨‍👩‍👧', label: 'Parent Reports' }]).map(t => (
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

        {/* ── PARENT REPORTS ── */}
        {topTab === 'parents' && !selectedParentChat && (
          loadingParents ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 30 }}>Loading...</div> :
          parentLinks.length === 0 ? <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}><div style={{ fontSize: 30, marginBottom: 8 }}>👨‍👩‍👧</div><div>No parent-student links found.</div></div> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {parentLinks.map(l => (
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
        {topTab === 'classes' && (
          classes.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>✏️</div>
              <div>You're not assigned to any classes yet.</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Ask your admin to add you as a TA to a class.</div>
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
                    <div style={{ color: '#64748b', fontSize: 11 }}>Teacher: <span style={{ color: '#10b981' }}>{cls.teacher_username}</span></div>
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
