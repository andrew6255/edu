import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  assignProgramToUser,
  listPublicPrograms,
  removeProgramFromUser,
  toggleActiveProgramForUser,
  purgeProgramFromUser,
  type PublicProgram,
} from '@/lib/programMaps';
import EditProgramModal from './EditProgramModal';
import ProcessingDetailsModal from './ProcessingDetailsModal';
import {
  deletePersonalProgram,
  listMyPersonalPrograms,
  renamePersonalProgram,
  updateProcessingStage,
  type PersonalProgramMeta,
} from '@/lib/personalProgramService';
import { type PersonalSubject, listPersonalSubjects } from '@/lib/personalSubjectService';
import {
  runPhase1Ocr,
  runPhase2Questions,
  runPhase3Enrichment,
  createDebugLog,
  saveDebugLogToFile,
  type PipelineDebugLog,
} from '@/lib/localOcrPipeline';

interface Props {
  open: boolean;
  onClose: () => void;
  subjectId?: string | null;
}

export default function MyProgramsModal({ open, onClose, subjectId }: Props) {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { user, userData, refreshUserData } = useAuth();
  const [tab, setTab] = useState<'create' | 'current' | 'search'>('create');
  const [loading, setLoading] = useState(false);
  const [programs, setPrograms] = useState<PublicProgram[]>([]);
  const [query, setQuery] = useState('');

  // Personal Programs State
  const [personalPrograms, setPersonalPrograms] = useState<PersonalProgramMeta[]>([]);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');
  const [renamingProgramId, setRenamingProgramId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<PipelineDebugLog | null>(null);
  const [selectedProcessingProgram, setSelectedProcessingProgram] = useState<PersonalProgramMeta | null>(null);
  const [subjects, setSubjects] = useState<PersonalSubject[]>([]);

  const assignedIds: string[] = userData?.assignedProgramIds ?? [];
  const activeIds: string[] = userData?.activeProgramIds ?? (userData?.activeProgramId ? [userData.activeProgramId] : []);
  const completedIds: string[] = userData?.completedProgramIds ?? [];

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const items = await listPublicPrograms();
        if (!alive) return;
        setPrograms(items);

        // Lazy cleanup: if user has program IDs that no longer exist / were deleted, purge them.
        if (user && userData) {
          const visible = new Set(items.map((p) => p.id));
          const allIds = new Set<string>([
            ...(userData.assignedProgramIds ?? []),
            ...(userData.activeProgramIds ?? []),
            ...((userData.activeProgramId ? [userData.activeProgramId] : []) as string[]),
            ...(userData.completedProgramIds ?? []),
          ]);
          const missing = Array.from(allIds).filter((id) => id && !visible.has(id));
          if (missing.length > 0) {
            await Promise.all(missing.map((id) => purgeProgramFromUser(user.uid, id)));
            await refreshUserData();
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [open, user?.uid]);

  // Load personal programs
  useEffect(() => {
    if (!user) return;
    let alive = true;
    listMyPersonalPrograms(user.uid).then(list => {
      if (alive) setPersonalPrograms(list);
    });
    const fetchSubjects = () => {
      listPersonalSubjects(user.uid).then(list => {
        if (alive) setSubjects(list);
      });
    };
    fetchSubjects();
    window.addEventListener('ll:subjectsUpdated', fetchSubjects);
    return () => { 
      alive = false; 
      window.removeEventListener('ll:subjectsUpdated', fetchSubjects);
    };
  }, [user]);

  // Poll processing programs
  useEffect(() => {
    if (!open || !user) return;
    const processing = personalPrograms.filter(p => p.status === 'processing');
    if (processing.length === 0) return;

    let alive = true;
    const interval = setInterval(async () => {
      const { refreshPersonalProgramStatus } = await import('@/lib/personalProgramService');
      const updatedList = await Promise.all(
        personalPrograms.map(async p => {
          if (p.status !== 'processing') return p;
          try {
            return await refreshPersonalProgramStatus(user.uid, p.jobId);
          } catch {
            return p;
          }
        })
      );
      if (alive) setPersonalPrograms(updatedList);
    }, 5000);

    return () => { alive = false; clearInterval(interval); };
  }, [open, user, personalPrograms]);

  const programsById = useMemo(() => {
    const m = new Map<string, PublicProgram>();
    for (const p of programs) m.set(p.id, p);
    return m;
  }, [programs]);

  const myCurrent = useMemo(() => {
    return assignedIds
      .map((id) => programsById.get(id) ?? ({ id, title: id, toc: { program_id: id, toc_tree: [] } } as PublicProgram))
      .filter((p: PublicProgram) => !completedIds.includes(p.id));
  }, [assignedIds, completedIds, programsById]);

  const myFinished = useMemo(() => {
    return completedIds
      .map((id) => programsById.get(id) ?? ({ id, title: id, toc: { program_id: id, toc_tree: [] } } as PublicProgram));
  }, [completedIds, programsById]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return programs;
    return programs.filter((p) => p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [programs, query]);

  if (!open) return null;

  if (!user || !userData) return null;

  const uid = user.uid;

  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  async function handleAssign(programId: string) {
    await assignProgramToUser(uid, programId);
    await refreshUserData();
  }

  async function handleToggleActive(programId: string) {
    await toggleActiveProgramForUser(uid, programId);
    await refreshUserData();
  }

  async function handleDelete(programId: string) {
    if (!(await confirm('Remove this program from your profile?'))) return;
    await removeProgramFromUser(uid, programId);
    await refreshUserData();
    window.dispatchEvent(new CustomEvent('ll:programDeleted', { detail: { programId } }));
  }

  async function handleDeletePersonal(e: React.MouseEvent, jobId: string) {
    e.stopPropagation();
    if (!user) return;
    if (!(await confirm('Are you sure you want to delete this program?'))) return;
    try {
      const { deletePersonalProgram } = await import('@/lib/personalProgramService');
      await deletePersonalProgram(user.uid, jobId);
      setPersonalPrograms(prev => prev.filter(p => p.jobId !== jobId));
      window.dispatchEvent(new CustomEvent('ll:personalProgramDeleted', { detail: { jobId } }));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete program');
    }
  }


  // File drag & drop handling
  function handleDrag(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const files = Array.from(e.dataTransfer.files).filter(f => 
        f.type === 'application/pdf' || f.type.startsWith('image/')
      );
      if (files.length > 0) {
        setUploadFiles(files);
        if (!uploadTitle) {
          setUploadTitle(files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
        }
      }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const files = Array.from(e.target.files).filter(f => 
        f.type === 'application/pdf' || f.type.startsWith('image/')
      );
      if (files.length > 0) {
        setUploadFiles(files);
        if (!uploadTitle) {
          setUploadTitle(files[0].name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
        }
      }
    }
  }

  async function handleCreatePersonalProgram() {
    if (!user || uploadFiles.length === 0) return;
    setUploading(true);
    setUploadProgress('Initializing...');
    const file = uploadFiles[0]!;
    const title = uploadTitle || file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

    try {
      const { createPersonalProgram } = await import('@/lib/personalProgramService');
      const meta = await createPersonalProgram(user.uid, title, file, subjectId || undefined);

      // Reset state BEFORE closing so we don't call setState on an unmounted component
      // (which triggers the React "Expected static flag was missing" internal error)
      setUploading(false);
      setUploadProgress('');
      setUploadFiles([]);
      setUploadTitle('');

      // Dispatch event so HexUniverseView renders it immediately
      window.dispatchEvent(new CustomEvent('ll:personalProgramCreated', { detail: { program: meta } }));

      // Close modal AFTER all state has been reset
      onClose();

      // Run background pipeline — each step writes its stage to Supabase
      // so the ProcessingDetailsModal shows real progress.
      (async () => {
        const uid = user.uid;
        const jobId = meta.jobId;
        const { getUserDoc, setUserDoc } = await import('@/lib/supabaseDocStore');
        try {
          // ── Stage: OCR ──────────────────────────────────────────────────
          await updateProcessingStage(uid, jobId, 'ocr');
          const phase1 = await runPhase1Ocr(file, title, () => {});

          // ── Stage: Extracting questions ──────────────────────────────────
          await updateProcessingStage(uid, jobId, 'extracting_questions');
          const phase2 = await runPhase2Questions(phase1.rawText, () => {});

          // ── Stage: Enriching questions ───────────────────────────────────
          await updateProcessingStage(uid, jobId, 'enriching_questions');
          const enrichedTopics = await runPhase3Enrichment(phase2.topics, () => {});


          // ── Stage: Building program structure ────────────────────────────
          await updateProcessingStage(uid, jobId, 'building_program');

          const programData: any = {
            title: meta.title,
            subject: 'Custom',
            totalQuestions: 0,
            chapters: [],
            questions: [],
          };

          let qIndex = 0;
          const chapter = {
            id: 'ch1',
            title: 'Extracted Content',
            topics: enrichedTopics.map((t, tIdx) => {
              const questionIds = t.questions.map((q: any) => {
                qIndex++;
                const newQId = `q${qIndex}`;
                programData.questions.push({
                  id: newQId,
                  questionLabel: q.label || '',
                  rawText: (q.rawText || q.label || '').trim(),
                  page: q.page || 1,
                  difficulty: 'medium',
                  modelAnswer: q.modelAnswer,
                  answerFromPdf: q.answerFromPdf,
                  solution: q.solution,
                  solutionPlan: q.solutionPlan,
                  hint: q.hint,
                  gradingSchema: q.gradingSchema,
                });
                return newQId;
              });
              return {
                id: t.id || `t${tIdx}`,
                title: t.title,
                questionTypeTitle: t.title,
                questionIds,
              };
            }),
          };

          programData.chapters.push(chapter);
          programData.totalQuestions = programData.questions.length;

          // ── Stage: Saving ────────────────────────────────────────────────
          await updateProcessingStage(uid, jobId, 'saving');

          const existing = await getUserDoc(uid, 'personal_programs', jobId);
          if (existing) {
            await setUserDoc(uid, 'personal_programs', jobId, {
              ...existing,
              status: 'ready',
              processingStage: undefined,
              programData,
            });
          }
        } catch (err) {
          console.error('Background processing failed:', err);
          const rawMsg = err instanceof Error ? err.message : String(err);
          // Produce a human-readable message for the most common failure modes
          let friendlyMsg = rawMsg;
          if (rawMsg.includes('tokens per day') || rawMsg.includes('TPD') || rawMsg.includes('Rate limit reached')) {
            friendlyMsg = 'The AI service has reached its daily usage limit. Please try again in about 1 hour.';
          } else if (rawMsg.includes('tokens per minute') || rawMsg.includes('TPM') || rawMsg.includes('429')) {
            friendlyMsg = 'The AI service is temporarily busy (rate limited). Please wait a minute and try again.';
          } else if (rawMsg.includes('500') || rawMsg.includes('INTERNAL SERVER')) {
            friendlyMsg = 'The OCR server encountered an error. Check that it is running and try again.';
          }
          const existing = await getUserDoc(uid, 'personal_programs', jobId);
          if (existing) {
            await setUserDoc(uid, 'personal_programs', jobId, {
              ...existing,
              status: 'failed',
              errorMessage: friendlyMsg,
            });
          }
        }

      })();

    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', description: 'Failed to start program creation:\n\n' + (err instanceof Error ? err.message : String(err)) });
      setUploading(false);
    }
  }

  async function handleRenameSubmit(jobId: string) {
    if (!user || !renameTitle.trim()) return;
    try {
      const updated = await renamePersonalProgram(user.uid, jobId, renameTitle.trim());
      setPersonalPrograms(prev => prev.map(p => p.jobId === jobId ? updated : p));
      setRenamingProgramId(null);
      window.dispatchEvent(new CustomEvent('ll:personalProgramCreated', { detail: { program: updated } }));
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', description: 'Failed to rename program' });
    }
  }

  const panelStyle: React.CSSProperties = {
    width: 'min(920px, 94vw)',
    maxHeight: '86vh',
    overflow: 'hidden',
    background: 'var(--ll-surface-0)',
    borderRadius: 18,
    border: '2px solid var(--ll-border)',
    boxShadow: '0 30px 80px rgba(0,0,0,0.65)',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerBtn = (active: boolean): React.CSSProperties => ({
    padding: '8px 12px',
    borderRadius: 10,
    border: `1px solid ${active ? 'var(--ll-border-strong)' : 'var(--ll-border)'}`,
    background: active ? 'color-mix(in srgb, var(--ll-accent) 14%, transparent)' : 'transparent',
    color: active ? 'var(--ll-text)' : 'var(--ll-text-soft)',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  const rowStyle: React.CSSProperties = {
    background: 'var(--ll-surface-1)',
    border: '1px solid var(--ll-border)',
    borderRadius: 12,
    padding: '12px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  function ProgramRow({ p, showAssign }: { p: PublicProgram; showAssign: boolean }) {
    const assigned = assignedIds.includes(p.id);
    const isActive = activeIds.includes(p.id);
    const isCompleted = completedIds.includes(p.id);

    const status = isCompleted ? 'Completed' : isActive ? 'Active' : assigned ? 'Deactivated' : 'Not added';

    return (
      <div style={rowStyle}>
        <div style={{ width: 32, textAlign: 'center', fontSize: 18 }}>{p.coverEmoji || '📘'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--ll-text)', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.title}
          </div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 11 }}>
            {status}{p.grade_band ? ` • ${p.grade_band}` : ''}
          </div>
        </div>

        {showAssign ? (
          assigned ? (
            <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 11, cursor: 'default', opacity: 0.7 }} disabled>
              Assigned
            </button>
          ) : (
            <button className="ll-btn ll-btn-primary" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => handleAssign(p.id)}>
              Assign
            </button>
          )
        ) : assigned ? (
          <>
            <button
              className={isActive ? 'll-btn' : 'll-btn ll-btn-primary'}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                ...(isActive ? {} : { background: '#10b981', borderColor: '#059669', color: 'white' }),
              }}
              onClick={() => handleToggleActive(p.id)}
              disabled={isCompleted}
              title={isCompleted ? 'Completed programs cannot be activated (for now)' : ''}
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.5)', color: '#fca5a5' }} onClick={() => handleDelete(p.id)}>
              Delete
            </button>
          </>
        ) : null}
      </div>
    );
  }

  // Filter personal programs to the current subject
  const subjectPersonalPrograms = personalPrograms.filter(p => p.subjectId === subjectId);

  const renderPersonalProgramsList = (showTitle: boolean = true) => {
    if (subjectPersonalPrograms.length === 0) return null;
    return (
      <div style={{ marginTop: showTitle ? 8 : 0 }}>
        {showTitle && <h3 style={{ fontSize: 14, color: 'var(--ll-text)', margin: '0 0 12px' }}>Your Personal Programs</h3>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {subjectPersonalPrograms.map(p => {
            const isProcessing = p.status === 'processing';
            const isFailed = p.status === 'failed';

            return (
              <div
                key={p.programId}
                style={{
                  ...rowStyle,
                  cursor: isProcessing ? 'pointer' : 'default',
                  transition: 'background 0.15s',
                }}
                onClick={isProcessing ? () => setSelectedProcessingProgram(p) : undefined}
                title={isProcessing ? 'Click to see processing details' : undefined}
              >
                <div style={{ width: 32, textAlign: 'center', fontSize: 18 }}>
                  {isProcessing
                    ? <div style={{ animation: 'pulse 1.5s ease infinite' }}>⚙️</div>
                    : isFailed ? '❌' : p.coverEmoji || '📄'}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {renamingProgramId === p.programId ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        autoFocus
                        value={renameTitle}
                        onChange={e => setRenameTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleRenameSubmit(p.programId);
                          if (e.key === 'Escape') setRenamingProgramId(null);
                        }}
                        style={{ flex: 1, padding: '4px 8px', fontSize: 13, borderRadius: 4, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)' }}
                      />
                      <button className="ll-btn" onClick={() => handleRenameSubmit(p.programId)} style={{ padding: '4px 8px', fontSize: 11 }}>Save</button>
                      <button className="ll-btn" onClick={() => setRenamingProgramId(null)} style={{ padding: '4px 8px', fontSize: 11 }}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ color: 'var(--ll-text)', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.title}
                      </div>
                      <div style={{ color: isProcessing ? '#f59e0b' : isFailed ? '#fca5a5' : 'var(--ll-text-muted)', fontSize: 11 }}>
                        {isProcessing
                          ? '⚙️ Processing… click for details'
                          : isFailed ? 'Failed to process'
                          : 'Ready to play'}
                      </div>
                    </>
                  )}
                </div>

                {/* Action buttons — stop propagation so clicking them doesn't open modal */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                  {isProcessing && (
                    <>
                      <button
                        className="ll-btn"
                        style={{ padding: '5px 10px', fontSize: 11, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.4)' }}
                        onClick={() => setSelectedProcessingProgram(p)}
                        title="See processing details"
                      >
                        Details
                      </button>
                      <button
                        className="ll-btn"
                        style={{ padding: '5px 10px', fontSize: 11, color: '#fca5a5', borderColor: 'rgba(239,68,68,0.4)' }}
                        onClick={(e) => handleDeletePersonal(e, p.jobId)}
                        title="Cancel and delete"
                      >
                        Cancel
                      </button>
                    </>
                  )}

                  {isFailed && (
                    <button
                      className="ll-btn"
                      style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.5)', color: '#fca5a5' }}
                      onClick={(e) => handleDeletePersonal(e, p.jobId)}
                    >
                      Delete
                    </button>
                  )}

                  {!isProcessing && !isFailed && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditJobId(p.jobId); }}
                        className="ll-btn"
                        style={{ padding: '6px 12px', fontSize: 11, background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}
                      >
                        Edit
                      </button>
                      <button
                        className="ll-btn"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameTitle(p.title);
                          setRenamingProgramId(p.programId);
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="ll-btn ll-btn-primary"
                        style={{ padding: '6px 10px', fontSize: 11 }}
                        onClick={() => {
                          onClose();
                          window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'personalProgram', personalProgramId: p.programId } }));
                        }}
                      >
                        Open
                      </button>
                      <button
                        className="ll-btn"
                        style={{ padding: '6px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.5)', color: '#fca5a5' }}
                        onClick={(e) => handleDeletePersonal(e, p.jobId)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <EditProgramModal
        open={!!editJobId}
        onClose={() => setEditJobId(null)}
        jobId={editJobId}
      />
      <ProcessingDetailsModal
        open={!!selectedProcessingProgram}
        onClose={() => setSelectedProcessingProgram(null)}
        program={selectedProcessingProgram}
        onCancel={async () => {
          if (!selectedProcessingProgram || !user) return;
          if (!(await confirm('Cancel and delete this program?'))) return;
          setSelectedProcessingProgram(null);
          try {
            await deletePersonalProgram(user.uid, selectedProcessingProgram.jobId);
            setPersonalPrograms(prev => prev.filter(p => p.jobId !== selectedProcessingProgram.jobId));
          } catch (err) {
            alert('Failed to delete: ' + (err instanceof Error ? err.message : String(err)));
          }
        }}
      />
      <div style={panelStyle} onClick={stop}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ll-border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--ll-overlay)' }}>
          <div style={{ fontSize: 18 }}>📚</div>
          <div style={{ color: 'var(--ll-text)', fontWeight: 900, fontSize: 14, flex: 1 }}>My Programs</div>
          <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ll-border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: 'color-mix(in srgb, var(--ll-surface-0) 86%, transparent)' }}>
          <button style={headerBtn(tab === 'current')} onClick={() => setTab('current')}>My Programs</button>
          <button style={{ ...headerBtn(tab === 'create'), color: tab === 'create' ? '#8b5cf6' : 'var(--ll-text-soft)', border: tab === 'create' ? '1px solid #8b5cf6' : '1px solid transparent' }} onClick={() => setTab('create')}>
            ✨ Create New Program
          </button>
          <button style={headerBtn(tab === 'search')} onClick={() => setTab('search')}>Search public program</button>
          <div style={{ marginLeft: 'auto', color: 'var(--ll-text-muted)', fontSize: 12 }}>{loading ? 'Loading...' : `${programs.length} public programs`}</div>
        </div>

        <div style={{ padding: 16, overflowY: 'auto' }}>
          {tab === 'create' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{
                background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)',
                borderRadius: 10, padding: '14px 16px', fontSize: 13, color: '#c4b5fd', lineHeight: 1.5
              }}>
                <strong>Personal Program Creator</strong><br/>
                Upload your own PDF worksheets or take photos of exercises. We'll automatically extract the questions, organize them into topics, and create an interactive program map just for you.
              </div>

              {/* Upload Zone */}
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${dragActive ? '#8b5cf6' : 'var(--ll-border-strong)'}`,
                  background: dragActive ? 'rgba(139,92,246,0.05)' : 'var(--ll-surface-1)',
                  borderRadius: 16, padding: '40px 20px', textAlign: 'center',
                  transition: 'all 0.2s', position: 'relative'
                }}
              >
                <input
                  type="file"
                  multiple
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                />
                <div style={{ fontSize: 32, marginBottom: 12 }}>{dragActive ? '📥' : '📄'}</div>
                <div style={{ fontSize: 14, fontWeight: 'bold', color: 'var(--ll-text)', marginBottom: 4 }}>
                  Drag & Drop files here or click to browse
                </div>
                <div style={{ fontSize: 12, color: 'var(--ll-text-muted)' }}>
                  Supports .pdf, .png, .jpg
                </div>
              </div>

              {/* Upload Details */}
              {uploadFiles.length > 0 && (
                <div style={{ background: 'var(--ll-surface-1)', border: '1px solid var(--ll-border)', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 24 }}>📑</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: 'var(--ll-text)' }}>{uploadFiles.length} file(s) selected</div>
                      <div style={{ fontSize: 11, color: 'var(--ll-text-muted)' }}>{uploadFiles.map(f => f.name).join(', ')}</div>
                    </div>
                    <button className="ll-btn" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => { setUploadFiles([]); setUploadTitle(''); }}>Clear</button>
                  </div>
                  
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--ll-text-muted)', marginBottom: 4, fontWeight: 'bold' }}>PROGRAM TITLE</label>
                    <input
                      value={uploadTitle}
                      onChange={e => setUploadTitle(e.target.value)}
                      placeholder="E.g. Math Worksheet Chapter 4"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 8,
                        border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)',
                        color: 'var(--ll-text)', fontFamily: 'inherit', outline: 'none'
                      }}
                    />
                  </div>

                  <button
                    className="ll-btn"
                    disabled={uploading}
                    onClick={handleCreatePersonalProgram}
                    style={{
                      width: '100%', padding: '12px', fontSize: 14, fontWeight: 'bold',
                      background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', border: 'none', color: 'white'
                    }}
                  >
                    {uploading ? (uploadProgress || 'Starting OCR...') : 'Create Program'}
                  </button>
                  {uploading && uploadProgress && (
                    <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 8, lineHeight: 1.5, textAlign: 'center' }}>
                      {uploadProgress}
                    </div>
                  )}
                </div>
              )}

              {/* Personal Programs List */}
              {renderPersonalProgramsList()}
            </div>
          )}

          {tab === 'current' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {subjectPersonalPrograms.length === 0 && myCurrent.length === 0 ? (
                <div style={{ color: 'var(--ll-text-soft)' }}>
                  No programs yet. Go to Search and assign one.
                </div>
              ) : (
                <>
                  {personalPrograms.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 14, color: 'var(--ll-text)', margin: '4px 0 12px' }}>My created programs</h3>
                      {renderPersonalProgramsList(false)}
                    </>
                  )}
                  {myCurrent.length > 0 && (
                    <>
                      <h3 style={{ fontSize: 14, color: 'var(--ll-text)', margin: '12px 0 4px' }}>Public programs</h3>
                      {myCurrent.map((p) => <ProgramRow key={p.id} p={p} showAssign={false} />)}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'search' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by book name..."
                  style={{
                    width: '100%',
                    padding: '12px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--ll-border)',
                    background: 'var(--ll-surface-1)',
                    color: 'var(--ll-text)',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>

              {searchResults.length === 0 && !loading && (
                <div style={{ color: 'var(--ll-text-soft)' }}>
                  No matches.
                </div>
              )}

              {searchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {searchResults.map((p) => (
                    <ProgramRow key={p.id} p={p} showAssign={true} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
