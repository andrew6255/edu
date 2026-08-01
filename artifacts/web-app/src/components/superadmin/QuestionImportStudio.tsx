import { useMemo, useState } from 'react';
import { extractQuestionPdfs, organizeProgramQuestions, type OrganizerResult, type OrganizerTreeNode, type QuestionPdfProgress } from '@/lib/programIngestionService';

export type ImportedQuestion = {
  id: string;
  promptRawText: string;
  promptBlocks: Array<Record<string, unknown>>;
  interaction: { type: string; choices?: string[]; correctChoiceIndex?: number };
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
    const q = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const interaction = (q.interaction && typeof q.interaction === 'object' ? q.interaction : {}) as ImportedQuestion['interaction'];
    const blockText = Array.isArray(q.promptBlocks) ? (q.promptBlocks as Array<Record<string, unknown>>).map(block => typeof block.text === 'string' ? block.text : '').filter(Boolean).join(' ') : '';
    const promptRawText = typeof q.promptRawText === 'string' && q.promptRawText.trim() ? q.promptRawText
      : typeof q.rawText === 'string' && q.rawText.trim() ? q.rawText
      : typeof q.question === 'string' && q.question.trim() ? q.question
      : blockText;
    return {
      id: `import_${Date.now()}_${index}`,
      promptRawText,
      promptBlocks: Array.isArray(q.promptBlocks) ? q.promptBlocks as Array<Record<string, unknown>> : [],
      interaction,
      pageNumber: typeof q.pageNumber === 'number' ? q.pageNumber : undefined,
      questionNumber: typeof q.questionNumber === 'string' || typeof q.questionNumber === 'number' ? q.questionNumber : index + 1,
      reviewStatus: typeof q.reviewStatus === 'string' ? q.reviewStatus : undefined,
      flags: Array.isArray(q.flags) ? q.flags.map(String) : [],
    };
  });
}

