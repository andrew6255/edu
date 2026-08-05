import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  createSheet,
  deleteStudentClassMembership,
  getSessionSheets,
  getStudentClasses,
  getStudentSessions,
  joinTeacherByStudentCode,
  type ClassSession,
  type SessionSheet,
  type TeacherClass,
} from '@/lib/classroomService';
import ClassroomWorkspace from '@/components/ClassroomWorkspace';
import ClassroomHomeworkView from '@/components/classroom/ClassroomHomeworkView';

const COLOR = '#10b981';
const card: React.CSSProperties = { background: '#1e293b', borderRadius: 10, border: '1px solid #334155' };
const button: React.CSSProperties = { border: '1px solid #475569', borderRadius: 7, padding: '8px 12px', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontWeight: 'bold' };

interface ClassesViewProps {
  pendingContentId?: string | null;
  pendingContentType?: string | null;
  onPendingHandled?: () => void;
}

export default function ClassesView({ pendingContentId, pendingContentType, onPendingHandled }: ClassesViewProps = {}) {
  const { user, userData } = useAuth();
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [active, setActive] = useState<TeacherClass[]>([]);
  const [archived, setArchived] = useState<TeacherClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [classroom, setClassroom] = useState<TeacherClass | null>(null);
  const [classroomTab, setClassroomTab] = useState<'sessions' | 'homeworks'>('sessions');
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [session, setSession] = useState<ClassSession | null>(null);
  const [sheets, setSheets] = useState<SessionSheet[]>([]);
  const [sheet, setSheet] = useState<SessionSheet | null>(null);

  useEffect(() => { if (user) void load(); }, [user?.uid]);
  useEffect(() => { if (pendingContentId || pendingContentType) onPendingHandled?.(); }, [pendingContentId, pendingContentType, onPendingHandled]);

  async function load() {
    if (!user) return;
    setLoading(true);
    try { const result = await getStudentClasses(user.uid); setActive(result.active); setArchived(result.archived); }
    catch (error) { console.error(error); }
    finally { setLoading(false); }
  }

  async function addTeacher() {
    if (!user || !userData || !joinCode.trim()) return;
    setJoining(true);
    try {
      const result = await joinTeacherByStudentCode(joinCode.trim());
      if (!result) throw new Error('Invalid or expired teacher code.');
      toast({ title: 'Teacher added', description: `You were added to ${result.teacherName}'s student list. The teacher can now add you to a classroom.` });
      setJoinCode(''); setJoinOpen(false);
    } catch (error) { toast({ variant: 'destructive', description: error instanceof Error ? error.message : 'Could not add teacher.' }); }
    finally { setJoining(false); }
  }

  async function openClassroom(next: TeacherClass) {
    if (!user) return;
    setClassroom(next); setClassroomTab('sessions'); setSession(null); setSheet(null);
    try { setSessions(await getStudentSessions(user.uid, next.id)); }
    catch (error) { console.error(error); setSessions([]); }
  }

  async function openSession(next: ClassSession) {
    if (!user || next.status === 'scheduled') return;
    setSession(next); setSheet(null);
    try { setSheets(await getSessionSheets(next.id, user.uid, 'student')); }
    catch (error) { console.error(error); setSheets([]); }
  }

  async function createPersonalSheet() {
    if (!user || !session) return;
    try {
      const created = await createSheet(session.id, session.classId, 'My Private Notes', 'personal', user.uid, 'student', user.uid);
      setSheets(current => [...current, created]); setSheet(created);
    } catch { toast({ variant: 'destructive', description: 'Could not create the sheet.' }); }
  }

  if (sheet && session) return <ClassroomWorkspace sheet={sheet} session={session} onClose={() => setSheet(null)} />;

  if (session && classroom) return <Panel><Header title={session.name} subtitle={`${new Date(session.date).toLocaleString()} · ${session.status}`} onBack={() => setSession(null)} />
    <div className="app-scroll" style={{ flex: 1, padding: 18 }}>
      {session.status === 'active' && <button onClick={() => void createPersonalSheet()} style={{ ...button, color: COLOR, borderColor: COLOR, marginBottom: 14 }}>+ Personal notes</button>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(250px,100%),1fr))', gap: 10 }}>{sheets.length ? sheets.map(item => <button key={item.id} onClick={() => setSheet(item)} style={{ ...card, padding: 15, color: 'white', textAlign: 'left', cursor: 'pointer' }}><strong>{item.type === 'group' ? '👥' : item.type === 'individual' ? '👤' : '🔒'} {item.name}</strong><small style={{ display: 'block', color: '#94a3b8', marginTop: 4 }}>{item.type} sheet</small></button>) : <Empty text="No sheets are available in this session." />}</div>
    </div></Panel>;

  if (classroom) return <Panel><Header title={classroom.name} subtitle={`${classroom.subjectEmoji || '📘'} ${classroom.subject} · ${classroom.teacherName}`} onBack={() => setClassroom(null)} />
    <div style={{ display: 'flex', borderBottom: '1px solid #334155', paddingInline: 14 }}><Tab active={classroomTab === 'sessions'} onClick={() => setClassroomTab('sessions')}>Sessions</Tab><Tab active={classroomTab === 'homeworks'} onClick={() => setClassroomTab('homeworks')}>Homework</Tab></div>
    <div className="app-scroll" style={{ flex: 1, padding: 18 }}>{classroomTab === 'homeworks' ? <ClassroomHomeworkView classId={classroom.id} role="student" /> : <div style={{ display: 'grid', gap: 9 }}>{sessions.length ? sessions.map(item => <button key={item.id} disabled={item.status === 'scheduled'} onClick={() => void openSession(item)} style={{ ...card, padding: 15, color: 'white', textAlign: 'left', cursor: item.status === 'scheduled' ? 'not-allowed' : 'pointer', opacity: item.status === 'scheduled' ? .65 : 1 }}><strong>{item.name}</strong><small style={{ display: 'block', color: '#94a3b8', marginTop: 4 }}>{new Date(item.date).toLocaleString()} · {item.status}</small></button>) : <Empty text="No sessions are available." />}</div>}</div>
  </Panel>;

  return <Panel><div style={{ padding: 16, background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 10 }}><h2 style={{ margin: 0, color: 'white', flex: 1, fontSize: 18 }}>🏫 My Classrooms</h2><button onClick={() => setJoinOpen(true)} style={{ ...button, background: COLOR, borderColor: COLOR, color: 'white' }}>+ Add teacher</button></div>
    <div className="app-scroll" style={{ flex: 1, padding: 18 }}>
      {loading ? <div style={{ color: '#94a3b8' }}>Loading classrooms…</div> : <ClassGrid rows={active} open={openClassroom} empty="Your teacher has not added you to a classroom yet." />}
      {archived.length > 0 && <div style={{ marginTop: 20 }}><button onClick={() => setShowArchived(value => !value)} style={button}>{showArchived ? '▼' : '▶'} Archived ({archived.length})</button>{showArchived && <div style={{ marginTop: 10 }}><ClassGrid rows={archived} open={openClassroom} empty="" onDelete={async row => { if (!user || !(await confirm(`Remove “${row.name}” from your history?`, 'Remove Classroom'))) return; await deleteStudentClassMembership(row.id, user.uid); await load(); }} /></div>}</div>}
    </div>
    {joinOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'grid', placeItems: 'center', padding: 14 }}><div className="phone-modal" style={{ ...card, width: 'min(340px,100%)', padding: 18 }}><h3 style={{ marginTop: 0, color: 'white' }}>Add a teacher</h3><p style={{ color: '#94a3b8', fontSize: 12 }}>Enter the one-minute code from your teacher. This adds you to their student list; they choose which classroom to add you to.</p><input value={joinCode} onChange={event => setJoinCode(event.target.value)} inputMode="numeric" maxLength={6} aria-label="Teacher invite code" style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 7, border: '1px solid #475569', background: '#0f172a', color: 'white', fontSize: 20, letterSpacing: 4, textAlign: 'center' }} /><div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button onClick={() => setJoinOpen(false)} style={{ ...button, flex: 1 }}>Cancel</button><button disabled={joining || !joinCode.trim()} onClick={() => void addTeacher()} style={{ ...button, flex: 1, background: COLOR, borderColor: COLOR, color: 'white' }}>{joining ? 'Adding…' : 'Add'}</button></div></div></div>}
  </Panel>;
}

