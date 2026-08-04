import { useCallback, useEffect, useRef } from 'react';
import { type Stroke, type StrokePoint } from '@/components/FullScreenWorkspace';

const ERASE_RADIUS = 16;

function distanceSquared(a: StrokePoint, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i++) {
    ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  if (stroke.points.length === 1) {
    ctx.lineTo(stroke.points[0].x + 0.1, stroke.points[0].y + 0.1);
  }
  ctx.stroke();
  ctx.restore();
}

function renderAll(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const stroke of strokes) renderStroke(ctx, stroke);
}

function makeStrokeId(): string {
  return `cs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface ClassroomCanvasProps {
  pageWidth: number;
  pageHeight: number;
  strokes: Stroke[];
  onStrokeAdd: (stroke: Stroke) => void;
  onStrokeRemove: (strokeId: string) => void;
  color: string;
  strokeWidth: number;
  tool: 'pen' | 'eraser';
  disabled?: boolean;
  style?: React.CSSProperties;
}

export default function ClassroomCanvas({
  pageWidth,
  pageHeight,
  strokes,
  onStrokeAdd,
  onStrokeRemove,
  color,
  strokeWidth,
  tool,
  disabled,
  style,
}: ClassroomCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const activePointsRef = useRef<StrokePoint[]>([]);
  const lastPointRef = useRef<StrokePoint | null>(null);
  const erasedThisGestureRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (canvasRef.current) renderAll(canvasRef.current, strokes);
  }, [strokes, pageWidth, pageHeight]);

  const pointFromEvent = useCallback((event: React.PointerEvent): StrokePoint => {
    const bounds = canvasRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (pageWidth / bounds.width),
      y: (event.clientY - bounds.top) * (pageHeight / bounds.height),
      pressure: event.pressure || 0.5,
    };
  }, [pageHeight, pageWidth]);

  const eraseAt = useCallback((point: StrokePoint) => {
    for (const stroke of strokes) {
      if (erasedThisGestureRef.current.has(stroke.id)) continue;
      const hit = stroke.points.some(p => distanceSquared(p, point) < ERASE_RADIUS ** 2);
      if (hit) {
        erasedThisGestureRef.current.add(stroke.id);
        onStrokeRemove(stroke.id);
      }
    }
  }, [strokes, onStrokeRemove]);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (disabled) return;
    (event.target as Element).setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    erasedThisGestureRef.current.clear();

    if (tool === 'eraser') {
      eraseAt(point);
      return;
    }

    drawingRef.current = true;
    activePointsRef.current = [point];
    lastPointRef.current = point;
  }, [disabled, tool, pointFromEvent, eraseAt]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (disabled) return;

    if (tool === 'eraser') {
      if (event.buttons !== 1 && event.pressure === 0) return;
      eraseAt(pointFromEvent(event));
      return;
    }

    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    activePointsRef.current.push(point);

    const ctx = canvasRef.current?.getContext('2d');
    const prev = lastPointRef.current;
    if (ctx && prev) {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.restore();
    }
    lastPointRef.current = point;
  }, [disabled, tool, color, strokeWidth, pointFromEvent, eraseAt]);

  const finishStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = activePointsRef.current;
    activePointsRef.current = [];
    lastPointRef.current = null;
    if (points.length === 0) return;
    onStrokeAdd({
      id: makeStrokeId(),
      points,
      color,
      width: strokeWidth,
    });
  }, [onStrokeAdd, color, strokeWidth]);

  const handlePointerUp = useCallback(() => {
    if (tool === 'pen') finishStroke();
  }, [tool, finishStroke]);

  return (
    <canvas
      ref={canvasRef}
      width={pageWidth}
      height={pageHeight}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      style={{
        width: pageWidth,
        height: pageHeight,
        touchAction: 'none',
        cursor: disabled ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair',
        display: 'block',
        ...style,
      }}
    />
  );
}
