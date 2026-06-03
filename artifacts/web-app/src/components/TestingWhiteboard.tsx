import { useState, useEffect, useRef, useCallback } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/* ═══════════════════════════════════════════════════════════════
   Spatial Coordinate Block — one recognized text element
   positioned at the same (x, y) it was handwritten
   ═══════════════════════════════════════════════════════════════ */
interface ConvertedBlock {
  id: string;
  text: string;           // plain text label
  latex: string;          // LaTeX string (if available)
  x: number;              // normalized X (0–1)
  y: number;              // normalized Y (0–1)
  width: number;          // normalized width
  height: number;         // normalized height
  fontSize: number;       // computed from bounding box height
}

/* ═══════════════════════════════════════════════════════════════
   LLM Hook Stub — future grading endpoint
   ═══════════════════════════════════════════════════════════════ */

/** @placeholder Route spatial canvas data to Gemini/ChatGPT for physics and math grading */
async function handleLLMCorrection(canvasData: ConvertedBlock[]): Promise<void> {
  // TODO: POST canvasData to /api/llm-grade endpoint
  // The canvasData array contains all text blocks with their spatial coordinates,
  // which can be used by the LLM to understand the layout of the student's work.
  console.log('[LLM Hook] Canvas data ready for grading:', canvasData);
}

/* ═══════════════════════════════════════════════════════════════
   Color Palette & Tool Definitions
   ═══════════════════════════════════════════════════════════════ */
