import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { cancelQuestionExtractionJob, extractQuestionPdfs, getQuestionExtractionJob, type OrganizerResult, type OrganizerTreeNode, type QuestionPdfProgress } from '@/lib/programIngestionService';

export type ImportedQuestion = {
  id: string;
  promptRawText: string;
  promptBlocks: Array<Record<string, unknown>>;
  interaction: { type: string; choices?: string[]; correctChoiceIndex?: number };
  modelAnswer: string;
  pageNumber?: number;
  questionNumber?: string | number;
  reviewStatus?: string;
  flags: string[];
};

export type ImportCategoryOption = { id: string; path: string };
export type ImportPlacement = { question: ImportedQuestion; categoryId: string };
export type ApprovedImport = { placements: ImportPlacement[]; previewTree: OrganizerTreeNode[]; proposal: OrganizerResult };

type Props = {
  open: boolean;
  programTitle: string;
  subject: string;
  programId: string;
  baseRevision: number;
  currentTree: OrganizerTreeNode[];
  existingQuestions: Array<{ id: string; text: string; answerText?: string }>;
  categories: ImportCategoryOption[];
  onClose: () => void;
  onApply: (approved: ApprovedImport) => void;
};

export function normalizeImportedQuestions(result: Record<string, unknown>): ImportedQuestion[] {
  const raw = Array.isArray(result.questions) ? result.questions : [];
  return raw.map((value, index) => {
    const question = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const interaction = (question.interaction && typeof question.interaction === 'object' ? question.interaction : {}) as ImportedQuestion['interaction'];
    const promptBlocks = Array.isArray(question.promptBlocks) ? question.promptBlocks as Array<Record<string, unknown>> : [];
    const blockText = promptBlocks.map(block => typeof block.text === 'string' ? block.text : '').filter(Boolean).join(' ');
    const promptRawText = typeof question.promptRawText === 'string' && question.promptRawText.trim() ? question.promptRawText
      : typeof question.rawText === 'string' && question.rawText.trim() ? question.rawText
      : typeof question.question === 'string' && question.question.trim() ? question.question
      : blockText;
    const choices = Array.isArray(interaction.choices) ? interaction.choices : [];
    const correctIndex = typeof interaction.correctChoiceIndex === 'number' ? interaction.correctChoiceIndex : -1;
    const sourceAnswer = correctIndex >= 0 && correctIndex < choices.length ? choices[correctIndex] ?? '' : '';
    const stablePage = typeof question.pageNumber === 'number' ? question.pageNumber : 0;
    const stableNumber = typeof question.questionNumber === 'string' || typeof question.questionNumber === 'number' ? String(question.questionNumber).replace(/[^a-z0-9_-]/gi, '_') : String(index + 1);
    return {
      id: typeof question.id === 'string' && question.id.trim() ? question.id : `import_p${stablePage}_q${stableNumber}_i${index}`,
      promptRawText,
      promptBlocks,
      interaction,
      modelAnswer: typeof question.modelAnswer === 'string' ? question.modelAnswer : sourceAnswer,
      pageNumber: typeof question.pageNumber === 'number' ? question.pageNumber : undefined,
      questionNumber: typeof question.questionNumber === 'string' || typeof question.questionNumber === 'number' ? question.questionNumber : index + 1,
      reviewStatus: typeof question.reviewStatus === 'string' ? question.reviewStatus : undefined,
      flags: Array.isArray(question.flags) ? question.flags.map(String) : [],
    };
  });
}

function cloneTree(tree: OrganizerTreeNode[]): OrganizerTreeNode[] {
  return tree.map(node => ({ ...node, children: cloneTree(node.children) }));
}

function findNode(nodes: OrganizerTreeNode[], id: string): OrganizerTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
}

function updateNode(nodes: OrganizerTreeNode[], id: string, update: (node: OrganizerTreeNode) => OrganizerTreeNode): OrganizerTreeNode[] {
  return nodes.map(node => node.id === id ? update(node) : { ...node, children: updateNode(node.children, id, update) });
}

function removeNode(nodes: OrganizerTreeNode[], id: string): OrganizerTreeNode[] {
  return nodes.filter(node => node.id !== id).map(node => ({ ...node, children: removeNode(node.children, id) }));
}

function nodeIds(node: OrganizerTreeNode): Set<string> {
  const ids = new Set<string>([node.id]);
  node.children.forEach(child => nodeIds(child).forEach(id => ids.add(id)));
  return ids;
}

function moveNode(nodes: OrganizerTreeNode[], id: string, parentId: string): OrganizerTreeNode[] {
  const moving = findNode(nodes, id);
  if (!moving) return nodes;
  const without = removeNode(nodes, id);
  if (parentId === 'root') return [...without, moving];
  return updateNode(without, parentId, parent => parent.kind === 'folder' ? { ...parent, children: [...parent.children, moving] } : parent);
}

