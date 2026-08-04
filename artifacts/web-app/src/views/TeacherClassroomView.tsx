import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTeacherClassesByTeacher,
  createTeacherClass,
  renameTeacherClass,
  endTeacherClass,
  generateClassCode,
  getClassMembers,
  kickStudent,
  getClassSessions,
  createSession,
  updateSession,
  deleteSession,
  getSessionSheets,
  createSheet,
  renameSheet,
  deleteSheet,
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
  const { user, userData } = useAuth();
  
  // Navigation State
  const [activeClass, setActiveClass] = useState<TeacherClass | null>(null);
  const [activeSession, setActiveSession] = useState<ClassSession | null>(null);
  const [activeSheet, setActiveSheet] = useState<SessionSheet | null>(null);

  // Data State
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.uid) loadClasses();
  }, [user?.uid]);

  async function loadClasses() {
    setLoading(true);
    try {
      const cls = await getTeacherClassesByTeacher(user!.uid);
      setClasses(cls);
    } catch (err) {
      console.error(err);
    } finally {
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

      {loading ? <Loader /> : classes.length === 0 ? <Empty icon="🏫" text="You haven't created any classrooms yet." /> : (
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
  const { user, userData } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !subject.trim()) return;
    setLoading(true);
    try {
      await createTeacherClass(user!.uid, userData!.username, name.trim(), subject.trim());
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
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(cls.name);
  const [displayName, setDisplayName] = useState(cls.name);

  useEffect(() => { setDisplayName(cls.name); setNameDraft(cls.name); }, [cls.name]);
  useEffect(() => { loadData(); }, [cls]);

  async function saveRename() {
    const next = nameDraft.trim();
    if (!next || next === displayName) { setEditingName(false); return; }
    await renameTeacherClass(cls.id, next);
    setDisplayName(next);
    setEditingName(false);
    onClassUpdated();
  }

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
            {editingName ? (
              <>
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') { setNameDraft(displayName); setEditingName(false); } }}
                  style={{ fontSize: 20, fontWeight: 'bold', background: 'rgba(0,0,0,0.3)', border: '1px solid #475569', borderRadius: 6, color: 'white', padding: '4px 8px' }}
                />
                <button onClick={saveRename} style={{ background: COLOR, color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}>Save</button>
                <button onClick={() => { setNameDraft(displayName); setEditingName(false); }} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
              </>
            ) : (
              <>
                <h2 style={{ color: 'white', margin: 0 }}>{displayName}</h2>
                {cls.status === 'active' && (
                  <button onClick={() => setEditingName(true)} title="Rename class" style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14 }}>✏️</button>
                )}
              </>
            )}
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
                    <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 4,
                        background: s.status === 'active' ? '#10b98122' : s.status === 'scheduled' ? '#f59e0b22' : '#47556955',
                        color: s.status === 'active' ? '#10b981' : s.status === 'scheduled' ? '#f59e0b' : '#94a3b8',
                        border: `1px solid ${s.status === 'active' ? '#10b98155' : s.status === 'scheduled' ? '#f59e0b55' : '#475569'}`
                      }}>
                        {s.status.toUpperCase()}
                      </span>
                      {s.status === 'scheduled' && (
                        <button onClick={async e => { e.stopPropagation(); await updateSession(s.id, { status: 'active' }); loadData(); }}
                          style={{ background: 'transparent', border: '1px solid #10b981', color: '#10b981', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>Start</button>
                      )}
                      {s.status === 'active' && (
                        <button onClick={async e => {
                          e.stopPropagation();
                          if (confirm(`End session "${s.name}"? Sheets will become read-only for students (except personal sheets).`)) { await updateSession(s.id, { status: 'ended' }); loadData(); }
                        }} style={{ background: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 'bold' }}>End</button>
                      )}
                      <EditSessionButton session={s} members={activeMembers} onSaved={loadData} />
                      <button onClick={async e => {
                        e.stopPropagation();
                        if (confirm(`Delete session "${s.name}" and all its sheets? This cannot be undone.`)) { await deleteSession(s.id); loadData(); }
                      }} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#f87171', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Delete</button>
                    </div>
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
  const { user, userData } = useAuth();
  const [code, setCode] = useState<ClassCode | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  const generate = async () => {
    const c = await generateClassCode(classId, user!.uid);
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
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function CreateSessionButton({ cls, members, onCreated }: { cls: TeacherClass, members: ClassMember[], onCreated: () => void }) {
  const { user, userData } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayStr());
  const [startMode, setStartMode] = useState<'now' | 'schedule'>('now');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(members.map(m => m.userId)));
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || selectedIds.size === 0) return;
    setLoading(true);
    try {
      const status = startMode === 'now' ? 'active' : 'scheduled';
      const isoDate = startMode === 'now' ? new Date().toISOString() : new Date(date + 'T00:00:00').toISOString();
      await createSession(cls.id, name.trim(), isoDate, status, Array.from(selectedIds), user!.uid);
      setOpen(false);
      setName('');
      setDate(todayStr());
      setStartMode('now');
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

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStartMode('now')} style={{ flex: 1, padding: '8px', borderRadius: 6, border: `1px solid ${startMode === 'now' ? COLOR : '#334155'}`, background: startMode === 'now' ? `${COLOR}22` : 'transparent', color: startMode === 'now' ? COLOR : '#94a3b8', fontWeight: 'bold', cursor: 'pointer', fontSize: 12 }}>Start Now</button>
              <button onClick={() => setStartMode('schedule')} style={{ flex: 1, padding: '8px', borderRadius: 6, border: `1px solid ${startMode === 'schedule' ? COLOR : '#334155'}`, background: startMode === 'schedule' ? `${COLOR}22` : 'transparent', color: startMode === 'schedule' ? COLOR : '#94a3b8', fontWeight: 'bold', cursor: 'pointer', fontSize: 12 }}>Schedule</button>
            </div>
            {startMode === 'schedule' && (
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
            )}

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
              {loading ? 'Creating...' : startMode === 'now' ? 'Start Session Now' : 'Schedule Session'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EDIT SESSION BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
function EditSessionButton({ session, members, onSaved }: { session: ClassSession, members: ClassMember[], onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(session.name);
  const [date, setDate] = useState(session.date.slice(0, 10));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(session.participantIds));
  const [loading, setLoading] = useState(false);

  function openModal(e: React.MouseEvent) {
    e.stopPropagation();
    setName(session.name);
    setDate(session.date.slice(0, 10));
    setSelectedIds(new Set(session.participantIds));
    setOpen(true);
  }

  const handleSave = async () => {
    if (!name.trim() || selectedIds.size === 0) return;
    setLoading(true);
    try {
      await updateSession(session.id, {
        name: name.trim(),
        date: new Date(date + 'T00:00:00').toISOString(),
        participantIds: Array.from(selectedIds),
      });
      setOpen(false);
      onSaved();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button onClick={openModal} title="Edit session" style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Edit</button>
      {open && (
        <Modal title="Edit Session" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} onClick={e => e.stopPropagation()}>
            <input placeholder="Session Name" value={name} onChange={e => setName(e.target.value)}
              style={{ padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />

            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8 }}>Participants ({selectedIds.size}/{members.length})</div>
            <div style={{ maxHeight: 200, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', border: '1px solid #334155', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {members.map(m => (
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

            <button onClick={handleSave} disabled={loading || selectedIds.size === 0} style={{ background: COLOR, color: 'white', border: 'none', padding: '10px', borderRadius: 6, fontWeight: 'bold', cursor: (loading || selectedIds.size === 0) ? 'not-allowed' : 'pointer', marginTop: 8, opacity: selectedIds.size === 0 ? 0.5 : 1 }}>
              {loading ? 'Saving...' : 'Save Changes'}
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
  const [status, setStatus] = useState(session.status);

  useEffect(() => { setStatus(session.status); }, [session.status]);
  useEffect(() => { loadData(); }, [session.id]);

  async function loadData() {
    setLoading(true);
    try {
      const res = await getSessionSheets(session.id, '', 'teacher'); // user id doesn't matter for teacher
      setSheets(res);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleRenameSheet(sheet: SessionSheet) {
    const next = prompt('Rename sheet', sheet.name);
    if (!next || !next.trim() || next.trim() === sheet.name) return;
    await renameSheet(sheet.id, next.trim());
    loadData();
  }

  async function handleDeleteSheet(sheet: SessionSheet) {
    if (!confirm(`Delete sheet "${sheet.name}"? This cannot be undone.`)) return;
    await deleteSheet(sheet.id);
    loadData();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <button onClick={onBack} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', marginBottom: 12 }}>← Back to {cls.name}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ color: 'white', margin: 0 }}>{session.name}</h2>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: status === 'active' ? '#10b98122' : status === 'scheduled' ? '#f59e0b22' : '#47556955', color: status === 'active' ? '#10b981' : status === 'scheduled' ? '#f59e0b' : '#94a3b8', border: `1px solid ${status === 'active' ? '#10b98155' : status === 'scheduled' ? '#f59e0b55' : '#475569'}` }}>
              {status.toUpperCase()}
            </span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{new Date(session.date).toLocaleDateString()} · {session.participantIds.length} participants</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {status === 'scheduled' && (
            <button onClick={async () => { await updateSession(session.id, { status: 'active' }); setStatus('active'); }}
              style={{ background: COLOR, color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
              ▶ Start Session
            </button>
          )}
          {status === 'active' && (
            <button onClick={async () => {
              if (confirm('End this session? Group and individual sheets become read-only for students.')) { await updateSession(session.id, { status: 'ended' }); setStatus('ended'); }
            }} style={{ background: 'transparent', color: '#f59e0b', border: '1px solid #f59e0b', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
              ■ End Session
            </button>
          )}
          {status !== 'ended' && <CreateSheetButton session={session} onCreated={loadData} />}
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
              <div style={{ flex: 1 }}>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 15, marginBottom: 4 }}>{s.name}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, textTransform: 'capitalize' }}>{s.type} Sheet</div>
              </div>
              <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleRenameSheet(s)} title="Rename" style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>✏️</button>
                <button onClick={() => handleDeleteSheet(s)} title="Delete" style={{ background: 'transparent', border: '1px solid #ef444455', color: '#f87171', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>🗑️</button>
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
  const { user, userData } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<SheetType>('group');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await createSheet(session.id, session.classId, name.trim(), type, user!.uid, 'teacher', user!.uid);
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