const COLORS = [
  { value: '#0f172a', label: 'Dark' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#dc2626', label: 'Red' },
  { value: '#059669', label: 'Green' },
  { value: '#d97706', label: 'Amber' },
  { value: '#7c3aed', label: 'Purple' },
];

type ToolType = 'write' | 'erase' | 'select' | 'line' | 'circle' | 'rectangle' | 'arrow';
const SHAPE_TOOLS: ToolType[] = ['line', 'circle', 'rectangle', 'arrow'];

/* ═══════════════════════════════════════════════════════════════
   JIIX Parser — Extract spatial blocks from MyScript JIIX export
   ═══════════════════════════════════════════════════════════════ */
function parseJIIXToBlocks(jiix: any, canvasWidth: number, canvasHeight: number, contentType: string = 'TEXT'): ConvertedBlock[] {
  if (!jiix) return [];
  const blocks: ConvertedBlock[] = [];

  // Determine canvas bounds from JIIX (used for normalization)
  // iink 1.x uses flat words; iink 2.x may nest inside elements
  const elements: any[] = jiix.elements || jiix.words || jiix.expressions || [];
  if (!Array.isArray(elements) || elements.length === 0) {
    // Fallback: if JIIX has only a top-level label, place it centered
    const label = jiix.label || jiix.value || '';
    const latex = jiix.latex || '';
    if (label || latex) {
      blocks.push({
        id: 'root-0',
        text: String(label),
        latex: String(latex),
        x: 0.05,
        y: 0.05,
        width: 0.9,
        height: 0.06,
        fontSize: 18,
      });
    }
    return blocks;
  }

  // Compute the global bounding envelope for normalization
  let globalMinX = Infinity, globalMinY = Infinity;
  let globalMaxX = -Infinity, globalMaxY = -Infinity;

  for (const el of elements) {
    const bb = el['bounding-box'] || el.boundingBox || el;
    const x = bb.x ?? bb.left ?? 0;
    const y = bb.y ?? bb.top ?? 0;
    const w = bb.width ?? 0;
    const h = bb.height ?? 0;
    if (x < globalMinX) globalMinX = x;
    if (y < globalMinY) globalMinY = y;
    if (x + w > globalMaxX) globalMaxX = x + w;
    if (y + h > globalMaxY) globalMaxY = y + h;
  }

  const envW = Math.max(1, globalMaxX - globalMinX);
  const envH = Math.max(1, globalMaxY - globalMinY);

  // 1. If we are in MATH mode, stop granular iteration.
  // Read the top-level math structure block as a single, unified string.
  if (contentType === 'MATH' && jiix.latex) {
    const rawX = jiix['bounding-box']?.x ?? globalMinX;
    const rawY = jiix['bounding-box']?.y ?? globalMinY;
    const rawW = jiix['bounding-box']?.width ?? envW;
    const rawH = jiix['bounding-box']?.height ?? envH;

    const pad = 0.03;
    const normX = pad + ((rawX - globalMinX) / envW) * (1 - 2 * pad);
    const normY = pad + ((rawY - globalMinY) / envH) * (1 - 2 * pad);
    const normW = (rawW / envW) * (1 - 2 * pad);
    const normH = (rawH / envH) * (1 - 2 * pad);

    const computedFontSize = Math.max(16, Math.min(48, Math.round(normH * canvasHeight * 0.8)));

    blocks.push({
      id: 'math-root',
      text: jiix.label || '',
      latex: jiix.latex,
      x: normX,
      y: normY,
      width: normW,
      height: normH,
      fontSize: computedFontSize,
    });
    return blocks;
  }

  // 2. Fallback recursive structural extraction for TEXT mode
  function extractBlocks(items: any[], depth = 0) {
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      const label = el.label ?? el.value ?? el.text ?? '';
      const latex = el.latex ?? '';
      
      const bb = el['bounding-box'] || el.boundingBox || el;
      const hasBoundingBox = bb && typeof bb.width === 'number';

      // Group by Structural Blocks: Stop at TextLine, or any node providing latex, or leaf nodes
      const isTarget = hasBoundingBox && (el.type === 'TextLine' || latex || (!el.elements && !el.children && !el.words && !el.expressions && label));

      if (isTarget && (label || latex)) {
        const rawX = bb.x ?? bb.left ?? 0;
        const rawY = bb.y ?? bb.top ?? 0;
        const rawW = bb.width ?? envW * 0.1;
        const rawH = bb.height ?? envH * 0.05;

        const pad = 0.03;
        const normX = pad + ((rawX - globalMinX) / envW) * (1 - 2 * pad);
        const normY = pad + ((rawY - globalMinY) / envH) * (1 - 2 * pad);
        const normW = (rawW / envW) * (1 - 2 * pad);
        const normH = (rawH / envH) * (1 - 2 * pad);

        const computedFontSize = Math.max(12, Math.min(36, Math.round(normH * canvasHeight * 0.7)));

        blocks.push({
          id: `block-${depth}-${i}`,
          text: String(label),
          latex: String(latex),
          x: normX,
          y: normY,
          width: normW,
          height: normH,
          fontSize: computedFontSize,
        });
        
        // Stop recursion for this branch to prevent character scattering
        continue;
      }

      // If not a target structural block, keep digging
      if (el.elements) extractBlocks(el.elements, depth + 1);
      else if (el.expressions) extractBlocks(el.expressions, depth + 1);
      else if (el.children) extractBlocks(el.children, depth + 1);
      else if (el.words) extractBlocks(el.words, depth + 1);
    }
  }

  extractBlocks(elements);
  return blocks;
}

/* ═══════════════════════════════════════════════════════════════
   TestingWhiteboard — Premium Dual-Board Component
   ═══════════════════════════════════════════════════════════════ */
