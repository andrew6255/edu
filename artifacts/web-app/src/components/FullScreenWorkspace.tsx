import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import AiTutorPanel from '@/components/AiTutorPanel';

/* ═══════════════════════════════════════════════════════════════
   DATA MODEL — Completely isolated from MyScript state
   ═══════════════════════════════════════════════════════════════ */

interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

interface Stroke {
  id: string;
  points: StrokePoint[];
  color: string;
  width: number;
}

interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  width: number;
  height: number;
}

interface PageData {
  id: string;
  strokes: Stroke[];
  annotations: TextAnnotation[];
}

type EraserMode = 'pixel' | 'stroke';

interface UndoAction {
  type: 'add-stroke' | 'remove-stroke' | 'add-annotation' | 'remove-annotation' | 'clear';
  pageId: string;
  data: any;
}

interface ConvertedBlock {
  id: string;
  text: string;
  latex: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const PAGE_W = 794;
const PAGE_H = 1123;
const PAGE_GAP = 48;
const ERASER_RADIUS = 14;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 25;

const WS_COLORS = [
  { value: '#1e293b', label: 'Ink' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#dc2626', label: 'Red' },
  { value: '#059669', label: 'Green' },
  { value: '#d97706', label: 'Amber' },
  { value: '#7c3aed', label: 'Purple' },
];

let _idCounter = 0;
const uid = () => `ws-${Date.now()}-${++_idCounter}`;

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function distSq(ax: number, ay: number, bx: number, by: number) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function parseJIIXAbsolute(jiix: any, directLatex: string): ConvertedBlock[] {
  if (!jiix) return [];
  const blocks: ConvertedBlock[] = [];
  const mmToPx = 96 / 25.4; // Convert MyScript mm to standard 96 DPI pixels

  // Helper to convert px to % relative to A4 page dimensions
  const toPctX = (px: number) => (px / PAGE_W) * 100;
  const toPctY = (px: number) => (px / PAGE_H) * 100;

  // For MATH mode, we often just want the top-level bounding box
  if (jiix['bounding-box']) {
    const bb = jiix['bounding-box'];
    const latex = directLatex || jiix.latex || '';
    const textLabel = jiix.label || '';
    
    // Sometimes math blocks are nested in expressions
    let finalLatex = latex;
    if (!finalLatex && jiix.expressions) {
      finalLatex = jiix.expressions.map((e: any) => e.label || '').join(' ');
    }

    if (finalLatex || textLabel) {
      const h = bb.height * mmToPx;
      blocks.push({
        id: 'root-math',
        text: textLabel,
        latex: finalLatex,
        x: toPctX(bb.x * mmToPx),
        y: toPctY(bb.y * mmToPx),
        width: toPctX(bb.width * mmToPx),
        height: toPctY(h),
        fontSize: Math.max(16, Math.min(48, Math.round(h * 0.8))), // heuristic font size in px
      });
      return blocks;
    }
  }

  // Fallback for TEXT mode or deep nesting
  const elements: any[] = jiix.elements || jiix.words || jiix.expressions || [];
  function extract(items: any[], depth = 0) {
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const label = el.label ?? el.value ?? el.text ?? '';
      const latex = el.latex ?? '';
      const bb = el['bounding-box'] || el.boundingBox || el;
      const isTarget = bb && typeof bb.width === 'number' && (el.type === 'TextLine' || latex || (!el.elements && !el.children && !el.words && !el.expressions && label));

      if (isTarget && (label || latex)) {
        const h = bb.height * mmToPx;
        blocks.push({
          id: `block-${depth}-${i}`,
          text: String(label),
          latex: String(latex),
          x: toPctX((bb.x ?? bb.left ?? 0) * mmToPx),
          y: toPctY((bb.y ?? bb.top ?? 0) * mmToPx),
          width: toPctX(bb.width * mmToPx),
          height: toPctY(h),
          fontSize: Math.max(12, Math.min(36, Math.round(h * 0.7))),
        });
        continue;
      }
      if (el.elements) extract(el.elements, depth + 1);
      else if (el.expressions) extract(el.expressions, depth + 1);
      else if (el.children) extract(el.children, depth + 1);
      else if (el.words) extract(el.words, depth + 1);
    }
  }
  extract(elements);
  return blocks;
}

function clusterStrokesByY(strokes: Stroke[]): Stroke[][] {
  if (strokes.length === 0) return [];
  const strokeBounds = strokes.map(s => {
    const minY = Math.min(...s.points.map(p => p.y));
    const maxY = Math.max(...s.points.map(p => p.y));
    return { stroke: s, minY, maxY };
  });
  
  // Sort strokes by their top-most point
  strokeBounds.sort((a, b) => a.minY - b.minY);

  const groups: { strokes: Stroke[], minY: number, maxY: number }[] = [];
  let currentGroup = { strokes: [strokeBounds[0].stroke], minY: strokeBounds[0].minY, maxY: strokeBounds[0].maxY };
  groups.push(currentGroup);
  
  // 35px of pure vertical whitespace triggers a new equation/line break
  const GAP_THRESHOLD = 35; 

  for (let i = 1; i < strokeBounds.length; i++) {
    const b = strokeBounds[i];
    if (b.minY <= currentGroup.maxY + GAP_THRESHOLD) {
      currentGroup.strokes.push(b.stroke);
      currentGroup.maxY = Math.max(currentGroup.maxY, b.maxY);
    } else {
      currentGroup = { strokes: [b.stroke], minY: b.minY, maxY: b.maxY };
      groups.push(currentGroup);
    }
  }
  return groups.map(g => g.strokes);
}

function pointNearStroke(px: number, py: number, stroke: Stroke, radius: number): boolean {
  const r2 = radius * radius;
  for (const pt of stroke.points) {
    if (distSq(px, py, pt.x, pt.y) <= r2) return true;
  }
  return false;
}

function renderStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  if (s.points.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.points[0].x, s.points[0].y);
  for (let i = 1; i < s.points.length; i++) {
    const prev = s.points[i - 1];
    const cur = s.points[i];
    const mx = (prev.x + cur.x) / 2;
    const my = (prev.y + cur.y) / 2;
    ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
  }
  const last = s.points[s.points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function renderAllStrokes(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) renderStroke(ctx, s);
}

/* ═══════════════════════════════════════════════════════════════
   SINGLE PAGE CANVAS — Memoized for performance
   ═══════════════════════════════════════════════════════════════ */

interface PageCanvasProps {
  page: PageData;
  pageIndex: number;
  currentQuestion?: import('@/lib/personalProgramService').PersonalProgramQuestion | string;
  activeTool: 'pen' | 'eraser';
  eraserMode: EraserMode;
  strokeColor: string;
  strokeWidth: number;
  onStrokeAdd: (pageId: string, stroke: Stroke) => void;
  onStrokeRemove: (pageId: string, strokeId: string) => void;
  onAnnotationAdd: (pageId: string, ann: TextAnnotation) => void;
  onAnnotationUpdate: (pageId: string, annId: string, text: string) => void;
  scale: number;
  onToggleAI?: () => void;
}

const LatexRenderer = ({ content }: { content: string }) => {
  const parts = content.split(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('$$') && part.endsWith('$$')) {
          const math = part.slice(2, -2);
          try { return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: true }) }} />; }
          catch { return <span key={i}>{part}</span>; }
        }
        if (part.startsWith('$') && part.endsWith('$')) {
          const math = part.slice(1, -1);
          try { return <span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(math, { displayMode: false }) }} />; }
          catch { return <span key={i}>{part}</span>; }
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};

