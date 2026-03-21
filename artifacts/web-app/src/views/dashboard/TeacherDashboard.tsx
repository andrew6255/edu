import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createClass, getClassesByTeacher, joinClassByCode, ClassData,
  removeStudentFromClass, deleteClass, updateClass
} from '@/lib/classService';
import { getUsersByClassId, UserData, computeLevel } from '@/lib/userService';

const GAME_LABELS: Record<string, string> = {
  quickMath: 'Quick Math',
  advQuickMath: 'Adv Math',
  pyramid: 'Pyramid',
  blockPuzzle: 'Blocks',
  flipNodes: 'Flip Nodes',
  fifteenPuzzle: '15 Puzzle',
  sequence: 'Sequence',
  trueFalse: 'True/False',
  missingOp: 'Missing Op',
  compareExp: 'Compare',
  completeEq: 'Complete Eq',
  memoOrder: 'Memo Order',
  memoCells: 'Memo Cells',
  ticTacToe: 'Tic-Tac-Toe',
  chessMemory: 'Chess Mem',
  neonGrid: 'Neon Grid',
  flipCup: 'Flip Cup',
};

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'History', 'English'];

type Tab = 'overview' | 'students' | 'progress' | 'scores' | 'leaderboard';

function countMastered(progress?: UserData['progress']): number {
  if (!progress) return 0;
  let count = 0;
  for (const curriculum of Object.values(progress)) {
    for (const chapter of Object.values(curriculum)) {
      for (const obj of Object.values(chapter)) {
        if (obj.mastered) count++;
      }
    }
  }
  return count;
}

function recentCompletions(progress?: UserData['progress'], n = 3): string[] {
  if (!progress) return [];
  const items: { name: string; completedAt: string }[] = [];
  for (const curriculum of Object.values(progress)) {
    for (const chapter of Object.values(curriculum)) {
      for (const [objId, obj] of Object.entries(chapter)) {
        if (obj.mastered && obj.completedAt) {
          items.push({ name: objId.replace(/_/g, ' '), completedAt: obj.completedAt });
        }
      }
    }
  }
  return items
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, n)
    .map(x => x.name);
}