export default function QuestionImportStudio({ open, programTitle, subject, programId, baseRevision, currentTree, existingQuestions, categories, onClose, onApply }: Props) {
  const [questionFiles, setQuestionFiles] = useState<File[]>([]);
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [questions, setQuestions] = useState<ImportedQuestion[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<QuestionPdfProgress | null>(null);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [proposal, setProposal] = useState<OrganizerResult | null>(null);
  const [structureApproved, setStructureApproved] = useState(false);
  const [risksAcknowledged, setRisksAcknowledged] = useState(false);

  const proposedCategories = useMemo<ImportCategoryOption[]>(() => {
    if (!proposal) return categories;
    const result: ImportCategoryOption[] = [];
    const visit = (node: OrganizerTreeNode, parents: string[]) => {
      const path = [...parents, node.title];
      if (node.kind === 'category') result.push({ id: node.id, path: path.join(' / ') });
      else node.children.forEach(child => visit(child, path));
    };
    proposal.previewTree.forEach(node => visit(node, []));
    return result;
  }, [proposal, categories]);
  const proposalRiskCount = useMemo(() => proposal?.assessments.filter(item =>
    (item.detectedSubject.toLowerCase() !== subject.toLowerCase() && item.subjectConfidence >= 0.7)
    || (!!item.likelyDuplicateQuestionId && item.duplicateConfidence >= 0.75)
  ).length ?? 0, [proposal, subject]);

  const proposedCategoryIds = useMemo(() => new Set(proposedCategories.map(category => category.id)), [proposedCategories]);
  const unresolved = useMemo(() => questions.filter(q => !assignments[q.id] || !proposedCategoryIds.has(assignments[q.id])).length, [questions, assignments, proposedCategoryIds]);
  const flagged = useMemo(() => questions.filter(q => q.flags.length > 0 || q.reviewStatus === 'FLAGGED_FOR_REVIEW').length, [questions]);

  if (!open) return null;

  const resetAndClose = () => {
    if (processing) return;
    setQuestionFiles([]); setAnswerFiles([]); setQuestions([]); setAssignments({}); setProgress(null); setError(''); setProposal(null); setStructureApproved(false); setRisksAcknowledged(false);
    onClose();
  };

  const runExtraction = async () => {
    if (questionFiles.length === 0) return;
    setProcessing(true); setError(''); setQuestions([]); setAssignments({});
    try {
      const result = await extractQuestionPdfs(questionFiles, answerFiles, setProgress);
      const normalized = normalizeImportedQuestions(result);
      if (normalized.length === 0) throw new Error('No questions were found in the uploaded paper.');
      setQuestions(normalized);
      setProgress({ icon: '🧭', message: 'Organizing program structure…', detail: 'Checking subject, duplicates, taxonomy, and placements.' });
      const organized = await organizeProgramQuestions({
        programId,
        programSubject: subject,
        baseRevision,
        currentTree,
        incomingQuestions: normalized.map(question => ({ id: question.id, text: question.promptRawText, flags: question.flags })),
        existingQuestions,
      });
      setProposal(organized);
      setAssignments(Object.fromEntries(organized.placements.map(placement => [placement.questionId, placement.destinationCategoryId])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Question Import Studio" style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(2,6,23,.88)', display: 'grid', placeItems: 'center', padding: 18 }}>
      <div style={{ width: 'min(1180px, 98vw)', height: 'min(820px, 94vh)', background: '#0f172a', border: '1px solid #334155', borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 30px 100px rgba(0,0,0,.7)' }}>
        <header style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(120deg,rgba(59,130,246,.15),rgba(139,92,246,.12))' }}>
          <div style={{ fontSize: 26 }}>📚</div>
          <div style={{ flex: 1 }}><div style={{ color: 'white', fontWeight: 900 }}>Question Import Studio</div><div style={{ color: '#94a3b8', fontSize: 12 }}>{programTitle} · {subject || 'Subject not set'}</div></div>
          <div style={{ fontSize: 11, color: '#93c5fd', padding: '5px 9px', borderRadius: 99, background: 'rgba(59,130,246,.12)' }}>{questions.length ? structureApproved ? 'Placement review' : 'Structure review' : processing ? 'Extracting & auditing' : 'Source files'}</div>
          <button className="ll-btn" disabled={processing} onClick={resetAndClose}>✕</button>
        </header>

        {questions.length === 0 ? (
          <main style={{ padding: 26, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <FileBox title="Question files" required files={questionFiles} onFiles={setQuestionFiles} />
            <FileBox title="Answers / marking schemes" files={answerFiles} onFiles={setAnswerFiles} />
            <section style={{ gridColumn: '1 / -1', background: '#111c31', border: '1px solid #26364f', borderRadius: 14, padding: 18 }}>
              <div style={{ color: 'white', fontWeight: 800, marginBottom: 8 }}>{processing ? progress?.message ?? 'Starting extraction…' : 'What happens next'}</div>
              <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.7 }}>{processing ? progress?.detail : 'The system extracts the paper, matches every available source answer, and performs vision and structural audits. Nothing is added to the draft until you review every placement.'}</div>
              {processing && <div style={{ height: 5, background: '#1e293b', borderRadius: 99, marginTop: 14, overflow: 'hidden' }}><div style={{ width: '55%', height: '100%', background: 'linear-gradient(90deg,#3b82f6,#a855f7)', animation: 'shimmer 1.5s infinite' }} /></div>}
              {error && <div style={{ color: '#fca5a5', marginTop: 12, fontSize: 13 }}>{error}</div>}
            </section>
          </main>
        ) : (
          <main style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '310px 1fr' }}>
            <aside style={{ borderRight: '1px solid #334155', padding: 16, overflow: 'auto', background: '#0b1324' }}>
              <div style={{ color: 'white', fontWeight: 900, marginBottom: 4 }}>Program directory</div>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 14 }}>Choose a terminal category for every question.</div>
              {proposedCategories.map(c => <div key={c.id} style={{ padding: '8px 10px', marginBottom: 5, borderRadius: 8, background: '#111c31', color: '#cbd5e1', fontSize: 12 }}>📁 {c.path}</div>)}
            </aside>
            <section style={{ padding: 18, overflow: 'auto' }}>
              {!structureApproved && proposal ? <StructureReview proposal={proposal} currentTree={currentTree} questions={questions} assignments={assignments} categories={proposedCategories} onAssignmentsChange={setAssignments} subject={subject} risksAcknowledged={risksAcknowledged} onRiskAcknowledgement={setRisksAcknowledged} onProposalChange={setProposal} /> : <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}><Stat label="Extracted" value={questions.length} color="#60a5fa" /><Stat label="Needs attention" value={flagged} color="#fbbf24" /><Stat label="Unassigned" value={unresolved} color="#f87171" /></div>
              {questions.map((question, index) => (
                <article key={question.id} style={{ padding: 14, marginBottom: 10, borderRadius: 12, background: '#111c31', border: `1px solid ${question.flags.length ? 'rgba(245,158,11,.45)' : '#26364f'}` }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ color: '#93c5fd', fontWeight: 900, minWidth: 42 }}>Q{question.questionNumber ?? index + 1}</div>
                    <div style={{ flex: 1 }}><div style={{ color: 'white', fontSize: 13, lineHeight: 1.55 }}>{question.promptRawText || 'Image-based question'}</div>{question.flags.length > 0 && <div style={{ color: '#fbbf24', fontSize: 11, marginTop: 6 }}>{question.flags.join(' · ')}</div>}</div>
                    <select aria-label={`Destination for question ${question.questionNumber ?? index + 1}`} value={assignments[question.id] ?? ''} onChange={e => setAssignments(prev => ({ ...prev, [question.id]: e.target.value }))} style={{ width: 260, padding: '8px 10px', borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: 'white' }}>
                      <option value="">Choose category…</option>{proposedCategories.map(c => <option key={c.id} value={c.id}>{c.path}</option>)}
                    </select>
                  </div>
                </article>
              ))}</>}
            </section>
          </main>
        )}

        <footer style={{ borderTop: '1px solid #334155', padding: '13px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: '#64748b', fontSize: 12 }}>{questions.length ? proposal?.summary ?? 'Review organizer proposal.' : `${questionFiles.length} question file(s) · ${answerFiles.length} answer file(s)`}</div>
          <div style={{ display: 'flex', gap: 8 }}><button className="ll-btn" onClick={resetAndClose} disabled={processing}>Cancel</button>{questions.length === 0 ? <button onClick={runExtraction} disabled={questionFiles.length === 0 || processing} style={primaryStyle(questionFiles.length === 0 || processing)}>{processing ? 'Processing…' : 'Extract, audit and organize →'}</button> : !structureApproved ? <button onClick={() => setStructureApproved(true)} disabled={!proposal || (proposalRiskCount > 0 && !risksAcknowledged)} style={primaryStyle(!proposal || (proposalRiskCount > 0 && !risksAcknowledged))}>Approve structure →</button> : <button onClick={() => proposal && onApply({ placements: questions.map(question => ({ question, categoryId: assignments[question.id] })), previewTree: proposal.previewTree, proposal })} disabled={unresolved > 0 || proposedCategories.length === 0} style={primaryStyle(unresolved > 0 || proposedCategories.length === 0)}>Apply {questions.length} questions to draft</button>}</div>
        </footer>
      </div>
    </div>
  );
}

function FileBox({ title, required, files, onFiles }: { title: string; required?: boolean; files: File[]; onFiles: (files: File[]) => void }) {
  const addFiles = (incoming: File[]) => {
    const keys = new Set(files.map(file => `${file.name}:${file.size}:${file.lastModified}`));
    onFiles([...files, ...incoming.filter(file => !keys.has(`${file.name}:${file.size}:${file.lastModified}`))]);
  };
  return <section style={{ minHeight: 220, border: '2px dashed #334155', borderRadius: 16, padding: 18, background: '#111c31' }}>
    <label style={{ display: 'grid', placeItems: 'center', textAlign: 'center', cursor: 'pointer', padding: '10px 8px 14px' }}>
      <input type="file" multiple hidden onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />
      <div><div style={{ fontSize: 32, marginBottom: 7 }}>{files.length ? '📚' : '📄'}</div><div style={{ color: 'white', fontWeight: 900 }}>{title}{required && <span style={{ color: '#f87171' }}> *</span>}</div><div style={{ color: '#64748b', fontSize: 12, marginTop: 6 }}>Add PDFs, images, documents, or other supported files</div><div style={{ display: 'inline-block', marginTop: 10, padding: '6px 11px', borderRadius: 8, background: 'rgba(59,130,246,.12)', border: '1px solid rgba(59,130,246,.35)', color: '#93c5fd', fontSize: 11, fontWeight: 800 }}>+ Choose files</div></div>
    </label>
    {files.length > 0 && <div style={{ display: 'grid', gap: 7, maxHeight: 150, overflow: 'auto', paddingTop: 10, borderTop: '1px solid #26364f' }}>{files.map((file, index) => <div key={`${file.name}:${file.size}:${file.lastModified}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 9, background: '#0b1324', border: '1px solid #26364f' }}><span>{file.type.startsWith('image/') ? '🖼️' : file.type === 'application/pdf' ? '📕' : '📄'}</span><div style={{ flex: 1, minWidth: 0 }}><div title={file.name} style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div><div style={{ color: '#64748b', fontSize: 10 }}>{file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB`}</div></div><button type="button" aria-label={`Remove ${file.name}`} onClick={() => onFiles(files.filter((_, fileIndex) => fileIndex !== index))} style={{ width: 25, height: 25, borderRadius: 7, border: '1px solid rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)', color: '#fca5a5', cursor: 'pointer' }}>×</button></div>)}</div>}
  </section>;
}
type TreeIndexEntry = { node: OrganizerTreeNode; parentId: string };
function indexOrganizerTree(nodes: OrganizerTreeNode[], parentId = 'root', result = new Map<string, TreeIndexEntry>()) {
  nodes.forEach(node => { result.set(node.id, { node, parentId }); indexOrganizerTree(node.children, node.id, result); });
  return result;
}
function removeOrganizerNode(nodes: OrganizerTreeNode[], nodeId: string): OrganizerTreeNode[] {
  return nodes.filter(node => node.id !== nodeId).map(node => ({ ...node, children: removeOrganizerNode(node.children, nodeId) }));
}
function updateOrganizerNode(nodes: OrganizerTreeNode[], nodeId: string, update: (node: OrganizerTreeNode) => OrganizerTreeNode): OrganizerTreeNode[] {
  return nodes.map(node => node.id === nodeId ? update(node) : { ...node, children: updateOrganizerNode(node.children, nodeId, update) });
}
function moveOrganizerNode(nodes: OrganizerTreeNode[], nodeId: string, parentId: string): OrganizerTreeNode[] {
  const moving = indexOrganizerTree(nodes).get(nodeId)?.node;
  if (!moving) return nodes;
  const without = removeOrganizerNode(nodes, nodeId);
  if (parentId === 'root') return [...without, moving];
  return updateOrganizerNode(without, parentId, parent => parent.kind === 'folder' ? { ...parent, children: [...parent.children, moving] } : parent);
}
function EditableStructureTree({ proposal, currentTree, onChange }: { proposal: OrganizerResult; currentTree: OrganizerTreeNode[]; onChange: (proposal: OrganizerResult) => void }) {
  const currentIndex = indexOrganizerTree(currentTree);
  const previewIndex = indexOrganizerTree(proposal.previewTree);
  const folderOptions = [...previewIndex.values()].filter(entry => entry.node.kind === 'folder');
  const commit = (tree: OrganizerTreeNode[], operation: OrganizerResult['operations'][number]) => onChange({ ...proposal, previewTree: tree, operations: [...proposal.operations, operation] });
  const addNode = (parentId: string, kind: 'folder' | 'category') => {
    const title = window.prompt(`Name the new ${kind}:`)?.trim();
    if (!title) return;
    const node: OrganizerTreeNode = { id: `manual_${kind}_${Date.now().toString(36)}`, title, kind, children: [] };
    const tree = parentId === 'root' ? [...proposal.previewTree, node] : updateOrganizerNode(proposal.previewTree, parentId, parent => ({ ...parent, children: [...parent.children, node] }));
    commit(tree, { id: `manual_create_${node.id}`, type: 'create_node', parentId, node, decision: 'edited' });
  };
  const renderNode = (node: OrganizerTreeNode, depth: number) => {
    const original = currentIndex.get(node.id);
    const parentId = previewIndex.get(node.id)?.parentId ?? 'root';
    const descendants = indexOrganizerTree(node.children);
    const state = !original ? 'NEW' : original.parentId !== parentId ? 'MOVED' : original.node.title !== node.title ? 'RENAMED' : '';
    return <div key={node.id}>
      <div style={{ marginLeft: depth * 22, display: 'flex', gap: 7, alignItems: 'center', padding: '7px 8px', marginBottom: 5, borderRadius: 9, border: `1px solid ${state ? 'rgba(59,130,246,.45)' : '#26364f'}`, background: state ? 'rgba(59,130,246,.08)' : '#111c31' }}>
        <span>{node.kind === 'folder' ? '📁' : '🏷️'}</span>
        <input value={node.title} onChange={event => onChange({ ...proposal, previewTree: updateOrganizerNode(proposal.previewTree, node.id, value => ({ ...value, title: event.target.value })) })} onBlur={() => { if (original && original.node.title !== node.title) onChange({ ...proposal, operations: [...proposal.operations, { id: `manual_rename_${node.id}_${Date.now()}`, type: 'rename_node', nodeId: node.id, title: node.title, decision: 'edited' }] }); }} style={{ flex: 1, minWidth: 100, border: 0, borderBottom: '1px solid #334155', background: 'transparent', color: 'white', padding: '4px 3px', fontSize: 12, fontWeight: 700 }} />
        {state && <span style={{ padding: '2px 6px', borderRadius: 99, background: state === 'NEW' ? 'rgba(34,197,94,.15)' : 'rgba(59,130,246,.15)', color: state === 'NEW' ? '#86efac' : '#93c5fd', fontSize: 9, fontWeight: 900 }}>{state}</span>}
        <select aria-label={`Parent for ${node.title}`} value={parentId} onChange={event => commit(moveOrganizerNode(proposal.previewTree, node.id, event.target.value), { id: `manual_move_${node.id}_${Date.now()}`, type: 'move_node', nodeId: node.id, parentId: event.target.value, decision: 'edited' })} style={{ maxWidth: 145, padding: '5px 6px', borderRadius: 7, border: '1px solid #334155', background: '#0f172a', color: '#cbd5e1', fontSize: 10 }}>
          <option value="root">Root</option>{folderOptions.filter(option => option.node.id !== node.id && !descendants.has(option.node.id)).map(option => <option key={option.node.id} value={option.node.id}>{option.node.title}</option>)}
        </select>
        {node.kind === 'folder' && <><button className="ll-btn" title="Add folder" onClick={() => addNode(node.id, 'folder')} style={{ padding: '4px 7px', fontSize: 10 }}>+ Folder</button><button className="ll-btn" title="Add category" onClick={() => addNode(node.id, 'category')} style={{ padding: '4px 7px', fontSize: 10 }}>+ Category</button></>}
        <button title={`Remove ${node.title}`} onClick={() => commit(removeOrganizerNode(proposal.previewTree, node.id), { id: `manual_delete_${node.id}_${Date.now()}`, type: 'delete_node', nodeId: node.id, decision: 'edited' })} style={{ width: 25, height: 25, borderRadius: 7, border: '1px solid rgba(239,68,68,.35)', background: 'rgba(239,68,68,.08)', color: '#fca5a5', cursor: 'pointer' }}>×</button>
      </div>
      {node.children.map(child => renderNode(child, depth + 1))}
    </div>;
  };
  const removed = [...currentIndex.values()].filter(entry => !previewIndex.has(entry.node.id));
  const renderDiffNode = (node: OrganizerTreeNode, removedBranch = false): React.ReactNode => {
    const original = currentIndex.get(node.id);
    const preview = previewIndex.get(node.id);
    const state = removedBranch || !preview ? 'removed' : !original ? 'new' : original.parentId !== preview.parentId ? 'moved' : original.node.title !== node.title ? 'renamed' : 'unchanged';
    const removedChildren = removedBranch ? [] : (original?.node.children ?? []).filter(child => !previewIndex.has(child.id));
    const visibleChildren = removedBranch ? node.children : [...node.children, ...removedChildren];
    return <li key={`${node.id}:${state}`}><div className={`import-diff-node ${state}`}><span>{node.kind === 'folder' ? '📁' : '🏷️'}</span><span>{node.title}</span>{state !== 'unchanged' && <b>{state.toUpperCase()}</b>}</div>{visibleChildren.length > 0 && <ul>{visibleChildren.map(child => renderDiffNode(child, removedBranch || removedChildren.some(removedChild => removedChild.id === child.id)))}</ul>}</li>;
  };
  const removedRoots = currentTree.filter(node => !previewIndex.has(node.id));
  return <div style={{ marginBottom: 18 }}>
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: 'white', fontWeight: 900 }}>Tree changes</div>
      <div style={{ color: '#64748b', fontSize: 11, marginBottom: 9 }}>Changes are marked directly on the hierarchy: green is new, blue is moved/renamed, and red is removed.</div>
      <div style={{ overflow: 'auto', padding: '14px 10px', borderRadius: 11, border: '1px solid #26364f', background: '#080f1d' }}>
        <style>{`
          .import-diff-tree,.import-diff-tree ul{display:flex;justify-content:center;position:relative;list-style:none;margin:0;padding:0}.import-diff-tree ul{padding-top:20px}.import-diff-tree ul:before{content:'';position:absolute;top:0;left:50%;height:20px;border-left:2px solid #475569}.import-diff-tree li{position:relative;text-align:center;padding:20px 7px 0}.import-diff-tree>li{padding-top:0}.import-diff-tree li:before,.import-diff-tree li:after{content:'';position:absolute;top:0;width:50%;height:20px;border-top:2px solid #475569}.import-diff-tree li:before{right:50%}.import-diff-tree li:after{left:50%;border-left:2px solid #475569}.import-diff-tree>li:before,.import-diff-tree>li:after,.import-diff-tree li:only-child:before,.import-diff-tree li:only-child:after{display:none}.import-diff-tree li:only-child{padding-top:0}.import-diff-tree li:first-child:before,.import-diff-tree li:last-child:after{border-top:0}.import-diff-tree li:last-child:before{border-right:2px solid #475569;border-radius:0 8px 0 0}.import-diff-node{width:80px;height:80px;padding:7px;border-radius:50%;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:#172033;border:2px solid #475569;color:#e2e8f0;font-size:9px;font-weight:800;overflow-wrap:anywhere;box-shadow:0 5px 16px rgba(0,0,0,.3)}.import-diff-node b{font-size:7px;letter-spacing:.04em}.import-diff-node.new{border-color:#22c55e;background:#123b29;color:#bbf7d0}.import-diff-node.moved,.import-diff-node.renamed{border-color:#3b82f6;background:#142f58;color:#bfdbfe}.import-diff-node.removed{border-color:#ef4444;background:#421b22;color:#fecaca;opacity:.8;text-decoration:line-through}
        `}</style>
        <ul className="import-diff-tree">{[...proposal.previewTree.map(node => renderDiffNode(node)), ...removedRoots.map(node => renderDiffNode(node, true))]}</ul>
      </div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 9 }}><div><div style={{ color: 'white', fontWeight: 900 }}>Editable proposed tree</div><div style={{ color: '#64748b', fontSize: 11 }}>Rename nodes, change their parent, create branches, or remove them.</div></div><div style={{ display: 'flex', gap: 6 }}><button className="ll-btn" onClick={() => addNode('root', 'folder')} style={{ fontSize: 10 }}>+ Root folder</button><button className="ll-btn" onClick={() => addNode('root', 'category')} style={{ fontSize: 10 }}>+ Root category</button></div></div>
    <div style={{ padding: 9, borderRadius: 11, border: '1px solid #26364f', background: '#0b1324' }}>{proposal.previewTree.length ? proposal.previewTree.map(node => renderNode(node, 0)) : <div style={{ padding: 14, color: '#64748b' }}>The proposed tree is empty. Create a root folder or category.</div>}</div>
    {removed.length > 0 && <div style={{ marginTop: 9, padding: 10, borderRadius: 9, background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.22)', color: '#fca5a5', fontSize: 11 }}><b>Removed:</b> {removed.map(entry => entry.node.title).join(', ')}</div>}
  </div>;
}
function StructureReview({ proposal, currentTree, questions, assignments, categories, onAssignmentsChange, subject, risksAcknowledged, onRiskAcknowledgement, onProposalChange }: { proposal: OrganizerResult; currentTree: OrganizerTreeNode[]; questions: ImportedQuestion[]; assignments: Record<string, string>; categories: ImportCategoryOption[]; onAssignmentsChange: (assignments: Record<string, string>) => void; subject: string; risksAcknowledged: boolean; onRiskAcknowledgement: (value: boolean) => void; onProposalChange: (proposal: OrganizerResult) => void }) {
  const mismatches = proposal.assessments.filter(item => item.detectedSubject.toLowerCase() !== subject.toLowerCase() && item.subjectConfidence >= 0.7);
  const duplicates = proposal.assessments.filter(item => item.likelyDuplicateQuestionId && item.duplicateConfidence >= 0.75);
  return <div>
    <div style={{ color: 'white', fontWeight: 900, fontSize: 17, marginBottom: 6 }}>Review proposed directory changes</div>
    <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>{proposal.summary}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 18 }}>
      <Stat label="Structural changes" value={proposal.operations.length} color="#a78bfa" />
      <Stat label="Subject mismatches" value={mismatches.length} color={mismatches.length ? '#f87171' : '#34d399'} />
      <Stat label="Likely duplicates" value={duplicates.length} color={duplicates.length ? '#fbbf24' : '#34d399'} />
    </div>
    <EditableStructureTree proposal={proposal} currentTree={currentTree} onChange={onProposalChange} />
    <div style={{ marginBottom: 18 }}>
      <div style={{ color: 'white', fontWeight: 900, marginBottom: 4 }}>Question placement on the proposed tree</div>
      <div style={{ color: '#64748b', fontSize: 11, marginBottom: 9 }}>Change each question’s terminal category before approving the structure.</div>
      {questions.map((question, index) => <div key={question.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', marginBottom: 6, borderRadius: 9, background: '#111c31', border: '1px solid #26364f' }}><span style={{ color: '#93c5fd', fontSize: 11, fontWeight: 900 }}>Q{question.questionNumber ?? index + 1}</span><span title={question.promptRawText} style={{ flex: 1, minWidth: 0, color: '#cbd5e1', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{question.promptRawText || 'Image-based question'}</span><select value={assignments[question.id] ?? ''} onChange={event => onAssignmentsChange({ ...assignments, [question.id]: event.target.value })} style={{ width: 260, padding: '6px 8px', borderRadius: 7, border: '1px solid #475569', background: '#0f172a', color: 'white', fontSize: 11 }}><option value="">Choose category…</option>{categories.map(category => <option key={category.id} value={category.id}>{category.path}</option>)}</select></div>)}
    </div>
    {proposal.operations.length === 0 ? <div style={{ padding: 14, borderRadius: 10, background: '#111c31', color: '#94a3b8' }}>The organizer kept the existing directory structure.</div> : proposal.operations.map(operation => <div key={operation.id} style={{ padding: '12px 14px', borderRadius: 10, background: '#111c31', border: '1px solid #26364f', marginBottom: 8, display: 'flex', gap: 10 }}><span>✨</span><div><div style={{ color: 'white', fontWeight: 800, fontSize: 13 }}>{operation.type.replace(/_/g, ' ')}</div><div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{operation.id}</div></div></div>)}
    {mismatches.map(item => <div key={item.questionId} style={{ color: '#fca5a5', fontSize: 12, marginTop: 8 }}>Subject warning: {item.questionId} appears to be {item.detectedSubject} ({Math.round(item.subjectConfidence * 100)}%).</div>)}
    {duplicates.map(item => <div key={item.questionId} style={{ color: '#fcd34d', fontSize: 12, marginTop: 8 }}>Duplicate warning: {item.questionId} resembles {item.likelyDuplicateQuestionId} ({Math.round(item.duplicateConfidence * 100)}%).</div>)}
    {(mismatches.length > 0 || duplicates.length > 0) && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, color: '#e2e8f0', fontSize: 12 }}><input type="checkbox" checked={risksAcknowledged} onChange={event => onRiskAcknowledgement(event.target.checked)} />I reviewed the subject and duplicate warnings and want to continue.</label>}
  </div>;
}
function Stat({ label, value, color }: { label: string; value: number; color: string }) { return <div style={{ flex: 1, borderRadius: 10, padding: '10px 12px', background: '#111c31', border: '1px solid #26364f' }}><div style={{ color, fontWeight: 900, fontSize: 18 }}>{value}</div><div style={{ color: '#64748b', fontSize: 11 }}>{label}</div></div>; }
function primaryStyle(disabled: boolean): React.CSSProperties { return { border: 0, borderRadius: 9, padding: '9px 16px', color: disabled ? '#64748b' : 'white', background: disabled ? '#1e293b' : 'linear-gradient(135deg,#3b82f6,#8b5cf6)', cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 800 }; }
