import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LatexMarkdown from '@/components/ui/LatexMarkdown';
import type { PersonalProgramQuestion } from '@/lib/personalProgramService';
import type { PaperHelpMode } from '@/lib/paperTutorService';
import type { PageData, PaperAiMark, Stroke, StrokePoint, TextAnnotation } from '@/components/FullScreenWorkspace';
import { buildPaperQuestionShape } from '@/lib/paperQuestionParts';

const PAGE_W = 794;
const PAGE_H = 1123;
const PAGE_GAP = 48;
const ERASER_RADIUS = 14;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 25;

type EraserMode = 'pixel' | 'stroke';

type Props = {
  page: PageData;
  pageIndex: number;
  currentQuestion?: PersonalProgramQuestion | string;
  activeTool: 'pen' | 'eraser' | 'select';
  eraserMode: EraserMode;
  strokeColor: string;
  strokeWidth: number;
  scale: number;
  testGrade?: string;
  onStrokeAdd: (pageId: string, stroke: Stroke) => void;
  onStrokeRemove: (pageId: string, strokeId: string) => void;
  onAnnotationAdd: (pageId: string, annotation: TextAnnotation) => void;
  onAnnotationUpdate: (pageId: string, annotationId: string, text: string) => void;
  onMoveStrokes: (pageId: string, strokeIds: string[], dx: number, dy: number) => void;
  onAnswerSpaceChange: (pageId: string, regionId: string, delta: number) => void;
  onAiHelp: (regionId: string, mode: PaperHelpMode) => void;
  onAiMarkClick: (mark: PaperAiMark) => void;
  aiHelpBusyRegion: string | null;
  disableAiHelp: boolean;
};