export default function TeacherDashboard() {
  const { user, userData } = useAuth();
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassData | null>(null);
  const [students, setStudents] = useState<Array<UserData & { uid: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newSubject, setNewSubject] = useState('Mathematics');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [copiedCode, setCopiedCode] = useState(false);
  const [removingStudent, setRemovingStudent] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadClasses();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (selectedClass) loadStudents(selectedClass);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass]);

  async function loadClasses() {
    if (!user) return;
    setLoading(true);
    const list = await getClassesByTeacher(user.uid);
    setClasses(list);
    if (list.length > 0 && !selectedClass) setSelectedClass(list[0]);
    setLoading(false);
  }

  async function loadStudents(cls: ClassData) {
    const studs = await getUsersByClassId(cls.id);
    setStudents(studs);
  }

  async function handleCreate() {
    if (!newClassName.trim() || !user || !userData) return;
    setCreating(true);
    const cls = await createClass(user.uid, userData.username || `${userData.firstName} ${userData.lastName}`, {
      name: newClassName.trim(), subject: newSubject, description: newDescription.trim()
    });
    setClasses(prev => [...prev, cls]);
    setSelectedClass(cls);
    setShowCreate(false);
    setNewClassName(''); setNewDescription('');
    setCreating(false);
  }

  async function handleRemoveStudent(studentId: string) {
    if (!selectedClass) return;
    setRemovingStudent(studentId);
    await removeStudentFromClass(selectedClass.id, studentId);
    setStudents(prev => prev.filter(s => s.uid !== studentId));
    setClasses(prev => prev.map(c => c.id === selectedClass.id
      ? { ...c, studentIds: c.studentIds.filter(id => id !== studentId) }
      : c
    ));
    setRemovingStudent(null);
  }

  async function handleDeleteClass() {
    if (!selectedClass) return;
    setDeleting(true);
    await deleteClass(selectedClass.id);
    const remaining = classes.filter(c => c.id !== selectedClass.id);
    setClasses(remaining);
    setSelectedClass(remaining[0] || null);
    setStudents([]);
    setConfirmDelete(false);
    setDeleting(false);
  }

  function copyCode() {
    if (!selectedClass) return;
    navigator.clipboard.writeText(selectedClass.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  const avgXP = students.length
    ? Math.round(students.reduce((a, s) => a + (s.economy?.global_xp || 0), 0) / students.length)
    : 0;
  const activeToday = students.filter(s => s.last_active === new Date().toISOString().split('T')[0]).length;
  const totalMastered = students.reduce((a, s) => a + countMastered(s.progress), 0);
  const sortedByXP = [...students].sort((a, b) => (b.economy?.global_xp || 0) - (a.economy?.global_xp || 0));

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px', marginBottom: 12,
    borderRadius: 8, border: '1px solid #475569',
    background: 'rgba(0,0,0,0.4)', color: 'white',
    boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none'
  };

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'overview', icon: '📊', label: 'Overview' },
    { id: 'students', icon: '👥', label: 'Students' },
    { id: 'progress', icon: '📈', label: 'Progress' },
    { id: 'scores', icon: '🎮', label: 'Scores' },
    { id: 'leaderboard', icon: '🏆', label: 'Top XP' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', background: '#0f172a' }}>
      {/* Left sidebar */}
      <div style={{
        width: 210, background: '#1e293b', borderRight: '1px solid #334155',
        display: 'flex', flexDirection: 'column', flexShrink: 0
      }}>
        <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid #334155' }}>
          <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13, marginBottom: 9 }}>📚 My Classes</div>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              width: '100%', padding: '8px', borderRadius: 8, fontSize: 13, fontWeight: 'bold',
              background: 'rgba(59,130,246,0.2)', border: '1px solid rgba(59,130,246,0.5)',
              color: '#93c5fd', cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            + New Class
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {loading ? (
            <div style={{ color: '#64748b', fontSize: 13, padding: 10 }}>Loading...</div>
          ) : classes.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12, padding: '10px', textAlign: 'center', lineHeight: 1.5 }}>
              No classes yet.<br />Create one!
            </div>
          ) : (
            classes.map(cls => (
              <button
                key={cls.id}
                onClick={() => { setSelectedClass(cls); setTab('overview'); setExpandedStudent(null); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 11px', borderRadius: 8, marginBottom: 4,
                  background: selectedClass?.id === cls.id ? 'rgba(59,130,246,0.2)' : 'transparent',
                  border: selectedClass?.id === cls.id ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                  color: selectedClass?.id === cls.id ? '#93c5fd' : '#cbd5e1',
                  cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cls.name}</div>
                <div style={{ fontSize: 11, opacity: 0.65 }}>{cls.subject} · {cls.studentIds.length} students</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedClass ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 56 }}>📋</div>
            <div style={{ color: '#94a3b8', fontSize: 15 }}>Select or create a class to get started</div>
            <button className="ll-btn ll-btn-primary" onClick={() => setShowCreate(true)}>Create First Class</button>
          </div>
        ) : (
          <>
            {/* Class header */}
            <div style={{ padding: '13px 18px 0', borderBottom: '1px solid #334155', background: '#1e293b', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <div>
                  <h2 style={{ margin: 0, color: 'white', fontSize: 19 }}>{selectedClass.name}</h2>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    {selectedClass.subject}{selectedClass.description && ` · ${selectedClass.description}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'rgba(0,0,0,0.3)', borderRadius: 9, padding: '7px 12px',
                    border: '1px solid #334155'
                  }}>
                    <div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Join Code</div>
                      <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 19, letterSpacing: 3 }}>{selectedClass.code}</div>
                    </div>
                    <button
                      onClick={copyCode}
                      style={{
                        padding: '6px 11px', borderRadius: 7, fontSize: 12, fontWeight: 'bold',
                        background: copiedCode ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.15)',
                        border: copiedCode ? '1px solid #10b981' : '1px solid #334155',
                        color: copiedCode ? '#10b981' : '#93c5fd', cursor: 'pointer', fontFamily: 'inherit'
                      }}
                    >
                      {copiedCode ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
                {tabs.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    padding: '7px 14px', borderRadius: '8px 8px 0 0', fontSize: 13,
                    fontWeight: 'bold', fontFamily: 'inherit', flexShrink: 0,
                    background: tab === t.id ? '#0f172a' : 'transparent',
                    border: `1px solid ${tab === t.id ? '#334155' : 'transparent'}`,
                    borderBottom: tab === t.id ? '1px solid #0f172a' : '1px solid transparent',
                    color: tab === t.id ? 'white' : '#64748b', cursor: 'pointer',
                  }}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

              {/* ── OVERVIEW ── */}
              {tab === 'overview' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
                    {[
                      { label: 'Total Students', value: students.length, icon: '👥', color: '#3b82f6' },
                      { label: 'Active Today', value: activeToday, icon: '⚡', color: '#10b981' },
                      { label: 'Avg XP', value: avgXP.toLocaleString(), icon: '⭐', color: '#fbbf24' },
                      { label: 'Objectives Mastered', value: totalMastered, icon: '🎯', color: '#a78bfa' },
                    ].map(stat => (
                      <div key={stat.label} style={{
                        background: '#1e293b', borderRadius: 12, padding: '16px 14px',
                        border: `1px solid ${stat.color}44`, textAlign: 'center'
                      }}>
                        <div style={{ fontSize: 26, marginBottom: 5 }}>{stat.icon}</div>
                        <div style={{ fontSize: 22, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                        <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: '#1e293b', borderRadius: 12, padding: 18, border: '1px solid #334155', marginBottom: 18 }}>
                    <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 15 }}>📢 Share with Students</h3>
                    <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
                      Students go to <strong style={{ color: '#93c5fd' }}>⚙ Settings → Join Class</strong> in the side menu and enter:
                    </p>
                    <div style={{
                      display: 'inline-block', background: '#0f172a', borderRadius: 10,
                      padding: '10px 22px', border: '2px solid #fbbf24',
                      fontSize: 26, fontWeight: 'bold', letterSpacing: 4, color: '#fbbf24'
                    }}>
                      {selectedClass.code}
                    </div>
                  </div>

                  {/* Danger zone */}
                  <div style={{ background: 'rgba(239,68,68,0.05)', borderRadius: 12, padding: 16, border: '1px solid rgba(239,68,68,0.2)' }}>
                    <h3 style={{ color: '#ef4444', margin: '0 0 8px', fontSize: 14 }}>⚠ Danger Zone</h3>
                    <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 12px' }}>
                      Deleting this class removes it permanently. Students are not deleted — they just lose their class association.
                    </p>
                    {!confirmDelete ? (
                      <button
                        onClick={() => setConfirmDelete(true)}
                        style={{
                          padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
                          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
                          color: '#ef4444', cursor: 'pointer'
                        }}
                      >
                        Delete Class
                      </button>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ color: '#fca5a5', fontSize: 13 }}>Are you sure?</span>
                        <button
                          onClick={handleDeleteClass}
                          disabled={deleting}
                          style={{
                            padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
                            background: '#ef4444', border: 'none', color: 'white', cursor: deleting ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {deleting ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDelete(false)}
                          className="ll-btn"
                          style={{ padding: '8px 14px', fontSize: 13 }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── STUDENTS ── */}
              {tab === 'students' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  {students.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                      <div style={{ fontSize: 44, marginBottom: 12 }}>🧑‍🎓</div>
                      <p>No students yet. Share code <strong style={{ color: '#fbbf24' }}>{selectedClass.code}</strong></p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {students.map(s => {
                        const { level, title } = computeLevel(s.economy?.global_xp || 0);
                        const xp = s.economy?.global_xp || 0;
                        const isActiveToday = s.last_active === new Date().toISOString().split('T')[0];
                        const arenaW = s.arenaStats?.wins ?? 0;
                        const arenaL = s.arenaStats?.losses ?? 0;
                        const mastered = countMastered(s.progress);
                        const isRemoving = removingStudent === s.uid;
                        return (
                          <div key={s.uid} style={{
                            background: '#1e293b', borderRadius: 12, padding: '14px 16px',
                            border: '1px solid #334155'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                              <div style={{
                                width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                                background: `hsl(${(s.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 38%)`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 'bold', fontSize: 17, color: 'white'
                              }}>
                                {(s.username?.[0] || s.firstName?.[0] || '?').toUpperCase()}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 'bold', color: 'white', fontSize: 14 }}>
                                    {s.username || `${s.firstName} ${s.lastName}`}
                                  </span>
                                  {isActiveToday && (
                                    <span style={{
                                      fontSize: 10, background: 'rgba(16,185,129,0.12)', color: '#10b981',
                                      border: '1px solid rgba(16,185,129,0.3)', borderRadius: 5, padding: '1px 6px'
                                    }}>
                                      Active today
                                    </span>
                                  )}
                                </div>
                                <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                                  Lv.{level} {title} · {xp.toLocaleString()} XP
                                </div>
                                <div style={{ height: 3, background: '#0f172a', borderRadius: 2, overflow: 'hidden', marginTop: 5 }}>
                                  <div style={{ width: `${Math.min(100, (xp % 1000) / 10)}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #10b981)' }} />
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 12 }}>
                                <div style={{ color: '#fbbf24', fontWeight: 'bold' }}>🪙 {(s.economy?.gold || 0).toLocaleString()}</div>
                                <div style={{ color: '#60a5fa', marginTop: 2 }}>⚔️ {arenaW}W/{arenaL}L</div>
                                <div style={{ color: '#a78bfa', marginTop: 2 }}>🎯 {mastered} obj</div>
                              </div>
                              <button
                                onClick={() => handleRemoveStudent(s.uid)}
                                disabled={isRemoving}
                                title="Remove from class"
                                style={{
                                  flexShrink: 0, padding: '5px 10px', borderRadius: 6, fontSize: 11,
                                  background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                                  color: '#ef4444', cursor: isRemoving ? 'not-allowed' : 'pointer',
                                  fontFamily: 'inherit', fontWeight: 'bold', opacity: isRemoving ? 0.5 : 1
                                }}
                              >
                                {isRemoving ? '...' : 'Remove'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── PROGRESS ── */}
              {tab === 'progress' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ marginBottom: 14 }}>
                    <h3 style={{ color: 'white', margin: '0 0 4px', fontSize: 17 }}>📈 Curriculum Progress</h3>
                    <p style={{ color: '#64748b', fontSize: 12, margin: 0 }}>
                      Objectives mastered by each student across all subjects.
                    </p>
                  </div>

                  {students.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                      <div style={{ fontSize: 44, marginBottom: 12 }}>📈</div>
                      <p>No students in this class yet.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[...students]
                        .sort((a, b) => countMastered(b.progress) - countMastered(a.progress))
                        .map((s, rank) => {
                          const mastered = countMastered(s.progress);
                          const recent = recentCompletions(s.progress, 3);
                          const isExpanded = expandedStudent === s.uid;
                          const name = s.username || `${s.firstName} ${s.lastName}`;
                          const maxMastered = Math.max(...students.map(st => countMastered(st.progress)), 1);
                          const pct = Math.round((mastered / maxMastered) * 100);
                          const isActiveToday = s.last_active === new Date().toISOString().split('T')[0];

                          // Build curriculum breakdown
                          const curriculumBreakdown: { name: string; mastered: number; total: number }[] = [];
                          if (s.progress) {
                            for (const [currId, chapters] of Object.entries(s.progress)) {
                              let m = 0; let t = 0;
                              for (const chapter of Object.values(chapters)) {
                                for (const obj of Object.values(chapter)) {
                                  t++;
                                  if (obj.mastered) m++;
                                }
                              }
                              curriculumBreakdown.push({ name: currId.replace(/_/g, ' '), mastered: m, total: t });
                            }
                          }

                          return (
                            <div key={s.uid} style={{
                              background: '#1e293b', borderRadius: 12,
                              border: `1px solid ${isExpanded ? '#3b82f6aa' : '#334155'}`,
                              overflow: 'hidden'
                            }}>
                              {/* Row */}
                              <button
                                onClick={() => setExpandedStudent(isExpanded ? null : s.uid)}
                                style={{
                                  width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                                  padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left'
                                }}
                              >
                                <div style={{
                                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                  background: `hsl(${(s.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 38%)`,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontWeight: 'bold', fontSize: 13, color: 'white'
                                }}>
                                  {(s.username?.[0] || s.firstName?.[0] || '?').toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5, flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 'bold', color: 'white', fontSize: 13 }}>
                                      #{rank + 1} {name}
                                    </span>
                                    {isActiveToday && (
                                      <span style={{ fontSize: 9, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, padding: '1px 5px' }}>
                                        Active today
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{
                                      width: `${pct}%`, height: '100%',
                                      background: mastered > 0
                                        ? 'linear-gradient(90deg, #6366f1, #10b981)'
                                        : '#334155',
                                      transition: 'width 0.5s ease'
                                    }} />
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                  <div style={{ color: '#a78bfa', fontWeight: 'bold', fontSize: 16 }}>{mastered}</div>
                                  <div style={{ color: '#64748b', fontSize: 10 }}>objectives</div>
                                </div>
                                <div style={{ color: '#475569', fontSize: 14 }}>{isExpanded ? '▲' : '▼'}</div>
                              </button>

                              {/* Expanded detail */}
                              {isExpanded && (
                                <div style={{ padding: '0 16px 14px', borderTop: '1px solid #334155' }}>
                                  {curriculumBreakdown.length === 0 ? (
                                    <p style={{ color: '#64748b', fontSize: 13, margin: '12px 0 0' }}>
                                      No objectives started yet.
                                    </p>
                                  ) : (
                                    <div style={{ marginTop: 12 }}>
                                      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                                        By Curriculum
                                      </div>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {curriculumBreakdown.map(c => (
                                          <div key={c.name}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                              <span style={{ color: '#cbd5e1', fontSize: 12, textTransform: 'capitalize' }}>{c.name}</span>
                                              <span style={{ color: '#a78bfa', fontSize: 12, fontWeight: 'bold' }}>{c.mastered}/{c.total}</span>
                                            </div>
                                            <div style={{ height: 5, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                                              <div style={{
                                                width: `${c.total > 0 ? Math.round((c.mastered / c.total) * 100) : 0}%`,
                                                height: '100%', background: '#6366f1', transition: 'width 0.4s'
                                              }} />
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {recent.length > 0 && (
                                    <div style={{ marginTop: 12 }}>
                                      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                                        Recent Completions
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {recent.map(r => (
                                          <span key={r} style={{
                                            fontSize: 11, padding: '3px 9px', borderRadius: 6,
                                            background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                                            color: '#a5b4fc', textTransform: 'capitalize'
                                          }}>
                                            ✓ {r}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div style={{ marginTop: 12, color: '#64748b', fontSize: 11 }}>
                                    Last active: {s.last_active || 'Never'}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              )}

              {/* ── SCORES ── */}
              {tab === 'scores' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  {students.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>No students yet.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #334155' }}>
                            <th style={{ textAlign: 'left', padding: '9px 12px', color: '#94a3b8', fontWeight: 'bold', whiteSpace: 'nowrap' }}>Student</th>
                            {Object.entries(GAME_LABELS).map(([id, label]) => (
                              <th key={id} style={{ textAlign: 'center', padding: '9px 7px', color: '#94a3b8', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: 11 }}>{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {students.map((s, i) => (
                            <tr key={s.uid} style={{ borderBottom: '1px solid #1e293b', background: i % 2 === 0 ? 'rgba(30,41,59,0.5)' : 'transparent' }}>
                              <td style={{ padding: '9px 12px', color: 'white', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                {s.username || `${s.firstName} ${s.lastName}`}
                              </td>
                              {Object.keys(GAME_LABELS).map(gid => {
                                const score = s.high_scores?.[gid] || 0;
                                const allScores = students.map(st => st.high_scores?.[gid] || 0);
                                const maxScore = Math.max(...allScores);
                                const isTop = score > 0 && score === maxScore;
                                return (
                                  <td key={gid} style={{ textAlign: 'center', padding: '9px 7px' }}>
                                    <span style={{ color: isTop ? '#fbbf24' : score > 0 ? '#cbd5e1' : '#334155', fontWeight: isTop ? 'bold' : 'normal' }}>
                                      {isTop ? '🏅' : ''}{score || '—'}
                                    </span>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ── LEADERBOARD ── */}
              {tab === 'leaderboard' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <h3 style={{ color: 'white', margin: '0 0 14px', fontSize: 17 }}>🏆 Class XP Leaderboard</h3>
                  {sortedByXP.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>No students yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sortedByXP.map((s, i) => {
                        const { level } = computeLevel(s.economy?.global_xp || 0);
                        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                        const rgb = ['251,191,36', '156,163,175', '180,131,71'];
                        return (
                          <div key={s.uid} style={{
                            background: i < 3 ? `rgba(${rgb[i]},0.07)` : '#1e293b',
                            borderRadius: 12, padding: '13px 16px',
                            border: `1px solid ${i < 3 ? `rgba(${rgb[i]},0.22)` : '#334155'}`,
                            display: 'flex', alignItems: 'center', gap: 13
                          }}>
                            <div style={{ fontSize: 20, width: 34, textAlign: 'center', flexShrink: 0 }}>{medal}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 'bold', color: 'white', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {s.username || `${s.firstName} ${s.lastName}`}
                              </div>
                              <div style={{ color: '#64748b', fontSize: 11 }}>Level {level} · 🎯 {countMastered(s.progress)} objectives</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 15 }}>{(s.economy?.global_xp || 0).toLocaleString()} XP</div>
                              <div style={{ color: '#60a5fa', fontSize: 11 }}>⚔️ {s.arenaStats?.wins ?? 0}W</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create class modal */}
      {showCreate && (
        <>
          <div onClick={() => setShowCreate(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 16, padding: 28, width: 'min(420px, 92vw)',
            border: '2px solid #3b82f6', zIndex: 1001, boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 18px', color: 'white', fontSize: 20 }}>📚 Create New Class</h2>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Class Name *</label>
            <input style={inputStyle} placeholder="e.g. Year 9 Mathematics" value={newClassName} onChange={e => setNewClassName(e.target.value)} />
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Subject *</label>
            <select style={{ ...inputStyle, background: '#0f172a', cursor: 'pointer' }} value={newSubject} onChange={e => setNewSubject(e.target.value)}>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Description (optional)</label>
            <input style={inputStyle} placeholder="e.g. IGCSE Cambridge Term 2" value={newDescription} onChange={e => setNewDescription(e.target.value)} />
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={() => setShowCreate(false)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleCreate} disabled={creating || !newClassName.trim()} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {creating ? 'Creating...' : 'Create Class'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
