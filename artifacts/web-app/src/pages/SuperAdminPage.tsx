import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, updateUserData, deleteUserData, updateEconomy, UserData, UserRole, computeLevel } from '@/lib/userService';
import { convertNestedProgramToInternal, parseNestedProgramJson } from '@/lib/programNestedImport';
import ProgramMapView from '@/views/ProgramMapView';
import { clearDraftProgram } from '@/lib/draftProgramStore';
import { uploadProgramQuestionAsset } from '@/lib/programAssetService';
import {
  deleteDraftProgramAdmin,
  getDraftProgramAdmin,
  listProgramsAdmin,
  publishProgramAdmin,
  saveDraftProgramAdmin,
  savePublishedProgramAdmin,
  softDeletePublishedProgramAdmin,
} from '@/lib/programAdminService';
import {
  listDraftLogicGameNodes,
  getDraftLogicGameQuestions,
  publishLogicGameNode,
  upsertDraftLogicGameNode,
  publishLogicGameQuestions,
  upsertDraftLogicGameQuestions,
  deleteDraftLogicGameNode,
  deletePublishedLogicGameNode,
  listPublishedLogicGameNodes,
} from '@/lib/logicGamesService';
import type { LogicGameNode, LogicGameQuestionsDoc } from '@/types/logicGames';
import {
  BUILDER_DIVISION_LABELS,
  convertBuilderToInternal,
  ensureFixedFirstDivisionContainer,
  FIXED_FIRST_DIVISION_NODE_ID,
  makeIdFromTitle,
  makeStableId,
  newBuilderSpec,
  type BuilderDivisionLabel,
  type BuilderNode,
  type BuilderQuestionTypeFile,
  type BuilderSpec,
} from '@/lib/programBuilder';
import { setDraftProgram } from '@/lib/draftProgramStore';

type Tab = 'overview' | 'users' | 'programs' | 'logicGames';

const ROLE_ORDER: UserRole[] = ['student', 'superadmin'];
const ROLE_COLORS: Record<UserRole, string> = {
  student: '#3b82f6', superadmin: '#a855f7'
};

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefinedDeep(v)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

