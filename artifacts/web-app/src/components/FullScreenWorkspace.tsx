import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import CryptoJS from 'crypto-js';
import PaperPageCanvas from '@/components/PaperPageCanvas';
import { buildPaperQuestionShape } from '@/lib/paperQuestionParts';
import {
  evaluatePaperWork,
  explainPaperCorrection,
  generateTutorAnswer,
  gradeTutorPaper,
  requestPaperHelp,
  type PaperGradeResult,
  type PaperHelpMode,
  type TutorAnswerPackage,
} from '@/lib/paperTutorService';

/* ═══════════════════════════════════════════════════════════════
   DATA MODEL — Completely isolated from MyScript state
   ═══════════════════════════════════════════════════════════════ */

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  id: string;
  points: StrokePoint[];
  color: string;
  width: number;
  regionId?: string;
}

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  width: number;
  height: number;
  regionId?: string;
}

export interface PaperAiMark {
  id: string;
  regionId: string;
  type: 'circle' | 'highlight' | 'note';
  x: number;
  y: number;
  width: number;
  height: number;
  targetText?: string;
  correctionText: string;
  explanation: string;
  targetStrokeIds: string[];
  status: 'active' | 'checking';
}

export interface PaperAiBlock {
  id: string;
  regionId: string;
  mode: PaperHelpMode;
  y: number;
  title: string;
  body?: string | null;
}

export interface PageData {
  id: string;
  strokes: Stroke[];
  annotations: TextAnnotation[];
  aiMarks?: PaperAiMark[];
  aiBlocks?: PaperAiBlock[];
  answerRegionHeights?: Record<string, number>;
}

type EraserMode = 'pixel' | 'stroke';

interface UndoAction {
  type: 'add-stroke' | 'remove-stroke' | 'add-annotation' | 'remove-annotation' | 'move-strokes' | 'layout' | 'ai-blocks' | 'clear';
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

function getStrokeBounds(strokes: Stroke[]): { x: number; y: number; width: number; height: number } | null {
  if (strokes.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  strokes.forEach(stroke => stroke.points.forEach(point => {
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }));
  return Number.isFinite(left) ? { x: left, y: top, width: Math.max(18, right - left), height: Math.max(18, bottom - top) } : null;
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
  activeTool: 'pen' | 'eraser' | 'select';
  eraserMode: EraserMode;
  strokeColor: string;
  strokeWidth: number;
  onStrokeAdd: (pageId: string, stroke: Stroke) => void;
  onStrokeRemove: (pageId: string, strokeId: string) => void;
  onAnnotationAdd: (pageId: string, ann: TextAnnotation) => void;
  onAnnotationUpdate: (pageId: string, annId: string, text: string) => void;
  onMoveStrokes: (pageId: string, strokeIds: string[], dx: number, dy: number) => void;
  onAnswerSpaceChange: (pageId: string, regionId: string, delta: number) => void;
  onAiHelp: (regionId: string, mode: PaperHelpMode) => void;
  onAiMarkClick: (mark: PaperAiMark) => void;
  aiHelpBusyRegion: string | null;
  disableAiHelp: boolean;
  scale: number;
}

const LatexRenderer = ({ content }: { content?: string }) => {
  if (!content) return null;
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

const QuestionText = ({ content }: { content?: string }) => {
  if (!content) return null;
  const normalized = content.replace(/<br\s*\/?>/gi, '\n');
  const renderLine = (line: string, lineIndex: number) => {
    const parts = line.split(/(\*\*[^*]+\*\*|__[^_]+__|\+\+[^+]+\+\+|<u>[\s\S]*?<\/u>)/gi);
    return <div key={lineIndex} className={line.trim() ? 'fsw-question-line' : 'fsw-question-line blank'}>{parts.map((part, partIndex) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={partIndex}><LatexRenderer content={part.slice(2, -2)} /></strong>;
      if (part.startsWith('__') && part.endsWith('__')) return <u key={partIndex}><LatexRenderer content={part.slice(2, -2)} /></u>;
      if (part.startsWith('++') && part.endsWith('++')) return <u key={partIndex}><LatexRenderer content={part.slice(2, -2)} /></u>;
      if (/^<u>/i.test(part) && /<\/u>$/i.test(part)) return <u key={partIndex}><LatexRenderer content={part.slice(3, -4)} /></u>;
      return <LatexRenderer key={partIndex} content={part} />;
    })}</div>;
  };
  return <div className="fsw-question-content">{normalized.split(/\r?\n/).map(renderLine)}</div>;
};

const PageCanvas = memo(function PageCanvas({
  page, pageIndex, currentQuestion, activeTool, eraserMode, strokeColor, strokeWidth,
  onStrokeAdd, onStrokeRemove, onAnnotationAdd, onAnnotationUpdate, scale, testGrade
}: PageCanvasProps & { testGrade?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  
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

  const getWritingStartY = useCallback(() => {
    if (pageIndex !== 0 || !currentQuestion || !canvasRef.current || !questionRef.current) return 0;
    const canvasRect = canvasRef.current.getBoundingClientRect();
    const questionRect = questionRef.current.getBoundingClientRect();
    return (questionRect.bottom - canvasRect.top) / scale + 16;
  }, [currentQuestion, pageIndex, scale]);

  const handleDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = getPos(e);
    if (pos.y < getWritingStartY()) return;

    e.currentTarget.setPointerCapture(e.pointerId);
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
  }, [activeTool, eraserMode, page, getPos, getWritingStartY, onStrokeRemove, onAnnotationAdd]);

  const handleMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const pos = getPos(e);

    if (pos.y < getWritingStartY()) {
      if (activeTool === 'pen') {
        if (activeStroke.current.length >= 2) {
          onStrokeAdd(page.id, {
            id: uid(),
            points: [...activeStroke.current],
            color: strokeColor,
            width: strokeWidth,
          });
        }
        activeStroke.current = [];
        isDrawing.current = false;
      }
      return;
    }

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
  }, [activeTool, eraserMode, strokeColor, strokeWidth, page, getPos, getWritingStartY, onStrokeAdd, onStrokeRemove]);

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
        const mainText = typeof currentQuestion === 'string' 
          ? currentQuestion 
          : currentQuestion.context || currentQuestion.rawText || currentQuestion.promptBlocks?.[0]?.text;
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
          <div ref={questionRef} className="fsw-static-question" style={{ position: 'relative', zIndex: 10, pointerEvents: 'none' }}>
            {/* Main Context / Given */}
            <div style={{ marginBottom: 8, background: isMulti ? 'rgba(255,255,255,0.7)' : 'transparent', padding: isMulti ? '12px' : 0, borderRadius: 8 }}>
              <div style={{ flex: 1, paddingRight: 16 }}>
                <QuestionText content={mainText} />
                {testGrade && (
                  <div style={{ marginTop: 8, fontSize: 18, fontWeight: 'bold', color: '#ef4444' }}>
                    {testGrade}
                  </div>
                )}
              </div>
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
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    transition: 'top 0.3s ease-out'
                  }}>
                    <span style={{ color: '#4f46e5', flexShrink: 0 }}>{sq.label}</span>
                    <div style={{ flex: 1 }}><QuestionText content={sq.rawText} /></div>
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
  programId?: string;
  currentQuestion?: import('@/lib/personalProgramService').PersonalProgramQuestion | string;
  initialPages?: PageData[];
  onPagesChange?: (pages: PageData[]) => void;
  isTestMode?: boolean;
  onTestDone?: (pagesImages: string[]) => void;
  testGrade?: string;
  showAiSwitch?: boolean;
  questionNavigation?: {
    current: number;
    total: number;
    canPrevious: boolean;
    canNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  };
}

