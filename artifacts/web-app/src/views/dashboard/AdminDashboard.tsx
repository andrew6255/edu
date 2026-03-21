import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getUsersByOrgId, updateUserData, updateEconomy, UserData, UserRole, computeLevel } from '@/lib/userService';
import { getClassesByOrgId, ClassData } from '@/lib/classService';
import { getOrgById, OrgData } from '@/lib/orgService';

type Tab = 'overview' | 'users' | 'classes' | 'analytics' | 'organisation';

const ROLE_COLORS: Record<string, string> = {
  student: '#3b82f6', teacher: '#10b981', admin: '#f97316', superadmin: '#a855f7'
};

const GAME_LABELS: Record<string, string> = {
  quickMath: 'Quick Math', timeLimit: 'Time Limit', advQuickMath: 'Adv Math',
  pyramid: 'Pyramid', blockPuzzle: 'Blocks', flipNodes: 'Flip Nodes',
  fifteenPuzzle: '15 Puzzle', sequence: 'Sequence', trueFalse: 'True/False',
  missingOp: 'Missing Op', compareExp: 'Compare', completeEq: 'Complete Eq',
  memoOrder: 'Memo Order', memoCells: 'Memo Cells', ticTacToe: 'Tic-Tac-Toe',
  chessMemory: 'Chess Mem', neonGrid: 'Neon Grid', flipCup: 'Flip Cup',
  nameSquare10: 'Name Sq (10s)', nameSquare60: 'Name Sq (60s)',
  findSquare10: 'Find Sq (10s)', findSquare60: 'Find Sq (60s)',
};

function countMastered(progress?: UserData['progress']): number {
  if (!progress) return 0;
  let count = 0;
  for (const curriculum of Object.values(progress))
    for (const chapter of Object.values(curriculum))
      for (const obj of Object.values(chapter))
        if (obj.mastered) count++;
  return count;
}

function totalHighScores(hs?: Record<string, number>): number {
  if (!hs) return 0;
  return Object.values(hs).filter(v => v > 0).length;
}

interface EconModalState { uid: string; username: string; goldDelta: string; xpDelta: string; }

