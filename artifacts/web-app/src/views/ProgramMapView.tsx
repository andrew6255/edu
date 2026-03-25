import { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';

import { useAuth } from '@/contexts/AuthContext';
import { getPublicProgram, setProgramCompletedForUser, type TocItem } from '@/lib/programMaps';
import { getProgramProgress, toggleUnitComplete } from '@/lib/programProgress';

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
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState<string>('Program Map');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<Selected>(null);
  const [includeSections, setIncludeSections] = useState(true);
  const [completedUnitIds, setCompletedUnitIds] = useState<string[]>([]);
  const [completionPct, setCompletionPct] = useState<number>(0);
  const flowWrapRef = useRef<HTMLDivElement | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [flowRect, setFlowRect] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [isNarrow, setIsNarrow] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth < 760 : false));

  const activeProgramId = userData?.activeProgramId ?? null;

  const programId = programIdProp ?? activeProgramId;

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
        setCompletionPct(0);
        setLoading(false);
        return;
      }

      setLoading(true);
      const [prog, pp] = await Promise.all([
        getPublicProgram(programId),
        user ? getProgramProgress(user.uid, programId) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const completedIds = user ? (pp?.completedUnitIds ?? []) : [];
      setCompletedUnitIds(completedIds);

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
      if (user && unitItemIds.length > 0 && completedCount === unitItemIds.length) {
        try {
          await setProgramCompletedForUser(user.uid, programId, true);
        } catch {
          // ignore
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [programId, includeSections, user]);

  const nodeById = useMemo(() => {
    const m = new Map<string, { title: string; ref?: string | null }>();
    for (const n of nodes) {
      const meta = (n.data as any)?._meta as { title?: string; ref?: string | null } | undefined;
      if (meta?.title) m.set(n.id, { title: meta.title, ref: meta.ref });
    }
    return m;
  }, [nodes]);

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
        </div>
      )}
    </div>
  );
}
