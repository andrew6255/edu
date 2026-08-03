import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTeacherClassesByTeacher,
  createTeacherClass,
  endTeacherClass,
  generateClassCode,
  getClassMembers,
  kickStudent,
  getClassSessions,
  createSession,
  getSessionSheets,
  createSheet,
  type TeacherClass,
  type ClassMember,
  type ClassCode,
  type ClassSession,
  type SessionSheet,
  type SheetType,
} from '@/lib/classroomService';
import ClassroomWorkspace from '@/components/ClassroomWorkspace';

const COLOR = '#10b981';
const COLOR_DIM = '#10b98155';

const cardStyle: React.CSSProperties = {
  background: '#1e293b', borderRadius: 10, border: '1px solid #334155', padding: '16px',
};

// ─── Basic Loader & Empty States ───
const Loader = ({ msg }: { msg?: string }) => <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading... {msg && <div style={{fontSize: 11, marginTop: 4}}>{msg}</div>}</div>;
const Empty = ({ icon, text }: { icon: string, text: string }) => (
  <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', background: 'rgba(0,0,0,0.2)', borderRadius: 12, border: '1px dashed #334155' }}>
    <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
    <div>{text}</div>
  </div>
);

// ─── Modal ───
const Modal = ({ title, onClose, children }: { title: string, onClose: () => void, children: React.ReactNode }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
    <div style={{ background: '#1e293b', border: '1px solid #475569', borderRadius: 12, padding: 20, width: '90%', maxWidth: 400, boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: 'white' }}>{title}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>&times;</button>
      </div>
      {children}
    </div>
  </div>
);

