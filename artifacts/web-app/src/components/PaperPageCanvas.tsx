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

type EraserMode = 'pixel' | 'stroke';

type Props = {
  page: PageData;
  pageIndex: number;
  currentQuestion?: PersonalProgramQuestion | string;
  activeTool: 'pen' | 'eraser' | 'select' | 'text' | 'pan';
  eraserMode: EraserMode;
  strokeColor: string;
  strokeWidth: number;
  scale: number;
  viewportW: number;
  testGrade?: string;
  onStrokeAdd: (pageId: string, stroke: Stroke) => void;
  onStrokeRemove: (pageId: string, strokeId: string) => void;
  onAnnotationAdd: (pageId: string, annotation: TextAnnotation) => void;
  onAnnotationUpdate: (pageId: string, annotationId: string, text: string) => void;
  onMoveStrokes: (pageId: string, strokeIds: string[], dx: number, dy: number) => void;
  onQuestionMove: (pageId: string, regionId: string, delta: number) => void;
  onWritingProgress: (pageId: string, regionId: string, bottom: number) => void;
  onAiHelp: (regionId: string, mode: PaperHelpMode) => void;
  onAiBlockClose: (pageId: string, blockId: string) => void;
  onAskQuestion: (regionId: string) => void;
  onAiMarkClick: (mark: PaperAiMark) => void;
  aiHelpBusyRegion: string | null;
  disableAiHelp: boolean;
  showAiContent: boolean;
  isPanning?: boolean;
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
  context.globalCompositeOperation = stroke.isEraser ? 'destination-out' : 'source-over';
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

function normalizeTutorMath(content: string): string {
  return content
    .replace(/\$([^$]+)\$/g, (_match, math: string) => `$${math.replace(/\s*\*\s*/g, ' \\times ')}$`)
    .replace(/([\p{L}\p{N})])\s*\*\s*(?=[\p{L}\p{N}(])/gu, '$1 × ');
}

export default memo(function PaperPageCanvas(props: Props) {
  const {
    page, pageIndex, currentQuestion, activeTool, eraserMode, strokeColor, strokeWidth, scale, viewportW, testGrade,
    onStrokeAdd, onStrokeRemove, onAnnotationAdd, onAnnotationUpdate, onMoveStrokes,
    onQuestionMove, onWritingProgress, onAiHelp, onAiBlockClose, onAskQuestion, onAiMarkClick, 
    aiHelpBusyRegion, disableAiHelp, showAiContent, isPanning
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const regionElements = useRef(new Map<string, HTMLDivElement>());
  const activePoints = useRef<StrokePoint[]>([]);
  const activeRegion = useRef<string | null>(null);
  const drawing = useRef(false);
  const dragStart = useRef<{ point: StrokePoint; regionId: string } | null>(null);
  const erasedThisGesture = useRef(new Set<string>());
  const [editingAnnotation, setEditingAnnotation] = useState<string | null>(null);
  const [helpMenu, setHelpMenu] = useState<string | null>(null);
  const [lasso, setLasso] = useState<StrokePoint[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!helpMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.fsw-ai-help-menu') && !target.closest('.fsw-question-action')) {
        setHelpMenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [helpMenu]);

  const shape = useMemo(() => buildPaperQuestionShape(currentQuestion), [currentQuestion]);
  const pageWidth = Math.max(viewportW, page.width ?? viewportW);
  const defaultAnswerHeight = shape.parts.length === 1 ? 900 : 260;
  const heights = page.answerRegionHeights ?? {};
  const questionTopOffset = page.questionTopOffset ?? 0;
  const pageHeight = pageIndex === 0 && currentQuestion
    ? Math.max(PAGE_H, 170 + questionTopOffset + shape.parts.reduce((sum, part) => sum + (heights[part.id] ?? defaultAnswerHeight) + 78, 0))
    : PAGE_H;
  const questionSheetRef = useRef<HTMLDivElement>(null);
  const [measuredSheetHeight, setMeasuredSheetHeight] = useState(0);
  const resolvedPageHeight = Math.max(pageHeight, measuredSheetHeight + 42);

  useEffect(() => {
    const sheet = questionSheetRef.current;
    if (!sheet || typeof ResizeObserver === 'undefined') return;
    const update = () => setMeasuredSheetHeight(sheet.scrollHeight + sheet.offsetTop);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [currentQuestion, page.answerRegionHeights, questionTopOffset]);

  useEffect(() => { if (canvasRef.current) renderAll(canvasRef.current, page.strokes); }, [page.strokes, pageWidth, resolvedPageHeight]);
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
    
    let closestRegionId = shape.parts[0]?.id ?? `page:${page.id}`;
    for (const part of shape.parts) {
      const element = regionElements.current.get(part.id);
      if (!element) continue;
      const bounds = element.getBoundingClientRect();
      if (clientY >= bounds.top && clientY <= bounds.bottom) return part.id;
      if (clientY > bounds.bottom) closestRegionId = part.id;
    }
    return closestRegionId;
  }, [currentQuestion, page.id, pageIndex, shape.parts]);

  const regionBounds = useCallback((regionId: string) => {
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    const bounds = regionElements.current.get(regionId)?.getBoundingClientRect();
    if (!canvasBounds || !bounds) return { left: 0, top: 0, right: pageWidth, bottom: resolvedPageHeight };
    return { left: (bounds.left - canvasBounds.left) / scale, top: (bounds.top - canvasBounds.top) / scale, right: (bounds.right - canvasBounds.left) / scale, bottom: (bounds.bottom - canvasBounds.top) / scale };
  }, [pageWidth, resolvedPageHeight, scale]);

  const pointIsProtected = useCallback((clientX: number, clientY: number): boolean => {
    const pageElement = canvasRef.current?.closest('.fsw-page');
    if (!pageElement) return false;
    return [...pageElement.querySelectorAll<HTMLElement>('[data-paper-protected="true"]')].some(element => {
      const bounds = element.getBoundingClientRect();
      return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom;
    });
  }, []);

  const selectionHitsProtected = useCallback((bounds: NonNullable<ReturnType<typeof strokeBounds>>, dx: number, dy: number): boolean => {
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    const pageElement = canvasRef.current?.closest('.fsw-page');
    if (!canvasBounds || !pageElement) return false;
    const candidate = { left: bounds.left + dx, top: bounds.top + dy, right: bounds.right + dx, bottom: bounds.bottom + dy };
    return [...pageElement.querySelectorAll<HTMLElement>('[data-paper-protected="true"]')].some(element => {
      const rect = element.getBoundingClientRect();
      const protectedBox = {
        left: (rect.left - canvasBounds.left) / scale,
        top: (rect.top - canvasBounds.top) / scale,
        right: (rect.right - canvasBounds.left) / scale,
        bottom: (rect.bottom - canvasBounds.top) / scale,
      };
      return candidate.left < protectedBox.right && candidate.right > protectedBox.left && candidate.top < protectedBox.bottom && candidate.bottom > protectedBox.top;
    });
  }, [scale]);

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
    if (event.button !== 0 || activeTool === 'pan') return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const regionId = regionAt(event.clientX, event.clientY);
    if (!regionId || pointIsProtected(event.clientX, event.clientY)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activeRegion.current = regionId;
    drawing.current = true;
    if (activeTool === 'eraser') erasedThisGesture.current.clear();

    if (activeTool === 'text') {
      const annotation = { id: id(), x: point.x, y: point.y, text: '', width: 220, height: 42, regionId };
      onAnnotationAdd(page.id, annotation);
      onWritingProgress(page.id, regionId, point.y + annotation.height - regionBounds(regionId).top);
      setEditingAnnotation(annotation.id);
      drawing.current = false;
      return;
    }

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

    if (activeTool === 'eraser') {
      if (eraserMode === 'stroke') { eraseAt(point, regionId); return; }
      erasedThisGesture.current.clear();
    }
    activePoints.current = [point];
  }, [activeTool, eraseAt, onAnnotationAdd, onWritingProgress, page.id, page.strokes, pointFromEvent, pointIsProtected, regionAt, regionBounds, selection]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const point = pointFromEvent(event);
    const regionId = regionAt(event.clientX, event.clientY);
    if (activeTool === 'select') {
      if (dragStart.current) {
        const selected = page.strokes.filter(stroke => selection.includes(stroke.id));
        const bounds = strokeBounds(selected); if (!bounds) return;
        const rawX = point.x - dragStart.current.point.x; const rawY = point.y - dragStart.current.point.y;
        const dx = Math.max(-bounds.left, Math.min(pageWidth - bounds.right, rawX));
        const dy = Math.max(-bounds.top, Math.min(resolvedPageHeight - bounds.bottom, rawY));
        if (selectionHitsProtected(bounds, dx, dy)) return;
        setDragOffset({ x: dx, y: dy });
        const preview = page.strokes.map(stroke => selection.includes(stroke.id) ? { ...stroke, points: stroke.points.map(candidate => ({ ...candidate, x: candidate.x + dx, y: candidate.y + dy })) } : stroke);
        if (canvasRef.current) renderAll(canvasRef.current, preview);
      } else if (regionId === activeRegion.current) setLasso(previous => [...previous, point]);
      return;
    }
    if (pointIsProtected(event.clientX, event.clientY)) {
      if ((activeTool === 'pen' || activeTool === 'eraser') && activePoints.current.length >= 2) {
        const isEraser = activeTool === 'eraser';
        const stroke: Stroke = { id: id(), points: [...activePoints.current], color: strokeColor, width: isEraser ? ERASER_RADIUS * 2 : strokeWidth, regionId: activeRegion.current || undefined, isEraser };
        onStrokeAdd(page.id, stroke);
        if (activeRegion.current && !isEraser) onWritingProgress(page.id, activeRegion.current, Math.max(...stroke.points.map(candidate => candidate.y)) - regionBounds(activeRegion.current).top);
      }
      activePoints.current = [];
      drawing.current = false;
      return;
    }
    if (!regionId || regionId !== activeRegion.current) {
      if ((activeTool === 'pen' || activeTool === 'eraser') && activePoints.current.length >= 2) {
        const isEraser = activeTool === 'eraser';
        const stroke: Stroke = { id: id(), points: [...activePoints.current], color: strokeColor, width: isEraser ? ERASER_RADIUS * 2 : strokeWidth, regionId: activeRegion.current || undefined, isEraser };
        onStrokeAdd(page.id, stroke);
        if (activeRegion.current && !isEraser) onWritingProgress(page.id, activeRegion.current, Math.max(...stroke.points.map(candidate => candidate.y)) - regionBounds(activeRegion.current).top);
      }
      activePoints.current = []; drawing.current = false; return;
    }
    if (activeTool === 'eraser' && eraserMode === 'stroke') { eraseAt(point, regionId); return; }
    activePoints.current.push(point);
    const context = canvasRef.current?.getContext('2d');
    const previous = activePoints.current[activePoints.current.length - 2];
    if (context && previous) {
      context.save();
      context.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';
      context.strokeStyle = strokeColor;
      context.lineWidth = activeTool === 'eraser' ? ERASER_RADIUS * 2 : strokeWidth;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      context.restore();
    }
  }, [activeTool, eraseAt, onStrokeAdd, onWritingProgress, page.id, page.strokes, pointFromEvent, pointIsProtected, regionAt, regionBounds, selection, selectionHitsProtected, strokeColor, strokeWidth]);

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
    if ((activeTool === 'pen' || activeTool === 'eraser') && activePoints.current.length >= 2) {
      const isEraser = activeTool === 'eraser';
      const stroke: Stroke = { id: id(), points: [...activePoints.current], color: strokeColor, width: isEraser ? ERASER_RADIUS * 2 : strokeWidth, regionId: activeRegion.current || undefined, isEraser };
      onStrokeAdd(page.id, stroke);
      if (activeRegion.current && !isEraser) onWritingProgress(page.id, activeRegion.current, Math.max(...stroke.points.map(candidate => candidate.y)) - regionBounds(activeRegion.current).top);
    }
    activePoints.current = [];
    erasedThisGesture.current.clear();
  }, [activeTool, dragOffset, lasso, onMoveStrokes, onStrokeAdd, onWritingProgress, page.id, page.strokes, regionBounds, selection, strokeColor, strokeWidth]);

  const selectedBounds = strokeBounds(page.strokes.filter(stroke => selection.includes(stroke.id)));

  return <div className="fsw-page" data-page-index={pageIndex} style={{ width: pageWidth, height: resolvedPageHeight, transform: `scale(${scale})`, transformOrigin: 'top left', marginBottom: PAGE_GAP * scale }}>
    <div className="fsw-page-lines" />
    {pageIndex === 0 && currentQuestion && <div ref={questionSheetRef} className="fsw-question-sheet">
      {shape.context && <div className="fsw-question-context" data-paper-protected="true"><LatexMarkdown content={shape.context} /></div>}
      {shape.parts.map((part, index) => {
        const answerHeight = heights[part.id] ?? defaultAnswerHeight;
        const studentStrokes = page.strokes.filter(stroke => stroke.regionId === part.id);
        const allAiBlocks = (page.aiBlocks ?? []).filter(block => block.regionId === part.id);
        const aiBlocks = allAiBlocks.filter(block => !block.hidden);
        const stepBlocks = allAiBlocks.filter(block => block.mode === 'steps');
        const stepsVisible = stepBlocks.some(block => !block.hidden);
        const previousPart = shape.parts[index - 1];
        const previousBounds = previousPart && regionElements.current.get(previousPart.id) ? regionBounds(previousPart.id) : null;
        const previousStrokes = previousPart ? page.strokes.filter(stroke => stroke.regionId === previousPart.id) : [];
        const previousInkBottom = previousBounds ? (strokeBounds(previousStrokes)?.bottom ?? previousBounds.top) - previousBounds.top : 0;
        const previousAnnotationBottom = previousPart && previousBounds
          ? page.annotations.filter(annotation => annotation.regionId === previousPart.id).reduce((maximum, annotation) => Math.max(maximum, annotation.y + annotation.height - previousBounds.top), 0)
          : 0;
        const previousAiBottom = previousPart
          ? (page.aiBlocks ?? []).filter(block => block.regionId === previousPart.id && !block.hidden).reduce((maximum, block) => Math.max(maximum, block.y + (block.body ? 135 : 70)), 0)
          : 0;
        const previousHeight = previousPart ? heights[previousPart.id] ?? defaultAnswerHeight : 0;
        const minimumPreviousHeight = Math.max(180, previousInkBottom + 110, previousAnnotationBottom + 70, previousAiBottom + 55);
        const canMoveUp = index === 0 ? questionTopOffset > 0 : previousHeight - 80 >= minimumPreviousHeight;
        return <div className="fsw-question-part" key={part.id} style={index === 0 && questionTopOffset ? { marginTop: questionTopOffset } : undefined}>
          <div className="fsw-question-part-header" data-paper-protected="true">
            {part.label && <span className="fsw-question-part-label">{part.label}</span>}
            <div className="fsw-question-part-prompt"><LatexMarkdown content={part.prompt} /></div>
            {!disableAiHelp && <div className="fsw-question-actions">
              <button className="fsw-question-action" type="button" disabled={aiHelpBusyRegion === part.id} onClick={() => setHelpMenu(helpMenu === part.id ? null : part.id)}>{aiHelpBusyRegion === part.id ? 'AI…' : '✨ AI Help'}</button>
              {helpMenu === part.id && <div className="fsw-ai-help-menu">
                <button className={`fsw-ai-steps-toggle ${stepsVisible ? 'active' : ''}`} aria-pressed={stepsVisible} onClick={() => { setHelpMenu(null); onAiHelp(part.id, 'steps'); }}><span>AI Steps</span><span className="fsw-mini-switch"><span /></span></button>
                <button onClick={() => { setHelpMenu(null); onAiHelp(part.id, 'hint'); }}>Hint</button>
                <button onClick={() => { setHelpMenu(null); onAskQuestion(part.id); }}>Ask Question</button>
                <button className={`fsw-ai-steps-toggle ${allAiBlocks.some(block => block.mode === 'solve' && !block.hidden) ? 'active' : ''}`} aria-pressed={allAiBlocks.some(block => block.mode === 'solve' && !block.hidden)} onClick={() => { setHelpMenu(null); onAiHelp(part.id, 'solve'); }}><span>Solve Completely</span><span className="fsw-mini-switch"><span /></span></button>
              </div>}
              <button className="fsw-question-nudge" type="button" title="Move this question and everything below up" disabled={!canMoveUp} onClick={() => onQuestionMove(page.id, part.id, -80)}>↑</button>
              <button className="fsw-question-nudge" type="button" title="Move this question and everything below down" onClick={() => onQuestionMove(page.id, part.id, 80)}>↓</button>
            </div>}
          </div>
          <div className="fsw-answer-region" data-answer-region={part.id} ref={element => { if (element) regionElements.current.set(part.id, element); else regionElements.current.delete(part.id); }} style={{ height: answerHeight }}>
            {aiBlocks.map(block => <div className={`fsw-ai-paper-block ${block.mode}`} data-paper-protected="true" key={block.id} style={{ top: block.y }}><span>AI</span><div><strong><LatexMarkdown content={normalizeTutorMath(block.title)} /></strong>{block.body && <div className="fsw-ai-paper-body"><LatexMarkdown content={normalizeTutorMath(block.body)} /></div>}</div>{block.mode === 'hint' && <button type="button" className="fsw-ai-block-close" aria-label="Close hint" onClick={() => onAiBlockClose(page.id, block.id)}>×</button>}</div>)}
          </div>
          {index === shape.parts.length - 1 && testGrade && <div className="fsw-test-grade">{testGrade}</div>}
        </div>;
      })}
    </div>}
    <canvas ref={canvasRef} width={pageWidth} height={resolvedPageHeight} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: activeTool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : activeTool === 'eraser' ? 'cell' : activeTool === 'select' ? 'default' : activeTool === 'text' ? 'text' : 'crosshair', zIndex: 2 }} />
    {showAiContent && (page.aiMarks ?? []).map(mark => <button key={mark.id} type="button" className={`fsw-ai-mark ${mark.type}`} onClick={() => onAiMarkClick(mark)} style={{ left: mark.x, top: mark.y, width: mark.width, height: mark.height }}><span>{mark.correctionText}</span></button>)}
    {(lasso.length > 1 || selectedBounds) && <svg className="fsw-selection-layer" viewBox={`0 0 ${pageWidth} ${resolvedPageHeight}`}>
      {lasso.length > 1 && <polyline points={lasso.map(point => `${point.x},${point.y}`).join(' ')} fill="rgba(79,70,229,.06)" stroke="#4f46e5" strokeWidth="2" strokeDasharray="7 5" />}
      {selectedBounds && <rect x={selectedBounds.left + dragOffset.x - 8} y={selectedBounds.top + dragOffset.y - 8} width={selectedBounds.right - selectedBounds.left + 16} height={selectedBounds.bottom - selectedBounds.top + 16} rx="8" fill="rgba(79,70,229,.05)" stroke="#4f46e5" strokeWidth="2" strokeDasharray="7 5" />}
    </svg>}
    {page.annotations.map(annotation => <div className="fsw-annotation" data-paper-protected="true" key={annotation.id} style={{ left: annotation.x, top: annotation.y, zIndex: 3 }}>
      {editingAnnotation === annotation.id ? <textarea autoFocus defaultValue={annotation.text} className="fsw-annotation-input" onBlur={event => { onAnnotationUpdate(page.id, annotation.id, event.currentTarget.value.trim()); setEditingAnnotation(null); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); (event.target as HTMLTextAreaElement).blur(); } }} />
        : <div className="fsw-annotation-display" onDoubleClick={() => setEditingAnnotation(annotation.id)}>{annotation.text || <span style={{ opacity: .4, fontStyle: 'italic' }}>Type here…</span>}</div>}
    </div>)}
    <div className="fsw-page-number">{pageIndex + 1}</div>
  </div>;
});
