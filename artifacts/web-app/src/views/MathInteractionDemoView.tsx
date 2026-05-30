import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import katex from 'katex';
import { chatWithTutor, evaluateStudentWork, getTutorStatus, type TutorConversationMessage, type TutorEvaluationResponse, type TutorStatusResponse } from '@/lib/aiTutorService';
import { recognizeHandwriting } from '@/lib/handwritingRecognitionService';
import { recognizeSymbol } from '@/lib/symbolRecognitionService';

type DemoStep = 'guided' | 'mcq' | 'numeric' | 'equation' | 'points' | 'mistake';

type Point = { x: number; y: number };

type TutorContext = {
  questionId: string;
  questionPrompt: string;
  activeStepId: string;
  activeStepTitle: string;
  expectedAnswer?: string | null;
  expectedReasoning?: string | null;
};

const steps: Array<{ id: DemoStep; title: string; subtitle: string }> = [
  { id: 'guided', title: 'Guided Solve', subtitle: 'A practical step-by-step math flow' },
  { id: 'mcq', title: 'Choice Cards', subtitle: 'Fast concept check with instant feedback' },
  { id: 'numeric', title: 'Numeric Keypad', subtitle: 'Math-first input that feels native' },
  { id: 'equation', title: 'Equation Builder', subtitle: 'Scaffold input instead of a scary blank box' },
  { id: 'points', title: 'Point Plotter', subtitle: 'Tap on a graph instead of typing coordinates' },
  { id: 'mistake', title: 'Mistake Hunt', subtitle: 'Learn by spotting and fixing reasoning errors' },
];

function DemoShell({
  title,
  eyebrow,
  children,
  footer,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      style={{
        borderRadius: 24,
        border: '1px solid var(--ll-border)',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--ll-surface-1) 96%, transparent 4%), color-mix(in srgb, var(--ll-surface-0) 98%, transparent 2%))',
        boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 20, borderBottom: '1px solid var(--ll-border)', background: 'color-mix(in srgb, var(--ll-surface-2) 82%, transparent 18%)' }}>
        <div style={{ color: 'var(--ll-text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.1 }}>{eyebrow}</div>
        <div style={{ color: 'var(--ll-text)', fontSize: 24, fontWeight: 1000, marginTop: 6 }}>{title}</div>
      </div>
      <div
        style={{
          padding: 20,
          maxHeight: 'calc(100vh - 220px)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
        }}
      >
        {children}
      </div>
      {footer ? <div style={{ padding: 16, borderTop: '1px solid var(--ll-border)', background: 'color-mix(in srgb, var(--ll-surface-1) 86%, transparent 14%)' }}>{footer}</div> : null}
    </div>
  );
}

function StepPills({ current, onSelect }: { current: DemoStep; onSelect: (step: DemoStep) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {steps.map((step, index) => {
        const active = step.id === current;
        return (
          <button
            key={step.id}
            onClick={() => onSelect(step.id)}
            className={active ? 'll-btn ll-btn-primary' : 'll-btn'}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              borderRadius: 999,
              background: active ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : undefined,
              borderColor: active ? 'rgba(147,197,253,0.45)' : undefined,
              color: active ? 'white' : undefined,
            }}
          >
            {index + 1}. {step.title}
          </button>
        );
      })}
    </div>
  );
}

