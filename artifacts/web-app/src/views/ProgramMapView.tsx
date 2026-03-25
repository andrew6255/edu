import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

import { useAuth } from '@/contexts/AuthContext';
import { getPublicProgram, setProgramCompletedForUser, type TocItem } from '@/lib/programMaps';
import { applyRankedAnswer, getProgramProgress, markQuestionSolved, toggleUnitComplete } from '@/lib/programProgress';
import { updateEconomy } from '@/lib/userService';
import {
  fetchProgramAnnotationsFromPublic,
  fetchProgramChapterFromPublic,
  flattenProgramChapter,
  type FlatProgramQuestion,
  type ProgramAnnotationsFile,
} from '@/lib/programQuestionBank';

type Selected = { id: string; title: string; ref?: string | null } | null;

function flattenChildren(items: TocItem[] | undefined): TocItem[] {
  if (!Array.isArray(items)) return [];
  const out: TocItem[] = [];
  for (const it of items) {
    out.push(it);
    if (Array.isArray(it.children) && it.children.length > 0) {
      out.push(...flattenChildren(it.children));
    }
  }
  return out;
}

 export default function ProgramMapView({ onBack, programId: programIdProp }: { onBack: () => void; programId?: string | null }) {
  const { user, userData } = useAuth();
  const uid = user?.uid ?? null;
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState<string>('Program Map');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<Selected>(null);
  const [includeSections, setIncludeSections] = useState(true);
  const [completedUnitIds, setCompletedUnitIds] = useState<string[]>([]);
  const [solvedQuestionIds, setSolvedQuestionIds] = useState<string[]>([]);
  const [rankedTrophies, setRankedTrophies] = useState<number>(0);
  const [rankedSolvedQuestionIds, setRankedSolvedQuestionIds] = useState<string[]>([]);
  const [completionPct, setCompletionPct] = useState<number>(0);
  const flowWrapRef = useRef<HTMLDivElement | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [flowRect, setFlowRect] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [isNarrow, setIsNarrow] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth < 760 : false));
  const [qbLoading, setQbLoading] = useState<boolean>(false);
  const [qbError, setQbError] = useState<string | null>(null);
  const [qbChapterId, setQbChapterId] = useState<string | null>(null);
  const [qbAnnotations, setQbAnnotations] = useState<ProgramAnnotationsFile | null>(null);
  const [qbQuestions, setQbQuestions] = useState<FlatProgramQuestion[]>([]);
  const [qbRegions, setQbRegions] = useState<Array<{ regionId: string; title: string; label: string | null; theme: string | null }>>([]);
  const [qbQuestionTypes, setQbQuestionTypes] = useState<Array<{ id: string; title: string; treeOrder: number }>>([]);

  const [soloActive, setSoloActive] = useState(false);
  const [soloRegionId, setSoloRegionId] = useState<string | null>(null);
  const [soloQuestionTypeId, setSoloQuestionTypeId] = useState<string | null>(null);
  const [soloQuestionId, setSoloQuestionId] = useState<string | null>(null);
  const [soloSeenIds, setSoloSeenIds] = useState<string[]>([]);
  const [soloFeedback, setSoloFeedback] = useState<{ correct: boolean; correctIndex: number } | null>(null);
  const [soloAwarding, setSoloAwarding] = useState(false);

  const [rankedActive, setRankedActive] = useState(false);
  const [rankedRegionId, setRankedRegionId] = useState<string | null>(null);
  const [rankedQuestionTypeId, setRankedQuestionTypeId] = useState<string | null>(null);
  const [rankedQuestionId, setRankedQuestionId] = useState<string | null>(null);
  const [rankedFeedback, setRankedFeedback] = useState<{ correct: boolean; correctIndex: number } | null>(null);
  const [rankedSaving, setRankedSaving] = useState(false);

  function difficultyRank(d: string | null): number {
    if (d === 'easy') return 1;
    if (d === 'medium') return 2;
    if (d === 'hard') return 3;
    return 9;
  }

  const rankedCandidates = useMemo(() => {
    if (!rankedActive || !rankedRegionId || !rankedQuestionTypeId) return [];
    return qbQuestions
      .filter((q) => q.regionId === rankedRegionId && q.questionTypeId === rankedQuestionTypeId && !!q.mcq)
      .sort((a, b) => {
        const da = difficultyRank(a.difficulty);
        const db = difficultyRank(b.difficulty);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });
  }, [qbQuestions, rankedActive, rankedRegionId, rankedQuestionTypeId]);

  const rankedCurrent = useMemo(() => {
    if (!rankedActive || !rankedQuestionId) return null;
    return qbQuestions.find((q) => q.id === rankedQuestionId) ?? null;
  }, [qbQuestions, rankedActive, rankedQuestionId]);

  function startRanked(regionId: string, questionTypeId: string) {
    setRankedActive(true);
    setRankedRegionId(regionId);
    setRankedQuestionTypeId(questionTypeId);
    setRankedFeedback(null);

    const ordered = qbQuestions
      .filter((q) => q.regionId === regionId && q.questionTypeId === questionTypeId && !!q.mcq)
      .sort((a, b) => {
        const da = difficultyRank(a.difficulty);
        const db = difficultyRank(b.difficulty);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });

    const solvedSet = new Set(rankedSolvedQuestionIds);
    const firstUnsolved = ordered.find((q) => !solvedSet.has(q.id)) ?? ordered[0] ?? null;
    setRankedQuestionId(firstUnsolved?.id ?? null);
  }

  function exitRanked() {
    setRankedActive(false);
    setRankedRegionId(null);
    setRankedQuestionTypeId(null);
    setRankedQuestionId(null);
    setRankedFeedback(null);
    setRankedSaving(false);
  }

  function pickNextRankedQuestion() {
    if (!rankedRegionId || !rankedQuestionTypeId) return;
    const ordered = qbQuestions
      .filter((q) => q.regionId === rankedRegionId && q.questionTypeId === rankedQuestionTypeId && !!q.mcq)
      .sort((a, b) => {
        const da = difficultyRank(a.difficulty);
        const db = difficultyRank(b.difficulty);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });
    const solvedSet = new Set(rankedSolvedQuestionIds);
    const next = ordered.find((q) => !solvedSet.has(q.id)) ?? null;
    setRankedQuestionId(next?.id ?? null);
  }

  async function answerRanked(idx: number) {
    if (!rankedCurrent?.mcq || rankedFeedback || !uid || !programId) return;
    const correctIndex = rankedCurrent.mcq.correctChoiceIndex;
    const correct = idx === correctIndex;
    setRankedFeedback({ correct, correctIndex });

    try {
      setRankedSaving(true);
      const r = await applyRankedAnswer(uid, programId, rankedCurrent.id, correct);
      setRankedTrophies(r.trophies);
      setRankedSolvedQuestionIds(r.solvedIds);
    } catch {
      // ignore
    } finally {
      setRankedSaving(false);
    }
  }

  function continueRanked() {
    const wasCorrect = rankedFeedback?.correct ?? false;
    setRankedFeedback(null);
    if (wasCorrect) pickNextRankedQuestion();
  }

  const activeProgramId = userData?.activeProgramId ?? null;

  const programId = programIdProp ?? activeProgramId;

  useEffect(() => {
    let cancelled = false;

    async function loadQuestionBank() {
      if (!programId) {
        setQbLoading(false);
        setQbError(null);
        setQbChapterId(null);
        setQbAnnotations(null);
        setQbQuestions([]);
        setQbRegions([]);
        setQbQuestionTypes([]);
        return;
      }

      setQbLoading(true);
      setQbError(null);

      try {
        const [chapter, annotations] = await Promise.all([
          fetchProgramChapterFromPublic('/questionBanks/program.sample.v3.json'),
          fetchProgramAnnotationsFromPublic('/questionBanks/program.annotations.sample.v3.json'),
        ]);
        if (cancelled) return;

        const flat = flattenProgramChapter(chapter, annotations);
        setQbChapterId(flat.chapterId);
        setQbAnnotations(annotations);
        setQbQuestions(flat.questions);
        setQbRegions(flat.regions);
        setQbQuestionTypes(flat.questionTypes);
        setQbLoading(false);
      } catch (e) {
        if (cancelled) return;
        setQbError(e instanceof Error ? e.message : 'Failed to load question bank');
        setQbLoading(false);
      }
    }

    loadQuestionBank();
    return () => {
      cancelled = true;
    };
  }, [programId]);

  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 760);
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setFlowReady(false);
  }, [programId, includeSections]);

  useEffect(() => {
    const el = flowWrapRef.current;
    if (!el) return;
    const elNonNull = el;

    function check() {
      const r = elNonNull.getBoundingClientRect();
      setFlowRect({ w: Math.round(r.width), h: Math.round(r.height) });
      if (r.width > 0 && r.height > 0) setFlowReady(true);
    }

    check();
    const ro = new ResizeObserver(() => check());
    ro.observe(elNonNull);
    return () => ro.disconnect();
  }, [loading, nodes.length, edges.length]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!programId) {
        setTitle('Program Map');
        setNodes([]);
        setEdges([]);
        setSelected(null);
        setCompletedUnitIds([]);
        setSolvedQuestionIds([]);
        setCompletionPct(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      const [prog, pp] = await Promise.all([
        getPublicProgram(programId),
        uid ? getProgramProgress(uid, programId) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const completedIds = uid ? (pp?.completedUnitIds ?? []) : [];
      setCompletedUnitIds(completedIds);

      const solvedIds = uid ? ((pp as any)?.solvedQuestionIds ?? []) : [];
      setSolvedQuestionIds(Array.isArray(solvedIds) ? (solvedIds as string[]) : []);

      const rt = uid ? ((pp as any)?.rankedTrophies ?? 0) : 0;
      setRankedTrophies(typeof rt === 'number' ? (rt as number) : 0);

      const rsolved = uid ? ((pp as any)?.rankedSolvedQuestionIds ?? []) : [];
      setRankedSolvedQuestionIds(Array.isArray(rsolved) ? (rsolved as string[]) : []);

      if (!prog) {
        setTitle('Program Map');
        setNodes([]);
        setEdges([]);
        setSelected(null);
        setLoading(false);
        return;
      }

      setTitle(prog.title);

      const top = (prog.toc.toc_tree || []).filter((x) => x && typeof x === 'object');

      const unitItemIds: string[] = top.map((it: any, idx: number) => String(it.id || idx));
      const completedCount = unitItemIds.filter((id) => completedIds.includes(id)).length;
      const pct = unitItemIds.length > 0 ? Math.round((completedCount / unitItemIds.length) * 100) : 0;
      setCompletionPct(pct);

      const unitNodes: Node[] = [];
      const unitEdges: Edge[] = [];

      const xStep = 260;
      const y0 = 120;

      const unitIds: string[] = [];
      for (let i = 0; i < top.length; i++) {
        const it = top[i];
        const nodeId = `UNIT_${it.id || i}`;
        const unitItemId = String(it.id || i);
        unitIds.push(nodeId);
        const done = completedIds.includes(unitItemId);
        unitNodes.push({
          id: nodeId,
          type: 'default',
          position: { x: i * xStep, y: y0 },
          data: {
            label: it.title,
            _meta: { title: it.title, ref: it.ref ?? null, unitItemId },
          },
          style: {
            background: done ? 'rgba(251,191,36,0.18)' : 'rgba(59,130,246,0.18)',
            border: done ? '1px solid rgba(251,191,36,0.65)' : '1px solid rgba(59,130,246,0.55)',
            color: 'white',
            borderRadius: 12,
            padding: 8,
            width: 220,
            textAlign: 'center',
            fontWeight: 700,
          },
        });
      }

      for (let i = 0; i < unitIds.length - 1; i++) {
        unitEdges.push({
          id: `E_${unitIds[i]}_${unitIds[i + 1]}`,
          source: unitIds[i],
          target: unitIds[i + 1],
          animated: false,
          style: { stroke: 'rgba(148,163,184,0.9)', strokeWidth: 2 },
        });
      }

      const sectionNodes: Node[] = [];
      const sectionEdges: Edge[] = [];

      if (includeSections) {
        const ySection = 260;
        for (let i = 0; i < top.length; i++) {
          const it = top[i];
          const unitId = unitIds[i];
          const children = Array.isArray(it.children) ? it.children : [];
          for (let j = 0; j < children.length; j++) {
            const ch = children[j];
            const sid = `SEC_${it.id || i}_${ch.id || j}`;
            sectionNodes.push({
              id: sid,
              position: { x: i * xStep + (j % 2) * 40, y: ySection + j * 60 },
              data: {
                label: ch.title,
                _meta: { title: ch.title, ref: ch.ref ?? null },
              },
              style: {
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.45)',
                color: 'white',
                borderRadius: 10,
                padding: 6,
                width: 220,
                fontSize: 12,
              },
            });
            sectionEdges.push({
              id: `E_${unitId}_${sid}`,
              source: unitId,
              target: sid,
              style: { strokeDasharray: '6 4', stroke: 'rgba(16,185,129,0.75)' },
            });
          }
        }
      }

      setNodes([...unitNodes, ...sectionNodes]);
      setEdges([...unitEdges, ...sectionEdges]);
      setSelected(null);
      setLoading(false);

      // If user completed all units, record completion on profile
      if (uid && unitItemIds.length > 0 && completedCount === unitItemIds.length) {
        try {
          await setProgramCompletedForUser(uid, programId, true);
        } catch {
          // ignore
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [programId, includeSections, uid]);

  const nodeById = useMemo(() => {
    const m = new Map<string, { title: string; ref?: string | null }>();
    for (const n of nodes) {
      const meta = (n.data as any)?._meta as { title?: string; ref?: string | null } | undefined;
      if (meta?.title) m.set(n.id, { title: meta.title, ref: meta.ref });
    }
    return m;
  }, [nodes]);

  const qbCounts = useMemo(() => {
    const byRegion: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byRegionAndType: Record<string, Record<string, number>> = {};

    for (const q of qbQuestions) {
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegion[rid] = (byRegion[rid] ?? 0) + 1;
      byType[tid] = (byType[tid] ?? 0) + 1;
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }

    return { byRegion, byType, byRegionAndType };
  }, [qbQuestions]);

  const qbSolvedCounts = useMemo(() => {
    const solvedSet = new Set(solvedQuestionIds);
    const byRegion: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byRegionAndType: Record<string, Record<string, number>> = {};

    for (const q of qbQuestions) {
      if (!solvedSet.has(q.id)) continue;
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegion[rid] = (byRegion[rid] ?? 0) + 1;
      byType[tid] = (byType[tid] ?? 0) + 1;
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }

    return { byRegion, byType, byRegionAndType };
  }, [qbQuestions, solvedQuestionIds]);

  const qbRankedSolvedCounts = useMemo(() => {
    const solvedSet = new Set(rankedSolvedQuestionIds);
    const byRegionAndType: Record<string, Record<string, number>> = {};
    for (const q of qbQuestions) {
      if (!solvedSet.has(q.id)) continue;
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }
    return { byRegionAndType };
  }, [qbQuestions, rankedSolvedQuestionIds]);

  const soloCandidates = useMemo(() => {
    if (!soloActive || !soloRegionId || !soloQuestionTypeId) return [];
    return qbQuestions.filter((q) => q.regionId === soloRegionId && q.questionTypeId === soloQuestionTypeId && !!q.mcq);
  }, [qbQuestions, soloActive, soloRegionId, soloQuestionTypeId]);

  const soloCurrent = useMemo(() => {
    if (!soloActive || !soloQuestionId) return null;
    return qbQuestions.find((q) => q.id === soloQuestionId) ?? null;
  }, [qbQuestions, soloActive, soloQuestionId]);

  function pickNextSoloQuestion(seen: string[]) {
    if (!soloRegionId || !soloQuestionTypeId) return;
    const candidates = qbQuestions.filter((q) => q.regionId === soloRegionId && q.questionTypeId === soloQuestionTypeId && !!q.mcq);
    const unseen = candidates.filter((q) => !seen.includes(q.id));
    const unsolvedUnseen = unseen.filter((q) => !solvedQuestionIds.includes(q.id));
    const unsolvedAny = candidates.filter((q) => !solvedQuestionIds.includes(q.id));
    const pool = unsolvedUnseen.length > 0 ? unsolvedUnseen : (unsolvedAny.length > 0 ? unsolvedAny : (unseen.length > 0 ? unseen : candidates));
    if (pool.length === 0) {
      setSoloQuestionId(null);
      return;
    }
    const next = pool[Math.floor(Math.random() * pool.length)];
    setSoloQuestionId(next.id);
  }

  function startSolo(regionId: string, questionTypeId: string) {
    setSoloActive(true);
    setSoloRegionId(regionId);
    setSoloQuestionTypeId(questionTypeId);
    setSoloSeenIds([]);
    setSoloFeedback(null);
    setSoloQuestionId(null);
    pickNextSoloQuestion([]);
  }

  function exitSolo() {
    setSoloActive(false);
    setSoloRegionId(null);
    setSoloQuestionTypeId(null);
    setSoloQuestionId(null);
    setSoloSeenIds([]);
    setSoloFeedback(null);
    setSoloAwarding(false);
  }

  async function answerSolo(idx: number) {
    if (!soloCurrent?.mcq || soloFeedback) return;
    const correctIndex = soloCurrent.mcq.correctChoiceIndex;
    const correct = idx === correctIndex;
    setSoloFeedback({ correct, correctIndex });

    if (correct && uid) {
      try {
        setSoloAwarding(true);
        if (programId) {
          await markQuestionSolved(uid, programId, soloCurrent.id);
          setSolvedQuestionIds((prev) => (prev.includes(soloCurrent.id) ? prev : [...prev, soloCurrent.id]));
        }
        await updateEconomy(uid, 1, 5);
      } catch {
        // ignore
      } finally {
        setSoloAwarding(false);
      }
    }
  }

  function nextSolo() {
    if (!soloCurrent) return;
    const nextSeen = soloSeenIds.includes(soloCurrent.id) ? soloSeenIds : [...soloSeenIds, soloCurrent.id];
    setSoloSeenIds(nextSeen);
    setSoloFeedback(null);
    pickNextSoloQuestion(nextSeen);
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0b1220' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', borderBottom: '1px solid #1f2a44',
        background: 'rgba(0,0,0,0.5)'
      }}>
        <button onClick={onBack} className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
        <div style={{ color: 'white', fontWeight: 800, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ color: '#60a5fa', fontWeight: 800, fontSize: 12 }}>
          {completionPct}%
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 12 }}>
          <input type="checkbox" checked={includeSections} onChange={(e) => setIncludeSections(e.target.checked)} />
          Sections
        </label>
      </div>

      {!programId ? (
        <div style={{ color: '#94a3b8', padding: 18 }}>
          No active program selected. Choose a book from Profile → 📚 My Curriculum.
        </div>
      ) : loading ? (
        <div style={{ color: '#94a3b8', padding: 18 }}>Loading map...</div>
      ) : (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: isNarrow ? 'column' : 'row',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <div
            ref={flowWrapRef}
            style={{
              flex: 1,
              height: isNarrow ? '100%' : '100%',
              minHeight: 0,
              minWidth: isNarrow ? 0 : 280,
              width: '100%',
              position: 'relative',
            }}
          >
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5, fontSize: 11, color: '#94a3b8', background: 'rgba(2,6,23,0.7)', border: '1px solid #1f2a44', padding: '6px 8px', borderRadius: 8 }}>
              size: {flowRect.w}×{flowRect.h} | nodes: {nodes.length} | edges: {edges.length}
            </div>

            {!flowReady ? (
              <div style={{ color: '#94a3b8', padding: 18 }}>Loading map...</div>
            ) : nodes.length === 0 ? (
              <div style={{ color: '#94a3b8', padding: 18 }}>No nodes to render for this program (TOC may be missing).</div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                fitView
                style={{ width: '100%', height: '100%' }}
                onNodeClick={(_, n) => {
                  const meta = nodeById.get(n.id);
                  if (meta) setSelected({ id: n.id, title: meta.title, ref: meta.ref });

                  const unitItemId = (n.data as any)?._meta?.unitItemId as string | undefined;
                  if (user && programId && unitItemId) {
                    toggleUnitComplete(user.uid, programId, unitItemId)
                      .then(() => getProgramProgress(user.uid, programId))
                      .then((pp) => {
                        setCompletedUnitIds(pp?.completedUnitIds ?? []);
                        if ((pp?.completedUnitIds?.length ?? 0) === 0) {
                          return setProgramCompletedForUser(user.uid, programId, false);
                        }
                        return undefined;
                      })
                      .catch(() => {
                        // ignore
                      });
                  }
                }}
              >
                <MiniMap pannable zoomable style={{ background: '#0f172a' }} />
                <Controls />
                <Background gap={18} color="rgba(148,163,184,0.15)" />
              </ReactFlow>
            )}
          </div>

          <div style={{
            width: isNarrow ? '100%' : 320,
            height: isNarrow ? 260 : 'auto',
            borderLeft: isNarrow ? 'none' : '1px solid #1f2a44',
            borderTop: isNarrow ? '1px solid #1f2a44' : 'none',
            background: 'rgba(2,6,23,0.7)',
            padding: 14,
            color: 'white',
            overflowY: 'auto',
            flexShrink: 0,
          }}>
            {rankedActive ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 13 }}>Ranked</div>
                  <button onClick={exitRanked} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>Exit</button>
                </div>

                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                  Trophies: <span style={{ color: '#fbbf24', fontWeight: 900 }}>{rankedTrophies}</span>
                  <span style={{ color: '#64748b' }}>
                    {' '}| Next checkpoint: {Math.ceil((rankedTrophies + 1) / 100) * 100}
                  </span>
                  {rankedSaving ? ' | Saving...' : ''}
                </div>

                {!rankedCurrent ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>
                    {rankedCandidates.length === 0 ? 'No MCQs found for this question type yet.' : 'All ranked questions solved!'}
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                      Ranked Question
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
                      {rankedCurrent.promptRawText ?? rankedCurrent.promptLatex ?? '—'}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {rankedCurrent.mcq?.choices.map((c, idx) => {
                        const disabled = !!rankedFeedback;
                        const isCorrect = rankedFeedback?.correctIndex === idx;
                        const isChosenWrong = rankedFeedback && !rankedFeedback.correct && idx !== rankedFeedback.correctIndex;
                        const bg = !rankedFeedback
                          ? 'rgba(15,23,42,0.6)'
                          : isCorrect
                            ? 'rgba(16,185,129,0.18)'
                            : 'rgba(239,68,68,0.12)';
                        const border = !rankedFeedback
                          ? '1px solid #1f2a44'
                          : isCorrect
                            ? '1px solid rgba(16,185,129,0.55)'
                            : '1px solid rgba(239,68,68,0.35)';
                        return (
                          <button
                            key={idx}
                            onClick={() => answerRanked(idx)}
                            disabled={disabled}
                            className="ll-btn"
                            style={{
                              padding: '10px 10px',
                              fontSize: 13,
                              textAlign: 'left',
                              background: bg,
                              border,
                              opacity: disabled && !isCorrect && isChosenWrong ? 0.75 : 1,
                            }}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>

                    {rankedFeedback && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{
                          color: rankedFeedback.correct ? '#34d399' : '#fca5a5',
                          fontWeight: 900,
                          marginBottom: 10,
                        }}>
                          {rankedFeedback.correct ? 'Correct! (+15)' : 'Wrong (−15) — try again'}
                        </div>
                        <button
                          onClick={continueRanked}
                          className="ll-btn ll-btn-primary"
                          style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                        >
                          {rankedFeedback.correct ? 'Next Ranked Question' : 'Try Again'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : soloActive ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontWeight: 900, fontSize: 13 }}>Solo Practice</div>
                  <button onClick={exitSolo} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>Exit</button>
                </div>

                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                  Seen: {soloSeenIds.length} / {soloCandidates.length}
                  {soloAwarding ? ' | Awarding...' : ''}
                </div>

                {!soloCurrent ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>
                    No MCQs found for this question type yet.
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 900, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                      Question
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
                      {soloCurrent.promptRawText ?? soloCurrent.promptLatex ?? '—'}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {soloCurrent.mcq?.choices.map((c, idx) => {
                        const disabled = !!soloFeedback;
                        const isCorrect = soloFeedback?.correctIndex === idx;
                        const isChosenWrong = soloFeedback && !soloFeedback.correct && idx !== soloFeedback.correctIndex;
                        const bg = !soloFeedback
                          ? 'rgba(15,23,42,0.6)'
                          : isCorrect
                            ? 'rgba(16,185,129,0.18)'
                            : 'rgba(239,68,68,0.12)';
                        const border = !soloFeedback
                          ? '1px solid #1f2a44'
                          : isCorrect
                            ? '1px solid rgba(16,185,129,0.55)'
                            : '1px solid rgba(239,68,68,0.35)';

                        return (
                          <button
                            key={idx}
                            onClick={() => answerSolo(idx)}
                            disabled={disabled}
                            className="ll-btn"
                            style={{
                              padding: '10px 10px',
                              fontSize: 13,
                              textAlign: 'left',
                              background: bg,
                              border,
                              opacity: disabled && !isCorrect && isChosenWrong ? 0.75 : 1,
                            }}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>

                    {soloFeedback && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{
                          color: soloFeedback.correct ? '#34d399' : '#fca5a5',
                          fontWeight: 900,
                          marginBottom: 10,
                        }}>
                          {soloFeedback.correct ? 'Correct!' : 'Not quite'}
                        </div>
                        <button onClick={nextSolo} className="ll-btn ll-btn-primary" style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}>
                          Next Question
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 10 }}>
                  Node
                </div>
                {!selected ? (
                  <div style={{ color: '#94a3b8', fontSize: 13 }}>
                    Click a unit/section to inspect.
                  </div>
                ) : (
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>{selected.title}</div>
                    {selected.ref && (
                      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 12 }}>Ref: {selected.ref}</div>
                    )}
                    <div style={{ color: '#64748b', fontSize: 12 }}>ID: {selected.id}</div>
                  </div>
                )}
              </div>
            )}

            <div style={{ height: 1, background: '#1f2a44', margin: '14px 0' }} />

            <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 10 }}>
              Question Bank (Prototype)
            </div>

            {qbLoading ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading questions...</div>
            ) : qbError ? (
              <div style={{ color: '#fca5a5', fontSize: 12 }}>{qbError}</div>
            ) : qbQuestions.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>
                No questions loaded.
              </div>
            ) : (
              <div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                  Chapter: {qbChapterId ?? '—'} | Questions: {qbQuestions.length}
                </div>

                <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                  Subsections
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {qbRegions.map((r) => (
                    <div key={r.regionId} style={{ border: '1px solid #1f2a44', borderRadius: 10, padding: '8px 10px', background: 'rgba(15,23,42,0.5)' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontWeight: 800, fontSize: 13 }}>
                          {(r.label ? `${r.label} ` : '')}{r.title}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexShrink: 0 }}>
                          <div style={{ color: '#34d399', fontWeight: 900, fontSize: 12 }}>
                            {(qbSolvedCounts.byRegion[r.regionId] ?? 0)}/{qbCounts.byRegion[r.regionId] ?? 0}
                          </div>
                          <div style={{ color: '#60a5fa', fontWeight: 800, fontSize: 12 }}>
                            {qbCounts.byRegion[r.regionId] ?? 0}
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {Object.entries(qbCounts.byRegionAndType[r.regionId] ?? {})
                          .sort((a, b) => (qbQuestionTypes.find((t) => t.id === a[0])?.treeOrder ?? 999) - (qbQuestionTypes.find((t) => t.id === b[0])?.treeOrder ?? 999))
                          .map(([tid, count]) => {
                            const tdef = qbQuestionTypes.find((t) => t.id === tid);
                            const title = tdef?.title ?? tid;
                            const canPlay = qbQuestions.some((q) => q.regionId === r.regionId && q.questionTypeId === tid && !!q.mcq);
                            const solved = qbSolvedCounts.byRegionAndType[r.regionId]?.[tid] ?? 0;
                            const rankedSolved = qbRankedSolvedCounts.byRegionAndType[r.regionId]?.[tid] ?? 0;
                            return (
                              <div key={tid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: '#cbd5e1', fontSize: 12 }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{title}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.05 }}>
                                    <div style={{ color: '#34d399', fontWeight: 900 }}>{solved}/{count}</div>
                                    <div style={{ color: '#fbbf24', fontWeight: 900, fontSize: 11 }}>R {rankedSolved}/{count}</div>
                                  </div>
                                  <button
                                    className={canPlay ? 'll-btn ll-btn-primary' : 'll-btn'}
                                    disabled={!canPlay}
                                    onClick={() => startSolo(r.regionId, tid)}
                                    style={{
                                      padding: '6px 10px',
                                      fontSize: 11,
                                      opacity: canPlay ? 1 : 0.55,
                                      background: canPlay ? '#10b981' : undefined,
                                      borderColor: canPlay ? '#059669' : undefined,
                                      color: canPlay ? 'white' : undefined,
                                    }}
                                  >
                                    Play
                                  </button>
                                  <button
                                    className={canPlay ? 'll-btn ll-btn-primary' : 'll-btn'}
                                    disabled={!canPlay}
                                    onClick={() => startRanked(r.regionId, tid)}
                                    style={{
                                      padding: '6px 10px',
                                      fontSize: 11,
                                      opacity: canPlay ? 1 : 0.55,
                                      background: canPlay ? 'rgba(251,191,36,0.95)' : undefined,
                                      borderColor: canPlay ? 'rgba(217,119,6,1)' : undefined,
                                      color: canPlay ? '#0b1220' : undefined,
                                    }}
                                  >
                                    Ranked
                                  </button>
                                </div>
                              </div>
                            );
                          })}

                        {Object.keys(qbCounts.byRegionAndType[r.regionId] ?? {}).length === 0 && (
                          <div style={{ color: '#94a3b8', fontSize: 12 }}>
                            No question types labeled yet.
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {Object.keys(qbAnnotations?.chapters?.[qbChapterId ?? '']?.annotations ?? {}).length === 0 && (
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>
                    No annotations yet. Add entries to <code style={{ color: '#93c5fd' }}>/questionBanks/program.annotations.sample.v3.json</code>.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
