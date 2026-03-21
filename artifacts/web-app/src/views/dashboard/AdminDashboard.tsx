import { useState, useEffect } from 'react';
import { getAllUsers, updateUserData, updateEconomy, UserData, UserRole, computeLevel } from '@/lib/userService';
import { getAllClasses, ClassData } from '@/lib/classService';

type Tab = 'overview' | 'users' | 'classes' | 'analytics';

const ROLE_COLORS: Record<UserRole, string> = {
  student: '#3b82f6', teacher: '#10b981', admin: '#f97316'
};

const GAME_LABELS: Record<string, string> = {
  quickMath: 'Quick Math', advQuickMath: 'Adv Math', pyramid: 'Pyramid',
  blockPuzzle: 'Blocks', flipNodes: 'Flip Nodes', fifteenPuzzle: '15 Puzzle',
  sequence: 'Sequence', trueFalse: 'True/False', missingOp: 'Missing Op',
  compareExp: 'Compare', completeEq: 'Complete Eq', memoOrder: 'Memo Order',
  memoCells: 'Memo Cells', ticTacToe: 'Tic-Tac-Toe', chessMemory: 'Chess Mem',
  neonGrid: 'Neon Grid', flipCup: 'Flip Cup',
};

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

function totalHighScores(hs?: Record<string, number>): number {
  if (!hs) return 0;
  return Object.values(hs).filter(v => v > 0).length;
}