export default function FullScreenWorkspace({ onClose, programId, currentQuestion, initialPages, onPagesChange, isTestMode, onTestDone, testGrade, showAiSwitch, questionNavigation }: FullScreenWorkspaceProps) {
  const [correctMeOn, setCorrectMeOn] = useState(false);
  const [correctMeStatus, setCorrectMeStatus] = useState<'idle' | 'reading' | 'checking' | 'checked' | 'error'>('idle');
  const [correctMeError, setCorrectMeError] = useState('');
  const [aiHelpBusyRegion, setAiHelpBusyRegion] = useState<string | null>(null);
  const [answerPackage, setAnswerPackage] = useState<TutorAnswerPackage | null>(null);
  const [gradeBusy, setGradeBusy] = useState(false);
  const [gradeResult, setGradeResult] = useState<PaperGradeResult | null>(null);
  const [activeAiMark, setActiveAiMark] = useState<PaperAiMark | null>(null);
  const [aiMarkExplanation, setAiMarkExplanation] = useState('');
  const [aiMarkExplanationBusy, setAiMarkExplanationBusy] = useState(false);
  const correctionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const correctionRunRef = useRef(0);
  const questionRunRef = useRef(0);
  const answerRequestRef = useRef<{ key: string; promise: Promise<TutorAnswerPackage> } | null>(null);

  // ── Pages State ──
  const [pages, setPages] = useState<PageData[]>(
    initialPages && initialPages.length > 0 ? (initialPages as PageData[]) : [{ id: uid(), strokes: [], annotations: [] }]
  );
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Reset pages whenever a new question is loaded
  useEffect(() => {
    questionRunRef.current += 1;
    correctionRunRef.current += 1;
    answerRequestRef.current = null;
    setPages(
      initialPages && initialPages.length > 0
        ? (initialPages as PageData[])
        : [{ id: uid(), strokes: [], annotations: [] }]
    );
    setUndoStack([]);
    setRedoStack([]);
    setGradeResult(null);
    setGradeBusy(false);
    setAiHelpBusyRegion(null);
    setActiveAiMark(null);
    setCorrectMeError('');
    setCorrectMeStatus('idle');
    setHasUsedAiAssistance(Boolean(initialPages?.some(page => (page.aiBlocks?.length ?? 0) > 0 || (page.aiMarks?.length ?? 0) > 0)));
    const question = typeof currentQuestion === 'string' ? null : currentQuestion;
    if (question?.modelAnswer) {
      const highLevelSteps = question.solutionPlan?.split(/\r?\n/).map(step => step.replace(/^[•*-]\s*/, '').trim()).filter(Boolean) ?? [];
      const solutionBody = question.solution || question.modelAnswer;
      setAnswerPackage({
        modelAnswer: question.modelAnswer,
        highLevelSteps,
        fullSolution: [{ title: 'Solution', body: solutionBody }],
        gradingRubric: question.gradingSchema?.map(item => ({ criterion: item.criterion, points: item.points })) ?? [{ criterion: 'Correct method and answer', points: 100 }],
        provenance: question.answerProvenance === 'ai_generated' ? 'ai_generated' : 'source',
        reviewStatus: question.answerReviewStatus === 'pending_review' ? 'pending_review' : 'approved',
      });
    } else setAnswerPackage(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeof currentQuestion === 'string' ? currentQuestion : currentQuestion?.id]);

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
  const [activeTool, setActiveTool] = useState<'pen' | 'eraser' | 'select'>('pen');
  const [eraserMode, setEraserMode] = useState<EraserMode>('pixel');
  const [strokeColor, setStrokeColor] = useState('#1e293b');
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [showOutputModal, setShowOutputModal] = useState(false);
  const [hasUsedAiAssistance, setHasUsedAiAssistance] = useState(false);

  const questionPrompt = useMemo(() => typeof currentQuestion === 'string'
    ? currentQuestion
    : currentQuestion?.rawText || currentQuestion?.context || currentQuestion?.promptBlocks?.[0]?.text || '', [currentQuestion]);
  const paperQuestionShape = useMemo(() => buildPaperQuestionShape(currentQuestion), [currentQuestion]);
  const questionRegionIds = useMemo(() => paperQuestionShape.parts.map(part => part.id), [paperQuestionShape]);

  const promptForRegion = useCallback((regionId: string) => {
    const part = paperQuestionShape.parts.find(candidate => candidate.id === regionId);
    return [paperQuestionShape.context, part ? `${part.label} ${part.prompt}`.trim() : questionPrompt].filter(Boolean).join('\n');
  }, [paperQuestionShape, questionPrompt]);

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
    const removed = pages.find(page => page.id === pageId)?.strokes.find(stroke => stroke.id === strokeId);
    if (!removed) return;
    setPages(prev => prev.map(p => {
      if (p.id !== pageId) return p;
      return { ...p, strokes: p.strokes.filter(s => s.id !== strokeId) };
    }));
    setUndoStack(prev => [...prev, { type: 'remove-stroke', pageId, data: removed }]);
    setRedoStack([]);
  }, [pages]);

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

  const handleMoveStrokes = useCallback((pageId: string, strokeIds: string[], dx: number, dy: number) => {
    if (strokeIds.length === 0 || (Math.abs(dx) < .01 && Math.abs(dy) < .01)) return;
    const idSet = new Set(strokeIds);
    setPages(previous => previous.map(page => page.id !== pageId ? page : {
      ...page,
      strokes: page.strokes.map(stroke => idSet.has(stroke.id) ? { ...stroke, points: stroke.points.map(point => ({ ...point, x: point.x + dx, y: point.y + dy })) } : stroke),
      aiMarks: (page.aiMarks ?? []).map(mark => mark.targetStrokeIds.some(id => idSet.has(id)) ? { ...mark, x: mark.x + dx, y: mark.y + dy } : mark),
    }));
    setUndoStack(previous => [...previous, { type: 'move-strokes', pageId, data: { strokeIds, dx, dy } }]);
    setRedoStack([]);
  }, []);

  const handleAnswerSpaceChange = useCallback((pageId: string, regionId: string, delta: number) => {
    const defaultHeight = questionRegionIds.length === 1 ? 900 : 260;
    const regionIndex = questionRegionIds.indexOf(regionId);
    if (regionIndex < 0) return;
    const laterRegions = new Set(questionRegionIds.slice(regionIndex + 1));
    const currentPage = pages.find(page => page.id === pageId);
    if (!currentPage) return;
    const beforeHeight = currentPage.answerRegionHeights?.[regionId] ?? defaultHeight;
    const afterHeight = Math.max(180, beforeHeight + delta);
    const appliedDelta = afterHeight - beforeHeight;
    if (appliedDelta === 0) return;
    setPages(previous => previous.map(page => {
      if (page.id !== pageId) return page;
      return {
        ...page,
        answerRegionHeights: { ...(page.answerRegionHeights ?? {}), [regionId]: afterHeight },
        strokes: page.strokes.map(stroke => stroke.regionId && laterRegions.has(stroke.regionId) ? { ...stroke, points: stroke.points.map(point => ({ ...point, y: point.y + appliedDelta })) } : stroke),
        annotations: page.annotations.map(annotation => annotation.regionId && laterRegions.has(annotation.regionId) ? { ...annotation, y: annotation.y + appliedDelta } : annotation),
        aiMarks: (page.aiMarks ?? []).map(mark => laterRegions.has(mark.regionId) ? { ...mark, y: mark.y + appliedDelta } : mark),
      };
    }));
    setUndoStack(previous => [...previous, { type: 'layout', pageId, data: { regionId, beforeHeight, afterHeight, delta: appliedDelta, laterRegions: [...laterRegions] } }]);
    setRedoStack([]);
  }, [pages, questionRegionIds]);

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
    } else if (action.type === 'move-strokes') {
      const ids = new Set<string>(action.data.strokeIds);
      setPages(prev => prev.map(p => p.id !== action.pageId ? p : {
        ...p,
        strokes: p.strokes.map(s => ids.has(s.id) ? { ...s, points: s.points.map(point => ({ ...point, x: point.x - action.data.dx, y: point.y - action.data.dy })) } : s),
        aiMarks: (p.aiMarks ?? []).map(mark => mark.targetStrokeIds.some(id => ids.has(id)) ? { ...mark, x: mark.x - action.data.dx, y: mark.y - action.data.dy } : mark),
      }));
    } else if (action.type === 'layout') {
      const later = new Set<string>(action.data.laterRegions);
      setPages(prev => prev.map(p => p.id !== action.pageId ? p : {
        ...p,
        answerRegionHeights: { ...(p.answerRegionHeights ?? {}), [action.data.regionId]: action.data.beforeHeight },
        strokes: p.strokes.map(s => s.regionId && later.has(s.regionId) ? { ...s, points: s.points.map(point => ({ ...point, y: point.y - action.data.delta })) } : s),
        annotations: p.annotations.map(a => a.regionId && later.has(a.regionId) ? { ...a, y: a.y - action.data.delta } : a),
        aiMarks: (p.aiMarks ?? []).map(mark => later.has(mark.regionId) ? { ...mark, y: mark.y - action.data.delta } : mark),
      }));
    } else if (action.type === 'ai-blocks') {
      setPages(prev => prev.map(p => p.id === action.pageId ? { ...p, aiBlocks: action.data.beforeBlocks, answerRegionHeights: action.data.beforeHeights } : p));
    } else if (action.type === 'clear') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId ? { ...p, strokes: action.data.strokes, annotations: action.data.annotations, aiMarks: action.data.aiMarks ?? [] } : p
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
    } else if (action.type === 'move-strokes') {
      const ids = new Set<string>(action.data.strokeIds);
      setPages(prev => prev.map(p => p.id !== action.pageId ? p : {
        ...p,
        strokes: p.strokes.map(s => ids.has(s.id) ? { ...s, points: s.points.map(point => ({ ...point, x: point.x + action.data.dx, y: point.y + action.data.dy })) } : s),
        aiMarks: (p.aiMarks ?? []).map(mark => mark.targetStrokeIds.some(id => ids.has(id)) ? { ...mark, x: mark.x + action.data.dx, y: mark.y + action.data.dy } : mark),
      }));
    } else if (action.type === 'layout') {
      const later = new Set<string>(action.data.laterRegions);
      setPages(prev => prev.map(p => p.id !== action.pageId ? p : {
        ...p,
        answerRegionHeights: { ...(p.answerRegionHeights ?? {}), [action.data.regionId]: action.data.afterHeight },
        strokes: p.strokes.map(s => s.regionId && later.has(s.regionId) ? { ...s, points: s.points.map(point => ({ ...point, y: point.y + action.data.delta })) } : s),
        annotations: p.annotations.map(a => a.regionId && later.has(a.regionId) ? { ...a, y: a.y + action.data.delta } : a),
        aiMarks: (p.aiMarks ?? []).map(mark => later.has(mark.regionId) ? { ...mark, y: mark.y + action.data.delta } : mark),
      }));
    } else if (action.type === 'ai-blocks') {
      setPages(prev => prev.map(p => p.id === action.pageId ? { ...p, aiBlocks: action.data.afterBlocks, answerRegionHeights: action.data.afterHeights } : p));
    } else if (action.type === 'clear') {
      setPages(prev => prev.map(p =>
        p.id === action.pageId ? { ...p, strokes: [], annotations: [], aiMarks: [] } : p
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
      data: { strokes: [...targetPage.strokes], annotations: [...targetPage.annotations], aiMarks: [...(targetPage.aiMarks ?? [])] },
    }]);
    setRedoStack([]);
    setPages(prev => prev.map(p =>
      p.id === targetPage.id ? { ...p, strokes: [], annotations: [], aiMarks: [] } : p
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

      const recognitionHeight = Math.max(PAGE_H, ...clusterStrokes.flatMap(stroke => stroke.points.map(point => Math.ceil(point.y + 80))));
      const payload = {
        width: PAGE_W, height: recognitionHeight, contentType: "Math",
        configuration: { math: { mimeTypes: ["application/x-latex", "application/vnd.myscript.jiix"] } },
        strokeGroups: [{ penStyle: "color: #000000;", strokes: msStrokes }]
      };

      const bodyStr = JSON.stringify(payload);
      let hmacHex: string;
      if (typeof window.crypto !== 'undefined' && window.crypto.subtle) {
        try {
          const encoder = new TextEncoder();
          const cryptoKey = await window.crypto.subtle.importKey(
            'raw', encoder.encode(applicationKey + hmacKey),
            { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
          );
          const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(bodyStr));
          hmacHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (err) {
          hmacHex = CryptoJS.HmacSHA512(bodyStr, applicationKey + hmacKey).toString(CryptoJS.enc.Hex);
        }
      } else {
        hmacHex = CryptoJS.HmacSHA512(bodyStr, applicationKey + hmacKey).toString(CryptoJS.enc.Hex);
      }

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
      if (!res.ok) throw new Error(`Handwriting recognition failed (${res.status}): ${(await res.text()).slice(0, 180)}`);
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
      if (!resLatex.ok) throw new Error(`Handwriting math conversion failed (${resLatex.status}): ${(await resLatex.text()).slice(0, 180)}`);
      const directLatex = await resLatex.text();

      const parsedBlocks = parseJIIXAbsolute(jiix, directLatex);
      allParsedBlocks = [...allParsedBlocks, ...parsedBlocks];
    }));
    
    return allParsedBlocks;
  }, []);

  const ensureAnswerPackage = useCallback(async (): Promise<TutorAnswerPackage> => {
    if (answerPackage) return answerPackage;
    const questionId = typeof currentQuestion === 'string' ? 'question' : currentQuestion?.id || 'question';
    const requestKey = `${programId || 'unscoped'}:${questionId}:${questionPrompt}`;
    if (answerRequestRef.current?.key === requestKey) return answerRequestRef.current.promise;
    const existingAnswer = typeof currentQuestion === 'string' ? null : currentQuestion?.modelAnswer || null;
    const request = generateTutorAnswer({ programId, questionId, questionPrompt, existingAnswer }).then(result => {
      if (answerRequestRef.current?.key === requestKey) setAnswerPackage(result);
      return result;
    }).finally(() => { if (answerRequestRef.current?.key === requestKey) answerRequestRef.current = null; });
    answerRequestRef.current = { key: requestKey, promise: request };
    return request;
  }, [answerPackage, currentQuestion, programId, questionPrompt]);

  const recognizeStrokes = useCallback(async (strokes: Stroke[]) => {
    if (strokes.length === 0) return { text: '', latex: '', blocks: [] as ConvertedBlock[] };
    const blocks = await fetchMyScriptBlocks(strokes);
    const ordered = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
    return {
      text: ordered.map(block => block.text || block.latex).filter(Boolean).join('\n'),
      latex: ordered.map(block => block.latex || block.text).filter(Boolean).join('\\\\'),
      blocks: ordered,
    };
  }, [fetchMyScriptBlocks]);

  const evaluateRegion = useCallback(async (pageId: string, regionId: string, sourcePages: PageData[], runId: number) => {
    const page = sourcePages.find(candidate => candidate.id === pageId);
    const strokes = page?.strokes.filter(stroke => stroke.regionId === regionId) ?? [];
    if (!page || strokes.length === 0) return;
    const answer = await ensureAnswerPackage();
    const recognized = await recognizeStrokes(strokes);
    if (!recognized.text && !recognized.latex) return;
    const result = await evaluatePaperWork({
      questionId: typeof currentQuestion === 'string' ? 'question' : currentQuestion?.id || 'question',
      questionPrompt: promptForRegion(regionId),
      activeStepId: regionId,
      activeStepTitle: promptForRegion(regionId),
      recognizedText: recognized.text || recognized.latex,
      recognizedLatex: recognized.latex || null,
      expectedAnswer: answer.modelAnswer,
      expectedReasoning: answer.fullSolution.map(step => `${step.title}: ${step.body}`).join('\n'),
    });
    if (runId !== correctionRunRef.current) return;
    const redAnnotations = result.annotations.filter(annotation => annotation.color === 'red');
    const overallBounds = getStrokeBounds(strokes);
    const nextMarks: PaperAiMark[] = (redAnnotations.length > 0 ? redAnnotations : result.isCorrect || !result.detectedMistake ? [] : [{ type: 'circle' as const, color: 'red' as const, targetText: null, text: result.detectedMistake }]).map((annotation, index) => {
      const target = (annotation.targetText || '').replace(/\s+/g, '').toLowerCase();
      const matchingBlock = target ? recognized.blocks.find(block => `${block.text}${block.latex}`.replace(/\s+/g, '').toLowerCase().includes(target)) : null;
      const bounds = matchingBlock ? {
        x: matchingBlock.x / 100 * PAGE_W,
        y: matchingBlock.y / 100 * PAGE_H,
        width: Math.max(24, matchingBlock.width / 100 * PAGE_W),
        height: Math.max(24, matchingBlock.height / 100 * PAGE_H),
      } : overallBounds || { x: 32, y: 160, width: 160, height: 45 };
      const targetStrokeIds = strokes.filter(stroke => {
        const strokeBox = getStrokeBounds([stroke]);
        return !!strokeBox && strokeBox.x <= bounds.x + bounds.width && strokeBox.x + strokeBox.width >= bounds.x && strokeBox.y <= bounds.y + bounds.height && strokeBox.y + strokeBox.height >= bounds.y;
      }).map(stroke => stroke.id);
      return {
        id: `ai-mark-${regionId}-${index}`,
        regionId,
        type: annotation.type === 'underline' ? 'highlight' : annotation.type === 'write_text' ? 'note' : 'circle',
        x: Math.max(4, bounds.x - 7), y: Math.max(4, bounds.y - 7), width: bounds.width + 14, height: bounds.height + 14,
        targetText: annotation.targetText || undefined,
        correctionText: annotation.text || result.detectedMistake || 'Check this step',
        explanation: result.studentMessage || result.detectedMistake || 'This step needs correction.',
        targetStrokeIds: targetStrokeIds.length ? targetStrokeIds : strokes.map(stroke => stroke.id),
        status: 'active' as const,
      };
    });
    setPages(previous => previous.map(candidate => candidate.id === pageId ? { ...candidate, aiMarks: [...(candidate.aiMarks ?? []).filter(mark => mark.regionId !== regionId), ...nextMarks] } : candidate));
  }, [currentQuestion, ensureAnswerPackage, promptForRegion, recognizeStrokes]);

  const strokeSignature = useMemo(() => pages.map(page => `${page.id}:${page.strokes.map(stroke => {
    const first = stroke.points[0];
    const last = stroke.points[stroke.points.length - 1];
    return `${stroke.id}:${stroke.points.length}:${first?.x.toFixed(1)},${first?.y.toFixed(1)}:${last?.x.toFixed(1)},${last?.y.toFixed(1)}`;
  }).join(',')}`).join('|'), [pages]);
  useEffect(() => {
    if (correctionTimerRef.current) clearTimeout(correctionTimerRef.current);
    const maintenanceRegions = new Set<string>();
    pages.forEach(page => (page.aiMarks ?? []).forEach(mark => {
      const ids = new Set(page.strokes.map(stroke => stroke.id));
      if (mark.targetStrokeIds.some(id => !ids.has(id))) maintenanceRegions.add(mark.regionId);
    }));
    if (!correctMeOn && maintenanceRegions.size === 0) return;
    setCorrectMeStatus('reading');
    correctionTimerRef.current = setTimeout(() => {
      const runId = ++correctionRunRef.current;
      setCorrectMeStatus('checking');
      setCorrectMeError('');
      const jobs: Promise<void>[] = [];
      pages.forEach(page => {
        const regionIds = correctMeOn
          ? [...new Set(page.strokes.map(stroke => stroke.regionId).filter((value): value is string => !!value))]
          : [...maintenanceRegions];
        regionIds.forEach(regionId => {
          if (page.strokes.some(stroke => stroke.regionId === regionId)) jobs.push(evaluateRegion(page.id, regionId, pages, runId));
        });
      });
      void Promise.all(jobs).then(() => { if (runId === correctionRunRef.current) setCorrectMeStatus('checked'); }).catch(error => {
        if (runId !== correctionRunRef.current) return;
        setCorrectMeStatus('error'); setCorrectMeError(error instanceof Error ? error.message : 'Live correction failed.');
      });
    }, 900);
    return () => { if (correctionTimerRef.current) clearTimeout(correctionTimerRef.current); };
  // Pages are intentionally represented by the stable stroke signature so AI-mark updates do not retrigger recognition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokeSignature, correctMeOn, evaluateRegion]);

  const handleAiHelp = useCallback(async (regionId: string, mode: PaperHelpMode) => {
    if (isTestMode || aiHelpBusyRegion) return;
    if (mode === 'solve' && !window.confirm('Show the complete solution? This will reveal the final answer.')) return;
    const page = pages[0];
    if (!page) return;
    const studentStrokes = page.strokes.filter(stroke => stroke.regionId === regionId);
    if (mode === 'steps' && studentStrokes.length > 0) return;
    setAiHelpBusyRegion(regionId);
    setHasUsedAiAssistance(true);
    const questionRun = questionRunRef.current;
    try {
      const answer = await ensureAnswerPackage();
      if (questionRun !== questionRunRef.current) return;
      const recognized = await recognizeStrokes(studentStrokes);
      if (questionRun !== questionRunRef.current) return;
      const result = await requestPaperHelp({
        mode, programId,
        questionId: typeof currentQuestion === 'string' ? 'question' : currentQuestion?.id || 'question',
        questionPrompt,
        subQuestionId: regionId,
        subQuestionPrompt: promptForRegion(regionId),
        recognizedWork: recognized.text || recognized.latex || null,
        answerPackage: answer,
      });
      if (questionRun !== questionRunRef.current) return;
      setAnswerPackage(result.answerPackage);
      const regionElement = document.querySelector(`[data-answer-region="${CSS.escape(regionId)}"]`) as HTMLElement | null;
      const pageElement = regionElement?.closest('.fsw-page') as HTMLElement | null;
      const regionTop = regionElement && pageElement ? (regionElement.getBoundingClientRect().top - pageElement.getBoundingClientRect().top) / scale : 0;
      const studentBounds = getStrokeBounds(studentStrokes);
      const inkBottom = studentBounds ? studentBounds.y + studentBounds.height - regionTop : 0;
      let y = Math.max(20, inkBottom + 32);
      const additions: PaperAiBlock[] = result.steps.map(step => {
        const block = { id: uid(), regionId, mode, y, title: step.title, body: step.body };
        y += step.body ? 135 : 78;
        return block;
      });
      const latestPages = pagesRef.current;
      const targetPage = latestPages[0];
      if (!targetPage) return;
      const beforeBlocks = targetPage.aiBlocks ?? [];
      const beforeHeights = targetPage.answerRegionHeights ?? {};
      const defaultHeight = questionRegionIds.length === 1 ? 900 : 260;
      const currentHeight = beforeHeights[regionId] ?? defaultHeight;
      const neededHeight = Math.max(currentHeight, y + 35);
      const afterBlocks = [...beforeBlocks, ...additions];
      const afterHeights = { ...beforeHeights, [regionId]: neededHeight };
      setPages(latestPages.map((candidate, pageIndex) => pageIndex === 0 ? { ...candidate, aiBlocks: afterBlocks, answerRegionHeights: afterHeights } : candidate));
      setUndoStack(stack => [...stack, { type: 'ai-blocks', pageId: targetPage.id, data: { beforeBlocks, afterBlocks, beforeHeights, afterHeights } }]);
      setRedoStack([]);
    } catch (error) {
      if (questionRun === questionRunRef.current) setCorrectMeError(error instanceof Error ? error.message : 'AI Help failed.');
    } finally {
      if (questionRun === questionRunRef.current) setAiHelpBusyRegion(null);
    }
  }, [aiHelpBusyRegion, currentQuestion, ensureAnswerPackage, isTestMode, pages, programId, promptForRegion, questionPrompt, questionRegionIds.length, recognizeStrokes, scale]);

  const handleGradePaper = useCallback(async () => {
    if (gradeBusy) return;
    setGradeBusy(true);
    const questionRun = questionRunRef.current;
    try {
      const answer = await ensureAnswerPackage();
      if (questionRun !== questionRunRef.current) return;
      const parts = await Promise.all(questionRegionIds.map(async regionId => {
        const pageGroups = pages.map(page => page.strokes.filter(stroke => stroke.regionId === regionId)).filter(strokes => strokes.length > 0);
        const recognizedPages = await Promise.all(pageGroups.map(strokes => recognizeStrokes(strokes)));
        const recognizedWork = recognizedPages.map(recognized => recognized.text || recognized.latex).filter(Boolean).join('\n');
        return { id: regionId, prompt: promptForRegion(regionId), recognizedWork, hasStudentWork: pageGroups.length > 0 };
      }));
      if (questionRun !== questionRunRef.current) return;
      const result = await gradeTutorPaper({
        questionId: typeof currentQuestion === 'string' ? 'question' : currentQuestion?.id || 'question',
        questionPrompt,
        assisted: hasUsedAiAssistance || correctMeOn,
        answerPackage: answer,
        parts,
      });
      if (questionRun !== questionRunRef.current) return;
      setGradeResult(result);
    } catch (error) {
      if (questionRun === questionRunRef.current) setCorrectMeError(error instanceof Error ? error.message : 'Grading failed.');
    } finally { if (questionRun === questionRunRef.current) setGradeBusy(false); }
  }, [correctMeOn, currentQuestion, ensureAnswerPackage, gradeBusy, hasUsedAiAssistance, pages, promptForRegion, questionPrompt, questionRegionIds, recognizeStrokes]);

  const handleAiMarkClick = useCallback((mark: PaperAiMark) => {
    setActiveAiMark(mark); setAiMarkExplanation(mark.explanation); setAiMarkExplanationBusy(true);
    void explainPaperCorrection({
      questionId: typeof currentQuestion === 'string' ? 'question' : currentQuestion?.id || 'question',
      questionPrompt: promptForRegion(mark.regionId),
      activeStepId: mark.regionId,
      activeStepTitle: promptForRegion(mark.regionId),
      recognizedText: mark.targetText || null,
      message: `Explain why this correction is needed: ${mark.correctionText}`,
    }).then(result => setAiMarkExplanation(result.reply)).catch(() => { /* The concise explanation remains available. */ }).finally(() => setAiMarkExplanationBusy(false));
  }, [currentQuestion, promptForRegion]);

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

  const handleOpenOutput = useCallback(() => {
    captureSnapshots();
    setShowOutputModal(true);
  }, [captureSnapshots]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: '#fff' }}>

      <div className="fsw-workspace-toolbar">
        <div className="fsw-toolbar-left">
          <button type="button" onClick={onClose} className="fsw-toolbar-button">← Back</button>
          <div className="fsw-toolbar-status">
            {questionNavigation && <span>Question {questionNavigation.current} of {questionNavigation.total}</span>}
            {questionNavigation?.saveStatus === 'saving' && <span className="fsw-saving">Saving…</span>}
            {questionNavigation?.saveStatus === 'saved' && <span className="fsw-saved">Saved</span>}
          </div>
        </div>
        <div className="fsw-toolbar-center">
          {(!isTestMode || Boolean(testGrade && showAiSwitch)) && <div className="fsw-correct-control"><button type="button" className={`fsw-ai-switch ${correctMeOn ? 'active' : ''}`} onClick={() => { setCorrectMeOn(open => { const next = !open; if (next) setHasUsedAiAssistance(true); return next; }); }} aria-pressed={correctMeOn}><span>Correct Me</span><span className="fsw-ai-switch-track"><span /></span></button>{correctMeOn && correctMeStatus !== 'idle' && <small className={correctMeStatus === 'error' ? 'error' : ''}>{correctMeStatus === 'reading' ? 'Reading…' : correctMeStatus === 'checking' ? 'Checking…' : correctMeStatus === 'checked' ? 'Checked' : 'Needs attention'}</small>}</div>}
          <button type="button" className={`fsw-toolbar-button ${toolboxOpen ? 'active' : ''}`} onClick={() => setToolboxOpen(open => !open)} aria-expanded={toolboxOpen} title="Drawing toolbox">🧰 Toolbox</button>
          <button type="button" className="fsw-toolbar-button fsw-toolbar-icon-button" onClick={handleUndo} title="Undo" aria-label="Undo" disabled={undoStack.length === 0}>↶</button>
          <button type="button" className="fsw-toolbar-button fsw-toolbar-icon-button" onClick={handleRedo} title="Redo" aria-label="Redo" disabled={redoStack.length === 0}>↷</button>
          {!isTestMode && <button type="button" className="fsw-toolbar-button fsw-grade-button" onClick={() => void handleGradePaper()} disabled={gradeBusy}>{gradeBusy ? 'Grading…' : '📊 Grade'}</button>}
        </div>
        <div className="fsw-toolbar-navigation">
          {questionNavigation && <>
            <button type="button" className="fsw-toolbar-button" onClick={questionNavigation.onPrevious} disabled={!questionNavigation.canPrevious}>‹ Prev</button>
            <button type="button" className="fsw-toolbar-button" onClick={questionNavigation.onNext} disabled={!questionNavigation.canNext}>Next ›</button>
          </>}
        </div>
      </div>

      {/* ═══ SCROLLABLE PAGE CONTAINER ═══ */}
      <div className="fsw-scroll" ref={scrollRef}>
        <div className="fsw-pages-stack">
          {pages.map((page, idx) => (
            <PaperPageCanvas
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
              onMoveStrokes={handleMoveStrokes}
              onAnswerSpaceChange={handleAnswerSpaceChange}
              onAiHelp={(regionId, mode) => void handleAiHelp(regionId, mode)}
              onAiMarkClick={handleAiMarkClick}
              aiHelpBusyRegion={aiHelpBusyRegion}
              disableAiHelp={Boolean(isTestMode && !testGrade)}
              scale={scale}
              testGrade={testGrade}
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

          <button className={`fsw-dock-btn ${activeTool === 'select' ? 'active' : ''}`} onClick={() => setActiveTool('select')} title="Lasso select and move handwriting">◯</button>

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

          {/* Destructive action stays inside the toolbox */}
          <button className="fsw-dock-btn fsw-dock-btn-clear" onClick={handleClearPage} title="Clear Page">🗑️</button>
        </div>

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


      {correctMeError && <div className="fsw-ai-error"><span>{correctMeError}</span><button type="button" onClick={() => setCorrectMeError('')}>×</button></div>}

      {activeAiMark && <div className="fsw-paper-modal-backdrop" onClick={() => setActiveAiMark(null)}><div className="fsw-paper-modal fsw-correction-modal" onClick={event => event.stopPropagation()}>
        <div className="fsw-paper-modal-header"><div><small>Correction</small><strong>{activeAiMark.correctionText}</strong></div><button type="button" onClick={() => setActiveAiMark(null)}>×</button></div>
        <div className="fsw-paper-modal-body">{aiMarkExplanationBusy && <span className="fsw-inline-spinner" />}<LatexRenderer content={aiMarkExplanation || activeAiMark.explanation} /></div>
        <div className="fsw-correction-actions"><button type="button" onClick={() => { setCorrectMeOn(true); setActiveAiMark(null); }}>Check again</button><button type="button" onClick={() => setActiveAiMark(null)}>I’ll correct it</button></div>
      </div></div>}

      {gradeResult && <div className="fsw-paper-modal-backdrop" onClick={() => setGradeResult(null)}><div className="fsw-paper-modal fsw-grade-modal" onClick={event => event.stopPropagation()}>
        <div className="fsw-paper-modal-header"><div><small>{gradeResult.assisted ? 'Assisted paper' : 'Paper grade'}</small><strong>{Math.round(gradeResult.score)} / {Math.round(gradeResult.totalPoints)}</strong></div><button type="button" onClick={() => setGradeResult(null)}>×</button></div>
        <div className="fsw-grade-summary">{gradeResult.feedback}</div>
        <div className="fsw-grade-parts">{gradeResult.parts.map((part, index) => <div key={part.id} className={part.unanswered ? 'unanswered' : ''}><div><strong>Question {index + 1}</strong><span>{Math.round(part.score)} / {Math.round(part.maxPoints)}</span></div><p>{part.unanswered ? 'Question not answered.' : part.feedback}</p></div>)}</div>
      </div></div>}

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
        .fsw-btn-back { margin-right: 12px; }
        .fsw-btn-back:hover { border-color: rgba(239,68,68,0.4); color: #fca5a5; }
        .fsw-btn-done {
          background: linear-gradient(135deg, #10b981, #34d399);
          color: white;
          font-weight: 600;
          border: none;
          padding: 8px 20px;
          border-radius: 10px;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
          margin-left: auto;
        }
        .fsw-btn-done:hover {
          background: linear-gradient(135deg, #059669, #10b981);
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
          transform: translateY(-1px);
        }
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
        .fsw-workspace-toolbar {
          min-height: 54px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: #f8fafc;
          border-bottom: 1px solid #dbe3ee;
          color: #334155;
          flex-shrink: 0;
          z-index: 120;
          box-shadow: 0 2px 10px rgba(15,23,42,0.05);
        }
        .fsw-toolbar-left,
        .fsw-toolbar-center,
        .fsw-toolbar-navigation {
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .fsw-toolbar-left { min-width: 0; justify-content: flex-start; }
        .fsw-toolbar-center { justify-content: center; }
        .fsw-toolbar-navigation { justify-content: flex-end; }
        .fsw-toolbar-status {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }
        .fsw-toolbar-button {
          min-height: 36px;
          padding: 7px 11px;
          border-radius: 9px;
          border: 1px solid #cbd5e1;
          background: #fff;
          color: #334155;
          font-family: inherit;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          transition: 0.16s ease;
          white-space: nowrap;
        }
        .fsw-toolbar-button:hover:not(:disabled), .fsw-toolbar-button.active { border-color: #818cf8; color: #4338ca; background: #eef2ff; }
        .fsw-toolbar-button:disabled { opacity: 0.38; cursor: not-allowed; }
        .fsw-toolbar-icon-button { width: 36px; padding-left: 0; padding-right: 0; font-size: 18px; }
        .fsw-saving { color: #d97706; }
        .fsw-saved { color: #059669; }
        .fsw-ai-switch {
          min-height: 36px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 9px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          background: #fff;
          color: #475569;
          font-family: inherit;
          font-size: 11px;
          font-weight: 800;
          cursor: pointer;
        }
        .fsw-ai-switch.active { color: #6d28d9; border-color: #a78bfa; background: #f5f3ff; }
        .fsw-ai-switch-track { width: 31px; height: 18px; padding: 2px; border-radius: 99px; background: #cbd5e1; transition: 0.2s; }
        .fsw-ai-switch-track > span { display: block; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(15,23,42,.28); transition: transform .2s; }
        .fsw-ai-switch.active .fsw-ai-switch-track { background: #8b5cf6; }
        .fsw-ai-switch.active .fsw-ai-switch-track > span { transform: translateX(13px); }

        .fsw-scroll {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          background: #ffffff;
          display: flex;
          justify-content: center;
          padding: 0;
          overscroll-behavior: none;
        }
        
        .fsw-static-question {
          position: absolute;
          top: 10px;
          left: 20px;
          right: 20px;
          background: #ffffff;
          border-left: 4px solid #6366f1;
          border-radius: 0 10px 10px 0;
          padding: 14px 18px;
          font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 18px;
          color: #172033;
          line-height: 1.65;
          box-shadow: 0 4px 18px rgba(15,23,42,.07);
          z-index: 1;
          pointer-events: none;
        }

        .fsw-pages-stack {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          padding: 0 0 80px;
        }

        .fsw-question-content { display: flex; flex-direction: column; gap: 3px; letter-spacing: .002em; }
        .fsw-question-line { min-height: 1.65em; white-space: pre-wrap; overflow-wrap: anywhere; }
        .fsw-question-line.blank { min-height: .8em; }
        .fsw-question-content strong { font-weight: 850; color: #111827; }
        .fsw-question-content u { text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-color: #6366f1; }

        /* ── A4 Page ── */
        .fsw-page {
          position: relative;
          background: #ffffff;
          border-radius: 0;
          box-shadow: none;
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
          margin-left: 0;
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
          top: 58px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 130;
        }
        .fsw-dock {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          background: rgba(255,255,255,0.98);
          backdrop-filter: blur(24px) saturate(1.2);
          border: 1px solid #dbe3ee;
          border-radius: 16px;
          box-shadow: 0 14px 38px rgba(15,23,42,0.18);
          opacity: 0;
          transform: translateY(-8px) scale(0.96);
          pointer-events: none;
          transition: all 0.28s cubic-bezier(0.34,1.56,0.64,1);
        }
        .fsw-toolbox.open .fsw-dock {
          opacity: 1;
          transform: translateY(0) scale(1);
          pointer-events: auto;
        }
        /* Dock buttons */
        .fsw-dock-btn {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          color: #475569;
          font-size: 16px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .fsw-dock-btn:hover {
          background: #f1f5f9;
          color: #0f172a;
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
          background: #e2e8f0;
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
          background: #ffffff;
          border: 1px solid #dbe3ee;
          box-shadow: 0 8px 24px rgba(15,23,42,.14);
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
          border-color: #0f172a;
          box-shadow: 0 0 0 2px rgba(255,255,255,.9), 0 0 0 3px rgba(15,23,42,.25);
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
        .fsw-correct-control { display: flex; align-items: center; gap: 6px; }
        .fsw-correct-control small { color: #64748b; font-size: 9px; font-weight: 800; white-space: nowrap; }
        .fsw-correct-control small.error { color: #dc2626; }
        .fsw-grade-button { border-color: #86efac; color: #047857; background: #ecfdf5; }
        .fsw-question-sheet { position: absolute; top: 10px; left: 20px; right: 20px; z-index: 4; pointer-events: none; color: #172033; font-family: Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
        .fsw-question-context { padding: 14px 18px; margin-bottom: 15px; border-left: 4px solid #6366f1; border-radius: 0 10px 10px 0; background: #fff; box-shadow: 0 4px 18px rgba(15,23,42,.07); font-size: 18px; line-height: 1.6; }
        .fsw-question-context p, .fsw-question-part-prompt p, .fsw-ai-paper-block p { margin: 0; }
        .fsw-question-part { position: relative; }
        .fsw-question-part-header { position: relative; min-height: 48px; display: flex; align-items: flex-start; gap: 9px; padding: 11px 12px; border: 1px solid #dbe3ee; border-left: 4px solid #818cf8; border-radius: 0 10px 10px 0; background: rgba(255,255,255,.98); box-shadow: 0 3px 12px rgba(15,23,42,.06); font-size: 16px; line-height: 1.55; }
        .fsw-question-part-label { color: #4f46e5; font-weight: 900; flex-shrink: 0; }
        .fsw-question-part-prompt { flex: 1; min-width: 0; padding-right: 210px; }
        .fsw-question-actions { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 5px; pointer-events: auto; }
        .fsw-question-action, .fsw-question-nudge { min-height: 30px; border: 1px solid #c7d2fe; border-radius: 8px; background: #eef2ff; color: #4338ca; font: 800 10px/1 Inter,sans-serif; cursor: pointer; }
        .fsw-question-action { padding: 6px 9px; }
        .fsw-question-nudge { width: 30px; padding: 0; font-size: 15px; }
        .fsw-question-action:disabled, .fsw-question-nudge:disabled { opacity: .4; cursor: not-allowed; }
        .fsw-ai-help-menu { position: absolute; top: 36px; right: 64px; width: 235px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 11px; background: #fff; box-shadow: 0 14px 35px rgba(15,23,42,.2); z-index: 30; }
        .fsw-ai-help-menu button { width: 100%; padding: 9px 10px; border: 0; border-radius: 7px; background: transparent; color: #334155; text-align: left; font: 750 11px/1.35 Inter,sans-serif; cursor: pointer; }
        .fsw-ai-help-menu button:hover:not(:disabled) { background: #eef2ff; color: #4338ca; }
        .fsw-ai-help-menu button:disabled { color: #94a3b8; cursor: not-allowed; }
        .fsw-answer-region { position: relative; transition: height .22s ease; }
        .fsw-ai-paper-block { position: absolute; left: 18px; right: 18px; display: flex; align-items: flex-start; gap: 9px; padding: 10px 12px; border: 1px solid #bfdbfe; border-radius: 10px; background: rgba(239,246,255,.96); color: #1e3a8a; box-shadow: 0 3px 12px rgba(37,99,235,.08); pointer-events: none; }
        .fsw-ai-paper-block > span { padding: 3px 5px; border-radius: 5px; background: #2563eb; color: #fff; font-size: 8px; font-weight: 900; }
        .fsw-ai-paper-block strong { font-size: 13px; }
        .fsw-ai-paper-body { margin-top: 6px; color: #334155; font-size: 12px; line-height: 1.55; }
        .fsw-test-grade { margin: 8px 12px; color: #dc2626; font-size: 14px; font-weight: 800; }
        .fsw-selection-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 6; overflow: visible; }
        .fsw-ai-mark { position: absolute; z-index: 8; padding: 0; border: 3px solid #ef4444; border-radius: 50%; background: rgba(254,226,226,.12); cursor: pointer; pointer-events: auto; }
        .fsw-ai-mark.highlight { border-radius: 6px; border-width: 0 0 3px; background: rgba(248,113,113,.2); }
        .fsw-ai-mark.note { border-style: dashed; border-radius: 8px; }
        .fsw-ai-mark > span { position: absolute; left: 50%; bottom: calc(100% + 5px); transform: translateX(-50%); width: max-content; max-width: 260px; padding: 5px 8px; border-radius: 7px; background: #fff; border: 1px solid #fecaca; color: #dc2626; box-shadow: 0 4px 14px rgba(127,29,29,.14); font: 850 11px/1.25 Inter,sans-serif; white-space: normal; }
        .fsw-ai-error { position: fixed; left: 50%; top: 68px; transform: translateX(-50%); z-index: 700; max-width: min(620px,90vw); display: flex; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid #fecaca; border-radius: 10px; background: #fff1f2; color: #be123c; box-shadow: 0 10px 30px rgba(15,23,42,.16); font-size: 11px; font-weight: 700; }
        .fsw-ai-error button { border: 0; background: transparent; color: inherit; font-size: 18px; cursor: pointer; }
        .fsw-paper-modal-backdrop { position: fixed; inset: 0; z-index: 900; display: grid; place-items: center; padding: 18px; background: rgba(15,23,42,.38); backdrop-filter: blur(4px); }
        .fsw-paper-modal { width: min(620px,96vw); max-height: 84vh; overflow: auto; border: 1px solid #dbe3ee; border-radius: 18px; background: #fff; color: #172033; box-shadow: 0 28px 80px rgba(15,23,42,.28); }
        .fsw-paper-modal-header { display: flex; align-items: center; gap: 14px; padding: 15px 18px; border-bottom: 1px solid #e2e8f0; }
        .fsw-paper-modal-header > div { flex: 1; display: flex; flex-direction: column; gap: 3px; }
        .fsw-paper-modal-header small { color: #64748b; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
        .fsw-paper-modal-header strong { color: #0f172a; font-size: 20px; }
        .fsw-paper-modal-header > button { width: 32px; height: 32px; border: 1px solid #cbd5e1; border-radius: 50%; background: #fff; color: #64748b; cursor: pointer; font-size: 18px; }
        .fsw-paper-modal-body, .fsw-grade-summary { padding: 18px; color: #334155; font-size: 14px; line-height: 1.7; }
        .fsw-correction-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 0 18px 18px; }
        .fsw-correction-actions button { padding: 8px 11px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #334155; font-weight: 800; cursor: pointer; }
        .fsw-grade-parts { display: grid; gap: 9px; padding: 0 18px 18px; }
        .fsw-grade-parts > div { padding: 11px 12px; border: 1px solid #dbe3ee; border-radius: 10px; background: #f8fafc; }
        .fsw-grade-parts > div.unanswered { border-color: #fecaca; background: #fff1f2; }
        .fsw-grade-parts > div > div { display: flex; justify-content: space-between; color: #0f172a; }
        .fsw-grade-parts p { margin: 6px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
        .fsw-inline-spinner { display: inline-block; width: 14px; height: 14px; margin-right: 8px; border: 2px solid #c7d2fe; border-top-color: #4f46e5; border-radius: 50%; animation: fsw-spin .7s linear infinite; }
        @media (max-width: 760px) {
          .fsw-workspace-toolbar {
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas: "left navigation" "center center";
            gap: 6px;
            padding: 7px 8px;
          }
          .fsw-toolbar-left { grid-area: left; }
          .fsw-toolbar-center { grid-area: center; }
          .fsw-toolbar-navigation { grid-area: navigation; }
          .fsw-toolbar-status { min-height: 20px; }
          .fsw-toolbar-button, .fsw-ai-switch { padding: 6px 8px; }
          .fsw-ai-switch > span:first-child { display: none; }
          .fsw-toolbox { top: 94px; max-width: calc(100vw - 16px); }
          .fsw-dock { max-width: calc(100vw - 16px); overflow-x: auto; padding: 7px 9px; }
          .fsw-static-question { left: 12px; right: 12px; padding: 12px 14px; font-size: 16px; }
          .fsw-question-sheet { left: 10px; right: 10px; }
          .fsw-question-context { padding: 11px 13px; font-size: 15px; }
          .fsw-question-part-header { padding: 48px 10px 10px; font-size: 14px; }
          .fsw-question-part-prompt { padding-right: 0; }
          .fsw-question-actions { top: 8px; left: 10px; right: auto; }
          .fsw-ai-help-menu { left: 0; right: auto; width: min(235px, calc(100vw - 48px)); }
        }
      `}</style>
    </div>
  );
}
