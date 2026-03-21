import { useState, useEffect } from 'react';
import { getAllUsers, getUsersByRole, updateUserData, UserData, UserRole, computeLevel } from '@/lib/userService';
import { getAllClasses, ClassData } from '@/lib/classService';

export default function AdminDashboard() {
  const [users, setUsers] = useState<Array<UserData & { uid: string }>>([]);
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'users' | 'classes'>('overview');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [changingRole, setChangingRole] = useState<string | null>(null);

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

  const totalStudents = users.filter(u => u.role === 'student').length;
  const totalTeachers = users.filter(u => u.role === 'teacher').length;
  const totalAdmins = users.filter(u => u.role === 'admin').length;
  const activeToday = users.filter(u => u.last_active === new Date().toISOString().split('T')[0]).length;
  const totalXP = users.reduce((a, u) => a + (u.economy?.global_xp || 0), 0);
  const avgXP = users.length ? Math.round(totalXP / users.length) : 0;

  const filteredUsers = users.filter(u => {
    const matchesSearch = !search || [u.username, u.email, u.firstName, u.lastName].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const ROLE_COLORS: Record<UserRole, string> = {
    student: '#3b82f6', teacher: '#10b981', admin: '#f97316'
  };

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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      {/* Header */}
      <div style={{ padding: '15px 20px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 20 }}>⚙️ Admin Dashboard</h2>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 2 }}>Full platform overview and management</div>
          </div>
          <button onClick={loadData} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
            background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer'
          }}>
            ↺ Refresh
          </button>
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          {(['overview', 'users', 'classes'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '7px 18px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t ? 'rgba(59,130,246,0.2)' : 'transparent',
              border: `1px solid ${tab === t ? 'rgba(59,130,246,0.5)' : 'transparent'}`,
              color: tab === t ? '#93c5fd' : '#64748b', cursor: 'pointer', textTransform: 'capitalize'
            }}>
              {{ overview: '📊', users: '👥', classes: '🏫' }[t]} {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {tab === 'overview' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 15, marginBottom: 25 }}>
              {[
                { label: 'Total Users', value: users.length, icon: '👤', color: '#c084fc' },
                { label: 'Students', value: totalStudents, icon: '🧑‍🎓', color: '#3b82f6' },
                { label: 'Teachers', value: totalTeachers, icon: '🧑‍🏫', color: '#10b981' },
                { label: 'Active Today', value: activeToday, icon: '⚡', color: '#fbbf24' },
                { label: 'Total Classes', value: classes.length, icon: '🏫', color: '#f97316' },
                { label: 'Avg XP', value: avgXP.toLocaleString(), icon: '⭐', color: '#06b6d4' },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: '#1e293b', borderRadius: 12, padding: '18px 16px',
                  border: `1px solid ${stat.color}33`, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{stat.icon}</div>
                  <div style={{ fontSize: 26, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Top players */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155', marginBottom: 20 }}>
              <h3 style={{ color: 'white', margin: '0 0 15px', fontSize: 16 }}>🏆 Top Players (All-Time)</h3>
              {[...users]
                .sort((a, b) => (b.economy?.global_xp || 0) - (a.economy?.global_xp || 0))
                .slice(0, 5)
                .map((u, i) => {
                  const { level, title } = computeLevel(u.economy?.global_xp || 0);
                  const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i];
                  return (
                    <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < 4 ? '1px solid #334155' : 'none' }}>
                      <span style={{ fontSize: 20, width: 28 }}>{medal}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 14 }}>{u.username || `${u.firstName} ${u.lastName}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>Lv.{level} {title} • {u.role}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#10b981', fontWeight: 'bold' }}>{(u.economy?.global_xp || 0).toLocaleString()} XP</div>
                        <div style={{ color: '#fbbf24', fontSize: 12 }}>🪙 {(u.economy?.gold || 0).toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Role distribution */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, border: '1px solid #334155' }}>
              <h3 style={{ color: 'white', margin: '0 0 15px', fontSize: 16 }}>👥 User Distribution</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {([['Students', totalStudents, '#3b82f6'], ['Teachers', totalTeachers, '#10b981'], ['Admins', totalAdmins, '#f97316']] as [string, number, string][]).map(([label, count, color]) => (
                  <div key={label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                      <span style={{ color: '#cbd5e1' }}>{label}</span>
                      <span style={{ color, fontWeight: 'bold' }}>{count} ({users.length > 0 ? Math.round(count / users.length * 100) : 0}%)</span>
                    </div>
                    <div style={{ height: 8, background: '#0f172a', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${users.length > 0 ? (count / users.length) * 100 : 0}%`, height: '100%', background: color, transition: '0.5s', borderRadius: 4 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 15, flexWrap: 'wrap' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search by name, username, email..."
                style={{
                  flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 8,
                  border: '1px solid #475569', background: '#1e293b', color: 'white',
                  fontFamily: 'inherit', fontSize: 14, outline: 'none'
                }}
              />
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
                style={{
                  padding: '10px 14px', borderRadius: 8, border: '1px solid #475569',
                  background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 14, outline: 'none', cursor: 'pointer'
                }}
              >
                <option value="all">All Roles</option>
                <option value="student">Students</option>
                <option value="teacher">Teachers</option>
                <option value="admin">Admins</option>
              </select>
            </div>

            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>{filteredUsers.length} users found</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredUsers.map(u => {
                const { level } = computeLevel(u.economy?.global_xp || 0);
                return (
                  <div key={u.uid} style={{
                    background: '#1e293b', borderRadius: 10, padding: '12px 16px',
                    border: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'
                  }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                      background: `hsl(${(u.username?.charCodeAt(0) || 65) * 37 % 360}, 60%, 35%)`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 'bold', color: 'white', fontSize: 16
                    }}>
                      {(u.username?.[0] || u.firstName?.[0] || '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontWeight: 'bold', color: 'white', fontSize: 14 }}>{u.username || `${u.firstName} ${u.lastName}`}</div>
                      <div style={{ color: '#64748b', fontSize: 11 }}>{u.email} • Lv.{level} • {(u.economy?.global_xp || 0).toLocaleString()} XP</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 'bold', padding: '3px 10px', borderRadius: 6, textTransform: 'capitalize',
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
                          padding: '5px 10px', borderRadius: 6, border: '1px solid #475569',
                          background: '#0f172a', color: '#94a3b8', fontFamily: 'inherit', fontSize: 12,
                          cursor: 'pointer', outline: 'none'
                        }}
                      >
                        <option value="student">Make Student</option>
                        <option value="teacher">Make Teacher</option>
                        <option value="admin">Make Admin</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'classes' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <h3 style={{ color: 'white', margin: '0 0 15px', fontSize: 18 }}>🏫 All Classes ({classes.length})</h3>
            {classes.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 15 }}>🏫</div>
                <p>No classes created yet.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 15 }}>
                {classes.map(cls => (
                  <div key={cls.id} style={{ background: '#1e293b', borderRadius: 12, padding: 18, border: '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 16 }}>{cls.name}</div>
                        <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{cls.subject}</div>
                      </div>
                      <span style={{
                        fontWeight: 'bold', fontSize: 14, letterSpacing: 2,
                        background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                        borderRadius: 6, padding: '3px 8px', color: '#fbbf24'
                      }}>
                        {cls.code}
                      </span>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>
                      <div>👨‍🏫 {cls.teacherName}</div>
                      <div style={{ marginTop: 4 }}>👥 {cls.studentIds.length} students</div>
                      <div style={{ marginTop: 4, color: '#475569', fontSize: 11 }}>
                        Created {new Date(cls.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
