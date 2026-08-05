import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { performSignOut } from '@/lib/authService';
import SettingsLauncher from '@/components/settings/SettingsLauncher';
import { addClassMember, getClassMembers, getStudentClasses, getStudentSessions, getTeacherClassesByTeacher, kickStudent, type ClassMember, type ClassSession, type TeacherClass } from '@/lib/classroomService';
import { getMyTeachers, type TeacherInfo, type TeacherUserRow } from '@/lib/adminService';
import { getAssignedTeacherStudents } from '@/lib/teacherService';
import { decideGuardianConsent, getLinkedStudents, getPendingGuardianConsents, type LinkedStudent, type PendingGuardianConsent } from '@/lib/parentService';
import { getHomeworkSubmission, listClassHomeworks, listHomeworkSubmissions, type Homework, type HomeworkSubmission } from '@/lib/homeworkService';

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 11, padding: 14 };
const btn: React.CSSProperties = { padding: '8px 12px', borderRadius: 7, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontWeight: 'bold' };

function Shell(p: { title: string; color: string; tabs: Array<{ id: string; icon: string; label: string }>; active: string; onTab: (id: string) => void; children: React.ReactNode }) {
  const { userData } = useAuth();
  return <div className="app-viewport" style={{ display: 'flex', flexDirection: 'column', background: '#0f172a', color: 'white' }}>
    <header className="app-safe-header phone-wrap" style={{ paddingBottom: 10, background: '#1e293b', borderBottom: '2px solid ' + p.color, display: 'flex', alignItems: 'center', gap: 10 }}>
      <h2 style={{ margin: 0, flex: 1, fontSize: 19 }}>{p.title} <small style={{ color: p.color, fontSize: 11 }}>· {userData?.username}</small></h2>
      <SettingsLauncher compact inline />
      <button onClick={() => void performSignOut()} style={{ ...btn, color: '#f87171', borderColor: '#ef4444' }}>Sign Out</button>
    </header>
    <main className="app-scroll" style={{ flex: 1, padding: 18 }}>{p.children}</main>
    <nav className="app-safe-nav" style={{ display: 'flex', justifyContent: 'space-around', background: '#111827', borderTop: '1px solid #334155', paddingTop: 7 }}>
      {p.tabs.map(tab => <button key={tab.id} onClick={() => p.onTab(tab.id)} aria-label={tab.label} aria-current={p.active === tab.id ? 'page' : undefined} style={{ border: 0, background: 'transparent', color: p.active === tab.id ? p.color : '#64748b', fontWeight: 'bold', cursor: 'pointer' }}><span style={{ display: 'block', fontSize: 19 }}>{tab.icon}</span><span className="app-bottom-tab-label" style={{ fontSize: 10 }}>{tab.label}</span></button>)}
    </nav>
  </div>;
}
function Empty({ text }: { text: string }) { return <div style={{ ...card, color: '#64748b', textAlign: 'center', padding: 35 }}>{text}</div>; }
function ClassList({ rows, open }: { rows: TeacherClass[]; open: (row: TeacherClass) => void }) { return <div style={{ display: 'grid', gap: 8 }}>{rows.length ? rows.map(row => <button key={row.id} onClick={() => open(row)} style={{ ...card, color: 'white', textAlign: 'left', cursor: 'pointer' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{row.name}</strong><span>📘 {row.subject}</span></div><small style={{ color: '#64748b' }}>{row.teacherName} · {row.status}</small></button>) : <Empty text="No classrooms." />}</div>; }

function AdminClass({ cls, users, back }: { cls: TeacherClass; users: TeacherUserRow[]; back: () => void }) {
  const [members, setMembers] = useState<ClassMember[]>([]); const [homeworks, setHomeworks] = useState<Homework[]>([]); const [drafts, setDrafts] = useState<Record<string, HomeworkSubmission[]>>({});
  async function load() { const result = await Promise.all([getClassMembers(cls.id), listClassHomeworks(cls.id)]); setMembers(result[0]); setHomeworks(result[1]); const pairs = await Promise.all(result[1].map(async h => [h.id, await listHomeworkSubmissions(h.id)] as const)); setDrafts(Object.fromEntries(pairs)); }
  useEffect(() => { void load(); }, [cls.id]);
  const active = new Set(members.filter(m => !m.kickedAt).map(m => m.userId));
  return <div><button onClick={back} style={btn}>← Classrooms</button><h2>{cls.name}</h2><h3>Participants</h3>{users.map(u => <div key={u.user_id} style={{ ...card, display: 'flex', marginBottom: 6 }}><span style={{ flex: 1 }}>{u.username} · {u.role === 'teacher_assistant' ? 'TA' : 'Student'}</span><button style={btn} onClick={async () => { if (active.has(u.user_id)) await kickStudent(cls.id, u.user_id); else await addClassMember(cls.id, u.user_id, u.username, (u.first_name + ' ' + u.last_name).trim(), u.role === 'teacher_assistant' ? 'teacher_assistant' : 'student'); await load(); }}>{active.has(u.user_id) ? 'Remove' : 'Add'}</button></div>)}<h3>Homework and live drafts</h3>{homeworks.length ? homeworks.map(h => <div key={h.id} style={{ ...card, marginBottom: 7 }}><a href={h.fileUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{h.title}</a><div style={{ color: '#94a3b8', fontSize: 12 }}>{(drafts[h.id] || []).length} students started</div>{(drafts[h.id] || []).map(d => <div key={d.id} style={{ fontSize: 12 }}>{members.find(m => m.userId === d.studentId)?.fullName || d.studentId}: {d.sheets.length} sheets, {d.attachments.length} files</div>)}</div>) : <Empty text="No homework." />}</div>;
}

export function UnifiedAdminPage() {
  const { user, userData, loading } = useAuth(); const [, go] = useLocation(); const [tab, setTab] = useState('classrooms'); const [teachers, setTeachers] = useState<TeacherInfo[]>([]); const [teacher, setTeacher] = useState(''); const [classes, setClasses] = useState<TeacherClass[]>([]); const [users, setUsers] = useState<TeacherUserRow[]>([]); const [selected, setSelected] = useState<TeacherClass | null>(null);
  useEffect(() => { if (!loading && (!user || userData?.role !== 'admin')) go('/auth'); }, [loading, user, userData]);
  useEffect(() => { void getMyTeachers().then(r => { setTeachers(r); setTeacher(r[0]?.id || ''); }); }, []);
  useEffect(() => { if (teacher) void Promise.all([getTeacherClassesByTeacher(teacher), getAssignedTeacherStudents(teacher)]).then(r => { setClasses(r[0]); setUsers(r[1]); setSelected(null); }); }, [teacher]);
  return <Shell title="🛡️ Admin" color="#f59e0b" tabs={[{ id: 'users', icon: '👥', label: 'Users' }, { id: 'classrooms', icon: '🏫', label: 'Classrooms' }]} active={tab} onTab={id => { setTab(id); setSelected(null); }}><select value={teacher} onChange={e => setTeacher(e.target.value)} style={{ ...btn, marginBottom: 12 }}>{teachers.map(t => <option key={t.id} value={t.id}>{t.username}</option>)}</select>{selected ? <AdminClass cls={selected} users={users} back={() => setSelected(null)} /> : tab === 'classrooms' ? <ClassList rows={classes} open={setSelected} /> : <div>{users.map(u => <div key={u.user_id} style={{ ...card, marginBottom: 6 }}><strong>{u.username}</strong><small style={{ display: 'block', color: '#64748b' }}>{u.email} · {u.role}</small></div>)}</div>}</Shell>;
}

function ParentClass({ cls, child, back }: { cls: TeacherClass; child: LinkedStudent; back: () => void }) {
  const [homeworks, setHomeworks] = useState<Homework[]>([]); const [work, setWork] = useState<Record<string, HomeworkSubmission | null>>({}); const [sessions, setSessions] = useState<ClassSession[]>([]);
  useEffect(() => { void Promise.all([listClassHomeworks(cls.id), getStudentSessions(child.id, cls.id)]).then(async result => { setHomeworks(result[0]); setSessions(result[1]); const pairs = await Promise.all(result[0].map(async x => [x.id, await getHomeworkSubmission(x.id, child.id)] as const)); setWork(Object.fromEntries(pairs)); }); }, [cls.id, child.id]);
  return <div><button onClick={back} style={btn}>← Classrooms</button><h2>{cls.name}</h2><p>{cls.subject} · {cls.teacherName}</p><h3>Sessions</h3>{sessions.length ? sessions.map(s => <div key={s.id} style={{ ...card, marginBottom: 7 }}><strong>{s.name}</strong><div style={{ color: '#94a3b8', fontSize: 12 }}>{new Date(s.date).toLocaleString()} · {s.status}</div></div>) : <Empty text="No sessions." />}<h3>Homework</h3>{homeworks.length ? homeworks.map(h => { const s = work[h.id]; return <div key={h.id} style={{ ...card, marginBottom: 7 }}><a href={h.fileUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>{h.title}</a><div style={{ fontSize: 12, color: '#94a3b8' }}>Due {new Date(h.dueAt).toLocaleString()}</div><div style={{ fontSize: 12 }}>{s ? s.sheets.length + ' sheets · ' + s.attachments.length + ' files' : 'Not started'}</div>{s?.attachments.map(f => <a key={f.id} href={f.url} target="_blank" rel="noreferrer" style={{ display: 'block', color: '#c4b5fd' }}>📄 {f.name}</a>)}</div>; }) : <Empty text="No homework." />}</div>;
}

export function UnifiedParentPage() {
  const { user, userData, loading } = useAuth(); const [, go] = useLocation(); const [tab, setTab] = useState('overview'); const [children, setChildren] = useState<LinkedStudent[]>([]); const [pendingConsents, setPendingConsents] = useState<PendingGuardianConsent[]>([]); const [child, setChild] = useState<LinkedStudent | null>(null); const [classes, setClasses] = useState<TeacherClass[]>([]); const [selected, setSelected] = useState<TeacherClass | null>(null);
  async function loadFamily() { const [linked, pending] = await Promise.all([getLinkedStudents(), getPendingGuardianConsents()]); setChildren(linked); setChild(current => linked.find(item => item.id === current?.id) || linked[0] || null); setPendingConsents(pending); }
  useEffect(() => { if (!loading && (!user || userData?.role !== 'parent')) go('/auth'); if (userData?.role === 'parent') void loadFamily(); }, [loading, user, userData]);
  useEffect(() => { if (child) void getStudentClasses(child.id).then(r => setClasses(r.active.concat(r.archived))); }, [child?.id]);
  const tabs = [{ id: 'overview', icon: '🏠', label: 'Overview' }, { id: 'classrooms', icon: '🏫', label: 'Classrooms' }, { id: 'progress', icon: '📊', label: 'Progress' }, { id: 'messages', icon: '💬', label: 'Messages' }];
  return <Shell title="👨‍👩‍👧 Parent" color="#ec4899" tabs={tabs} active={tab} onTab={id => { setTab(id); setSelected(null); }}>{pendingConsents.length > 0 && <div style={{ ...card, borderColor: '#f59e0b', marginBottom: 12 }}><strong>Guardian approval requests</strong>{pendingConsents.map(request => <div key={request.consentId} className="phone-wrap" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}><span style={{ flex: 1 }}>{request.studentUsername}<small style={{ display: 'block', color: '#94a3b8' }}>Requested {new Date(request.requestedAt).toLocaleDateString()}</small></span><button style={{ ...btn, color: '#86efac' }} onClick={async () => { await decideGuardianConsent(request.consentId, true); await loadFamily(); }}>Approve</button><button style={{ ...btn, color: '#fca5a5' }} onClick={async () => { await decideGuardianConsent(request.consentId, false); await loadFamily(); }}>Decline</button></div>)}</div>}<select value={child?.id || ''} onChange={e => setChild(children.find(c => c.id === e.target.value) || null)} style={{ ...btn, marginBottom: 12 }}>{children.map(c => <option key={c.id} value={c.id}>{c.username}</option>)}</select>{!child ? <Empty text="Link a student account to begin." /> : selected ? <ParentClass cls={selected} child={child} back={() => setSelected(null)} /> : tab === 'classrooms' ? <ClassList rows={classes} open={setSelected} /> : tab === 'overview' ? <div style={card}><h3>{child.username}</h3><p>{classes.length} classrooms. Open Classrooms to see homework and live work.</p></div> : tab === 'progress' ? <Empty text="Progress is shown per classroom and homework." /> : <Empty text="No active classroom conversations." />}</Shell>;
}

export function UnifiedTAPage() {
  const { user, userData, loading } = useAuth(); const [, go] = useLocation(); const [tab, setTab] = useState('classrooms'); const [classes, setClasses] = useState<TeacherClass[]>([]);
  useEffect(() => { if (!loading && (!user || userData?.role !== 'teacher_assistant')) go('/auth'); if (user) void getStudentClasses(user.uid).then(r => setClasses(r.active.concat(r.archived))); }, [loading, user, userData]);
  return <Shell title="✏️ TA" color="#06b6d4" tabs={[{ id: 'classrooms', icon: '🏫', label: 'Classrooms' }, { id: 'parents', icon: '👨‍👩‍👧', label: 'Parent Reports' }]} active={tab} onTab={setTab}>{tab === 'classrooms' ? <ClassList rows={classes} open={() => undefined} /> : <Empty text="No parent reports." />}</Shell>;
}