export default function SuperAdminPage() {
  const { user, userData } = useAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<Array<UserData & { uid: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);


  // Economy modal
  const [econModal, setEconModal] = useState<{ uid: string; name: string; goldDelta: string; xpDelta: string } | null>(null);
  const [applyingEcon, setApplyingEcon] = useState(false);

  useEffect(() => {
    if (userData && userData.role !== 'superadmin') setLocation('/');
    else loadData();
  }, [userData]);

  async function loadData() {
    setLoading(true);
    try {
      const [u] = await Promise.all([getAllUsers()]);
      setUsers(u);
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleChange(uid: string, role: UserRole) {
    setChangingRole(uid);
    try {
      const supabase = requireSupabase();
      const { error } = await supabase.rpc('admin_update_user_role', { target_uid: uid, new_role: role });
      if (error) throw error;
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u));
    } catch (e) {
      console.error('Failed to change role:', e);
    } finally {
      setChangingRole(null);
    }
  }

  async function handleDeleteUser(uid: string) {
    if (!window.confirm('Permanently delete this account? This cannot be undone.')) return;
    setDeletingUser(uid);
    await deleteUserData(uid);
    setUsers(prev => prev.filter(u => u.uid !== uid));
    setDeletingUser(null);
  }

  async function handleEconApply() {
    if (!econModal) return;
    const gold = parseInt(econModal.goldDelta) || 0;
    const xp = parseInt(econModal.xpDelta) || 0;
    if (gold === 0 && xp === 0) { setEconModal(null); return; }
    setApplyingEcon(true);
    await updateEconomy(econModal.uid, gold, xp);
    setUsers(prev => prev.map(u => u.uid === econModal.uid ? {
      ...u, economy: { ...u.economy, gold: Math.max(0, (u.economy?.gold || 0) + gold), global_xp: Math.max(0, (u.economy?.global_xp || 0) + xp) }
    } : u));
    setApplyingEcon(false);
    setEconModal(null);
  }

  const filtered = users.filter(u => {
    const matchSearch = !search || [u.username, u.email, u.firstName, u.lastName].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const totalStudents  = users.filter(u => u.role === 'student').length;
  const totalSuperAdmins = users.filter(u => u.role === 'superadmin').length;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👑</div>
          <div>Loading super admin panel...</div>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; icon: string; label: string; badge?: number }[] = [
    { id: 'overview', icon: '📊', label: 'Overview' },
    { id: 'users', icon: '👥', label: `Users (${users.length})` },
    { id: 'programs', icon: '📚', label: 'Programs' },
    { id: 'logicGames', icon: '🧩', label: 'Logic Games' },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', background: '#1e293b', borderBottom: '2px solid #a855f744', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#a855f7' }}>👑</span> Super Admin Panel
              <span style={{ fontSize: 11, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#d8b4fe', borderRadius: 6, padding: '2px 8px', fontWeight: 'normal' }}>
                GOD MODE
              </span>
            </h2>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Full platform control · All accounts</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadData} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>
              ↺ Refresh
            </button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>
              Sign Out
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t.id ? 'rgba(168,85,247,0.2)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'rgba(168,85,247,0.5)' : 'transparent'}`,
              color: tab === t.id ? '#d8b4fe' : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6, position: 'relative'
            }}>
              {t.icon} {t.label}
              {t.badge != null && t.badge > 0 && (
                <span style={{
                  background: '#ef4444', color: 'white', borderRadius: '50%',
                  fontSize: 9, fontWeight: 'bold', minWidth: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px', lineHeight: 1
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total Users', value: users.length, icon: '👤', color: '#c084fc' },
                { label: 'Super Admins', value: totalSuperAdmins, icon: '👑', color: '#a855f7' },
                { label: 'Students', value: totalStudents, icon: '🧑‍🎓', color: '#3b82f6' },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: '#1e293b', borderRadius: 10, padding: '14px 12px',
                  border: `1px solid ${stat.color}33`, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Top XP */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155', marginBottom: 14 }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14 }}>🏆 Top XP Earners</h3>
              {[...users].sort((a, b) => (b.economy?.global_xp || 0) - (a.economy?.global_xp || 0)).slice(0, 6).map((u, i) => {
                const { level, title } = computeLevel(u.economy?.global_xp || 0);
                const medals = ['🥇', '🥈', '🥉', '4', '5', '6'];
                return (
                  <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < 5 ? '1px solid #1e293b' : 'none' }}>
                    <span style={{ width: 22, fontSize: 14 }}>{medals[i]}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{u.username || `${u.firstName} ${u.lastName}`}</div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Lv.{level} {title} · <span style={{ color: ROLE_COLORS[u.role as UserRole] || '#64748b' }}>{u.role}</span></div>
                    </div>
                    <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 12 }}>{(u.economy?.global_xp || 0).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search name, username, email..."
                style={{ flex: 1, minWidth: 180, padding: '9px 13px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
              />
              <select
                value={roleFilter} onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
                style={{ padding: '9px 13px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', outline: 'none' }}
              >
                <option value="all">All Roles</option>
                <option value="student">Students</option>
                <option value="superadmin">Super Admins</option>
              </select>
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>{filtered.length} users</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(u => {
                const { level, title } = computeLevel(u.economy?.global_xp || 0);
                const isExpanded = expandedUser === u.uid;
                const isSelf = u.uid === user?.uid;
                return (
                  <div key={u.uid} style={{ background: '#1e293b', borderRadius: 10, border: `1px solid ${isExpanded ? '#a855f788' : '#334155'}`, overflow: 'hidden' }}>
                    <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                        style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                          background: `hsl(${(u.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 'bold', color: 'white', fontSize: 14, border: 'none', cursor: 'pointer'
                        }}
                      >
                        {(u.username?.[0] || '?').toUpperCase()}
                      </button>
                      <div style={{ flex: 1, minWidth: 100 }}>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13 }}>
                          {u.username || `${u.firstName} ${u.lastName}`}
                          {isSelf && <span style={{ marginLeft: 6, fontSize: 10, color: '#a855f7' }}>(you)</span>}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{u.email} · Lv.{level} {title}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5,
                          background: `${ROLE_COLORS[u.role as UserRole] || '#475569'}22`,
                          border: `1px solid ${ROLE_COLORS[u.role as UserRole] || '#475569'}55`,
                          color: ROLE_COLORS[u.role as UserRole] || '#94a3b8', textTransform: 'capitalize'
                        }}>{u.role}</span>
                        {!isSelf && (user?.email === 'god.bypass@internal.app' || u.role !== 'superadmin') && (
                          <>
                            <select
                              value={u.role} disabled={changingRole === u.uid}
                              onChange={e => handleRoleChange(u.uid, e.target.value as UserRole)}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#94a3b8', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', outline: 'none' }}
                            >
                              {(user?.email === 'god.bypass@internal.app' ? ROLE_ORDER : ROLE_ORDER.filter(r => r !== 'superadmin'))
                                .map(r => <option key={r} value={r}>→ {r}</option>)}
                            </select>
                            <button
                              onClick={() => setEconModal({ uid: u.uid, name: u.username || u.firstName, goldDelta: '', xpDelta: '' })}
                              style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              ✏️
                            </button>
                            <button
                              disabled={deletingUser === u.uid}
                              onClick={() => handleDeleteUser(u.uid)}
                              style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid #334155' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                          {[
                            { label: 'XP', value: (u.economy?.global_xp || 0).toLocaleString(), color: '#10b981' },
                            { label: 'Gold', value: (u.economy?.gold || 0).toLocaleString(), color: '#fbbf24' },
                            { label: 'Arena W', value: u.arenaStats?.wins ?? 0, color: '#3b82f6' },
                            { label: 'Arena L', value: u.arenaStats?.losses ?? 0, color: '#ef4444' },
                          ].map(s => (
                            <div key={s.label} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: '1px solid #334155' }}>
                              <div style={{ fontSize: 14, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                              <div style={{ color: '#475569', fontSize: 10 }}>{s.label}</div>
                            </div>
                          ))}
                        </div>
                        {u.curriculumProfile && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
                            Curriculum: {u.curriculumProfile.system} · {u.curriculumProfile.year}
                          </div>
                        )}
                        <div style={{ color: '#475569', fontSize: 10, marginTop: 6 }}>UID: {u.uid}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PROGRAMS ── */}
        {tab === 'programs' && (
          <ProgramsAdmin />
        )}

        {/* ── LOGIC GAMES ── */}
        {tab === 'logicGames' && (
          <LogicGamesAdmin />
        )}
      </div>

      {/* Economy modal */}
      {econModal && (
        <>
          <div onClick={() => setEconModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(360px, 92vw)',
            border: '2px solid #fbbf24', zIndex: 1001, animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 14px', color: 'white', fontSize: 17 }}>✏️ Adjust Economy — {econModal.name}</h2>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Gold Δ</label>
            <input type="number" placeholder="0" value={econModal.goldDelta}
              onChange={e => setEconModal(p => p ? { ...p, goldDelta: e.target.value } : null)}
              style={{ width: '100%', padding: '10px 13px', marginBottom: 10, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>XP Δ</label>
            <input type="number" placeholder="0" value={econModal.xpDelta}
              onChange={e => setEconModal(p => p ? { ...p, xpDelta: e.target.value } : null)}
              style={{ width: '100%', padding: '10px 13px', marginBottom: 14, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEconModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleEconApply} disabled={applyingEcon} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {applyingEcon ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LogicGamesAdmin() {
  const { userData } = useAuth();
  const [, setLocation] = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [draftNodes, setDraftNodes] = useState<LogicGameNode[]>([]);
  const [selectedDraftNodeId, setSelectedDraftNodeId] = useState<string | null>(null);

  const [draftQuestionsJson, setDraftQuestionsJson] = useState('');
  const [draftQuestionsStatus, setDraftQuestionsStatus] = useState<string | null>(null);

  const [publishedNodes, setPublishedNodes] = useState<LogicGameNode[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const [draft, pub] = await Promise.all([listDraftLogicGameNodes(), listPublishedLogicGameNodes()]);
      setDraftNodes(draft);
      setPublishedNodes(pub);

      if (!selectedDraftNodeId && draft.length > 0) setSelectedDraftNodeId(draft[0].id);
      if (selectedDraftNodeId && draft.every((n) => n.id !== selectedDraftNodeId)) {
        setSelectedDraftNodeId(draft[0]?.id ?? null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to load logic game nodes');
    } finally {
      setLoading(false);
    }
  }

  async function renameDraftNode(nodeId: string) {
    const n = draftNodes.find((x) => x.id === nodeId);
    if (!n) return;
    const next = window.prompt('Enter node name', n.label ?? '') ?? '';
    const label = next.trim();

    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await upsertDraftLogicGameNode({ ...n, label });
      setDraftNodes((prev) => prev.map((x) => (x.id === nodeId ? { ...x, label } : x)));
      setStatus('✅ Renamed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to rename node');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadDraftQuestions() {
      if (!selectedDraftNodeId) return;
      setSaving(true);
      setErr(null);
      setDraftQuestionsStatus(null);
      try {
        const doc0 = await getDraftLogicGameQuestions(selectedDraftNodeId);
        const arr = Array.isArray(doc0?.questions) ? doc0!.questions : [];
        if (!alive) return;
        setDraftQuestionsJson(JSON.stringify(arr, null, 2));
        setDraftQuestionsStatus('Loaded draft JSON');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!alive) return;
        setErr(msg || 'Failed to load draft questions');
      } finally {
        if (alive) setSaving(false);
      }
    }
    void loadDraftQuestions();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftNodeId]);

  function validateQuestionsJson(arr: any[]): string | null {
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      if (!q || typeof q !== 'object') return `Question at index ${i} must be an object`;
      if (typeof q.id !== 'string' || !q.id.trim()) return `Question at index ${i} is missing a string 'id'`;
      if (!q.interaction || typeof q.interaction !== 'object') return `Question ${q.id} is missing 'interaction'`;
      if (typeof q.timeLimitSec !== 'number' || !Number.isFinite(q.timeLimitSec)) return `Question ${q.id} is missing numeric 'timeLimitSec'`;
      if (typeof q.iqDeltaCorrect !== 'number' || !Number.isFinite(q.iqDeltaCorrect)) return `Question ${q.id} is missing numeric 'iqDeltaCorrect'`;
      if (typeof q.iqDeltaWrong !== 'number' || !Number.isFinite(q.iqDeltaWrong)) return `Question ${q.id} is missing numeric 'iqDeltaWrong'`;
    }
    return null;
  }

  async function saveDraftQuestions() {
    if (!selectedDraftNodeId) return;
    setSaving(true);
    setErr(null);
    setDraftQuestionsStatus(null);
    try {
      const raw = draftQuestionsJson.trim() ? JSON.parse(draftQuestionsJson) : [];
      if (!Array.isArray(raw)) throw new Error('JSON must be an array of questions');
      const validationErr = validateQuestionsJson(raw);
      if (validationErr) throw new Error(validationErr);
      await upsertDraftLogicGameQuestions(selectedDraftNodeId, {
        questions: raw,
        updatedAt: new Date().toISOString(),
      } satisfies Omit<LogicGameQuestionsDoc, 'nodeId'>);
      setDraftQuestionsStatus('✅ Saved successfully');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to save draft JSON');
    } finally {
      setSaving(false);
    }
  }

  async function addDraftNode() {
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const nextOrder = draftNodes.length > 0 ? Math.max(...draftNodes.map((n) => n.order ?? 0)) + 1 : 0;
      const nextIq = draftNodes.length > 0 ? (draftNodes[draftNodes.length - 1].iq ?? 80) + 10 : 80;
      const id = `iq-${nextIq}`;
      const node: LogicGameNode = { id, iq: nextIq, order: nextOrder, label: '' };
      await upsertDraftLogicGameNode(node);
      await upsertDraftLogicGameQuestions(id, { questions: [], updatedAt: new Date().toISOString() });

      setDraftNodes((prev) => {
        const next = prev.some((n) => n.id === node.id) ? prev : [...prev, node];
        return next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      });
      setSelectedDraftNodeId(id);
      setStatus('✅ Node added');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to add node');
    } finally {
      setSaving(false);
    }
  }

  async function setDraftNodeIq(nodeId: string, nextIqRaw: string) {
    const nextIq = Number(nextIqRaw);
    if (!Number.isFinite(nextIq)) return;
    const n = draftNodes.find((x) => x.id === nodeId);
    if (!n) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await upsertDraftLogicGameNode({ ...n, iq: nextIq });

      setDraftNodes((prev) =>
        prev
          .map((x) => (x.id === nodeId ? { ...x, iq: nextIq } : x))
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
      setStatus('✅ Node IQ saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to save node IQ');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraftNode(nodeId: string) {
    if (!window.confirm('Delete this draft node + its draft questions?')) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await deleteDraftLogicGameNode(nodeId);
      if (selectedDraftNodeId === nodeId) setSelectedDraftNodeId(null);
      setDraftQuestionsJson('');
      setDraftQuestionsStatus(null);
      await load();
      setStatus('✅ Draft node deleted');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to delete draft node');
    } finally {
      setSaving(false);
    }
  }

  function openPreviewAll() {
    localStorage.setItem('ll:logicGamePreviewUnlockAll', '1');
    setLocation('/logic-preview');
  }

  function openPreviewPublishedAll() {
    localStorage.setItem('ll:logicGamePreviewUnlockAll', '1');
    setLocation('/logic-preview');
  }

  async function publishSelectedDraftNode() {
    if (!selectedDraftNodeId) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await publishLogicGameNode(selectedDraftNodeId);
      await publishLogicGameQuestions(selectedDraftNodeId);
      await load();
      setStatus('✅ Published');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to publish');
    } finally {
      setSaving(false);
    }
  }

  async function publishAllDraftNodes() {
    if (draftNodes.length === 0) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      if (selectedDraftNodeId) {
        const raw = draftQuestionsJson.trim() ? JSON.parse(draftQuestionsJson) : [];
        if (!Array.isArray(raw)) throw new Error('JSON must be an array of questions');
        const validationErr = validateQuestionsJson(raw);
        if (validationErr) throw new Error(validationErr);
        await upsertDraftLogicGameQuestions(selectedDraftNodeId, {
          questions: raw,
          updatedAt: new Date().toISOString(),
        } satisfies Omit<LogicGameQuestionsDoc, 'nodeId'>);
        setDraftQuestionsStatus('✅ Saved successfully');
      }

      const sorted = draftNodes.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const n of sorted) {
        await publishLogicGameNode(n.id);
        try {
          await publishLogicGameQuestions(n.id);
        } catch (e) {
          const existing = await getDraftLogicGameQuestions(n.id);
          if (!existing) {
            await upsertDraftLogicGameQuestions(n.id, { questions: [], updatedAt: new Date().toISOString() });
            await publishLogicGameQuestions(n.id);
          } else {
            throw e;
          }
        }
      }

      const pub = await listPublishedLogicGameNodes();
      setPublishedNodes(pub);
      setStatus(`✅ Published ${sorted.length} nodes`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to publish draft nodes');
    } finally {
      setSaving(false);
    }
  }

  if (!userData || userData.role !== 'superadmin') return null;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>🧩 Logic Games</h3>
        <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>
          ↺ Refresh
        </button>
      </div>

      {err && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {status && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10 }}>{status}</div>}


      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Current Nodes (Draft)</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>{draftNodes.length}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={addDraftNode} disabled={saving} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12, fontWeight: 1000 }}>
                +
              </button>
              <button onClick={publishAllDraftNodes} disabled={saving || draftNodes.length === 0} className="ll-btn ll-btn-primary" style={{ padding: '7px 12px', fontSize: 12 }}>
                Publish
              </button>
            </div>
          </div>

          <div style={{ padding: 12 }}>
            {loading ? (
              <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>
            ) : draftNodes.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No draft nodes yet. Click + to add one.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {draftNodes
                  .slice()
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((n, idx, arr) => {
                    const active = n.id === selectedDraftNodeId;
                    return (
                      <div key={n.id}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                          <button
                            onClick={() => setSelectedDraftNodeId(n.id)}
                            className="ll-btn"
                            style={{
                              flex: 1,
                              textAlign: 'left',
                              padding: '10px 10px',
                              borderRadius: 12,
                              background: active ? 'rgba(34,197,94,0.12)' : 'rgba(15,23,42,0.55)',
                              border: active ? '1px solid rgba(34,197,94,0.45)' : '1px solid #334155',
                              color: active ? '#bbf7d0' : 'white',
                              fontWeight: 900,
                            }}
                          >
                            {n.label}
                          </button>

                          <button
                            className="ll-btn"
                            title="Rename"
                            onClick={() => void renameDraftNode(n.id)}
                            style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000 }}
                          >
                            ✎
                          </button>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 900 }}>Start IQ</div>
                            <input
                              defaultValue={String(n.iq ?? 80)}
                              onBlur={(e) => void setDraftNodeIq(n.id, e.target.value)}
                              style={{ width: 90, padding: '9px 10px', borderRadius: 10, border: '1px solid #475569', background: '#0f172a', color: 'white', fontWeight: 900, outline: 'none' }}
                            />
                          </div>

                          <button
                            className="ll-btn"
                            title="Delete"
                            onClick={() => void deleteDraftNode(n.id)}
                            style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                          >
                            🗑
                          </button>
                        </div>

                        {idx < arr.length - 1 && (
                          <div style={{ paddingLeft: 12, paddingTop: 8, color: '#64748b', fontWeight: 900 }}>
                            →
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Selected Node JSON (Draft)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={openPreviewAll} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>Preview</button>
                <button onClick={saveDraftQuestions} disabled={!selectedDraftNodeId || saving} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>Save</button>
              </div>
            </div>

            {draftQuestionsStatus && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10 }}>{draftQuestionsStatus}</div>}

            {!selectedDraftNodeId ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>Select a draft node to edit its JSON.</div>
            ) : (
              <textarea
                value={draftQuestionsJson}
                onChange={(e) => setDraftQuestionsJson(e.target.value)}
                placeholder='Paste JSON array of questions here. Each question must include: id, interaction, timeLimitSec, iqDeltaCorrect, iqDeltaWrong.'
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 420,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: 'white',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>

          <div style={{ background: '#0b1220', border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: 12, borderBottom: '1px solid #1f2a44', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Published Nodes</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#64748b', fontSize: 11 }}>{publishedNodes.length}</div>
                <button onClick={openPreviewPublishedAll} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>
                  Preview
                </button>
              </div>
            </div>
            <div style={{ padding: 12 }}>
              {publishedNodes.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 12 }}>No published nodes yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {publishedNodes
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((n) => (
                      <div key={n.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                        <div
                          style={{
                            flex: 1,
                            padding: '10px 10px',
                            borderRadius: 12,
                            background: 'rgba(15,23,42,0.55)',
                            border: '1px solid #334155',
                            color: 'white',
                            fontWeight: 900,
                          }}
                        >
                          {n.label}
                          <span style={{ color: '#64748b', fontWeight: 800, marginLeft: 8, fontSize: 11 }}>(order {n.order})</span>
                        </div>
                        <button
                          className="ll-btn"
                          title="Delete"
                          onClick={async () => {
                            if (!window.confirm('Delete this published node + its questions?')) return;
                            setSaving(true);
                            setErr(null);
                            setStatus(null);
                            try {
                              await deletePublishedLogicGameNode(n.id);
                              await load();
                              setStatus('✅ Published node deleted');
                            } catch (e) {
                              const msg = e instanceof Error ? e.message : String(e);
                              setErr(msg || 'Failed to delete node');
                            } finally {
                              setSaving(false);
                            }
                          }}
                          style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgramsAdmin() {
  const { userData } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [draftItems, setDraftItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'list' | 'builder' | 'preview'>('list');
  const [previewReturnView, setPreviewReturnView] = useState<'list' | 'builder'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubject, setDraftSubject] = useState('mathematics');
  const [draftGradeBand, setDraftGradeBand] = useState('');
  const [draftEmoji, setDraftEmoji] = useState('📘');
  const [draftTocJson, setDraftTocJson] = useState('');
  const [draftQuestionBankJson, setDraftQuestionBankJson] = useState('');
  const [draftAnnotationsJson, setDraftAnnotationsJson] = useState('');
  const [draftProgramMetaJson, setDraftProgramMetaJson] = useState('');
  const [draftNestedJson, setDraftNestedJson] = useState('');
  const [nestedGenStatus, setNestedGenStatus] = useState<string>('');

  const [builder, setBuilder] = useState<BuilderSpec>(() => newBuilderSpec());
  const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);
  const [builderSelectedQuestionTypeId, setBuilderSelectedQuestionTypeId] = useState<string | null>(null);
  const [previewProgramId, setPreviewProgramId] = useState<string | null>(null);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>('');
  const [uploadedImageErr, setUploadedImageErr] = useState<string>('');

  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  async function load() {
    setLoading(true);
    try {
      const [next, dnext] = await Promise.all([
        listProgramsAdmin('published'),
        listProgramsAdmin('draft'),
      ]);
      setItems(next as typeof items);
      setDraftItems(dnext as typeof draftItems);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetDraft() {
    setEditingId(null);
    setEditingDraftId(null);
    setView('list');
    setDraftId('');
    setDraftTitle('');
    setDraftSubject('mathematics');
    setDraftGradeBand('');
    setDraftEmoji('📘');
    setDraftTocJson('');
    setDraftQuestionBankJson('');
    setDraftAnnotationsJson('');
    setDraftProgramMetaJson('');
    setDraftNestedJson('');
    setNestedGenStatus('');

    setBuilder(newBuilderSpec());
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);
  }

  function startNewBuilder() {
    const b = newBuilderSpec();
    setEditingId(null);
    setEditingDraftId(null);
    setView('builder');
    setBuilder(b);
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);
  }

  function startEditBuilder(p: (typeof items)[number]) {
    setEditingId(p.id);
    setEditingDraftId(null);
    const spec = (p as any).builderSpec as BuilderSpec | undefined;
    const next = spec && typeof spec === 'object' && spec.version === '1.0'
      ? spec
      : (() => {
          const b = newBuilderSpec();
          b.programId = p.id;
          b.programTitle = (p.title as string) ?? p.id;
          b.subject = (p.subject as string) ?? 'mathematics';
          b.gradeBand = (p.grade_band as string) ?? '';
          b.coverEmoji = (p.coverEmoji as string) ?? '📘';
          b.root.title = (p.title as string) ?? p.id;
          return b;
        })();
    setBuilder(ensureFixedFirstDivisionContainer(next));
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);
    setView('builder');
  }

  async function startEditDraftBuilder(d: (typeof draftItems)[number]) {
    setEditingId(null);
    setEditingDraftId(d.id);
    try {
      const data = await getDraftProgramAdmin(d.id);
      if (!data) {
        window.alert('Draft not found');
        return;
      }
      const spec = data?.builderSpec as BuilderSpec | undefined;
      const next = spec && typeof spec === 'object' && spec.version === '1.0'
        ? spec
        : (() => {
            const b = newBuilderSpec();
            b.programId = d.id;
            b.programTitle = (data?.title as string) ?? d.id;
            b.subject = (data?.subject as string) ?? 'mathematics';
            b.gradeBand = (data?.grade_band as string) ?? '';
            b.coverEmoji = (data?.coverEmoji as string) ?? '📘';
            b.root.title = (data?.title as string) ?? d.id;
            return b;
          })();
      setBuilder(ensureFixedFirstDivisionContainer(next));
      setBuilderPathIds(['root']);
      setBuilderSelectedQuestionTypeId(null);
      setView('builder');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  function setBuilderAtNode(nodeId: string, fn: (n: BuilderNode) => BuilderNode) {
    setBuilder((prev) => {
      function mapNode(n: BuilderNode): BuilderNode {
        if (n.id === nodeId) return fn(n);
        return { ...n, children: n.children.map(mapNode) };
      }
      return ensureFixedFirstDivisionContainer({ ...prev, root: mapNode(prev.root) });
    });
  }

  function findNodeByPath(b: BuilderSpec, pathIds: string[]): BuilderNode | null {
    const normalized = ensureFixedFirstDivisionContainer(b);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;

    let cur: BuilderNode = normalized.root;
    for (const id of pathIds.slice(1)) {
      const pool = cur.id === 'root' && fixed ? fixed.children : cur.children;
      const next = pool.find((c) => c.id === id);
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  function pathNodes(b: BuilderSpec, pathIds: string[]): BuilderNode[] {
    const normalized = ensureFixedFirstDivisionContainer(b);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;

    const nodes: BuilderNode[] = [];
    let cur: BuilderNode = normalized.root;
    nodes.push(cur);

    for (const id of pathIds.slice(1)) {
      const pool = cur.id === 'root' && fixed ? fixed.children : cur.children;
      const next = pool.find((c) => c.id === id);
      if (!next) break;
      nodes.push(next);
      cur = next;
    }
    return nodes;
  }

  function computeProgramIdAndTitle(): { id: string; title: string } {
    const title = builder.programTitle.trim() || builder.root.title.trim();
    const idBase = builder.programId.trim() || makeIdFromTitle(title) || 'program';
    const id = String(editingId || editingDraftId || idBase).trim() || idBase;
    return { id, title: title || id };
  }

  async function saveBuilderDraft() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) {
      window.alert('Missing program id');
      return;
    }
    setSaving(true);
    try {
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title,
        subject: builder.subject ?? 'mathematics',
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: { ...builder, programId, programTitle: title },
        updatedAt: new Date().toISOString(),
      });
      const gb = (builder.gradeBand ?? '').trim();
      if (gb) payload.grade_band = gb;

      await saveDraftProgramAdmin(programId, payload);
      setEditingDraftId(programId);
      await load();
      window.alert('Draft saved');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function publishBuilder() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) {
      window.alert('Missing program id');
      return;
    }

    setSaving(true);
    try {
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title,
        subject: builder.subject ?? 'mathematics',
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: { ...builder, programId, programTitle: title },
        updatedAt: new Date().toISOString(),
      });
      const gb = (builder.gradeBand ?? '').trim();
      if (gb) payload.grade_band = gb;

      await publishProgramAdmin(programId, payload, editingDraftId);
      if (editingDraftId) setEditingDraftId(null);
      await load();
      setView('list');
      setEditingId(programId);
      window.alert('Published');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function previewBuilder() {
    try {
      const { id: programId, title } = computeProgramIdAndTitle();
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });

      const key = `${Date.now()}`;
      setDraftProgram(key, {
        id: programId,
        title,
        subject: builder.subject ?? 'mathematics',
        grade_band: (builder.gradeBand ?? '').trim() || undefined,
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        questionBanksByChapter: internal.questionBanksByChapter,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
      });

      const pid = `ll-draft:${key}`;
      setPreviewProgramId(pid);
      setPreviewReturnView('builder');
      setView('preview');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function previewSavedDraft(programId: string) {
    setPreviewProgramId(`ll-draftdb:${programId}`);
    setPreviewReturnView('list');
    setView('preview');
  }

  async function removeDraft(programId: string) {
    if (!window.confirm('Delete this draft?')) return;
    await deleteDraftProgramAdmin(programId);
    await load();
    if (editingDraftId === programId) resetDraft();
  }

  function generateFromNested() {
    const nested = parseNestedProgramJson(draftNestedJson);
    const converted = convertNestedProgramToInternal(nested);
    setDraftId(nested.program_id);
    setDraftTitle(nested.book_name);
    setDraftTocJson(JSON.stringify(converted.toc, null, 2));
    const firstChapterId = Object.keys(converted.questionBanksByChapter)[0] ?? null;
    if (firstChapterId) {
      setDraftQuestionBankJson(JSON.stringify(converted.questionBanksByChapter[firstChapterId], null, 2));
    }
    setDraftAnnotationsJson(JSON.stringify(converted.annotations, null, 2));
    setDraftProgramMetaJson(JSON.stringify(converted.programMeta, null, 2));
  }

  async function save() {
    const id = draftId.trim();
    if (!id) return;
    setSaving(true);
    try {
      let toc: unknown = undefined;
      if (draftTocJson.trim()) {
        toc = JSON.parse(draftTocJson);
      }

      let questionBank: unknown = undefined;
      if (draftQuestionBankJson.trim()) {
        questionBank = JSON.parse(draftQuestionBankJson);
      }

      let annotations: unknown = undefined;
      if (draftAnnotationsJson.trim()) {
        annotations = JSON.parse(draftAnnotationsJson);
      }

      let programMeta: unknown = undefined;
      if (draftProgramMetaJson.trim()) {
        programMeta = JSON.parse(draftProgramMetaJson);
      }

      const payload: Record<string, unknown> = {
        title: draftTitle.trim() || id,
        subject: draftSubject.trim() || 'mathematics',
        coverEmoji: draftEmoji.trim() || '📘',
        toc,
        questionBank,
        annotations,
        programMeta,
        updatedAt: new Date().toISOString(),
      };

      const gb = draftGradeBand.trim();
      if (gb) payload.grade_band = gb;

      if (draftNestedJson.trim()) {
        const nested = parseNestedProgramJson(draftNestedJson);
        const converted = convertNestedProgramToInternal(nested);
        payload.questionBanksByChapter = converted.questionBanksByChapter;

        let total = 0;
        for (const ch of Object.values(converted.questionBanksByChapter)) {
          const nodes = Array.isArray((ch as any)?.nodes) ? ((ch as any).nodes as any[]) : [];
          for (const n of nodes) {
            const qs = Array.isArray(n?.questions) ? (n.questions as any[]) : [];
            total += qs.length;
          }
        }
        payload.rankedTotalQuestionCount = total;
      }

      await savePublishedProgramAdmin(id, payload);

      await load();
      resetDraft();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('are you sure you want to delete this?')) return;
    await softDeletePublishedProgramAdmin(id);
    await load();
    if (editingId === id) resetDraft();
  }

  function previewProgram(programId: string) {
    setPreviewProgramId(programId);
    setPreviewReturnView('list');
    setView('preview');
  }

  if (loading) return <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>Loading programs...</div>;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {view === 'preview' ? (
        <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderBottom: '1px solid #1f2a44', background: '#1e293b' }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>👁️ Preview</div>
            <button
              className="ll-btn"
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={() => {
                if (previewProgramId && previewProgramId.startsWith('ll-draft:')) {
                  const key = previewProgramId.slice('ll-draft:'.length);
                  clearDraftProgram(key);
                }
                setView(previewReturnView);
              }}
            >
              ← {previewReturnView === 'builder' ? 'Back to Builder' : 'Back'}
            </button>
          </div>
          <div style={{ height: 'calc(100vh - 260px)', minHeight: 560 }}>
            {previewProgramId ? (
              <ProgramMapView onBack={() => setView(previewReturnView)} programId={previewProgramId} />
            ) : (
              <div style={{ padding: 18, color: '#64748b' }}>No preview loaded.</div>
            )}
          </div>
        </div>
      ) : view === 'builder' ? (
        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>🧱 Program Builder</div>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setView('list')}>← Back</button>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={previewBuilder}>
              Preview
            </button>
            <button
              className="ll-btn"
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={saveBuilderDraft}
              disabled={saving}
              title="Save draft to Firestore (not published)"
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              className="ll-btn ll-btn-primary"
              style={{ padding: '7px 12px', fontSize: 12, background: '#10b981', borderColor: '#059669', color: 'white' }}
              onClick={publishBuilder}
              disabled={saving}
            >
              {saving ? 'Publishing...' : 'Publish'}
            </button>
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>Division Path (ends with Question Types)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {builder.divisions.map((d, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    value={d}
                    onChange={(e) => {
                      const v = e.target.value as BuilderDivisionLabel;
                      setBuilder((p) => {
                        const next = [...p.divisions];
                        next[idx] = v;
                        return ensureFixedFirstDivisionContainer({ ...p, divisions: next });
                      });
                    }}
                    style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #334155', background: '#0b1220', color: 'white', outline: 'none', fontSize: 12, fontWeight: 900 }}
                  >
                    {BUILDER_DIVISION_LABELS.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                  <button
                    className="ll-btn"
                    style={{ padding: '6px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                    onClick={() => {
                      setBuilder((p) => ensureFixedFirstDivisionContainer({ ...p, divisions: p.divisions.filter((_, i) => i !== idx) }));
                      setBuilderPathIds(['root']);
                      setBuilderSelectedQuestionTypeId(null);
                    }}
                    disabled={builder.divisions.length <= 1}
                    title={builder.divisions.length <= 1 ? 'At least one division is required' : 'Remove division'}
                  >
                    −
                  </button>
                  <div style={{ color: '#64748b', fontSize: 12 }}>→</div>
                </div>
              ))}
              <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 900 }}>Question Types</div>
              <button
                className="ll-btn"
                style={{ padding: '6px 10px', fontSize: 11 }}
                onClick={() => {
                  setBuilder((p) => (p.divisions.length >= 5 ? p : ensureFixedFirstDivisionContainer({ ...p, divisions: [...p.divisions, 'Lessons'] })));
                }}
                disabled={builder.divisions.length >= 5}
                title={builder.divisions.length >= 5 ? 'Max depth is 5' : 'Add a division'}
              >
                +
              </button>
            </div>
          </div>

          {(() => {
            const normalized = ensureFixedFirstDivisionContainer(builder);
            const fixedContainer = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
            const path = pathNodes(normalized, builderPathIds);
            const cur = findNodeByPath(normalized, builderPathIds) ?? normalized.root;
            const depth = builderPathIds.length - 1;
            const isLeaf = depth === normalized.divisions.length;

            function selectAtDivision(divisionIndex: number, nodeId: string) {
              const next = ['root', ...builderPathIds.slice(1, divisionIndex + 1), nodeId];
              setBuilderPathIds(next);
              setBuilderSelectedQuestionTypeId(null);
            }

            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', color: '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>
                    Program Folder
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #334155', background: '#0b1220', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16 }}>
                        {(builder.coverEmoji ?? '📘').slice(0, 2)}
                      </div>
                      <input
                        value={builder.root.title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBuilder((p) => ({ ...p, programTitle: v, root: { ...p.root, title: v } }));
                        }}
                        style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#0b1220', color: 'white', outline: 'none', fontWeight: 900 }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {normalized.divisions.map((divisionLabel, divisionIndex) => {
                        const containerNode = divisionIndex === 0
                          ? fixedContainer
                          : findNodeByPath(normalized, ['root', ...builderPathIds.slice(1, divisionIndex + 1)]);

                        if (!containerNode) return null;

                        const selectedId = builderPathIds[divisionIndex + 1] ?? null;
                        const canAdd = divisionIndex < normalized.divisions.length;
                        const children = containerNode.children;

                        return (
                          <div key={divisionLabel + ':' + divisionIndex} style={{ border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 900, flex: 1 }}>{divisionLabel}</div>
                              {canAdd && (
                                <button
                                  className="ll-btn"
                                  style={{ padding: '5px 9px', fontSize: 11 }}
                                  onClick={() => {
                                    const title = window.prompt(`New ${divisionLabel} name`);
                                    if (!title) return;
                                    const id = makeStableId('node');
                                    setBuilderAtNode(containerNode.id, (n) => ({
                                      ...n,
                                      children: [...n.children, { id, title, children: [], questionTypes: [] }],
                                    }));
                                    selectAtDivision(divisionIndex, id);
                                  }}
                                >
                                  + Folder
                                </button>
                              )}
                            </div>
                            <div style={{ padding: 10 }}>
                              {children.length === 0 ? (
                                <div style={{ color: '#64748b', fontSize: 12 }}>No folders.</div>
                              ) : (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  {children.map((child) => {
                                    const active = selectedId === child.id;
                                    return (
                                      <div
                                        key={child.id}
                                        style={{
                                          padding: '10px 10px',
                                          borderRadius: 12,
                                          border: `${active ? 2 : 1}px solid ${active ? 'rgba(59,130,246,0.85)' : '#334155'}`,
                                          background: active ? 'rgba(59,130,246,0.22)' : '#0b1220',
                                          boxShadow: active ? '0 0 0 3px rgba(59,130,246,0.18)' : undefined,
                                          minWidth: 180,
                                          cursor: 'pointer',
                                        }}
                                        onClick={() => selectAtDivision(divisionIndex, child.id)}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <div style={{ color: 'white', fontWeight: 900, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.title}</div>
                                          {active && (
                                            <div style={{ color: '#93c5fd', fontSize: 11, fontWeight: 900 }}>Selected</div>
                                          )}
                                          <button
                                            className="ll-btn"
                                            style={{ padding: '4px 8px', fontSize: 11 }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const nextTitle = window.prompt('Rename folder', child.title);
                                              if (!nextTitle) return;
                                              setBuilderAtNode(child.id, (n) => ({ ...n, title: nextTitle }));
                                            }}
                                          >
                                            Rename
                                          </button>
                                          <button
                                            className="ll-btn"
                                            style={{ padding: '4px 8px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (!window.confirm('Delete this folder?')) return;
                                              setBuilderAtNode(containerNode.id, (n) => ({ ...n, children: n.children.filter((c) => c.id !== child.id) }));
                                              if (builderPathIds.includes(child.id)) {
                                                setBuilderPathIds(['root', ...builderPathIds.slice(1, divisionIndex + 1)]);
                                                setBuilderSelectedQuestionTypeId(null);
                                              }
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div style={{ border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 900, flex: 1 }}>Question Types</div>
                          {isLeaf && (
                            <button
                              className="ll-btn"
                              style={{ padding: '5px 9px', fontSize: 11 }}
                              onClick={() => {
                                const title = window.prompt('Question Type name (free-form)');
                                if (!title) return;
                                const id = makeStableId('qt');
                                const qt: BuilderQuestionTypeFile = { id, title, jsonText: '[]' };
                                setBuilderAtNode(cur.id, (n) => ({ ...n, questionTypes: [...n.questionTypes, qt] }));
                                setBuilderSelectedQuestionTypeId(id);
                              }}
                            >
                              + Add
                            </button>
                          )}
                        </div>
                        <div style={{ padding: 10 }}>
                          {!isLeaf ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>
                              Open folders until the last division to manage Question Types.
                              <div style={{ marginTop: 6, color: '#cbd5e1' }}>{path.map((x: BuilderNode) => x.title).join(' / ')}</div>
                            </div>
                          ) : cur.questionTypes.length === 0 ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>No question types yet.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {cur.questionTypes.map((qt) => {
                                const active = builderSelectedQuestionTypeId === qt.id;
                                return (
                                  <div
                                    key={qt.id}
                                    style={{
                                      padding: '10px 10px',
                                      borderRadius: 12,
                                      border: `1px solid ${active ? 'rgba(168,85,247,0.65)' : '#334155'}`,
                                      background: active ? 'rgba(168,85,247,0.12)' : '#0b1220',
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => setBuilderSelectedQuestionTypeId(qt.id)}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{ color: 'white', fontWeight: 900, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qt.title}</div>
                                      {active && <div style={{ color: '#d8b4fe', fontSize: 11, fontWeight: 900 }}>Selected</div>}
                                    </div>
                                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <button
                                        className="ll-btn"
                                        style={{ padding: '5px 10px', fontSize: 11 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const nextTitle = window.prompt('Rename question type', qt.title);
                                          if (!nextTitle) return;
                                          setBuilderAtNode(cur.id, (n) => ({
                                            ...n,
                                            questionTypes: n.questionTypes.map((x) => x.id === qt.id ? { ...x, title: nextTitle } : x),
                                          }));
                                        }}
                                      >
                                        Rename
                                      </button>
                                      <button
                                        className="ll-btn"
                                        style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!window.confirm('Delete this question type file?')) return;
                                          setBuilderAtNode(cur.id, (n) => ({
                                            ...n,
                                            questionTypes: n.questionTypes.filter((x) => x.id !== qt.id),
                                          }));
                                          if (builderSelectedQuestionTypeId === qt.id) setBuilderSelectedQuestionTypeId(null);
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {isLeaf && (
                  <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', color: '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>
                      Question Type JSON
                    </div>
                    <div style={{ padding: 12 }}>
                      {(() => {
                        const qt = cur.questionTypes.find((x) => x.id === builderSelectedQuestionTypeId) ?? null;
                        if (!qt) {
                          return <div style={{ color: '#64748b', fontSize: 12 }}>Select a question type above to edit its JSON.</div>;
                        }
                        return (
                          <div>
                            <div style={{ color: 'white', fontWeight: 900, fontSize: 13, marginBottom: 8 }}>{qt.title} JSON</div>
                            <textarea
                              value={qt.jsonText}
                              onChange={(e) => {
                                const v = e.target.value;
                                setBuilderAtNode(cur.id, (n) => ({
                                  ...n,
                                  questionTypes: n.questionTypes.map((x) => x.id === qt.id ? { ...x, jsonText: v } : x),
                                }));
                              }}
                              rows={16}
                              style={{ width: '100%', padding: '10px 10px', borderRadius: 12, border: '1px solid #334155', background: '#0b1220', color: 'white', fontFamily: 'monospace', fontSize: 12, outline: 'none', resize: 'vertical' }}
                            />

                            <div style={{ height: 1, background: '#1f2a44', margin: '14px 0' }} />

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                              <div style={{ color: '#cbd5e1', fontWeight: 900, fontSize: 12 }}>Upload image (Firebase Storage)</div>
                              <div style={{ color: '#64748b', fontSize: 11 }}>
                                Public read
                              </div>
                            </div>

                            {uploadedImageErr && (
                              <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8 }}>{uploadedImageErr}</div>
                            )}

                            {(() => {
                              let parsed: any[] | null = null;
                              try {
                                const raw = qt.jsonText.trim() ? JSON.parse(qt.jsonText) : [];
                                parsed = Array.isArray(raw) ? raw : null;
                              } catch {
                                parsed = null;
                              }

                              if (!parsed) {
                                return (
                                  <input
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp,image/gif"
                                    disabled={uploadingImage}
                                    onChange={async (e) => {
                                      const f = e.target.files?.[0] ?? null;
                                      if (!f) return;
                                      if (!userData || userData.role !== 'superadmin') {
                                        setUploadedImageErr('Only super admins can upload images.');
                                        return;
                                      }

                                      if (!ALLOWED_IMAGE_TYPES.has(f.type)) {
                                        setUploadedImageErr('Unsupported file type. Please upload PNG, JPG/JPEG, WEBP, or GIF.');
                                        e.target.value = '';
                                        return;
                                      }
                                      if (typeof f.size === 'number' && f.size > MAX_IMAGE_BYTES) {
                                        setUploadedImageErr('Image is too large. Max size is 5MB.');
                                        e.target.value = '';
                                        return;
                                      }

                                      setUploadingImage(true);
                                      setUploadedImageErr('');
                                      setUploadedImageUrl('');
                                      try {
                                        const programId = (builder.programId || makeIdFromTitle(builder.programTitle) || 'program').trim() || 'program';
                                        const uploaded = await uploadProgramQuestionAsset(f, programId);
                                        setUploadedImageUrl(uploaded.url);
                                      } catch (err) {
                                        setUploadedImageErr(err instanceof Error ? err.message : String(err));
                                      } finally {
                                        setUploadingImage(false);
                                        e.target.value = '';
                                      }
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '10px 10px',
                                      borderRadius: 12,
                                      border: '1px solid #334155',
                                      background: '#0b1220',
                                      color: 'white',
                                      outline: 'none',
                                      fontSize: 12,
                                      marginBottom: 10,
                                    }}
                                  />
                                );
                              }

                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                                  {parsed.length === 0 ? (
                                    <div style={{ color: '#64748b', fontSize: 12 }}>Add at least one question in the JSON array to attach images to a specific question.</div>
                                  ) : (
                                    parsed.slice(0, 50).map((q: any, idx: number) => {
                                      const qid = typeof q?.id === 'string' ? q.id : `q_${idx + 1}`;
                                      const label = typeof q?.question === 'string' && q.question.trim()
                                        ? q.question.trim().slice(0, 80)
                                        : (Array.isArray(q?.promptBlocks) && q.promptBlocks.length > 0 && typeof q.promptBlocks?.[0]?.text === 'string'
                                          ? String(q.promptBlocks[0].text).trim().slice(0, 80)
                                          : '—');

                                      return (
                                        <div key={`${qid}_${idx}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 10px', border: '1px solid #1f2a44', borderRadius: 12, background: 'rgba(2,6,23,0.25)' }}>
                                          <div style={{ minWidth: 0 }}>
                                            <div style={{ color: 'white', fontWeight: 900, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qid}</div>
                                            <div style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                                          </div>
                                          <input
                                            type="file"
                                            accept="image/png,image/jpeg,image/webp,image/gif"
                                            disabled={uploadingImage}
                                            onChange={async (e) => {
                                              const f = e.target.files?.[0] ?? null;
                                              if (!f) return;
                                              if (!userData || userData.role !== 'superadmin') {
                                                setUploadedImageErr('Only super admins can upload images.');
                                                return;
                                              }

                                              if (!ALLOWED_IMAGE_TYPES.has(f.type)) {
                                                setUploadedImageErr('Unsupported file type. Please upload PNG, JPG/JPEG, WEBP, or GIF.');
                                                e.target.value = '';
                                                return;
                                              }
                                              if (typeof f.size === 'number' && f.size > MAX_IMAGE_BYTES) {
                                                setUploadedImageErr('Image is too large. Max size is 5MB.');
                                                e.target.value = '';
                                                return;
                                              }

                                              setUploadingImage(true);
                                              setUploadedImageErr('');
                                              setUploadedImageUrl('');
                                              try {
                                                const programId = (builder.programId || makeIdFromTitle(builder.programTitle) || 'program').trim() || 'program';
                                                const uploaded = await uploadProgramQuestionAsset(f, programId);
                                                const url = uploaded.url;
                                                setUploadedImageUrl(url);

                                                const raw2 = qt.jsonText.trim() ? JSON.parse(qt.jsonText) : [];
                                                if (!Array.isArray(raw2)) throw new Error('Question Type JSON must be a JSON array');
                                                const next2 = [...raw2];
                                                const q2 = next2[idx] && typeof next2[idx] === 'object' ? { ...(next2[idx] as any) } : { id: qid };
                                                const pb2 = Array.isArray((q2 as any).promptBlocks) ? ([...(q2 as any).promptBlocks] as any[]) : [];
                                                pb2.push({ type: 'image', url, alt: 'diagram' });
                                                (q2 as any).promptBlocks = pb2;
                                                next2[idx] = q2;
                                                const nextText2 = JSON.stringify(next2, null, 2);
                                                setBuilderAtNode(cur.id, (n) => ({
                                                  ...n,
                                                  questionTypes: n.questionTypes.map((x) => x.id === qt.id ? { ...x, jsonText: nextText2 } : x),
                                                }));
                                              } catch (err) {
                                                setUploadedImageErr(err instanceof Error ? err.message : String(err));
                                              } finally {
                                                setUploadingImage(false);
                                                e.target.value = '';
                                              }
                                            }}
                                            style={{
                                              width: 220,
                                              padding: '8px 10px',
                                              borderRadius: 12,
                                              border: '1px solid #334155',
                                              background: '#0b1220',
                                              color: 'white',
                                              outline: 'none',
                                              fontSize: 12,
                                            }}
                                          />
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              );
                            })()}

                            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>
                              {uploadingImage ? 'Uploading…' : 'Uploading will insert an image block into the selected question’s `promptBlocks` (when JSON is a valid array).'}
                            </div>

                            {uploadedImageUrl && (
                              <div style={{ border: '1px solid #1f2a44', borderRadius: 12, padding: 10, background: 'rgba(2,6,23,0.35)' }}>
                                <div style={{ color: '#cbd5e1', fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Uploaded URL</div>
                                <div style={{ color: '#93c5fd', fontSize: 12, wordBreak: 'break-all', marginBottom: 10 }}>{uploadedImageUrl}</div>
                                <div style={{ color: '#cbd5e1', fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Prompt block snippet</div>
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'white', fontSize: 12, fontFamily: 'monospace' }}>
{JSON.stringify({ type: 'image', url: uploadedImageUrl, alt: 'diagram' }, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>📚 Programs ({items.length})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>↺ Refresh</button>
          <button onClick={startNewBuilder} className="ll-btn ll-btn-primary" style={{ padding: '7px 14px', fontSize: 12, background: '#a855f7', borderColor: '#7c3aed', color: 'white' }}>+ New</button>
        </div>
      </div>

      <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>📝 Drafts ({draftItems.length})</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>Only visible to superadmins</div>
        </div>
        <div style={{ padding: 12 }}>
          {draftItems.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12 }}>No drafts yet. Use “Save Draft” inside the builder.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draftItems.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.25)' }}>
                  <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{(d.coverEmoji as string) ?? '📝'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(d.title as string) ?? d.id}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{(d.subject as string) ?? 'subject'}{d.grade_band ? ` • ${d.grade_band}` : ''}</div>
                  </div>
                  <button onClick={() => previewSavedDraft(d.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
                  <button onClick={() => startEditDraftBuilder(d)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
                  <button onClick={() => removeDraft(d.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: 18, color: '#64748b' }}>No public programs yet.</div>
        ) : (
          items.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #0f172a' }}>
              <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{(p.coverEmoji as string) ?? '📘'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(p.title as string) ?? p.id}
                </div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{(p.subject as string) ?? 'subject'}{p.grade_band ? ` • ${p.grade_band}` : ''}</div>
              </div>
              <button onClick={() => previewProgram(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
              <button onClick={() => startEditBuilder(p)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
              <button onClick={() => remove(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
            </div>
          ))
        )}
      </div>
      </>
      )}
    </div>
  );
}
