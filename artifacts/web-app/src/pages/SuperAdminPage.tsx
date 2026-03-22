import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, updateUserData, deleteUserData, updateEconomy, UserData, UserRole, computeLevel } from '@/lib/userService';
import { getAllOrgs, createOrg, updateOrg, deleteOrg, addAdminToOrg, removeAdminFromOrg, OrgData } from '@/lib/orgService';
import { getAllClasses } from '@/lib/classService';

type Tab = 'overview' | 'users' | 'orgs' | 'requests';

const ROLE_ORDER: UserRole[] = ['student', 'teacher', 'admin', 'superadmin'];
const ROLE_COLORS: Record<UserRole, string> = {
  student: '#3b82f6', teacher: '#10b981', admin: '#f97316', superadmin: '#a855f7'
};

export default function SuperAdminPage() {
  const { user, userData } = useAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<Array<UserData & { uid: string }>>([]);
  const [orgs, setOrgs] = useState<OrgData[]>([]);
  const [classes, setClasses] = useState<Awaited<ReturnType<typeof getAllClasses>>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // Org creation modal
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState<OrgData['type']>('school');
  const [orgCountry, setOrgCountry] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [assigningAdmin, setAssigningAdmin] = useState<string | null>(null);
  const [adminSearch, setAdminSearch] = useState('');

  // Economy modal
  const [econModal, setEconModal] = useState<{ uid: string; name: string; goldDelta: string; xpDelta: string } | null>(null);
  const [applyingEcon, setApplyingEcon] = useState(false);

  // Pending curriculum requests count for badge
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);

  useEffect(() => {
    if (userData && userData.role !== 'superadmin') setLocation('/');
    else loadData();
  }, [userData]);

  useEffect(() => {
    import('firebase/firestore').then(async ({ getDocs, collection, query, where }) => {
      const { db } = await import('@/lib/firebase');
      const q = query(collection(db, 'curriculumRequests'), where('status', '==', 'pending'));
      const snap = await getDocs(q);
      setPendingRequestsCount(snap.size);
    });
  }, []);

  async function loadData() {
    setLoading(true);
    const [u, o, c] = await Promise.all([getAllUsers(), getAllOrgs(), getAllClasses()]);
    setUsers(u);
    setOrgs(o);
    setClasses(c);
    setLoading(false);
  }

  async function handleRoleChange(uid: string, role: UserRole) {
    setChangingRole(uid);
    const updates: Partial<UserData> = { role };
    // If downgrading from org role, remove org assignment
    if (role === 'student') updates.organisationId = undefined;
    await updateUserData(uid, updates);
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, ...updates } : u));
    setChangingRole(null);
  }

  async function handleDeleteUser(uid: string) {
    if (!window.confirm('Permanently delete this account? This cannot be undone.')) return;
    setDeletingUser(uid);
    await deleteUserData(uid);
    setUsers(prev => prev.filter(u => u.uid !== uid));
    setDeletingUser(null);
  }

  async function handleCreateOrg() {
    if (!orgName.trim()) return;
    setSavingOrg(true);
    const org = await createOrg({ name: orgName.trim(), type: orgType, country: orgCountry.trim(), adminIds: [] });
    setOrgs(prev => [...prev, org]);
    setOrgName(''); setOrgType('school'); setOrgCountry(''); setShowOrgModal(false);
    setSavingOrg(false);
  }

  async function handleDeleteOrg(orgId: string) {
    if (!window.confirm('Delete this organisation? Admins/teachers assigned to it will lose their org link.')) return;
    await deleteOrg(orgId);
    setOrgs(prev => prev.filter(o => o.id !== orgId));
  }

  async function handleAddAdmin(orgId: string, uid: string) {
    await addAdminToOrg(orgId, uid);
    await updateUserData(uid, { role: 'admin', organisationId: orgId });
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, adminIds: [...o.adminIds, uid] } : o));
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: 'admin', organisationId: orgId } : u));
    setAssigningAdmin(null);
    setAdminSearch('');
  }

  async function handleRemoveAdmin(orgId: string, uid: string) {
    await removeAdminFromOrg(orgId, uid);
    await updateUserData(uid, { role: 'student', organisationId: undefined });
    setOrgs(prev => prev.map(o => o.id === orgId ? { ...o, adminIds: o.adminIds.filter(id => id !== uid) } : o));
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: 'student', organisationId: undefined } : u));
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
  const totalTeachers  = users.filter(u => u.role === 'teacher').length;
  const totalAdmins    = users.filter(u => u.role === 'admin').length;
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
    { id: 'orgs', icon: '🏛️', label: `Orgs (${orgs.length})` },
    { id: 'requests', icon: '📬', label: 'Requests', badge: pendingRequestsCount },
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
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Full platform control · All accounts · All organisations</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadData} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>
              ↺ Refresh
            </button>
            <button onClick={() => setLocation('/auth')} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>
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
                { label: 'Admins', value: totalAdmins, icon: '⚙️', color: '#f97316' },
                { label: 'Teachers', value: totalTeachers, icon: '🧑‍🏫', color: '#10b981' },
                { label: 'Students', value: totalStudents, icon: '🧑‍🎓', color: '#3b82f6' },
                { label: 'Organisations', value: orgs.length, icon: '🏛️', color: '#fbbf24' },
                { label: 'Classes', value: classes.length, icon: '🏫', color: '#06b6d4' },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: '#1e293b', borderRadius: 10, padding: '14px 12px',
                  border: `1px solid ${stat.color}33`, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                  <div style={{ color: '#64748b', fontSize: 10, marginTop: 3 }}>{stat.label}</div>
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
                <option value="teacher">Teachers</option>
                <option value="admin">Admins</option>
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
                        {!isSelf && (user?.email === 'superadmin.logiclords@internal.app' || u.role !== 'superadmin') && (
                          <>
                            <select
                              value={u.role} disabled={changingRole === u.uid}
                              onChange={e => handleRoleChange(u.uid, e.target.value as UserRole)}
                              style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: '#94a3b8', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', outline: 'none' }}
                            >
                              {(user?.email === 'superadmin.logiclords@internal.app' ? ROLE_ORDER : ROLE_ORDER.filter(r => r !== 'superadmin'))
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
                        {u.organisationId && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
                            Org: {orgs.find(o => o.id === u.organisationId)?.name || u.organisationId}
                          </div>
                        )}
                        {u.curriculumProfile && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
                            Curriculum: {u.curriculumProfile.system} · {u.curriculumProfile.year} · {u.curriculumProfile.textbook}
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

        {/* ── ORGS ── */}
        {tab === 'orgs' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>🏛️ Organisations</h3>
              <button
                onClick={() => setShowOrgModal(true)}
                className="ll-btn ll-btn-primary"
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                + New Organisation
              </button>
            </div>

            {orgs.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🏛️</div>
                <p>No organisations yet. Create the first one!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {orgs.map(org => {
                  const isExp = expandedOrg === org.id;
                  const admins = users.filter(u => org.adminIds.includes(u.uid));
                  const orgUsers = users.filter(u => u.organisationId === org.id);
                  const candidateAdmins = users.filter(u =>
                    adminSearch && u.role !== 'superadmin' &&
                    [u.username, u.email, u.firstName].some(f => f?.toLowerCase().includes(adminSearch.toLowerCase()))
                  ).slice(0, 5);

                  return (
                    <div key={org.id} style={{ background: '#1e293b', borderRadius: 12, border: `1px solid ${isExp ? '#f97316aa' : '#334155'}`, overflow: 'hidden' }}>
                      <button
                        onClick={() => setExpandedOrg(isExp ? null : org.id)}
                        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left' }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                            <span style={{ fontWeight: 'bold', color: 'white', fontSize: 15 }}>{org.name}</span>
                            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}>
                              {org.joinCode}
                            </span>
                          </div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>
                            {org.type} {org.country ? `· ${org.country}` : ''} · {admins.length} admin{admins.length !== 1 ? 's' : ''} · {orgUsers.length} members
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteOrg(org.id); }}
                          style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                        >
                          🗑️
                        </button>
                        <span style={{ color: '#475569', fontSize: 14 }}>{isExp ? '▲' : '▼'}</span>
                      </button>

                      {isExp && (
                        <div style={{ padding: '0 16px 16px', borderTop: '1px solid #334155' }}>
                          <div style={{ marginBottom: 12, marginTop: 10 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                              Admins ({admins.length})
                            </div>
                            {admins.map(a => (
                              <div key={a.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, background: '#0f172a', borderRadius: 8, padding: '8px 12px' }}>
                                <div style={{ flex: 1, color: 'white', fontSize: 12 }}>{a.username || `${a.firstName} ${a.lastName}`}</div>
                                <div style={{ color: '#64748b', fontSize: 11 }}>{a.email}</div>
                                <button
                                  onClick={() => handleRemoveAdmin(org.id, a.uid)}
                                  style={{ padding: '3px 8px', borderRadius: 5, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}

                            {assigningAdmin === org.id ? (
                              <div style={{ marginTop: 8 }}>
                                <input
                                  value={adminSearch} onChange={e => setAdminSearch(e.target.value)}
                                  placeholder="Search user to make admin..."
                                  autoFocus
                                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 6 }}
                                />
                                {candidateAdmins.map(u => (
                                  <button
                                    key={u.uid}
                                    onClick={() => handleAddAdmin(org.id, u.uid)}
                                    style={{ display: 'block', width: '100%', padding: '8px 12px', marginBottom: 4, borderRadius: 8, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, textAlign: 'left' }}
                                  >
                                    {u.username || `${u.firstName} ${u.lastName}`} · <span style={{ color: '#64748b' }}>{u.email}</span>
                                  </button>
                                ))}
                                <button onClick={() => { setAssigningAdmin(null); setAdminSearch(''); }} style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setAssigningAdmin(org.id)}
                                style={{ marginTop: 6, padding: '6px 14px', borderRadius: 7, fontSize: 12, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399', cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                + Assign Admin
                              </button>
                            )}
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

        {/* ── REQUESTS ── */}
        {tab === 'requests' && (
          <CurriculumRequests />
        )}
      </div>

      {/* Create Org Modal */}
      {showOrgModal && (
        <>
          <div onClick={() => setShowOrgModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(400px, 92vw)',
            border: '2px solid #a855f7', zIndex: 1001, boxShadow: '0 20px 50px rgba(0,0,0,0.6)', animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 18px', color: 'white', fontSize: 18 }}>🏛️ New Organisation</h2>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Name *</label>
            <input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="e.g. International School of Beirut"
              style={{ width: '100%', padding: '10px 13px', marginBottom: 10, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Type</label>
            <select value={orgType} onChange={e => setOrgType(e.target.value as OrgData['type'])}
              style={{ width: '100%', padding: '10px 13px', marginBottom: 10, borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}>
              <option value="school">School</option>
              <option value="university">University</option>
              <option value="other">Other</option>
            </select>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Country</label>
            <input value={orgCountry} onChange={e => setOrgCountry(e.target.value)} placeholder="e.g. Lebanon"
              style={{ width: '100%', padding: '10px 13px', marginBottom: 16, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowOrgModal(false)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleCreateOrg} disabled={!orgName.trim() || savingOrg} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px', opacity: orgName.trim() ? 1 : 0.5 }}>
                {savingOrg ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </>
      )}

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

function CurriculumRequests() {
  const [requests, setRequests] = useState<Array<{ id: string; uid: string; username: string; system: string; year: string; textbook: string; requestedAt: string; status: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    import('firebase/firestore').then(async ({ getDocs, collection, orderBy, query }) => {
      const { db } = await import('@/lib/firebase');
      const q = query(collection(db, 'curriculumRequests'));
      const snap = await getDocs(q);
      setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }) as typeof requests[0]));
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>Loading requests...</div>;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <h3 style={{ color: 'white', margin: '0 0 14px', fontSize: 16 }}>📬 Curriculum Requests ({requests.length})</h3>
      {requests.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📬</div>
          <p>No curriculum requests yet.</p>
        </div>
      ) : requests.map(r => (
        <div key={r.id} style={{ background: '#1e293b', borderRadius: 10, padding: '12px 16px', marginBottom: 8, border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>📖 {r.textbook}</div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>
                {r.system} · {r.year} · by <span style={{ color: '#93c5fd' }}>{r.username}</span>
              </div>
              <div style={{ color: '#475569', fontSize: 11, marginTop: 3 }}>{new Date(r.requestedAt).toLocaleDateString()}</div>
            </div>
            <span style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 'bold',
              background: r.status === 'pending' ? 'rgba(251,191,36,0.1)' : 'rgba(16,185,129,0.1)',
              border: `1px solid ${r.status === 'pending' ? 'rgba(251,191,36,0.3)' : 'rgba(16,185,129,0.3)'}`,
              color: r.status === 'pending' ? '#fbbf24' : '#34d399', textTransform: 'capitalize'
            }}>
              {r.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