const PageCanvas = memo(function PageCanvas({
  page, pageIndex, currentQuestion, activeTool, eraserMode, strokeColor, strokeWidth,
  onStrokeAdd, onStrokeRemove, onAnnotationAdd, onAnnotationUpdate, scale, onToggleAI,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Calculate lowest point of content to position the AI box dynamically
  const maxY = useMemo(() => {
    let max = 60; // minimum offset below question
    page.strokes.forEach(s => {
      s.points.forEach(p => {
        if (p.y > max) max = p.y;
      });
    });
    page.annotations.forEach(a => {
      if (a.y + a.height > max) max = a.y + a.height;
    });
    return max;
  }, [page.strokes, page.annotations]);
  const activeStroke = useRef<StrokePoint[]>([]);
  const isDrawing = useRef(false);
  const lastTap = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });
  const [editingAnn, setEditingAnn] = useState<string | null>(null);

  // Re-render strokes whenever they change
  useEffect(() => {
    if (canvasRef.current) renderAllStrokes(canvasRef.current, page.strokes);
  }, [page.strokes]);

  const getPos = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  }, [scale]);

  const handleDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = getPos(e);
    const now = Date.now();

    // ── Double-tap detection ──
    if (activeTool === 'pen') {
      const dt = now - lastTap.current.time;
      const dd = Math.sqrt(distSq(pos.x, pos.y, lastTap.current.x, lastTap.current.y));
      if (dt < DOUBLE_TAP_MS && dd < DOUBLE_TAP_PX) {
        lastTap.current = { time: 0, x: 0, y: 0 };
        const ann: TextAnnotation = {
          id: uid(), x: pos.x, y: pos.y, text: '', width: 200, height: 32,
        };
        onAnnotationAdd(page.id, ann);
        setEditingAnn(ann.id);
        return;
      }
      lastTap.current = { time: now, x: pos.x, y: pos.y };
    }

    isDrawing.current = true;

    if (activeTool === 'pen') {
      activeStroke.current = [{ x: pos.x, y: pos.y, pressure: e.pressure || 0.5 }];
    } else if (activeTool === 'eraser' && eraserMode === 'stroke') {
      // Stroke eraser: hit-test immediately
      for (const s of page.strokes) {
        if (pointNearStroke(pos.x, pos.y, s, ERASER_RADIUS)) {
          onStrokeRemove(page.id, s.id);
        }
      }
    } else if (activeTool === 'eraser' && eraserMode === 'pixel') {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ERASER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }, [activeTool, eraserMode, page, getPos, onStrokeRemove, onAnnotationAdd]);

  const handleMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const pos = getPos(e);

    if (activeTool === 'pen') {
      activeStroke.current.push({ x: pos.x, y: pos.y, pressure: e.pressure || 0.5 });
      // Live preview: draw the latest segment
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && activeStroke.current.length >= 2) {
        const pts = activeStroke.current;
        const prev = pts[pts.length - 2];
        const cur = pts[pts.length - 1];
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      }
    } else if (activeTool === 'eraser' && eraserMode === 'stroke') {
      for (const s of page.strokes) {
        if (pointNearStroke(pos.x, pos.y, s, ERASER_RADIUS)) {
          onStrokeRemove(page.id, s.id);
        }
      }
    } else if (activeTool === 'eraser' && eraserMode === 'pixel') {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ERASER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }, [activeTool, eraserMode, strokeColor, strokeWidth, page, getPos, onStrokeRemove]);

  const handleUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!isDrawing.current) return;
    isDrawing.current = false;

    if (activeTool === 'pen' && activeStroke.current.length >= 2) {
      const stroke: Stroke = {
        id: uid(),
        points: [...activeStroke.current],
        color: strokeColor,
        width: strokeWidth,
      };
      onStrokeAdd(page.id, stroke);
    }
    activeStroke.current = [];
  }, [activeTool, strokeColor, strokeWidth, page.id, onStrokeAdd]);

  return (
    <div
      className="fsw-page"
      data-page-index={pageIndex}
      style={{
        width: PAGE_W,
        height: PAGE_H,
        transform: `scale(${scale})`,
        transformOrigin: 'top center',
        marginBottom: PAGE_GAP * scale,
      }}
    >
      {/* Lined background */}
      <div className="fsw-page-lines" />

      {/* Static Question Overlay */}
      {pageIndex === 0 && currentQuestion && (() => {
        const isMulti = typeof currentQuestion !== 'string' && currentQuestion.subQuestions && currentQuestion.subQuestions.length > 0;
        const mainText = typeof currentQuestion === 'string' ? currentQuestion : currentQuestion.context || currentQuestion.rawText;
        const subQuestions = isMulti ? (currentQuestion as any).subQuestions : [];

        // Simple heuristic for dynamic Y positions: 
        // each subquestion looks at the max stroke Y that is conceptually above it.
        // We do this by assigning baseline default Ys and expanding them if strokes dip below.
        const yPositions: number[] = [];
        let currentY = 0; // relative to the container below the main text
        
        for (let i = 0; i < subQuestions.length; i++) {
          if (i === 0) {
            yPositions.push(0);
          } else {
            // Find strokes that belong to the PREVIOUS subquestion
            // A stroke belongs to subQuestions[i-1] if its minY is >= yPositions[i-1] (roughly)
            // We just look at all strokes below yPositions[i-1] and find their maxY
            const prevY = yPositions[i-1];
            let maxYOfPrev = prevY + 120; // default minimum gap is 120px
            page.strokes.forEach(s => {
              let strokeMinY = Infinity;
              let strokeMaxY = -Infinity;
              s.points.forEach(p => {
                // Adjust stroke Y by -80 to account for the top margin of the context
                const adjustedY = p.y - 80; 
                if (adjustedY < strokeMinY) strokeMinY = adjustedY;
                if (adjustedY > strokeMaxY) strokeMaxY = adjustedY;
              });
              
              // If the stroke started *after* the previous question but *before* a huge gap
              if (strokeMinY >= prevY - 40) {
                if (strokeMaxY > maxYOfPrev) maxYOfPrev = strokeMaxY;
              }
            });
            
            // Add a 60px padding below the lowest stroke for the next question
            yPositions.push(maxYOfPrev + 60);
          }
        }

        return (
          <div className="fsw-static-question" style={{ position: 'relative', zIndex: 10, pointerEvents: 'none' }}>
            {/* Main Context / Given */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, background: isMulti ? 'rgba(255,255,255,0.7)' : 'transparent', padding: isMulti ? '12px' : 0, borderRadius: 8 }}>
              <div style={{ flex: 1, paddingRight: 16 }}>
                <strong style={{ color: '#4f46e5' }}>{isMulti ? 'Given:' : 'Question:'}</strong> <LatexRenderer content={mainText} />
              </div>
              {onToggleAI && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--ll-surface-1)', padding: '6px 10px', borderRadius: 20, cursor: 'pointer', border: '1px solid var(--ll-border)', pointerEvents: 'auto' }} onClick={onToggleAI} onPointerDown={e => e.stopPropagation()}>
                  <span style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--ll-text-muted)' }}>AI Tutor</span>
                  <div style={{ width: 32, height: 18, borderRadius: 10, background: 'var(--ll-surface-3)', position: 'relative', transition: '0.2s' }}>
                    <div style={{ position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: '50%', background: 'white', transition: '0.2s' }} />
                  </div>
                </div>
              )}
            </div>
            
            {/* Subquestions with dynamic spacing */}
            {isMulti && (
              <div style={{ position: 'relative', width: '100%', minHeight: yPositions[yPositions.length - 1] + 100 }}>
                {subQuestions.map((sq: any, idx: number) => (
                  <div key={idx} style={{ 
                    position: 'absolute', 
                    top: yPositions[idx], 
                    left: 0, 
                    right: 0, 
                    color: '#1e293b', 
                    fontWeight: 600,
                    transition: 'top 0.3s ease-out'
                  }}>
                    <span style={{ color: '#4f46e5', marginRight: 8 }}>{sq.label}</span>
                    <LatexRenderer content={sq.rawText} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}



      {/* Page number */}
      <div className="fsw-page-number">{pageIndex + 1}</div>

      {/* Drawing canvas */}
      <canvas
        ref={canvasRef}
        width={PAGE_W}
        height={PAGE_H}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        style={{
          position: 'absolute',
          inset: 0,
          touchAction: 'none',
          cursor: activeTool === 'eraser' ? 'cell' : 'crosshair',
          zIndex: 2,
        }}
      />

      {/* Text annotations layer */}
      {page.annotations.map(ann => (
        <div
          key={ann.id}
          className="fsw-annotation"
          style={{
            left: ann.x,
            top: ann.y,
            zIndex: 3,
          }}
        >
          {editingAnn === ann.id ? (
            <textarea
              autoFocus
              defaultValue={ann.text}
              className="fsw-annotation-input"
              onBlur={(e) => {
                const val = e.currentTarget.value.trim();
                onAnnotationUpdate(page.id, ann.id, val);
                setEditingAnn(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
          ) : (
            <div
              className="fsw-annotation-display"
              onDoubleClick={() => setEditingAnn(ann.id)}
            >
              {ann.text || <span style={{ opacity: 0.4, fontStyle: 'italic' }}>Type here…</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════
   FULL SCREEN WORKSPACE — Main Overlay Component
   ═══════════════════════════════════════════════════════════════ */

interface FullScreenWorkspaceProps {
  onClose: () => void;
  currentQuestion?: import('@/lib/personalProgramService').PersonalProgramQuestion | string;
  initialPages?: PageData[];
  onPagesChange?: (pages: PageData[]) => void;
}

export default function FullScreenWorkspace({ onClose, currentQuestion, initialPages, onPagesChange }: FullScreenWorkspaceProps) {
  // ── AI Panel State ──
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  // ── Pages State ──
  const [pages, setPages] = useState<PageData[]>(
    initialPages && initialPages.length > 0 ? (initialPages as PageData[]) : [{ id: uid(), strokes: [], annotations: [] }]
  );

  // Reset pages whenever a new question (new initialPages) is loaded
  useEffect(() => {
    setPages(
      initialPages && initialPages.length > 0
        ? (initialPages as PageData[])
        : [{ id: uid(), strokes: [], annotations: [] }]
    );
    setUndoStack([]);
    setRedoStack([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPages]);

  // ── Auto-save: fire onPagesChange on every pages mutation ──
  useEffect(() => {
    if (onPagesChange) {
      onPagesChange(pages);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  // ── Output snapshots (captured when modal opens) ──
  const [pageSnapshots, setPageSnapshots] = useState<{ 
    pageIndex: number; 
    hasAnnotations: boolean; 
    annotations: { text: string; x: number; y: number }[];
    isRecognizing?: boolean;
    blocks?: ConvertedBlock[];
  }[]>([]);

  // ── Tool State ──
  const [activeTool, setActiveTool] = useState<'pen' | 'eraser'>('pen');
  const [eraserMode, setEraserMode] = useState<EraserMode>('pixel');
  const [strokeColor, setStrokeColor] = useState('#1e293b');
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [showOutputModal, setShowOutputModal] = useState(false);

  // ── Undo/Redo ──
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);

  // ── Scroll & Scale ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // ── Responsive scale ──
  useEffect(() => {
    const updateScale = () => {
      const vw = window.innerWidth;
      // Make paper take full width of screen
      const target = vw / PAGE_W;
      setScale(target);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // ── Infinite scroll: append page when sentinel is visible ──
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPages(prev => [...prev, { id: uid(), strokes: [], annotations: [] }]);
        }
      },
      { root: scrollRef.current, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pages.length]); // re-observe when pages change so sentinel moves

  // ── Scroll-up cleanup: aggressively prune empty trailing pages ──
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let debounce: ReturnType<typeof setTimeout>;

    const onScroll = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        setPages(prev => {
          if (prev.length <= 1) return prev;
          // Find the last page that has any content
          let lastInked = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].strokes.length > 0 || prev[i].annotations.length > 0) {
              lastInked = i;
              break;
            }
          }
          // Keep up to lastInked + 1 blank page (the page user is currently on)
          // But always keep at least 1 page
          const keepCount = Math.max(lastInked + 2, 1);
          if (keepCount < prev.length) {
            return prev.slice(0, keepCount);
          }
          return prev;
        });
      }, 300);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      clearTimeout(debounce);
    };
  }, []);

  // ── Stroke operations ──
  const handleStrokeAdd = useCallback((pageId: string, stroke: Stroke) => {
    setPages(prev => prev.map(p =>
      p.id === pageId ? { ...p, strokes: [...p.strokes, stroke] } : p
    ));
    setUndoStack(prev => [...prev, { type: 'add-stroke', pageId, data: stroke }]);
    setRedoStack([]);
  }, []);

  const handleStrokeRemove = useCallback((pageId: string, strokeId: string) => {
    let removed: Stroke | undefined;
    setPages(prev => prev.map(p => {
      if (p.id !== pageId) return p;
      removed = p.strokes.find(s => s.id === strokeId);
      return { ...p, strokes: p.strokes.filter(s => s.id !== strokeId) };
    }));
    if (removed) {
      setUndoStack(prev => [...prev, { type: 'remove-stroke', pageId, data: removed }]);
      setRedoStack([]);
    }
  }, []);

  const handleAnnotationAdd = useCallback((pageId: string, ann: TextAnnotation) => {
    setPages(prev => prev.map(p =>
      p.id === pageId ? { ...p, annotations: [...p.annotations, ann] } : p
    ));
    setUndoStack(prev => [...prev, { type: 'add-annotation', pageId, data: ann }]);
    setRedoStack([]);
  }, []);

  const handleAnnotationUpdate = useCallback((pageId: string, annId: string, text: string) => {
    setPages(prev => prev.map(p => {
      if (p.id !== pageId) return p;
      return {
        ...p,
        annotations: text
          ? p.annotations.map(a => a.id === annId ? { ...a, text } : a)
          : p.annotations.filter(a => a.id !== annId), // remove empty
      };
    }));
  }, []);

  // ── Undo ──
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));

    if (action.type === 'add-stroke') {
      // Undo an add → remove that stroke
      setPages(prev => prev.map(p =>
        p.id === action.pageId
          ? { ...p, strokes: p.strokes.filter(s => s.id !== action.data.id) }
          : p
      ));
    } else if (action.type === 'remove-stroke') {
      // Undo a remove → re-add that stroke
      setPages(prev => prev.map(p =>
        p.id === action.pageId
          ? { ...p, strokes: [...p.strokes, action.data] }
          : p
      ));
    } else if (action.type === 'add-annotation') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId
          ? { ...p, annotations: p.annotations.filter(a => a.id !== action.data.id) }
          : p
      ));
    } else if (action.type === 'clear') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId ? { ...p, strokes: action.data.strokes, annotations: action.data.annotations } : p
      ));
    }

    setRedoStack(prev => [...prev, action]);
  }, [undoStack]);

  // ── Redo ──
  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));

    if (action.type === 'add-stroke') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId
          ? { ...p, strokes: [...p.strokes, action.data] }
          : p
      ));
    } else if (action.type === 'remove-stroke') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId
          ? { ...p, strokes: p.strokes.filter(s => s.id !== action.data.id) }
          : p
      ));
    } else if (action.type === 'add-annotation') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId
          ? { ...p, annotations: [...p.annotations, action.data] }
          : p
      ));
    } else if (action.type === 'clear') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId ? { ...p, strokes: [], annotations: [] } : p
      ));
    }

    setUndoStack(prev => [...prev, action]);
  }, [redoStack]);

  // ── Clear current visible page ──
  const handleClearPage = useCallback(() => {
    // Find the page most visible in viewport
    const container = scrollRef.current;
    if (!container) return;
    const pageEls = container.querySelectorAll('.fsw-page');
    let bestIdx = 0;
    let bestOverlap = 0;
    const cRect = container.getBoundingClientRect();
    pageEls.forEach((el, idx) => {
      const r = el.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(r.bottom, cRect.bottom) - Math.max(r.top, cRect.top));
      if (overlap > bestOverlap) { bestOverlap = overlap; bestIdx = idx; }
    });

    const targetPage = pages[bestIdx];
    if (!targetPage) return;
    if (targetPage.strokes.length === 0 && targetPage.annotations.length === 0) return;

    setUndoStack(prev => [...prev, {
      type: 'clear', pageId: targetPage.id,
      data: { strokes: [...targetPage.strokes], annotations: [...targetPage.annotations] },
    }]);
    setRedoStack([]);
    setPages(prev => prev.map(p =>
      p.id === targetPage.id ? { ...p, strokes: [], annotations: [] } : p
    ));
  }, [pages]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) { e.preventDefault(); handleRedo(); }
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo, onClose]);

  // ── Reusable MyScript Fetch Helper ──
  const fetchMyScriptBlocks = useCallback(async (strokes: Stroke[]): Promise<ConvertedBlock[]> => {
    if (strokes.length === 0) return [];
    const applicationKey = 'a75f9183-fdc7-4c90-958b-a13c9d587db2';
    const hmacKey = 'e07209ce-819b-4a2f-9ace-7f3b5172fade';
    
    const clusters = clusterStrokesByY(strokes);
    let allParsedBlocks: ConvertedBlock[] = [];

    await Promise.all(clusters.map(async (clusterStrokes) => {
      // Format strokes for MyScript batch
      const msStrokes = clusterStrokes.map(s => {
        let t = 0;
        return {
          x: s.points.map(p => p.x),
          y: s.points.map(p => p.y),
          t: s.points.map(() => { const curr = t; t += 10; return curr; }) // fake timestamps
        };
      });

      const payload = {
        width: PAGE_W, height: PAGE_H, contentType: "Math",
        configuration: { math: { mimeTypes: ["application/x-latex", "application/vnd.myscript.jiix"] } },
        strokeGroups: [{ penStyle: "color: #000000;", strokes: msStrokes }]
      };

      const bodyStr = JSON.stringify(payload);
      const encoder = new TextEncoder();
      const cryptoKey = await window.crypto.subtle.importKey(
        'raw', encoder.encode(applicationKey + hmacKey),
        { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
      );
      const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(bodyStr));
      const hmacHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

      const res = await fetch("https://cloud.myscript.com/api/v4.0/iink/batch", {
        method: 'POST',
        headers: {
          "Accept": "application/json,application/vnd.myscript.jiix",
          "Content-Type": "application/json",
          "applicationKey": applicationKey,
          "hmac": hmacHex
        },
        body: bodyStr
      });
      const jiix = await res.json();

      // Fetch direct LaTeX formatting
      const resLatex = await fetch("https://cloud.myscript.com/api/v4.0/iink/batch", {
        method: 'POST',
        headers: {
          "Accept": "application/x-latex",
          "Content-Type": "application/json",
          "applicationKey": applicationKey,
          "hmac": hmacHex
        },
        body: bodyStr
      });
      const directLatex = await resLatex.text();

      const parsedBlocks = parseJIIXAbsolute(jiix, directLatex);
      allParsedBlocks = [...allParsedBlocks, ...parsedBlocks];
    }));
    
    return allParsedBlocks;
  }, []);

  // ── Capture live canvas snapshots when output modal opens ──
  const captureSnapshots = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const canvases = container.querySelectorAll('.fsw-page canvas');
    const snaps: typeof pageSnapshots = [];
    canvases.forEach((canvas, idx) => {
      const c = canvas as HTMLCanvasElement;
      const page = pages[idx];
      if (!page) return;
      const hasContent = page.strokes.length > 0 || page.annotations.length > 0;
      if (!hasContent) return; // skip blank pages
      snaps.push({
        pageIndex: idx,
        hasAnnotations: page.annotations.some(a => a.text),
        annotations: page.annotations.filter(a => a.text).map(a => ({ text: a.text, x: a.x, y: a.y })),
        isRecognizing: page.strokes.length > 0, // only run MyScript if there is ink
        blocks: [],
      });
    });
    setPageSnapshots(snaps);

    // Run MyScript Batch Recognition for pages with ink
    snaps.forEach(async (snap) => {
      if (!snap.isRecognizing) return;
      const page = pages[snap.pageIndex];
      try {
        const blocks = await fetchMyScriptBlocks(page.strokes);
        setPageSnapshots(prev => prev.map(s => 
          s.pageIndex === snap.pageIndex 
            ? { ...s, isRecognizing: false, blocks }
            : s
        ));
      } catch (err) {
        console.error('MyScript Batch API failed:', err);
        setPageSnapshots(prev => prev.map(s => 
          s.pageIndex === snap.pageIndex ? { ...s, isRecognizing: false } : s
        ));
      }
    });

  }, [pages, fetchMyScriptBlocks]);

  // Grade submission is now handled by AiTutorPanel

  const handleOpenOutput = useCallback(() => {
    captureSnapshots();
    setShowOutputModal(true);
  }, [captureSnapshots]);

  const totalStrokes = pages.reduce((s, p) => s + p.strokes.length, 0);
  const totalAnnotations = pages.reduce((s, p) => s + p.annotations.filter(a => a.text).length, 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* ═══ SCROLLABLE PAGE CONTAINER ═══ */}
      <div className="fsw-scroll" ref={scrollRef} style={{ paddingBottom: aiPanelOpen ? 370 : 0 }}>
        <div className="fsw-pages-stack">
          {pages.map((page, idx) => (
            <PageCanvas
              key={page.id}
              page={page}
              pageIndex={idx}
              currentQuestion={currentQuestion || undefined}
              activeTool={activeTool}
              eraserMode={eraserMode}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              onStrokeAdd={handleStrokeAdd}
              onStrokeRemove={handleStrokeRemove}
              onAnnotationAdd={handleAnnotationAdd}
              onAnnotationUpdate={handleAnnotationUpdate}
              scale={scale}
              onToggleAI={() => setAiPanelOpen(true)}
            />
          ))}
          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} style={{ width: 1, height: 1 }} />
        </div>
      </div>

      {/* ═══ FLOATING TOOLBOX ═══ */}
      <div className={`fsw-toolbox ${toolboxOpen ? 'open' : ''}`}>
        {/* Fly-out dock */}
        <div className="fsw-dock">
          {/* Pen */}
          <button
            className={`fsw-dock-btn ${activeTool === 'pen' ? 'active' : ''}`}
            onClick={() => { setActiveTool('pen'); }}
            title="Pen"
          >
            ✏️
          </button>

          {/* Eraser group */}
          <div className="fsw-dock-eraser-group">
            <button
              className={`fsw-dock-btn ${activeTool === 'eraser' ? 'active' : ''}`}
              onClick={() => setActiveTool('eraser')}
              title="Eraser"
            >
              🧹
            </button>
            {activeTool === 'eraser' && (
              <div className="fsw-eraser-toggle">
                <button
                  className={`fsw-eraser-mode-btn ${eraserMode === 'pixel' ? 'active' : ''}`}
                  onClick={() => setEraserMode('pixel')}
                >
                  Pixel
                </button>
                <button
                  className={`fsw-eraser-mode-btn ${eraserMode === 'stroke' ? 'active' : ''}`}
                  onClick={() => setEraserMode('stroke')}
                >
                  Stroke
                </button>
              </div>
            )}
          </div>

          <div className="fsw-dock-divider" />

          {/* Color palette */}
          <div className="fsw-dock-colors">
            {WS_COLORS.map(c => (
              <button
                key={c.value}
                className={`fsw-color-dot ${strokeColor === c.value ? 'active' : ''}`}
                style={{ background: c.value }}
                onClick={() => { setStrokeColor(c.value); setActiveTool('pen'); }}
                title={c.label}
              />
            ))}
          </div>

          {/* Width slider */}
          <div className="fsw-dock-width">
            <div
              className="fsw-width-preview"
              style={{
                width: strokeWidth * 3,
                height: strokeWidth * 3,
                background: strokeColor,
              }}
            />
            <input
              type="range"
              min="1" max="12" step="0.5"
              value={strokeWidth}
              onChange={e => setStrokeWidth(parseFloat(e.target.value))}
              className="fsw-width-slider"
            />
          </div>

          <div className="fsw-dock-divider" />

          {/* Actions */}
          <button className="fsw-dock-btn" onClick={handleUndo} title="Undo" disabled={undoStack.length === 0}>↶</button>
          <button className="fsw-dock-btn" onClick={handleRedo} title="Redo" disabled={redoStack.length === 0}>↷</button>
          <button className="fsw-dock-btn fsw-dock-btn-clear" onClick={handleClearPage} title="Clear Page">🗑️</button>
        </div>

        {/* FAB toggle */}
        <button
          className="fsw-fab"
          onClick={() => setToolboxOpen(o => !o)}
          title="Toolbox"
        >
          {toolboxOpen ? '✕' : '🧰'}
        </button>
      </div>

      {/* ═══ OUTPUT MODAL — Live canvas snapshots ═══ */}
      {showOutputModal && (
        <div className="fsw-modal-overlay" onClick={() => setShowOutputModal(false)}>
          <div className="fsw-modal" onClick={e => e.stopPropagation()}>
            <div className="fsw-modal-header">
              <h2>📄 Transformed Output</h2>
              <button className="fsw-modal-close" onClick={() => setShowOutputModal(false)}>✕</button>
            </div>
            <div className="fsw-modal-body">
              {pageSnapshots.length > 0 ? (
                pageSnapshots.map((snap, i) => (
                  <div key={i} className="fsw-modal-section">
                    <h3>Page {snap.pageIndex + 1}</h3>
                    <div className="fsw-snapshot-container">
                      {snap.isRecognizing && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 100, color: '#c084fc', gap: 8, fontSize: 13, fontWeight: 600 }}>
                          <span className="fsw-spinner" /> Converting handwriting to math...
                        </div>
                      )}
                      {!snap.isRecognizing && (
                        <div className="fsw-virtual-page-wrapper" style={{ position: 'relative', width: '100%', aspectRatio: `${PAGE_W}/${PAGE_H}`, overflow: 'hidden', background: '#fff', borderRadius: 4 }}>
                          {/* Virtual A4 Page (100% width/height of wrapper) */}
                          <div className="fsw-page" style={{ 
                            position: 'absolute', 
                            top: 0, left: 0, 
                            width: '100%', height: '100%', 
                            border: 'none', margin: 0, boxShadow: 'none'
                          }}>
                            <div className="fsw-page-lines" />
                            
                            {/* Render Converted Math Blocks */}
                            {snap.blocks?.map(block => (
                              <div key={block.id} style={{
                                position: 'absolute',
                                left: `${block.x}%`,
                                top: `${block.y}%`,
                                width: `${block.width}%`,
                                height: `${block.height}%`,
                                color: '#18181b',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                pointerEvents: 'none'
                              }}>
                                {/* Use container query or vw fallback for font-size if needed, but flex center usually handles it.
                                    We use clamp to ensure readable scale. */}
                                {block.latex ? (
                                  <span style={{ fontSize: `clamp(10px, 3cqi, 48px)` }} dangerouslySetInnerHTML={{
                                    __html: katex.renderToString(block.latex, { throwOnError: false })
                                  }} />
                                ) : (
                                  <span style={{ fontSize: `clamp(10px, 3cqi, 48px)` }}>{block.text}</span>
                                )}
                              </div>
                            ))}

                            {/* Render Text Annotations Exactly where they were */}
                            {snap.annotations.map((a, ai) => {
                              const isLatex = a.text.startsWith('$') && a.text.endsWith('$') && a.text.length > 2;
                              const latexBody = isLatex ? a.text.slice(1, -1) : null;
                              return (
                                <div key={ai} className="fsw-annotation-display" style={{
                                  position: 'absolute',
                                  left: `${(a.x / PAGE_W) * 100}%`,
                                  top: `${(a.y / PAGE_H) * 100}%`,
                                  color: '#18181b',
                                  background: 'transparent',
                                  border: 'none',
                                  fontSize: `clamp(12px, 2.5cqi, 24px)`
                                }}>
                                  {latexBody ? (
                                    <span dangerouslySetInnerHTML={{
                                      __html: katex.renderToString(latexBody, { throwOnError: false })
                                    }} />
                                  ) : (
                                    <span>{a.text}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="fsw-modal-empty">
                  <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>✦</div>
                  <p>No content yet. Start writing or typing on the workspace pages.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* ═══ AI TUTOR PANEL ═══ */}
      <AiTutorPanel
        currentQuestion={currentQuestion}
        pages={pages}
        fetchMyScriptBlocks={fetchMyScriptBlocks}
        hasStrokes={totalStrokes > 0}
        isOpen={aiPanelOpen}
        onClose={() => setAiPanelOpen(false)}
      />

      {/* ═══ STYLES ═══ */}
      <style>{`
        /* ── Overlay ── */
        .fsw-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: #18181b;
          display: flex;
          flex-direction: column;
          animation: fsw-fadeIn 0.3s ease;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        @keyframes fsw-fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* ── Top Bar ── */
        .fsw-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 20px;
          background: rgba(24,24,27,0.92);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(255,255,255,0.06);
          z-index: 10;
          flex-shrink: 0;
        }
        .fsw-topbar-title {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #e4e4e7;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: -0.02em;
        }
        .fsw-topbar-icon { font-size: 18px; }
        .fsw-topbar-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 99px;
          background: rgba(168,85,247,0.15);
          color: #c084fc;
          font-weight: 500;
        }

        /* ── Buttons ── */
        .fsw-btn {
          padding: 7px 16px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.04);
          color: #a1a1aa;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
          backdrop-filter: blur(10px);
        }
        .fsw-btn:hover {
          background: rgba(255,255,255,0.08);
          color: #e4e4e7;
          border-color: rgba(255,255,255,0.18);
        }
        .fsw-btn-back:hover { border-color: rgba(239,68,68,0.4); color: #fca5a5; }
        .fsw-btn-output {
          background: rgba(255,255,255,0.06);
          color: white;
        }
        .fsw-btn-output:hover { background: rgba(255,255,255,0.12); }
        .fsw-btn-grade {
          background: linear-gradient(135deg, #8b5cf6, #c084fc);
          color: white;
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }
        .fsw-btn-grade:hover {
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          box-shadow: 0 6px 16px rgba(139, 92, 246, 0.4);
        }
        .fsw-btn-grade:disabled {
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.4);
          box-shadow: none;
          cursor: not-allowed;
        }

        /* ── Scroll Container ── */
        .fsw-scroll {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          background: #09090b;
          display: flex;
          justify-content: center;
          padding: 40px 0;
          overscroll-behavior: none;
        }
        
        .fsw-static-question {
          position: absolute;
          top: 10px;
          left: 20px;
          right: 20px;
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(79, 70, 229, 0.2);
          border-radius: 8px;
          padding: 12px 16px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 16px;
          color: #1f2937;
          line-height: 1.5;
          z-index: 1;
          pointer-events: none;
        }

        .fsw-pages-stack {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 40px 20px 120px;
        }

        /* ── A4 Page ── */
        .fsw-page {
          position: relative;
          background: #ffffff;
          border-radius: 4px;
          box-shadow:
            0 2px 8px rgba(0,0,0,0.25),
            0 12px 40px rgba(0,0,0,0.15),
            0 0 0 1px rgba(255,255,255,0.04);
          overflow: hidden;
          flex-shrink: 0;
        }
        .fsw-page-lines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
          background:
            repeating-linear-gradient(
              to bottom,
              transparent,
              transparent 31px,
              rgba(59,130,246,0.06) 31px,
              rgba(59,130,246,0.06) 32px
            );
          /* Left margin line */
          border-left: 2px solid rgba(239,68,68,0.08);
          margin-left: 72px;
        }
        .fsw-page-number {
          position: absolute;
          bottom: 16px;
          right: 20px;
          font-size: 11px;
          color: rgba(0,0,0,0.15);
          font-weight: 500;
          z-index: 4;
          pointer-events: none;
          user-select: none;
        }

        /* ── Annotations ── */
        .fsw-annotation {
          position: absolute;
          pointer-events: auto;
          z-index: 3;
        }
        .fsw-annotation-input {
          min-width: 160px;
          min-height: 28px;
          padding: 4px 8px;
          font-size: 14px;
          font-family: inherit;
          border: 2px solid #2563eb;
          border-radius: 6px;
          background: rgba(255,255,255,0.95);
          color: #1e293b;
          outline: none;
          resize: both;
          box-shadow: 0 2px 12px rgba(37,99,235,0.18);
        }
        .fsw-annotation-display {
          padding: 3px 8px;
          font-size: 14px;
          color: #1e293b;
          background: rgba(255,255,200,0.55);
          border-radius: 4px;
          border: 1px solid rgba(0,0,0,0.08);
          cursor: text;
          min-width: 40px;
          white-space: pre-wrap;
          user-select: none;
        }

        /* ── Floating Toolbox ── */
        .fsw-toolbox {
          position: absolute;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 100;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .fsw-dock {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          background: rgba(24,24,27,0.88);
          backdrop-filter: blur(24px) saturate(1.4);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);
          opacity: 0;
          transform: translateY(20px) scale(0.92);
          pointer-events: none;
          transition: all 0.28s cubic-bezier(0.34,1.56,0.64,1);
        }
        .fsw-toolbox.open .fsw-dock {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        .fsw-fab {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(24,24,27,0.9);
          backdrop-filter: blur(20px);
          color: white;
          font-size: 22px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          transition: all 0.2s ease;
        }
        .fsw-fab:hover {
          background: rgba(40,40,44,0.95);
          box-shadow: 0 6px 28px rgba(0,0,0,0.5);
          transform: scale(1.05);
        }

        /* Dock buttons */
        .fsw-dock-btn {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          color: #a1a1aa;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .fsw-dock-btn:hover {
          background: rgba(255,255,255,0.08);
          color: white;
        }
        .fsw-dock-btn.active {
          background: rgba(59,130,246,0.2);
          border-color: rgba(59,130,246,0.4);
          color: #60a5fa;
          box-shadow: 0 0 12px rgba(59,130,246,0.15);
        }
        .fsw-dock-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .fsw-dock-btn-clear:hover { color: #fca5a5; }

        .fsw-dock-divider {
          width: 1px;
          height: 24px;
          background: rgba(255,255,255,0.08);
          margin: 0 4px;
        }

        /* Eraser group */
        .fsw-dock-eraser-group {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          position: relative;
        }
        .fsw-eraser-toggle {
          display: flex;
          gap: 2px;
          position: absolute;
          top: -34px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(24,24,27,0.95);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 3px;
          white-space: nowrap;
          animation: fsw-fadeIn 0.15s ease;
        }
        .fsw-eraser-mode-btn {
          padding: 3px 10px;
          font-size: 10px;
          font-weight: 600;
          border: none;
          border-radius: 5px;
          background: transparent;
          color: #71717a;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.15s;
        }
        .fsw-eraser-mode-btn.active {
          background: rgba(239,68,68,0.2);
          color: #fca5a5;
        }

        /* Color dots */
        .fsw-dock-colors {
          display: flex;
          gap: 5px;
          align-items: center;
        }
        .fsw-color-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid transparent;
          cursor: pointer;
          transition: all 0.15s;
        }
        .fsw-color-dot:hover { transform: scale(1.2); }
        .fsw-color-dot.active {
          border-color: white;
          box-shadow: 0 0 8px rgba(255,255,255,0.3);
          transform: scale(1.15);
        }

        /* Width slider */
        .fsw-dock-width {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fsw-width-preview {
          border-radius: 50%;
          min-width: 4px;
          min-height: 4px;
          transition: all 0.15s;
        }
        .fsw-width-slider {
          width: 60px;
          accent-color: #60a5fa;
          height: 3px;
        }

        /* ── Output Modal ── */
        .fsw-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(6px);
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fsw-fadeIn 0.2s ease;
        }
        .fsw-modal {
          background: rgba(30,30,34,0.96);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 20px;
          width: min(680px, 92vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 60px rgba(0,0,0,0.6);
          backdrop-filter: blur(24px);
          animation: fsw-scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes fsw-scaleIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
        .fsw-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 24px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .fsw-modal-header h2 {
          margin: 0;
          font-size: 17px;
          color: #e4e4e7;
          font-weight: 600;
        }
        .fsw-modal-close {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: none;
          background: rgba(255,255,255,0.06);
          color: #a1a1aa;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .fsw-modal-close:hover { background: rgba(255,255,255,0.12); color: white; }
        .fsw-modal-body {
          padding: 20px 24px;
          overflow-y: auto;
        }
        
        /* Grading Modal Styles */
        .fsw-grading-modal {
          max-width: 500px;
        }
        .fsw-grading-scorebox {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 20px;
          border-radius: 12px;
          border: 1px solid;
          margin-bottom: 24px;
        }
        .fsw-grading-icon {
          font-size: 48px;
          line-height: 1;
        }
        .fsw-grading-label {
          font-size: 13px;
          color: #a1a1aa;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .fsw-grading-points {
          font-size: 32px;
          font-weight: 700;
          line-height: 1;
        }
        .fsw-grading-outof {
          font-size: 18px;
          opacity: 0.7;
          font-weight: 500;
        }
        .fsw-grading-text {
          font-size: 15px;
          line-height: 1.6;
          color: #d4d4d8;
          background: rgba(255,255,255,0.04);
          padding: 16px;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.06);
        }

        .fsw-modal-section {
          margin-bottom: 20px;
        }
        .fsw-modal-section h3 {
          margin: 0 0 8px;
          font-size: 14px;
          color: #a1a1aa;
          font-weight: 600;
        }
        .fsw-modal-info {
          font-size: 13px;
          color: #71717a;
          margin: 0 0 4px;
        }
        .fsw-modal-hint {
          font-size: 12px;
          color: #52525b;
          margin: 0;
          font-style: italic;
        }
        .fsw-modal-annotation {
          padding: 8px 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 8px;
          margin-bottom: 6px;
          font-size: 14px;
          color: #d4d4d8;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .fsw-modal-ann-badge {
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 6px;
          background: rgba(168,85,247,0.15);
          color: #c084fc;
          font-weight: 600;
          white-space: nowrap;
        }
        .fsw-modal-empty {
          text-align: center;
          padding: 40px 20px;
          color: #52525b;
          font-size: 14px;
        }
        .fsw-snapshot-container {
          background: #e4e4e7;
          border-radius: 8px;
          padding: 8px;
          border: 1px solid rgba(255,255,255,0.1);
          overflow: hidden;
          margin-bottom: 12px;
        }
        .fsw-virtual-page-wrapper {
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          container-type: inline-size;
        }
        .fsw-page-lines {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-color: transparent;
          background-image: 
            linear-gradient(to right, transparent 79px, #fca5a5 79px, #fca5a5 80px, transparent 80px),
            repeating-linear-gradient(to bottom, transparent, transparent 39px, #93c5fd 39px, #93c5fd 40px);
          background-position: 0 0, 0 80px;
          pointer-events: none;
          z-index: 0;
          opacity: 0.7;
        }
        .fsw-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(168,85,247,0.3);
          border-top-color: #c084fc;
          border-radius: 50%;
          animation: fsw-spin 0.8s linear infinite;
        }
        @keyframes fsw-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