interface EconModalState {
  uid: string;
  username: string;
  goldDelta: string;
  xpDelta: string;
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<Array<UserData & { uid: string }>>([]);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const [econModal, setEconModal] = useState<EconModalState | null>(null);
  const [applyingEcon, setApplyingEcon] = useState(false);
  const [classStudents, setClassStudents] = useState<Record<string, Array<UserData & { uid: string }>>>({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [u, c] = await Promise.all([getAllUsers(), getAllClasses()]);
    setUsers(u);
    setClasses(c);
    setLoading(false);
  }

  async function handleRoleChange(uid: string, role: UserRole) {
    setChangingRole(uid);
    await updateUserData(uid, { role });
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u));
    setChangingRole(null);
  }

  async function handleEconApply() {
    if (!econModal) return;
    const gold = parseInt(econModal.goldDelta) || 0;
    const xp = parseInt(econModal.xpDelta) || 0;
    if (gold === 0 && xp === 0) { setEconModal(null); return; }
    setApplyingEcon(true);
    await updateEconomy(econModal.uid, gold, xp);
    setUsers(prev => prev.map(u => u.uid === econModal.uid ? {
      ...u,
      economy: {
        ...u.economy,
        gold: Math.max(0, (u.economy?.gold || 0) + gold),
        global_xp: Math.max(0, (u.economy?.global_xp || 0) + xp)
      }
    } : u));
    setApplyingEcon(false);
    setEconModal(null);
  }

  async function loadClassStudents(cls: ClassData) {
    if (classStudents[cls.id]) return;
    const studentData = cls.studentIds
      .map(sid => users.find(u => u.uid === sid))
      .filter(Boolean) as Array<UserData & { uid: string }>;
    setClassStudents(prev => ({ ...prev, [cls.id]: studentData }));
  }

  // ── Derived stats ──────────────────────────────────
  const totalStudents = users.filter(u => u.role === 'student').length;
  const totalTeachers = users.filter(u => u.role === 'teacher').length;
  const totalAdmins = users.filter(u => u.role === 'admin').length;
  const today = new Date().toISOString().split('T')[0];
  const activeToday = users.filter(u => u.last_active === today).length;
  const totalXP = users.reduce((a, u) => a + (u.economy?.global_xp || 0), 0);
  const totalGold = users.reduce((a, u) => a + (u.economy?.gold || 0), 0);
  const totalObjectives = users.reduce((a, u) => a + countMastered(u.progress), 0);
  const totalArenaWins = users.reduce((a, u) => a + (u.arenaStats?.wins || 0), 0);
  const totalArenaBattles = users.reduce((a, u) => a + (u.arenaStats?.wins || 0) + (u.arenaStats?.losses || 0), 0);
  const avgXP = users.length ? Math.round(totalXP / users.length) : 0;

  // Game popularity: count how many users have a score > 0 per game
  const gamePopularity = Object.keys(GAME_LABELS).map(gid => ({
    id: gid,
    label: GAME_LABELS[gid],
    players: users.filter(u => (u.high_scores?.[gid] || 0) > 0).length,
    topScore: Math.max(0, ...users.map(u => u.high_scores?.[gid] || 0))
  })).sort((a, b) => b.players - a.players);

  const filteredUsers = users.filter(u => {
    const matchesSearch = !search || [u.username, u.email, u.firstName, u.lastName]
      .some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const topArena = [...users]
    .filter(u => (u.arenaStats?.wins || 0) > 0)
    .sort((a, b) => (b.arenaStats?.wins || 0) - (a.arenaStats?.wins || 0))
    .slice(0, 5);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
          <div>Loading admin panel...</div>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'overview', icon: '📊', label: 'Overview' },
    { id: 'users', icon: '👥', label: `Users (${users.length})` },
    { id: 'classes', icon: '🏫', label: `Classes (${classes.length})` },
    { id: 'analytics', icon: '📈', label: 'Analytics' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 19 }}>⚙️ Admin Dashboard</h2>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Full platform oversight and management</div>
          </div>
          <button onClick={loadData} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
            background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer'
          }}>
            ↺ Refresh
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t.id ? 'rgba(59,130,246,0.2)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'rgba(59,130,246,0.5)' : 'transparent'}`,
              color: tab === t.id ? '#93c5fd' : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap'
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            {/* Primary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total Users', value: users.length, icon: '👤', color: '#c084fc' },
                { label: 'Students', value: totalStudents, icon: '🧑‍🎓', color: '#3b82f6' },
                { label: 'Teachers', value: totalTeachers, icon: '🧑‍🏫', color: '#10b981' },
                { label: 'Active Today', value: activeToday, icon: '⚡', color: '#fbbf24' },
                { label: 'Total Classes', value: classes.length, icon: '🏫', color: '#f97316' },
                { label: 'Avg XP', value: avgXP.toLocaleString(), icon: '⭐', color: '#06b6d4' },
                { label: 'Arena Battles', value: totalArenaBattles, icon: '⚔️', color: '#ef4444' },
                { label: 'Obj. Mastered', value: totalObjectives, icon: '🎯', color: '#a78bfa' },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: '#1e293b', borderRadius: 10, padding: '14px 12px',
                  border: `1px solid ${stat.color}33`, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              {/* Top players by XP */}
              <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
                <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>🏆 Top XP</h3>
                {[...users]
                  .sort((a, b) => (b.economy?.global_xp || 0) - (a.economy?.global_xp || 0))
                  .slice(0, 5)
                  .map((u, i) => {
                    const { level } = computeLevel(u.economy?.global_xp || 0);
                    const medals = ['🥇', '🥈', '🥉', '#4', '#5'];
                    return (
                      <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < 4 ? '1px solid #1e293b' : 'none' }}>
                        <span style={{ fontSize: 16, width: 24, flexShrink: 0 }}>{medals[i]}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 'bold', color: 'white', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.username || `${u.firstName} ${u.lastName}`}
                          </div>
                          <div style={{ color: '#64748b', fontSize: 10 }}>Lv.{level} · {u.role}</div>
                        </div>
                        <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 12, flexShrink: 0 }}>
                          {(u.economy?.global_xp || 0).toLocaleString()}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Top Arena fighters */}
              <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
                <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>⚔️ Arena Champions</h3>
                {topArena.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>No battles yet</div>
                ) : topArena.map((u, i) => {
                  const wins = u.arenaStats?.wins || 0;
                  const losses = u.arenaStats?.losses || 0;
                  const streak = u.arenaStats?.highestStreak || 0;
                  const medals = ['🥇', '🥈', '🥉', '#4', '#5'];
                  return (
                    <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < topArena.length - 1 ? '1px solid #1e293b' : 'none' }}>
                      <span style={{ fontSize: 16, width: 24, flexShrink: 0 }}>{medals[i]}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {u.username || `${u.firstName} ${u.lastName}`}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 10 }}>{wins}W / {losses}L{streak >= 3 ? ` · 🔥${streak}` : ''}</div>
                      </div>
                      <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 12, flexShrink: 0 }}>{wins}W</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* User distribution */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>👥 User Distribution</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([['Students', totalStudents, '#3b82f6'], ['Teachers', totalTeachers, '#10b981'], ['Admins', totalAdmins, '#f97316']] as [string, number, string][]).map(([label, count, color]) => (
                  <div key={label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                      <span style={{ color: '#cbd5e1' }}>{label}</span>
                      <span style={{ color, fontWeight: 'bold' }}>
                        {count} ({users.length > 0 ? Math.round(count / users.length * 100) : 0}%)
                      </span>
                    </div>
                    <div style={{ height: 7, background: '#0f172a', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${users.length > 0 ? (count / users.length) * 100 : 0}%`, height: '100%', background: color, transition: '0.5s', borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search name, username, email..."
                style={{
                  flex: 1, minWidth: 180, padding: '9px 13px', borderRadius: 8,
                  border: '1px solid #475569', background: '#1e293b', color: 'white',
                  fontFamily: 'inherit', fontSize: 13, outline: 'none'
                }}
              />
              <select
                value={roleFilter} onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
                style={{
                  padding: '9px 13px', borderRadius: 8, border: '1px solid #475569',
                  background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', outline: 'none'
                }}
              >
                <option value="all">All Roles</option>
                <option value="student">Students</option>
                <option value="teacher">Teachers</option>
                <option value="admin">Admins</option>
              </select>
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>{filteredUsers.length} users found</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredUsers.map(u => {
                const { level, title } = computeLevel(u.economy?.global_xp || 0);
                const isExpanded = expandedUser === u.uid;
                const mastered = countMastered(u.progress);
                const arenaW = u.arenaStats?.wins ?? 0;
                const arenaL = u.arenaStats?.losses ?? 0;
                const isActiveToday = u.last_active === today;

                return (
                  <div key={u.uid} style={{
                    background: '#1e293b', borderRadius: 10,
                    border: `1px solid ${isExpanded ? '#3b82f688' : '#334155'}`,
                    overflow: 'hidden'
                  }}>
                    {/* Main row */}
                    <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                        style={{
                          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                          background: `hsl(${(u.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 'bold', color: 'white', fontSize: 15, border: 'none', cursor: 'pointer'
                        }}
                      >
                        {(u.username?.[0] || u.firstName?.[0] || '?').toUpperCase()}
                      </button>
                      <div style={{ flex: 1, minWidth: 120 }}>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {u.username || `${u.firstName} ${u.lastName}`}
                          {isActiveToday && (
                            <span style={{ fontSize: 9, background: 'rgba(16,185,129,0.12)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, padding: '1px 5px' }}>
                              Online today
                            </span>
                          )}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{u.email} · Lv.{level} {title}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5, textTransform: 'capitalize',
                          background: `${ROLE_COLORS[u.role as UserRole] || '#475569'}22`,
                          border: `1px solid ${ROLE_COLORS[u.role as UserRole] || '#475569'}55`,
                          color: ROLE_COLORS[u.role as UserRole] || '#94a3b8'
                        }}>
                          {u.role || 'student'}
                        </span>
                        <select
                          value={u.role || 'student'}
                          disabled={changingRole === u.uid}
                          onChange={e => handleRoleChange(u.uid, e.target.value as UserRole)}
                          style={{
                            padding: '4px 9px', borderRadius: 6, border: '1px solid #475569',
                            background: '#0f172a', color: '#94a3b8', fontFamily: 'inherit', fontSize: 11,
                            cursor: 'pointer', outline: 'none'
                          }}
                        >
                          <option value="student">→ Student</option>
                          <option value="teacher">→ Teacher</option>
                          <option value="admin">→ Admin</option>
                        </select>
                        <button
                          onClick={() => setEconModal({ uid: u.uid, username: u.username || u.firstName, goldDelta: '', xpDelta: '' })}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 'bold',
                            background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                            color: '#fbbf24', cursor: 'pointer', fontFamily: 'inherit'
                          }}
                          title="Adjust XP / Gold"
                        >
                          ✏️ Adjust
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid #334155' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                          {[
                            { label: 'XP', value: (u.economy?.global_xp || 0).toLocaleString(), icon: '⭐', color: '#10b981' },
                            { label: 'Gold', value: (u.economy?.gold || 0).toLocaleString(), icon: '🪙', color: '#fbbf24' },
                            { label: 'Arena W/L', value: `${arenaW}/${arenaL}`, icon: '⚔️', color: '#60a5fa' },
                            { label: 'Best Streak', value: u.arenaStats?.highestStreak ?? 0, icon: '🔥', color: '#f97316' },
                            { label: 'Objectives', value: mastered, icon: '🎯', color: '#a78bfa' },
                            { label: 'Games Played', value: totalHighScores(u.high_scores), icon: '🎮', color: '#34d399' },
                          ].map(s => (
                            <div key={s.label} style={{ background: '#0f172a', borderRadius: 8, padding: '9px 10px', textAlign: 'center', border: '1px solid #334155' }}>
                              <div style={{ fontSize: 16, marginBottom: 3 }}>{s.icon}</div>
                              <div style={{ fontSize: 15, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                              <div style={{ color: '#475569', fontSize: 10 }}>{s.label}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ color: '#475569', fontSize: 11, marginTop: 10 }}>
                          Last active: {u.last_active || 'Never'} · UID: {u.uid.slice(0, 12)}…
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CLASSES ── */}
        {tab === 'classes' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <h3 style={{ color: 'white', margin: '0 0 14px', fontSize: 16 }}>🏫 All Classes</h3>
            {classes.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🏫</div>
                <p>No classes created yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {classes.map(cls => {
                  const isExpanded = expandedClass === cls.id;
                  const teacher = users.find(u => u.uid === cls.teacherId);
                  const studs = classStudents[cls.id] || [];
                  const avgClsXP = studs.length
                    ? Math.round(studs.reduce((a, s) => a + (s.economy?.global_xp || 0), 0) / studs.length)
                    : 0;

                  return (
                    <div key={cls.id} style={{
                      background: '#1e293b', borderRadius: 12,
                      border: `1px solid ${isExpanded ? '#3b82f688' : '#334155'}`,
                      overflow: 'hidden'
                    }}>
                      <button
                        onClick={async () => {
                          if (!isExpanded) await loadClassStudents(cls);
                          setExpandedClass(isExpanded ? null : cls.id);
                        }}
                        style={{
                          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                          padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 'bold', color: 'white', fontSize: 15 }}>{cls.name}</span>
                            <span style={{
                              fontWeight: 'bold', fontSize: 12, letterSpacing: 2,
                              background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                              borderRadius: 5, padding: '2px 7px', color: '#fbbf24'
                            }}>
                              {cls.code}
                            </span>
                          </div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>
                            {cls.subject} · 👨‍🏫 {cls.teacherName} · 👥 {cls.studentIds.length} students
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ color: '#94a3b8', fontSize: 11 }}>Created</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>{new Date(cls.createdAt).toLocaleDateString()}</div>
                        </div>
                        <span style={{ color: '#475569', fontSize: 14 }}>{isExpanded ? '▲' : '▼'}</span>
                      </button>

                      {isExpanded && (
                        <div style={{ padding: '0 16px 14px', borderTop: '1px solid #334155' }}>
                          {/* Teacher detail */}
                          {teacher && (
                            <div style={{ padding: '10px 0', borderBottom: '1px solid #1e293b', marginBottom: 10 }}>
                              <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Teacher</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{
                                  width: 30, height: 30, borderRadius: '50%',
                                  background: `hsl(${(teacher.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontWeight: 'bold', color: 'white', fontSize: 13, flexShrink: 0
                                }}>
                                  {(teacher.username?.[0] || teacher.firstName?.[0] || '?').toUpperCase()}
                                </div>
                                <div>
                                  <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>
                                    {teacher.username || `${teacher.firstName} ${teacher.lastName}`}
                                  </div>
                                  <div style={{ color: '#64748b', fontSize: 11 }}>{teacher.email}</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Student list */}
                          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                            Students {studs.length > 0 && `· avg ${avgClsXP.toLocaleString()} XP`}
                          </div>
                          {cls.studentIds.length === 0 ? (
                            <div style={{ color: '#475569', fontSize: 12 }}>No students enrolled yet.</div>
                          ) : studs.length === 0 ? (
                            <div style={{ color: '#475569', fontSize: 12 }}>Loading students...</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {studs.map(s => {
                                const { level } = computeLevel(s.economy?.global_xp || 0);
                                return (
                                  <div key={s.uid} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    background: '#0f172a', borderRadius: 8, padding: '8px 12px'
                                  }}>
                                    <div style={{
                                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                                      background: `hsl(${(s.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontWeight: 'bold', color: 'white', fontSize: 12
                                    }}>
                                      {(s.username?.[0] || s.firstName?.[0] || '?').toUpperCase()}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>
                                        {s.username || `${s.firstName} ${s.lastName}`}
                                      </div>
                                      <div style={{ color: '#64748b', fontSize: 10 }}>Lv.{level} · 🎯 {countMastered(s.progress)} obj</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ color: '#10b981', fontSize: 12, fontWeight: 'bold' }}>{(s.economy?.global_xp || 0).toLocaleString()} XP</div>
                                      <div style={{ color: '#60a5fa', fontSize: 10 }}>⚔️ {s.arenaStats?.wins ?? 0}W</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS ── */}
        {tab === 'analytics' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <h3 style={{ color: 'white', margin: '0 0 14px', fontSize: 16 }}>📈 Platform Analytics</h3>

            {/* Platform totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total XP Earned', value: totalXP.toLocaleString(), icon: '⭐', color: '#10b981' },
                { label: 'Total Gold', value: totalGold.toLocaleString(), icon: '🪙', color: '#fbbf24' },
                { label: 'Total Objectives', value: totalObjectives, icon: '🎯', color: '#a78bfa' },
                { label: 'Arena Wins Total', value: totalArenaWins, icon: '⚔️', color: '#ef4444' },
                { label: 'Total Battles', value: totalArenaBattles, icon: '🏟️', color: '#f97316' },
                { label: 'Avg XP/Student', value: totalStudents > 0 ? Math.round(totalXP / totalStudents).toLocaleString() : '—', icon: '📊', color: '#06b6d4' },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: '#1e293b', borderRadius: 10, padding: '14px 12px',
                  border: `1px solid ${stat.color}33`, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                  <div style={{ color: '#64748b', fontSize: 10, marginTop: 3 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Game popularity */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155', marginBottom: 14 }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>🎮 Game Popularity</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {gamePopularity.slice(0, 10).map((g, i) => {
                  const maxPlayers = gamePopularity[0]?.players || 1;
                  const pct = maxPlayers > 0 ? (g.players / maxPlayers) * 100 : 0;
                  const bar = i === 0 ? '#3b82f6' : i < 3 ? '#6366f1' : '#334155';
                  return (
                    <div key={g.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 12 }}>
                        <span style={{ color: '#cbd5e1' }}>
                          {i === 0 ? '🏅 ' : ''}{g.label}
                        </span>
                        <span style={{ color: '#64748b' }}>
                          {g.players} players · top score: {g.topScore}
                        </span>
                      </div>
                      <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: bar, borderRadius: 3, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Level distribution */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>🎓 Student Level Distribution</h3>
              {(() => {
                const buckets: Record<number, number> = {};
                users.filter(u => u.role === 'student').forEach(u => {
                  const { level } = computeLevel(u.economy?.global_xp || 0);
                  buckets[level] = (buckets[level] || 0) + 1;
                });
                const maxCount = Math.max(1, ...Object.values(buckets));
                return Array.from({ length: 9 }, (_, i) => i + 1).map(lv => {
                  const count = buckets[lv] || 0;
                  const LEVEL_TITLES = ['Initiate','Apprentice','Seeker','Scholar','Adept','Expert','Master','Grandmaster','Logic Lord'];
                  return (
                    <div key={lv} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <div style={{ width: 60, color: '#94a3b8', fontSize: 11, flexShrink: 0 }}>Lv.{lv}</div>
                      <div style={{ flex: 1, height: 14, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${(count / maxCount) * 100}%`, height: '100%',
                          background: lv >= 8 ? '#fbbf24' : lv >= 5 ? '#f97316' : '#3b82f6',
                          borderRadius: 3, transition: 'width 0.5s ease'
                        }} />
                      </div>
                      <div style={{ width: 32, textAlign: 'right', color: '#64748b', fontSize: 11, flexShrink: 0 }}>{count}</div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* XP / Gold adjustment modal */}
      {econModal && (
        <>
          <div onClick={() => setEconModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(380px, 90vw)',
            border: '2px solid #fbbf24', zIndex: 1001, boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
            animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 6px', color: 'white', fontSize: 18 }}>✏️ Adjust Economy</h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 18px' }}>
              User: <strong style={{ color: '#93c5fd' }}>{econModal.username}</strong><br />
              Use negative numbers to deduct.
            </p>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Gold Δ (e.g. +500 or -100)</label>
            <input
              type="number"
              placeholder="0"
              value={econModal.goldDelta}
              onChange={e => setEconModal(prev => prev ? { ...prev, goldDelta: e.target.value } : null)}
              style={{
                width: '100%', padding: '10px 13px', marginBottom: 12,
                borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)',
                color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none'
              }}
            />
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>XP Δ (e.g. +200 or -50)</label>
            <input
              type="number"
              placeholder="0"
              value={econModal.xpDelta}
              onChange={e => setEconModal(prev => prev ? { ...prev, xpDelta: e.target.value } : null)}
              style={{
                width: '100%', padding: '10px 13px', marginBottom: 16,
                borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)',
                color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none'
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEconModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>
                Cancel
              </button>
              <button
                onClick={handleEconApply}
                disabled={applyingEcon}
                className="ll-btn ll-btn-primary"
                style={{ flex: 1, padding: '11px' }}
              >
                {applyingEcon ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