function treeOptions(nodes: OrganizerTreeNode[]): { categories: ImportCategoryOption[]; folders: ImportCategoryOption[] } {
  const categories: ImportCategoryOption[] = [];
  const folders: ImportCategoryOption[] = [];
  const visit = (node: OrganizerTreeNode, parents: string[]) => {
    const path = [...parents, node.title];
    (node.kind === 'category' ? categories : folders).push({ id: node.id, path: path.join(' / ') });
    node.children.forEach(child => visit(child, path));
  };
  nodes.forEach(node => visit(node, []));
  return { categories, folders };
}

export default function QuestionImportStudio({ open, programTitle, subject, programId, baseRevision, currentTree, onClose, onApply }: Props) {
  const [questionFiles, setQuestionFiles] = useState<File[]>([]);
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [questions, setQuestions] = useState<ImportedQuestion[]>([]);
  const [tree, setTree] = useState<OrganizerTreeNode[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [selectedNodeId, setSelectedNodeId] = useState('root');
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<QuestionPdfProgress | null>(null);
  const [progressHistory, setProgressHistory] = useState<Array<QuestionPdfProgress & { receivedAt: number }>>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'running' | 'complete' | 'failed' | 'cancelled' | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const sessionKey = `question-import-studio:${programId}`;

  useEffect(() => {
    setSessionLoaded(false);
    try {
      const saved = localStorage.getItem(sessionKey);
      if (saved) {
        const session = JSON.parse(saved) as {
          jobId?: string; jobStatus?: typeof jobStatus; questions?: ImportedQuestion[]; tree?: OrganizerTreeNode[];
          assignments?: Record<string, string>; progress?: QuestionPdfProgress | null;
          progressHistory?: Array<QuestionPdfProgress & { receivedAt: number }>; error?: string;
        };
        setJobId(session.jobId ?? null);
        setJobStatus(session.jobStatus ?? null);
        setQuestions(Array.isArray(session.questions) ? session.questions : []);
        setTree(Array.isArray(session.tree) ? session.tree : cloneTree(currentTree));
        setAssignments(session.assignments ?? {});
        setProgress(session.progress ?? null);
        setProgressHistory(Array.isArray(session.progressHistory) ? session.progressHistory : []);
        setError(session.error ?? '');
        setProcessing(session.jobStatus === 'running');
      } else {
        setTree(cloneTree(currentTree));
        setSelectedNodeId('root');
      }
    } catch {
      localStorage.removeItem(sessionKey);
      setTree(cloneTree(currentTree));
    }
    setSessionLoaded(true);
  }, [programId]);

  useEffect(() => {
    if (!sessionLoaded || !jobId) return;
    try {
      localStorage.setItem(sessionKey, JSON.stringify({ jobId, jobStatus, questions, tree, assignments, progress, progressHistory, error }));
    } catch {
      // Large embedded question images can exceed localStorage. The server job remains the recovery source.
      localStorage.setItem(sessionKey, JSON.stringify({ jobId, jobStatus, tree, assignments, progress, progressHistory, error }));
    }
  }, [sessionLoaded, sessionKey, jobId, jobStatus, questions, tree, assignments, progress, progressHistory, error]);

  useEffect(() => {
    if (!jobId || jobStatus === 'cancelled' || jobStatus === 'failed' || (jobStatus === 'complete' && questions.length > 0)) return;
    let disposed = false;
    const synchronize = async () => {
      try {
        const job = await getQuestionExtractionJob(jobId);
        if (disposed) return;
        setJobStatus(job.status);
        setProcessing(job.status === 'running');
        if (job.progress) {
          setProgress(job.progress);
          if (job.progress.elapsedMs != null) setElapsedSeconds(Math.floor(job.progress.elapsedMs / 1000));
        }
        if (job.history.length) setProgressHistory(job.history.map(event => ({ ...event, receivedAt: event.serverTime ? new Date(event.serverTime).getTime() : Date.now() })));
        if (job.status === 'complete' && job.result) {
          setQuestions(existing => existing.length ? existing : normalizeImportedQuestions(job.result!));
          setError('');
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          setError(job.error ?? (job.status === 'cancelled' ? 'Extraction cancelled.' : 'Extraction failed.'));
        }
      } catch {
        // The upload request can briefly precede creation of the server job. Keep retrying.
      }
    };
    void synchronize();
    const timer = window.setInterval(() => void synchronize(), 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [jobId, jobStatus, questions.length]);

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => setElapsedSeconds(seconds => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [processing]);

  const options = useMemo(() => treeOptions(tree), [tree]);
  const categoryIds = useMemo(() => new Set(options.categories.map(category => category.id)), [options.categories]);
  const unassigned = useMemo(() => questions.filter(question => !assignments[question.id] || !categoryIds.has(assignments[question.id])), [questions, assignments, categoryIds]);
  const editingQuestion = questions.find(question => question.id === editingQuestionId) ?? null;
  const selectedNode = selectedNodeId === 'root' ? null : findNode(tree, selectedNodeId);
  const selectedCanContain = selectedNodeId === 'root' || selectedNode?.kind === 'folder';
  const extractionStats = useMemo(() => progressHistory.reduce((stats, event) => ({
    totalPages: Math.max(stats.totalPages, event.stats?.totalPages ?? 0),
    currentPage: Math.max(stats.currentPage, event.stats?.currentPage ?? 0),
    totalQuestions: Math.max(stats.totalQuestions, event.stats?.totalQuestions ?? 0),
    answersFound: Math.max(stats.answersFound, event.stats?.answersFound ?? 0),
    processedFiles: Math.max(stats.processedFiles, event.stats?.processedFiles ?? 0),
    totalFiles: Math.max(stats.totalFiles, event.stats?.totalFiles ?? 0),
  }), { totalPages: 0, currentPage: 0, totalQuestions: 0, answersFound: 0, processedFiles: 0, totalFiles: 0 }), [progressHistory]);
  const currentStage = progress?.stats?.stage ?? (processing ? 'rendering' : 'complete');
  const stagePercent = progress?.stats?.stageTotal
    ? Math.max(3, Math.min(100, ((progress.stats.stageCurrent ?? 0) / progress.stats.stageTotal) * 100))
    : processing ? 12 : 100;
  const stageLabel = ({ rendering: 'Rendering files', answers: 'Reading answers', extracting: 'Extracting questions', building: 'Building questions', reviewing: 'Vision review', auditing: 'Final audit', complete: 'Complete' } as const)[currentStage];
  const liveStats = progress?.stats;
  const operationLabel = liveStats?.operation?.replaceAll('_', ' ') ?? 'Preparing request';
  const operationSeconds = Math.floor((liveStats?.operationElapsedMs ?? 0) / 1000);

  if (!open) return null;

  const closeStudio = () => {
    onClose();
  };

  const cancelStudio = async () => {
    const message = processing
      ? 'Cancel this extraction? The background job will stop and its extracted progress will be discarded.'
      : questions.length
        ? 'Cancel this import? Extracted questions and your manual placement changes will be discarded.'
        : 'Cancel and discard this Question Import Studio session?';
    if (!window.confirm(message)) return;
    if (jobId && processing) {
      try { await cancelQuestionExtractionJob(jobId); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; }
    }
    localStorage.removeItem(sessionKey);
    setQuestionFiles([]); setAnswerFiles([]); setQuestions([]); setAssignments({}); setProgress(null); setProgressHistory([]); setElapsedSeconds(0); setError(''); setEditingQuestionId(null); setTree(cloneTree(currentTree)); setJobId(null); setJobStatus(null); setProcessing(false);
    onClose();
  };

  const runExtraction = async () => {
    if (questionFiles.length === 0) return;
    setProcessing(true); setError(''); setQuestions([]); setAssignments({}); setElapsedSeconds(0);
    const nextJobId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `question-extraction-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setJobId(nextJobId);
    setJobStatus('running');
    const startingProgress: QuestionPdfProgress = { icon: '🚀', message: 'Starting extraction…', detail: 'Uploading and preparing the selected source files.', stats: { stage: 'rendering', stageCurrent: 0, stageTotal: questionFiles.length, totalFiles: questionFiles.length + answerFiles.length, processedFiles: 0 } };
    setProgress(startingProgress);
    setProgressHistory([{ ...startingProgress, receivedAt: Date.now() }]);
    try {
      const result = await extractQuestionPdfs(questionFiles, answerFiles, update => {
        setProgress(update);
        setProgressHistory(history => [...history, { ...update, receivedAt: Date.now() }].slice(-80));
      }, { id: nextJobId, programId });
      const extracted = normalizeImportedQuestions(result);
      if (extracted.length === 0) throw new Error('No questions were found in the uploaded files.');
      setQuestions(extracted);
      setTree(cloneTree(currentTree));
      setProgress(null);
      setJobStatus('complete');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setJobStatus(status => status === 'cancelled' ? status : 'failed');
    } finally {
      setProcessing(false);
    }
  };

  const addNode = (kind: 'folder' | 'category') => {
    if (!selectedCanContain) return;
    const title = window.prompt(`Name the new ${kind}:`)?.trim();
    if (!title) return;
    const node: OrganizerTreeNode = { id: `manual_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, title, kind, children: [] };
    setTree(previous => selectedNodeId === 'root' ? [...previous, node] : updateNode(previous, selectedNodeId, parent => ({ ...parent, children: [...parent.children, node] })));
    setSelectedNodeId(node.id);
  };

  const renameSelected = () => {
    if (!selectedNode) return;
    const title = window.prompt(`Rename ${selectedNode.kind}:`, selectedNode.title)?.trim();
    if (title) setTree(previous => updateNode(previous, selectedNode.id, node => ({ ...node, title })));
  };

  const deleteSelected = () => {
    if (!selectedNode || !window.confirm(`Delete “${selectedNode.title}” and everything inside it?`)) return;
    const removedIds = nodeIds(selectedNode);
    setTree(previous => removeNode(previous, selectedNode.id));
    setAssignments(previous => Object.fromEntries(Object.entries(previous).filter(([, categoryId]) => !removedIds.has(categoryId))));
    setSelectedNodeId('root');
  };

  const applyImport = () => {
    if (unassigned.length > 0) return;
    const placements = questions.map(question => ({ question, categoryId: assignments[question.id]! }));
    const proposal: OrganizerResult = {
      baseRevision,
      previewTree: tree,
      operations: [],
      placements: placements.map(item => ({ id: `manual_placement_${item.question.id}`, questionId: item.question.id, destinationCategoryId: item.categoryId, alternativeCategoryIds: [], confidence: 1, rationale: 'Placed manually by the super admin.', decision: 'approved' })),
      assessments: questions.map(question => ({ questionId: question.id, detectedSubject: subject, subjectConfidence: 1, likelyDuplicateQuestionId: null, duplicateConfidence: 0 })),
      summary: `${questions.length} questions manually placed by the super admin.`,
      provider: 'manual_question_placement',
    };
    localStorage.removeItem(sessionKey);
    setJobId(null);
    setJobStatus(null);
    onApply({ placements, previewTree: tree, proposal });
  };

  return <div role="dialog" aria-modal="true" aria-label="Question Import Studio" style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(2,6,23,.9)', display: 'grid', placeItems: 'center', padding: 14 }}>
    <div style={{ width: 'min(1420px,99vw)', height: 'min(900px,96vh)', background: '#0f172a', border: '1px solid #334155', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 100px rgba(0,0,0,.72)' }}>
      <header style={{ padding: '14px 18px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(120deg,rgba(59,130,246,.15),rgba(139,92,246,.12))' }}>
        <div style={{ fontSize: 25 }}>📚</div>
        <div style={{ flex: 1 }}><div style={{ color: 'white', fontWeight: 900 }}>Question Import Studio</div><div style={{ color: '#94a3b8', fontSize: 12 }}>{programTitle} · {subject || 'Subject not set'}</div></div>
        <div style={{ fontSize: 11, color: '#93c5fd', padding: '5px 9px', borderRadius: 99, background: 'rgba(59,130,246,.12)' }}>{questions.length ? 'Manual placement' : processing ? 'Extracting questions and answers' : 'Source files'}</div>
        <button className="ll-btn" aria-label="Close Question Import Studio" onClick={closeStudio}>✕</button>
      </header>

      {questions.length === 0 ? <main style={{ padding: 24, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <FileBox title="Question files" required files={questionFiles} onFiles={setQuestionFiles} />
        <FileBox title="Answer / marking-scheme files" files={answerFiles} onFiles={setAnswerFiles} />
        <section style={{ gridColumn: '1 / -1', background: '#111c31', border: '1px solid #26364f', borderRadius: 14, padding: 17 }}>
          {!processing && progressHistory.length === 0 ? <><div style={{ color: 'white', fontWeight: 800, marginBottom: 7 }}>Extraction only</div><div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.7 }}>The system extracts questions and matches only answers found in your uploaded sources. Missing answers stay empty. You will manually build the tree and place every question.</div></> : <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 13 }}><div style={{ width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(59,130,246,.12)', fontSize: 20 }}>{progress?.icon ?? '⚙️'}</div><div style={{ flex: 1 }}><div style={{ color: 'white', fontWeight: 900 }}>{progress?.message ?? 'Preparing extraction…'}</div><div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>{progress?.detail || 'Waiting for the extraction service.'}</div></div><span style={{ color: error ? '#fca5a5' : processing ? '#93c5fd' : '#86efac', fontSize: 10, fontWeight: 900, padding: '4px 7px', borderRadius: 99, background: error ? 'rgba(239,68,68,.1)' : processing ? 'rgba(59,130,246,.12)' : 'rgba(34,197,94,.12)' }}>{processing ? '● LIVE' : error ? 'STOPPED' : 'COMPLETE'}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(125px,1fr))', gap: 8, marginBottom: 12 }}>
              <ExtractionMetric label="Current stage" value={stageLabel} detail={`${Math.round(stagePercent)}% of this stage`} />
              <ExtractionMetric label="Source files" value={extractionStats.totalFiles ? `${extractionStats.processedFiles}/${extractionStats.totalFiles}` : `${questionFiles.length + answerFiles.length}`} detail={`${questionFiles.length} question · ${answerFiles.length} answer`} />
              <ExtractionMetric label="Pages processed" value={extractionStats.totalPages ? `${extractionStats.currentPage}/${extractionStats.totalPages}` : extractionStats.currentPage ? String(extractionStats.currentPage) : '—'} detail="Rendered and inspected" />
              <ExtractionMetric label="Questions found" value={String(extractionStats.totalQuestions)} detail="Detected so far" accent="#86efac" />
              <ExtractionMetric label="Answers matched" value={String(extractionStats.answersFound)} detail="Detected in answer sources" accent="#c4b5fd" />
              <ExtractionMetric label="Elapsed" value={`${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`} detail={`${progressHistory.length} live events`} />
            </div>
            <div style={{ height: 6, background: '#1e293b', borderRadius: 99, overflow: 'hidden', marginBottom: 13 }}><div style={{ width: `${stagePercent}%`, height: '100%', background: 'linear-gradient(90deg,#3b82f6,#a855f7)', transition: 'width .3s ease' }} /></div>
            <details open style={{ marginBottom: 13, border: '1px solid #26364f', borderRadius: 10, background: '#0b1324' }}>
              <summary style={{ cursor: 'pointer', color: '#cbd5e1', fontSize: 10, fontWeight: 900, padding: '8px 10px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Technical debug details</summary>
              <div style={{ padding: '0 10px 10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 7 }}>
                <DebugValue label="Operation" value={operationLabel} />
                <DebugValue label="Target" value={liveStats?.fileName ?? (liveStats?.page != null ? `Page ${liveStats.page}` : '—')} />
                <DebugValue label="AI model" value={liveStats?.model ?? 'Not an AI step'} />
                <DebugValue label="Attempt" value={liveStats?.maxAttempts ? `${liveStats.attempt ?? 1}/${liveStats.maxAttempts}` : '—'} />
                <DebugValue label="Active request" value={operationSeconds ? `${operationSeconds}s` : processing ? '< 3s' : '—'} />
                <DebugValue label="Hard timeout" value={liveStats?.requestTimeoutSeconds ? `${liveStats.requestTimeoutSeconds}s` : '—'} />
                <DebugValue label="HTTP status" value={liveStats?.httpStatus ? String(liveStats.httpStatus) : 'Waiting / OK'} />
                <DebugValue label="Server event" value={progress?.sequence ? `#${progress.sequence}` : 'Local start'} />
              </div>
              {(liveStats?.rateLimitWaitSeconds || liveStats?.lastError) && <div style={{ margin: '0 10px 10px', padding: 8, borderRadius: 7, color: liveStats.lastError ? '#fca5a5' : '#fcd34d', background: liveStats.lastError ? 'rgba(239,68,68,.08)' : 'rgba(245,158,11,.08)', fontSize: 10, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{liveStats.rateLimitWaitSeconds ? `Rate-limit wait: ${liveStats.rateLimitWaitSeconds}s. ` : ''}{liveStats.lastError ?? ''}</div>}
            </details>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#94a3b8', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: processing ? '#60a5fa' : '#4ade80', boxShadow: processing ? '0 0 10px #60a5fa' : undefined }} />Live extraction activity</div>
            <div style={{ maxHeight: 190, overflow: 'auto', display: 'grid', gap: 6 }}>{[...progressHistory].reverse().map((event, index) => <div key={`${event.sequence ?? event.receivedAt}:${index}`} style={{ display: 'grid', gridTemplateColumns: '54px 24px minmax(0,1fr) auto', alignItems: 'start', gap: 7, padding: '6px 8px', borderRadius: 8, background: index === 0 ? 'rgba(59,130,246,.08)' : '#0b1324', border: `1px solid ${index === 0 ? 'rgba(59,130,246,.22)' : '#1f2a44'}` }}><span style={{ color: '#64748b', fontSize: 9 }}>{new Date(event.serverTime ?? event.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span><span>{event.icon}</span><div style={{ minWidth: 0 }}><div style={{ color: '#cbd5e1', fontSize: 10, fontWeight: 800 }}>{event.message}</div>{event.detail && <div style={{ color: '#64748b', fontSize: 9, overflowWrap: 'anywhere' }}>{event.detail}</div>}{event.stats?.lastError && <div style={{ color: '#fca5a5', fontSize: 9, marginTop: 3, overflowWrap: 'anywhere' }}>{event.stats.lastError}</div>}</div><span style={{ color: '#86efac', fontSize: 9, whiteSpace: 'nowrap' }}>{event.stats?.httpStatus ? `HTTP ${event.stats.httpStatus}` : event.stats?.attempt ? `${event.stats.attempt}/${event.stats.maxAttempts}` : event.stats?.totalQuestions != null ? `${event.stats.totalQuestions} Q` : ''}</span></div>)}</div>
          </>}
          {error && <div style={{ color: '#fca5a5', marginTop: 12, fontSize: 13, padding: 9, borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)' }}>{error}</div>}
        </section>
      </main> : <main style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '390px minmax(0,1fr)' }}>
        <aside style={{ borderRight: '1px solid #334155', background: '#0b1324', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '14px 15px 10px', borderBottom: '1px solid #26364f' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ color: 'white', fontWeight: 900, flex: 1 }}>Extracted questions</div><span style={{ color: unassigned.length ? '#fca5a5' : '#86efac', fontSize: 11 }}>{questions.length - unassigned.length}/{questions.length} assigned</span></div><div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>Drag each card onto a category. Click a card to edit it.</div></div>
          <div style={{ overflow: 'auto', padding: 11 }}>{questions.map((question, index) => {
            const category = options.categories.find(option => option.id === assignments[question.id]);
            return <article key={question.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-question-id', question.id); }} onClick={() => setEditingQuestionId(question.id)} style={{ padding: 11, marginBottom: 9, borderRadius: 11, background: '#111c31', border: `1px solid ${category ? 'rgba(34,197,94,.42)' : '#334155'}`, cursor: 'grab' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}><span style={{ color: '#93c5fd', fontWeight: 900, fontSize: 11 }}>Q{question.questionNumber ?? index + 1}</span><span style={{ padding: '2px 6px', borderRadius: 99, background: question.modelAnswer ? 'rgba(34,197,94,.12)' : 'rgba(245,158,11,.12)', color: question.modelAnswer ? '#86efac' : '#fcd34d', fontSize: 9, fontWeight: 900 }}>{question.modelAnswer ? 'ANSWERED' : 'NO ANSWER'}</span><span style={{ marginLeft: 'auto', padding: '2px 6px', borderRadius: 99, background: category ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)', color: category ? '#86efac' : '#fca5a5', fontSize: 9, fontWeight: 900 }}>{category ? 'ASSIGNED' : 'UNASSIGNED'}</span></div>
              <div style={{ color: 'white', fontSize: 12, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{question.promptRawText || 'Image-based question'}</div>
              {category && <div title={category.path} style={{ color: '#6ee7b7', fontSize: 10, marginTop: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>→ {category.path}</div>}
            </article>;
          })}</div>
        </aside>

        <section style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 13px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}><div style={{ color: 'white', fontWeight: 900 }}>Program tree</div><div style={{ color: '#64748b', fontSize: 10 }}>Select Root or a folder, create structure, then drop questions onto terminal categories.</div></div>
            <button className="ll-btn" disabled={!selectedCanContain} onClick={() => addNode('folder')} style={{ fontSize: 11 }}>+ Folder</button>
            <button className="ll-btn" disabled={!selectedCanContain} onClick={() => addNode('category')} style={{ fontSize: 11 }}>+ Category</button>
            <button className="ll-btn" disabled={!selectedNode} onClick={renameSelected} style={{ fontSize: 11 }}>Rename</button>
            <button className="ll-btn" disabled={!selectedNode} onClick={deleteSelected} style={{ fontSize: 11, color: selectedNode ? '#fca5a5' : undefined }}>Delete</button>
            {selectedNode && <select aria-label="Move selected node" value="" onChange={event => { if (event.target.value) setTree(previous => moveNode(previous, selectedNode.id, event.target.value)); }} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid #334155', background: '#0b1324', color: '#cbd5e1', fontSize: 11 }}><option value="">Move to…</option><option value="root">Root</option>{options.folders.filter(folder => folder.id !== selectedNode.id && !nodeIds(selectedNode).has(folder.id)).map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select>}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 20, background: '#080f1d' }}>
            <style>{treeCss}</style>
            <ul className="manual-placement-tree"><li><button className={`manual-tree-node root ${selectedNodeId === 'root' ? 'selected' : ''}`} onClick={() => setSelectedNodeId('root')}><span>🌳</span><b>Root</b></button>{tree.length > 0 && <ul>{tree.map(node => <PlacementTreeNode key={node.id} node={node} selectedId={selectedNodeId} assignments={assignments} onSelect={setSelectedNodeId} onAssign={(questionId, categoryId) => setAssignments(previous => ({ ...previous, [questionId]: categoryId }))} />)}</ul>}</li></ul>
            {tree.length === 0 && <div style={{ color: '#64748b', textAlign: 'center', marginTop: 24 }}>Select Root and create your first folder or category.</div>}
          </div>
        </section>
      </main>}

      <footer style={{ borderTop: '1px solid #334155', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, color: questions.length ? unassigned.length ? '#fca5a5' : '#86efac' : '#64748b', fontSize: 12 }}>{questions.length ? unassigned.length ? `${unassigned.length} question(s) still need a category` : 'All questions are assigned and ready' : `${questionFiles.length} question file(s) · ${answerFiles.length} answer file(s)`}</div>
        <button className="ll-btn" onClick={() => void cancelStudio()}>Cancel</button>
        {questions.length === 0 ? <button onClick={runExtraction} disabled={questionFiles.length === 0 || processing} style={primaryStyle(questionFiles.length === 0 || processing)}>{processing ? 'Extracting…' : 'Extract questions and answers →'}</button> : <button onClick={applyImport} disabled={unassigned.length > 0 || options.categories.length === 0} style={primaryStyle(unassigned.length > 0 || options.categories.length === 0)}>Apply {questions.length} questions to draft</button>}
      </footer>
    </div>

    {editingQuestion && <QuestionEditor question={editingQuestion} onChange={updated => setQuestions(previous => previous.map(question => question.id === updated.id ? updated : question))} onClose={() => setEditingQuestionId(null)} />}
  </div>;
}

function PlacementTreeNode({ node, selectedId, assignments, onSelect, onAssign }: { node: OrganizerTreeNode; selectedId: string; assignments: Record<string, string>; onSelect: (id: string) => void; onAssign: (questionId: string, categoryId: string) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const count = node.kind === 'category' ? Object.values(assignments).filter(id => id === node.id).length : 0;
  const onDragOver = (event: DragEvent<HTMLButtonElement>) => { if (node.kind !== 'category') return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOver(true); };
  const onDrop = (event: DragEvent<HTMLButtonElement>) => { if (node.kind !== 'category') return; event.preventDefault(); setDragOver(false); const questionId = event.dataTransfer.getData('application/x-question-id'); if (questionId) onAssign(questionId, node.id); };
  return <li><button className={`manual-tree-node ${node.kind} ${selectedId === node.id ? 'selected' : ''} ${dragOver ? 'drag-over' : ''}`} onClick={() => onSelect(node.id)} onDragOver={onDragOver} onDragLeave={() => setDragOver(false)} onDrop={onDrop}><span>{node.kind === 'folder' ? '📁' : '🏷️'}</span><b>{node.title}</b>{node.kind === 'category' && <small>{count} question{count === 1 ? '' : 's'}</small>}</button>{node.children.length > 0 && <ul>{node.children.map(child => <PlacementTreeNode key={child.id} node={child} selectedId={selectedId} assignments={assignments} onSelect={onSelect} onAssign={onAssign} />)}</ul>}</li>;
}

function QuestionEditor({ question, onChange, onClose }: { question: ImportedQuestion; onChange: (question: ImportedQuestion) => void; onClose: () => void }) {
  return <div onClick={event => event.stopPropagation()} style={{ position: 'fixed', inset: 0, zIndex: 8300, background: 'rgba(2,6,23,.9)', display: 'grid', placeItems: 'center', padding: 18 }}><div style={{ width: 'min(720px,96vw)', maxHeight: '88vh', overflow: 'auto', borderRadius: 17, background: '#0f172a', border: '1px solid #334155', boxShadow: '0 25px 80px rgba(0,0,0,.7)' }}>
    <div style={{ padding: '14px 17px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center' }}><div style={{ flex: 1 }}><div style={{ color: 'white', fontWeight: 900 }}>Edit extracted question</div><div style={{ color: '#64748b', fontSize: 11 }}>Correct the extraction or source answer before applying.</div></div><button className="ll-btn" onClick={onClose}>✕</button></div>
    <div style={{ padding: 17 }}><label style={labelStyle}>Question text<textarea value={question.promptRawText} onChange={event => onChange({ ...question, promptRawText: event.target.value, promptBlocks: [{ type: 'text', text: event.target.value }, ...question.promptBlocks.filter(block => block.type !== 'text')] })} rows={8} style={textareaStyle} /></label>
      {question.interaction.choices?.length ? <div style={{ marginBottom: 14 }}><div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 800, marginBottom: 6 }}>Extracted choices</div>{question.interaction.choices.map((choice, index) => <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}><span style={{ color: '#64748b', width: 18 }}>{String.fromCharCode(65 + index)}</span><input value={choice} onChange={event => { const choices = [...(question.interaction.choices ?? [])]; choices[index] = event.target.value; onChange({ ...question, interaction: { ...question.interaction, choices } }); }} style={inputStyle} /></div>)}</div> : null}
      <label style={labelStyle}>Model answer <span style={{ color: '#64748b', fontWeight: 400 }}>(leave empty when no source answer exists)</span><textarea value={question.modelAnswer} onChange={event => onChange({ ...question, modelAnswer: event.target.value })} rows={5} placeholder="No answer supplied" style={textareaStyle} /></label>
    </div>
    <div style={{ padding: '12px 17px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'flex-end' }}><button onClick={onClose} style={primaryStyle(false)}>Done</button></div>
  </div></div>;
}

function ExtractionMetric({ label, value, detail, accent = '#93c5fd' }: { label: string; value: string; detail: string; accent?: string }) {
  return <div style={{ padding: '9px 10px', borderRadius: 9, background: '#0b1324', border: '1px solid #26364f' }}><div style={{ color: '#64748b', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div><div style={{ color: accent, fontSize: 18, fontWeight: 900, marginTop: 2 }}>{value}</div><div style={{ color: '#475569', fontSize: 9 }}>{detail}</div></div>;
}

function DebugValue({ label, value }: { label: string; value: string }) {
  return <div style={{ minWidth: 0 }}><div style={{ color: '#475569', fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div><div title={value} style={{ color: '#cbd5e1', fontSize: 10, fontWeight: 700, marginTop: 2, overflowWrap: 'anywhere' }}>{value}</div></div>;
}

function FileBox({ title, required, files, onFiles }: { title: string; required?: boolean; files: File[]; onFiles: (files: File[]) => void }) {
  const addFiles = (incoming: File[]) => { const keys = new Set(files.map(file => `${file.name}:${file.size}:${file.lastModified}`)); onFiles([...files, ...incoming.filter(file => !keys.has(`${file.name}:${file.size}:${file.lastModified}`))]); };
  return <section style={{ minHeight: 220, border: '2px dashed #334155', borderRadius: 16, padding: 18, background: '#111c31' }}><label style={{ display: 'grid', placeItems: 'center', textAlign: 'center', cursor: 'pointer', padding: '10px 8px 14px' }}><input type="file" multiple hidden onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} /><div><div style={{ fontSize: 32, marginBottom: 7 }}>{files.length ? '📚' : '📄'}</div><div style={{ color: 'white', fontWeight: 900 }}>{title}{required && <span style={{ color: '#f87171' }}> *</span>}</div><div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>PDFs, images, documents, or other supported files</div><div style={{ display: 'inline-block', marginTop: 10, padding: '6px 11px', borderRadius: 8, background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.35)', color: '#93c5fd', fontSize: 11, fontWeight: 800 }}>+ Choose files</div></div></label>{files.length > 0 && <div style={{ display: 'grid', gap: 7, maxHeight: 150, overflow: 'auto', paddingTop: 10, borderTop: '1px solid #26364f' }}>{files.map((file, index) => <div key={`${file.name}:${file.size}:${file.lastModified}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 9, background: '#0b1324', border: '1px solid #26364f' }}><span>{file.type.startsWith('image/') ? '🖼️' : file.type === 'application/pdf' ? '📕' : '📄'}</span><div style={{ flex: 1, minWidth: 0 }}><div title={file.name} style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div><div style={{ color: '#64748b', fontSize: 10 }}>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</div></div><button type="button" aria-label={`Remove ${file.name}`} onClick={() => onFiles(files.filter((_, fileIndex) => fileIndex !== index))} style={{ width: 25, height: 25, borderRadius: 7, border: '1px solid rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)', color: '#fca5a5', cursor: 'pointer' }}>×</button></div>)}</div>}</section>;
}

const treeCss = `.manual-placement-tree,.manual-placement-tree ul{display:flex;justify-content:center;position:relative;list-style:none;margin:0;padding:0}.manual-placement-tree ul{padding-top:25px}.manual-placement-tree ul:before{content:'';position:absolute;top:0;left:50%;height:25px;border-left:2px solid #475569}.manual-placement-tree li{position:relative;text-align:center;padding:25px 8px 0}.manual-placement-tree>li{padding-top:0}.manual-placement-tree li:before,.manual-placement-tree li:after{content:'';position:absolute;top:0;width:50%;height:25px;border-top:2px solid #475569}.manual-placement-tree li:before{right:50%}.manual-placement-tree li:after{left:50%;border-left:2px solid #475569}.manual-placement-tree>li:before,.manual-placement-tree>li:after,.manual-placement-tree li:only-child:before,.manual-placement-tree li:only-child:after{display:none}.manual-placement-tree li:only-child{padding-top:0}.manual-placement-tree li:first-child:before,.manual-placement-tree li:last-child:after{border-top:0}.manual-placement-tree li:last-child:before{border-right:2px solid #475569;border-radius:0 8px 0 0}.manual-tree-node{width:88px;height:88px;padding:8px;border-radius:50%;border:2px solid #475569;background:#172033;color:#e2e8f0;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-family:inherit;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.3);transition:.15s}.manual-tree-node span{font-size:18px}.manual-tree-node b{max-width:72px;font-size:9px;line-height:1.15;overflow-wrap:anywhere}.manual-tree-node small{font-size:7px;color:#94a3b8}.manual-tree-node.root{border-color:#22c55e;background:#123226}.manual-tree-node.folder{border-color:#3b82f6;background:#14243e}.manual-tree-node.category{border-color:#a78bfa;background:#281f45}.manual-tree-node.selected{outline:3px solid rgba(250,204,21,.7);outline-offset:3px}.manual-tree-node.drag-over{transform:scale(1.12);border-color:#22c55e;background:#14532d;box-shadow:0 0 0 6px rgba(34,197,94,.16)}`;
const labelStyle: CSSProperties = { display: 'grid', gap: 6, color: '#94a3b8', fontSize: 11, fontWeight: 800, marginBottom: 15 };
const inputStyle: CSSProperties = { flex: 1, padding: '7px 9px', borderRadius: 7, border: '1px solid #334155', background: '#0b1324', color: 'white' };
const textareaStyle: CSSProperties = { width: '100%', resize: 'vertical', padding: 10, borderRadius: 9, border: '1px solid #334155', background: '#0b1324', color: 'white', fontFamily: 'inherit', lineHeight: 1.5 };
function primaryStyle(disabled: boolean): CSSProperties { return { border: 0, borderRadius: 9, padding: '9px 16px', color: disabled ? '#64748b' : 'white', background: disabled ? '#1e293b' : 'linear-gradient(135deg,#3b82f6,#8b5cf6)', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 800 }; }
