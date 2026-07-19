/**
 * ProgramsAdmin
 *
 * Super Admin Programs management with a 3-screen flow:
 *   1. List      — browse published + draft programs
 *   2. Setup     — enter name / emoji / subject before building
 *   3. Explorer  — Windows-like file explorer to organise folders + worksheets
 *
 * Uploading a worksheet (PDF) replicates the exact student pipeline stages:
 *   Reading Document (OCR) → Extracting Questions → Building Structure → Ready!
 *
 * Admin whiteboard writes are naturally private — whiteboard data is stored
 * per-user under the admin's UID and is never published to program content.
 */

import { useState, useEffect, Suspense, lazy } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  FIXED_FIRST_DIVISION_NODE_ID,
  type BuilderNode,
  type BuilderQuestionTypeFile,
  type BuilderSpec,
  convertBuilderToInternal,
  ensureFixedFirstDivisionContainer,
  makeIdFromTitle,
  makeStableId,
  newBuilderSpec,
} from '@/lib/programBuilder';
import {
  deleteDraftProgramAdmin,
  getDraftProgramAdmin,
  getPublishedProgramAdmin,
  listProgramsAdmin,
  publishProgramAdmin,
  saveDraftProgramAdmin,
  softDeletePublishedProgramAdmin,
} from '@/lib/programAdminService';
import { clearDraftProgram, setDraftProgram } from '@/lib/draftProgramStore';
import { runPhase1Ocr, runPhase2Questions, runPhase3Enrichment, extractAndClassifyQuestions, type ClassificationResult } from '@/lib/localOcrPipeline';
import ProgramMapView from '@/views/ProgramMapView';
import FullScreenWorkspace from '@/components/FullScreenWorkspace';
import WorksheetEditorView from './WorksheetEditorView';
import { type PersonalSubject, listPersonalSubjects, createPersonalSubject, updatePersonalSubject, deletePersonalSubject } from '@/lib/personalSubjectService';
import { generateEmojiWithLlm } from '@/lib/programIngestionService';

// ─── Types ───────────────────────────────────────────────────────────────────

type ProgramItem = { id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string };

// ─── Emoji helpers ────────────────────────────────────────────────────────────

const SUBJECT_EMOJI_MAP: Record<string, string> = {
  mathematics: '📐', math: '📐', algebra: '📐', geometry: '📐', calculus: '📐',
  physics: '⚡', chemistry: '🧪', biology: '🧬',
  history: '📜', geography: '🌍',
  literature: '📖', english: '✍️', writing: '✍️',
  computer_science: '💻', programming: '💻', coding: '💻',
  economics: '💹', art: '🎨', music: '🎵',
  arabic: '🔤', french: '🇫🇷', science: '🔬',
  social_studies: '🗺️',
};

function suggestEmoji(name: string, subject: string): string {
  const sKey = subject.toLowerCase().replace(/[\s-]+/g, '_');
  if (SUBJECT_EMOJI_MAP[sKey]) return SUBJECT_EMOJI_MAP[sKey];
  const n = name.toLowerCase();
  for (const [key, emoji] of Object.entries(SUBJECT_EMOJI_MAP)) {
    if (n.includes(key.replace(/_/g, ' '))) return emoji;
  }
  return '📚';
}

const RANDOM_EMOJIS = ['🚀', '🌟', '🧠', '💡', '🎨', '🎯', '📚', '⚡', '🔥', '🏆', '⭐', '🧩', '🧪', '🔭', '🌍'];
function getRandomEmoji() {
  return RANDOM_EMOJIS[Math.floor(Math.random() * RANDOM_EMOJIS.length)];
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((i) => stripUndefinedDeep(i)) as T;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefinedDeep(v)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
}

/**
 * Remove LaTeX math markup and return readable plain text.
 * Handles inline $...$ and display $$...$$ markers, and common LaTeX commands.
 */
function stripLatex(text: string): string {
  if (!text) return text;
  return text
    // Remove $$...$$ display math blocks entirely (keep inner text readable)
    .replace(/\$\$([^$]*)\$\$/g, (_, inner) => inner.trim())
    // Remove $...$ inline math (keep inner text)
    .replace(/\$([^$\n]+)\$/g, (_, inner) => inner.trim())
    // Common LaTeX commands → readable text
    .replace(/\\binom\{([^}]*)\}\{([^}]*)\}/g, 'C($1, $2)')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^}]*)\}/g, '√($1)')
    .replace(/\\cdot/g, '×')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\leq/g, '≤')
    .replace(/\\geq/g, '≥')
    .replace(/\\neq/g, '≠')
    .replace(/\\infty/g, '∞')
    .replace(/\\alpha/g, 'α').replace(/\\beta/g, 'β').replace(/\\gamma/g, 'γ')
    .replace(/\\pi/g, 'π').replace(/\\theta/g, 'θ').replace(/\\lambda/g, 'λ')
    .replace(/\\[a-zA-Z]+/g, '') // remove remaining unknown commands
    .replace(/[{}]/g, '')         // remove remaining braces
    .replace(/\s+/g, ' ')
    .trim();
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

// ─── Upload Progress Stages ───────────────────────────────────────────────────

const UPLOAD_STAGES = [
  { key: 'ocr',       label: '📄 Reading Document (OCR)...' },
  { key: 'questions', label: '🤖 Extracting Questions...' },
  { key: 'building',  label: '🏗️  Building Program Structure...' },
  { key: 'saving',    label: '💾 Saving to Explorer...' },
];

// ─── Subject Selector Component ────────────────────────────────────────────────
function SubjectSelector({ 
  value, 
  onChange, 
  subjects, 
  onCreate,
  onRename,
  onDelete,
  creating 
}: { 
  value: string; 
  onChange: (s: string) => void; 
  subjects: PersonalSubject[]; 
  onCreate: (name: string, emoji: string) => void; 
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  creating: boolean 
}) {
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [newEmoji, setNewEmoji] = useState('');

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #475569', background: '#0f172a', color: 'white', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || 'Select Subject...'}</span>
        <span>▾</span>
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)' }} onClick={() => setOpen(false)} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 340, zIndex: 1001, background: '#1e293b', border: '1px solid #475569', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #475569', background: '#0f172a' }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 'bold', marginBottom: 10, textTransform: 'uppercase' }}>Add New Subject</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  placeholder="Subject Name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newName.trim() && !creating) {
                      onCreate(newName, suggestEmoji(newName, newName));
                      setNewName('');
                    }
                  }}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', fontSize: 14, minWidth: 0 }}
                />
                <button
                  disabled={!newName.trim() || creating}
                  onClick={() => { onCreate(newName, suggestEmoji(newName, newName)); setNewName(''); }}
                  style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: newName.trim() ? '#3b82f6' : '#334155', color: 'white', fontSize: 13, fontWeight: 'bold', cursor: newName.trim() ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}
                >
                  {creating ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {subjects.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No subjects created yet.</div>
              ) : (
                subjects.map(s => (
                  <div
                    key={s.id}
                    style={{ padding: '10px 16px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#334155')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {editingSubjectId === s.id ? (
                      <input
                        autoFocus
                        defaultValue={s.name}
                        onClick={(e) => e.stopPropagation()}
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val && val !== s.name) onRename(s.id, val);
                          setEditingSubjectId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') setEditingSubjectId(null);
                        }}
                        style={{ flex: 1, padding: '4px 6px', textAlign: 'left', background: '#0f172a', color: 'white', border: '1px solid #a855f7', borderRadius: 4, outline: 'none', fontSize: 13 }}
                      />
                    ) : (
                      <span onClick={() => { onChange(s.name); setOpen(false); }} style={{ fontSize: 14, color: 'white', fontWeight: 600, flex: 1, cursor: 'pointer' }}>{s.name}</span>
                    )}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSubjectId(s.id);
                        }}
                        style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}
                      >
                        Rename
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (await confirm(`Delete subject "${s.name}"?`)) onDelete(s.id);
                        }}
                        style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ProgramsAdmin Component ──────────────────────────────────────────────────

function AdminPreviewWrapper({ programId, onBack }: { programId: string, onBack: () => void }) {
  const [hasBuilderSpec, setHasBuilderSpec] = useState<boolean | null>(null);

  useEffect(() => {
    import('@/lib/programMaps').then(m => m.getPublicProgramOrDraft(programId)).then(prog => {
      setHasBuilderSpec(!!prog?.builderSpec);
    });
  }, [programId]);

  if (hasBuilderSpec === null) return <div style={{ padding: 18, color: '#64748b' }}>Loading preview...</div>;

  if (hasBuilderSpec) {
    const PersonalProgramView = lazy(() => import('@/views/PersonalProgramView'));
    return (
      <Suspense fallback={<div style={{ padding: 18, color: '#64748b' }}>Loading...</div>}>
        <PersonalProgramView programId={programId} isPublicProgram={true} onBack={onBack} />
      </Suspense>
    );
  }
  
  return <ProgramMapView programId={programId} onBack={onBack} />;
}