export default function AdminDashboard() {
  const { user, userData: adminData } = useAuth();
  const [users, setUsers] = useState<Array<UserData & { uid: string }>>([]);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [org, setOrg] = useState<OrgData | null>(null);
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
  const [copiedJoinCode, setCopiedJoinCode] = useState(false);

  const orgId = adminData?.organisationId;

  useEffect(() => { if (orgId) loadData(); else setLoading(false); }, [orgId]);

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [u, c, o] = await Promise.all([
      getUsersByOrgId(orgId),
      getClassesByOrgId(orgId),
      getOrgById(orgId)
    ]);
    setUsers(u);
    setClasses(c);
    setOrg(o);
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

  function copyJoinCode() {
    if (!org) return;
    navigator.clipboard.writeText(org.joinCode);
    setCopiedJoinCode(true);
    setTimeout(() => setCopiedJoinCode(false), 2000);
  }

  // ── Derived stats ───────────────────────────────────
  const totalStudents = users.filter(u => u.role === 'student').length;
  const totalTeachers = users.filter(u => u.role === 'teacher').length;
  const today = new Date().toISOString().split('T')[0];
  const activeToday = users.filter(u => u.last_active === today).length;
  const totalXP = users.reduce((a, u) => a + (u.economy?.global_xp || 0), 0);
  const totalGold = users.reduce((a, u) => a + (u.economy?.gold || 0), 0);
  const totalObjectives = users.reduce((a, u) => a + countMastered(u.progress), 0);
  const totalArenaWins = users.reduce((a, u) => a + (u.arenaStats?.wins || 0), 0);
  const totalArenaBattles = users.reduce((a, u) => a + (u.arenaStats?.wins || 0) + (u.arenaStats?.losses || 0), 0);
  const avgXP = users.length ? Math.round(totalXP / users.length) : 0;

  const gamePopularity = Object.keys(GAME_LABELS).map(gid => ({
    id: gid, label: GAME_LABELS[gid],
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

  // ── No org assigned screen ─────────────────────────
  if (!orgId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 16, padding: 40 }}>
        <div style={{ fontSize: 56 }}>🏫</div>
        <h2 style={{ color: 'white', margin: 0 }}>Not assigned to an organisation</h2>
        <p style={{ color: '#64748b', textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
          Your admin account hasn't been linked to an organisation yet. Ask your Super Admin to assign you to one in the Super Admin panel.
        </p>
      </div>
    );
  }

  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'overview', icon: '📊', label: 'Overview' },
    { id: 'users', icon: '👥', label: `Users (${users.length})` },
    { id: 'classes', icon: '🏫', label: `Classes (${classes.length})` },
    { id: 'analytics', icon: '📈', label: 'Analytics' },
    { id: 'organisation', icon: '🏢', label: 'Organisation' },
  ];

  const ORG_TYPE_LABELS: Record<string, string> = { school: 'School', university: 'University', other: 'Other' };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 19 }}>
              ⚙️ {org?.name || 'Admin'} Dashboard
            </h2>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
              {org ? `${ORG_TYPE_LABELS[org.type] || org.type}${org.country ? ` · ${org.country}` : ''} · Join code: ` : 'Organisation management'}
              {org && (
                <span style={{ color: '#fbbf24', fontWeight: 'bold', letterSpacing: 1 }}>{org.joinCode}</span>
              )}
            </div>
          </div>
          <button onClick={loadData} style={{
            padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
            background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer'
          }}>
            ↺ Refresh
          </button>
        </div>
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t.id ? 'rgba(59,130,246,0.2)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'rgba(59,130,246,0.5)' : 'transparent'}`,
              color: tab === t.id ? '#93c5fd' : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total Members', value: users.length, icon: '👤', color: '#c084fc' },
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

            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>👥 Member Distribution</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([['Students', totalStudents, '#3b82f6'], ['Teachers', totalTeachers, '#10b981']] as [string, number, string][]).map(([label, count, color]) => (
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
              </select>
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>{filteredUsers.length} members found</div>

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
                          background: `${ROLE_COLORS[u.role] || '#475569'}22`,
                          border: `1px solid ${ROLE_COLORS[u.role] || '#475569'}55`,
                          color: ROLE_COLORS[u.role] || '#94a3b8'
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
            <h3 style={{ color: 'white', margin: '0 0 14px', fontSize: 16 }}>🏫 Organisation Classes</h3>
            {classes.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🏫</div>
                <p>No classes created in this organisation yet.</p>
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
                          width: '100%', textAlign: 'left', padding: '14px 16px',
                          background: 'none', border: 'none', cursor: 'pointer', color: 'white'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 'bold', fontSize: 15 }}>{cls.name}</div>
                            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                              {cls.subject} · {cls.studentIds.length} students
                              {teacher && ` · 🧑‍🏫 ${teacher.username || teacher.firstName}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{
                              fontSize: 11, fontWeight: 'bold', background: 'rgba(251,191,36,0.12)',
                              color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)',
                              borderRadius: 6, padding: '2px 9px', letterSpacing: 1
                            }}>
                              {cls.code}
                            </span>
                            <span style={{ color: '#64748b', fontSize: 14 }}>{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #334155' }}>
                          {studs.length > 0 && (
                            <div style={{ display: 'flex', gap: 10, marginBottom: 12, marginTop: 12 }}>
                              {[
                                { label: 'Students', value: cls.studentIds.length, color: '#3b82f6' },
                                { label: 'Avg XP', value: avgClsXP.toLocaleString(), color: '#10b981' },
                              ].map(s => (
                                <div key={s.label} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 14px', border: '1px solid #334155', textAlign: 'center' }}>
                                  <div style={{ fontWeight: 'bold', color: s.color, fontSize: 16 }}>{s.value}</div>
                                  <div style={{ color: '#64748b', fontSize: 10 }}>{s.label}</div>
                                </div>
                              ))}
                            </div>
                          )}
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
                                  <div key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0f172a', borderRadius: 8, padding: '8px 12px' }}>
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
            <h3 style={{ color: 'white', margin: '0 0 14px', fontSize: 16 }}>📈 Organisation Analytics</h3>

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
                        <span style={{ color: '#cbd5e1' }}>{i === 0 ? '🏅 ' : ''}{g.label}</span>
                        <span style={{ color: '#64748b' }}>{g.players} players · top: {g.topScore}</span>
                      </div>
                      <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: bar, borderRadius: 3, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>🎓 Student Level Distribution</h3>
              {(() => {
                const buckets: Record<number, number> = {};
                users.filter(u => u.role === 'student').forEach(u => {
                  const { level } = computeLevel(u.economy?.global_xp || 0);
                  buckets[level] = (buckets[level] || 0) + 1;
                });
                const maxCount = Math.max(1, ...Object.values(buckets));
                const LEVEL_TITLES = ['Initiate','Apprentice','Seeker','Scholar','Adept','Expert','Master','Grandmaster','Logic Lord'];
                return Array.from({ length: 9 }, (_, i) => i + 1).map(lv => {
                  const count = buckets[lv] || 0;
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

        {/* ── ORGANISATION ── */}
        {tab === 'organisation' && org && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            {/* Org profile card */}
            <div style={{ background: '#1e293b', borderRadius: 14, padding: 22, border: '1px solid #334155', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 12, flexShrink: 0,
                  background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28
                }}>🏢</div>
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: '0 0 4px', color: 'white', fontSize: 21 }}>{org.name}</h2>
                  <div style={{ color: '#64748b', fontSize: 13 }}>
                    {ORG_TYPE_LABELS[org.type] || org.type}
                    {org.country ? ` · ${org.country}` : ''}
                    {` · Created ${new Date(org.createdAt).toLocaleDateString()}`}
                  </div>
                </div>
              </div>

              {/* Join code */}
              <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>STUDENT JOIN CODE</div>
                  <div style={{
                    background: '#0f172a', border: '2px solid rgba(251,191,36,0.4)',
                    borderRadius: 10, padding: '8px 18px',
                    fontSize: 26, fontWeight: 'bold', letterSpacing: 4, color: '#fbbf24', display: 'inline-block'
                  }}>
                    {org.joinCode}
                  </div>
                </div>
                <button
                  onClick={copyJoinCode}
                  style={{
                    padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
                    background: copiedJoinCode ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.15)',
                    border: copiedJoinCode ? '1px solid #10b981' : '1px solid rgba(59,130,246,0.4)',
                    color: copiedJoinCode ? '#10b981' : '#93c5fd', cursor: 'pointer', marginTop: 16
                  }}
                >
                  {copiedJoinCode ? '✓ Copied!' : '📋 Copy Code'}
                </button>
              </div>
              <div style={{ color: '#475569', fontSize: 12, marginTop: 10 }}>
                Students join by going to <strong style={{ color: '#94a3b8' }}>⚙ Settings → Join Class</strong> and entering this code.
              </div>
            </div>

            {/* Stats summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total Members', value: users.length, icon: '👥', color: '#c084fc' },
                { label: 'Students', value: totalStudents, icon: '🧑‍🎓', color: '#3b82f6' },
                { label: 'Teachers', value: totalTeachers, icon: '🧑‍🏫', color: '#10b981' },
                { label: 'Classes', value: classes.length, icon: '🏫', color: '#f97316' },
              ].map(s => (
                <div key={s.label} style={{ background: '#1e293b', borderRadius: 10, padding: '12px', border: `1px solid ${s.color}33`, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Teachers in org */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155', marginBottom: 14 }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14, fontWeight: 'bold' }}>🧑‍🏫 Teachers</h3>
              {users.filter(u => u.role === 'teacher').length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                  No teachers yet. Promote students below.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {users.filter(u => u.role === 'teacher').map(t => (
                    <div key={t.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#0f172a', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: `hsl(${(t.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 38%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: 14
                      }}>
                        {(t.username?.[0] || t.firstName?.[0] || '?').toUpperCase()}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>
                          {t.username || `${t.firstName} ${t.lastName}`}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{t.email}</div>
                      </div>
                      <button
                        onClick={() => handleRoleChange(t.uid, 'student')}
                        disabled={changingRole === t.uid}
                        style={{
                          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
                          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                          color: '#ef4444', cursor: 'pointer'
                        }}
                        title="Demote to student"
                      >
                        {changingRole === t.uid ? '...' : '↓ Student'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Promote students */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
              <h3 style={{ color: 'white', margin: '0 0 4px', fontSize: 14, fontWeight: 'bold' }}>🎓 Promote to Teacher</h3>
              <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 12px' }}>
                Promote a student to teacher so they can create classes.
              </p>
              {users.filter(u => u.role === 'student').length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No students to promote.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
                  {users.filter(u => u.role === 'student').map(s => {
                    const { level } = computeLevel(s.economy?.global_xp || 0);
                    return (
                      <div key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0f172a', borderRadius: 8, padding: '9px 12px' }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                          background: `hsl(${(s.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 38%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: 12
                        }}>
                          {(s.username?.[0] || s.firstName?.[0] || '?').toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: 'white', fontSize: 12, fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.username || `${s.firstName} ${s.lastName}`}
                          </div>
                          <div style={{ color: '#64748b', fontSize: 10 }}>Lv.{level} · {(s.economy?.global_xp || 0).toLocaleString()} XP</div>
                        </div>
                        <button
                          onClick={() => handleRoleChange(s.uid, 'teacher')}
                          disabled={changingRole === s.uid}
                          style={{
                            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
                            background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
                            color: '#10b981', cursor: 'pointer', flexShrink: 0
                          }}
                        >
                          {changingRole === s.uid ? '...' : '↑ Teacher'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
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
              type="number" placeholder="0" value={econModal.goldDelta}
              onChange={e => setEconModal(prev => prev ? { ...prev, goldDelta: e.target.value } : null)}
              style={{
                width: '100%', padding: '10px 13px', marginBottom: 12,
                borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)',
                color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none'
              }}
            />
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>XP Δ (e.g. +200 or -50)</label>
            <input
              type="number" placeholder="0" value={econModal.xpDelta}
              onChange={e => setEconModal(prev => prev ? { ...prev, xpDelta: e.target.value } : null)}
              style={{
                width: '100%', padding: '10px 13px', marginBottom: 16,
                borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)',
                color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none'
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEconModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button
                onClick={handleEconApply} disabled={applyingEcon}
                className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}
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