export default function TestingWhiteboard() {
  // ── Core Refs ──
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<any>(null);
  const outputBoardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // ── SDK State ──
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [initStatus, setInitStatus] = useState<string | null>(null);

  // ── Tool State ──
  const [activeTool, setActiveTool] = useState<ToolType>('write');
  const [strokeColor, setStrokeColor] = useState('#0f172a');
  const [strokeWidth, setStrokeWidth] = useState(2.5);

  // ── Export State ──
  const [exportFormat, setExportFormat] = useState<'text' | 'latex'>('text');
  const exportFormatRef = useRef(exportFormat);
  useEffect(() => { exportFormatRef.current = exportFormat; }, [exportFormat]);

  // ── History (Undo/Redo) ──
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // ── Spatial Output State ──
  const [convertedCanvasState, setConvertedCanvasState] = useState<ConvertedBlock[]>([]);
  const [recognizedPlain, setRecognizedPlain] = useState('');

  // ═══════════════════════════════════════════════════════════════
  //  MyScript Asset Loader
  // ═══════════════════════════════════════════════════════════════
  async function loadMyScriptAssets() {
    const jsUrl = (import.meta.env.VITE_MYSCRIPT_JS_URL as string | undefined) || 'https://cdn.jsdelivr.net/npm/iink-js@1.4.5/dist/iink.min.js';
    const cssUrl = (import.meta.env.VITE_MYSCRIPT_CSS_URL as string | undefined) || 'https://cdn.jsdelivr.net/npm/iink-js@1.4.5/dist/iink.min.css';

    // Load CSS
    if (!document.querySelector('link[data-myscript-css]')) {
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        link.setAttribute('data-myscript-css', 'true');
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('Failed to load MyScript CSS'));
        document.head.appendChild(link);
      });
    }

    // Load JS
    if (!document.querySelector('script[data-myscript-js]')) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = jsUrl;
        script.setAttribute('data-myscript-js', 'true');
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load MyScript JS'));
        document.head.appendChild(script);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  THE SINGLE, CLEAN INITIALIZATION HOOK
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;

    const initBoard = async () => {
      try {
        await loadMyScriptAssets();
        if (cancelled) return;
        setSdkLoaded(true);

        // Wait for host element to mount
        let tries = 0;
        while (!cancelled && !editorHostRef.current && tries < 20) {
          tries += 1;
          await new Promise(r => setTimeout(r, 50));
        }
        if (cancelled || !editorHostRef.current) return;

        const host = editorHostRef.current;
        const ns = ((import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink').trim();
        const appKey = (import.meta.env.VITE_MYSCRIPT_APP_KEY as string | undefined) || 'a75f9183-fdc7-4c90-958b-a13c9d587db2';
        const hmacKey = (import.meta.env.VITE_MYSCRIPT_HMAC_KEY as string | undefined) || 'e07209ce-819b-4a2f-9ace-7f3b5172fade';
        const contentType = exportFormatRef.current === 'latex' ? 'MATH' : 'TEXT';

        // ── Secure context guard (preserves existing crypto.subtle check) ──
        if (window && (window as any).isSecureContext === false) {
          throw new Error('Secure context required: open via localhost or https so crypto.subtle is available');
        }

        if (!appKey || !hmacKey) throw new Error('Missing MyScript App/HMAC Keys');

        // ── classList object patch (preserves existing malformed-token guard) ──
        try {
          const origAdd = host.classList.add.bind(host.classList);
          const origRem = host.classList.remove.bind(host.classList);
          (host.classList as any).add = (...tokens: any[]) => {
            const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
            if (valid.length) origAdd(...valid);
          };
          (host.classList as any).remove = (...tokens: any[]) => {
            const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
            if (valid.length) origRem(...valid);
          };
        } catch { /* guard only */ }

        const serverScheme = (import.meta.env.VITE_MYSCRIPT_SERVER_SCHEME as string | undefined) || 'https';
        const serverHost = (import.meta.env.VITE_MYSCRIPT_SERVER_HOST as string | undefined) || 'cloud.myscript.com';
        const serverCfg = { scheme: serverScheme, host: serverHost, applicationKey: appKey, hmacKey };

        // ── THE OMNI-CONFIG (Smart Guide disabled, JIIX export enabled) ──
        const options: any = {
          configuration: {
            server: serverCfg,
            recognition: { type: contentType, protocol: 'WEBSOCKET' },
            text: { smartGuide: { enable: false }, mimeTypes: ['text/plain', 'application/vnd.myscript.jiix'] },
            math: { smartGuide: { enable: false }, mimeTypes: ['application/x-latex', 'application/vnd.myscript.jiix'] },
            export: { jiix: { 'bounding-box': true } },
          },
          recognitionParams: {
            type: contentType,
            protocol: 'WEBSOCKET',
            server: serverCfg,
            text: { smartGuide: { enable: false } },
            math: { smartGuide: { enable: false } },
            iink: { export: { jiix: { 'bounding-box': true } } },
          },
          theme: {
            ink: { color: '#0f172a', '-myscript-pen-width': 2.5 },
            '.text': { color: '#0f172a', 'font-size': 20 },
          },
        };

        // ── Editor instantiation (multi-strategy) ──
        const w: any = window;
        const api = w[ns];
        if (!api) throw new Error('MyScript API not loaded on window.' + ns);

        let ed: any = null;
        if (api.EditorFactory && typeof api.EditorFactory.createEditor === 'function') {
          ed = await api.EditorFactory.createEditor(host, contentType, options);
        } else if (typeof api.createEditor === 'function') {
          ed = await api.createEditor(host, options);
        } else if (typeof api.Editor === 'function') {
          ed = new api.Editor(host, options);
          if (typeof ed.init === 'function') await ed.init(host, options);
          else if (typeof ed.mount === 'function') await ed.mount(host, options);
        }

        if (!ed) throw new Error('Failed to instantiate editor via window.' + ns);
        editorInstanceRef.current = ed;
        (window as any).debugEditor = ed;
        setInitStatus('Ready');

        // ── Set write mode ──
        try {
          const tool = api?.EditorTool?.Write || api?.EditorWriteTool || 'write';
          if (typeof ed.setTool === 'function') ed.setTool(tool);
          else if (typeof ed.setMode === 'function') ed.setMode('write');
          setActiveTool('write');
        } catch { /* guard */ }

        // ── Focus + touch setup ──
        try {
          host.style.touchAction = 'none';
          host.style.cursor = 'crosshair';
          host.focus();
        } catch { /* guard */ }

        // ── Resize handler ──
        try {
          if (typeof ed.resize === 'function') {
            ed.resize();
            setTimeout(() => { try { ed.resize(); } catch { } }, 100);
          }
          const resizeHandler = () => { try { ed.resize?.(); } catch { } };
          window.addEventListener('resize', resizeHandler);
          (ed as any).__resizeHandler = resizeHandler;
        } catch { /* guard */ }

        // ═══════════════════════════════════════════════════════════
        //  Real-time JIIX Export + Spatial Mapping via 'exported' event
        // ═══════════════════════════════════════════════════════════
        const onExported = (evt: any) => {
          try {
            const exportsObj = evt?.detail?.exports;
            if (!exportsObj) return;

            // Extract JIIX for spatial mapping
            const jiixRaw = exportsObj['application/vnd.myscript.jiix'];
            let jiix: any = null;
            if (typeof jiixRaw === 'string') {
              try { jiix = JSON.parse(jiixRaw); } catch { jiix = null; }
            } else if (jiixRaw && typeof jiixRaw === 'object') {
              jiix = jiixRaw;
            }

            // Get canvas dimensions for normalization
            const hostRect = host.getBoundingClientRect();
            const cW = hostRect.width || 800;
            const cH = hostRect.height || 520;

            if (jiix) {
              const blocks = parseJIIXToBlocks(jiix, cW, cH, contentType);
              setConvertedCanvasState(blocks);
            }

            // Also set plain recognized text as fallback
            const plain = exportsObj['text/plain'] || jiix?.label || '';
            const latex = exportsObj['application/x-latex'] || jiix?.latex || '';
            const displayText = (exportFormatRef.current === 'latex' ? latex : plain) || plain || latex || '';
            setRecognizedPlain(displayText);

            // If no JIIX blocks but we have text, create a fallback block
            if ((!jiix || parseJIIXToBlocks(jiix, cW, cH, contentType).length === 0) && displayText) {
              setConvertedCanvasState([{
                id: 'fallback-0',
                text: displayText,
                latex: latex || '',
                x: 0.04,
                y: 0.04,
                width: 0.92,
                height: 0.08,
                fontSize: 18,
              }]);
            }
          } catch (err) {
            console.error('[TestingWhiteboard] Error processing export:', err);
          }
        };

        const onChanged = (evt: any) => {
          // Update undo/redo history state if available in event detail
          if (evt?.detail) {
            // Can sync undo/redo state here if we need to disable buttons
          }
        };

        host.addEventListener('changed', onChanged);
        host.addEventListener('exported', onExported);

      } catch (e: any) {
        if (!cancelled) setSdkError(e.message || String(e));
      }
    };

    initBoard();

    return () => {
      cancelled = true;
      try {
        const inst = editorInstanceRef.current;
        if (inst) {
          if (typeof inst.destroy === 'function') inst.destroy();
          if ((inst as any).__resizeHandler) {
            window.removeEventListener('resize', (inst as any).__resizeHandler);
          }
        }
      } catch { /* guard */ }
      editorInstanceRef.current = null;
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════
  //  Dynamic Content-Type Hot Swapping
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (editorInstanceRef.current) {
      const newType = exportFormat === 'latex' ? 'MATH' : 'TEXT';
      const currentConfig = editorInstanceRef.current.configuration;
      
      // Safely update the nested recognition params
      if (currentConfig.recognitionParams) {
        currentConfig.recognitionParams.type = newType;
      }
      currentConfig.recognition = { type: newType, protocol: 'WEBSOCKET' };
      
      // Re-apply configuration and CLEAR the board to prevent engine panic/ink dropping
      editorInstanceRef.current.configuration = currentConfig;
      editorInstanceRef.current.clear();
      setRecognizedPlain('');
      setConvertedCanvasState([]);
    }
  }, [exportFormat]);

  // ═══════════════════════════════════════════════════════════════
  //  Keyboard Shortcuts
  // ═══════════════════════════════════════════════════════════════
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editorInstanceRef.current) return;
      // Undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      // Redo
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  // ═══════════════════════════════════════════════════════════════
  //  Tool Actions
  // ═══════════════════════════════════════════════════════════════
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      const inst = editorInstanceRef.current;
      if (inst && typeof inst.undo === 'function') {
        inst.undo();
      } else if (inst && typeof inst.import_ === 'function') {
        inst.import_(history[historyIndex - 1]);
      }
    }
  }, [historyIndex, history]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      const inst = editorInstanceRef.current;
      if (inst && typeof inst.redo === 'function') {
        inst.redo();
      } else if (inst && typeof inst.import_ === 'function') {
        inst.import_(history[historyIndex + 1]);
      }
    }
  }, [historyIndex, history]);

  const handleClear = useCallback(() => {
    const inst = editorInstanceRef.current;
    if (inst && typeof inst.clear === 'function') {
      inst.clear();
    }
    setConvertedCanvasState([]);
    setRecognizedPlain('');
  }, []);

  const switchTool = useCallback((tool: ToolType) => {
    const inst = editorInstanceRef.current;
    if (!inst) return;
    try {
      const ns = ((import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink').trim();
      const api: any = (window as any)[ns];
      if (tool === 'write') {
        const t = api?.EditorTool?.Write || 'write';
        if (typeof inst.setTool === 'function') inst.setTool(t);
        else if (typeof inst.setMode === 'function') inst.setMode('write');
      } else if (tool === 'erase') {
        const t = api?.EditorTool?.Erase || 'erase';
        if (typeof inst.setTool === 'function') inst.setTool(t);
        else if (typeof inst.setMode === 'function') inst.setMode('erase');
      }
    } catch { /* guard */ }
    setActiveTool(tool);
  }, []);

  const handleColorChange = useCallback((color: string) => {
    setStrokeColor(color);
    const inst = editorInstanceRef.current;
    if (inst) {
      try {
        if (typeof inst.setPenColor === 'function') inst.setPenColor(color);
        else if (typeof inst.penColor === 'string') inst.penColor = color;
        else if (inst.theme) {
          inst.theme = { ...inst.theme, ink: { ...inst.theme?.ink, color } };
        }
      } catch { /* guard */ }
    }
  }, []);

  const handleStrokeWidthChange = useCallback((width: number) => {
    setStrokeWidth(width);
    const inst = editorInstanceRef.current;
    if (inst) {
      try {
        if (typeof inst.setPenWidth === 'function') inst.setPenWidth(width);
        else if (typeof inst.penWidth === 'number') inst.penWidth = width;
      } catch { /* guard */ }
    }
  }, []);

  const handleExport = useCallback(async () => {
    const inst = editorInstanceRef.current;
    if (!inst) return;
    try {
      if (typeof inst.export === 'function') {
        const exp = await inst.export();
        const text = exportFormat === 'latex'
          ? (exp?.['application/x-latex'] || exp?.LATEX || exp?.LaTeX || exp?.latex || '')
          : (exp?.['text/plain'] || '');
        setRecognizedPlain(text || '');
      }
    } catch { /* guard */ }
  }, [exportFormat]);

  const handleSavePNG = useCallback(() => {
    const host = editorHostRef.current;
    if (!host) return;
    const canvas = host.querySelector('canvas') || host.querySelector('svg');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.png`;
    if (canvas instanceof HTMLCanvasElement) {
      link.href = canvas.toDataURL();
    } else if (canvas instanceof SVGElement) {
      const svgData = new XMLSerializer().serializeToString(canvas);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      link.href = URL.createObjectURL(svgBlob);
    }
    link.click();
  }, []);

  const handleSaveJSON = useCallback(() => {
    const data = {
      blocks: convertedCanvasState,
      recognizedPlain,
      exportFormat,
      strokeColor,
      strokeWidth,
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
  }, [convertedCanvasState, recognizedPlain, exportFormat, strokeColor, strokeWidth]);

  // ═══════════════════════════════════════════════════════════════
  //  Fallback Canvas Drawing (when SDK not yet loaded or for shapes/eraser)
  // ═══════════════════════════════════════════════════════════════
  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const drawShape = (ctx: CanvasRenderingContext2D, start: {x: number, y: number}, end: {x: number, y: number}, tool: ToolType) => {
    ctx.beginPath();
    if (tool === 'line') {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    } else if (tool === 'rectangle') {
      ctx.rect(start.x, start.y, end.x - start.x, end.y - start.y);
    } else if (tool === 'circle') {
      const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
      ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
    } else if (tool === 'arrow') {
      const headlen = 10;
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.lineTo(end.x - headlen * Math.cos(angle - Math.PI / 6), end.y - headlen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headlen * Math.cos(angle + Math.PI / 6), end.y - headlen * Math.sin(angle + Math.PI / 6));
    }
    ctx.stroke();
  };

  // For shape preview
  const [shapeStart, setShapeStart] = useState<{x: number, y: number} | null>(null);

  // Resize observer to ensure fallback canvas resolution matches display size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = getPoint(e);
    last.current = p;
    if (SHAPE_TOOLS.includes(activeTool) && p) {
      setShapeStart(p);
    }
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const p = getPoint(e);
    const l = last.current;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !p || !l) return;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = strokeWidth;

    if (activeTool === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = strokeWidth * 2; // Make eraser wider
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (!SHAPE_TOOLS.includes(activeTool)) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = strokeColor;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    last.current = p;
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    
    // Finalize shape
    if (drawing.current && shapeStart && SHAPE_TOOLS.includes(activeTool)) {
      const p = getPoint(e);
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx && p) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        drawShape(ctx, shapeStart, p, activeTool);
      }
    }

    drawing.current = false;
    last.current = null;
    setShapeStart(null);
  }

  // ═══════════════════════════════════════════════════════════════
  //  Helper: CSS class for active tool button
  // ═══════════════════════════════════════════════════════════════
  const toolBtnClass = (tool: ToolType) => {
    if (activeTool !== tool) return 'wb-toolbar-btn';
    if (tool === 'erase') return 'wb-toolbar-btn active-erase';
    if (SHAPE_TOOLS.includes(tool)) return 'wb-toolbar-btn active-shape';
    return 'wb-toolbar-btn active';
  };

  // ═══════════════════════════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════════════════════════
  const hasEditor = !!editorInstanceRef.current;
  const hasBlocks = convertedCanvasState.length > 0;

  return (
    <>
      <div className="wb-workspace">
        {/* ── Header Bar ── */}
        <div className="wb-header">
          <div className="wb-header-title">
            <span style={{ fontSize: 18 }}>✦</span>
            Dual Whiteboard
            {initStatus && !sdkError && (
              <span className="wb-status ready">● {initStatus}</span>
            )}
            {sdkError && (
              <span className="wb-status error">✕ {sdkError}</span>
            )}
            {!initStatus && !sdkError && (
              <span className="wb-status loading">◌ Loading SDK...</span>
            )}
          </div>
          <div className="wb-header-actions">
            <button className="wb-action-btn" type="button" onClick={() => setExportFormat('text')}
              style={exportFormat === 'text' ? { borderColor: 'rgba(59,130,246,0.4)', color: '#60a5fa' } : undefined}
            >
              Text
            </button>
            <button className="wb-action-btn" type="button" onClick={() => setExportFormat('latex')}
              style={exportFormat === 'latex' ? { borderColor: 'rgba(168,85,247,0.4)', color: '#c084fc' } : undefined}
            >
              LaTeX
            </button>
            <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
            <button className="wb-action-btn" type="button" onClick={handleExport} title="Force Export">
              📤 Export
            </button>
            <button className="wb-action-btn" type="button" onClick={handleSavePNG} title="Save as PNG">
              💾 PNG
            </button>
            <button className="wb-action-btn" type="button" onClick={handleSaveJSON} title="Save as JSON">
              📄 JSON
            </button>
            <button className="wb-action-btn" type="button"
              onClick={() => handleLLMCorrection(convertedCanvasState)}
              title="Send to LLM for grading (placeholder)"
              style={{ borderColor: 'rgba(168,85,247,0.25)', color: '#a78bfa' }}
            >
              🧠 Grade
            </button>
          </div>
        </div>

        {/* ── Twin Board Grid ── */}
        <div className="wb-board-grid">
          {/* ════════════════════════════════════════════════
              LEFT BOARD — Input Canvas
              ════════════════════════════════════════════════ */}
          <div className="wb-board" ref={containerRef}>
            <div className="wb-board-label">✏️ Input Canvas</div>

            {/* Overlay Canvas (Always rendered, catches events when not writing) */}
            <canvas
              ref={canvasRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'block',
                touchAction: 'none',
                cursor: activeTool === 'erase' ? 'cell' : 'crosshair',
                zIndex: 20,
                width: '100%',
                height: '100%',
                pointerEvents: (!sdkLoaded || activeTool !== 'write') ? 'auto' : 'none',
              }}
            />

            {/* MyScript editor host */}
            {sdkLoaded && (
              <div
                className="myscript-host"
                ref={editorHostRef}
                tabIndex={0}
                onPointerDown={(e) => {
                  // Remove placeholder on first interaction
                  const el = e.currentTarget.querySelector('[data-placeholder]');
                  if (el?.parentElement) el.parentElement.removeChild(el);
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  minHeight: 520,
                  background: '#ffffff',
                  pointerEvents: activeTool === 'write' ? 'auto' : 'none',
                  opacity: 1,
                  zIndex: 10,
                  cursor: 'crosshair',
                  touchAction: 'none',
                }}
              >
                <div data-placeholder style={{ padding: '48px 24px 12px', color: 'rgba(148,163,184,0.5)', fontSize: 14, userSelect: 'none', fontWeight: 500 }}>
                  Start writing here — your text will appear on the right board...
                </div>
              </div>
            )}

            {/* ── Floating Toolbar (Apple Freeform) ── */}
            <div className="wb-floating-toolbar">
              {/* Tools */}
              <button className={toolBtnClass('write')} type="button" disabled={!hasEditor}
                onClick={() => switchTool('write')} title="Pen Tool (P)">
                ✏️ Pen
              </button>
              <button className={toolBtnClass('erase')} type="button" disabled={!hasEditor}
                onClick={() => switchTool('erase')} title="Eraser (E)">
                🧹 Erase
              </button>
              <button className={toolBtnClass('select')} type="button" disabled={!hasEditor}
                onClick={() => switchTool('select')} title="Select (S)">
                ⬚
              </button>

              <div className="wb-toolbar-divider" />

              {/* Shape Tools */}
              <button className={toolBtnClass('line')} type="button" disabled={!hasEditor}
                onClick={() => switchTool('line')} title="Line">╱</button>
              <button className={toolBtnClass('circle')} type="button" disabled={!hasEditor}
                onClick={() => switchTool('circle')} title="Circle">○</button>
              <button className={toolBtnClass('rectangle')} type="button" disabled={!hasEditor}
                onClick={() => switchTool('rectangle')} title="Rectangle">▭</button>
              <button className={toolBtnClass('arrow')} type="button" disabled={!hasEditor}
                onClick={() => switchTool('arrow')} title="Arrow">→</button>

              <div className="wb-toolbar-divider" />

              {/* Color Palette */}
              {COLORS.map(c => (
                <button
                  key={c.value}
                  className={`wb-color-swatch${strokeColor === c.value ? ' active' : ''}`}
                  type="button"
                  onClick={() => handleColorChange(c.value)}
                  style={{ background: c.value }}
                  title={c.label}
                />
              ))}

              {/* Stroke Width */}
              <input
                type="range"
                className="wb-stroke-slider"
                min="1" max="10" step="0.5"
                value={strokeWidth}
                onChange={(e) => handleStrokeWidthChange(parseFloat(e.target.value))}
                title={`Stroke: ${strokeWidth}px`}
              />

              <div className="wb-toolbar-divider" />

              {/* Undo / Redo / Clear */}
              <button className="wb-toolbar-btn" type="button" disabled={!hasEditor}
                onClick={handleUndo} title="Undo (Ctrl+Z)">↶</button>
              <button className="wb-toolbar-btn" type="button" disabled={!hasEditor}
                onClick={handleRedo} title="Redo (Ctrl+Y)">↷</button>
              <button className="wb-toolbar-btn" type="button" disabled={!hasEditor}
                onClick={handleClear} title="Clear All">🗑️</button>
            </div>
          </div>

          {/* ════════════════════════════════════════════════
              RIGHT BOARD — Output Canvas (Read-Only)
              ════════════════════════════════════════════════ */}
          <div className="wb-board" ref={outputBoardRef}>
            <div className="wb-board-label">📝 Converted Output</div>
            <div className="wb-grid-lines" />

            {/* Spatially positioned text blocks */}
            {hasBlocks && convertedCanvasState.map((block) => (
              <div
                key={block.id}
                className="wb-output-block"
                style={{
                  left: `${(block.x * 100).toFixed(2)}%`,
                  top: `${(block.y * 100).toFixed(2)}%`,
                  maxWidth: `${Math.max(10, block.width * 100).toFixed(2)}%`,
                  fontSize: `${block.fontSize}px`,
                  display: 'flex',
                  alignItems: 'baseline',
                  whiteSpace: 'nowrap',
                }}
                title={block.latex || block.text}
              >
                {exportFormat === 'latex' && block.latex ? (
                  <span dangerouslySetInnerHTML={{ __html: katex.renderToString(block.latex, { throwOnError: false }) }} />
                ) : (
                  block.text
                )}
              </div>
            ))}

            {/* Empty state placeholder */}
            {!hasBlocks && (
              <div className="wb-output-placeholder">
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>✦</div>
                  <div>Converted text appears here</div>
                  <div style={{ fontSize: 12, marginTop: 4, opacity: 0.6 }}>
                    at the same position you wrote it
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}