export default function TeacherClassroomView() {
  const { userData } = useAuth();
  
  // Navigation State
  const [activeClass, setActiveClass] = useState<TeacherClass | null>(null);
  const [activeSession, setActiveSession] = useState<ClassSession | null>(null);
  const [activeSheet, setActiveSheet] = useState<SessionSheet | null>(null);

  // Data State
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [debugMsg, setDebugMsg] = useState('Initializing...');

  useEffect(() => {
    if (userData?.uid) {
      setDebugMsg('User found, calling loadClasses...');
      loadClasses();
    } else {
      setDebugMsg('No userData.uid found.');
    }
  }, [userData?.uid]);

  async function loadClasses() {
    setLoading(true);
    setDebugMsg('loadClasses called, fetching...');
    try {
      const cls = await getTeacherClassesByTeacher(userData!.uid);
      setDebugMsg('Fetched ' + cls.length + ' classes.');
      setClasses(cls);
      setLoading(false);
    } catch (err: any) {
      console.error(err);
      setDebugMsg('Error: ' + err?.message);
      setLoading(false);
    }
  }

  // ─── Workspace View ───
  if (activeSheet && activeSession && activeClass) {
    return (
      <ClassroomWorkspace
        sheet={activeSheet}
        session={activeSession}
        onClose={() => setActiveSheet(null)}
      />
    );
  }

  // ─── Session Detail View ───
  if (activeSession && activeClass) {
    return (
      <SessionDetailView
        session={activeSession}
        cls={activeClass}
        onBack={() => setActiveSession(null)}
        onOpenSheet={setActiveSheet}
      />
    );
  }

  // ─── Class Detail View ───
  if (activeClass) {
    return (
      <ClassDetailView
        cls={activeClass}
        onBack={() => setActiveClass(null)}
        onOpenSession={setActiveSession}
        onClassUpdated={loadClasses}
      />
    );
  }

  // ─── Dashboard View ───
  return (
    <div style={{ padding: '0 20px 40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: 'white', margin: 0 }}>My Classrooms</h2>
        <CreateClassButton onCreated={loadClasses} />
      </div>

      {loading ? <Loader msg={debugMsg} /> : classes.length === 0 ? <Empty icon="🏫" text="You haven't created any classrooms yet." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {classes.map(cls => (
            <div key={cls.id} onClick={() => setActiveClass(cls)}
              style={{ ...cardStyle, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, transition: 'transform 0.1s', border: `1px solid ${cls.status === 'ended' ? '#334155' : COLOR_DIM}` }}
              onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseOut={e => e.currentTarget.style.transform = 'none'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 'bold', color: 'white', fontSize: 16 }}>{cls.name}</div>
                {cls.status === 'ended' && <span style={{ fontSize: 10, background: '#475569', color: 'white', padding: '2px 6px', borderRadius: 4 }}>Ended</span>}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 13 }}>{cls.subject}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE CLASS BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
function CreateClassButton({ onCreated }: { onCreated: () => void }) {
  const { userData } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !subject.trim()) return;
    setLoading(true);
    try {
      await createTeacherClass(userData!.uid, userData!.username, name.trim(), subject.trim());
      setOpen(false);
      setName(''); setSubject('');
      onCreated();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} style={{ background: COLOR, color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
        + New Classroom
      </button>
      {open && (
        <Modal title="Create Classroom" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input placeholder="Classroom Name (e.g. Math 101)" value={name} onChange={e => setName(e.target.value)}
              style={{ padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
            <input placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)}
              style={{ padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
            <button onClick={handleCreate} disabled={loading} style={{ background: COLOR, color: 'white', border: 'none', padding: '10px', borderRadius: 6, fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', marginTop: 8 }}>
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASS DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function ClassDetailView({ cls, onBack, onOpenSession, onClassUpdated }: { cls: TeacherClass, onBack: () => void, onOpenSession: (s: ClassSession) => void, onClassUpdated: () => void }) {
  const [tab, setTab] = useState<'sessions' | 'students'>('sessions');
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [cls]);

  async function loadData() {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([getClassSessions(cls.id), getClassMembers(cls.id)]);
      setSessions(s);
      setMembers(m);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  const activeMembers = members.filter(m => !m.kickedAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <button onClick={onBack} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', marginBottom: 12 }}>← Back to Classrooms</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ color: 'white', margin: 0 }}>{cls.name}</h2>
            {cls.status === 'ended' && <span style={{ fontSize: 11, background: '#475569', color: 'white', padding: '2px 8px', borderRadius: 4 }}>Ended</span>}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{cls.subject}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {cls.status === 'active' && <GenerateCodeButton classId={cls.id} />}
          {cls.status === 'active' && (
            <button onClick={async () => {
              if (confirm('Are you sure you want to end this class? Students will retain access to old sessions, but you cannot create new ones.')) {
                await endTeacherClass(cls.id);
                onClassUpdated();
                onBack();
              }
            }} style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
              End Class
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #334155', paddingBottom: 8 }}>
        <button onClick={() => setTab('sessions')} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: tab === 'sessions' ? `${COLOR}22` : 'transparent', color: tab === 'sessions' ? COLOR : '#94a3b8', fontWeight: 'bold', cursor: 'pointer' }}>
          Sessions ({sessions.length})
        </button>
        <button onClick={() => setTab('students')} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: tab === 'students' ? `${COLOR}22` : 'transparent', color: tab === 'students' ? COLOR : '#94a3b8', fontWeight: 'bold', cursor: 'pointer' }}>
          Students ({activeMembers.length})
        </button>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? <Loader /> : tab === 'sessions' ? (
          <div>
            {cls.status === 'active' && (
              <div style={{ marginBottom: 16 }}>
                <CreateSessionButton cls={cls} members={activeMembers} onCreated={loadData} />
              </div>
            )}
            {sessions.length === 0 ? <Empty icon="📝" text="No sessions yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sessions.map(s => (
                  <div key={s.id} onClick={() => onOpenSession(s)} style={{ ...cardStyle, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseOver={e => e.currentTarget.style.borderColor = COLOR_DIM} onMouseOut={e => e.currentTarget.style.borderColor = '#334155'}>
                    <div>
                      <div style={{ color: 'white', fontWeight: 'bold', fontSize: 15, marginBottom: 4 }}>{s.name}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>{new Date(s.date).toLocaleDateString()} · {s.participantIds.length} participants</div>
                    </div>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: s.status === 'active' ? '#10b98122' : s.status === 'scheduled' ? '#f59e0b22' : '#47556955',
                      color: s.status === 'active' ? '#10b981' : s.status === 'scheduled' ? '#f59e0b' : '#94a3b8',
                      border: `1px solid ${s.status === 'active' ? '#10b98155' : s.status === 'scheduled' ? '#f59e0b55' : '#475569'}`
                    }}>
                      {s.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            {activeMembers.length === 0 ? <Empty icon="👥" text="No students have joined yet." /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {activeMembers.map(m => (
                  <div key={m.userId} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
                    <div>
                      <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{m.fullName || m.username}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>@{m.username} · Joined {new Date(m.joinedAt).toLocaleDateString()}</div>
                    </div>
                    {cls.status === 'active' && (
                      <button onClick={async () => {
                        if (confirm(`Kick ${m.username} from this class?`)) {
                          await kickStudent(cls.id, m.userId);
                          loadData();
                        }
                      }} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#f87171', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Kick</button>
                    )}
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

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE CODE BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
function GenerateCodeButton({ classId }: { classId: string }) {
  const { userData } = useAuth();
  const [code, setCode] = useState<ClassCode | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  const generate = async () => {
    const c = await generateClassCode(classId, userData!.uid);
    setCode(c);
  };

  useEffect(() => {
    if (!code) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(code.expiresAt).getTime() - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) setCode(null);
    }, 1000);
    return () => clearInterval(interval);
  }, [code]);

  return (
    <>
      <button onClick={generate} style={{ background: 'transparent', color: COLOR, border: `1px solid ${COLOR}`, padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
        Generate Join Code
      </button>
      {code && (
        <Modal title="Class Join Code" onClose={() => setCode(null)}>
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 14, color: '#94a3b8', marginBottom: 12 }}>Students can use this code to join the class.</div>
            <div style={{ fontSize: 48, fontWeight: 'bold', letterSpacing: 8, color: 'white', background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: 12, marginBottom: 20 }}>
              {code.code}
            </div>
            <div style={{ color: timeLeft <= 10 ? '#ef4444' : '#f59e0b', fontWeight: 'bold' }}>
              Expires in {timeLeft}s
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE SESSION BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
function CreateSessionButton({ cls, members, onCreated }: { cls: TeacherClass, members: ClassMember[], onCreated: () => void }) {
  const { userData } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(members.map(m => m.userId)));
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || selectedIds.size === 0) return;
    setLoading(true);
    try {
      await createSession(
        cls.id, name.trim(), new Date().toISOString(), 'active', Array.from(selectedIds), userData!.uid
      );
      setOpen(false);
      setName('');
      onCreated();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button onClick={() => { setOpen(true); setSelectedIds(new Set(members.map(m => m.userId))); }} style={{ background: COLOR, color: 'white', border: 'none', padding: '8px 16px', borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' }}>
        + New Session
      </button>
      {open && (
        <Modal title="Create Session" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input placeholder="Session Name (e.g. Week 1 Worksheet)" value={name} onChange={e => setName(e.target.value)}
              style={{ padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
            
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8 }}>Select Participants ({selectedIds.size}/{members.length})</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', border: '1px solid #334155', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {members.length === 0 ? <div style={{ color: '#64748b', fontSize: 12, padding: 4 }}>No students in class.</div> : members.map(m => (
                <label key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'white', fontSize: 13, cursor: 'pointer', padding: '4px 8px', borderRadius: 4, background: selectedIds.has(m.userId) ? `${COLOR}22` : 'transparent' }}>
                  <input type="checkbox" checked={selectedIds.has(m.userId)} onChange={e => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) next.add(m.userId); else next.delete(m.userId);
                    setSelectedIds(next);
                  }} style={{ accentColor: COLOR }} />
                  {m.fullName || m.username}
                </label>
              ))}
            </div>

            <button onClick={handleCreate} disabled={loading || selectedIds.size === 0} style={{ background: COLOR, color: 'white', border: 'none', padding: '10px', borderRadius: 6, fontWeight: 'bold', cursor: (loading || selectedIds.size === 0) ? 'not-allowed' : 'pointer', marginTop: 8, opacity: selectedIds.size === 0 ? 0.5 : 1 }}>
              {loading ? 'Creating...' : 'Start Session Now'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function SessionDetailView({ session, cls, onBack, onOpenSheet }: { session: ClassSession, cls: TeacherClass, onBack: () => void, onOpenSheet: (s: SessionSheet) => void }) {
  const [sheets, setSheets] = useState<SessionSheet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [session]);

  async function loadData() {
    setLoading(true);
    try {
      const res = await getSessionSheets(session.id, '', 'teacher'); // user id doesn't matter for teacher
      setSheets(res);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <button onClick={onBack} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', marginBottom: 12 }}>← Back to {cls.name}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ color: 'white', margin: 0 }}>{session.name}</h2>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: session.status === 'active' ? '#10b98122' : session.status === 'scheduled' ? '#f59e0b22' : '#47556955', color: session.status === 'active' ? '#10b981' : session.status === 'scheduled' ? '#f59e0b' : '#94a3b8', border: `1px solid ${session.status === 'active' ? '#10b98155' : session.status === 'scheduled' ? '#f59e0b55' : '#475569'}` }}>
              {session.status.toUpperCase()}
            </span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{new Date(session.date).toLocaleDateString()} · {session.participantIds.length} participants</div>
        </div>
        <div>
          {session.status === 'active' && <CreateSheetButton session={session} onCreated={loadData} />}
        </div>
      </div>

      <h3 style={{ color: 'white', fontSize: 16, marginBottom: 12, borderBottom: '1px solid #334155', paddingBottom: 8 }}>Worksheets</h3>

      {loading ? <Loader /> : sheets.length === 0 ? <Empty icon="📄" text="No sheets created yet." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {sheets.map(s => (
            <div key={s.id} onClick={() => onOpenSheet(s)} style={{ ...cardStyle, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16, transition: 'transform 0.1s' }}
              onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseOut={e => e.currentTarget.style.transform = 'none'}>
              <div style={{ fontSize: 32 }}>
                {s.type === 'group' ? '👨‍👩‍👧‍👦' : s.type === 'individual' ? '👤' : '🔒'}
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 15, marginBottom: 4 }}>{s.name}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'capitalize' }}>{s.type} Sheet</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE SHEET BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
function CreateSheetButton({ session, onCreated }: { session: ClassSession, onCreated: () => void }) {
  const { userData } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<SheetType>('group');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createSheet(session.id, session.classId, name.trim(), type, userData!.uid, 'teacher', userData!.uid);
      setOpen(false);
      setName('');
      setType('group');
      onCreated();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} style={{ background: 'transparent', color: COLOR, border: `1px solid ${COLOR}`, padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
        + Add Sheet
      </button>
      {open && (
        <Modal title="Create Worksheet" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>Sheet Name</div>
              <input placeholder="e.g. Geometry Exercise" value={name} onChange={e => setName(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>Sheet Type</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8, border: `1px solid ${type === 'group' ? COLOR : '#334155'}`, cursor: 'pointer' }}>
                  <input type="radio" checked={type === 'group'} onChange={() => setType('group')} style={{ accentColor: COLOR }} />
                  <div>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Group Sheet</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>One big sheet. Everyone draws in their own section.</div>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8, border: `1px solid ${type === 'individual' ? COLOR : '#334155'}`, cursor: 'pointer' }}>
                  <input type="radio" checked={type === 'individual'} onChange={() => setType('individual')} style={{ accentColor: COLOR }} />
                  <div>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Individual Sheet</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>Each student gets their own layer. Teacher can see all.</div>
                  </div>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(0,0,0,0.2)', padding: '10px 12px', borderRadius: 8, border: `1px solid ${type === 'personal' ? COLOR : '#334155'}`, cursor: 'pointer' }}>
                  <input type="radio" checked={type === 'personal'} onChange={() => setType('personal')} style={{ accentColor: COLOR }} />
                  <div>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>Personal Sheet</div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>Private to you. Students cannot see this.</div>
                  </div>
                </label>
              </div>
            </div>

            <button onClick={handleCreate} disabled={loading || !name.trim()} style={{ background: COLOR, color: 'white', border: 'none', padding: '10px', borderRadius: 6, fontWeight: 'bold', cursor: (loading || !name.trim()) ? 'not-allowed' : 'pointer', marginTop: 8, opacity: !name.trim() ? 0.5 : 1 }}>
              {loading ? 'Creating...' : 'Create Sheet'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
