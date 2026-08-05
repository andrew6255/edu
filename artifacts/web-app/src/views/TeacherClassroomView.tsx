import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getTeacherClassesByTeacher,
  createTeacherClass,
  getTeacherClassNote,
  addClassMember,
  updateTeacherClassDetails,
  endTeacherClass,
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
  type ClassSession,
  type SessionSheet,
  type SheetType,
} from '@/lib/classroomService';
import { getAssignedTeacherStudents, type TeacherUserRow } from '@/lib/teacherService';
import { createPersonalSubject, listPersonalSubjects, type PersonalSubject } from '@/lib/personalSubjectService';
import ClassroomWorkspace from '@/components/ClassroomWorkspace';
import { useConfirm } from '@/contexts/ConfirmContext';
import ClassroomHomeworkView from '@/components/classroom/ClassroomHomeworkView';

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
  const { confirm } = useConfirm();
  
  // Navigation State
  const [activeClass, setActiveClass] = useState<TeacherClass | null>(null);
  const [activeSession, setActiveSession] = useState<ClassSession | null>(null);
  const [activeSheet, setActiveSheet] = useState<SessionSheet | null>(null);

  // Data State
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [classNotes, setClassNotes] = useState<Record<string, string>>({});
  const [subjectEmojis, setSubjectEmojis] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [managingClass, setManagingClass] = useState<TeacherClass | null>(null);
  const [editingClass, setEditingClass] = useState<TeacherClass | null>(null);

  useEffect(() => {
    if (user?.uid) loadClasses();
  }, [user?.uid]);

  async function loadClasses() {
    setLoading(true);
    try {
      const [cls, personalSubjects] = await Promise.all([
        getTeacherClassesByTeacher(user!.uid),
        listPersonalSubjects(user!.uid),
      ]);
      setClasses(cls);
      setSubjectEmojis(Object.fromEntries(personalSubjects.map(subject => [subject.name.trim().toLowerCase(), subject.emoji])));
      const notes = await Promise.all(cls.map(async classroom => [classroom.id, await getTeacherClassNote(classroom.id)] as const));
      setClassNotes(Object.fromEntries(notes));
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
      />
    );
  }

  // ─── Dashboard View ───
  return (
    <div style={{ padding: '0 20px 40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: 'white', margin: 0 }}>My Classrooms</h2>
        <CreateClassButton onCreated={async created => { await loadClasses(); setManagingClass(created); }} />
      </div>

      {loading ? <Loader /> : classes.length === 0 ? <Empty icon="🏫" text="You haven't created any classrooms yet." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {classes.map(cls => (
            <div key={cls.id} onClick={() => setActiveClass(cls)}
              style={{ ...cardStyle, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, transition: 'transform 0.1s', border: `1px solid ${cls.status === 'ended' ? '#334155' : COLOR_DIM}` }}
              onMouseOver={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseOut={e => e.currentTarget.style.transform = 'none'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 'bold', color: 'white', fontSize: 16 }}>{cls.name}</div>
                  {classNotes[cls.id] && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{classNotes[cls.id]}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                  <span style={{ color: '#cbd5e1', fontSize: 13, padding: '5px 8px', borderRadius: 7, background: '#0f172a', border: '1px solid #334155' }}>{cls.subjectEmoji || subjectEmojis[cls.subject.trim().toLowerCase()] || '📘'} {cls.subject}</span>
                  {cls.status === 'ended' && <span style={{ fontSize: 10, background: '#475569', color: 'white', padding: '2px 6px', borderRadius: 4 }}>Ended</span>}
                </div>
              </div>
              {cls.status === 'active' && (
                <div onClick={event => event.stopPropagation()} style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <button onClick={() => setEditingClass(cls)} style={{ flex: 1, padding: '7px 9px', borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontWeight: 'bold', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => setManagingClass(cls)} style={{ flex: 2, padding: '7px 9px', borderRadius: 6, border: `1px solid ${COLOR_DIM}`, background: `${COLOR}15`, color: COLOR, fontWeight: 'bold', cursor: 'pointer' }}>Manage Participants</button>
                  <button onClick={async () => { if (await confirm(`End "${cls.name}"? Students will keep access to previous sessions.`, 'End Classroom')) { await endTeacherClass(cls.id); await loadClasses(); } }} style={{ flex: 1, padding: '7px 9px', borderRadius: 6, border: '1px solid #ef4444', background: 'transparent', color: '#f87171', fontWeight: 'bold', cursor: 'pointer' }}>End Class</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {managingClass && <ManageParticipantsModal cls={managingClass} onClose={() => setManagingClass(null)} />}
      {editingClass && <EditClassModal cls={editingClass} onClose={() => setEditingClass(null)} onSaved={loadClasses} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREATE CLASS BUTTON
// ═══════════════════════════════════════════════════════════════════════════════
function CreateClassButton({ onCreated }: { onCreated: (created: TeacherClass) => void | Promise<void> }) {
  const { user, userData } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [subjects, setSubjects] = useState<PersonalSubject[]>([]);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !subject.trim()) return;
    setLoading(true);
    try {
      const emoji = subjects.find(item => item.name === subject)?.emoji ?? '📘';
      const created = await createTeacherClass(user!.uid, userData!.username, name.trim(), subject.trim(), note.trim(), emoji);
      setOpen(false);
      setName(''); setSubject(''); setNote('');
      await onCreated(created);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <>
      <button onClick={async () => { setOpen(true); if (user) setSubjects(await listPersonalSubjects(user.uid)); }} style={{ background: COLOR, color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer' }}>
        + New Classroom
      </button>
      {open && (
        <Modal title="Create Classroom" onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input placeholder="Classroom Name (e.g. Math 101)" value={name} onChange={e => setName(e.target.value)}
              style={{ padding: '10px', borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
            <button onClick={() => setSubjectsOpen(true)} style={{ padding: 10, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: subject ? 'white' : '#94a3b8', textAlign: 'left', cursor: 'pointer' }}>
              {subject ? `📚 ${subject}` : '📚 Select from My Subjects'}
            </button>
            <textarea placeholder="Private classroom note (optional)" value={note} onChange={e => setNote(e.target.value)} rows={3}
              style={{ padding: 10, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: 'white', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
            <button onClick={handleCreate} disabled={loading} style={{ background: COLOR, color: 'white', border: 'none', padding: '10px', borderRadius: 6, fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', marginTop: 8 }}>
              {loading ? 'Creating...' : 'Create Classroom & Add Participants'}
            </button>
          </div>
        </Modal>
      )}
      {subjectsOpen && (
        <Modal title="My Subjects" onClose={() => setSubjectsOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {subjects.map(item => (
              <button key={item.id} onClick={() => { setSubject(item.name); setSubjectsOpen(false); }} style={{ padding: 10, borderRadius: 7, border: `1px solid ${subject === item.name ? COLOR : '#475569'}`, background: subject === item.name ? `${COLOR}22` : 'rgba(0,0,0,.2)', color: 'white', cursor: 'pointer', textAlign: 'left' }}>
                {item.emoji} {item.name}
              </button>
            ))}
            {subjects.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 8 }}>You have not created any subjects yet.</div>}
            <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #334155', paddingTop: 10, marginTop: 4 }}>
              <input value={newSubject} onChange={e => setNewSubject(e.target.value)} placeholder="Create a subject" style={{ flex: 1, minWidth: 0, padding: 9, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: 'white' }} />
              <button disabled={!newSubject.trim()} onClick={async () => { const created = await createPersonalSubject(user!.uid, newSubject, undefined, subjects.map(s => s.emoji)); setSubjects(prev => [...prev, created]); setNewSubject(''); }} style={{ border: 'none', borderRadius: 6, background: COLOR, color: 'white', fontWeight: 'bold', padding: '0 12px', cursor: 'pointer' }}>Add</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function ManageParticipantsModal({ cls, onClose }: { cls: TeacherClass; onClose: () => void }) {
  const { user } = useAuth();
  const [students, setStudents] = useState<TeacherUserRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void (async () => {
      if (!user) return;
      const [available, members] = await Promise.all([getAssignedTeacherStudents(user.uid), getClassMembers(cls.id)]);
      setStudents(available);
      setSelected(new Set(members.filter(member => !member.kickedAt).map(member => member.userId)));
      setLoading(false);
    })();
  }, [cls.id, user]);

  async function toggle(student: TeacherUserRow) {
    const isSelected = selected.has(student.user_id);
    setSavingId(student.user_id);
    try {
      if (isSelected) await kickStudent(cls.id, student.user_id);
      else await addClassMember(cls.id, student.user_id, student.username, `${student.first_name} ${student.last_name}`.trim() || student.username);
      setSelected(prev => { const next = new Set(prev); isSelected ? next.delete(student.user_id) : next.add(student.user_id); return next; });
    } finally { setSavingId(null); }
  }

  const query = search.trim().toLowerCase();
  const filteredStudents = query ? students.filter(student =>
    student.username.toLowerCase().includes(query)
    || student.email.toLowerCase().includes(query)
    || `${student.first_name} ${student.last_name}`.toLowerCase().includes(query)
  ) : students;

  return (
    <Modal title={`Manage Participants — ${cls.name}`} onClose={onClose}>
      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>Select the students who belong in this classroom.</div>
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search students..." aria-label="Search students" style={{ width: '100%', boxSizing: 'border-box', padding: 9, marginBottom: 10, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: 'white', outline: 'none' }} />
      {loading ? <Loader /> : students.length === 0 ? <Empty icon="👥" text="Add students from the Students section first." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: '55vh', overflowY: 'auto' }}>
          {filteredStudents.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', padding: 18 }}>No students match your search.</div>}
          {filteredStudents.map(student => (
            <label key={student.user_id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #334155', borderRadius: 7, padding: 10, cursor: 'pointer', opacity: savingId === student.user_id ? .6 : 1 }}>
              <input type="checkbox" checked={selected.has(student.user_id)} disabled={savingId !== null} onChange={() => void toggle(student)} style={{ width: 17, height: 17, accentColor: COLOR }} />
              <span><strong>{student.username || `${student.first_name} ${student.last_name}`}</strong><span style={{ color: '#64748b', fontSize: 11, display: 'block' }}>{student.email}</span></span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

function EditClassModal({ cls, onClose, onSaved }: { cls: TeacherClass; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState(cls.name);
  const [subject, setSubject] = useState(cls.subject);
  const [note, setNote] = useState('');
  const [subjects, setSubjects] = useState<PersonalSubject[]>([]);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (user) void Promise.all([listPersonalSubjects(user.uid), getTeacherClassNote(cls.id)]).then(([items, privateNote]) => { setSubjects(items); setNote(privateNote); }); }, [cls.id, user]);

  async function save() {
    const next = name.trim();
    if (!next || !subject.trim() || !user) return;
    setSaving(true);
    try { await updateTeacherClassDetails(cls.id, user.uid, next, subject, note, subjects.find(item => item.name === subject)?.emoji ?? cls.subjectEmoji ?? '📘'); onSaved(); onClose(); }
    finally { setSaving(false); }
  }
  return <>
    <Modal title="Edit Classroom" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Classroom name<input autoFocus value={name} onChange={event => setName(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 5, padding: 10, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: 'white', outline: 'none' }} /></label>
        <div><div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Subject</div><button onClick={() => setSubjectsOpen(true)} style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: subject ? 'white' : '#94a3b8', textAlign: 'left', cursor: 'pointer' }}>{subject ? `📚 ${subject}` : '📚 Select from My Subjects'}</button></div>
        <label style={{ color: '#94a3b8', fontSize: 12 }}>Private note<textarea value={note} onChange={event => setNote(event.target.value)} rows={4} placeholder="Optional, visible only to you" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 5, padding: 10, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: 'white', resize: 'vertical', fontFamily: 'inherit' }} /></label>
        <button onClick={() => void save()} disabled={saving || !name.trim() || !subject.trim()} style={{ padding: 10, borderRadius: 6, border: 'none', background: COLOR, color: 'white', fontWeight: 'bold', cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </Modal>
    {subjectsOpen && <Modal title="My Subjects" onClose={() => setSubjectsOpen(false)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {subjects.map(item => <button key={item.id} onClick={() => { setSubject(item.name); setSubjectsOpen(false); }} style={{ padding: 10, borderRadius: 7, border: `1px solid ${subject === item.name ? COLOR : '#475569'}`, background: subject === item.name ? `${COLOR}22` : 'rgba(0,0,0,.2)', color: 'white', cursor: 'pointer', textAlign: 'left' }}>{item.emoji} {item.name}</button>)}
        {subjects.length === 0 && <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: 8 }}>You have not created any subjects yet.</div>}
        <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #334155', paddingTop: 10, marginTop: 4 }}>
          <input value={newSubject} onChange={event => setNewSubject(event.target.value)} placeholder="Create a subject" style={{ flex: 1, minWidth: 0, padding: 9, borderRadius: 6, border: '1px solid #475569', background: 'rgba(0,0,0,.3)', color: 'white' }} />
          <button disabled={!newSubject.trim()} onClick={async () => { const created = await createPersonalSubject(user!.uid, newSubject, undefined, subjects.map(item => item.emoji)); setSubjects(previous => [...previous, created]); setNewSubject(''); }} style={{ border: 'none', borderRadius: 6, background: COLOR, color: 'white', fontWeight: 'bold', padding: '0 12px', cursor: 'pointer' }}>Add</button>
        </div>
      </div>
    </Modal>}
  </>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLASS DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function ClassDetailView({ cls, onBack, onOpenSession }: { cls: TeacherClass, onBack: () => void, onOpenSession: (s: ClassSession) => void }) {
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<'sessions' | 'homeworks'>('sessions');
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [privateNote, setPrivateNote] = useState('');

  useEffect(() => { loadData(); }, [cls]);

  async function loadData() {
    setLoading(true);
    try {
      const [s, m, note] = await Promise.all([getClassSessions(cls.id), getClassMembers(cls.id), getTeacherClassNote(cls.id)]);
      setSessions([...s].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setMembers(m);
      setPrivateNote(note);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  const activeMembers = members.filter(m => !m.kickedAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}><button onClick={onBack} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, cursor: 'pointer' }}>← Back to Classrooms</button><strong style={{ color: 'white' }}>{cls.name}</strong><span style={{ color: '#64748b', fontSize: 12 }}>· {cls.subject}</span>{cls.status === 'ended' && <span style={{ fontSize: 11, background: '#475569', color: 'white', padding: '2px 8px', borderRadius: 4 }}>Ended</span>}</div>
          {privateNote && <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 7, padding: '7px 10px', borderRadius: 6, background: 'rgba(15,23,42,.7)', borderLeft: `3px solid ${COLOR}` }}>🔒 {privateNote}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 5, borderBottom: '1px solid #334155', marginBottom: 16 }}><button onClick={() => setTab('sessions')} style={{ padding: '8px 14px', border: 0, borderBottom: `2px solid ${tab === 'sessions' ? COLOR : 'transparent'}`, background: 'transparent', color: tab === 'sessions' ? COLOR : '#64748b', fontWeight: 'bold', cursor: 'pointer' }}>Sessions</button><button onClick={() => setTab('homeworks')} style={{ padding: '8px 14px', border: 0, borderBottom: `2px solid ${tab === 'homeworks' ? COLOR : 'transparent'}`, background: 'transparent', color: tab === 'homeworks' ? COLOR : '#64748b', fontWeight: 'bold', cursor: 'pointer' }}>Homeworks</button></div>

      {/* Sessions */}
      {tab === 'sessions' ? <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? <Loader /> : (
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
                      <select
                        aria-label={`Status for ${s.name}`}
                        value={s.status}
                        onChange={async event => { await updateSession(s.id, { status: event.target.value as 'active' | 'ended' }); await loadData(); }}
                        style={{ fontSize: 11, fontWeight: 'bold', padding: '4px 7px', borderRadius: 4, cursor: 'pointer', background: s.status === 'active' ? '#10b98122' : s.status === 'scheduled' ? '#f59e0b22' : '#47556955', color: s.status === 'active' ? '#10b981' : s.status === 'scheduled' ? '#f59e0b' : '#94a3b8', border: `1px solid ${s.status === 'active' ? '#10b98155' : s.status === 'scheduled' ? '#f59e0b55' : '#475569'}` }}
                      >
                        {s.status === 'scheduled' && <option value="scheduled" disabled>Scheduled</option>}
                        <option value="active">Active</option>
                        <option value="ended">Ended</option>
                      </select>
                      <EditSessionButton session={s} members={activeMembers} onSaved={loadData} />
                      <button onClick={async e => {
                        e.stopPropagation();
                        if (await confirm(`Delete session "${s.name}" and all its sheets? This cannot be undone.`, 'Delete Session')) { await deleteSession(s.id); loadData(); }
                      }} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#f87171', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div> : <div style={{ flex: 1, overflowY: 'auto' }}><ClassroomHomeworkView classId={cls.id} role="teacher" /></div>}
    </div>
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
  const { confirm, prompt } = useConfirm();
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
    const next = await prompt('Enter a new name for this sheet.', sheet.name, 'Rename Sheet');
    if (!next || !next.trim() || next.trim() === sheet.name) return;
    await renameSheet(sheet.id, next.trim());
    loadData();
  }

  async function handleDeleteSheet(sheet: SessionSheet) {
    if (!(await confirm(`Delete sheet "${sheet.name}"? This cannot be undone.`, 'Delete Sheet'))) return;
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
              if (await confirm('End this session? Every worksheet will become read-only.', 'End Session')) { await updateSession(session.id, { status: 'ended' }); setStatus('ended'); }
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