function id(): string {
  return `paper-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function distanceSquared(a: StrokePoint, b: StrokePoint): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function strokeBounds(strokes: Stroke[]): { left: number; top: number; right: number; bottom: number } | null {
  if (strokes.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  strokes.forEach(stroke => stroke.points.forEach(point => {
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }));
  return Number.isFinite(left) ? { left, top, right, bottom } : null;
}

function insidePolygon(point: StrokePoint, polygon: StrokePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 0.0001) + a.x) inside = !inside;
  }
  return inside;
}

function renderStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  if (stroke.points.length < 2) return;
  context.save();
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  stroke.points.slice(1).forEach(point => context.lineTo(point.x, point.y));
  context.stroke();
  context.restore();
}

function renderAll(canvas: HTMLCanvasElement, strokes: Stroke[]): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach(stroke => renderStroke(context, stroke));
}

export default memo(function PaperPageCanvas(props: Props) {
  const {
    page, pageIndex, currentQuestion, activeTool, eraserMode, strokeColor, strokeWidth, scale, testGrade,
    onStrokeAdd, onStrokeRemove, onAnnotationAdd, onAnnotationUpdate, onMoveStrokes,
    onAnswerSpaceChange, onAiHelp, onAiMarkClick, aiHelpBusyRegion, disableAiHelp,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const regionElements = useRef(new Map<string, HTMLDivElement>());
  const activePoints = useRef<StrokePoint[]>([]);
  const activeRegion = useRef<string | null>(null);
  const drawing = useRef(false);
  const lastTap = useRef<{ time: number; point: StrokePoint }>({ time: 0, point: { x: 0, y: 0, pressure: .5 } });
  const dragStart = useRef<{ point: StrokePoint; regionId: string } | null>(null);
  const erasedThisGesture = useRef(new Set<string>());
  const [editingAnnotation, setEditingAnnotation] = useState<string | null>(null);
  const [helpMenu, setHelpMenu] = useState<string | null>(null);
  const [lasso, setLasso] = useState<StrokePoint[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const shape = useMemo(() => buildPaperQuestionShape(currentQuestion), [currentQuestion]);
  const defaultAnswerHeight = shape.parts.length === 1 ? 900 : 260;
  const heights = page.answerRegionHeights ?? {};
  const pageHeight = pageIndex === 0 && currentQuestion
    ? Math.max(PAGE_H, 170 + shape.parts.reduce((sum, part) => sum + (heights[part.id] ?? defaultAnswerHeight) + 78, 0))
    : PAGE_H;

  useEffect(() => { if (canvasRef.current) renderAll(canvasRef.current, page.strokes); }, [page.strokes, pageHeight]);
  useEffect(() => { if (activeTool !== 'select') { setSelection([]); setLasso([]); } }, [activeTool]);

  const pointFromEvent = useCallback((event: React.PointerEvent): StrokePoint => {
    const bounds = canvasRef.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / scale, y: (event.clientY - bounds.top) / scale, pressure: event.pressure || .5 };
  }, [scale]);

  const regionAt = useCallback((clientX: number, clientY: number): string | null => {
    if (!currentQuestion) return `page:${page.id}`;
    // Continuation sheets belong to the final answer region, so their work is
    // included in live correction and whole-question grading.
    if (pageIndex !== 0) return shape.parts[shape.parts.length - 1]?.id ?? `page:${page.id}`;
    for (const [regionId, element] of regionElements.current) {
      const bounds = element.getBoundingClientRect();
      if (clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom) return regionId;
    }
    return null;
  }, [currentQuestion, page.id, pageIndex, shape.parts]);

  const regionBounds = useCallback((regionId: string) => {
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    const bounds = regionElements.current.get(regionId)?.getBoundingClientRect();
    if (!canvasBounds || !bounds) return { left: 0, top: 0, right: PAGE_W, bottom: pageHeight };
    return { left: (bounds.left - canvasBounds.left) / scale, top: (bounds.top - canvasBounds.top) / scale, right: (bounds.right - canvasBounds.left) / scale, bottom: (bounds.bottom - canvasBounds.top) / scale };
  }, [pageHeight, scale]);

  const eraseAt = useCallback((point: StrokePoint, regionId: string) => {
    // Canvas-only erasing reappears after autosave/re-render. Keep both eraser
    // modes tied to persisted stroke data; pixel mode uses the smaller hit area.
    const radiusScale = eraserMode === 'stroke' ? 1.35 : 0.72;
    page.strokes
      .filter(stroke => !stroke.regionId || stroke.regionId === regionId)
      .forEach(stroke => {
        if (stroke.points.some(candidate => distanceSquared(point, candidate) <= (ERASER_RADIUS * radiusScale) ** 2)) {
          if (erasedThisGesture.current.has(stroke.id)) return;
          erasedThisGesture.current.add(stroke.id);
          onStrokeRemove(page.id, stroke.id);
        }
      });
  }, [eraserMode, onStrokeRemove, page.id, page.strokes]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    const regionId = regionAt(event.clientX, event.clientY);
    if (!regionId) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activeRegion.current = regionId;
    drawing.current = true;
    if (activeTool === 'eraser') erasedThisGesture.current.clear();

    if (activeTool === 'select') {
      const selected = page.strokes.filter(stroke => selection.includes(stroke.id));
      const bounds = strokeBounds(selected);
      const insideExisting = bounds && point.x >= bounds.left - 12 && point.x <= bounds.right + 12 && point.y >= bounds.top - 12 && point.y <= bounds.bottom + 12;
      if (insideExisting && selected.every(stroke => !stroke.regionId || stroke.regionId === regionId)) {
        dragStart.current = { point, regionId };
        setDragOffset({ x: 0, y: 0 });
      } else {
        dragStart.current = null; setSelection([]); setLasso([point]);
      }
      return;
    }

    if (activeTool === 'eraser') { eraseAt(point, regionId); return; }
    const now = Date.now();
    if (now - lastTap.current.time < DOUBLE_TAP_MS && Math.sqrt(distanceSquared(point, lastTap.current.point)) < DOUBLE_TAP_PX) {
      lastTap.current.time = 0;
      const annotation = { id: id(), x: point.x, y: point.y, text: '', width: 200, height: 32, regionId };
      onAnnotationAdd(page.id, annotation); setEditingAnnotation(annotation.id); drawing.current = false; return;
    }
    lastTap.current = { time: now, point };
    activePoints.current = [point];
  }, [activeTool, eraseAt, onAnnotationAdd, page.id, page.strokes, pointFromEvent, regionAt, selection]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const point = pointFromEvent(event);
    const regionId = regionAt(event.clientX, event.clientY);
    if (activeTool === 'select') {
      if (dragStart.current) {
        const selected = page.strokes.filter(stroke => selection.includes(stroke.id));
        const bounds = strokeBounds(selected); if (!bounds) return;
        const allowed = regionBounds(dragStart.current.regionId);
        const rawX = point.x - dragStart.current.point.x; const rawY = point.y - dragStart.current.point.y;
        const dx = Math.max(allowed.left - bounds.left, Math.min(allowed.right - bounds.right, rawX));
        const dy = Math.max(allowed.top - bounds.top, Math.min(allowed.bottom - bounds.bottom, rawY));
        setDragOffset({ x: dx, y: dy });
        const preview = page.strokes.map(stroke => selection.includes(stroke.id) ? { ...stroke, points: stroke.points.map(candidate => ({ ...candidate, x: candidate.x + dx, y: candidate.y + dy })) } : stroke);
        if (canvasRef.current) renderAll(canvasRef.current, preview);
      } else if (regionId === activeRegion.current) setLasso(previous => [...previous, point]);
      return;
    }
    if (!regionId || regionId !== activeRegion.current) {
      if (activeTool === 'pen' && activePoints.current.length >= 2) onStrokeAdd(page.id, { id: id(), points: [...activePoints.current], color: strokeColor, width: strokeWidth, regionId: activeRegion.current || undefined });
      activePoints.current = []; drawing.current = false; return;
    }
    if (activeTool === 'eraser') { eraseAt(point, regionId); return; }
    activePoints.current.push(point);
    const context = canvasRef.current?.getContext('2d');
    const previous = activePoints.current[activePoints.current.length - 2];
    if (context && previous) { context.save(); context.strokeStyle = strokeColor; context.lineWidth = strokeWidth; context.lineCap = 'round'; context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(point.x, point.y); context.stroke(); context.restore(); }
  }, [activeTool, eraseAt, onStrokeAdd, page.id, page.strokes, pointFromEvent, regionAt, regionBounds, selection, strokeColor, strokeWidth]);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drawing.current) return;
    drawing.current = false;
    if (activeTool === 'select') {
      if (dragStart.current && (Math.abs(dragOffset.x) > .5 || Math.abs(dragOffset.y) > .5)) onMoveStrokes(page.id, selection, dragOffset.x, dragOffset.y);
      else if (!dragStart.current && lasso.length >= 3) {
        const regionId = activeRegion.current;
        setSelection(page.strokes.filter(stroke => {
          if (stroke.regionId && regionId && stroke.regionId !== regionId) return false;
          const bounds = strokeBounds([stroke]);
          return !!bounds && insidePolygon({ x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2, pressure: .5 }, lasso);
        }).map(stroke => stroke.id));
      }
      dragStart.current = null; setLasso([]); setDragOffset({ x: 0, y: 0 });
      if (canvasRef.current) renderAll(canvasRef.current, page.strokes);
      return;
    }
    if (activeTool === 'pen' && activePoints.current.length >= 2) onStrokeAdd(page.id, { id: id(), points: [...activePoints.current], color: strokeColor, width: strokeWidth, regionId: activeRegion.current || undefined });
    activePoints.current = [];
    erasedThisGesture.current.clear();
  }, [activeTool, dragOffset, lasso, onMoveStrokes, onStrokeAdd, page.id, page.strokes, selection, strokeColor, strokeWidth]);

  const selectedBounds = strokeBounds(page.strokes.filter(stroke => selection.includes(stroke.id)));

  return <div className="fsw-page" data-page-index={pageIndex} style={{ width: PAGE_W, height: pageHeight, transform: `scale(${scale})`, transformOrigin: 'top center', marginBottom: PAGE_GAP * scale }}>
    <div className="fsw-page-lines" />
    {pageIndex === 0 && currentQuestion && <div className="fsw-question-sheet">
      {shape.context && <div className="fsw-question-context"><LatexMarkdown content={shape.context} /></div>}
      {shape.parts.map((part, index) => {
        const answerHeight = heights[part.id] ?? defaultAnswerHeight;
        const studentStrokes = page.strokes.filter(stroke => stroke.regionId === part.id);
        const aiBlocks = (page.aiBlocks ?? []).filter(block => block.regionId === part.id);
        const liveBounds = regionElements.current.get(part.id) ? regionBounds(part.id) : null;
        const lastInk = strokeBounds(studentStrokes)?.bottom ?? 0;
        const canShrink = !liveBounds || lastInk < liveBounds.bottom - 100;
        return <div className="fsw-question-part" key={part.id}>
          <div className="fsw-question-part-header">
            {part.label && <span className="fsw-question-part-label">{part.label}</span>}
            <div className="fsw-question-part-prompt"><LatexMarkdown content={part.prompt} /></div>
            {!disableAiHelp && <div className="fsw-question-actions">
              <button className="fsw-question-action" type="button" disabled={aiHelpBusyRegion === part.id} onClick={() => setHelpMenu(helpMenu === part.id ? null : part.id)}>{aiHelpBusyRegion === part.id ? 'AI…' : '✨ AI Help'}</button>
              {helpMenu === part.id && <div className="fsw-ai-help-menu">
                <button disabled={studentStrokes.length > 0} onClick={() => { setHelpMenu(null); onAiHelp(part.id, 'steps'); }}>AI Steps{studentStrokes.length ? ' · unavailable after starting' : ''}</button>
                <button onClick={() => { setHelpMenu(null); onAiHelp(part.id, 'next_step'); }}>Next Step Only</button>
                <button onClick={() => { setHelpMenu(null); onAiHelp(part.id, 'solve'); }}>Solve Completely</button>
              </div>}
              <button className="fsw-question-nudge" type="button" title="Reduce unused answer space" disabled={!canShrink} onClick={() => onAnswerSpaceChange(page.id, part.id, -80)}>↑</button>
              <button className="fsw-question-nudge" type="button" title="Add answer space" onClick={() => onAnswerSpaceChange(page.id, part.id, 80)}>↓</button>
            </div>}
          </div>
          <div className="fsw-answer-region" data-answer-region={part.id} ref={element => { if (element) regionElements.current.set(part.id, element); else regionElements.current.delete(part.id); }} style={{ height: answerHeight }}>
            {aiBlocks.map(block => <div className="fsw-ai-paper-block" key={block.id} style={{ top: block.y }}><span>AI</span><div><strong><LatexMarkdown content={block.title} /></strong>{block.body && <div className="fsw-ai-paper-body"><LatexMarkdown content={block.body} /></div>}</div></div>)}
          </div>
          {index === shape.parts.length - 1 && testGrade && <div className="fsw-test-grade">{testGrade}</div>}
        </div>;
      })}
    </div>}
    <canvas ref={canvasRef} width={PAGE_W} height={pageHeight} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: activeTool === 'eraser' ? 'cell' : activeTool === 'select' ? 'default' : 'crosshair', zIndex: 2 }} />
    {(page.aiMarks ?? []).map(mark => <button key={mark.id} type="button" className={`fsw-ai-mark ${mark.type}`} onClick={() => onAiMarkClick(mark)} style={{ left: mark.x, top: mark.y, width: mark.width, height: mark.height }}><span>{mark.correctionText}</span></button>)}
    {(lasso.length > 1 || selectedBounds) && <svg className="fsw-selection-layer" viewBox={`0 0 ${PAGE_W} ${pageHeight}`}>
      {lasso.length > 1 && <polyline points={lasso.map(point => `${point.x},${point.y}`).join(' ')} fill="rgba(79,70,229,.06)" stroke="#4f46e5" strokeWidth="2" strokeDasharray="7 5" />}
      {selectedBounds && <rect x={selectedBounds.left + dragOffset.x - 8} y={selectedBounds.top + dragOffset.y - 8} width={selectedBounds.right - selectedBounds.left + 16} height={selectedBounds.bottom - selectedBounds.top + 16} rx="8" fill="rgba(79,70,229,.05)" stroke="#4f46e5" strokeWidth="2" strokeDasharray="7 5" />}
    </svg>}
    {page.annotations.map(annotation => <div className="fsw-annotation" key={annotation.id} style={{ left: annotation.x, top: annotation.y, zIndex: 3 }}>
      {editingAnnotation === annotation.id ? <textarea autoFocus defaultValue={annotation.text} className="fsw-annotation-input" onBlur={event => { onAnnotationUpdate(page.id, annotation.id, event.currentTarget.value.trim()); setEditingAnnotation(null); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); (event.target as HTMLTextAreaElement).blur(); } }} />
        : <div className="fsw-annotation-display" onDoubleClick={() => setEditingAnnotation(annotation.id)}>{annotation.text || <span style={{ opacity: .4, fontStyle: 'italic' }}>Type here…</span>}</div>}
    </div>)}
    <div className="fsw-page-number">{pageIndex + 1}</div>
  </div>;
});
