import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { performSignOut } from '@/lib/authService';
import { getAssignedTeacherStudents, type TeacherUserRow } from '@/lib/teacherService';
import { createTeacherStudentReport, generateTeacherStudentCode, listTeacherStudentReports, removeTeacherStudent, type TeacherStudentCode, type TeacherStudentReport } from '@/lib/classroomService';
import SettingsLauncher from '@/components/settings/SettingsLauncher';
import TeacherClassroomView from '@/views/TeacherClassroomView';
import { useConfirm } from '@/contexts/ConfirmContext';

const COLOR = '#10b981';
const COLOR_DIM = '#10b98155';

type TeacherTab = 'classrooms' | 'users';

const cardStyle: React.CSSProperties = {
  background: '#1e293b',
  borderRadius: 10,
  border: '1px solid #334155',
};

const teacherTabs = [
  { id: 'classrooms', icon: '🏫', label: 'Classrooms' },
  { id: 'users', icon: '👥', label: 'Students' },
] as const;

export default function TeacherPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();
  const { confirm } = useConfirm();
  const [activeTab, setActiveTab] = useState<TeacherTab>('classrooms');
  const [allUsers, setAllUsers] = useState<TeacherUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [reportStudent, setReportStudent] = useState<TeacherUserRow | null>(null);

  useEffect(() => {
    if (!loading && (!user || userData?.role !== 'teacher')) setLocation('/auth');
  }, [loading, setLocation, user, userData]);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      setAllUsers(await getAssignedTeacherStudents(user!.uid));
      setUsersLoaded(true);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingUsers(false);
    }
  }

  function switchTab(tab: TeacherTab) {
    setActiveTab(tab);
    if (tab === 'users' && !usersLoaded && !loadingUsers) void loadUsers();
  }

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    if (!query) return allUsers;
    return allUsers.filter((entry) =>
      entry.username.toLowerCase().includes(query)
      || entry.email.toLowerCase().includes(query)
      || entry.first_name.toLowerCase().includes(query)
      || entry.last_name.toLowerCase().includes(query)
      || entry.class_names.some((className) => className.toLowerCase().includes(query))
    );
  }, [allUsers, userSearch]);

  if (loading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8' }}>
        <SettingsLauncher compact />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📖</div>
          <div>Loading teacher panel...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-viewport" style={{ display: 'flex', flexDirection: 'column', background: '#0f172a', color: 'white' }}>
      <header className="app-safe-header" style={{ paddingBottom: 10, background: '#1e293b', borderBottom: `2px solid ${COLOR}`, flexShrink: 0 }}>
        <div className="phone-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📖</span>
            Teacher
            <span style={{ fontSize: 11, background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, borderRadius: 6, padding: '2px 8px', fontWeight: 'normal' }}>
              {userData?.username || 'teacher'}
            </span>
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SettingsLauncher compact inline />
          <button
            onClick={() => void performSignOut()}
            style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}
          >
            Sign Out
          </button>
          </div>
        </div>
      </header>

      <main className="app-scroll" style={{ flex: 1, padding: 18 }}>
        {activeTab === 'classrooms' && <TeacherClassroomView />}

        {activeTab === 'users' && reportStudent && user && (
          <StudentReportsPage student={reportStudent} teacherId={user.uid} onBack={() => setReportStudent(null)} />
        )}

        {activeTab === 'users' && !reportStudent && (
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>My Students</h2>
                <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>Students assigned by an admin or added with your invite code.</div>
              </div>
              <AddStudentButton onAdded={() => void loadUsers()} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <input
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Search users or classrooms..."
                aria-label="Search users"
                style={{ flex: 1, minWidth: 0, padding: '10px 13px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
              />
              <button
                onClick={() => void loadUsers()}
                disabled={loadingUsers}
                style={{ padding: '10px 13px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #475569', color: '#94a3b8', cursor: loadingUsers ? 'wait' : 'pointer' }}
              >
                ↺ Refresh
              </button>
            </div>

            {loadingUsers ? <Loader /> : filteredUsers.length === 0 ? (
              <Empty icon="👥" text={userSearch ? 'No users match your search.' : 'No students or TAs yet.'} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {filteredUsers.map((entry) => {
                  const role = entry.role === 'teacher_assistant'
                    ? { label: 'TA', color: '#06b6d4' }
                    : { label: 'Student', color: '#3b82f6' };
                  return (
                    <div key={entry.user_id} style={{ ...cardStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: `hsl(${(entry.username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`, display: 'grid', placeItems: 'center', fontWeight: 'bold', fontSize: 13 }}>
                        {(entry.username[0] || '?').toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 'bold', fontSize: 13 }}>{entry.username || `${entry.first_name} ${entry.last_name}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          <span>{entry.email}</span>
                          {entry.class_names.map((className) => (
                            <span key={className} style={{ background: '#0f172a', padding: '0 5px', borderRadius: 3, fontSize: 10 }}>{className}</span>
                          ))}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5, background: `${role.color}22`, border: `1px solid ${role.color}55`, color: role.color }}>
                        {role.label}
                      </span>
                      <button onClick={() => setReportStudent(entry)} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${COLOR_DIM}`, background: `${COLOR}15`, color: COLOR, cursor: 'pointer', fontWeight: 'bold', fontSize: 11 }}>Reports</button>
                      <button onClick={async () => { if (user && await confirm(`Remove ${entry.username || entry.first_name} from your student list and classrooms?`, 'Remove Student')) { await removeTeacherStudent(user.uid, entry.user_id); await loadUsers(); } }} style={{ padding: '6px 9px', borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', color: '#f87171', cursor: 'pointer', fontWeight: 'bold', fontSize: 11 }}>Remove</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      <nav aria-label="Teacher sections" style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', background: 'rgba(15, 23, 42, 0.96)', borderTop: '1px solid #334155', paddingTop: 8, paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))', zIndex: 10, flexShrink: 0, backdropFilter: 'blur(10px)' }}>
        {teacherTabs.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              aria-current={selected ? 'page' : undefined}
              style={{ flex: 1, background: 'none', border: 'none', color: selected ? COLOR : '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', transition: '0.2s', fontFamily: 'inherit', padding: '4px 0', outline: 'none' }}
            >
              <span style={{ fontSize: 22, transition: 'transform 0.2s', transform: selected ? 'translateY(-3px) scale(1.1)' : 'none', filter: selected ? 'none' : 'grayscale(1) opacity(0.6)' }}>
                {tab.icon}
              </span>
              <span style={{ fontSize: 10, fontWeight: 'bold' }}>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function StudentReportsPage({ student, teacherId, onBack }: { student: TeacherUserRow; teacherId: string; onBack: () => void }) {
  const [reports, setReports] = useState<TeacherStudentReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [report, setReport] = useState('');

  async function loadReports() {
    setLoadingReports(true);
    try { setReports(await listTeacherStudentReports(teacherId, student.user_id)); }
    finally { setLoadingReports(false); }
  }
  useEffect(() => { void loadReports(); }, [teacherId, student.user_id]);

  async function saveReport() {
    if (!title.trim() || !report.trim()) return;
    setCreating(true);
    try {
      await createTeacherStudentReport(teacherId, student.user_id, title, report);
      setTitle(''); setReport('');
      await loadReports();
    } finally { setCreating(false); }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <button onClick={onBack} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', cursor: 'pointer', marginBottom: 16 }}>← Back to Students</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
        <div><h2 style={{ margin: 0 }}>Reports — {student.username || student.first_name}</h2><div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Newest reports appear first.</div></div>
      </div>
      <div style={{ ...cardStyle, padding: 14, marginBottom: 18 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>Add Report</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Report title" style={{ padding: 9, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
          <textarea value={report} onChange={event => setReport(event.target.value)} placeholder="Write the student report..." rows={5} style={{ padding: 9, borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: 'white', resize: 'vertical', fontFamily: 'inherit' }} />
          <button onClick={() => void saveReport()} disabled={creating || !title.trim() || !report.trim()} style={{ alignSelf: 'flex-end', padding: '8px 14px', borderRadius: 6, border: 'none', background: COLOR, color: 'white', fontWeight: 'bold', cursor: creating ? 'wait' : 'pointer' }}>{creating ? 'Saving...' : 'Add Report'}</button>
        </div>
      </div>
      {loadingReports ? <Loader /> : reports.length === 0 ? <Empty icon="📋" text="No reports for this student yet." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reports.map(item => <article key={item.id} style={{ ...cardStyle, padding: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{item.title}</strong><time style={{ color: '#64748b', fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(item.createdAt).toLocaleString()}</time></div><div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 9, whiteSpace: 'pre-wrap' }}>{item.report}</div></article>)}
        </div>
      )}
    </div>
  );
}

function AddStudentButton({ onAdded }: { onAdded: () => void }) {
  const { user, userData } = useAuth();
  const [invite, setInvite] = useState<TeacherStudentCode | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!invite) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) { setInvite(null); onAdded(); }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [invite, onAdded]);

  async function generate() {
    if (!user) return;
    setGenerating(true);
    try { setInvite(await generateTeacherStudentCode(user.uid, userData?.username || 'Teacher')); }
    finally { setGenerating(false); }
  }

  return (
    <>
      <button onClick={() => void generate()} disabled={generating} style={{ background: COLOR, color: 'white', border: 'none', padding: '9px 14px', borderRadius: 8, fontWeight: 'bold', cursor: generating ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
        + Add New Students
      </button>
      {invite && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 100, display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ ...cardStyle, width: 'min(360px, 100%)', padding: 22, textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 8px' }}>Student Invite Code</h3>
            <div style={{ color: '#94a3b8', fontSize: 13 }}>A student can enter this in their Classes panel. It adds them to your student list, not to a classroom.</div>
            <div style={{ fontSize: 44, fontWeight: 'bold', letterSpacing: 8, margin: '20px 0 12px', background: '#0f172a', borderRadius: 10, padding: 14 }}>{invite.code}</div>
            <div style={{ color: timeLeft <= 10 ? '#f87171' : '#f59e0b', fontWeight: 'bold', marginBottom: 16 }}>Expires in {timeLeft}s</div>
            <button onClick={() => { setInvite(null); onAdded(); }} style={{ width: '100%', padding: 9, borderRadius: 7, border: '1px solid #475569', background: 'transparent', color: 'white', cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      )}
    </>
  );
}

function Loader() {
  return <div style={{ textAlign: 'center', padding: 30, color: '#64748b' }}>Loading...</div>;
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
    </div>
  );
}
