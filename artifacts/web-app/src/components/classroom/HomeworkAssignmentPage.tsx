import { useEffect, useRef, useState } from 'react';
import ClassroomCanvas from './ClassroomCanvas';
import {
  deleteHomeworkAttachment,
  getHomeworkSubmission,
  listHomeworkSubmissions,
  saveHomeworkSubmission,
  updateHomeworkDeadline,
  uploadHomeworkAttachment,
  type Homework,
  type HomeworkAttachment,
  type HomeworkSheet,
  type HomeworkSubmission,
} from '@/lib/homeworkService';
import { getClassMembers, type ClassMember } from '@/lib/classroomService';

const GREEN = '#10b981';
const panel: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 };
const button: React.CSSProperties = { padding: '9px 13px', borderRadius: 7, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', cursor: 'pointer', fontWeight: 'bold' };
const makeSheet = (number: number): HomeworkSheet => { const timestamp = new Date().toISOString(); return { id: `sheet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: `Sheet ${number}`, strokes: [], createdAt: timestamp, updatedAt: timestamp }; };

export default function HomeworkAssignmentPage({ homework, role, userId, onBack }: { homework: Homework; role: 'teacher' | 'student'; userId: string; onBack: () => void }) {
  const [tab, setTab] = useState<'documents' | 'work'>('documents');
  const [dueAt, setDueAt] = useState(homework.dueAt.slice(0, 16));
  const expired = Date.now() > new Date(homework.dueAt).getTime();
  return <div style={{ minHeight: '100%', color: 'white' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <button onClick={onBack} style={button}>← Back to Homeworks</button>
      <div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 21 }}>{homework.title}</h2><div style={{ color: expired ? '#f87171' : '#94a3b8', fontSize: 12, marginTop: 3 }}>Due {new Date(homework.dueAt).toLocaleString()}</div></div>
      {role === 'teacher' && <div style={{ display: 'flex', gap: 7 }}><input type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} style={button} /><button onClick={() => void updateHomeworkDeadline(homework.id, new Date(dueAt).toISOString())} style={{ ...button, background: GREEN, borderColor: GREEN }}>Update deadline</button></div>}
    </div>
    <div style={{ display: 'flex', borderBottom: '1px solid #334155', marginBottom: 16 }}>
      <Tab active={tab === 'documents'} onClick={() => setTab('documents')}>📎 Attached documents</Tab>
      <Tab active={tab === 'work'} onClick={() => setTab('work')}>✏️ Student work</Tab>
    </div>
    {tab === 'documents' ? <Documents homework={homework} /> : role === 'student' ? <StudentWork homework={homework} studentId={userId} expired={expired} /> : <TeacherWork homework={homework} />}
  </div>;
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: '11px 16px', border: 0, borderBottom: `2px solid ${active ? GREEN : 'transparent'}`, background: 'transparent', color: active ? GREEN : '#94a3b8', cursor: 'pointer', fontWeight: 'bold' }}>{children}</button>;
}

function Documents({ homework }: { homework: Homework }) {
  return <div style={panel}><div style={{ display: 'flex', alignItems: 'center', gap: 13 }}><span style={{ fontSize: 34 }}>📕</span><div style={{ flex: 1 }}><strong>{homework.fileName}</strong><div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>Document attached by the teacher</div></div><a href={homework.fileUrl} target="_blank" rel="noreferrer" style={{ ...button, textDecoration: 'none', background: '#3b82f6', borderColor: '#3b82f6' }}>Open</a><a href={homework.fileUrl} download={homework.fileName} style={{ ...button, textDecoration: 'none' }}>Download</a></div></div>;
}

function StudentWork({ homework, studentId, expired }: { homework: Homework; studentId: string; expired: boolean }) {
  const [sheets, setSheets] = useState<HomeworkSheet[]>([]);
  const [files, setFiles] = useState<HomeworkAttachment[]>([]);
  const [editing, setEditing] = useState<HomeworkSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { void getHomeworkSubmission(homework.id, studentId).then(value => { if (value) { setSheets(value.sheets); setFiles(value.attachments); } loaded.current = true; setLoading(false); }); }, [homework.id, studentId]);
  function persist(nextSheets: HomeworkSheet[], nextFiles: HomeworkAttachment[]) {
    if (!loaded.current || expired) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(() => { void saveHomeworkSubmission(homework, studentId, nextSheets, nextFiles).then(() => setError('')).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not save your work.')).finally(() => setSaving(false)); }, 450);
  }
  function changeSheets(next: HomeworkSheet[]) { setSheets(next); persist(next, files); }
  function changeFiles(next: HomeworkAttachment[]) { setFiles(next); persist(sheets, next); }
  function updateSheet(sheet: HomeworkSheet) { const next = sheets.map(item => item.id === sheet.id ? sheet : item); changeSheets(next); setEditing(sheet); }
  async function uploadFiles(selected: File[]) { setSaving(true); setError(''); try { const uploaded = await Promise.all(selected.map(file => uploadHomeworkAttachment(homework, studentId, file))); changeFiles([...files, ...uploaded]); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed.'); setSaving(false); } }

  if (loading) return <div style={{ color: '#94a3b8', padding: 30, textAlign: 'center' }}>Loading student work…</div>;
  return <>
    {expired && <div style={{ ...panel, color: '#fca5a5', marginBottom: 12 }}>The deadline has passed. Your submitted work is now read-only.</div>}
    {error && <div role="alert" style={{ ...panel, color: '#fca5a5', borderColor: '#ef4444', marginBottom: 12 }}>{error}</div>}
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
      {!expired && <button onClick={() => { const sheet = makeSheet(sheets.length + 1); changeSheets([...sheets, sheet]); setEditing(sheet); }} style={{ ...button, background: GREEN, borderColor: GREEN }}>+ Create sheet</button>}
      {!expired && <label style={button}><input hidden type="file" multiple onChange={event => { const selected = [...(event.target.files ?? [])]; event.target.value = ''; void uploadFiles(selected); }} />📎 Upload files</label>}
      <span style={{ color: saving ? '#fbbf24' : '#64748b', fontSize: 12 }}>{saving ? 'Saving…' : '✓ All changes saved automatically'}</span>
    </div>
    <Section title="Sheets" empty="No sheets created yet.">{sheets.map(sheet => <WorkCard key={sheet.id} icon="📝" title={sheet.name} subtitle={`${sheet.strokes.length} marks · edited ${new Date(sheet.updatedAt).toLocaleString()}`} onOpen={() => setEditing(sheet)} actions={!expired ? <><button onClick={() => { const name = window.prompt('Sheet name', sheet.name)?.trim(); if (name) updateSheet({ ...sheet, name, updatedAt: new Date().toISOString() }); }} style={button}>Rename</button><button onClick={() => { if (window.confirm(`Delete “${sheet.name}”?`)) changeSheets(sheets.filter(item => item.id !== sheet.id)); }} style={{ ...button, color: '#f87171' }}>Delete</button></> : undefined} />)}</Section>
    <Section title="Uploaded files" empty="No files uploaded yet.">{files.map(file => <WorkCard key={file.id} icon="📄" title={file.name} subtitle={`Uploaded ${new Date(file.uploadedAt).toLocaleString()}`} onOpen={() => window.open(file.url, '_blank')} actions={!expired ? <button onClick={() => { if (!window.confirm(`Delete “${file.name}”?`)) return; setSaving(true); void deleteHomeworkAttachment(file.path, file.storageBucket).then(() => changeFiles(files.filter(item => item.id !== file.id))).catch(reason => setError(reason instanceof Error ? reason.message : 'Delete failed.')).finally(() => setSaving(false)); }} style={{ ...button, color: '#f87171' }}>Delete</button> : undefined} />)}</Section>
    {editing && <SheetEditor sheet={editing} disabled={expired} onChange={updateSheet} onClose={() => setEditing(null)} />}
  </>;
}

function TeacherWork({ homework }: { homework: Homework }) {
  const [submissions, setSubmissions] = useState<HomeworkSubmission[]>([]);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [selected, setSelected] = useState<HomeworkSubmission | null>(null);
  const [viewingSheet, setViewingSheet] = useState<HomeworkSheet | null>(null);
  const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); try { setSubmissions(await listHomeworkSubmissions(homework.id)); } finally { setLoading(false); } }
  useEffect(() => { void load(); void getClassMembers(homework.classId).then(setMembers); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [homework.id, homework.classId]);
  const studentName = (studentId: string) => { const member = members.find(item => item.userId === studentId); return member?.fullName || member?.username || studentId; };
  if (loading && submissions.length === 0) return <div style={{ color: '#94a3b8', padding: 30, textAlign: 'center' }}>Loading student work…</div>;
  if (selected) return <div><button onClick={() => setSelected(null)} style={{ ...button, marginBottom: 12 }}>← All students</button><div style={{ ...panel, marginBottom: 12 }}><strong>{studentName(selected.studentId)}</strong><div style={{ color: '#94a3b8', fontSize: 12 }}>Last changed {new Date(selected.updatedAt).toLocaleString()}</div></div><Section title="Sheets" empty="No sheets.">{selected.sheets.map(sheet => <WorkCard key={sheet.id} icon="📝" title={sheet.name} subtitle={`${sheet.strokes.length} marks`} onOpen={() => setViewingSheet(sheet)} />)}</Section><Section title="Uploaded files" empty="No uploaded files.">{selected.attachments.map(file => <WorkCard key={file.id} icon="📄" title={file.name} subtitle={new Date(file.uploadedAt).toLocaleString()} onOpen={() => window.open(file.url, '_blank')} />)}</Section>{viewingSheet && <SheetEditor sheet={viewingSheet} disabled onChange={() => undefined} onClose={() => setViewingSheet(null)} />}</div>;
  return <div><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}><span style={{ color: '#94a3b8', fontSize: 12 }}>Draft work appears here automatically, before or after the student explicitly finishes.</span><button onClick={() => void load()} style={button}>↻ Refresh</button></div>{submissions.length === 0 ? <div style={{ ...panel, color: '#64748b', textAlign: 'center', padding: 35 }}>No student work yet.</div> : submissions.map(item => <WorkCard key={item.id} icon="👤" title={studentName(item.studentId)} subtitle={`${item.sheets.length} sheets · ${item.attachments.length} files · updated ${new Date(item.updatedAt).toLocaleString()}`} onOpen={() => setSelected(item)} />)}</div>;
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] | React.ReactNode }) { const count = Array.isArray(children) ? children.length : 1; return <div style={{ marginBottom: 20 }}><h3 style={{ fontSize: 14, color: '#cbd5e1' }}>{title}</h3>{count ? <div style={{ display: 'grid', gap: 8 }}>{children}</div> : <div style={{ ...panel, color: '#64748b', textAlign: 'center' }}>{empty}</div>}</div>; }
function WorkCard({ icon, title, subtitle, onOpen, actions }: { icon: string; title: string; subtitle: string; onOpen: () => void; actions?: React.ReactNode }) { return <div style={{ ...panel, padding: 12, display: 'flex', alignItems: 'center', gap: 11 }}><button onClick={onOpen} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, border: 0, background: 'transparent', color: 'white', textAlign: 'left', cursor: 'pointer' }}><span style={{ fontSize: 26 }}>{icon}</span><span><strong>{title}</strong><small style={{ display: 'block', color: '#64748b', marginTop: 3 }}>{subtitle}</small></span></button>{actions && <div style={{ display: 'flex', gap: 6 }}>{actions}</div>}</div>; }

function SheetEditor({ sheet, disabled, onChange, onClose }: { sheet: HomeworkSheet; disabled: boolean; onChange: (sheet: HomeworkSheet) => void; onClose: () => void }) {
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const change = (strokes: HomeworkSheet['strokes']) => onChange({ ...sheet, strokes, updatedAt: new Date().toISOString() });
  return <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#f8fafc', display: 'flex', flexDirection: 'column' }}><div style={{ padding: 9, borderBottom: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', gap: 8 }}><button onClick={onClose} style={button}>← Back to work</button><strong style={{ color: '#0f172a', flex: 1 }}>{sheet.name}</strong>{!disabled && <><button onClick={() => setTool('pen')} style={{ ...button, background: tool === 'pen' ? '#dbeafe' : 'white', color: '#0f172a' }}>✏️ Pen</button><button onClick={() => setTool('eraser')} style={{ ...button, background: tool === 'eraser' ? '#fee2e2' : 'white', color: '#0f172a' }}>🧹 Eraser</button></>}</div><div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><ClassroomCanvas pageWidth={794} pageHeight={1123} strokes={sheet.strokes} onStrokeAdd={stroke => change([...sheet.strokes, stroke])} onStrokeRemove={id => change(sheet.strokes.filter(stroke => stroke.id !== id))} color="#1e293b" strokeWidth={3} tool={tool} disabled={disabled} style={{ width: '100%', height: 'auto', minHeight: '100%' }} /></div></div>;
}