function Panel({ children }: { children: React.ReactNode }) { return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0, background: '#0f172a' }}>{children}</div>; }
function Header({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) { return <div className="phone-wrap" style={{ padding: 14, background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', gap: 10, alignItems: 'center' }}><button onClick={onBack} style={button}>← Back</button><div style={{ minWidth: 0 }}><h3 style={{ margin: 0, color: 'white' }}>{title}</h3><small style={{ color: '#94a3b8' }}>{subtitle}</small></div></div>; }
function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} style={{ padding: '11px 15px', border: 0, borderBottom: `2px solid ${active ? COLOR : 'transparent'}`, background: 'transparent', color: active ? COLOR : '#94a3b8', fontWeight: 'bold' }}>{children}</button>; }
function Empty({ text }: { text: string }) { return <div style={{ ...card, color: '#64748b', padding: 30, textAlign: 'center' }}>{text}</div>; }
function ClassGrid({ rows, open, empty, onDelete }: { rows: TeacherClass[]; open: (row: TeacherClass) => void; empty: string; onDelete?: (row: TeacherClass) => void }) { return rows.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(270px,100%),1fr))', gap: 11 }}>{rows.map(row => <div key={row.id} style={{ ...card, padding: 15 }}><button onClick={() => open(row)} style={{ width: '100%', border: 0, background: 'transparent', color: 'white', textAlign: 'left', cursor: 'pointer', padding: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{row.name}</strong><span style={{ textAlign: 'right' }}>{row.subjectEmoji || '📘'} {row.subject}</span></div><small style={{ color: '#94a3b8', display: 'block', marginTop: 6 }}>{row.teacherName} · {row.status}</small></button>{onDelete && <button onClick={() => void onDelete(row)} style={{ ...button, color: '#f87171', marginTop: 10 }}>Remove</button>}</div>)}</div> : <Empty text={empty} />; }