function FreehandWorkPad({
  recognitionSeed,
  preferredOutput,
  onUseRecognizedText,
  allowedSymbols,
  tutorContext,
}: {
  recognitionSeed: string;
  preferredOutput: 'text' | 'latex';
  onUseRecognizedText: (value: string) => void;
  allowedSymbols?: string[];
  tutorContext?: TutorContext;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const strokePathRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [recognizedText, setRecognizedText] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [outputMode, setOutputMode] = useState<'text' | 'latex'>(preferredOutput);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [tutorEvaluation, setTutorEvaluation] = useState<TutorEvaluationResponse | null>(null);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<TutorConversationMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTutorChatting, setIsTutorChatting] = useState(false);
  const [tutorStatus, setTutorStatus] = useState<TutorStatusResponse | null>(null);
  const recognitionRequestRef = useRef(0);
  const recognizedTokenBoxesRef = useRef<Array<{ symbol: string; minX: number; maxX: number; minY: number; maxY: number }>>([]);
  const templateCacheRef = useRef(new Map<string, number[][]>());
  const [debugGlyphPreviews, setDebugGlyphPreviews] = useState<Array<{ image: string; label: string }>>([]);
  const padHeight = 560;

  useEffect(() => {
    setOutputMode(preferredOutput);
  }, [preferredOutput]);

  useEffect(() => {
    let cancelled = false;
    getTutorStatus()
      .then((status) => {
        if (!cancelled) setTutorStatus(status);
      })
      .catch(() => {
        if (!cancelled) setTutorStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const annotationCanvas = annotationCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !annotationCanvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    for (const layer of [canvas, annotationCanvas]) {
      layer.width = Math.max(1, Math.floor(rect.width * dpr));
      layer.height = Math.max(1, Math.floor(padHeight * dpr));
      layer.style.width = `${rect.width}px`;
      layer.style.height = `${padHeight}px`;
      layer.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#091120';
    ctx.fillRect(0, 0, rect.width, padHeight);
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    for (let x = 24; x < rect.width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, padHeight);
      ctx.stroke();
    }
    for (let y = 24; y < padHeight; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }
  }, [padHeight]);

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function strokeTo(point: { x: number; y: number }) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const previous = lastPointRef.current ?? point;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 18;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 3.5;
    }
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();
    lastPointRef.current = point;
  }

  function clearPad() {
    const canvas = canvasRef.current;
    const annotationCanvas = annotationCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = container.getBoundingClientRect().width;
    annotationCanvas?.getContext('2d')?.clearRect(0, 0, width, padHeight);
    ctx.clearRect(0, 0, width, padHeight);
    ctx.fillStyle = '#091120';
    ctx.fillRect(0, 0, width, padHeight);
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    for (let x = 24; x < width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, padHeight);
      ctx.stroke();
    }
    for (let y = 24; y < padHeight; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    setHasInk(false);
    setRecognizedText('');
    setCandidates([]);
    setRecognitionError(null);
    setTutorEvaluation(null);
    setTutorError(null);
    setChatMessages([]);
    setChatInput('');
    setDebugGlyphPreviews([]);
    recognizedTokenBoxesRef.current = [];
    strokePathRef.current = [];
  }

  function toLatex(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.includes('y=x+1')) return 'y = x + 1';
    if (trimmed.includes('x-y+1=0')) return 'x - y + 1 = 0';
    if (trimmed === '(0,1)') return '(0, 1)';
    if (trimmed === '(1,2)') return '(1, 2)';
    if (trimmed === '(2,3)') return '(2, 3)';
    return trimmed
      .replace(/\*/g, '\\cdot ')
      .replace(/<=/g, '\\le ')
      .replace(/>=/g, '\\ge ')
      .replace(/!=/g, '\\ne ')
      .replace(/sqrt\(([^)]+)\)/gi, '\\sqrt{$1}')
      .replace(/([0-9]+)\/([0-9]+)/g, '\\frac{$1}{$2}');
  }

  function exportCleanInkImage(): string | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const r = data[index] ?? 0;
        const g = data[index + 1] ?? 0;
        const b = data[index + 2] ?? 0;
        const a = data[index + 3] ?? 0;
        const brightness = (r + g + b) / 3;
        const isInk = a > 0 && brightness > 210;
        if (!isInk) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) return null;

    const padding = Math.max(24, Math.floor(Math.min(width, height) * 0.04));
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(width - 1, maxX + padding);
    maxY = Math.min(height - 1, maxY + padding);

    const cropWidth = Math.max(1, maxX - minX + 1);
    const cropHeight = Math.max(1, maxY - minY + 1);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = cropWidth;
    outputCanvas.height = cropHeight;
    const outputCtx = outputCanvas.getContext('2d');
    if (!outputCtx) return null;

    outputCtx.fillStyle = '#ffffff';
    outputCtx.fillRect(0, 0, cropWidth, cropHeight);

    const cropped = ctx.getImageData(minX, minY, cropWidth, cropHeight);
    const croppedData = cropped.data;
    for (let index = 0; index < croppedData.length; index += 4) {
      const r = croppedData[index] ?? 0;
      const g = croppedData[index + 1] ?? 0;
      const b = croppedData[index + 2] ?? 0;
      const a = croppedData[index + 3] ?? 0;
      const brightness = (r + g + b) / 3;
      const isInk = a > 0 && brightness > 210;
      croppedData[index] = isInk ? 0 : 255;
      croppedData[index + 1] = isInk ? 0 : 255;
      croppedData[index + 2] = isInk ? 0 : 255;
      croppedData[index + 3] = 255;
    }
    outputCtx.putImageData(cropped, 0, 0);

    return outputCanvas.toDataURL('image/png');
  }

  function getInkBounds() {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const r = data[index] ?? 0;
        const g = data[index + 1] ?? 0;
        const b = data[index + 2] ?? 0;
        const a = data[index + 3] ?? 0;
        const brightness = (r + g + b) / 3;
        const isInk = a > 0 && brightness > 210;
        if (!isInk) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (maxX < minX || maxY < minY) return null;

    const padding = Math.max(12, Math.floor(Math.min(width, height) * 0.02));
    return {
      minX: Math.max(0, minX - padding),
      minY: Math.max(0, minY - padding),
      maxX: Math.min(width - 1, maxX + padding),
      maxY: Math.min(height - 1, maxY + padding),
    };
  }

  function exportCleanInkImageForBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): string | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const padding = 16;
    const minX = Math.max(0, Math.floor(bounds.minX - padding));
    const minY = Math.max(0, Math.floor(bounds.minY - padding));
    const maxX = Math.min(canvas.width - 1, Math.ceil(bounds.maxX + padding));
    const maxY = Math.min(canvas.height - 1, Math.ceil(bounds.maxY + padding));
    const cropWidth = Math.max(1, maxX - minX + 1);
    const cropHeight = Math.max(1, maxY - minY + 1);

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = cropWidth;
    outputCanvas.height = cropHeight;
    const outputCtx = outputCanvas.getContext('2d');
    if (!outputCtx) return null;

    outputCtx.fillStyle = '#ffffff';
    outputCtx.fillRect(0, 0, cropWidth, cropHeight);

    const cropped = ctx.getImageData(minX, minY, cropWidth, cropHeight);
    const croppedData = cropped.data;
    for (let index = 0; index < croppedData.length; index += 4) {
      const r = croppedData[index] ?? 0;
      const g = croppedData[index + 1] ?? 0;
      const b = croppedData[index + 2] ?? 0;
      const a = croppedData[index + 3] ?? 0;
      const brightness = (r + g + b) / 3;
      const isInk = a > 0 && brightness > 210;
      croppedData[index] = isInk ? 0 : 255;
      croppedData[index + 1] = isInk ? 0 : 255;
      croppedData[index + 2] = isInk ? 0 : 255;
      croppedData[index + 3] = 255;
    }
    outputCtx.putImageData(cropped, 0, 0);
    return outputCanvas.toDataURL('image/png');
  }

  function buildNormalizedInkGrid(targetSize = 28, customBounds?: { minX: number; minY: number; maxX: number; maxY: number }): number[] | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const bounds = customBounds ?? getInkBounds();
    if (!bounds) return null;

    const cropWidth = Math.max(1, bounds.maxX - bounds.minX + 1);
    const cropHeight = Math.max(1, bounds.maxY - bounds.minY + 1);
    const normalizedCanvas = document.createElement('canvas');
    normalizedCanvas.width = targetSize;
    normalizedCanvas.height = targetSize;
    const normalizedCtx = normalizedCanvas.getContext('2d');
    if (!normalizedCtx) return null;

    normalizedCtx.fillStyle = '#ffffff';
    normalizedCtx.fillRect(0, 0, targetSize, targetSize);

    const scale = Math.min((targetSize - 6) / cropWidth, (targetSize - 6) / cropHeight);
    const drawWidth = Math.max(1, Math.round(cropWidth * scale));
    const drawHeight = Math.max(1, Math.round(cropHeight * scale));
    const offsetX = Math.floor((targetSize - drawWidth) / 2);
    const offsetY = Math.floor((targetSize - drawHeight) / 2);
    normalizedCtx.imageSmoothingEnabled = true;
    normalizedCtx.drawImage(canvas, bounds.minX, bounds.minY, cropWidth, cropHeight, offsetX, offsetY, drawWidth, drawHeight);

    const normalizedData = normalizedCtx.getImageData(0, 0, targetSize, targetSize).data;
    const grid: number[] = [];
    for (let index = 0; index < normalizedData.length; index += 4) {
      const brightness = ((normalizedData[index] ?? 0) + (normalizedData[index + 1] ?? 0) + (normalizedData[index + 2] ?? 0)) / 3;
      grid.push((255 - brightness) / 255);
    }

    const totalInk = grid.reduce((sum, value) => sum + value, 0);
    if (totalInk <= 0.5) return null;
    return grid.map((value) => value / totalInk);
  }

  function buildTemplateVariants(symbol: string, targetSize = 28): number[][] {
    const cacheKey = `${symbol}_${targetSize}`;
    const cached = templateCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const templateCanvas = document.createElement('canvas');
    templateCanvas.width = targetSize;
    templateCanvas.height = targetSize;
    const templateCtx = templateCanvas.getContext('2d');
    if (!templateCtx) return [new Array(targetSize * targetSize).fill(0)];

    templateCtx.textAlign = 'center';
    templateCtx.textBaseline = 'middle';

    const fonts = [
      '700 24px Arial',
      '700 24px Segoe UI',
      '700 24px Trebuchet MS',
      '700 24px Tahoma',
    ];
    const yOffsets = symbol === '-' || symbol === '=' ? [-2, 0, 2] : [-1, 1, 3];
    const xOffsets = symbol === '1' || symbol === '/' ? [-1, 0, 1] : [-2, 0, 2];
    const rotations = symbol === '-' || symbol === '=' ? [-4, 0, 4] : [-8, -4, 0, 4, 8];
    const scales = symbol === '-' || symbol === '=' ? [0.9, 1, 1.08] : [0.88, 0.96, 1.04];
    const variants: number[][] = [];

    for (const font of fonts) {
      for (const scale of scales) {
        for (const rotation of rotations) {
          for (const xOffset of xOffsets) {
            for (const yOffset of yOffsets) {
              templateCtx.fillStyle = '#ffffff';
              templateCtx.fillRect(0, 0, targetSize, targetSize);
              templateCtx.save();
              templateCtx.translate(targetSize / 2 + xOffset, targetSize / 2 + yOffset);
              templateCtx.rotate((rotation * Math.PI) / 180);
              templateCtx.scale(scale, scale);
              templateCtx.fillStyle = '#000000';
              templateCtx.font = font;
              templateCtx.fillText(symbol, 0, 0);
              templateCtx.restore();
              const imageData = templateCtx.getImageData(0, 0, targetSize, targetSize).data;
              const grid: number[] = [];
              for (let index = 0; index < imageData.length; index += 4) {
                const brightness = ((imageData[index] ?? 0) + (imageData[index + 1] ?? 0) + (imageData[index + 2] ?? 0)) / 3;
                grid.push((255 - brightness) / 255);
              }
              const ink = grid.reduce((sum, value) => sum + value, 0);
              if (ink > 0) {
                variants.push(grid.map((value) => value / ink));
              }
            }
          }
        }
      }
    }

    const deduped: number[][] = [];
    const seen = new Set<string>();
    for (const variant of variants) {
      const signature = variant
        .filter((value, index) => index % 4 === 0)
        .map((value) => (value > 0.015 ? '1' : '0'))
        .join('');
      if (seen.has(signature)) continue;
      seen.add(signature);
      deduped.push(variant);
      if (deduped.length >= 48) break;
    }

    const result = deduped.length > 0 ? deduped : [new Array(targetSize * targetSize).fill(0)];
    templateCacheRef.current.set(cacheKey, result);
    return result;
  }

  function scoreTemplateMatch(input: number[], template: number[]): number {
    let dot = 0;
    let distance = 0;
    for (let index = 0; index < input.length; index += 1) {
      const inputValue = input[index] ?? 0;
      const templateValue = template[index] ?? 0;
      dot += inputValue * templateValue;
      distance += Math.abs(inputValue - templateValue);
    }
    return dot - distance * 0.18;
  }

  function scoreSymbolCandidate(input: number[], candidate: string): number {
    const variants = buildTemplateVariants(candidate, 28);
    const scores: number[] = [];
    for (const variant of variants) {
      scores.push(scoreTemplateMatch(input, variant));
    }
    scores.sort((a, b) => b - a);
    const top = scores[0] ?? Number.NEGATIVE_INFINITY;
    const second = scores[1] ?? top;
    const third = scores[2] ?? second;
    return top * 0.6 + second * 0.25 + third * 0.15;
  }

  function predictBasicSymbolDetailed(): { candidate: string; score: number; gap: number; strokeCount: number; aspect: number } | null {
    const strokes = strokePathRef.current
      .map((stroke) => stroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
      .filter((stroke) => stroke.length >= 2);

    if (strokes.length === 0) return null;

    const allPoints = strokes.flat();
    const xs = allPoints.map((point) => point.x);
    const ys = allPoints.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const aspect = Math.max(1, maxX - minX) / Math.max(1, maxY - minY);

    const normalized = buildNormalizedInkGrid(28);
    if (!normalized) return null;

    const defaultCandidates = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '×', '/', '=', 'x', 'y', 'm', 'b', '(', ')'];
    const candidates = allowedSymbols?.length
      ? defaultCandidates.filter((candidate) => allowedSymbols.includes(candidate))
      : defaultCandidates;
    const scored = candidates
      .map((candidate) => ({ candidate, score: scoreSymbolCandidate(normalized, candidate) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    if (!best) return null;

    return {
      candidate: best.candidate,
      score: best.score,
      gap: best.score - (second?.score ?? 0),
      strokeCount: strokes.length,
      aspect,
    };
  }

  function detectOperatorFromGroup(
    groupStrokes: Array<Array<{ x: number; y: number }>>,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ): string | null {
    const strokes = groupStrokes.filter((stroke) => stroke.length >= 2);
    if (strokes.length === 0) return null;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);

    const summarize = (stroke: Array<{ x: number; y: number }>) => {
      const start = stroke[0]!;
      const end = stroke[stroke.length - 1]!;
      const xs = stroke.map((p) => p.x);
      const ys = stroke.map((p) => p.y);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      const chord = Math.hypot(end.x - start.x, end.y - start.y);
      let pathLength = 0;
      for (let i = 1; i < stroke.length; i += 1) {
        const previous = stroke[i - 1]!;
        const current = stroke[i]!;
        pathLength += Math.hypot(current.x - previous.x, current.y - previous.y);
      }
      // Straightness: 1.0 = perfectly straight, <0.85 means the stroke curves significantly.
      const straightness = pathLength > 1 ? chord / pathLength : 0;
      return {
        dx: end.x - start.x,
        dy: end.y - start.y,
        spanX,
        spanY,
        horizontalness: spanX / Math.max(1, spanY),
        verticalness: spanY / Math.max(1, spanX),
        straightness,
      };
    };
    const summaries = strokes.map(summarize);
    // Operators must be VERY straight, digits curve.
    const STRAIGHT = 0.92;
    const horizontals = summaries.filter((s) => s.straightness > STRAIGHT && s.horizontalness > 4 && Math.abs(s.dy) < Math.max(8, s.spanX * 0.25));
    const verticals = summaries.filter((s) => s.straightness > STRAIGHT && s.verticalness > 4 && Math.abs(s.dx) < Math.max(8, s.spanY * 0.25));
    const diagonals = summaries.filter((s) => s.straightness > STRAIGHT && s.horizontalness < 2.5 && s.verticalness < 2.5 && Math.abs(s.dx) > 15 && Math.abs(s.dy) > 15);

    if (strokes.length === 1) {
      const s = summaries[0]!;
      const stroke = strokes[0]!;
      // Minus: very flat AND very straight
      if (s.straightness > STRAIGHT && s.horizontalness > 5 && width > 25 && height < width * 0.3) return '-';
      // Slash: only if truly straight diagonal
      if (s.straightness > STRAIGHT && s.horizontalness < 1.8 && s.verticalness < 1.8 && Math.abs(s.dx) > 15 && Math.abs(s.dy) > 15) return '/';
      // Parenthesis: tall, narrow, curved (not straight) single stroke. Differentiate "(" vs ")"
      // by which side the stroke bulges relative to the chord midpoint.
      if (s.verticalness > 2.0 && s.straightness > 0.7 && s.straightness < 0.92 && height > 25 && width < height * 0.55) {
        const start = stroke[0]!;
        const end = stroke[stroke.length - 1]!;
        const meanX = stroke.reduce((sum, p) => sum + p.x, 0) / stroke.length;
        const chordMidX = (start.x + end.x) / 2;
        // Positive bulge = stroke center is to the LEFT of the chord midpoint => "("
        // Negative bulge = stroke center is to the RIGHT of the chord midpoint => ")"
        const bulge = chordMidX - meanX;
        if (Math.abs(bulge) > Math.max(4, width * 0.15)) {
          return bulge > 0 ? '(' : ')';
        }
      }
      // Single curved stroke is almost certainly a digit; bail out
      return null;
    }

    if (strokes.length === 2) {
      // Equals: two flat straight strokes at different heights
      if (horizontals.length === 2 && verticals.length === 0) {
        const yCenters = strokes.map((stroke) => stroke.reduce((sum, p) => sum + p.y, 0) / stroke.length).sort((a, b) => a - b);
        if (Math.abs(yCenters[1]! - yCenters[0]!) > Math.max(10, height * 0.15)) return '=';
      }
      // Plus: one straight horizontal + one straight vertical
      if (horizontals.length >= 1 && verticals.length >= 1) {
        return '+';
      }
      // Times: two straight diagonals with opposite x direction
      if (diagonals.length === 2) {
        const [first, second] = diagonals;
        if (first && second && Math.sign(first.dx) !== Math.sign(second.dx)) return '×';
      }
    }

    return null;
  }

  function buildGlyphGroups() {
    const penStrokes = strokePathRef.current
      .map((stroke) => stroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
      .filter((stroke) => stroke.length >= 2);
    if (penStrokes.length === 0) return [];

    type Group = { strokes: Array<Array<{ x: number; y: number }>>; minX: number; maxX: number; minY: number; maxY: number };
    const initial: Group[] = penStrokes
      .map((stroke) => {
        const xs = stroke.map((point) => point.x);
        const ys = stroke.map((point) => point.y);
        return {
          strokes: [stroke],
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minY: Math.min(...ys),
          maxY: Math.max(...ys),
        };
      })
      .sort((a, b) => a.minX - b.minX);

    const merged: Group[] = [];
    for (const group of initial) {
      let mergedInto: Group | null = null;
      for (const existing of merged) {
        const xOverlap = Math.min(existing.maxX, group.maxX) - Math.max(existing.minX, group.minX);
        const yOverlap = Math.min(existing.maxY, group.maxY) - Math.max(existing.minY, group.minY);
        const existingWidth = Math.max(1, existing.maxX - existing.minX);
        const currentWidth = Math.max(1, group.maxX - group.minX);
        const existingHeight = Math.max(1, existing.maxY - existing.minY);
        const currentHeight = Math.max(1, group.maxY - group.minY);
        const smallerWidth = Math.min(existingWidth, currentWidth);
        const smallerHeight = Math.min(existingHeight, currentHeight);
        // Merge only if strokes overlap in BOTH x and y (same glyph in 2D space).
        // This keeps multi-stroke digits like 4 and operators like + or × intact,
        // while keeping vertically stacked content (fraction numerator/denominator,
        // the two strokes of "=") as separate glyphs.
        const significantXOverlap = xOverlap >= smallerWidth * 0.35;
        const significantYOverlap = yOverlap >= smallerHeight * 0.35;
        if (significantXOverlap && significantYOverlap) {
          mergedInto = existing;
          break;
        }
      }
      if (mergedInto) {
        mergedInto.strokes.push(...group.strokes);
        mergedInto.minX = Math.min(mergedInto.minX, group.minX);
        mergedInto.maxX = Math.max(mergedInto.maxX, group.maxX);
        mergedInto.minY = Math.min(mergedInto.minY, group.minY);
        mergedInto.maxY = Math.max(mergedInto.maxY, group.maxY);
      } else {
        merged.push(group);
      }
    }

    // Sort final groups left-to-right so we read the expression in order.
    merged.sort((a, b) => a.minX - b.minX);
    return merged;
  }

  function isHorizontalLineGlyph(group: { strokes: Array<Array<{ x: number; y: number }>>; minX: number; maxX: number; minY: number; maxY: number }): boolean {
    if (group.strokes.length !== 1) return false;
    const stroke = group.strokes[0]!;
    if (stroke.length < 2) return false;
    const xs = stroke.map((p) => p.x);
    const ys = stroke.map((p) => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX < 18) return false;
    if (spanY > spanX * 0.25) return false;
    // Straightness check
    const start = stroke[0]!;
    const end = stroke[stroke.length - 1]!;
    const chord = Math.hypot(end.x - start.x, end.y - start.y);
    let pathLength = 0;
    for (let i = 1; i < stroke.length; i += 1) {
      const prev = stroke[i - 1]!;
      const cur = stroke[i]!;
      pathLength += Math.hypot(cur.x - prev.x, cur.y - prev.y);
    }
    const straightness = pathLength > 1 ? chord / pathLength : 0;
    return straightness > 0.9;
  }

  type GlyphGroup = { strokes: Array<Array<{ x: number; y: number }>>; minX: number; maxX: number; minY: number; maxY: number };
  type LayoutNode =
    | { kind: 'glyph'; group: GlyphGroup; minX: number; maxX: number }
    | { kind: 'fraction'; numerator: LayoutNode[]; denominator: LayoutNode[]; minX: number; maxX: number }
    | { kind: 'equals'; minX: number; maxX: number; minY: number; maxY: number }
    | { kind: 'minus'; minX: number; maxX: number; minY: number; maxY: number };

  function buildLayoutTree(groups: GlyphGroup[]): LayoutNode[] {
    // Identify horizontal-line glyphs and other (content) glyphs.
    const hLines = groups.filter(isHorizontalLineGlyph);
    const others = groups.filter((g) => !isHorizontalLineGlyph(g));
    const consumed = new Set<GlyphGroup>();
    const nodes: LayoutNode[] = [];

    // Pass 1: detect fractions. A horizontal line is a fraction bar if it has
    // at least one non-line glyph above AND below within its x-range.
    for (const bar of hLines) {
      if (consumed.has(bar)) continue;
      const barCenterY = (bar.minY + bar.maxY) / 2;
      const barWidth = bar.maxX - bar.minX;
      const xPadding = Math.max(4, barWidth * 0.05);
      const above: GlyphGroup[] = [];
      const below: GlyphGroup[] = [];
      for (const g of [...others, ...hLines]) {
        if (g === bar || consumed.has(g)) continue;
        const gCenterX = (g.minX + g.maxX) / 2;
        const gCenterY = (g.minY + g.maxY) / 2;
        if (gCenterX < bar.minX - xPadding || gCenterX > bar.maxX + xPadding) continue;
        if (gCenterY < barCenterY - 4) above.push(g);
        else if (gCenterY > barCenterY + 4) below.push(g);
      }
      if (above.length > 0 && below.length > 0) {
        consumed.add(bar);
        above.forEach((g) => consumed.add(g));
        below.forEach((g) => consumed.add(g));
        nodes.push({
          kind: 'fraction',
          numerator: buildLayoutTree(above),
          denominator: buildLayoutTree(below),
          minX: bar.minX,
          maxX: bar.maxX,
        });
      }
    }

    // Pass 2: pair stacked horizontal lines as "=".
    for (let i = 0; i < hLines.length; i += 1) {
      const a = hLines[i]!;
      if (consumed.has(a)) continue;
      for (let j = i + 1; j < hLines.length; j += 1) {
        const b = hLines[j]!;
        if (consumed.has(b)) continue;
        const xOverlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const smallerWidth = Math.max(1, Math.min(a.maxX - a.minX, b.maxX - b.minX));
        const aCenterY = (a.minY + a.maxY) / 2;
        const bCenterY = (b.minY + b.maxY) / 2;
        const yDistance = Math.abs(aCenterY - bCenterY);
        const widthAvg = (a.maxX - a.minX + b.maxX - b.minX) / 2;
        if (xOverlap >= smallerWidth * 0.5 && yDistance < widthAvg * 0.7) {
          consumed.add(a);
          consumed.add(b);
          nodes.push({
            kind: 'equals',
            minX: Math.min(a.minX, b.minX),
            maxX: Math.max(a.maxX, b.maxX),
            minY: Math.min(a.minY, b.minY),
            maxY: Math.max(a.maxY, b.maxY),
          });
          break;
        }
      }
    }

    // Pass 3: remaining horizontal lines become minus signs.
    for (const bar of hLines) {
      if (consumed.has(bar)) continue;
      consumed.add(bar);
      nodes.push({ kind: 'minus', minX: bar.minX, maxX: bar.maxX, minY: bar.minY, maxY: bar.maxY });
    }

    // Pass 4: remaining glyphs as regular leaves.
    for (const g of others) {
      if (consumed.has(g)) continue;
      consumed.add(g);
      nodes.push({ kind: 'glyph', group: g, minX: g.minX, maxX: g.maxX });
    }

    return nodes.sort((a, b) => a.minX - b.minX);
  }

  async function classifyLayoutNode(
    node: LayoutNode,
    outputMode: 'text' | 'latex',
    debugSink: Array<{ image: string; label: string }>,
    tokenSink: Array<{ symbol: string; minX: number; maxX: number; minY: number; maxY: number }>,
  ): Promise<string> {
    if (node.kind === 'equals') {
      tokenSink.push({ symbol: '=', minX: node.minX, maxX: node.maxX, minY: node.minY, maxY: node.maxY });
      return '=';
    }
    if (node.kind === 'minus') {
      tokenSink.push({ symbol: '-', minX: node.minX, maxX: node.maxX, minY: node.minY, maxY: node.maxY });
      return '-';
    }
    if (node.kind === 'fraction') {
      const [num, den] = await Promise.all([
        renderLayoutNodes(node.numerator, outputMode, debugSink, tokenSink),
        renderLayoutNodes(node.denominator, outputMode, debugSink, tokenSink),
      ]);
      if (outputMode === 'latex') {
        return `\\frac{${num}}{${den}}`;
      }
      const numWrap = /[-+×*/=]/.test(num) ? `(${num})` : num;
      const denWrap = /[-+×*/=]/.test(den) ? `(${den})` : den;
      return `${numWrap}/${denWrap}`;
    }
    // glyph: classify via operator rules or backend
    const result = await classifyGlyphViaBackend(node.group);
    if (result.image) debugSink.push({ image: result.image, label: result.symbol ?? '?' });
    const symbol = result.symbol ?? '?';
    tokenSink.push({ symbol, minX: node.group.minX, maxX: node.group.maxX, minY: node.group.minY, maxY: node.group.maxY });
    if (outputMode === 'latex' && symbol === '×') return '\\times';
    return symbol;
  }

  async function renderLayoutNodes(
    nodes: LayoutNode[],
    outputMode: 'text' | 'latex',
    debugSink: Array<{ image: string; label: string }>,
    tokenSink: Array<{ symbol: string; minX: number; maxX: number; minY: number; maxY: number }>,
  ): Promise<string> {
    const parts = await Promise.all(nodes.map((n) => classifyLayoutNode(n, outputMode, debugSink, tokenSink)));
    return parts.join('');
  }

  async function classifyGlyphViaBackend(
    group: { strokes: Array<Array<{ x: number; y: number }>>; minX: number; maxX: number; minY: number; maxY: number },
  ): Promise<{ symbol: string | null; image: string | null }> {
    const operator = detectOperatorFromGroup(group.strokes, group);
    if (operator) return { symbol: operator, image: null };
    const dpr = window.devicePixelRatio || 1;
    const image = exportCleanInkImageForBounds({
      minX: group.minX * dpr,
      minY: group.minY * dpr,
      maxX: group.maxX * dpr,
      maxY: group.maxY * dpr,
    });
    if (!image) {
      console.warn('[symbol-recognition] exportCleanInkImageForBounds returned null', group);
      return { symbol: null, image: null };
    }
    try {
      const result = await recognizeSymbol({ imageBase64: image, allowedSymbols });
      if (!result.symbol) {
        console.warn('[symbol-recognition] backend returned null symbol', result);
      }
      console.log('[symbol-recognition] glyph predicted:', result.symbol, 'confidence:', result.confidence, 'candidates:', result.candidates);
      return { symbol: result.symbol ?? null, image };
    } catch (error) {
      console.warn('[symbol-recognition] backend call failed:', error);
      return { symbol: null, image };
    }
  }

  function classifyBasicSymbol(): string | null {
    const strokes = strokePathRef.current
      .map((stroke) => stroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
      .filter((stroke) => stroke.length >= 2);

    if (strokes.length === 0) return null;

    const allPoints = strokes.flat();
    const xs = allPoints.map((point) => point.x);
    const ys = allPoints.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const aspect = width / height;

    const summarizeStroke = (stroke: Array<{ x: number; y: number }>) => {
      const start = stroke[0] ?? { x: 0, y: 0 };
      const end = stroke[stroke.length - 1] ?? start;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const spanX = Math.max(...stroke.map((point) => point.x)) - Math.min(...stroke.map((point) => point.x));
      const spanY = Math.max(...stroke.map((point) => point.y)) - Math.min(...stroke.map((point) => point.y));
      const length = stroke.slice(1).reduce((total, point, index) => {
        const previous = stroke[index] ?? point;
        return total + Math.hypot(point.x - previous.x, point.y - previous.y);
      }, 0);
      return {
        dx,
        dy,
        spanX,
        spanY,
        length,
        horizontalness: spanX / Math.max(1, spanY),
        verticalness: spanY / Math.max(1, spanX),
      };
    };

    const summaries = strokes.map(summarizeStroke);
    const horizontalStrokes = summaries.filter((stroke) => stroke.horizontalness > 3 && Math.abs(stroke.dy) < Math.max(12, stroke.spanX * 0.35));
    const verticalStrokes = summaries.filter((stroke) => stroke.verticalness > 3 && Math.abs(stroke.dx) < Math.max(12, stroke.spanY * 0.35));
    const diagonalStrokes = summaries.filter((stroke) => stroke.horizontalness < 3 && stroke.verticalness < 3 && Math.abs(stroke.dx) > 10 && Math.abs(stroke.dy) > 10);

    if (strokes.length === 1) {
      const stroke = summaries[0]!;
      if (stroke.horizontalness > 5 && width > 20) return '-';
      if (stroke.verticalness > 5 && height > 24) return '1';
      if (stroke.horizontalness < 1.6 && stroke.verticalness < 1.6) return '/';
    }

    if (strokes.length === 2) {
      if (horizontalStrokes.length === 2 && verticalStrokes.length === 0) {
        const yCenters = strokes.map((stroke) => stroke.reduce((sum, point) => sum + point.y, 0) / stroke.length).sort((a, b) => a - b);
        if (Math.abs(yCenters[1]! - yCenters[0]!) > Math.max(8, height * 0.12)) return '=';
      }

      if (horizontalStrokes.length >= 1 && verticalStrokes.length >= 1) {
        return '+';
      }

      if (diagonalStrokes.length === 2) {
        const [first, second] = diagonalStrokes;
        if (Math.sign(first.dx) !== Math.sign(second.dx)) return '×';
      }

      if (verticalStrokes.length === 1 && horizontalStrokes.length === 1) {
        return '4';
      }
    }

    const prediction = predictBasicSymbolDetailed();
    if (!prediction) return null;

    const strokeCountOkay = prediction.strokeCount <= 3;
    const simpleAspect = prediction.aspect > 0.18 && prediction.aspect < 5.5;

    if (strokeCountOkay && simpleAspect && prediction.score > 0.0065 && prediction.gap > 0.00035) {
      return prediction.candidate;
    }

    return null;
  }

  async function evaluateRecognizedWork(value: string) {
    if (!tutorContext || !value.trim()) {
      setTutorEvaluation(null);
      setTutorError(null);
      return;
    }
    setTutorError(null);
    try {
      const inkBounds = getInkBounds();
      const result = await evaluateStudentWork({
        ...tutorContext,
        recognizedText: value,
        recognizedLatex: outputMode === 'latex' ? value : null,
        canvasImageBase64: inkBounds ? exportCleanInkImageForBounds(inkBounds) : null,
      });
      setTutorEvaluation(result);
      drawTutorAnnotations(result);
    } catch (error) {
      setTutorEvaluation(null);
      setTutorError(error instanceof Error ? error.message : 'Tutor evaluation failed');
      clearTutorAnnotations();
    }
  }

  function clearTutorAnnotations() {
    const canvas = annotationCanvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !container || !ctx) return;
    const width = container.getBoundingClientRect().width;
    ctx.clearRect(0, 0, width, padHeight);
  }

  function findTargetBounds(targetText: string) {
    const normalizedTarget = targetText.replace(/\s+/g, '').toLowerCase();
    const tokens = recognizedTokenBoxesRef.current;
    for (let start = 0; start < tokens.length; start += 1) {
      let combined = '';
      for (let end = start; end < tokens.length; end += 1) {
        combined += tokens[end]!.symbol.toLowerCase();
        if (combined === normalizedTarget) {
          const slice = tokens.slice(start, end + 1);
          return {
            minX: Math.min(...slice.map((t) => t.minX)),
            maxX: Math.max(...slice.map((t) => t.maxX)),
            minY: Math.min(...slice.map((t) => t.minY)),
            maxY: Math.max(...slice.map((t) => t.maxY)),
          };
        }
        if (!normalizedTarget.startsWith(combined)) break;
      }
    }
    return null;
  }

  function drawTutorAnnotations(result: TutorEvaluationResponse) {
    const canvas = annotationCanvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !container || !ctx) return;
    clearTutorAnnotations();
    const width = container.getBoundingClientRect().width;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = '700 15px sans-serif';
    result.annotations.forEach((annotation, index) => {
      const color = annotation.color === 'green' ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = annotation.color === 'green' ? 3 : 4;
      const bounds = annotation.targetText ? findTargetBounds(annotation.targetText) : null;
      if (bounds && annotation.type === 'circle') {
        const pad = 10;
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        const rx = Math.max(18, (bounds.maxX - bounds.minX) / 2 + pad);
        const ry = Math.max(18, (bounds.maxY - bounds.minY) / 2 + pad);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, -0.08, 0, Math.PI * 2);
        ctx.stroke();
        if (annotation.text) ctx.fillText(annotation.text, Math.min(width - 220, bounds.maxX + 12), Math.max(22, bounds.minY - 8));
      } else if (bounds && annotation.type === 'underline') {
        const y = bounds.maxY + 8;
        ctx.beginPath();
        ctx.moveTo(bounds.minX - 4, y);
        ctx.quadraticCurveTo((bounds.minX + bounds.maxX) / 2, y + 6, bounds.maxX + 4, y);
        ctx.stroke();
        if (annotation.text) ctx.fillText(annotation.text, Math.min(width - 220, bounds.maxX + 12), y + 6);
      } else {
        const y = 28 + index * 26;
        ctx.fillText(annotation.text ?? annotation.targetText ?? 'Check this step', 18, y);
      }
    });
    ctx.restore();
  }

  async function sendTutorChatMessage(messageOverride?: string) {
    const message = (messageOverride ?? chatInput).trim();
    if (!message || !tutorContext) return;
    const studentMessage: TutorConversationMessage = { role: 'student', content: message };
    const nextConversation = [...chatMessages, studentMessage].slice(-12);
    setChatMessages(nextConversation);
    setChatInput('');
    setIsTutorChatting(true);
    try {
      const inkBounds = getInkBounds();
      const result = await chatWithTutor({
        ...tutorContext,
        recognizedText: recognizedText || null,
        canvasImageBase64: inkBounds ? exportCleanInkImageForBounds(inkBounds) : null,
        latestEvaluation: tutorEvaluation,
        message,
        conversation: nextConversation,
      });
      const tutorMessage: TutorConversationMessage = { role: 'tutor', content: result.reply };
      setChatMessages([...nextConversation, tutorMessage].slice(-12));
    } catch (error) {
      const tutorMessage: TutorConversationMessage = {
        role: 'tutor',
        content: error instanceof Error ? `I could not answer right now: ${error.message}` : 'I could not answer right now.',
      };
      setChatMessages([
        ...nextConversation,
        tutorMessage,
      ].slice(-12));
    } finally {
      setIsTutorChatting(false);
    }
  }

  async function autoRecognize() {
    if (!hasInk) return;

    const groups = buildGlyphGroups();
    if (groups.length >= 1 && groups.length <= 20) {
      const requestId = recognitionRequestRef.current + 1;
      recognitionRequestRef.current = requestId;
      setIsRecognizing(true);
      setRecognitionError(null);
      try {
        const layoutTree = buildLayoutTree(groups);
        const debugSink: Array<{ image: string; label: string }> = [];
        const tokenSink: Array<{ symbol: string; minX: number; maxX: number; minY: number; maxY: number }> = [];
        const rendered = await renderLayoutNodes(layoutTree, outputMode, debugSink, tokenSink);
        if (recognitionRequestRef.current !== requestId) return;
        recognizedTokenBoxesRef.current = tokenSink.sort((a, b) => a.minX - b.minX);
        setDebugGlyphPreviews(debugSink);
        if (!rendered.includes('?')) {
          setRecognizedText(rendered);
          setCandidates([rendered]);
          onUseRecognizedText(rendered);
          void evaluateRecognizedWork(rendered);
        } else {
          setRecognizedText(rendered);
          setCandidates([rendered]);
          setRecognitionError('Symbol recognition could not classify part of the input. See browser console for details.');
        }
      } catch (error) {
        if (recognitionRequestRef.current !== requestId) return;
        setRecognitionError(error instanceof Error ? error.message : 'Recognition failed');
      } finally {
        if (recognitionRequestRef.current === requestId) setIsRecognizing(false);
      }
      return;
    }

    const imageBase64 = exportCleanInkImage();
    if (!imageBase64) return;
    const requestId = recognitionRequestRef.current + 1;
    recognitionRequestRef.current = requestId;
    setIsRecognizing(true);
    setRecognitionError(null);
    try {
      const result = await recognizeHandwriting({
        imageBase64,
        preferredOutput: outputMode,
        contextHint: recognitionSeed,
      });
      if (recognitionRequestRef.current !== requestId) return;
      const next = outputMode === 'latex'
        ? (result.latex ?? result.text ?? '')
        : (result.text ?? result.latex ?? '');
      setRecognizedText(next);
      setCandidates(Array.isArray(result.candidates) ? result.candidates : []);
      onUseRecognizedText(next);
      void evaluateRecognizedWork(next);
    } catch (error) {
      if (recognitionRequestRef.current !== requestId) return;
      setRecognitionError(error instanceof Error ? error.message : 'Recognition failed');
    } finally {
      if (recognitionRequestRef.current === requestId) setIsRecognizing(false);
    }
  }

  const latexPreviewHtml = useMemo(() => {
    if (outputMode !== 'latex' || !recognizedText.trim()) return '';
    try {
      return katex.renderToString(recognizedText, { throwOnError: false, displayMode: true });
    } catch {
      return '';
    }
  }, [outputMode, recognizedText]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ color: 'var(--ll-text)', fontWeight: 900, fontSize: 13 }}>Freehand pad</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setOutputMode('text')} className={outputMode === 'text' ? 'll-btn ll-btn-primary' : 'll-btn'} style={{ padding: '8px 12px', fontSize: 12, background: outputMode === 'text' ? 'linear-gradient(135deg, #0f766e, #0891b2)' : undefined, borderColor: outputMode === 'text' ? '#0891b2' : undefined, color: outputMode === 'text' ? 'white' : undefined }}>Text</button>
          <button onClick={() => setOutputMode('latex')} className={outputMode === 'latex' ? 'll-btn ll-btn-primary' : 'll-btn'} style={{ padding: '8px 12px', fontSize: 12, background: outputMode === 'latex' ? 'linear-gradient(135deg, #7c3aed, #2563eb)' : undefined, borderColor: outputMode === 'latex' ? '#2563eb' : undefined, color: outputMode === 'latex' ? 'white' : undefined }}>LaTeX</button>
          <button onClick={() => setTool('pen')} className={tool === 'pen' ? 'll-btn ll-btn-primary' : 'll-btn'} style={{ padding: '8px 12px', fontSize: 12, background: tool === 'pen' ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : undefined, borderColor: tool === 'pen' ? '#1d4ed8' : undefined, color: tool === 'pen' ? 'white' : undefined }}>Pen</button>
          <button onClick={() => setTool('eraser')} className={tool === 'eraser' ? 'll-btn ll-btn-primary' : 'll-btn'} style={{ padding: '8px 12px', fontSize: 12, background: tool === 'eraser' ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : undefined, borderColor: tool === 'eraser' ? '#6d28d9' : undefined, color: tool === 'eraser' ? 'white' : undefined }}>Eraser</button>
          <button onClick={clearPad} className="ll-btn" style={{ padding: '8px 12px', fontSize: 12 }}>Clear</button>
        </div>
      </div>
      <div ref={containerRef} style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', border: '1px solid var(--ll-border)', background: '#091120' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={(event) => {
            const point = getPoint(event);
            if (!point) return;
            drawingRef.current = true;
            lastPointRef.current = point;
            clearTutorAnnotations();
            if (tool === 'pen') {
              strokePathRef.current.push([point]);
            }
            setHasInk(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            strokeTo(point);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) return;
            const point = getPoint(event);
            if (!point) return;
            setHasInk(true);
            if (tool === 'pen') {
              const activeStroke = strokePathRef.current[strokePathRef.current.length - 1];
              activeStroke?.push(point);
            }
            strokeTo(point);
          }}
          onPointerUp={(event) => {
            drawingRef.current = false;
            lastPointRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
            void autoRecognize();
          }}
          onPointerLeave={() => {
            drawingRef.current = false;
            lastPointRef.current = null;
            void autoRecognize();
          }}
          style={{ display: 'block', width: '100%', height: padHeight, touchAction: 'none', cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
        />
        <canvas
          ref={annotationCanvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: padHeight, pointerEvents: 'none' }}
        />
      </div>
      <div style={{ padding: '12px 14px', borderRadius: 16, border: '1px solid rgba(59,130,246,0.22)', background: 'rgba(37,99,235,0.08)' }}>
        <div style={{ color: '#93c5fd', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Digital conversion</div>
        {candidates.length > 0 ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {candidates.map((candidate) => {
            const chipValue = outputMode === 'latex' ? toLatex(candidate) : candidate;
            return (
              <button
                key={`${outputMode}_${candidate}`}
                onClick={() => {
                  setRecognizedText(chipValue);
                  onUseRecognizedText(chipValue);
                }}
                className="ll-btn"
                style={{ padding: '6px 10px', fontSize: 11, borderRadius: 999 }}
              >
                {chipValue}
              </button>
            );
            })}
          </div>
        ) : null}
        <textarea
          value={recognizedText}
          onChange={(e) => {
            setRecognizedText(e.target.value);
            onUseRecognizedText(e.target.value);
          }}
          rows={3}
          placeholder="Your handwriting turns into digital text here."
          style={{ width: '100%', padding: '12px 12px', borderRadius: 14, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 15, lineHeight: 1.5 }}
        />
        <div style={{ marginTop: 8, color: recognitionError ? '#fca5a5' : '#94a3b8', fontSize: 12, minHeight: 18 }}>
          {recognitionError ? recognitionError : isRecognizing ? 'Converting…' : ''}
        </div>
        {tutorEvaluation || tutorError ? (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 14,
              border: tutorEvaluation?.isCorrect ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(248,113,113,0.35)',
              background: tutorEvaluation?.isCorrect ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
            }}
          >
            <div style={{ color: tutorEvaluation?.isCorrect ? '#34d399' : '#f87171', fontSize: 12, fontWeight: 1000, marginBottom: 6 }}>
              {tutorError ? 'Tutor unavailable' : tutorEvaluation?.isCorrect ? 'AI tutor: correct' : 'AI tutor correction'}
            </div>
            <div style={{ color: 'var(--ll-text-soft)', fontSize: 13, lineHeight: 1.45 }}>
              {tutorError ?? tutorEvaluation?.studentMessage}
            </div>
            {tutorEvaluation?.hint ? (
              <div style={{ marginTop: 6, color: '#fde68a', fontSize: 12, lineHeight: 1.45 }}>
                Hint: {tutorEvaluation.hint}
              </div>
            ) : null}
            {tutorEvaluation?.annotations.length ? (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tutorEvaluation.annotations.map((annotation, index) => (
                  <span key={index} style={{ color: annotation.color === 'green' ? '#86efac' : '#fca5a5', fontSize: 11, fontWeight: 800 }}>
                    {annotation.targetText ? `${annotation.targetText}: ` : ''}{annotation.text ?? annotation.type}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ marginTop: 10, padding: 12, borderRadius: 14, border: '1px solid rgba(147,197,253,0.24)', background: 'rgba(15,23,42,0.55)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <div style={{ color: '#93c5fd', fontSize: 11, fontWeight: 1000, textTransform: 'uppercase', letterSpacing: 1 }}>Ask the AI tutor</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ padding: '3px 8px', borderRadius: 999, background: tutorStatus?.mode === 'external' ? 'rgba(34,197,94,0.16)' : 'rgba(148,163,184,0.16)', color: tutorStatus?.mode === 'external' ? '#86efac' : '#cbd5e1', fontSize: 10, fontWeight: 900 }}>
                {tutorStatus?.mode === 'external' ? `External AI${tutorStatus.model ? `: ${tutorStatus.model}` : ''}` : 'Local tutor'}
              </span>
              <span style={{ padding: '3px 8px', borderRadius: 999, background: tutorStatus?.visionEnabled ? 'rgba(59,130,246,0.18)' : 'rgba(148,163,184,0.12)', color: tutorStatus?.visionEnabled ? '#93c5fd' : '#94a3b8', fontSize: 10, fontWeight: 900 }}>
                {tutorStatus?.visionEnabled ? 'Vision enabled' : 'Text only'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {['Give me a hint', 'Explain why', 'What should I do next?'].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void sendTutorChatMessage(prompt)}
                className="ll-btn"
                style={{ padding: '6px 9px', fontSize: 11, borderRadius: 999 }}
              >
                {prompt}
              </button>
            ))}
          </div>
          {chatMessages.length > 0 ? (
            <div style={{ display: 'grid', gap: 6, maxHeight: 170, overflow: 'auto', marginBottom: 8 }}>
              {chatMessages.map((message, index) => (
                <div
                  key={`${message.role}_${index}`}
                  style={{
                    justifySelf: message.role === 'student' ? 'end' : 'start',
                    maxWidth: '86%',
                    padding: '8px 10px',
                    borderRadius: 12,
                    background: message.role === 'student' ? 'rgba(37,99,235,0.22)' : 'rgba(15,118,110,0.18)',
                    color: 'var(--ll-text-soft)',
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  {message.content}
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void sendTutorChatMessage();
                }
              }}
              placeholder="Ask for a hint or explanation..."
              style={{ flex: 1, minWidth: 180, padding: '9px 10px', borderRadius: 12, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)', outline: 'none', fontSize: 12 }}
            />
            <button
              type="button"
              disabled={isTutorChatting || !chatInput.trim()}
              onClick={() => void sendTutorChatMessage()}
              className="ll-btn ll-btn-primary"
              style={{ padding: '8px 11px', fontSize: 12 }}
            >
              {isTutorChatting ? '...' : 'Send'}
            </button>
          </div>
        </div>
        {debugGlyphPreviews.length > 0 ? (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700 }}>Sent to classifier:</div>
            {debugGlyphPreviews.map((preview, index) => (
              <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <img src={preview.image} alt={`glyph ${index}`} style={{ width: 56, height: 56, objectFit: 'contain', background: '#fff', border: '1px solid var(--ll-border)', borderRadius: 6 }} />
                <div style={{ color: '#cbd5e1', fontSize: 10, fontFamily: 'monospace' }}>{preview.label}</div>
              </div>
            ))}
          </div>
        ) : null}
        {outputMode === 'latex' ? (
          <div style={{ marginTop: 10, padding: 12, borderRadius: 14, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', minHeight: 72 }}>
            {latexPreviewHtml ? (
              <div dangerouslySetInnerHTML={{ __html: latexPreviewHtml }} />
            ) : (
              <div style={{ color: 'var(--ll-text-muted)', fontSize: 12 }}>LaTeX preview appears here.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function normalizeMathText(value: string): string {
  let s = value;
  // Replace LaTeX \frac{a}{b} with (a)/(b)
  for (let safety = 0; safety < 8; safety += 1) {
    const replaced = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    if (replaced === s) break;
    s = replaced;
  }
  s = s.replace(/\\times/g, '*').replace(/\\cdot/g, '*');
  s = s.replace(/\\/g, '');
  s = s.replace(/\s+/g, '');
  return s.toLowerCase();
}

function extractFinalAnswer(value: string): string {
  const normalized = normalizeMathText(value);
  if (!normalized) return '';
  // Take the rightmost segment after the last '='
  const parts = normalized.split('=').map((p) => p.trim()).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? normalized;
}

function evaluateNumericExpression(expression: string): number | null {
  if (!expression) return null;
  if (!/^[-+*/().0-9×]+$/.test(expression)) return null;
  const safe = expression.replace(/×/g, '*');
  try {
    // eslint-disable-next-line no-new-func
    const value = Function(`"use strict"; return (${safe});`)();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
  } catch {
    return null;
  }
}

function matchesNumericTarget(value: string, target: number, tolerance = 1e-6): boolean {
  const finalPart = extractFinalAnswer(value);
  if (finalPart === target.toString()) return true;
  const evaluated = evaluateNumericExpression(finalPart);
  if (evaluated === null) return null === target;
  return Math.abs(evaluated - target) < tolerance;
}

function GuidedSolveDemo() {
  const [activeStep, setActiveStep] = useState(0);
  const [slopeAnswer, setSlopeAnswer] = useState('');
  const [interceptAnswer, setInterceptAnswer] = useState('');
  const [equationAnswer, setEquationAnswer] = useState('');
  const [pointAnswer, setPointAnswer] = useState('');
  const [feedback, setFeedback] = useState<Record<number, boolean | null>>({ 0: null, 1: null, 2: null, 3: null });

  const progress = ((activeStep + 1) / 4) * 100;

  const stepCards = [
    {
      id: 'slope',
      title: 'Find the slope',
      prompt: 'Use the two points (2, 3) and (6, 7). What is the slope?',
      answer: slopeAnswer,
      setAnswer: setSlopeAnswer,
      placeholder: 'Type 1',
      expectedAnswer: '1',
      expectedReasoning: 'm = (7 - 3) / (6 - 2) = 4 / 4 = 1',
      isCorrect: (value: string) => matchesNumericTarget(value, 1),
      explanation: 'Slope = (7 - 3) / (6 - 2) = 4 / 4 = 1.',
    },
    {
      id: 'intercept',
      title: 'Find the y-intercept',
      prompt: 'Substitute one point into y = x + b. What is b?',
      answer: interceptAnswer,
      setAnswer: setInterceptAnswer,
      placeholder: 'Type 1',
      expectedAnswer: '1',
      expectedReasoning: '3 = 1·2 + b, so b = 1',
      isCorrect: (value: string) => matchesNumericTarget(value, 1),
      explanation: 'Using (2, 3): 3 = 2 + b, so b = 1.',
    },
    {
      id: 'equation',
      title: 'Write the final equation',
      prompt: 'Now combine slope and intercept into the full equation.',
      answer: equationAnswer,
      setAnswer: setEquationAnswer,
      placeholder: 'Type y = x + 1',
      expectedAnswer: 'y = x + 1',
      expectedReasoning: 'm = 1 and b = 1, so y = x + 1',
      isCorrect: (value: string) => {
        const normalized = normalizeMathText(value);
        return normalized === 'y=x+1' || normalized === 'x-y+1=0' || normalized === 'y=1+x' || normalized === 'y=x+1.0';
      },
      explanation: 'The line has slope 1 and y-intercept 1, so y = x + 1.',
    },
    {
      id: 'point',
      title: 'Give one more point on the line',
      prompt: 'Name one additional point that lies on y = x + 1.',
      answer: pointAnswer,
      setAnswer: setPointAnswer,
      placeholder: 'Example: (0,1)',
      expectedAnswer: '(0,1)',
      expectedReasoning: 'Any point where y = x + 1 is valid',
      isCorrect: (value: string) => {
        const normalized = normalizeMathText(value);
        // Accept any non-digit separator (comma, semicolon, space, etc.) between the two numbers.
        // Outer parentheses optional so handwritten coordinates without parens still pass.
        const match = normalized.match(/^\(?(-?\d+(?:\.\d+)?)[^\d\-.]+(-?\d+(?:\.\d+)?)\)?$/);
        if (!match) return false;
        const x = Number(match[1]);
        const y = Number(match[2]);
        return Math.abs(y - (x + 1)) < 1e-6;
      },
      explanation: 'Any point where y is exactly 1 more than x works, such as (0, 1).',
    },
  ] as const;

  const completedCount = Object.values(feedback).filter((value) => value === true).length;

  function getRecognitionSeed(index: number): string {
    if (index === 0) return slopeAnswer.trim() || '1';
    if (index === 1) return interceptAnswer.trim() || '1';
    if (index === 2) return equationAnswer.trim() || 'y = x + 1';
    return pointAnswer.trim() || '(0,1)';
  }

  function getPreferredOutput(index: number): 'text' | 'latex' {
    return index === 2 ? 'latex' : 'text';
  }

  function getAllowedSymbols(index: number): string[] {
    const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    if (index === 0) return [...digits, 'm', '+', '-', '=', '/', '(', ')'];
    if (index === 1) return [...digits, 'x', 'y', 'b', '+', '-', '=', '/', '(', ')'];
    if (index === 2) return [...digits, 'x', 'y', '+', '-', '='];
    return [...digits, '(', ')'];
  }

  function getTutorContext(index: number): TutorContext | undefined {
    const current = stepCards[index];
    if (!current) return undefined;
    return {
      questionId: 'line-through-two-points',
      questionPrompt: 'Find the equation of the line through (2, 3) and (6, 7).',
      activeStepId: current.id,
      activeStepTitle: current.title,
      expectedAnswer: current.expectedAnswer,
      expectedReasoning: current.expectedReasoning,
    };
  }

  function applyRecognizedTextToActiveStep(value: string) {
    if (activeStep === 0) setSlopeAnswer(value);
    else if (activeStep === 1) setInterceptAnswer(value);
    else if (activeStep === 2) setEquationAnswer(value);
    else setPointAnswer(value);
    const current = stepCards[activeStep];
    if (!current) {
      setFeedback((prev) => ({ ...prev, [activeStep]: null }));
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      setFeedback((prev) => ({ ...prev, [activeStep]: null }));
      return;
    }
    const correct = current.isCorrect(value);
    setFeedback((prev) => ({ ...prev, [activeStep]: correct }));
    if (correct && activeStep < stepCards.length - 1) {
      setActiveStep((prev) => Math.max(prev, prev + 1));
    }
  }

  return (
    <DemoShell
      eyebrow="Practical Step-Based Solve"
      title="Find the equation of the line through (2, 3) and (6, 7)"
      footer={<div style={{ color: 'var(--ll-text-soft)', fontSize: 13 }}>This is the pattern I’d use for real composite math questions: one full problem, one active step, previous work preserved, and future steps locked.</div>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ padding: 18, borderRadius: 20, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)' }}>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Question</div>
          <div style={{ color: 'var(--ll-text)', fontSize: 22, fontWeight: 1000, marginTop: 10 }}>Find the equation of the line through (2, 3) and (6, 7).</div>
        </div>

        <div style={{ padding: 18, borderRadius: 20, border: '1px solid rgba(148,163,184,0.18)', background: 'linear-gradient(180deg, rgba(15,23,42,0.65), rgba(8,17,32,0.92))' }}>
            <FreehandWorkPad
              recognitionSeed={getRecognitionSeed(activeStep)}
              preferredOutput={getPreferredOutput(activeStep)}
              onUseRecognizedText={applyRecognizedTextToActiveStep}
              allowedSymbols={getAllowedSymbols(activeStep)}
              tutorContext={getTutorContext(activeStep)}
            />
        </div>

        <div style={{ padding: 16, borderRadius: 18, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ color: 'var(--ll-text)', fontSize: 15, fontWeight: 1000 }}>{stepCards[activeStep]?.title}</div>
            <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 900 }}>Step {activeStep + 1} / 4</div>
          </div>
          <div style={{ color: 'var(--ll-text-soft)', fontSize: 14, lineHeight: 1.55, marginBottom: 12 }}>{stepCards[activeStep]?.prompt}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              value={stepCards[activeStep]?.answer ?? ''}
              onChange={(e) => {
                stepCards[activeStep]?.setAnswer(e.target.value);
                setFeedback((prev) => ({ ...prev, [activeStep]: null }));
              }}
              placeholder={stepCards[activeStep]?.placeholder}
              style={{ flex: 1, minWidth: 240, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)', outline: 'none', fontSize: 14 }}
            />
            <button
              onClick={() => {
                const current = stepCards[activeStep];
                if (!current) return;
                const correct = current.isCorrect(current.answer);
                setFeedback((prev) => ({ ...prev, [activeStep]: correct }));
                if (correct && activeStep < stepCards.length - 1) setActiveStep((prev) => Math.max(prev, prev + 1));
              }}
              className="ll-btn ll-btn-primary"
              style={{ padding: '10px 14px', fontSize: 13, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', borderColor: '#1d4ed8', color: 'white' }}
            >
              Check
            </button>
          </div>
          {feedback[activeStep] !== null ? (
            <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: feedback[activeStep] ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)', border: '1px solid rgba(148,163,184,0.18)' }}>
              <div style={{ color: feedback[activeStep] ? '#34d399' : '#fbbf24', fontWeight: 1000, marginBottom: 6 }}>{feedback[activeStep] ? 'Correct' : 'Try again'}</div>
              <div style={{ color: 'var(--ll-text-soft)', fontSize: 14, lineHeight: 1.5 }}>{stepCards[activeStep]?.explanation}</div>
            </div>
          ) : null}
        </div>
      </div>
    </DemoShell>
  );
}

function McqDemo() {
  const [selected, setSelected] = useState<number | null>(null);
  const correctIndex = 1;
  const choices = ['The slope is 1 because the points both go up.', 'The slope is 2 because rise is 8 and run is 4.', 'The slope is 1/2 because the line crosses the y-axis at 2.'];
  return (
    <DemoShell
      eyebrow="Quick Practice"
      title="What is the slope of the line through (2, 3) and (6, 11)?"
      footer={<div style={{ color: 'var(--ll-text-soft)', fontSize: 13 }}>This is ideal for warmups, ranked, and fast confidence-building drills.</div>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {choices.map((choice, idx) => {
          const show = selected !== null;
          const isCorrect = idx === correctIndex;
          const isChosen = idx === selected;
          const background = !show
            ? 'var(--ll-surface-1)'
            : isCorrect
              ? 'rgba(16,185,129,0.14)'
              : isChosen
                ? 'rgba(239,68,68,0.12)'
                : 'var(--ll-surface-1)';
          const border = !show
            ? '1px solid var(--ll-border)'
            : isCorrect
              ? '1px solid rgba(16,185,129,0.4)'
              : isChosen
                ? '1px solid rgba(239,68,68,0.35)'
                : '1px solid var(--ll-border)';
          return (
            <button
              key={choice}
              onClick={() => setSelected(idx)}
              className="ll-btn"
              style={{
                padding: '16px 18px',
                textAlign: 'left',
                background,
                border,
                borderRadius: 18,
                color: 'var(--ll-text)',
                fontSize: 15,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 6 }}>{String.fromCharCode(65 + idx)}</div>
              <div>{choice}</div>
            </button>
          );
        })}
        {selected !== null ? (
          <div style={{ padding: 14, borderRadius: 16, background: selected === correctIndex ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)', border: '1px solid rgba(148,163,184,0.2)' }}>
            <div style={{ color: selected === correctIndex ? '#34d399' : '#fbbf24', fontWeight: 1000, marginBottom: 6 }}>
              {selected === correctIndex ? 'Correct' : 'Nice try'}
            </div>
            <div style={{ color: 'var(--ll-text-soft)', fontSize: 14 }}>Rise = 11 - 3 = 8 and run = 6 - 2 = 4, so the slope is 8 / 4 = 2.</div>
          </div>
        ) : null}
      </div>
    </DemoShell>
  );
}

function NumericDemo() {
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState<boolean | null>(null);
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '-', '.', '0', '⌫'];
  return (
    <DemoShell
      eyebrow="Fluency Input"
      title="Find the y-intercept if the line is y = 3x + 5"
      footer={<div style={{ color: 'var(--ll-text-soft)', fontSize: 13 }}>The keypad makes math input feel intentional and cuts typing friction on student devices.</div>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 18 }}>
        <div>
          <div style={{ color: 'var(--ll-text-soft)', fontSize: 13, marginBottom: 10 }}>Answer</div>
          <div style={{ padding: '18px 16px', borderRadius: 18, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', fontSize: 28, fontWeight: 1000, color: 'var(--ll-text)', minHeight: 72, display: 'flex', alignItems: 'center' }}>
            {value || <span style={{ color: 'var(--ll-text-muted)' }}>Tap the keypad…</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              onClick={() => setChecked(value.trim() === '5')}
              className="ll-btn ll-btn-primary"
              disabled={!value.trim()}
              style={{ padding: '10px 14px', fontSize: 13, background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', borderColor: '#1d4ed8', color: 'white' }}
            >
              Check Answer
            </button>
            <button onClick={() => { setValue(''); setChecked(null); }} className="ll-btn" style={{ padding: '10px 14px', fontSize: 13 }}>Reset</button>
          </div>
          {checked !== null ? (
            <div style={{ marginTop: 14, padding: 14, borderRadius: 16, background: checked ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)', border: '1px solid rgba(148,163,184,0.2)' }}>
              <div style={{ color: checked ? '#34d399' : '#fca5a5', fontWeight: 1000, marginBottom: 6 }}>{checked ? 'Exactly right' : 'Not quite yet'}</div>
              <div style={{ color: 'var(--ll-text-soft)', fontSize: 14 }}>In slope-intercept form `y = mx + b`, the y-intercept is `b`, so the answer is 5.</div>
            </div>
          ) : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, alignContent: 'start' }}>
          {keys.map((key) => (
            <button
              key={key}
              onClick={() => {
                setChecked(null);
                if (key === '⌫') setValue((prev) => prev.slice(0, -1));
                else if (key === '-') setValue((prev) => (prev.startsWith('-') ? prev.slice(1) : `-${prev}`));
                else setValue((prev) => `${prev}${key}`);
              }}
              className="ll-btn"
              style={{ padding: '14px 0', fontSize: 18, fontWeight: 1000, borderRadius: 16, background: 'color-mix(in srgb, var(--ll-surface-1) 92%, #1e293b 8%)' }}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </DemoShell>
  );
}

function EquationDemo() {
  const [slope, setSlope] = useState('2');
  const [intercept, setIntercept] = useState('-1');
  const preview = useMemo(() => {
    const m = slope.trim() || 'm';
    const b = intercept.trim();
    if (!b) return `y = ${m}x + b`;
    return Number(b) < 0 ? `y = ${m}x - ${String(Math.abs(Number(b)))}` : `y = ${m}x + ${b}`;
  }, [slope, intercept]);
  return (
    <DemoShell
      eyebrow="Scaffolded Equation Input"
      title="Build the equation of a line with slope 2 and y-intercept -1"
      footer={<div style={{ color: 'var(--ll-text-soft)', fontSize: 13 }}>This is less intimidating than a blank text box and still teaches the underlying structure.</div>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
        <div style={{ padding: 16, borderRadius: 18, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)' }}>
          <div style={{ color: 'var(--ll-text)', fontWeight: 900, marginBottom: 10 }}>Equation Builder</div>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: 'var(--ll-text-soft)', fontSize: 12 }}>Slope (m)</span>
              <input value={slope} onChange={(e) => setSlope(e.target.value)} style={{ padding: '12px 12px', borderRadius: 12, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)', outline: 'none' }} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ color: 'var(--ll-text-soft)', fontSize: 12 }}>Y-intercept (b)</span>
              <input value={intercept} onChange={(e) => setIntercept(e.target.value)} style={{ padding: '12px 12px', borderRadius: 12, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)', color: 'var(--ll-text)', outline: 'none' }} />
            </label>
          </div>
        </div>
        <div style={{ padding: 16, borderRadius: 18, border: '1px solid rgba(59,130,246,0.25)', background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(124,58,237,0.10))' }}>
          <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>Live Preview</div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 32, marginTop: 20, minHeight: 44 }}>{preview}</div>
          <div style={{ color: '#cbd5e1', fontSize: 14, marginTop: 18, lineHeight: 1.5 }}>You can later offer an advanced mode that also accepts raw equation text like `2x - y - 1 = 0`.</div>
        </div>
      </div>
    </DemoShell>
  );
}

function PointDemo() {
  const [points, setPoints] = useState<Point[]>([]);
  const gridSize = 5;
  const dots = Array.from({ length: gridSize * gridSize }, (_, idx) => {
    const x = idx % gridSize;
    const y = gridSize - 1 - Math.floor(idx / gridSize);
    return { x, y };
  });
  const target = new Set(['0,1', '1,3', '2,5'].filter((key) => !key.endsWith(',5')));
  return (
    <DemoShell
      eyebrow="Visual Coordinate Input"
      title="Tap points that lie on y = 2x + 1"
      footer={<div style={{ color: 'var(--ll-text-soft)', fontSize: 13 }}>For a real version, I’d extend the grid range and support dragging, deleting, and line overlays.</div>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 18 }}>
        <div style={{ padding: 16, borderRadius: 18, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, 1fr)`, gap: 10 }}>
            {dots.map((dot) => {
              const key = `${dot.x},${dot.y}`;
              const active = points.some((p) => p.x === dot.x && p.y === dot.y);
              return (
                <button
                  key={key}
                  onClick={() => setPoints((prev) => active ? prev.filter((p) => !(p.x === dot.x && p.y === dot.y)) : [...prev, { x: dot.x, y: dot.y }])}
                  className="ll-btn"
                  style={{
                    aspectRatio: '1 / 1',
                    borderRadius: 18,
                    padding: 0,
                    background: active ? 'linear-gradient(135deg, #22c55e, #06b6d4)' : 'var(--ll-surface-0)',
                    border: active ? '1px solid rgba(110,231,183,0.5)' : '1px solid var(--ll-border)',
                    color: active ? 'white' : 'var(--ll-text)',
                    fontWeight: 900,
                  }}
                >
                  ({dot.x},{dot.y})
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ padding: 16, borderRadius: 18, border: '1px solid var(--ll-border)', background: 'var(--ll-surface-0)' }}>
          <div style={{ color: 'var(--ll-text)', fontWeight: 900, marginBottom: 10 }}>Selected points</div>
          <div style={{ color: 'var(--ll-text-soft)', fontSize: 14, lineHeight: 1.5, minHeight: 96 }}>
            {points.length === 0 ? 'Tap any points on the grid.' : points.map((point) => `(${point.x}, ${point.y})`).join(', ')}
          </div>
          <button onClick={() => setPoints([])} className="ll-btn" style={{ marginTop: 12, padding: '10px 12px', fontSize: 13 }}>Clear points</button>
        </div>
      </div>
    </DemoShell>
  );
}

function MistakeDemo() {
  const [answer, setAnswer] = useState<number | null>(null);
  return (
    <DemoShell
      eyebrow="Mistake Hunt"
      title="Which step in this worked solution is wrong?"
      footer={<div style={{ color: 'var(--ll-text-soft)', fontSize: 13 }}>This is a strong teaching format because the student critiques reasoning instead of only chasing final answers.</div>}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ padding: 16, borderRadius: 18, background: 'var(--ll-surface-1)', border: '1px solid var(--ll-border)' }}>
          <div style={{ color: 'var(--ll-text)', fontWeight: 900, marginBottom: 10 }}>Worked solution shown to the student</div>
          <div style={{ display: 'grid', gap: 8, color: 'var(--ll-text-soft)', fontSize: 15, lineHeight: 1.5 }}>
            <div><strong style={{ color: 'var(--ll-text)' }}>Step 1:</strong> Slope = (9 - 5) / (7 - 3) = 4 / 4 = 1</div>
            <div><strong style={{ color: 'var(--ll-text)' }}>Step 2:</strong> Therefore the equation is y = x + 5</div>
            <div><strong style={{ color: 'var(--ll-text)' }}>Step 3:</strong> Check with point (3, 5): 5 = 3 + 5</div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          {['Step 1 is wrong', 'Step 2 is wrong', 'Step 3 is wrong'].map((label, idx) => {
            const isChosen = answer === idx;
            const isCorrect = idx === 1;
            return (
              <button
                key={label}
                onClick={() => setAnswer(idx)}
                className="ll-btn"
                style={{
                  padding: '14px 16px',
                  textAlign: 'left',
                  borderRadius: 16,
                  background: answer === null ? 'var(--ll-surface-1)' : isCorrect ? 'rgba(16,185,129,0.12)' : isChosen ? 'rgba(239,68,68,0.10)' : 'var(--ll-surface-1)',
                  border: answer === null ? '1px solid var(--ll-border)' : isCorrect ? '1px solid rgba(16,185,129,0.35)' : isChosen ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--ll-border)',
                  color: 'var(--ll-text)',
                  fontSize: 14,
                  fontWeight: 900,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {answer !== null ? (
          <div style={{ padding: 14, borderRadius: 16, background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.24)' }}>
            <div style={{ color: '#93c5fd', fontWeight: 1000, marginBottom: 6 }}>Why Step 2 is wrong</div>
            <div style={{ color: 'var(--ll-text-soft)', fontSize: 14, lineHeight: 1.5 }}>The slope is correct, but plugging in (3, 5) into `y = x + 5` gives `5 = 8`, which fails. The correct equation is `y = x + 2`.</div>
          </div>
        ) : null}
      </div>
    </DemoShell>
  );
}

export default function MathInteractionDemoView() {
  const [, setLocation] = useLocation();
  const [current, setCurrent] = useState<DemoStep>('guided');
  const stepIndex = steps.findIndex((step) => step.id === current);
  const currentMeta = steps[stepIndex] ?? steps[0]!;

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(circle at top, rgba(37,99,235,0.18), transparent 35%), linear-gradient(180deg, var(--ll-surface-0), #08111f)', color: 'var(--ll-text)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 20px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <button onClick={() => setLocation('/superadmin')} className="ll-btn" style={{ padding: '8px 12px', fontSize: 12 }}>← Back</button>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 12, fontWeight: 900 }}>Temporary demo route: /demo/math-interactions</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: 20, borderRadius: 24, border: '1px solid var(--ll-border)', background: 'linear-gradient(180deg, color-mix(in srgb, var(--ll-surface-1) 94%, transparent 6%), color-mix(in srgb, var(--ll-surface-0) 98%, transparent 2%))' }}>
              <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 1000, textTransform: 'uppercase', letterSpacing: 1 }}>Interactive math UX demo</div>
              <div style={{ fontSize: 32, fontWeight: 1000, lineHeight: 1.08, marginTop: 10 }}>This is how the product can feel.</div>
              <div style={{ color: 'var(--ll-text-soft)', fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>
                The main event is the guided solve flow for step-heavy math. The other tabs are supporting interaction patterns you can reuse inside that flow.
              </div>
            </div>

            <div style={{ padding: 18, borderRadius: 24, border: '1px solid var(--ll-border)', background: 'color-mix(in srgb, var(--ll-surface-1) 95%, transparent 5%)' }}>
              <div style={{ color: 'var(--ll-text)', fontSize: 13, fontWeight: 1000, marginBottom: 10 }}>Try the interaction patterns</div>
              <StepPills current={current} onSelect={setCurrent} />
              <div style={{ marginTop: 14, padding: 12, borderRadius: 16, background: 'var(--ll-surface-0)', border: '1px solid var(--ll-border)' }}>
                <div style={{ color: 'var(--ll-text)', fontWeight: 900 }}>{currentMeta.title}</div>
                <div style={{ color: 'var(--ll-text-soft)', fontSize: 13, marginTop: 4 }}>{currentMeta.subtitle}</div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 12 }}>Step {stepIndex + 1} of {steps.length}</div>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 18 }}>
            {current === 'guided' ? <GuidedSolveDemo /> : null}
            {current === 'mcq' ? <McqDemo /> : null}
            {current === 'numeric' ? <NumericDemo /> : null}
            {current === 'equation' ? <EquationDemo /> : null}
            {current === 'points' ? <PointDemo /> : null}
            {current === 'mistake' ? <MistakeDemo /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
