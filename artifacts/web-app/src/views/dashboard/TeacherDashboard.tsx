import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClass, getClassesByTeacher, getClassById, joinClassByCode, ClassData } from '@/lib/classService';
import { getUsersByClassId, UserData, computeLevel } from '@/lib/userService';

const GAME_LABELS: Record<string, string> = {
  quickMath: 'Quick Math', pyramid: 'Pyramid', blockPuzzle: 'Blocks', fifteenPuzzle: '15 Puzzle',
  sequence: 'Sequence', advQuickMath: 'Adv Math', flipNodes: 'Flip Nodes'
};

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer Science', 'History', 'English'];

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
  const [tab, setTab] = useState<'overview' | 'students' | 'scores' | 'leaderboard'>('overview');
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (!user) return;
    loadClasses();
  }, [user]);

  useEffect(() => {
    if (selectedClass) loadStudents(selectedClass);
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
  const sortedByXP = [...students].sort((a, b) => (b.economy?.global_xp || 0) - (a.economy?.global_xp || 0));

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 15px', marginBottom: 12,
    borderRadius: 8, border: '1px solid #475569',
    background: 'rgba(0,0,0,0.4)', color: 'white',
    boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none'
  };

  return (
    <div style={{ height: '100%', display: 'flex', background: '#0f172a' }}>
      {/* Left sidebar — class list */}
      <div style={{
        width: 220, background: '#1e293b', borderRight: '1px solid #334155',
        display: 'flex', flexDirection: 'column', flexShrink: 0
      }}>
        <div style={{ padding: '15px 15px 10px', borderBottom: '1px solid #334155' }}>
          <div style={{ fontWeight: 'bold', color: 'white', fontSize: 14, marginBottom: 10 }}>📚 My Classes</div>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              width: '100%', padding: '9px', borderRadius: 8, fontSize: 13, fontWeight: 'bold',
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
              No classes yet.<br />Create one to get started!
            </div>
          ) : (
            classes.map(cls => (
              <button
                key={cls.id}
                onClick={() => setSelectedClass(cls)}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8, marginBottom: 4,
                  background: selectedClass?.id === cls.id ? 'rgba(59,130,246,0.2)' : 'transparent',
                  border: selectedClass?.id === cls.id ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                  color: selectedClass?.id === cls.id ? '#93c5fd' : '#cbd5e1',
                  cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 2 }}>{cls.name}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{cls.subject} • {cls.studentIds.length} students</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedClass ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 15 }}>
            <div style={{ fontSize: 60 }}>📋</div>
            <div style={{ color: '#94a3b8', fontSize: 16 }}>Select or create a class to get started</div>
            <button className="ll-btn ll-btn-primary" onClick={() => setShowCreate(true)}>Create First Class</button>
          </div>
        ) : (
          <>
            {/* Class header */}
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #334155', background: '#1e293b', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0, color: 'white', fontSize: 20 }}>{selectedClass.name}</h2>
                  <div style={{ color: '#64748b', fontSize: 13, marginTop: 3 }}>{selectedClass.subject}{selectedClass.description && ` • ${selectedClass.description}`}</div>
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: '8px 14px',
                  border: '1px solid #334155'
                }}>
                  <div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Join Code</div>
                    <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 20, letterSpacing: 3 }}>{selectedClass.code}</div>
                  </div>
                  <button
                    onClick={copyCode}
                    style={{
                      padding: '7px 12px', borderRadius: 7, fontSize: 12, fontWeight: 'bold',
                      background: copiedCode ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.15)',
                      border: copiedCode ? '1px solid #10b981' : '1px solid #334155',
                      color: copiedCode ? '#10b981' : '#93c5fd', cursor: 'pointer', fontFamily: 'inherit'
                    }}
                  >
                    {copiedCode ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 5, marginTop: 12 }}>
                {(['overview', 'students', 'scores', 'leaderboard'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{
                    padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
                    background: tab === t ? 'rgba(59,130,246,0.2)' : 'transparent',
                    border: `1px solid ${tab === t ? 'rgba(59,130,246,0.5)' : 'transparent'}`,
                    color: tab === t ? '#93c5fd' : '#64748b', cursor: 'pointer', textTransform: 'capitalize'
                  }}>
                    {{ overview: '📊', students: '👥', scores: '🎮', leaderboard: '🏆' }[t]} {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              {tab === 'overview' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 15, marginBottom: 25 }}>
                    {[
                      { label: 'Total Students', value: students.length, icon: '👥', color: '#3b82f6' },
                      { label: 'Active Today', value: activeToday, icon: '⚡', color: '#10b981' },
                      { label: 'Avg XP', value: avgXP.toLocaleString(), icon: '⭐', color: '#fbbf24' },
                      { label: 'Class Code', value: selectedClass.code, icon: '🔑', color: '#c084fc' },
                    ].map(stat => (
                      <div key={stat.label} style={{
                        background: '#1e293b', borderRadius: 12, padding: '18px 16px',
                        border: `1px solid ${stat.color}44`, textAlign: 'center'
                      }}>
                        <div style={{ fontSize: 28, marginBottom: 6 }}>{stat.icon}</div>
                        <div style={{ fontSize: 24, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                        <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
                    <h3 style={{ color: 'white', margin: '0 0 15px', fontSize: 16 }}>📢 Share with Students</h3>
                    <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px' }}>
                      Ask students to go to <strong style={{ color: '#93c5fd' }}>Settings → Join Class</strong> and enter code:
                    </p>
                    <div style={{
                      display: 'inline-block', background: '#0f172a', borderRadius: 10,
                      padding: '12px 25px', border: '2px solid #fbbf24',
                      fontSize: 28, fontWeight: 'bold', letterSpacing: 4, color: '#fbbf24'
                    }}>
                      {selectedClass.code}
                    </div>
                  </div>
                </div>
              )}

              {tab === 'students' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  {students.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                      <div style={{ fontSize: 48, marginBottom: 15 }}>🧑‍🎓</div>
                      <p>No students yet. Share the join code <strong style={{ color: '#fbbf24' }}>{selectedClass.code}</strong> to get started!</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {students.map(s => {
                        const { level, title } = computeLevel(s.economy?.global_xp || 0);
                        const xp = s.economy?.global_xp || 0;
                        const isActiveToday = s.last_active === new Date().toISOString().split('T')[0];
                        return (
                          <div key={s.uid} style={{
                            background: '#1e293b', borderRadius: 12, padding: '14px 18px',
                            border: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 15
                          }}>
                            <div style={{
                              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                              background: `hsl(${(s.username.charCodeAt(0) * 37) % 360}, 60%, 40%)`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 'bold', fontSize: 18, color: 'white'
                            }}>
                              {s.username?.[0]?.toUpperCase() || s.firstName?.[0]?.toUpperCase() || '?'}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 'bold', color: 'white', fontSize: 15 }}>{s.username || `${s.firstName} ${s.lastName}`}</span>
                                {isActiveToday && <span style={{ fontSize: 11, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, padding: '2px 7px' }}>Active today</span>}
                              </div>
                              <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>Lv.{level} {title} • {xp.toLocaleString()} XP</div>
                              <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden', marginTop: 6 }}>
                                <div style={{ width: `${Math.min(100, (xp % 1000) / 10)}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #10b981)' }} />
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ color: '#fbbf24', fontSize: 14, fontWeight: 'bold' }}>🪙 {(s.economy?.gold || 0).toLocaleString()}</div>
                              <div style={{ color: '#f97316', fontSize: 12 }}>🔥 {s.economy?.streak || 0}d</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {tab === 'scores' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  {students.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>No students yet.</div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #334155' }}>
                            <th style={{ textAlign: 'left', padding: '10px 12px', color: '#94a3b8', fontWeight: 'bold' }}>Student</th>
                            {Object.entries(GAME_LABELS).map(([id, label]) => (
                              <th key={id} style={{ textAlign: 'center', padding: '10px 8px', color: '#94a3b8', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {students.map((s, i) => (
                            <tr key={s.uid} style={{ borderBottom: '1px solid #1e293b', background: i % 2 === 0 ? 'rgba(30,41,59,0.5)' : 'transparent' }}>
                              <td style={{ padding: '10px 12px', color: 'white', fontWeight: 'bold' }}>
                                {s.username || `${s.firstName} ${s.lastName}`}
                              </td>
                              {Object.keys(GAME_LABELS).map(gid => {
                                const score = s.high_scores?.[gid] || 0;
                                const allScores = students.map(st => st.high_scores?.[gid] || 0);
                                const maxScore = Math.max(...allScores);
                                const isTop = score > 0 && score === maxScore;
                                return (
                                  <td key={gid} style={{ textAlign: 'center', padding: '10px 8px' }}>
                                    <span style={{ color: isTop ? '#fbbf24' : score > 0 ? '#cbd5e1' : '#475569', fontWeight: isTop ? 'bold' : 'normal' }}>
                                      {isTop ? '🏅 ' : ''}{score || '—'}
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

              {tab === 'leaderboard' && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                  <h3 style={{ color: 'white', margin: '0 0 15px', fontSize: 18 }}>🏆 Class Leaderboard</h3>
                  {sortedByXP.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>No students yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {sortedByXP.map((s, i) => {
                        const { level } = computeLevel(s.economy?.global_xp || 0);
                        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
                        return (
                          <div key={s.uid} style={{
                            background: i < 3 ? `rgba(${['251,191,36', '156,163,175', '180,131,71'][i]},0.08)` : '#1e293b',
                            borderRadius: 12, padding: '14px 18px',
                            border: `1px solid ${i < 3 ? `rgba(${['251,191,36', '156,163,175', '180,131,71'][i]},0.25)` : '#334155'}`,
                            display: 'flex', alignItems: 'center', gap: 15
                          }}>
                            <div style={{ fontSize: 22, width: 36, textAlign: 'center' }}>{medal}</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 'bold', color: 'white', fontSize: 15 }}>{s.username || `${s.firstName} ${s.lastName}`}</div>
                              <div style={{ color: '#64748b', fontSize: 12 }}>Level {level}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 16 }}>{(s.economy?.global_xp || 0).toLocaleString()} XP</div>
                              <div style={{ color: '#fbbf24', fontSize: 12 }}>🪙 {(s.economy?.gold || 0).toLocaleString()}</div>
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
            background: '#1e293b', borderRadius: 16, padding: 30, width: 'min(440px, 90vw)',
            border: '2px solid #3b82f6', zIndex: 1001, boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 20px', color: 'white', fontSize: 22 }}>📚 Create New Class</h2>
            <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 5 }}>Class Name *</label>
            <input style={inputStyle} placeholder="e.g. Year 9 Mathematics" value={newClassName} onChange={e => setNewClassName(e.target.value)} />
            <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 5 }}>Subject *</label>
            <select style={{ ...inputStyle, background: '#0f172a', cursor: 'pointer' }} value={newSubject} onChange={e => setNewSubject(e.target.value)}>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 5 }}>Description (optional)</label>
            <input style={inputStyle} placeholder="e.g. IGCSE Cambridge Term 2" value={newDescription} onChange={e => setNewDescription(e.target.value)} />
            <div style={{ display: 'flex', gap: 10, marginTop: 5 }}>
              <button onClick={() => setShowCreate(false)} className="ll-btn" style={{ flex: 1, padding: '12px' }}>Cancel</button>
              <button onClick={handleCreate} disabled={creating || !newClassName.trim()} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '12px' }}>
                {creating ? 'Creating...' : 'Create Class'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