export default function ProgramsAdmin() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { user } = useAuth();

  // Programs list
  const [items, setItems] = useState<ProgramItem[]>([]);
  const [draftItems, setDraftItems] = useState<ProgramItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // View state
  const [view, setView] = useState<'list' | 'setup' | 'explorer' | 'preview' | 'worksheetEditor'>('list');
  const [previewReturnView, setPreviewReturnView] = useState<'list' | 'explorer'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editingWorksheetId, setEditingWorksheetId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);

  // Builder data model (underpins the explorer)
  const [builder, setBuilder] = useState<BuilderSpec>(() => newBuilderSpec());
  const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);

  // Preview & Whiteboard drill-down
  const [previewProgramId, setPreviewProgramId] = useState<string | null>(null);
  const [selectedQuestionTypeId, setSelectedQuestionTypeId] = useState<string | null>(null);
  const [activeWhiteboardQuestion, setActiveWhiteboardQuestion] = useState<any | null>(null);
  const [adminWhiteboardData, setAdminWhiteboardData] = useState<Record<string, any>>({});

  // Setup form
  const [setupName, setSetupName] = useState('');
  const [setupEmoji, setSetupEmoji] = useState('');
  const [setupSubject, setSetupSubject] = useState('');
  const [isGeneratingEmoji, setIsGeneratingEmoji] = useState(false);

  // Category upload modal (replaces old worksheet upload)
  const [categoryUploadOpen, setCategoryUploadOpen] = useState(false);
  const [categoryUploadTargetId, setCategoryUploadTargetId] = useState<string | null>(null); // target category node id
  const [categoryUploadFile, setCategoryUploadFile] = useState<File | null>(null);
  const [categoryUploadDragActive, setCategoryUploadDragActive] = useState(false);
  const [categoryUploadStage, setCategoryUploadStage] = useState<string>('');
  const [categoryUploading, setCategoryUploading] = useState(false);
  const [categoryUploadError, setCategoryUploadError] = useState('');
  const [categoryUploadForceOcr, setCategoryUploadForceOcr] = useState(false);
  const [categoryUploadRawText, setCategoryUploadRawText] = useState('');

  // Classification review (shown after pipeline completes)
  const [classificationResult, setClassificationResult] = useState<ClassificationResult | null>(null);
  // Map: questionId → assigned category name (editable by user in review)
  const [classificationAssignments, setClassificationAssignments] = useState<Record<string, string>>({});
  // Set of question ids that the user deleted in review
  const [classificationDeleted, setClassificationDeleted] = useState<Set<string>>(new Set());
  // Question being edited in review
  const [reviewEditingQuestionId, setReviewEditingQuestionId] = useState<string | null>(null);
  const [reviewEditText, setReviewEditText] = useState('');

  // Old upload modal (kept for backwards-compat with existing worksheet cards)
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadingNodes, setUploadingNodes] = useState<Record<string, { stage: string; progress: number }>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState<string>('');
  const [uploadDone, setUploadDone] = useState(false);
  const [uploadSummary, setUploadSummary] = useState('');
  const [uploadError, setUploadError] = useState('');

  // Question edit popup (inside category view)
  const [editingQuestion, setEditingQuestion] = useState<any | null>(null);
  const [editingQuestionCategoryId, setEditingQuestionCategoryId] = useState<string | null>(null);
  const [editQText, setEditQText] = useState('');
  const [editQModelAnswer, setEditQModelAnswer] = useState('');
  const [editQNotes, setEditQNotes] = useState('');

  // Background publish tracking (programId → true means publishing in progress)
  const [publishingIds, setPublishingIds] = useState<Record<string, boolean>>({});

  // Dynamic Subjects
  const [personalSubjects, setPersonalSubjects] = useState<PersonalSubject[]>([]);
  const [creatingSubject, setCreatingSubject] = useState(false);

  // Auto-save status
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);

  useEffect(() => {
    if (user?.uid) {
      load();
      loadSubjects();
    }
  }, [user?.uid]);

  async function handleGenerateEmoji() {
    if (!setupName.trim() || !setupSubject.trim()) {
      alert('Please enter a program title and select a subject first.');
      return;
    }
    setIsGeneratingEmoji(true);
    try {
      const emoji = await generateEmojiWithLlm(setupName, setupSubject);
      setSetupEmoji(emoji);
    } catch (err) {
      console.error(err);
      setSetupEmoji(getRandomEmoji());
    } finally {
      setIsGeneratingEmoji(false);
    }
  }

  useEffect(() => {
    if (setupName.trim() && setupSubject.trim() && !setupEmoji.trim()) {
      setSetupEmoji(suggestEmoji(setupName, setupSubject));
    }
  }, [setupName, setupSubject, setupEmoji]);

  async function loadSubjects() {
    if (!user?.uid) return;
    listPersonalSubjects(user.uid).then(setPersonalSubjects);
  }

  async function handleCreateSubject(name: string, emoji: string) {
    if (!user?.uid) return;
    setCreatingSubject(true);
    try {
      const created = await createPersonalSubject(user.uid, name.trim(), emoji.trim());
      setPersonalSubjects(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    } finally {
      setCreatingSubject(false);
    }
  }

  async function handleRenameSubject(id: string, newName: string) {
    if (!user?.uid) return;
    try {
      const subject = personalSubjects.find(s => s.id === id);
      if (!subject) return;
      const updated = await updatePersonalSubject(user.uid, id, newName, subject.emoji);
      setPersonalSubjects(prev => prev.map(s => s.id === id ? updated : s).sort((a, b) => a.name.localeCompare(b.name)));
      if (setupSubject === subject.name) setSetupSubject(newName);
      if (builder.subject === subject.name) setBuilder({ ...builder, subject: newName });
    } catch (err) {
      console.error(err);
      alert('Failed to rename subject');
    }
  }

  async function handleDeleteSubject(id: string) {
    if (!user?.uid) return;
    try {
      const subject = personalSubjects.find(s => s.id === id);
      if (!subject) return;
      await deletePersonalSubject(user.uid, id);
      setPersonalSubjects(prev => prev.filter(s => s.id !== id));
      if (setupSubject === subject.name) setSetupSubject('');
      if (builder.subject === subject.name) setBuilder({ ...builder, subject: '' });
    } catch (err) {
      console.error(err);
      alert('Failed to delete subject');
    }
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [pub, drafts] = await Promise.all([
        listProgramsAdmin('published'),
        listProgramsAdmin('draft'),
      ]);
      setItems(pub as ProgramItem[]);
      setDraftItems(drafts as ProgramItem[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load programs.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── Builder helpers ─────────────────────────────────────────────────────────

  function setBuilderAtNode(nodeId: string, fn: (n: BuilderNode) => BuilderNode) {
    setBuilder((prev) => {
      function mapNode(n: BuilderNode): BuilderNode {
        if (n.id === nodeId) return fn(n);
        return { ...n, children: n.children.map(mapNode) };
      }
      return ensureFixedFirstDivisionContainer({ ...prev, root: mapNode(prev.root) });
    });
  }

  function computeProgramIdAndTitle(): { id: string; title: string } {
    const title = builder.programTitle.trim() || builder.root.title.trim();
    const idBase = builder.programId.trim() || makeIdFromTitle(title) || 'program';
    const id = String(editingId || editingDraftId || idBase).trim() || idBase;
    return { id, title: title || id };
  }

  function assertBuilderHasContent(spec: BuilderSpec) {
    const normalized = ensureFixedFirstDivisionContainer(spec);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
    const topFolders = fixed ? fixed.children : normalized.root.children;
    const hasContent = topFolders.some((ch) => {
      const stack: BuilderNode[] = [ch];
      while (stack.length) {
        const node = stack.pop()!;
        if (node.questionTypes.some((qt) => qt.jsonText.trim().length > 2)) return true;
        stack.push(...node.children);
      }
      return false;
    });
    if (!hasContent) throw new Error('No worksheet content yet. Upload at least one worksheet before publishing.');
  }

  function formatErr(e: unknown): string {
    if (e instanceof Error && e.message.trim()) return e.message;
    if (e && typeof e === 'object') {
      const err = e as { message?: unknown; details?: unknown };
      const parts: string[] = [];
      if (typeof err.message === 'string') parts.push(err.message);
      if (typeof err.details === 'string') parts.push(err.details);
      if (parts.length) return parts.join('\n');
    }
    return String(e);
  }

  // ── Explorer helpers ────────────────────────────────────────────────────────

  function getFixedContainer(): BuilderNode | null {
    const normalized = ensureFixedFirstDivisionContainer(builder);
    return normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
  }

  function getCurrentNode(): BuilderNode | null {
    if (builderPathIds.length === 1) return null;
    return findNodeByPath(ensureFixedFirstDivisionContainer(builder), builderPathIds);
  }

  function getContainerNodeId(): string {
    if (builderPathIds.length === 1) return getFixedContainer()?.id ?? FIXED_FIRST_DIVISION_NODE_ID;
    return getCurrentNode()?.id ?? '';
  }

  function getExplorerFolders(): BuilderNode[] {
    if (builderPathIds.length === 1) return getFixedContainer()?.children ?? [];
    return getCurrentNode()?.children ?? [];
  }

  function getExplorerWorksheets(): BuilderQuestionTypeFile[] {
    if (builderPathIds.length === 1) return [];
    return getCurrentNode()?.questionTypes ?? [];
  }

  function getBreadcrumb(): Array<{ id: string; title: string }> {
    const normalized = ensureFixedFirstDivisionContainer(builder);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
    const crumbs = [{ id: 'root', title: builder.programTitle || builder.root.title || 'Program' }];
    let cur: BuilderNode = normalized.root;
    for (const id of builderPathIds.slice(1)) {
      const pool = cur.id === 'root' && fixed ? fixed.children : cur.children;
      const next = pool.find((c) => c.id === id);
      if (!next) break;
      crumbs.push({ id: next.id, title: next.title });
      cur = next;
    }
    return crumbs;
  }

  // ── Explorer actions ────────────────────────────────────────────────────────

  function handleAddFolder() {
    const newNode: BuilderNode = { id: makeStableId('node'), title: 'New folder', children: [], questionTypes: [] };
    setBuilderAtNode(getContainerNodeId(), (n) => ({ ...n, children: [...n.children, newNode] }));
    setEditingFolderId(newNode.id);
  }

  function renameFolder(nodeId: string, newTitle: string) {
    setBuilderAtNode(nodeId, (n) => ({ ...n, title: newTitle }));
  }

  function deleteFolder(nodeId: string) {
    setBuilderAtNode(getContainerNodeId(), (n) => ({ ...n, children: n.children.filter((c) => c.id !== nodeId) }));
    if (builderPathIds.includes(nodeId)) {
      setBuilderPathIds(builderPathIds.slice(0, builderPathIds.indexOf(nodeId)));
    }
  }

  function deleteWorksheet(qtId: string) {
    const curId = getCurrentNode()?.id;
    if (!curId) return;
    setBuilderAtNode(curId, (n) => ({ ...n, questionTypes: n.questionTypes.filter((qt) => qt.id !== qtId) }));
  }

  function navigateInto(nodeId: string) {
    const parentNode = builderPathIds.length === 1 ? getFixedContainer() : getCurrentNode();
    const targetNode = parentNode?.children.find(c => c.id === nodeId);
    setBuilderPathIds([...builderPathIds, nodeId]);
    
    // Auto-open question view if navigating into a category that has a question type
    if (targetNode?.isCategory && targetNode.questionTypes.length > 0) {
      setSelectedQuestionTypeId(targetNode.questionTypes[0].id);
    } else {
      setSelectedQuestionTypeId(null);
    }
  }
  function navigateBack() { setSelectedQuestionTypeId(null); if (builderPathIds.length > 1) setBuilderPathIds(builderPathIds.slice(0, -1)); }
  function navigateTo(pathIds: string[]) { setSelectedQuestionTypeId(null); setBuilderPathIds(pathIds); }

  // ── Category helpers ─────────────────────────────────────────────────────────

  function handleAddCategory() {
    const newNode: BuilderNode = {
      id: makeStableId('cat'),
      title: 'New Category',
      children: [],
      questionTypes: [],
      isCategory: true,
    };
    setBuilderAtNode(getContainerNodeId(), (n) => ({ ...n, children: [...n.children, newNode] }));
    setEditingFolderId(newNode.id);
  }

  function openCategoryUpload(categoryId: string) {
    setCategoryUploadTargetId(categoryId);
    setCategoryUploadFile(null);
    setCategoryUploadStage('');
    setCategoryUploading(false);
    setCategoryUploadError('');
    setCategoryUploadForceOcr(false);
    setCategoryUploadRawText('');
    setClassificationResult(null);
    setClassificationAssignments({});
    setClassificationDeleted(new Set());
    setReviewEditingQuestionId(null);
    setCategoryUploadOpen(true);
  }

  function handleCategoryUploadFile(file: File) {
    if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
      setCategoryUploadFile(file);
    }
  }

  async function runCategoryUploadPhase1() {
    if (!categoryUploadFile || !categoryUploadTargetId) return;

    setCategoryUploading(true);
    setCategoryUploadError('');
    setCategoryUploadStage('📄 Reading Document (OCR)...');

    try {
      const phase1 = await runPhase1Ocr(categoryUploadFile, categoryUploadFile.name, (msg) => {
        setCategoryUploadStage(`📄 ${msg}`);
      }, categoryUploadForceOcr);
      
      setCategoryUploadRawText(phase1.rawText);
      setCategoryUploadStage('✅ Text Extracted. Please review.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCategoryUploadError(msg);
    } finally {
      setCategoryUploading(false);
    }
  }

  async function runCategoryUploadPhase2() {
    if (!categoryUploadRawText || !categoryUploadTargetId) return;

    const parentNode = (() => {
      if (builderPathIds.length <= 1) return getFixedContainer();
      return getCurrentNode();
    })();
    const siblingCategories = (parentNode?.children ?? [])
      .filter(c => c.isCategory)
      .map(c => c.title);

    if (siblingCategories.length === 0) {
      setCategoryUploadError('No categories found in this folder. Create at least one category first.');
      return;
    }

    setCategoryUploading(true);
    setCategoryUploadError('');
    setCategoryUploadStage('🤖 Extracting & Classifying Questions...');

    try {
      const result = await extractAndClassifyQuestions(
        categoryUploadRawText,
        siblingCategories,
        (msg) => { setCategoryUploadStage(`🏷️ ${msg}`); }
      );

      const assignments: Record<string, string> = {};
      for (const item of result.questions) {
        assignments[item.question.id] = item.suggestedCategory;
      }

      setCategoryUploadStage('✅ Done! Review the classification below.');
      setClassificationResult(result);
      setClassificationAssignments(assignments);
      setClassificationDeleted(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCategoryUploadError(msg);
    } finally {
      setCategoryUploading(false);
    }
  }

  function confirmClassification() {
    // Apply the reviewed classification to the builder
    const parentNode = (() => {
      if (builderPathIds.length <= 1) return getFixedContainer();
      return getCurrentNode();
    })();
    if (!parentNode || !classificationResult) return;

    // Group accepted questions by category name
    const byCategory: Record<string, any[]> = {};
    for (const item of classificationResult.questions) {
      if (classificationDeleted.has(item.question.id)) continue;
      const catName = classificationAssignments[item.question.id] ?? item.suggestedCategory;
      if (!byCategory[catName]) byCategory[catName] = [];
      const qObj = {
        id: item.question.id || makeStableId('q'),
        promptBlocks: [{ type: 'text', text: item.question.rawText.trim() }],
        interaction: { type: 'freeform', grading: 'ai' },
        difficulty: 'medium',
        modelAnswer: item.question.modelAnswer,
        answerFromPdf: item.question.answerFromPdf,
      };
      byCategory[catName].push(qObj);
    }

    // For each category, find/create the category node and add questions
    const parentNodeId = parentNode.id;
    setBuilder(prev => {
      function mapNode(n: BuilderNode): BuilderNode {
        if (n.id === parentNodeId) {
          const updatedChildren = n.children.map(child => {
            if (!child.isCategory) return child;
            const newQs = byCategory[child.title] ?? [];
            if (newQs.length === 0) return child;
            // Append to existing questions
            const existingQt = child.questionTypes[0];
            let existingQs: any[] = [];
            try { existingQs = existingQt ? JSON.parse(existingQt.jsonText) : []; } catch { existingQs = []; }
            const merged = [...existingQs, ...newQs];
            const qt: BuilderQuestionTypeFile = {
              id: existingQt?.id ?? makeStableId('qt'),
              title: child.title,
              jsonText: JSON.stringify(merged, null, 2),
            };
            return { ...child, questionTypes: [qt] };
          });
          return { ...n, children: updatedChildren };
        }
        return { ...n, children: n.children.map(mapNode) };
      }
      return ensureFixedFirstDivisionContainer({ ...prev, root: mapNode(prev.root) });
    });

    // Close the upload modal
    setCategoryUploadOpen(false);
    setClassificationResult(null);
    toast({ description: 'Questions added to categories ✓' });
  }

  // ── Question edit popup ──────────────────────────────────────────────────────

  function openQuestionEdit(q: any, categoryNodeId: string) {
    setEditingQuestion(q);
    setEditingQuestionCategoryId(categoryNodeId);
    setEditQText(q.promptBlocks?.[0]?.text ?? q.rawText ?? q.question ?? '');
    setEditQModelAnswer(q.modelAnswer ?? '');
    setEditQNotes(q.aiTutorNotes ?? '');
  }
  async function deleteQuestion(qId: string, categoryNodeId: string) {
    if (!(await confirm('Are you sure you want to delete this question?'))) return;
    setBuilderAtNode(categoryNodeId, (n) => {
      const updatedQts = n.questionTypes.map(qt => {
        let qs: any[] = [];
        try { qs = JSON.parse(qt.jsonText); } catch { qs = []; }
        const updatedQs = qs.filter((q: any) => q.id !== qId);
        return { ...qt, jsonText: JSON.stringify(updatedQs, null, 2) };
      });
      return { ...n, questionTypes: updatedQts };
    });
    toast({ description: 'Question deleted.' });
  }

  function saveQuestionEdit() {
    if (!editingQuestion || !editingQuestionCategoryId) return;
    const catId = editingQuestionCategoryId;
    const qId = editingQuestion.id;

    setBuilderAtNode(catId, (n) => {
      const updatedQts = n.questionTypes.map(qt => {
        let qs: any[] = [];
        try { qs = JSON.parse(qt.jsonText); } catch { qs = []; }
        const updated = {
          ...(editingQuestion as any),
          promptBlocks: [{ type: 'text', text: editQText.trim() }],
          modelAnswer: editQModelAnswer.trim() || undefined,
          aiTutorNotes: editQNotes.trim() || undefined,
        };
        const existingIdx = qs.findIndex((q: any) => q.id === qId);
        if (existingIdx !== -1) {
          qs[existingIdx] = updated;
        } else {
          qs.push(updated);
        }
        return { ...qt, jsonText: JSON.stringify(qs, null, 2) };
      });
      return { ...n, questionTypes: updatedQts };
    });

    setEditingQuestion(null);
    setEditingQuestionCategoryId(null);
  }

  function openCreateQuestion(categoryNodeId: string) {
    const newId = 'q-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
    const newQ = { id: newId };
    setEditingQuestion(newQ);
    setEditingQuestionCategoryId(categoryNodeId);
    setEditQText('');
    setEditQModelAnswer('');
    setEditQNotes('');
  };



  // ── Setup ───────────────────────────────────────────────────────────────────

  function handleSetupContinue() {
    const name = setupName.trim();
    if (!name) { toast({ variant: 'destructive', description: 'Please enter a program name.' }); return; }
    const emoji = setupEmoji.trim() || suggestEmoji(name, setupSubject);
    const id = editingId || editingDraftId || makeIdFromTitle(name) || 'program';
    const b = newBuilderSpec();
    b.programId = id;
    b.programTitle = name;
    b.root.title = name;
    b.subject = setupSubject;
    b.coverEmoji = emoji;
    b.divisions = ['Chapters', 'Topics'];
    setBuilder(ensureFixedFirstDivisionContainer(b));
    setBuilderPathIds(['root']);
    setView('explorer');
  }

  async function resetToList() {
    if (view === 'explorer') {
      await saveBuilderDraft(true);
    }
    setView('list');
    setEditingId(null);
    setEditingDraftId(null);
    setBuilder(newBuilderSpec());
    setBuilderPathIds(['root']);
    setSetupName(''); setSetupEmoji(''); setSetupSubject('');
    setAdminWhiteboardData({});
    await load();
  }

  // ── Save / Publish ──────────────────────────────────────────────────────────

  async function saveBuilderDraft(isAuto = false) {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) { 
      if (!isAuto) toast({ variant: 'destructive', description: 'Missing program ID' }); 
      return; 
    }
    if (!isAuto) setSaving(true);
    try {
      const spec = { ...builder, programId, programTitle: title };
      const internal = convertBuilderToInternal(spec);
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title,
        subject: builder.subject ?? 'mathematics',
        coverEmoji: builder.coverEmoji ?? '📚',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: spec,
        adminWhiteboardData,
        updatedAt: new Date().toISOString(),
      });
      const gb = (builder.gradeBand ?? '').trim();
      if (gb) payload.grade_band = gb;
      await saveDraftProgramAdmin(programId, payload);
      setEditingDraftId(programId);
      if (isAuto) {
        setLastAutoSave(new Date());
      } else {
        await load();
        toast({ description: 'Draft saved ✓' });
      }
    } catch (e) { 
      if (!isAuto) toast({ variant: 'destructive', description: formatErr(e) }); 
    } finally { 
      if (!isAuto) setSaving(false); 
    }
  }

  useEffect(() => {
    if (view !== 'explorer') return;
    // Auto-save every 60 seconds while in the explorer view.
    // We use an interval (not a debounce on builder changes) so that:
    //  1. It fires reliably every minute regardless of user activity
    //  2. It doesn't restart on every keystroke / state update
    const intervalId = setInterval(() => {
      saveBuilderDraft(true);
    }, 60_000);
    return () => clearInterval(intervalId);
  // Only re-run when entering/leaving explorer — saveBuilderDraft reads
  // the latest state via closure, so we don't need it as a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function publishBuilder() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) { toast({ variant: 'destructive', description: 'Missing program ID' }); return; }

    // 1. Show confirmation popup
    const confirmed = await confirm(`Publish "${title}"?\n\nYou will be redirected to the programs list while publishing continues in the background.`);
    if (!confirmed) return;

    // 2. Save draft first — use setSaving so the Publish button shows feedback
    setSaving(true);
    try {
      await saveBuilderDraft(true);
    } catch (_e) {
      // ignore draft save errors — proceed with what we have
    }
    setSaving(false);

    // 3. Capture snapshots before resetting state
    const draftIdToPublish = editingDraftId;
    const specSnapshot = { ...builder, programId, programTitle: title };
    const whiteboardSnapshot = { ...adminWhiteboardData };

    setView('list');
    setEditingId(null);
    setEditingDraftId(null);
    setBuilder(newBuilderSpec());
    setBuilderPathIds(['root']);
    setSetupName(''); setSetupEmoji(''); setSetupSubject('');
    setAdminWhiteboardData({});
    await load();

    // 4. Mark as publishing (shows progress bar on the list card)
    setPublishingIds(prev => ({ ...prev, [programId]: true }));

    // 5. Background publish
    (async () => {
      try {
        assertBuilderHasContent(specSnapshot);
        const internal = convertBuilderToInternal(specSnapshot);
        const payload: Record<string, unknown> = stripUndefinedDeep({
          title,
          subject: specSnapshot.subject ?? 'mathematics',
          coverEmoji: specSnapshot.coverEmoji ?? '📚',
          toc: internal.toc,
          annotations: internal.annotations,
          programMeta: internal.programMeta,
          questionBanksByChapter: internal.questionBanksByChapter,
          rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
          builderSpec: specSnapshot,
          adminWhiteboardData: whiteboardSnapshot,
          updatedAt: new Date().toISOString(),
        });
        const gb = (specSnapshot.gradeBand ?? '').trim();
        if (gb) payload.grade_band = gb;
        await publishProgramAdmin(programId, payload, draftIdToPublish);
        await load();
        toast({ description: `"${title}" published ✓` });
      } catch (e) {
        toast({ variant: 'destructive', description: formatErr(e) });
      } finally {
        setPublishingIds(prev => { const next = { ...prev }; delete next[programId]; return next; });
      }
    })();
  }

  // ── Edit existing ───────────────────────────────────────────────────────────

  async function startEditPublished(p: ProgramItem) {
    setEditingId(p.id);
    setEditingDraftId(null);
    try {
      const data = await getPublishedProgramAdmin(p.id);
      if (!data) { toast({ variant: 'destructive', description: 'Program not found' }); return; }
      const spec = data.builderSpec as BuilderSpec | undefined;
      const next = spec?.version === '1.0' ? spec : (() => {
        const b = newBuilderSpec();
        b.programId = p.id;
        b.programTitle = (data.title as string) ?? p.id;
        b.subject = (data.subject as string) ?? 'mathematics';
        b.coverEmoji = (data.coverEmoji as string) ?? '📚';
        b.root.title = (data.title as string) ?? p.id;
        return b;
      })();
      setBuilder(ensureFixedFirstDivisionContainer(next));
      setBuilderPathIds(['root']);
      setView('explorer');
    } catch (e) { toast({ variant: 'destructive', description: formatErr(e) }); }
  }

  async function startEditDraft(d: ProgramItem) {
    setEditingId(null);
    setEditingDraftId(d.id);
    try {
      const data = await getDraftProgramAdmin(d.id);
      if (!data) { toast({ variant: 'destructive', description: 'Draft not found' }); return; }
      const spec = data?.builderSpec as BuilderSpec | undefined;
      const next = spec?.version === '1.0' ? spec : (() => {
        const b = newBuilderSpec();
        b.programId = d.id;
        b.programTitle = (data?.title as string) ?? d.id;
        b.subject = (data?.subject as string) ?? 'mathematics';
        b.coverEmoji = (data?.coverEmoji as string) ?? '📚';
        b.root.title = (data?.title as string) ?? d.id;
        return b;
      })();
      setBuilder(ensureFixedFirstDivisionContainer(next));
      setBuilderPathIds(['root']);
      setView('explorer');
    } catch (e) { toast({ variant: 'destructive', description: e instanceof Error ? e.message : String(e) }); }
  }

  // ── Preview ─────────────────────────────────────────────────────────────────

  function previewFromExplorer() {
    try {
      const { id: programId, title } = computeProgramIdAndTitle();
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });
      const key = `${Date.now()}`;
      setDraftProgram(key, {
        id: programId, title,
        subject: builder.subject ?? 'mathematics',
        grade_band: (builder.gradeBand ?? '').trim() || undefined,
        coverEmoji: builder.coverEmoji ?? '📚',
        toc: internal.toc,
        questionBanksByChapter: internal.questionBanksByChapter,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: builder,
      });
      setPreviewProgramId(`ll-draft:${key}`);
      setPreviewReturnView('explorer');
      setView('preview');
    } catch (e) { toast({ variant: 'destructive', description: formatErr(e) }); }
  }

  async function previewDraft(programId: string) {
    setPreviewProgramId(`ll-draftdb:${programId}`);
    setPreviewReturnView('list');
    setView('preview');
  }

  async function previewPublished(programId: string) {
    try {
      const data = await getPublishedProgramAdmin(programId);
      const spec = data?.builderSpec as BuilderSpec | undefined;
      if (spec?.version === '1.0') {
        const normalized = ensureFixedFirstDivisionContainer(spec);
        const title = normalized.programTitle || normalized.root.title || data?.title || programId;
        const internal = convertBuilderToInternal({ ...normalized, programId, programTitle: title });
        const key = `published-preview:${programId}`;
        setDraftProgram(key, {
          id: programId, title,
          subject: normalized.subject ?? data?.subject ?? 'mathematics',
          grade_band: normalized.gradeBand ?? data?.grade_band,
          coverEmoji: normalized.coverEmoji ?? data?.coverEmoji ?? '📚',
          toc: internal.toc,
          questionBanksByChapter: internal.questionBanksByChapter,
          annotations: internal.annotations,
          programMeta: internal.programMeta,
          rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
          builderSpec: spec,
        });
        setPreviewProgramId(`ll-draft:${key}`);
      } else {
        setPreviewProgramId(programId);
      }
      setPreviewReturnView('list');
      setView('preview');
    } catch (e) { toast({ variant: 'destructive', description: formatErr(e) }); }
  }

  async function removeDraft(programId: string) {
    if (!(await confirm('Delete this draft?'))) return;
    await deleteDraftProgramAdmin(programId);
    await load();
    if (editingDraftId === programId) resetToList();
  }

  async function removePublished(id: string) {
    if (!(await confirm('Are you sure you want to delete this program?'))) return;
    await softDeletePublishedProgramAdmin(id);
    await load();
    if (editingId === id) resetToList();
  }

  async function publishDraftFromList(d: ProgramItem) {
    if (!(await confirm(`Publish "${d.title ?? d.id}"?`))) return;
    setLoading(true);
    try {
      const data = await getDraftProgramAdmin(d.id);
      if (!data) throw new Error('Draft not found');
      const spec = data.builderSpec as BuilderSpec;
      if (!spec) throw new Error('Draft is missing builderSpec');
      assertBuilderHasContent(spec);
      const internal = convertBuilderToInternal(spec);
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title: d.title ?? d.id,
        subject: d.subject ?? 'mathematics',
        coverEmoji: d.coverEmoji ?? '📚',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: spec,
        adminWhiteboardData: data.adminWhiteboardData,
        updatedAt: new Date().toISOString(),
      });
      if (d.grade_band) payload.grade_band = d.grade_band;
      await publishProgramAdmin(d.id, payload, d.id);
      await load();
      toast({ description: 'Published ✓' });
    } catch (e) {
      toast({ variant: 'destructive', description: formatErr(e) });
    } finally {
      setLoading(false);
    }
  }

  async function unpublishProgramFromList(p: ProgramItem) {
    if (!(await confirm(`Unpublish "${p.title ?? p.id}" and move it back to drafts?`))) return;
    setLoading(true);
    try {
      const data = await getPublishedProgramAdmin(p.id);
      if (!data) throw new Error('Program not found');
      
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title: data.title ?? p.title ?? p.id,
        subject: data.subject ?? p.subject ?? 'mathematics',
        coverEmoji: data.coverEmoji ?? p.coverEmoji ?? '📚',
        toc: data.toc,
        annotations: data.annotations,
        programMeta: data.programMeta,
        questionBanksByChapter: data.questionBanksByChapter,
        rankedTotalQuestionCount: data.rankedTotalQuestionCount,
        builderSpec: data.builderSpec,
        adminWhiteboardData: data.adminWhiteboardData,
        updatedAt: new Date().toISOString(),
      });
      if (data.grade_band || p.grade_band) payload.grade_band = data.grade_band || p.grade_band;
      
      await saveDraftProgramAdmin(p.id, payload);
      await softDeletePublishedProgramAdmin(p.id);
      
      await load();
      toast({ description: 'Program moved back to drafts.' });
    } catch (e) {
      toast({ variant: 'destructive', description: formatErr(e) });
    } finally {
      setLoading(false);
    }
  }

  // ── Create Worksheet ────────────────────────────────────────────────────────

  function openUploadModal() {
    setUploadOpen(true);
    setUploadFiles([]);
    setUploadTitle('');
    setUploadStage('');
    setUploadError('');
    setUploadDone(false);
    setUploadSummary('');
    setUploading(false);
  }

  function closeUploadModal() {
    if (uploading && !uploadDone) return;
    setUploadOpen(false);
  }

  function handleUploadDrag(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    setUploadDragActive(e.type === 'dragenter' || e.type === 'dragover');
  }

  function handleUploadDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation();
    setUploadDragActive(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf' || f.type.startsWith('image/')
    );
    if (files.length > 0) {
      setUploadFiles(files);
      if (!uploadTitle) setUploadTitle(files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    }
  }

  function handleUploadFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(
      (f) => f.type === 'application/pdf' || f.type.startsWith('image/')
    );
    if (files.length > 0) {
      setUploadFiles(files);
      if (!uploadTitle) setUploadTitle(files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
    }
  }

  function handleCreateWorksheetManually() {
    const title = "New Manual Sheet";
    const worksheetFolderId = makeStableId('node');
    const worksheetFolder: BuilderNode = {
      id: worksheetFolderId,
      title: title,
      children: [],
      questionTypes: [] // Empty initially
    };

    const curNodeId = getCurrentNode()?.id || getFixedContainer()?.id || 'root';
    
    setBuilderAtNode(curNodeId, (n) => ({
      ...n,
      children: [...n.children, worksheetFolder],
    }));

    setUploadOpen(false);
    setEditingWorksheetId(worksheetFolderId);
    setView('worksheetEditor');
  }

  async function handleCreateWorksheet() {
    if (!uploadFiles.length) return;
    const file = uploadFiles[0];
    const title = uploadTitle.trim() || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

    const worksheetFolderId = makeStableId('node');
    const worksheetFolder: BuilderNode = {
      id: worksheetFolderId,
      title: title,
      children: [],
      questionTypes: [] // Empty initially
    };

    const curNodeId = getCurrentNode()?.id || getFixedContainer()?.id || 'root';
    
    // 1. Insert empty node
    setBuilderAtNode(curNodeId, (n) => ({
      ...n,
      children: [...n.children, worksheetFolder],
    }));

    // 2. Set uploading state
    setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: 'Initializing...', progress: 10 } }));

    // 3. Close modal immediately
    setUploadOpen(false);
    setUploadFiles([]);
    setUploadTitle('');
    setUploading(false);

    // 4. Background task
    (async () => {
      try {
        setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: 'Reading Document (OCR)...', progress: 30 } }));
        const phase1 = await runPhase1Ocr(file, title, (msg) => {
          setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: msg, progress: 30 } }));
        });

        setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: 'Extracting Questions...', progress: 60 } }));
        const phase2 = await runPhase2Questions(phase1.rawText, (msg) => {
          setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: msg, progress: 70 } }));
        });

        setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: 'Generating solutions & grading schemas...', progress: 80 } }));
        const enrichedTopics = await runPhase3Enrichment(phase2.topics, (msg) => {
          setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: msg, progress: 85 } }));
        });

        setUploadingNodes(prev => ({ ...prev, [worksheetFolderId]: { stage: 'Building Program Structure...', progress: 92 } }));
        
        const newQuestionTypes: BuilderQuestionTypeFile[] = (enrichedTopics ?? []).map((topic) => {
          const questions = (topic.questions ?? []).map((q) => ({
            id: q.id || makeStableId('q'),
            promptBlocks: [{ type: 'text', text: (q.rawText || q.label || '').trim() }],
            interaction: { type: 'freeform', grading: 'ai' },
            difficulty: 'medium',
            // Phase 2 answer data
            modelAnswer: q.modelAnswer,
            answerFromPdf: q.answerFromPdf,
            rawAnswerText: q.rawAnswerText,
            // Phase 3 enrichment
            solution: q.solution,
            solutionPlan: q.solutionPlan,
            hint: q.hint,
            gradingSchema: q.gradingSchema,
          }));
          return {
            id: makeStableId('qt'),
            title: topic.title || title,
            jsonText: JSON.stringify(questions, null, 2),
          };
        });

        if (newQuestionTypes.length === 0) {
          newQuestionTypes.push({
            id: makeStableId('qt'),
            title,
            jsonText: JSON.stringify([{
              id: makeStableId('q'),
              promptBlocks: [{ type: 'text', text: (phase1.rawText ?? '').slice(0, 3000) }],
              interaction: { type: 'open_response' },
              difficulty: 'medium',
            }], null, 2),
          });
        }

        // Apply back to builder
        setBuilderAtNode(worksheetFolderId, (n) => ({
          ...n,
          questionTypes: newQuestionTypes
        }));
      } catch (err) {
        console.error('Worksheet background processing failed:', err);
        setBuilderAtNode(worksheetFolderId, (n) => ({
          ...n,
          title: `[Failed] ${n.title}`
        }));
      } finally {
        setUploadingNodes(prev => {
          const next = { ...prev };
          delete next[worksheetFolderId];
          return next;
        });
      }
    })();
  }
  // ── Derived values for render ───────────────────────────────────────────────

  const breadcrumb = view === 'explorer' ? getBreadcrumb() : [];
  const explorerFolders = view === 'explorer' ? getExplorerFolders() : [];
  const explorerWorksheets = view === 'explorer' ? getExplorerWorksheets() : [];
  const isAtRoot = builderPathIds.length === 1;

  const autoEmoji = suggestEmoji(setupName, setupSubject);

  // ── Guard states ────────────────────────────────────────────────────────────

  if (loading) return (
    <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>Loading programs...</div>
  );

  if (loadError) return (
    <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #7f1d1d', padding: 16, color: '#fecaca' }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Failed to load programs</div>
      <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{loadError}</div>
      <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={load}>Retry</button>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>

      {/* ═══════════════════════════════════════════════════════════════════════
          Create Worksheet MODAL  —  mirrors the student "Create New Program" flow
          ═══════════════════════════════════════════════════════════════════════ */}
      {uploadOpen && (
        <div
          onClick={closeUploadModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(640px, 94vw)', maxHeight: '90vh', overflow: 'auto', background: '#0f172a', borderRadius: 20, border: '2px solid rgba(139,92,246,0.4)', boxShadow: '0 32px 80px rgba(0,0,0,0.75)' }}
          >
            {/* Header */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10, background: '#1e293b', borderRadius: '18px 18px 0 0' }}>
              <div style={{ fontSize: 20 }}>📄</div>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>Create Worksheet</div>
              {!uploading && <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={closeUploadModal}>✕</button>}
            </div>

            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Info banner */}
              <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: '#c4b5fd', lineHeight: 1.6 }}>
                <strong>Worksheet Creator</strong><br />
                Upload a PDF worksheet or a photo. We'll automatically read the document, extract questions, and organise them into topics — ready for students to interact with.
              </div>

              {/* Drag & Drop Zone (hidden while processing) */}
              {!uploading && !uploadDone && (
                <>
                  <div
                    onDragEnter={handleUploadDrag}
                    onDragLeave={handleUploadDrag}
                    onDragOver={handleUploadDrag}
                    onDrop={handleUploadDrop}
                    style={{ border: `2px dashed ${uploadDragActive ? '#8b5cf6' : '#334155'}`, background: uploadDragActive ? 'rgba(139,92,246,0.06)' : '#1e293b', borderRadius: 16, padding: '36px 20px', textAlign: 'center', transition: 'all 0.2s', position: 'relative', cursor: 'pointer' }}
                  >
                    <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={handleUploadFileChange} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                    <div style={{ fontSize: 36, marginBottom: 12 }}>
                      {uploadDragActive ? '📥' : uploadFiles.length > 0 ? '📑' : '📄'}
                    </div>
                    {uploadFiles.length > 0 ? (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 'bold', color: 'white', marginBottom: 4 }}>{uploadFiles[0].name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>Click to change file</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 'bold', color: '#94a3b8', marginBottom: 4 }}>Drag & Drop or click to browse</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>Supports .pdf, .png, .jpg</div>
                      </>
                    )}
                  </div>
                  
                  {uploadFiles.length === 0 && (
                    <div style={{ textAlign: 'center', marginTop: 10 }}>
                      <div style={{ color: '#475569', fontSize: 11, marginBottom: 10, fontWeight: 'bold' }}>OR</div>
                      <button
                        onClick={handleCreateWorksheetManually}
                        style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #475569', color: '#94a3b8', cursor: 'pointer', transition: 'all 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#94a3b8'; e.currentTarget.style.color = 'white'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = '#94a3b8'; }}
                      >
                        Create Sheet manually
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* File ready panel */}
              {uploadFiles.length > 0 && !uploading && !uploadDone && (
                <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16 }}>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 900, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' }}>Worksheet Title</label>
                  <input
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="E.g. Chapter 4 — Linear Equations"
                    style={{ width: '100%', padding: '10px 13px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                  />
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="ll-btn" onClick={() => { setUploadFiles([]); setUploadTitle(''); }} style={{ padding: '8px 14px', fontSize: 12 }}>Clear</button>
                    <button
                      onClick={handleCreateWorksheet}
                      style={{ padding: '10px 22px', fontSize: 13, fontWeight: 'bold', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Create Worksheet ✨
                    </button>
                  </div>
                </div>
              )}

              {/* Progress stages */}
              {uploading && (
                <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 20 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {uploadDone ? (
                      <div style={{ textAlign: 'center', padding: '14px 0' }}>
                        <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                        <div style={{ color: '#86efac', fontSize: 15, fontWeight: 900, marginBottom: 4 }}>Ready!</div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>{uploadSummary}</div>
                      </div>
                    ) : (
                      UPLOAD_STAGES.map((stage, idx) => {
                        const stageKeys = UPLOAD_STAGES.map((s) => s.key);
                        const curIdx = stageKeys.indexOf(uploadStage);
                        const isDone = idx < curIdx;
                        const isActive = stage.key === uploadStage;
                        return (
                          <div key={stage.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, background: isActive ? 'rgba(139,92,246,0.13)' : isDone ? 'rgba(16,185,129,0.07)' : 'transparent', border: isActive ? '1px solid rgba(139,92,246,0.35)' : isDone ? '1px solid rgba(16,185,129,0.2)' : '1px solid transparent', transition: 'all 0.3s' }}>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: isDone ? '#10b981' : isActive ? '#8b5cf6' : '#334155', transition: 'all 0.3s', boxShadow: isActive ? '0 0 8px rgba(139,92,246,0.6)' : 'none' }} />
                            <div style={{ color: isActive ? '#c4b5fd' : isDone ? '#6ee7b7' : '#475569', fontSize: 13, fontWeight: isActive ? 700 : 400, transition: 'color 0.3s' }}>
                              {stage.label}
                            </div>
                            {isDone && <div style={{ marginLeft: 'auto', color: '#10b981', fontSize: 11 }}>✓</div>}
                            {isActive && (
                              <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                                {[0,1,2].map((i) => (
                                  <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#8b5cf6', animation: `pulse 1.2s ease ${i * 0.15}s infinite` }} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Error */}
              {uploadError && (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 8 }}>❌ {uploadError}</div>
                  <button className="ll-btn" onClick={() => setUploadError('')} style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}>Dismiss</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PREVIEW VIEW
          ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'preview' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#0f172a' }}>
          {previewProgramId
            ? <AdminPreviewWrapper onBack={() => {
                if (previewProgramId?.startsWith('ll-draft:')) clearDraftProgram(previewProgramId.slice('ll-draft:'.length));
                setView(previewReturnView);
              }} programId={previewProgramId} />
            : <div style={{ padding: 18, color: '#64748b' }}>No preview loaded.</div>}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SETUP VIEW  —  name / emoji / subject
          ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'setup' && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 24 }}>
          <div style={{ width: 'min(520px, 100%)', background: '#1e293b', borderRadius: 18, border: '1px solid #334155', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            {/* Header */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #334155', background: 'linear-gradient(135deg, rgba(168,85,247,0.1), rgba(59,130,246,0.08))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📚</div>
                <div>
                  <div style={{ color: 'white', fontWeight: 900, fontSize: 17 }}>New Program</div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Set up your program before adding content</div>
                </div>
              </div>
            </div>

            {/* Form body */}
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Program name */}
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 900, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' }}>
                  Program Name <span style={{ color: '#f87171' }}>*</span>
                </label>
                <input
                  autoFocus
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSetupContinue()}
                  placeholder="e.g. Algebra Fundamentals — Grade 8"
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Emoji + Subject */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 900, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' }}>Emoji</label>
                  <input
                    value={setupEmoji}
                    onChange={(e) => setSetupEmoji(e.target.value.slice(0, 4))}
                    placeholder={autoEmoji}
                    style={{ width: '100%', padding: '11px 10px', borderRadius: 10, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 22, outline: 'none', boxSizing: 'border-box', textAlign: 'center' }}
                  />
                  <button
                    onClick={handleGenerateEmoji}
                    disabled={isGeneratingEmoji}
                    style={{ width: '100%', marginTop: 6, padding: '6px', borderRadius: 6, border: '1px solid #475569', background: '#1e293b', color: '#cbd5e1', cursor: isGeneratingEmoji ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 'bold' }}
                  >
                    {isGeneratingEmoji ? '...' : 'Change'}
                  </button>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 900, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' }}>Subject</label>
                  <SubjectSelector 
                    value={setupSubject} 
                    onChange={setSetupSubject} 
                    subjects={personalSubjects} 
                    onCreate={handleCreateSubject} 
                    onRename={handleRenameSubject}
                    onDelete={handleDeleteSubject}
                    creating={creatingSubject} 
                  />
                </div>
              </div>

              {/* Live preview card */}
              {setupName.trim() && (
                <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 50, height: 50, borderRadius: 14, background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0 }}>
                    {setupEmoji.trim() || autoEmoji}
                  </div>
                  <div>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 15 }}>{setupName}</div>
                    <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{setupSubject.replace(/_/g, ' ')}</div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button className="ll-btn" style={{ padding: '10px 18px', fontSize: 13 }} onClick={resetToList}>← Cancel</button>
                <button
                  onClick={handleSetupContinue}
                  disabled={!setupName.trim()}
                  style={{ padding: '10px 24px', fontSize: 13, fontWeight: 'bold', background: setupName.trim() ? 'linear-gradient(135deg, #a855f7, #3b82f6)' : '#1e293b', border: 'none', borderRadius: 10, color: setupName.trim() ? 'white' : '#475569', cursor: setupName.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', transition: 'all 0.2s' }}
                >
                  Open File Explorer →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          EXPLORER VIEW  —  Windows-style file explorer
          ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'explorer' && (
        <div style={{ display: 'flex', flexDirection: 'column', background: '#0f172a', borderRadius: 14, border: '1px solid #334155', overflow: 'hidden' }}>

          {/* ── Program Metadata Editor ── */}
          <div style={{ background: '#1e293b', borderBottom: '1px solid #334155', padding: '12px 14px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button 
              className="ll-btn" 
              style={{ padding: '6px 12px', fontSize: 12, marginRight: 4 }} 
              onClick={resetToList}
              title="Back to Programs List"
            >
              ← Back
            </button>
            <input 
              value={builder.coverEmoji || ''} 
              onChange={e => setBuilder({ ...builder, coverEmoji: e.target.value })} 
              placeholder="Emoji" 
              style={{ width: 44, textAlign: 'center', padding: '6px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: 'white' }} 
            />
            <input 
              value={builder.programTitle} 
              onChange={e => setBuilder({ ...builder, programTitle: e.target.value })} 
              placeholder="Program Title" 
              style={{ flex: 1, minWidth: 200, padding: '6px 10px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: 'white', fontWeight: 600 }} 
            />
            <div style={{ width: 220 }}>
              <SubjectSelector 
                value={builder.subject || ''} 
                onChange={s => setBuilder({ ...builder, subject: s })} 
                subjects={personalSubjects} 
                onCreate={handleCreateSubject} 
                onRename={handleRenameSubject}
                onDelete={handleDeleteSubject}
                creating={creatingSubject} 
              />
            </div>
          </div>

          {/* ── Explorer toolbar ── */}
          <div style={{ background: '#0f172a', borderBottom: '1px solid #334155', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>

            {/* Breadcrumb navigation */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflow: 'hidden', marginRight: 8 }}>
              {breadcrumb.map((crumb, i) => (
                <div key={crumb.id} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  {i > 0 && <span style={{ color: '#475569', flexShrink: 0, fontSize: 14 }}>›</span>}
                  <button
                    onClick={() => i < breadcrumb.length - 1 ? navigateTo(builderPathIds.slice(0, i + 1)) : undefined}
                    style={{ background: 'none', border: 'none', padding: '3px 6px', borderRadius: 6, color: i === breadcrumb.length - 1 ? 'white' : '#a855f7', fontWeight: i === breadcrumb.length - 1 ? 900 : 400, cursor: i < breadcrumb.length - 1 ? 'pointer' : 'default', fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}
                    title={crumb.title}
                  >
                    {i === 0 ? `${builder.coverEmoji || '📚'} ${crumb.title}` : crumb.title}
                  </button>
                  {i === breadcrumb.length - 1 && !!getCurrentNode()?.isCategory && (
                    <span style={{ fontSize: 10, background: 'rgba(20,184,166,0.15)', color: '#2dd4bf', padding: '2px 6px', borderRadius: 4, fontWeight: 'bold', textTransform: 'uppercase', border: '1px solid rgba(20,184,166,0.3)', marginLeft: 4 }}>
                      Category
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Toolbar buttons */}
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
              {/* New Folder — available at root and inside folders, but NOT inside categories */}
              {!(!!getCurrentNode()?.isCategory) && (
                <button
                  className="ll-btn"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={handleAddFolder}
                >
                  📁 New Folder
                </button>
              )}
              {/* Create Category & Upload Questions — only available when inside a folder (not at root) and NOT inside categories */}
              {!isAtRoot && !(!!getCurrentNode()?.isCategory) && (
                <>
                  <button
                    className="ll-btn"
                    onClick={handleAddCategory}
                    title="Add a category inside this folder"
                    style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(20,184,166,0.12)', borderColor: 'rgba(20,184,166,0.45)', color: '#2dd4bf' }}
                  >
                    🗂️ Create Category
                  </button>
                  <button
                    className="ll-btn"
                    onClick={() => openCategoryUpload('folder')}
                    title="Upload questions to categories in this folder"
                    style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.45)', color: '#60a5fa' }}
                  >
                    📤 Upload Questions
                  </button>
                </>
              )}
              {/* Inside Category: Upload Questions and Create Question */}
              {!!getCurrentNode()?.isCategory && (
                <>
                  <button
                    className="ll-btn"
                    onClick={() => {
                      const catId = getCurrentNode()?.id;
                      if (catId) openCategoryUpload(catId);
                    }}
                    title="Upload questions to this category"
                    style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.45)', color: '#60a5fa' }}
                  >
                    📤 Upload Questions
                  </button>
                  <button
                    className="ll-btn"
                    onClick={() => {
                      const catId = getCurrentNode()?.id;
                      if (catId) openQuestionEdit({ id: Math.random().toString(36).substr(2, 9), promptBlocks: [], modelAnswer: '', aiTutorNotes: '' }, catId);
                    }}
                    title="Create a new question"
                    style={{ padding: '6px 12px', fontSize: 12, background: 'rgba(168,85,247,0.12)', borderColor: 'rgba(168,85,247,0.45)', color: '#c4b5fd' }}
                  >
                    ✨ Create New Question
                  </button>
                </>
              )}
              <div style={{ width: 1, height: 20, background: '#334155', margin: '0 2px' }} />
              <button className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={previewFromExplorer}>
                👁️ Preview
              </button>
              <button
                onClick={publishBuilder}
                disabled={saving}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 'bold', background: '#10b981', border: '1px solid #059669', borderRadius: 8, color: 'white', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving...' : '🚀 Publish'}
              </button>
              {lastAutoSave && (
                <div style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
                  Auto-saved {lastAutoSave.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>

          {/* ── Explorer content area ── */}
          <div style={{ padding: 16, minHeight: 340 }}>

            {/* Navigate up button */}
            {!isAtRoot && (
              <div style={{ marginBottom: 14 }}>
                <button
                  onClick={navigateBack}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#475569'; e.currentTarget.style.color = 'white'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.color = '#94a3b8'; }}
                >
                  ← Back
                </button>
              </div>
            )}

            {/* Empty state */}
            {!selectedQuestionTypeId && explorerFolders.length === 0 && explorerWorksheets.length === 0 && (
              <div style={{ textAlign: 'center', padding: '50px 20px' }}>
                <div style={{ fontSize: 52, marginBottom: 14, opacity: 0.6 }}>{isAtRoot ? '📁' : (!!getCurrentNode()?.isCategory ? '🗂️' : '📂')}</div>
                <div style={{ fontSize: 15, fontWeight: 'bold', color: '#64748b', marginBottom: 8 }}>
                  {isAtRoot ? 'No folders yet' : (!!getCurrentNode()?.isCategory ? 'This category is empty' : 'This folder is empty')}
                </div>
                <div style={{ fontSize: 13, color: '#475569', marginBottom: 22 }}>
                  {isAtRoot
                    ? 'Create a folder to get started. Inside folders you can create categories and upload questions.'
                    : (!!getCurrentNode()?.isCategory 
                       ? 'Upload a PDF to extract questions or create one manually.'
                       : 'Create a folder or add categories to this folder.')}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {!!getCurrentNode()?.isCategory ? (
                    <>
                      <button
                        onClick={() => openCategoryUpload(getCurrentNode()!.id)}
                        style={{ padding: '10px 22px', borderRadius: 9, border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.08)', color: '#60a5fa', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}
                      >
                        📤 Upload Questions
                      </button>
                      <button
                        onClick={() => openQuestionEdit({ id: Math.random().toString(36).substr(2, 9), promptBlocks: [], modelAnswer: '', aiTutorNotes: '' }, getCurrentNode()!.id)}
                        style={{ padding: '10px 22px', borderRadius: 9, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.08)', color: '#c4b5fd', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}
                      >
                        ✨ Create New Question
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleAddFolder}
                        style={{ padding: '10px 22px', borderRadius: 9, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.08)', color: '#c4b5fd', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}
                      >
                        📁 New Folder
                      </button>
                      {!isAtRoot && (
                        <>
                          <button
                            onClick={handleAddCategory}
                            style={{ padding: '10px 22px', borderRadius: 9, border: '1px solid rgba(20,184,166,0.4)', background: 'rgba(20,184,166,0.08)', color: '#2dd4bf', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}
                          >
                            🗂️ Create Category
                          </button>
                          <button
                            onClick={() => openCategoryUpload('folder')}
                            style={{ padding: '10px 22px', borderRadius: 9, border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.08)', color: '#60a5fa', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}
                          >
                            📤 Upload Questions
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* File grid */}
            {(() => {
              const currentNode = getCurrentNode();
              const categoryNodeId = currentNode?.isCategory ? currentNode.id : null;
              const drillDownQtId = categoryNodeId ? explorerWorksheets[0]?.id : selectedQuestionTypeId;
              return !drillDownQtId && (explorerFolders.length > 0 || explorerWorksheets.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(172px, 1fr))', gap: 12 }}>

                {/* ── Folder / Category cards ── */}
                {explorerFolders.map((folder) => {
                  const isCategory = !!folder.isCategory;
                  const isWorksheetStack = !isCategory && folder.questionTypes.length > 0 && folder.children.length === 0;
                  const uploadNode = uploadingNodes[folder.id];
                  const accentColor = isCategory ? 'rgba(20,184,166,0.4)' : 'rgba(168,85,247,0.4)';
                  const accentBg = isCategory ? 'rgba(20,184,166,0.08)' : 'rgba(168,85,247,0.08)';
                  const accentText = isCategory ? '#2dd4bf' : '#c4b5fd';
                  const folderIcon = isCategory ? '🗂️' : (isWorksheetStack ? '📑' : '📁');
                  return (
                  <div
                    key={folder.id}
                    style={{ position: 'relative', background: '#1e293b', borderRadius: 13, border: `1px solid ${isCategory ? 'rgba(20,184,166,0.25)' : '#334155'}`, padding: '16px 14px 12px', cursor: uploadNode ? 'default' : 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s', userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
                    onMouseEnter={(e) => { if (!uploadNode) { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.boxShadow = `0 4px 16px ${isCategory ? 'rgba(20,184,166,0.12)' : 'rgba(168,85,247,0.1)'}`; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = isCategory ? 'rgba(20,184,166,0.25)' : '#334155'; e.currentTarget.style.boxShadow = 'none'; }}
                    onClick={() => { if (!uploadNode && editingFolderId !== folder.id) navigateInto(folder.id); }}
                  >
                    {isCategory && (
                      <div style={{ position: 'absolute', top: -6, left: -6, fontSize: 10, background: 'linear-gradient(135deg, #14b8a6, #0d9488)', color: 'white', padding: '3px 8px', borderRadius: 8, fontWeight: 'bold', textTransform: 'uppercase', boxShadow: '0 2px 4px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)', zIndex: 10 }}>
                        Category
                      </div>
                    )}
                    {uploadNode ? (
                      <>
                        <svg width="44" height="44" viewBox="0 0 36 36" style={{ animation: 'spin 2s linear infinite', marginBottom: 10 }}>
                          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(96,165,250,0.2)" strokeWidth="4" />
                          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#60a5fa" strokeWidth="4" strokeDasharray={`${uploadNode.progress}, 100`} strokeLinecap="round" />
                        </svg>
                        <div style={{ color: 'white', fontWeight: 700, fontSize: 13, textAlign: 'center', wordBreak: 'break-word', width: '100%', marginBottom: 4 }}>{folder.title}</div>
                        <div style={{ color: '#60a5fa', fontSize: 11, fontWeight: 'bold', marginBottom: 2 }}>{uploadNode.progress}% Loading...</div>
                        <div style={{ color: '#94a3b8', fontSize: 10, textAlign: 'center', lineHeight: 1.1, marginBottom: 12 }}>{uploadNode.stage}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 44, marginBottom: 10 }}>{folderIcon}</div>
                        {editingFolderId === folder.id ? (
                          <input
                            autoFocus
                            defaultValue={folder.title}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={(e) => e.target.select()}
                            onBlur={(e) => { renameFolder(folder.id, e.target.value.trim() || folder.title); setEditingFolderId(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                            style={{ width: '100%', padding: '4px', textAlign: 'center', background: '#0f172a', color: 'white', border: `1px solid ${isCategory ? '#14b8a6' : '#a855f7'}`, borderRadius: 4, outline: 'none', marginBottom: 4 }}
                          />
                        ) : (
                          <div style={{ color: 'white', fontWeight: 700, fontSize: 13, textAlign: 'center', wordBreak: 'break-word', width: '100%', marginBottom: 4, lineHeight: 1.3 }}>
                            {folder.title}
                          </div>
                        )}
                        <div style={{ color: '#64748b', fontSize: 11, marginBottom: 12, textAlign: 'center' }}>
                          {isCategory ? (() => {
                            let qCount = 0;
                            try { qCount = folder.questionTypes[0] ? (JSON.parse(folder.questionTypes[0].jsonText) as any[]).length : 0; } catch {}
                            return qCount > 0 ? `${qCount} question${qCount !== 1 ? 's' : ''}` : 'No questions yet';
                          })() : isWorksheetStack ? (
                            `${folder.questionTypes.length} question type${folder.questionTypes.length !== 1 ? 's' : ''}`
                          ) : (
                            (() => {
                              const cats = folder.children.filter(c => c.isCategory).length;
                              const subs = folder.children.filter(c => !c.isCategory && !(c.questionTypes.length > 0 && c.children.length === 0)).length;
                              const sheets = folder.children.filter(c => c.questionTypes.length > 0 && c.children.length === 0).length + folder.questionTypes.length;
                              return [
                                cats > 0 && `${cats} categor${cats > 1 ? 'ies' : 'y'}`,
                                subs > 0 && `${subs} folder${subs > 1 ? 's' : ''}`,
                                sheets > 0 && `${sheets} sheet${sheets > 1 ? 's' : ''}`,
                              ].filter(Boolean).join(' · ') || 'Empty';
                            })()
                          )}
                        </div>
                      </>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigateInto(folder.id); }}
                        disabled={!!uploadNode}
                        style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: `1px solid ${accentColor}`, background: accentBg, color: accentText, cursor: uploadNode ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: uploadNode ? 0.5 : 1 }}
                      >
                        Open
                      </button>
                      {isWorksheetStack && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingWorksheetId(folder.id); setView('worksheetEditor'); }}
                          disabled={!!uploadNode}
                          style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.1)', color: '#93c5fd', cursor: uploadNode ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: uploadNode ? 0.5 : 1 }}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingFolderId(folder.id); }}
                        disabled={!!uploadNode}
                        style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: uploadNode ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: uploadNode ? 0.5 : 1 }}
                      >
                        Rename
                      </button>
                      <button
                        onClick={async (e) => { e.stopPropagation(); if (await confirm(`Delete "${folder.title}" and all its contents?`)) deleteFolder(folder.id); }}
                        disabled={!!uploadNode}
                        style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#f87171', cursor: uploadNode ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: uploadNode ? 0.5 : 1 }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )})}

                {/* ── Worksheet cards ── */}
                {explorerWorksheets.map((qt) => {
                  let qCount = 0;
                  try { qCount = (JSON.parse(qt.jsonText) as unknown[]).length; } catch { /* empty worksheet */ }
                  return (
                    <div
                      key={qt.id}
                      onClick={() => setSelectedQuestionTypeId(qt.id)}
                      style={{ cursor: 'pointer', background: '#1e293b', borderRadius: 13, border: '1px solid rgba(59,130,246,0.22)', padding: '16px 14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: 'border-color 0.15s' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.5)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(59,130,246,0.15)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.22)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div style={{ fontSize: 40, marginBottom: 10 }}>📄</div>
                      <div style={{ color: 'white', fontWeight: 700, fontSize: 13, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', marginBottom: 6 }}>
                        {qt.title}
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: 'rgba(59,130,246,0.12)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.25)' }}>
                          {qCount} question{qCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <button
                        onClick={async (e) => { e.stopPropagation(); if (await confirm(`Delete "${qt.title}"?`)) deleteWorksheet(qt.id); }}
                        style={{ padding: '4px 14px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        Delete
                      </button>
                    </div>
                  );
                })}

                </div>
              )}
            )()}
            
            {/* ── Question Drill-down View (legacy worksheets & inside categories) ── */}
            {(() => {
              const currentNode = getCurrentNode();
              const categoryNodeId = currentNode?.isCategory ? currentNode.id : null;
              const drillDownQtId = categoryNodeId ? explorerWorksheets[0]?.id : selectedQuestionTypeId;
              if (!drillDownQtId) return null;

              const qt = explorerWorksheets.find(q => q.id === drillDownQtId);
              if (!qt) return <div style={{ color: '#64748b' }}>Not found.</div>;
              let questions: any[] = [];
              try { questions = JSON.parse(qt.jsonText); } catch {}

              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    {!categoryNodeId && (
                      <button
                        onClick={() => setSelectedQuestionTypeId(null)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
                      >
                        ← Back to folder
                      </button>
                    )}

                    <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>{qt.title} — {questions.length} question{questions.length !== 1 ? 's' : ''}</div>
                  </div>
                  {questions.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: '#64748b' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
                      <div>No questions yet. Upload a PDF to extract questions.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
                      {questions.map((q, idx) => {
                        const textPreview = stripLatex(q.promptBlocks?.[0]?.text || q.rawText || q.question || 'No text');
                        return (
                          <div
                            key={q.id || idx}
                            style={{ background: '#1e293b', borderRadius: 12, border: '1px solid rgba(59,130,246,0.2)', padding: 16, transition: 'all 0.15s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.45)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)'; e.currentTarget.style.transform = 'none'; }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                              <div style={{ color: '#93c5fd', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5 }}>Q{idx + 1}</div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {q.aiTutorNotes && <span title="Has AI tutor notes" style={{ fontSize: 13 }}>📌</span>}
                                {categoryNodeId && (
                                  <>
                                    <button
                                      onClick={() => openQuestionEdit(q, categoryNodeId)}
                                      style={{ padding: '2px 8px', fontSize: 10, borderRadius: 5, border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.08)', color: '#93c5fd', cursor: 'pointer', fontFamily: 'inherit' }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => deleteQuestion(q.id, categoryNodeId)}
                                      style={{ padding: '2px 8px', fontSize: 10, borderRadius: 5, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#fca5a5', cursor: 'pointer', fontFamily: 'inherit' }}
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => setActiveWhiteboardQuestion(q)}
                                  style={{ padding: '2px 8px', fontSize: 10, borderRadius: 5, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.08)', color: '#c4b5fd', cursor: 'pointer', fontFamily: 'inherit' }}
                                >
                                  ✏️ Board
                                </button>
                              </div>
                            </div>
                            <div style={{ color: 'white', fontSize: 13, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {textPreview}
                            </div>
                            {q.modelAnswer && (
                              <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 7, fontSize: 11, color: '#6ee7b7' }}>
                                ✔ {stripLatex(q.modelAnswer).slice(0, 100)}{stripLatex(q.modelAnswer).length > 100 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          LIST VIEW  —  browse published + draft programs
          ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'list' && (
        <>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>📚 Programs ({items.length})</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>↺ Refresh</button>
              <button
                onClick={() => { setView('setup'); setSetupName(''); setSetupEmoji(''); setSetupSubject(''); setEditingId(null); setEditingDraftId(null); }}
                className="ll-btn ll-btn-primary"
                style={{ padding: '7px 14px', fontSize: 12, background: '#a855f7', borderColor: '#7c3aed', color: 'white' }}
              >
                + New
              </button>
            </div>
          </div>

          {/* Drafts */}
          <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>📝 Drafts ({draftItems.length})</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>Only visible to superadmins</div>
            </div>
            <div style={{ padding: 12 }}>
              {draftItems.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 12 }}>No drafts yet. Create a new program and save it as a draft.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {draftItems.map((d) => {
                    const isPublishing = !!publishingIds[d.id];
                    return (
                    <div key={d.id} style={{ position: 'relative', borderRadius: 12, border: isPublishing ? '1px solid rgba(16,185,129,0.4)' : '1px solid #1f2a44', background: isPublishing ? 'rgba(16,185,129,0.04)' : 'rgba(2,6,23,0.25)', overflow: 'hidden' }}>
                      {/* Publishing progress shimmer bar */}
                      {isPublishing && (
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'rgba(16,185,129,0.2)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: 'linear-gradient(90deg, transparent 0%, #10b981 50%, transparent 100%)', animation: 'shimmer 1.5s infinite', backgroundSize: '200% 100%' }} />
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                        <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{d.coverEmoji ?? '📝'}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title ?? d.id}</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>
                            {d.subject ?? 'subject'}{d.grade_band ? ` • ${d.grade_band}` : ''}
                            {isPublishing && <span style={{ marginLeft: 8, color: '#34d399', fontWeight: 600, fontSize: 10 }}>⏳ Publishing...</span>}
                          </div>
                        </div>
                        <button onClick={() => previewDraft(d.id)} className="ll-btn" disabled={isPublishing} style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
                        <button onClick={() => startEditDraft(d)} className="ll-btn" disabled={isPublishing} style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
                        <button onClick={() => publishDraftFromList(d)} className="ll-btn" disabled={isPublishing} style={{ padding: '5px 10px', fontSize: 11, background: '#10b981', borderColor: '#059669', color: 'white' }}>Publish</button>
                        <button onClick={() => removeDraft(d.id)} className="ll-btn" disabled={isPublishing} style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Published */}
          <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
            {items.length === 0 ? (
              <div style={{ padding: 18, color: '#64748b' }}>No public programs yet.</div>
            ) : (
              items.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #0f172a' }}>
                  <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{p.coverEmoji ?? '📘'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title ?? p.id}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{p.subject ?? 'subject'}{p.grade_band ? ` • ${p.grade_band}` : ''}</div>
                  </div>
                  <button onClick={() => previewPublished(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
                  <button onClick={() => startEditPublished(p)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
                  <button onClick={() => unpublishProgramFromList(p)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, background: '#f59e0b', borderColor: '#d97706', color: 'white' }}>Unpublish</button>
                  <button onClick={() => removePublished(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          WHITEBOARD OVERLAY
          ═══════════════════════════════════════════════════════════════════════ */}
      {activeWhiteboardQuestion && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 5000, background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
           <FullScreenWorkspace 
             currentQuestion={activeWhiteboardQuestion}
             onClose={() => setActiveWhiteboardQuestion(null)}
             initialPages={adminWhiteboardData[activeWhiteboardQuestion.id] ?? undefined}
             onPagesChange={(pages) => setAdminWhiteboardData(prev => ({...prev, [activeWhiteboardQuestion.id]: pages}))}
           />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          CATEGORY UPLOAD MODAL — Pipeline + Classification Review
          ═══════════════════════════════════════════════════════════════════════ */}
      {categoryUploadOpen && (
        <div
          onClick={() => { if (!categoryUploading) { setCategoryUploadOpen(false); setClassificationResult(null); } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(720px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: '#0f172a', borderRadius: 20, border: '2px solid rgba(20,184,166,0.35)', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}
          >
            {/* Header */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, rgba(20,184,166,0.12), rgba(59,130,246,0.08))', borderRadius: '18px 18px 0 0' }}>
              <div style={{ fontSize: 22 }}>📤</div>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 15, flex: 1 }}>Upload Questions to Category</div>
              {!categoryUploading && !classificationResult && (
                <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setCategoryUploadOpen(false)}>✕</button>
              )}
            </div>

            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Phase 1: File upload (hidden once pipeline started) */}
              {!categoryUploading && !classificationResult && (
                <>
                  <div style={{ background: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 10, padding: '14px 16px', fontSize: 13, color: '#5eead4', lineHeight: 1.6 }}>
                    <strong>Upload a PDF</strong> — Questions will be extracted and automatically classified into the categories you have created in this folder.
                  </div>
                  <div
                    onDragEnter={(e) => { e.preventDefault(); setCategoryUploadDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setCategoryUploadDragActive(false); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); setCategoryUploadDragActive(false); const f = e.dataTransfer.files[0]; if (f) handleCategoryUploadFile(f); }}
                    style={{ border: `2px dashed ${categoryUploadDragActive ? '#14b8a6' : '#334155'}`, background: categoryUploadDragActive ? 'rgba(20,184,166,0.06)' : '#1e293b', borderRadius: 16, padding: '36px 20px', textAlign: 'center', transition: 'all 0.2s', position: 'relative', cursor: 'pointer' }}
                  >
                    <input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCategoryUploadFile(f); }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                    <div style={{ fontSize: 38, marginBottom: 10 }}>{categoryUploadFile ? '📑' : (categoryUploadDragActive ? '📥' : '📄')}</div>
                    {categoryUploadFile ? (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 'bold', color: 'white', marginBottom: 4 }}>{categoryUploadFile.name}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>Click to change</div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 'bold', color: '#94a3b8', marginBottom: 4 }}>Drag & Drop or click to browse</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>PDF, PNG, JPG supported</div>
                      </>
                    )}
                  </div>
                  {categoryUploadFile && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#94a3b8', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={categoryUploadForceOcr}
                          onChange={(e) => setCategoryUploadForceOcr(e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        Force OCR (Slower, fixes missing numbers/math)
                      </label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="ll-btn" onClick={() => setCategoryUploadFile(null)} style={{ padding: '8px 14px', fontSize: 12 }}>Clear</button>
                        <button
                          onClick={runCategoryUploadPhase1}
                          style={{ padding: '10px 22px', fontSize: 13, fontWeight: 'bold', background: 'linear-gradient(135deg, #14b8a6, #3b82f6)', border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          Extract Text 📄
                        </button>
                      </div>
                    </div>
                  )}
                  {categoryUploadError && (
                    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '12px 16px', color: '#fca5a5', fontSize: 13 }}>
                      ❌ {categoryUploadError}
                    </div>
                  )}
                </>
              )}

              {/* Phase 2: Pipeline running */}
              {categoryUploading && (
                <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid rgba(20,184,166,0.3)', borderTopColor: '#14b8a6', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    <div style={{ color: 'white', fontWeight: 700, fontSize: 14 }}>Processing PDF...</div>
                  </div>
                  <div style={{ fontSize: 13, color: '#5eead4', lineHeight: 1.6 }}>{categoryUploadStage}</div>
                  <div style={{ marginTop: 12, height: 4, background: '#334155', borderRadius: 9999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg, #14b8a6, #3b82f6)', animation: 'shimmer 2s infinite', backgroundSize: '200% 100%', borderRadius: 9999 }} />
                  </div>
                </div>
              )}

              {/* Phase 1.5: Text Review */}
              {categoryUploadRawText && !classificationResult && !categoryUploading && (
                <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', marginBottom: 8 }}>Review Extracted Text</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                    Please review the text below. If any numbers or math symbols are missing, you can edit the text directly before generating questions.
                  </div>
                  <textarea
                    value={categoryUploadRawText}
                    onChange={(e) => setCategoryUploadRawText(e.target.value)}
                    style={{ width: '100%', height: 300, padding: 12, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: '#f8fafc', fontSize: 13, fontFamily: 'monospace', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                    <button className="ll-btn" onClick={() => setCategoryUploadRawText('')} style={{ padding: '8px 14px', fontSize: 12 }}>Back</button>
                    <button
                      onClick={runCategoryUploadPhase2}
                      style={{ padding: '10px 22px', fontSize: 13, fontWeight: 'bold', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', border: 'none', borderRadius: 8, color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Generate Questions ✨
                    </button>
                  </div>
                </div>
              )}

              {/* Phase 3: Classification review */}
              {classificationResult && !categoryUploading && (() => {
                const visibleItems = classificationResult.questions.filter(item => !classificationDeleted.has(item.question.id));
                const categories = [...new Set(classificationResult.questions.map(i => i.suggestedCategory))];
                const siblingCategoryNames = (() => {
                  const parentNode = builderPathIds.length <= 1 ? getFixedContainer() : getCurrentNode();
                  return (parentNode?.children ?? []).filter(c => c.isCategory).map(c => c.title);
                })();

                return (
                  <>
                    <div style={{ background: 'rgba(20,184,166,0.07)', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 10, padding: '12px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#2dd4bf', marginBottom: 4 }}>✅ Classification Ready!</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {visibleItems.length} question{visibleItems.length !== 1 ? 's' : ''} classified — review and confirm, or move/edit/delete questions below.
                      </div>
                    </div>

                    {/* Questions grouped by category */}
                    {categories.map(cat => {
                      const catItems = visibleItems.filter(i => (classificationAssignments[i.question.id] ?? i.suggestedCategory) === cat);
                      if (catItems.length === 0) return null;
                      return (
                        <div key={cat} style={{ background: '#1e293b', border: '1px solid rgba(20,184,166,0.2)', borderRadius: 12, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 14px', borderBottom: '1px solid #334155', background: 'rgba(20,184,166,0.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14 }}>🗂️</span>
                            <span style={{ color: '#2dd4bf', fontWeight: 700, fontSize: 13 }}>{cat}</span>
                            <span style={{ color: '#64748b', fontSize: 11 }}>({catItems.length})</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {catItems.map((item, idx) => (
                              <div key={item.question.id} style={{ padding: '10px 14px', borderBottom: idx < catItems.length - 1 ? '1px solid #1e293b' : 'none' }}>
                                {reviewEditingQuestionId === item.question.id ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <textarea
                                      value={reviewEditText}
                                      onChange={(e) => setReviewEditText(e.target.value)}
                                      style={{ width: '100%', minHeight: 80, padding: '8px 10px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
                                    />
                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                      <button className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => setReviewEditingQuestionId(null)}>Cancel</button>
                                      <button
                                        style={{ padding: '5px 12px', fontSize: 11, fontWeight: 'bold', background: '#14b8a6', border: 'none', borderRadius: 6, color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}
                                        onClick={() => {
                                          setClassificationResult(prev => prev ? ({
                                            ...prev,
                                            questions: prev.questions.map(q => q.question.id === item.question.id ? { ...q, question: { ...q.question, rawText: reviewEditText } } : q)
                                          }) : null);
                                          setReviewEditingQuestionId(null);
                                        }}
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1, color: 'white', fontSize: 13, lineHeight: 1.5 }}>
                                      {item.question.rawText.slice(0, 200)}{item.question.rawText.length > 200 ? '...' : ''}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                                      {/* Move to another category */}
                                      <select
                                        value={classificationAssignments[item.question.id] ?? item.suggestedCategory}
                                        onChange={(e) => setClassificationAssignments(prev => ({ ...prev, [item.question.id]: e.target.value }))}
                                        style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #475569', background: '#0f172a', color: 'white', fontSize: 11, cursor: 'pointer' }}
                                      >
                                        {siblingCategoryNames.map(n => <option key={n} value={n}>{n}</option>)}
                                      </select>
                                      <button
                                        onClick={() => { setReviewEditingQuestionId(item.question.id); setReviewEditText(item.question.rawText); }}
                                        style={{ padding: '3px 8px', fontSize: 10, borderRadius: 5, border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.08)', color: '#93c5fd', cursor: 'pointer', fontFamily: 'inherit' }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => setClassificationDeleted(prev => { const s = new Set(prev); s.add(item.question.id); return s; })}
                                        style={{ padding: '3px 8px', fontSize: 10, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 4 }}>
                      <button className="ll-btn" style={{ padding: '9px 16px', fontSize: 13 }} onClick={() => { setCategoryUploadOpen(false); setClassificationResult(null); }}>Cancel</button>
                      <button
                        onClick={confirmClassification}
                        disabled={visibleItems.length === 0}
                        style={{ padding: '9px 22px', fontSize: 13, fontWeight: 'bold', background: 'linear-gradient(135deg, #14b8a6, #3b82f6)', border: 'none', borderRadius: 9, color: 'white', cursor: visibleItems.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: visibleItems.length === 0 ? 0.5 : 1 }}
                      >
                        Confirm & Add Questions ✓
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          QUESTION EDIT POPUP
          ═══════════════════════════════════════════════════════════════════════ */}
      {editingQuestion && (
        <div
          onClick={() => setEditingQuestion(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 7000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(620px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: '#0f172a', borderRadius: 20, border: '2px solid rgba(59,130,246,0.35)', boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.08))', borderRadius: '18px 18px 0 0' }}>
              <div style={{ fontSize: 20 }}>✏️</div>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 15, flex: 1 }}>Edit Question</div>
              <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setEditingQuestion(null)}>✕</button>
            </div>
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 900, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' }}>Question Text</label>
                <textarea
                  value={editQText}
                  onChange={(e) => setEditQText(e.target.value)}
                  rows={6}
                  style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 900, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' }}>Model Answer</label>
                <textarea
                  value={editQModelAnswer}
                  onChange={(e) => setEditQModelAnswer(e.target.value)}
                  rows={4}
                  placeholder="The expected correct answer..."
                  style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid #475569', background: 'rgba(0,0,0,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 900, letterSpacing: 0.7, marginBottom: 8, textTransform: 'uppercase' }}>Notes for AI Tutor 📌</label>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>These notes are considered by the AI tutor when helping students solve this question.</div>
                <textarea
                  value={editQNotes}
                  onChange={(e) => setEditQNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Students often confuse permutations with combinations here. Remind them that order matters..."
                  style={{ width: '100%', padding: '10px 13px', borderRadius: 10, border: '1px solid rgba(168,85,247,0.35)', background: 'rgba(168,85,247,0.04)', color: 'white', fontFamily: 'inherit', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.6 }}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                <button className="ll-btn" style={{ padding: '9px 16px', fontSize: 13 }} onClick={() => setEditingQuestion(null)}>Cancel</button>
                <button
                  onClick={saveQuestionEdit}
                  style={{ padding: '9px 22px', fontSize: 13, fontWeight: 'bold', background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', border: 'none', borderRadius: 9, color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Save Changes ✓
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          WORKSHEET EDITOR VIEW
          ═══════════════════════════════════════════════════════════════════════ */}
      {view === 'worksheetEditor' && editingWorksheetId && (
        <div style={{ height: 'calc(100vh - 120px)', minHeight: 600, background: '#0f172a', borderRadius: 14, border: '1px solid #334155', overflow: 'hidden' }}>
          {(() => {
            function findNode(n: BuilderNode, targetId: string): BuilderNode | null {
              if (n.id === targetId) return n;
              for (const child of n.children) {
                const res = findNode(child, targetId);
                if (res) return res;
              }
              return null;
            }
            
            const worksheetNode = findNode(builder.root, editingWorksheetId);
            if (!worksheetNode) return <div style={{ color: '#f87171', padding: 20 }}>Worksheet not found.</div>;
            
            return (
              <WorksheetEditorView
                worksheetNode={worksheetNode}
                onUpdate={(updater) => setBuilderAtNode(editingWorksheetId, updater)}
                onClose={() => { setView('explorer'); setEditingWorksheetId(null); }}
              />
            );
          })()}
        </div>
      )}

    </div>
  );
}
