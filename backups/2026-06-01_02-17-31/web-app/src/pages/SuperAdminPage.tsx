import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { requireSupabase, getAdminClient } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getAllUsers, 
  updateUserData, 
  deleteUserData, 
  createUserDataAdmin, 
  isUsernameTaken, 
  adminUpdateEconomy, 
  type EconomyDeltas, 
  UserData, 
  UserRole, 
  computeLevel, 
  getAdminTeacherAssignments, 
  addAdminTeacherAssignment, 
  removeAdminTeacherAssignment, 
  getParentStudentLinks, 
  AdminTeacherAssignment, 
  ParentStudentLink 
} from '@/lib/userService';
import { 
  convertNestedProgramToInternal, 
  parseNestedProgramJson 
} from '@/lib/programNestedImport';
import {
  BUILDER_DIVISION_LABELS,
  FIXED_FIRST_DIVISION_NODE_ID,
  type BuilderDivisionLabel,
  type BuilderNode,
  type BuilderQuestionTypeFile,
  type BuilderSpec,
  convertBuilderToInternal,
  ensureFixedFirstDivisionContainer,
  makeIdFromTitle,
  makeStableId,
  newBuilderSpec,
} from '@/lib/programBuilder';
import {
  type ProgramAtomicInteractionSpec,
  type ProgramPromptBlock,
  type ProgramExplanationScene,
  type ProgramStepSpec,
} from '@/lib/programQuestionBank';
import {
  deleteDraftLogicGameNode,
  deletePublishedLogicGameNode,
  getDraftLogicGameQuestions,
  listDraftLogicGameNodes,
  listPublishedLogicGameNodes,
  publishLogicGameNode,
  publishLogicGameQuestions,
  upsertDraftLogicGameNode,
  upsertDraftLogicGameQuestions,
} from '@/lib/logicGamesService';
import ProgramMapView from '@/views/ProgramMapView';
import { clearDraftProgram, setDraftProgram } from '@/lib/draftProgramStore';
import { deleteProgramQuestionAsset, uploadProgramQuestionAsset } from '@/lib/programAssetService';
import type { LogicGameNode, LogicGameQuestionsDoc } from '@/types/logicGames';
import {
  createProgramIngestionJob,
  runProgramIngestionStage,
  uploadProgramIngestionSource,
  getProgramIngestionJob,
} from '@/lib/programIngestionService';
import {
  deleteDraftProgramAdmin,
  getDraftProgramAdmin,
  getPublishedProgramAdmin,
  listProgramsAdmin,
  publishProgramAdmin,
  saveDraftProgramAdmin,
  savePublishedProgramAdmin,
  softDeletePublishedProgramAdmin,
} from '@/lib/programAdminService';
import { parseAIProgramImport } from '@/lib/aiProgramImport';
import { convertNotebookExerciseToBuilderQuestions, validateNotebookExerciseImport, type NotebookValidationResult } from '@/lib/notebookProgramImport';


type Tab = 'overview' | 'users' | 'programs' | 'logicGames' | 'testing';

const ROLE_ORDER: UserRole[] = ['student', 'superadmin', 'admin', 'teacher', 'teacher_assistant', 'parent'];
const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student', superadmin: 'Super Admin', admin: 'Admin',
  teacher: 'Teacher', teacher_assistant: 'TA', parent: 'Parent',
};
const ROLE_COLORS: Record<UserRole, string> = {
  student: '#3b82f6', superadmin: '#a855f7', admin: '#f59e0b',
  teacher: '#10b981', teacher_assistant: '#06b6d4', parent: '#ec4899',
};

function TestingWhiteboard() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [initStatus, setInitStatus] = useState<string | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<any>(null);
  const [recognized, setRecognized] = useState<string>('');
  const [diagnostics, setDiagnostics] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<'text' | 'latex'>('text');
  const [activeTool, setActiveTool] = useState<'write' | 'erase' | 'select' | 'circle' | 'line' | 'arrow' | 'rectangle'>('write');
  const [strokeColor, setStrokeColor] = useState<string>('#1A1A1A');
  const [strokeWidth, setStrokeWidth] = useState<number>(2.5);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [lastPanPoint, setLastPanPoint] = useState<{ x: number; y: number } | null>(null);

  function computeDiagnostics(extra?: string) {
    try {
      const jsTag = document.querySelector('script[data-myscript-js]') ? 'js:yes' : 'js:no';
      const cssTag = document.querySelector('link[data-myscript-css]') ? 'css:yes' : 'css:no';
      const host = editorHostRef.current;
      const rect = host ? host.getBoundingClientRect() : { width: 0, height: 0 } as DOMRect;
      const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
      const g = (window as any)[ns];
      const api = g ? Object.keys(g).slice(0, 6).join(',') : 'none';
      const msg = `assets[${jsTag},${cssTag}] size=${Math.round(rect.width)}x${Math.round(rect.height)} ns=${ns} api=${api}${extra ? ' ' + extra : ''}`;
      setDiagnostics(msg);
    } catch {}
  }

  // Auto-load SDK and initialize editor on first render
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMyScriptAssets();
        if (cancelled) return;
        setSdkLoaded(true);
        // Wait for the host element to mount before initializing the editor
        let tries = 0;
        while (!cancelled && !editorHostRef.current && tries < 20) {
          tries += 1; await new Promise(r => setTimeout(r, 50));
        }
        if (!cancelled && editorHostRef.current) {
          try {
            const ed = await createEditorNow();
            // Ensure we are in write mode so ink is visible immediately
            try {
              const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
              const api: any = (window as any)[ns];
              const tool = api?.EditorTool?.Write || 'write';
              if (typeof (ed as any).setTool === 'function') (ed as any).setTool(tool);
              else if (typeof (ed as any).setMode === 'function') (ed as any).setMode('write');
            } catch {}
          } catch (e: any) {
            setSdkError(e?.message || 'Init failed');
          }
        }
      } catch (e: any) {
        if (!cancelled) setSdkError(e?.message || 'Failed to load MyScript SDK');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!editorInstanceRef.current) return;
      
      // Ctrl+Z for undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (historyIndex > 0) {
          setHistoryIndex(historyIndex - 1);
          const inst = editorInstanceRef.current;
          if (inst && typeof inst.import_ === 'function') {
            inst.import_(history[historyIndex - 1]);
          }
        }
      }
      // Ctrl+Y or Ctrl+Shift+Z for redo
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
          setHistoryIndex(historyIndex + 1);
          const inst = editorInstanceRef.current;
          if (inst && typeof inst.import_ === 'function') {
            inst.import_(history[historyIndex + 1]);
          }
        }
      }
      // Ctrl+0 for reset zoom
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      // Ctrl+Plus for zoom in
      if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        setZoom(Math.min(3, zoom + 0.1));
      }
      // Ctrl+Minus for zoom out
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        setZoom(Math.max(0.5, zoom - 0.1));
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history, zoom]);

  // Apply zoom and pan to editor host
  useEffect(() => {
    const host = editorHostRef.current;
    if (host) {
      host.style.transform = `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`;
      host.style.transformOrigin = 'top left';
    }
  }, [zoom, pan]);

  async function createEditorNow() {
    const host = editorHostRef.current;
    const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
    const appKey = import.meta.env.VITE_MYSCRIPT_APP_KEY as string | undefined;
    const hmacKey = import.meta.env.VITE_MYSCRIPT_HMAC_KEY as string | undefined;
    const contentType = (import.meta.env.VITE_MYSCRIPT_CONTENT_TYPE as string | undefined) || 'TEXT';
    const serverScheme = (import.meta.env.VITE_MYSCRIPT_SERVER_SCHEME as string | undefined) || undefined;
    const serverHost = (import.meta.env.VITE_MYSCRIPT_SERVER_HOST as string | undefined) || undefined;
    if (!host) throw new Error('Missing editor host');
    if (window && (window as any).isSecureContext === false) {
      throw new Error('Secure context required: open via localhost or https so crypto.subtle is available');
    }
    // Patch host.classList to ignore malformed tokens some SDK builds may push
    try {
      const add = host.classList.add.bind(host.classList);
      const rem = host.classList.remove.bind(host.classList);
      (host.classList as any).add = (...tokens: any[]) => {
        const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
        if (valid.length) add(...valid);
      };
      (host.classList as any).remove = (...tokens: any[]) => {
        const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
        if (valid.length) rem(...valid);
      };
    } catch {}
    const w: any = window as any; const api = w[ns];
    if (!api || typeof api.Editor !== 'function') throw new Error('window.' + ns + '.Editor not found');
    const serverCfg = (serverScheme && serverHost)
      ? { scheme: serverScheme, host: serverHost, applicationKey: appKey, hmacKey }
      : { scheme: 'https', host: 'cloud.myscript.com', applicationKey: appKey, hmacKey };

    // Simple configuration for this SDK version
    const options: any = {
      configuration: {
        server: serverCfg,
        applicationKey: appKey,
        hmacKey: hmacKey,
        recognitionParams: {
          type: contentType,
          protocol: 'WEBSOCKET',
          server: serverCfg,
          'text': {
            'smartGuide': {
              'enable': false
            }
          },
          'math': {
            'smartGuide': {
              'enable': false
            }
          }
        }
      }
    };
    
    // Create editor using EditorFactory.createEditor static method
    const ed = await api.EditorFactory.createEditor(host, 'TEXT', options);
    editorInstanceRef.current = ed;
    computeDiagnostics('auto-mounted');
    try { setInitStatus('Ready'); } catch {}
    // Focus and tool setup so ink shows on pointer down
    try { host.style.touchAction = 'none'; host.style.cursor = 'crosshair'; host.focus(); } catch {}
    try {
      const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
      const apiNS: any = (window as any)[ns];
      const writeTool = apiNS?.EditorTool?.Write || apiNS?.EditorWriteTool || 'write';
      if (typeof (ed as any).setTool === 'function') (ed as any).setTool(writeTool);
      else if (typeof (ed as any).setMode === 'function') (ed as any).setMode('write');
    } catch {}
    try { setActiveTool('write'); } catch {}
    // Ensure proper sizing
    try {
      if (typeof (ed as any).resize === 'function') {
        (ed as any).resize();
        setTimeout(() => { try { (ed as any).resize(); } catch {} }, 100);
      }
    } catch {}
    // Hook window resize
    try {
      const handler = () => { try { (ed as any).resize?.(); } catch {} };
      window.addEventListener('resize', handler);
      // Store on instance for cleanup if destroy is called elsewhere
      (ed as any).__resizeHandler = handler;
    } catch {}

    // Auto-export on content changes with debounce
    let exportTimer: any = null;
    const doExport = async () => {
      try {
        if ((ed as any).waitForIdle) await (ed as any).waitForIdle();
        const expMethod = (ed as any).export || (ed as any).export_;
        let exportsObj: any = (ed as any).exports;
        if (typeof expMethod === 'function') {
          exportsObj = await expMethod.call(ed);
        }
        const plain = exportsObj?.['text/plain'] || exportsObj?.['application/vnd.myscript.jiix']?.label || '';
        const latex = exportsObj?.['application/x-latex'] || exportsObj?.['application/vnd.myscript.jiix']?.latex || '';
        setRecognized((exportFormat === 'latex' ? latex : plain) || plain || latex || '');
      } catch (e) {
        // ignore transient export issues
      }
    };
    const onChanged = () => {
      if (exportTimer) clearTimeout(exportTimer);
      exportTimer = setTimeout(doExport, 400);
    };
    const target: any = (typeof (ed as any).addEventListener === 'function') ? ed : host;
    if (target && typeof target.addEventListener === 'function') {
      try { target.addEventListener('changed', onChanged as any); } catch {}
      try { target.addEventListener('exported', onChanged as any); } catch {}
    }
    return ed;
  }

  async function loadMyScriptAssets() {
    const jsUrl = (import.meta.env.VITE_MYSCRIPT_JS_URL as string | undefined) || '/myscript/iink.min.js';
    const cssUrl = (import.meta.env.VITE_MYSCRIPT_CSS_URL as string | undefined) || '/myscript/iink.css';
    // Load CSS if not already present
    if (!document.querySelector(`link[data-myscript-css]`)) {
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        link.setAttribute('data-myscript-css', '1');
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('Failed to load MyScript CSS'));
        document.head.appendChild(link);
      });
    }
    // Load JS if not already present
    if (!document.querySelector(`script[data-myscript-js]`)) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = jsUrl;
        script.async = true;
        script.defer = true;
        script.setAttribute('data-myscript-js', '1');
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load MyScript JS'));
        document.head.appendChild(script);
      });
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor((window.innerHeight - 240) * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${Math.floor((window.innerHeight - 240))}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, Math.floor((window.innerHeight - 240)));
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    for (let x = 32; x < rect.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = 32; y < canvas.height / dpr; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
  }, []);

  // Try to initialize the MyScript editor once assets are reported loaded
  useEffect(() => {
    if (!sdkLoaded) return;
    const host = editorHostRef.current;
    if (!host || editorInstanceRef.current) return;

    const appKey = import.meta.env.VITE_MYSCRIPT_APP_KEY as string | undefined;
    const hmacKey = import.meta.env.VITE_MYSCRIPT_HMAC_KEY as string | undefined;
    const contentType = (import.meta.env.VITE_MYSCRIPT_CONTENT_TYPE as string | undefined) || 'TEXT';
    if (!appKey || !hmacKey) {
      setSdkError('Missing app/hmac keys');
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 40; // ~4-8s depending on backoff

    const tryInit = async () => {
      if (cancelled || editorInstanceRef.current) return;
      attempts += 1;
      setInitStatus(`Initializing... (attempt ${attempts}/${maxAttempts})`);
      try {
        const tag = (import.meta.env.VITE_MYSCRIPT_TAG as string | undefined) || 'iink-editor';
        const globalNs = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';

        // Strategy A: custom element <tag>
        if ((window as any).customElements?.get && (window as any).customElements.get(tag)) {
          const el = document.createElement(tag);
          (el as any).style = 'position:absolute;inset:0;display:block;background:#fff;';
          (el as any).setAttribute?.('data-app-key', appKey);
          (el as any).setAttribute?.('data-hmac-key', hmacKey);
          (el as any).setAttribute?.('data-content-type', contentType);
          host.innerHTML = '';
          host.appendChild(el);
          editorInstanceRef.current = el;
          try { host.setAttribute('data-editor-mounted', '1'); } catch {}
          computeDiagnostics(`mode=ce tag=${tag}`);
          setInitStatus('Ready');
          return;
        }

        // Strategy B: global factory on window[globalNs] (guarded)
        const w: any = window as any;
        const api = w[globalNs];
        if (api && (typeof api.createEditor === 'function' || typeof api.Editor === 'function')) {
          const rect = host.getBoundingClientRect();
          const size = { width: rect.width || host.clientWidth || 800, height: rect.height || 500 };
          const serverScheme = (import.meta.env.VITE_MYSCRIPT_SERVER_SCHEME as string | undefined) || undefined;
          const serverHost = (import.meta.env.VITE_MYSCRIPT_SERVER_HOST as string | undefined) || undefined;
          const options: any = {
            recognitionParams: { type: contentType },
            configuration: {
              applicationKey: appKey,
              hmacKey,
              ...(serverScheme && serverHost ? { server: { scheme: serverScheme, host: serverHost } } : {}),
            },
            theme: {},
            size,
          };
          // Patch host.classList before instantiation as well
          try {
            const add = host.classList.add.bind(host.classList);
            const rem = host.classList.remove.bind(host.classList);
            (host.classList as any).add = (...tokens: any[]) => {
              const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
              if (valid.length) add(...valid);
            };
            (host.classList as any).remove = (...tokens: any[]) => {
              const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
              if (valid.length) rem(...valid);
            };
          } catch {}
          let instance: any = null;
          if (typeof api.createEditor === 'function') {
            instance = api.createEditor(host, options);
          } else if (typeof api.Editor === 'function') {
            instance = new api.Editor(host, options);
          }
          if (instance) {
            try {
              if (typeof (instance as any).init === 'function') {
                const r = (instance as any).init(host, options);
                if (r && typeof r.then === 'function') await r;
              } else if (typeof (instance as any).mount === 'function') {
                const r = (instance as any).mount(host, options);
                if (r && typeof r.then === 'function') await r;
              } else if (typeof (instance as any).start === 'function') {
                const r = (instance as any).start(options);
                if (r && typeof r.then === 'function') await r;
              }
            } catch (e: any) {
              setSdkError(`Editor init error: ${e?.message || String(e)}`);
            }

            try { host.setAttribute('data-editor-mounted', '1'); } catch {}
            editorInstanceRef.current = instance;
            computeDiagnostics(`mode=global ns=${globalNs}`);
            try {
              if (typeof (instance as any).on === 'function') {
                (instance as any).on('exported', (evt: any) => {
                  const exp = evt?.exports || evt?.detail?.exports || {};
                  const text = exp['text/plain'] || exp.LATEX || exp.LaTeX || exp.latex || exp['application/vnd.myscript.jiix'] || '';
                  if (text) setRecognized(String(text));
                });
              } else if (typeof (instance as any).addEventListener === 'function') {
                (instance as any).addEventListener('exported', (evt: any) => {
                  const exp = evt?.detail?.exports || {};
                  const text = exp['text/plain'] || exp.LATEX || exp.LaTeX || exp.latex || exp['application/vnd.myscript.jiix'] || '';
                  if (text) setRecognized(String(text));
                });
              }
            } catch {}
            setInitStatus('Ready');
            return;
          }
        }
      } catch (e: any) {
        setSdkError(e?.message || 'Failed to initialize MyScript editor');
      }

      if (attempts < maxAttempts) {
        const delay = attempts < 10 ? 100 : 250; // quick then slower
        setTimeout(() => { void tryInit(); }, delay);
      } else {
        setInitStatus(null);
        setSdkError('MyScript SDK loaded, but no known editor API found. Please verify CDN URLs and SDK flavor.');
      }
    };

    void tryInit();

    return () => {
      cancelled = true;
      try {
        const inst = editorInstanceRef.current;
        if (inst && typeof inst.destroy === 'function') inst.destroy();
      } catch {}
      editorInstanceRef.current = null;
    };
  }, [sdkLoaded]);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current; if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = getPoint(e);
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return; const p = getPoint(e); const l = last.current;
    const ctx = canvasRef.current?.getContext('2d'); if (!ctx || !p) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827'; ctx.lineWidth = 2.8;
    if (l) { ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    last.current = p;
  }
  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current; if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    drawing.current = false; last.current = null;
    // TODO: When MyScript SDK is integrated, send strokes here for conversion.
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 540 }}>
      <div style={{ background: '#0b1220', color: '#93c5fd', border: '1px solid #1d2a44', borderRadius: 10, padding: 10, fontSize: 12 }}>
        <div>
          <b>Result</b> (<span style={{ color: '#eab308' }}>{exportFormat === 'latex' ? 'LaTeX' : 'Plain'}</span>): {recognized || '—'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative', zIndex: 10, pointerEvents: 'auto' }}>
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current || historyIndex <= 0}
          onClick={() => {
            if (historyIndex > 0) {
              setHistoryIndex(historyIndex - 1);
              const inst = editorInstanceRef.current;
              if (inst && typeof inst.import_ === 'function') {
                inst.import_(history[historyIndex - 1]);
              }
            }
          }}
          title="Undo (Ctrl+Z)"
        >↶ Undo</button>
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current || historyIndex >= history.length - 1}
          onClick={() => {
            if (historyIndex < history.length - 1) {
              setHistoryIndex(historyIndex + 1);
              const inst = editorInstanceRef.current;
              if (inst && typeof inst.import_ === 'function') {
                inst.import_(history[historyIndex + 1]);
              }
            }
          }}
          title="Redo (Ctrl+Y)"
        >↷ Redo</button>
        
        <div style={{ width: 1, height: 20, background: '#334155', margin: '0 4px' }} />
        
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={() => {
            const inst = editorInstanceRef.current; if (!inst) return;
            try {
              const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
              const api: any = (window as any)[ns];
              const tool = api?.EditorTool?.Write || 'write';
              if (typeof inst.setTool === 'function') inst.setTool(tool);
              else if (typeof inst.setMode === 'function') inst.setMode('write');
            } catch {}
            try { setActiveTool('write'); } catch {}
          }}
          style={{ background: activeTool === 'write' ? 'rgba(168,85,247,0.15)' : undefined, border: activeTool === 'write' ? '1px solid rgba(168,85,247,0.4)' : undefined }}
          title="Pen Tool"
        >✏️ Pen</button>
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={() => {
            const inst = editorInstanceRef.current; if (!inst) return;
            try {
              const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
              const api: any = (window as any)[ns];
              const tool = api?.EditorTool?.Erase || 'erase';
              if (typeof inst.setTool === 'function') inst.setTool(tool);
              else if (typeof inst.setMode === 'function') inst.setMode('erase');
            } catch {}
            try { setActiveTool('erase'); } catch {}
          }}
          style={{ background: activeTool === 'erase' ? 'rgba(239,68,68,0.12)' : undefined, border: activeTool === 'erase' ? '1px solid rgba(239,68,68,0.35)' : undefined }}
          title="Eraser Tool"
        >🧹 Eraser</button>
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={() => setActiveTool('select')}
          style={{ background: activeTool === 'select' ? 'rgba(59,130,246,0.12)' : undefined, border: activeTool === 'select' ? '1px solid rgba(59,130,246,0.35)' : undefined }}
          title="Select Tool"
        >⬚ Select</button>
        
        <div style={{ width: 1, height: 20, background: '#334155', margin: '0 4px' }} />
        
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={() => setActiveTool('line')}
          style={{ background: activeTool === 'line' ? 'rgba(34,197,94,0.12)' : undefined, border: activeTool === 'line' ? '1px solid rgba(34,197,94,0.35)' : undefined }}
          title="Line Tool"
        >╱ Line</button>
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={() => setActiveTool('circle')}
          style={{ background: activeTool === 'circle' ? 'rgba(34,197,94,0.12)' : undefined, border: activeTool === 'circle' ? '1px solid rgba(34,197,94,0.35)' : undefined }}
          title="Circle Tool"
        >○ Circle</button>
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={() => setActiveTool('rectangle')}
          style={{ background: activeTool === 'rectangle' ? 'rgba(34,197,94,0.12)' : undefined, border: activeTool === 'rectangle' ? '1px solid rgba(34,197,94,0.35)' : undefined }}
          title="Rectangle Tool"
        >▭ Rectangle</button>
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={() => setActiveTool('arrow')}
          style={{ background: activeTool === 'arrow' ? 'rgba(34,197,94,0.12)' : undefined, border: activeTool === 'arrow' ? '1px solid rgba(34,197,94,0.35)' : undefined }}
          title="Arrow Tool"
        >→ Arrow</button>
        
        <div style={{ width: 1, height: 20, background: '#334155', margin: '0 4px' }} />
        
        {/* Color Picker */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Color:</span>
          {['#1A1A1A', '#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'].map(color => (
            <button
              key={color}
              className="ll-btn"
              type="button"
              onClick={() => {
                setStrokeColor(color);
                const inst = editorInstanceRef.current;
                if (inst && typeof inst.setPenColor === 'function') {
                  inst.setPenColor(color);
                }
              }}
              style={{ 
                width: 24, 
                height: 24, 
                padding: 0, 
                background: color, 
                border: strokeColor === color ? '2px solid white' : '1px solid #334155',
                borderRadius: 4
              }}
              title={`Select ${color}`}
            />
          ))}
        </div>
        
        {/* Stroke Width */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Width:</span>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={strokeWidth}
            onChange={(e) => {
              const width = parseFloat(e.target.value);
              setStrokeWidth(width);
              const inst = editorInstanceRef.current;
              if (inst && typeof inst.setPenWidth === 'function') {
                inst.setPenWidth(width);
              }
            }}
            style={{ width: 60 }}
          />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>{strokeWidth}px</span>
        </div>
        
        <div style={{ width: 1, height: 20, background: '#334155', margin: '0 4px' }} />
        
        {/* Zoom Controls */}
        <button
          className="ll-btn"
          type="button"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
          title="Zoom Out"
        >🔍−</button>
        <span style={{ color: '#94a3b8', fontSize: 12, minWidth: 45 }}>{Math.round(zoom * 100)}%</span>
        <button
          className="ll-btn"
          type="button"
          onClick={() => setZoom(Math.min(3, zoom + 0.1))}
          title="Zoom In"
        >🔍+</button>
        <button
          className="ll-btn"
          type="button"
          onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
          title="Reset View"
        >⊡ Reset</button>
        
        <div style={{ width: 1, height: 22, background: '#334155', margin: '0 6px' }} />
        <button
          className="ll-btn"
          type="button"
          disabled={!editorInstanceRef.current}
          onClick={async () => {
            const inst = editorInstanceRef.current; if (!inst) return;
            try {
              if (typeof inst.export === 'function') {
                const exp = await inst.export();
                const text = exportFormat === 'latex'
                  ? (exp?.LATEX || exp?.LaTeX || exp?.latex || '')
                  : (exp?.['text/plain'] || '');
                setRecognized(text || '');
              }
            } catch (e: any) {
              setSdkError(e?.message || 'Export failed');
            }
          }}
        >📤 Export</button>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 6 }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>Format</span>
          <button
            className="ll-btn"
            type="button"
            onClick={() => setExportFormat('text')}
            disabled={exportFormat === 'text'}
          >Plain</button>
          <button
            className="ll-btn"
            type="button"
            onClick={() => setExportFormat('latex')}
            disabled={exportFormat === 'latex'}
          >LaTeX</button>
        </div>
        
        {/* Export Options */}
        <button
          className="ll-btn"
          type="button"
          onClick={() => {
            // Export as PNG
            const host = editorHostRef.current;
            if (host) {
              const canvas = host.querySelector('canvas') || host.querySelector('svg');
              if (canvas) {
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
              }
            }
          }}
          title="Save as PNG"
        >💾 Save PNG</button>
        <button
          className="ll-btn"
          type="button"
          onClick={() => {
            // Export as JSON
            const data = {
              recognized,
              exportFormat,
              timestamp: new Date().toISOString(),
              zoom,
              pan,
              strokeColor,
              strokeWidth
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            link.download = `whiteboard-${Date.now()}.json`;
            link.href = URL.createObjectURL(blob);
            link.click();
          }}
          title="Save as JSON"
        >📄 Save JSON</button>
        <button
          className="ll-btn"
          type="button"
          onClick={() => {
            const host = editorHostRef.current;
            if (!host) return;
            const handler = (e: PointerEvent) => {
              const dot = document.createElement('div');
              dot.style.position = 'absolute';
              dot.style.left = `${e.offsetX - 4}px`;
              dot.style.top = `${e.offsetY - 4}px`;
              dot.style.width = '8px';
              dot.style.height = '8px';
              dot.style.borderRadius = '50%';
              dot.style.background = 'rgba(168,85,247,0.6)';
              dot.style.pointerEvents = 'none';
              dot.style.zIndex = '9999';
              host.appendChild(dot);
              setTimeout(() => dot.remove(), 2000);
            };
            host.addEventListener('pointerdown', handler, { once: true });
          }}
        >Probe input</button>
        <button
          className="ll-btn"
          type="button"
          onClick={() => {
            const inst = editorInstanceRef.current;
            const host = editorHostRef.current;
            if (!inst || !host) {
              console.log('No instance or host');
              return;
            }
            try {
              // Force write mode with multiple API variants
              const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
              const api: any = (window as any)[ns];
              const writeTool = api?.EditorTool?.Write || api?.EditorWriteTool?.Pencil || 'write';
              
              if (typeof inst.setTool === 'function') {
                inst.setTool(writeTool);
              }
              if (typeof inst.setMode === 'function') {
                inst.setMode('write');
              }
              if (typeof inst.setPen === 'function') {
                inst.setPen();
              }
              
              // Force focus and interaction
              host.focus();
              host.style.pointerEvents = 'auto';
              host.style.touchAction = 'none';
              host.style.cursor = 'crosshair';
              
              // Ensure rendering layers are active
              if (typeof inst.resize === 'function') {
                inst.resize();
              }
              
              // Update UI state
              setActiveTool('write');
              console.log('Force write tool applied:', writeTool);
            } catch (e) {
              console.error('Force write failed:', e);
            }
          }}
        >Force write</button>
        <button
          className="ll-btn"
          type="button"
          onClick={() => {
            const inst = editorInstanceRef.current;
            const host = editorHostRef.current;
            if (!inst || !host) {
              console.log('Instance or host missing');
              return;
            }
            
            console.log('Editor instance methods:', Object.getOwnPropertyNames(inst).filter(n => typeof inst[n] === 'function'));
            console.log('Editor instance props:', Object.getOwnPropertyNames(inst));
            
            const ns = (import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink';
            const api: any = (window as any)[ns];
            console.log('Global API available:', !!api);
            console.log('Global API methods:', api ? Object.getOwnPropertyNames(api).filter(n => typeof api[n] === 'function') : []);
            
            // Try minimal re-init with just basic config
            try {
              if (typeof inst.destroy === 'function') {
                inst.destroy();
              }
            } catch {}
            
            editorInstanceRef.current = null;
            
            // Check EditorFactory and try proper init
            console.log('EditorFactory type:', typeof api.EditorFactory);
            console.log('EditorFactory:', api.EditorFactory);
            
            setTimeout(async () => {
              try {
                let newInst: any = null;
                
                // Try EditorFactory if it's a constructor
                if (typeof api.EditorFactory === 'function') {
                  console.log('Trying EditorFactory constructor...');
                  const factory = new api.EditorFactory();
                  if (typeof factory.create === 'function') {
                    const simpleOptions = {
                      configuration: {
                        applicationKey: import.meta.env.VITE_MYSCRIPT_APP_KEY,
                        hmacKey: import.meta.env.VITE_MYSCRIPT_HMAC_KEY,
                        server: { scheme: 'https', host: 'cloud.myscript.com' }
                      },
                      recognitionParams: { type: 'TEXT' }
                    };
                    newInst = factory.create(host, simpleOptions);
                  }
                }
                
                // Fallback to direct Editor
                if (!newInst && typeof api.Editor === 'function') {
                  console.log('Trying direct Editor constructor...');
                  const simpleOptions = {
                    configuration: {
                      applicationKey: import.meta.env.VITE_MYSCRIPT_APP_KEY,
                      hmacKey: import.meta.env.VITE_MYSCRIPT_HMAC_KEY,
                      server: { scheme: 'https', host: 'cloud.myscript.com' }
                    },
                    recognitionParams: { type: 'TEXT' }
                  };
                  newInst = new api.Editor(host, simpleOptions);
                }
                
                if (!newInst) {
                  throw new Error('Could not create editor instance');
                }
                
                // Initialize with available methods
                if (typeof newInst.init === 'function') await newInst.init(host);
                if (typeof newInst.start === 'function') await newInst.start();
                if (typeof newInst.mount === 'function') await newInst.mount(host);
                if (typeof newInst.initialize === 'function') await newInst.initialize();
                
                editorInstanceRef.current = newInst;
                console.log('Enhanced re-init completed');
                console.log('New instance methods:', Object.getOwnPropertyNames(newInst).filter(n => typeof newInst[n] === 'function'));
                
                // Force write
                if (typeof newInst.setTool === 'function') {
                  newInst.setTool('write');
                } else if (typeof newInst.setMode === 'function') {
                  newInst.setMode('write');
                }
              } catch (e) {
                console.error('Enhanced re-init failed:', e);
              }
            }, 100);
          }}
        >Diagnose & Re-init</button>
        {initStatus && !sdkError && <span style={{ color: '#a3e635', fontSize: 12 }}>{initStatus}</span>}
        {sdkError && <span style={{ color: '#f87171', fontSize: 12 }}>{sdkError}</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', minHeight: 520 }}>
        <div ref={containerRef} style={{ flex: 1, minHeight: 520, border: '1px solid #334155', borderRadius: 14, overflow: 'hidden', background: '#ffffff', position: 'relative' }}>
          {!editorInstanceRef.current && (
            <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              style={{ display: 'block', touchAction: 'none', cursor: 'crosshair' }} />
          )}
          {sdkLoaded && (
            <div
              className="myscript-host"
              ref={editorHostRef}
              tabIndex={0}
              onPointerDown={(e) => {
                const el = e.currentTarget.querySelector('[data-placeholder]');
                if (el && el.parentElement) el.parentElement.removeChild(el as Node);
              }}
              style={{ position: 'absolute', inset: 0, minHeight: 520, background: '#ffffff', pointerEvents: sdkLoaded ? 'auto' : 'none', opacity: sdkLoaded ? 1 : 0, zIndex: 0, cursor: 'crosshair', touchAction: 'none' }}
            >
              <div data-placeholder style={{ padding: 12, color: '#0f172a', fontSize: 13, userSelect: 'none' }}>
                Write here. The conversion appears on the right.
              </div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 520, border: '1px solid #334155', borderRadius: 14, overflow: 'auto', background: '#ffffff' }}>
          <div style={{ padding: 12, color: '#0f172a' }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>Converted Board</div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 16, lineHeight: 1.5 }}>
              {recognized || '— Start writing on the left. Use Export now if it does not auto-update.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Removed Testing Pad */
function HandwritingTestingPad() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const strokePathRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const recognitionTimerRef = useRef<number | null>(null);
  const templateCacheRef = useRef(new Map<string, number[][]>());
  const [recognizedText, setRecognizedText] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [overlays, setOverlays] = useState<Array<{ x: number; y: number; w: number; text: string }>>([]);
  const [hasInk, setHasInk] = useState(false);
  const padHeight = 360;

  function setupCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const width = Math.max(320, Math.floor(parent?.clientWidth ?? 900));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(padHeight * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${padHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, padHeight);
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 1;
    for (let y = 40; y < padHeight; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  useEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, []);

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return null;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = getPoint(event);
    lastPointRef.current = point;
    if (point) strokePathRef.current.push([point]);
    setHasInk(true);
    if (recognitionTimerRef.current) window.clearTimeout(recognitionTimerRef.current);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const point = getPoint(event);
    const last = lastPointRef.current;
    if (!ctx || !point || !last) return;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    const activeStroke = strokePathRef.current[strokePathRef.current.length - 1];
    activeStroke?.push(point);
    lastPointRef.current = point;
  }

  function stopDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas?.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drawingRef.current = false;
    lastPointRef.current = null;
    scheduleOfflineRecognition();
  }

  function clearPad() {
    setupCanvas();
    setHasInk(false);
    strokePathRef.current = [];
    setRecognizedText('');
    setCandidates([]);
    if (recognitionTimerRef.current) window.clearTimeout(recognitionTimerRef.current);
  }

  function scheduleOfflineRecognition() {
    if (recognitionTimerRef.current) window.clearTimeout(recognitionTimerRef.current);
    recognitionTimerRef.current = window.setTimeout(() => {
      recognizeOffline();
    }, 650);
  }

  function strokeBounds(strokes: Array<Array<{ x: number; y: number }>>) {
    const points = strokes.flat();
    if (points.length === 0) return null;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    };
  }

  function groupStrokesIntoCharacters() {
    return segmentStrokes().flatMap((line, lineIndex) => [
      ...(lineIndex > 0 ? ['\n' as const] : []),
      ...line.words.flatMap((word, wordIndex) => [
        ...(wordIndex > 0 ? [' ' as const] : []),
        ...word.characters,
      ]),
    ]);
  }

  function segmentStrokes() {
    const strokes = strokePathRef.current
      .map((stroke) => stroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
      .filter((stroke) => stroke.length > 0)
      .map((stroke) => ({ stroke, bounds: strokeBounds([stroke]) }))
      .filter((entry): entry is { stroke: Array<{ x: number; y: number }>; bounds: NonNullable<ReturnType<typeof strokeBounds>> } => !!entry.bounds)
      .sort((a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX);

    const lineBuckets: Array<typeof strokes> = [];
    for (const entry of strokes) {
      const centerY = (entry.bounds.minY + entry.bounds.maxY) / 2;
      const line = lineBuckets.find((bucket) => {
        const b = strokeBounds(bucket.map((item) => item.stroke));
        if (!b) return false;
        const bucketCenterY = (b.minY + b.maxY) / 2;
        return Math.abs(centerY - bucketCenterY) < Math.max(28, b.height * 0.7, entry.bounds.height * 0.7);
      });
      if (line) line.push(entry);
      else lineBuckets.push([entry]);
    }

    return lineBuckets
      .map((line) => line.sort((a, b) => a.bounds.minX - b.bounds.minX))
      .sort((a, b) => {
        const ab = strokeBounds(a.map((item) => item.stroke));
        const bb = strokeBounds(b.map((item) => item.stroke));
        return (ab?.minY ?? 0) - (bb?.minY ?? 0);
      })
      .map((line) => {
        const characterGroups: Array<Array<Array<{ x: number; y: number }>>> = [];
        const wordIndexes = new Set<number>();
        const lineBounds = strokeBounds(line.map((item) => item.stroke));
        const averageHeight = line.reduce((sum, item) => sum + item.bounds.height, 0) / Math.max(1, line.length);
        for (const entry of line) {
          const lastGroup = characterGroups[characterGroups.length - 1];
          const lastBounds = lastGroup ? strokeBounds(lastGroup) : null;
          const gap = lastBounds ? entry.bounds.minX - lastBounds.maxX : 0;
          const characterThreshold = Math.max(10, Math.min(24, averageHeight * 0.26));
          const wordThreshold = Math.max(26, Math.min(70, averageHeight * 0.85));
          if (!lastGroup || gap > characterThreshold) {
            if (gap > wordThreshold) wordIndexes.add(characterGroups.length);
            characterGroups.push([entry.stroke]);
          } else {
            lastGroup.push(entry.stroke);
          }
        }
        const words: Array<{ characters: Array<Array<Array<{ x: number; y: number }>>> }> = [];
        let currentWord: Array<Array<Array<{ x: number; y: number }>>> = [];
        characterGroups.forEach((group, index) => {
          if (wordIndexes.has(index) && currentWord.length > 0) {
            words.push({ characters: currentWord });
            currentWord = [];
          }
          currentWord.push(group);
        });
        if (currentWord.length > 0) words.push({ characters: currentWord });
        return { bounds: lineBounds, words };
      });
  }

  function renderStrokeGroupToCanvas(group: Array<Array<{ x: number; y: number }>>, targetSize = 28): HTMLCanvasElement {
    const bounds = strokeBounds(group);
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx || !bounds) return canvas;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetSize, targetSize);
    const scale = Math.min((targetSize - 6) / bounds.width, (targetSize - 6) / bounds.height);
    const offsetX = (targetSize - bounds.width * scale) / 2;
    const offsetY = (targetSize - bounds.height * scale) / 2;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of group) {
      stroke.forEach((point, index) => {
        const x = offsetX + (point.x - bounds.minX) * scale;
        const y = offsetY + (point.y - bounds.minY) * scale;
        if (index === 0) {
          ctx.beginPath();
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      });
    }
    return canvas;
  }

  function renderStrokeGroupToVector(group: Array<Array<{ x: number; y: number }>>, targetSize = 28): number[] {
    return canvasToInkVector(renderStrokeGroupToCanvas(group, targetSize));
  }

  function canvasToInkVector(canvas: HTMLCanvasElement): number[] {
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const vector: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      const brightness = ((data[index] ?? 255) + (data[index + 1] ?? 255) + (data[index + 2] ?? 255)) / 3;
      vector.push(Math.max(0, Math.min(1, (255 - brightness) / 255)));
    }
    return vector;
  }

  function buildTemplateVariants(symbol: string, targetSize = 28): number[][] {
    const cacheKey = `${symbol}_${targetSize}`;
    const cached = templateCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [new Array(targetSize * targetSize).fill(0)];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fonts = [
      `${/[a-z]/.test(symbol) ? 700 : 800} ${/[a-z]/.test(symbol) ? 24 : 23}px Arial`,
      `${/[a-z]/.test(symbol) ? 700 : 800} ${/[a-z]/.test(symbol) ? 24 : 23}px "Segoe UI"`,
      `${/[a-z]/.test(symbol) ? 700 : 800} ${/[a-z]/.test(symbol) ? 24 : 23}px Georgia`,
    ];
    const rotations = [-7, 0, 7];
    const scales = [0.9, 1, 1.08];
    const variants: number[][] = [];
    for (const font of fonts) {
      for (const rotation of rotations) {
        for (const scale of scales) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetSize, targetSize);
          ctx.save();
          ctx.translate(targetSize / 2, targetSize / 2 + 1);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.scale(scale, scale);
          ctx.fillStyle = '#000000';
          ctx.font = font;
          ctx.fillText(symbol, 0, 0);
          ctx.restore();
          variants.push(canvasToInkVector(canvas));
        }
      }
    }
    templateCacheRef.current.set(cacheKey, variants);
    return variants;
  }

  function scoreTemplate(input: number[], template: number[]): number {
    let dot = 0;
    let inputMag = 0;
    let templateMag = 0;
    for (let index = 0; index < input.length; index += 1) {
      const a = input[index] ?? 0;
      const b = template[index] ?? 0;
      dot += a * b;
      inputMag += a * a;
      templateMag += b * b;
    }
    if (inputMag === 0 || templateMag === 0) return Number.NEGATIVE_INFINITY;
    return dot / (Math.sqrt(inputMag) * Math.sqrt(templateMag));
  }

  function recognizeCharacterDetailed(group: Array<Array<{ x: number; y: number }>>) {
    const input = renderStrokeGroupToVector(group);
    const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');
    const scored = symbols
      .map((symbol) => {
        const scores = buildTemplateVariants(symbol).map((template) => scoreTemplate(input, template)).sort((a, b) => b - a);
        return { symbol, score: scores[0] ?? Number.NEGATIVE_INFINITY };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0] ?? { symbol: '?', score: 0 };
    const second = scored[1]?.score ?? 0;
    return {
      symbol: best.score >= 0.18 ? best.symbol : '?',
      score: best.score,
      alternatives: scored.slice(0, 5),
      confidenceGap: best.score - second,
    };
  }

  function autocorrectWord(word: string): string {
    const dictionary = ['Hi', 'hello', 'the', 'and', 'you', 'math', 'number', 'answer', 'student', 'teacher', 'school', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'zero'];
    const clean = word.replace(/[^A-Za-z]/g, '');
    if (clean.length < 2) return word;
    const exact = dictionary.find((entry) => entry.toLowerCase() === clean.toLowerCase());
    if (exact) return exact;
    const close = dictionary
      .map((entry) => ({ entry, distance: levenshtein(clean.toLowerCase(), entry.toLowerCase()) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return close && close.distance <= Math.max(1, Math.floor(clean.length * 0.34)) ? close.entry : word;
  }

  function levenshtein(a: string, b: string): number {
    const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i]![0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0]![j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        dp[i]![j] = Math.min(
          dp[i - 1]![j]! + 1,
          dp[i]![j - 1]! + 1,
          dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      }
    }
    return dp[a.length]![b.length]!;
  }

  async function recognizeOffline() {
    if (!hasInk) return;
    setIsRecognizing(true);
    try {
      const groups = groupStrokesIntoCharacters();
      const details = groups.map((group) => (typeof group === 'string' ? group : recognizeCharacterDetailed(group)));
      const raw = details.map((detail) => (typeof detail === 'string' ? detail : detail.symbol)).join('');
      const corrected = raw.split(/\s+/).map(autocorrectWord).join(' ');
      const topAlternatives = details
        .map((detail, index) => typeof detail === 'string' ? `${index + 1}: separator ${JSON.stringify(detail)}` : `${index + 1}: ${detail.alternatives.map((alt) => `${alt.symbol} ${alt.score.toFixed(2)}`).join(', ')}`)
        .join(' | ');
      setRecognizedText(corrected);
      setCandidates([corrected, raw, topAlternatives].filter((value, index, array) => value && array.indexOf(value) === index));
      // Build positioned overlays per word
      try {
        const lines = segmentStrokes();
        const items: Array<{ x: number; y: number; w: number; text: string }> = [];
        let idx = 0;
        for (const line of lines) {
          for (let wi = 0; wi < line.words.length; wi++) {
            const word = line.words[wi];
            let text = '';
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const group of word.characters) {
              const d = details[idx++];
              const ch = typeof d === 'string' ? d : d.symbol;
              if (ch === ' ' || ch === '\n') continue;
              text += ch;
              const b = strokeBounds(group);
              if (b) {
                minX = Math.min(minX, b.minX);
                minY = Math.min(minY, b.minY);
                maxX = Math.max(maxX, b.maxX);
                maxY = Math.max(maxY, b.maxY);
              }
            }
            if (text.trim() && isFinite(minX)) {
              items.push({ x: minX, y: Math.max(0, minY - 18), w: Math.max(24, maxX - minX), text: text.trim() });
            }
          }
        }
        setOverlays(items);
      } catch {
        setOverlays([]);
      }
    } finally {
      setIsRecognizing(false);
    }
  }

  useEffect(() => {
    return () => {
      if (recognitionTimerRef.current) window.clearTimeout(recognitionTimerRef.current);
    }
  }, []);

  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>✍️ Freehand Work Pad</h3>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Offline prototype: write English letters or numbers, pause for a moment, and the pad auto-converts strokes into text without calling any server or AI.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={async () => {
              try { await navigator.clipboard.writeText(recognizedText || ''); } catch {}
            }}
            className="ll-btn"
            disabled={!recognizedText}
            style={{ padding: '8px 12px', fontSize: 12 }}
          >Copy recognized text</button>
          <button onClick={clearPad} className="ll-btn" style={{ padding: '8px 12px', fontSize: 12 }}>Clear</button>
          <div style={{ color: isRecognizing ? '#67e8f9' : '#94a3b8', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center' }}>
            {isRecognizing ? 'Auto-recognizing...' : 'Auto mode on'}
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: 14, border: '1px solid #475569', background: 'white', touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
        />
        {overlays.map((o, i) => (
          <div key={i} style={{ position: 'absolute', left: o.x, top: o.y, maxWidth: o.w, fontSize: 12, background: 'rgba(255,255,255,0.85)', border: '1px solid #cbd5e1', color: '#0f172a', padding: '2px 6px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {o.text}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginTop: 12 }}>
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Recognized output</div>
          <textarea
            value={recognizedText}
            onChange={(event) => setRecognizedText(event.target.value)}
            placeholder="Offline recognition result appears automatically after you pause writing..."
            rows={7}
            style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 10, border: '1px solid #334155', background: '#020617', color: 'white', resize: 'vertical', outline: 'none' }}
          />
        </div>
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Debug / alternatives</div>
          <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.5 }}>
            <div><b>Mode:</b> Offline template matching</div>
            <div><b>Current scope:</b> A-Z, a-z, and 0-9 printed handwriting prototype</div>
            <div><b>Text:</b> {recognizedText || '—'}</div>
            <div style={{ marginTop: 8 }}><b>Candidates:</b> {candidates.length > 0 ? candidates.join(' · ') : '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefinedDeep(v)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function toPromptBlocks(value: unknown, fallbackText: string): ProgramPromptBlock[] {
  if (Array.isArray(value) && value.length > 0) {
    return value
      .map((block) => {
        const item = asRecord(block);
        if (!item || typeof item.type !== 'string') return null;
        if (item.type === 'text' || item.type === 'note') {
          return typeof item.text === 'string' ? { type: 'text', text: item.text } satisfies ProgramPromptBlock : null;
        }
        if (item.type === 'latex' || item.type === 'math') {
          return typeof item.text === 'string'
            ? { type: 'math', latex: item.text } satisfies ProgramPromptBlock
            : (typeof item.latex === 'string' ? { type: 'math', latex: item.latex } satisfies ProgramPromptBlock : null);
        }
        if (item.type === 'image' && typeof item.url === 'string') {
          return { type: 'image', url: item.url, alt: typeof item.alt === 'string' ? item.alt : undefined } satisfies ProgramPromptBlock;
        }
        if (item.type === 'table' && Array.isArray(item.rows)) {
          return {
            type: 'table',
            rows: item.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell)) : [])),
            headerRows: typeof item.headerRows === 'number' ? item.headerRows : undefined,
          } satisfies ProgramPromptBlock;
        }
        return null;
      })
      .filter(Boolean) as ProgramPromptBlock[];
  }
  return [{ type: 'text', text: fallbackText }];
}

function deterministicAnswerToInteraction(value: unknown): ProgramAtomicInteractionSpec | null {
  const answer = asRecord(value);
  if (!answer || typeof answer.type !== 'string') return null;
  if (answer.type === 'choice') {
    const choices = Array.isArray(answer.choices) ? answer.choices.map((choice) => String(choice)) : [];
    const correctChoiceIndex = Number(answer.correctChoiceIndex);
    if (choices.length >= 2 && Number.isInteger(correctChoiceIndex) && correctChoiceIndex >= 0 && correctChoiceIndex < choices.length) {
      return { type: 'mcq', choices, correctChoiceIndex };
    }
    return null;
  }
  if (answer.type === 'number') {
    const rawCorrect = Array.isArray(answer.correct) ? answer.correct : [answer.correct];
    const correct = rawCorrect
      .map((item) => (typeof item === 'number' ? item : Number(item)))
      .filter((item) => Number.isFinite(item));
    if (correct.length === 0) return null;
    return {
      type: 'numeric',
      correct: correct.length === 1 ? correct[0]! : correct,
      tolerance: typeof answer.tolerance === 'number' ? answer.tolerance : undefined,
    };
  }
  if (answer.type === 'text') {
    const accepted = Array.isArray(answer.accepted) ? answer.accepted.map((item) => String(item)).filter(Boolean) : [];
    if (accepted.length === 0) return null;
    return {
      type: 'text',
      accepted,
      caseSensitive: answer.caseSensitive === true,
      trim: answer.trim !== false,
    };
  }
  if (answer.type === 'line_equation') {
    const forms = Array.isArray(answer.forms) ? answer.forms.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];
    if (forms.length === 0) return null;
    return {
      type: 'line_equation',
      forms,
      variable: typeof answer.variable === 'string' && answer.variable.trim().length > 0 ? answer.variable : undefined,
      caseSensitive: answer.caseSensitive === true,
      trim: answer.trim !== false,
    };
  }
  if (answer.type === 'point_list') {
    const points = Array.isArray(answer.points)
      ? answer.points
          .map((point) => asRecord(point))
          .filter(Boolean)
          .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    if (points.length === 0) return null;
    return {
      type: 'point_list',
      points,
      minPoints: typeof answer.minPoints === 'number' ? answer.minPoints : undefined,
      maxPoints: typeof answer.maxPoints === 'number' ? answer.maxPoints : undefined,
      ordered: answer.ordered === true,
      allowEquivalentOrder: answer.allowEquivalentOrder !== false,
    };
  }
  if (answer.type === 'points_on_line') {
    const lineForms = Array.isArray(answer.lineForms) ? answer.lineForms.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];
    if (lineForms.length === 0) return null;
    const disallowGivenPoints = Array.isArray(answer.disallowGivenPoints)
      ? answer.disallowGivenPoints
          .map((point) => asRecord(point))
          .filter(Boolean)
          .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : undefined;
    return {
      type: 'points_on_line',
      lineForms,
      minPoints: typeof answer.minPoints === 'number' ? answer.minPoints : 1,
      maxPoints: typeof answer.maxPoints === 'number' ? answer.maxPoints : undefined,
      disallowGivenPoints,
      requireDistinct: answer.requireDistinct !== false,
    };
  }
  return null;
}

function getNormalizedExplanationScenes(value: unknown): ProgramExplanationScene[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((scene, idx) => {
      const item = asRecord(scene);
      if (!item) return null;
      return {
        id: typeof item.id === 'string' ? item.id : `scene_${idx + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : `Step ${idx + 1}`,
        narration: typeof item.narration === 'string' ? item.narration : null,
        beforeText: typeof item.beforeText === 'string' ? item.beforeText : null,
        afterText: typeof item.afterText === 'string' ? item.afterText : null,
        emphasis: Array.isArray(item.emphasis) ? item.emphasis.map((entry) => String(entry)).filter(Boolean) : undefined,
        action: item.action === 'highlight' || item.action === 'transform' || item.action === 'note' || item.action === 'reveal'
          ? item.action
          : undefined,
      } satisfies ProgramExplanationScene;
    })
    .filter(Boolean) as ProgramExplanationScene[];
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];
}

function getNormalizedSolutionSteps(value: unknown): ProgramStepSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((step, idx) => {
      const item = asRecord(step);
      if (!item) return null;
      const interaction = deterministicAnswerToInteraction(item.answer);
      if (!interaction) return null;
      return {
        id: typeof item.id === 'string' ? item.id : `step_${idx + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : `Step ${idx + 1}`,
        prompt: toPromptBlocks(item.prompt, typeof item.title === 'string' ? item.title : `Step ${idx + 1}`),
        interaction,
        explanation: typeof item.explanation === 'string' ? item.explanation : null,
      } satisfies ProgramStepSpec;
    })
    .filter(Boolean) as ProgramStepSpec[];
}

export default function SuperAdminPage() {
  const { user, userData } = useAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<Array<UserData & { uid: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // Relationship data
  const [ataLinks, setAtaLinks] = useState<AdminTeacherAssignment[]>([]);
  const [pslLinks, setPslLinks] = useState<ParentStudentLink[]>([]);

  // Teacher assignment modal (opened on admin rows)
  const [ataModal, setAtaModal] = useState<{ adminUid: string; adminName: string } | null>(null);
  const [ataSaving, setAtaSaving] = useState(false);

  // Economy modal
  const [econModal, setEconModal] = useState<{ uid: string; name: string; goldDelta: string; xpDelta: string; energyDelta: string; streakDelta: string } | null>(null);
  const [applyingEcon, setApplyingEcon] = useState(false);

  // Create account modal
  const [createModal, setCreateModal] = useState(false);
  const [createRole, setCreateRole] = useState<'teacher' | 'admin'>('teacher');
  const [createFname, setCreateFname] = useState('');
  const [createLname, setCreateLname] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPass, setCreatePass] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (userData && userData.role !== 'superadmin') setLocation('/');
    else loadData();
  }, [userData]);

  async function loadData() {
    setLoading(true);
    try {
      const [u, ata, psl] = await Promise.all([getAllUsers(), getAdminTeacherAssignments().catch(() => [] as AdminTeacherAssignment[]), getParentStudentLinks().catch(() => [] as ParentStudentLink[])]);
      setUsers(u);
      setAtaLinks(ata);
      setPslLinks(psl);
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteUser(uid: string) {
    const target = users.find(u => u.uid === uid);
    const isStudentOrParent = target?.role === 'student' || target?.role === 'parent';
    // Find paired account to remove from state
    let pairedUid: string | null = null;
    if (target?.role === 'student') {
      const link = pslLinks.find(l => l.student_id === uid);
      pairedUid = link?.parent_id ?? null;
    } else if (target?.role === 'parent') {
      const link = pslLinks.find(l => l.parent_id === uid);
      pairedUid = link?.student_id ?? null;
    }
    const msg = isStudentOrParent && pairedUid
      ? 'This will permanently delete BOTH the student and their linked parent account. Continue?'
      : 'Permanently delete this account? This cannot be undone.';
    if (!window.confirm(msg)) return;
    setDeletingUser(uid);
    await deleteUserData(uid);
    const removedIds = new Set([uid, ...(pairedUid ? [pairedUid] : [])]);
    setUsers(prev => prev.filter(u => !removedIds.has(u.uid)));
    setPslLinks(prev => prev.filter(l => !removedIds.has(l.student_id) && !removedIds.has(l.parent_id)));
    setDeletingUser(null);
  }

  async function handleEconApply() {
    if (!econModal) return;
    const gold = parseInt(econModal.goldDelta) || 0;
    const xp = parseInt(econModal.xpDelta) || 0;
    const energy = parseInt(econModal.energyDelta) || 0;
    const streak = parseInt(econModal.streakDelta) || 0;
    if (gold === 0 && xp === 0 && energy === 0 && streak === 0) { setEconModal(null); return; }
    setApplyingEcon(true);
    await adminUpdateEconomy(econModal.uid, { gold, xp, energy, streak });
    setUsers(prev => prev.map(u => u.uid === econModal.uid ? {
      ...u, economy: {
        ...u.economy,
        gold: Math.max(0, (u.economy?.gold || 0) + gold),
        global_xp: Math.max(0, (u.economy?.global_xp || 0) + xp),
        energy: Math.max(0, (u.economy?.energy || 0) + energy),
        streak: Math.max(0, (u.economy?.streak || 0) + streak),
      }
    } : u));
    setApplyingEcon(false);
    setEconModal(null);
  }

  async function handleCreateAccount() {
    if (!createFname || !createLname || !createUsername || !createEmail || !createPass) {
      setCreateError('Please fill in all fields.'); return;
    }
    if (createPass.length < 6) { setCreateError('Password must be at least 6 characters.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(createUsername)) { setCreateError('Username can only contain letters, numbers and underscores.'); return; }
    setCreating(true); setCreateError('');
    try {
      const taken = await isUsernameTaken(createUsername.toLowerCase());
      if (taken) { setCreateError('Username is already taken.'); return; }
      const admin = getAdminClient();
      const { data, error } = await admin.auth.admin.createUser({
        email: createEmail,
        password: createPass,
        email_confirm: true,
        user_metadata: { full_name: `${createFname} ${createLname}`.trim(), name: createUsername },
      });
      if (error) throw error;
      const authUser = data.user;
      if (!authUser) throw new Error('No user returned.');
      await createUserDataAdmin(authUser.id, {
        firstName: createFname, lastName: createLname, username: createUsername.toLowerCase(), email: createEmail,
        role: createRole, onboardingComplete: true,
      });
      setUsers(prev => [...prev, { uid: authUser.id, firstName: createFname, lastName: createLname, username: createUsername.toLowerCase(), email: createEmail, role: createRole, onboardingComplete: true } as UserData & { uid: string }]);
      setCreateModal(false);
      setCreateFname(''); setCreateLname(''); setCreateUsername(''); setCreateEmail(''); setCreatePass(''); setCreateError('');
    } catch (e: any) {
      setCreateError(e.message || 'Failed to create account.');
    } finally { setCreating(false); }
  }

  // Sort: parents above their linked students, then by role order, then alphabetically
  const sortedUsers = (() => {
    // Build parent→students map from pslLinks
    const parentStudents = new Map<string, string[]>();
    const studentParent = new Map<string, string>();
    for (const l of pslLinks) {
      if (!parentStudents.has(l.parent_id)) parentStudents.set(l.parent_id, []);
      parentStudents.get(l.parent_id)!.push(l.student_id);
      studentParent.set(l.student_id, l.parent_id);
    }
    // Group key: for linked parents/students, use the parent uid so they cluster together
    // Sort order within group: parent first (0), then students (1)
    type SortEntry = { user: typeof users[0]; groupKey: string; subOrder: number };
    const entries: SortEntry[] = users.map(u => {
      if (u.role === 'parent' && parentStudents.has(u.uid)) {
        return { user: u, groupKey: u.uid, subOrder: 0 };
      }
      if (u.role === 'student' && studentParent.has(u.uid)) {
        return { user: u, groupKey: studentParent.get(u.uid)!, subOrder: 1 };
      }
      return { user: u, groupKey: u.uid, subOrder: 0 };
    });
    entries.sort((a, b) => {
      if (a.groupKey !== b.groupKey) return a.groupKey < b.groupKey ? -1 : 1;
      return a.subOrder - b.subOrder;
    });
    return entries.map(e => e.user);
  })();

  const filtered = sortedUsers.filter(u => {
    const matchSearch = !search || [u.username, u.email, u.firstName, u.lastName].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const roleCounts = Object.fromEntries(ROLE_ORDER.map(r => [r, users.filter(u => u.role === r).length])) as Record<UserRole, number>;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👑</div>
          <div>Loading super admin panel...</div>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; icon: string; label: string; badge?: number }[] = [
    { id: 'overview', icon: '📊', label: 'Overview' },
    { id: 'users', icon: '👥', label: `Users (${users.length})` },
    { id: 'programs', icon: '📚', label: 'Programs' },
    { id: 'logicGames', icon: '🧩', label: 'Logic Games' },
    { id: 'testing', icon: '🧪', label: 'Testing' },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', background: '#1e293b', borderBottom: '2px solid #a855f744', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#a855f7' }}>👑</span> Super Admin Panel
              <span style={{ fontSize: 11, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#d8b4fe', borderRadius: 6, padding: '2px 8px', fontWeight: 'normal' }}>
                GOD MODE
              </span>
            </h2>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Full platform control · All accounts</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadData} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>
              ↺ Refresh
            </button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>
              Sign Out
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t.id ? 'rgba(168,85,247,0.2)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'rgba(168,85,247,0.5)' : 'transparent'}`,
              color: tab === t.id ? '#d8b4fe' : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6, position: 'relative'
            }}>
              {t.icon} {t.label}
              {t.badge != null && t.badge > 0 && (
                <span style={{
                  background: '#ef4444', color: 'white', borderRadius: '50%',
                  fontSize: 9, fontWeight: 'bold', minWidth: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px', lineHeight: 1
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total Users', value: users.length, icon: '👤', color: '#c084fc' },
                { label: 'Students', value: roleCounts.student, icon: '🧑‍🎓', color: ROLE_COLORS.student },
                { label: 'Admins', value: roleCounts.admin, icon: '🛡️', color: ROLE_COLORS.admin },
                { label: 'Teachers', value: roleCounts.teacher, icon: '�', color: ROLE_COLORS.teacher },
                { label: 'TAs', value: roleCounts.teacher_assistant, icon: '✏️', color: ROLE_COLORS.teacher_assistant },
                { label: 'Parents', value: roleCounts.parent, icon: '👨‍👩‍👧', color: ROLE_COLORS.parent },
                { label: 'Super Admins', value: roleCounts.superadmin, icon: '👑', color: ROLE_COLORS.superadmin },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: '#1e293b', borderRadius: 10, padding: '14px 12px',
                  border: `1px solid ${stat.color}33`, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Top XP — students only */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155', marginBottom: 14 }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14 }}>🏆 Top Student XP</h3>
              {[...users].filter(u => u.role === 'student').sort((a, b) => (b.economy?.global_xp || 0) - (a.economy?.global_xp || 0)).slice(0, 6).map((u, i) => {
                const { level, title } = computeLevel(u.economy?.global_xp || 0);
                const medals = ['🥇', '🥈', '🥉', '4', '5', '6'];
                return (
                  <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < 5 ? '1px solid #1e293b' : 'none' }}>
                    <span style={{ width: 22, fontSize: 14 }}>{medals[i]}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{u.username || `${u.firstName} ${u.lastName}`}</div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Lv.{level} {title}</div>
                    </div>
                    <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 12 }}>{(u.economy?.global_xp || 0).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search name, username, email..."
                style={{ flex: 1, minWidth: 180, padding: '9px 13px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
              />
              <select
                value={roleFilter} onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
                style={{ padding: '9px 13px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', outline: 'none' }}
              >
                <option value="all">All Roles</option>
                {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}s ({roleCounts[r]})</option>)}
              </select>
              <button
                onClick={() => setCreateModal(true)}
                style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                + Create Account
              </button>
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>{filtered.length} users</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(u => {
                const isStudent = u.role === 'student';
                const { level, title } = isStudent ? computeLevel(u.economy?.global_xp || 0) : { level: 0, title: '' };
                const isExpanded = expandedUser === u.uid;
                const isSelf = u.uid === user?.uid;
                const roleColor = ROLE_COLORS[u.role as UserRole] || '#475569';
                const roleLabel = ROLE_LABELS[u.role as UserRole] || u.role;

                // Relationship info
                const managedTeachers = u.role === 'admin' ? ataLinks.filter(a => a.admin_id === u.uid).map(a => users.find(x => x.uid === a.teacher_id)).filter(Boolean) : [];
                const managingAdmins = u.role === 'teacher' ? ataLinks.filter(a => a.teacher_id === u.uid).map(a => users.find(x => x.uid === a.admin_id)).filter(Boolean) : [];
                const linkedParent = u.role === 'student' ? (() => { const link = pslLinks.find(l => l.student_id === u.uid); return link ? users.find(x => x.uid === link.parent_id) : null; })() : null;
                const linkedStudents = u.role === 'parent' ? pslLinks.filter(l => l.parent_id === u.uid).map(l => users.find(x => x.uid === l.student_id)).filter(Boolean) : [];

                return (
                  <div key={u.uid} style={{ background: '#1e293b', borderRadius: 10, border: `1px solid ${isExpanded ? '#a855f788' : '#334155'}`, overflow: 'hidden' }}>
                    <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                        style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                          background: `hsl(${(u.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 'bold', color: 'white', fontSize: 14, border: 'none', cursor: 'pointer'
                        }}
                      >
                        {(u.username?.[0] || '?').toUpperCase()}
                      </button>
                      <div style={{ flex: 1, minWidth: 100 }}>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13 }}>
                          {u.username || `${u.firstName} ${u.lastName}`}
                          {isSelf && <span style={{ marginLeft: 6, fontSize: 10, color: '#a855f7' }}>(you)</span>}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>
                          {u.email}{isStudent ? ` · Lv.${level} ${title}` : ''}
                          {/* Relationship hints */}
                          {u.role === 'admin' && managedTeachers.length > 0 && (
                            <span style={{ color: ROLE_COLORS.teacher }}> · {managedTeachers.length} teacher{managedTeachers.length !== 1 ? 's' : ''}</span>
                          )}
                          {u.role === 'teacher' && managingAdmins.length > 0 && (
                            <span style={{ color: ROLE_COLORS.admin }}> · admin: {managingAdmins.map(a => a!.username || a!.firstName).join(', ')}</span>
                          )}
                          {u.role === 'student' && linkedParent && (
                            <span style={{ color: ROLE_COLORS.parent }}> · parent: {linkedParent.username || linkedParent.firstName}</span>
                          )}
                          {u.role === 'parent' && linkedStudents.length > 0 && (
                            <span style={{ color: ROLE_COLORS.student }}> · {linkedStudents.length} student{linkedStudents.length !== 1 ? 's' : ''}: {linkedStudents.map(s => s!.username || s!.firstName).join(', ')}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5,
                          background: `${roleColor}22`, border: `1px solid ${roleColor}55`, color: roleColor
                        }}>{roleLabel}</span>
                        {!isSelf && (user?.email === 'god.bypass@internal.app' || u.role !== 'superadmin') && (
                          <>
                            {u.role === 'admin' && (
                              <button
                                onClick={() => setAtaModal({ adminUid: u.uid, adminName: u.username || u.firstName })}
                                style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                              >
                                👥 Teachers
                              </button>
                            )}
                            {isStudent && (
                              <button
                                onClick={() => setEconModal({ uid: u.uid, name: u.username || u.firstName, goldDelta: '', xpDelta: '', energyDelta: '', streakDelta: '' })}
                                style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                ✏️
                              </button>
                            )}
                            <button
                              disabled={deletingUser === u.uid}
                              onClick={() => handleDeleteUser(u.uid)}
                              style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid #334155' }}>
                        {isStudent && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                            {[
                              { label: 'XP', value: (u.economy?.global_xp || 0).toLocaleString(), color: '#10b981' },
                              { label: 'Gold', value: (u.economy?.gold || 0).toLocaleString(), color: '#fbbf24' },
                              { label: 'Energy', value: (u.economy?.energy || 0).toLocaleString(), color: '#06b6d4' },
                              { label: 'Streak', value: u.economy?.streak ?? 0, color: '#f97316' },
                              { label: 'Arena W', value: u.arenaStats?.wins ?? 0, color: '#3b82f6' },
                              { label: 'Arena L', value: u.arenaStats?.losses ?? 0, color: '#ef4444' },
                            ].map(s => (
                              <div key={s.label} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: '1px solid #334155' }}>
                                <div style={{ fontSize: 14, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                                <div style={{ color: '#475569', fontSize: 10 }}>{s.label}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {!isStudent && (
                          <div style={{ color: '#64748b', fontSize: 12 }}>No game stats — only student accounts participate in games.</div>
                        )}
                        {/* Admin: list managed teachers */}
                        {u.role === 'admin' && managedTeachers.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Managed Teachers:</div>
                            {managedTeachers.map(t => (
                              <div key={t!.uid} style={{ display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 5, marginRight: 4, marginBottom: 4, background: `${ROLE_COLORS.teacher}22`, border: `1px solid ${ROLE_COLORS.teacher}44`, color: ROLE_COLORS.teacher }}>
                                {t!.username || t!.firstName}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Teacher: list managing admins */}
                        {u.role === 'teacher' && managingAdmins.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Managed by Admins:</div>
                            {managingAdmins.map(a => (
                              <div key={a!.uid} style={{ display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 5, marginRight: 4, marginBottom: 4, background: `${ROLE_COLORS.admin}22`, border: `1px solid ${ROLE_COLORS.admin}44`, color: ROLE_COLORS.admin }}>
                                {a!.username || a!.firstName}
                              </div>
                            ))}
                          </div>
                        )}
                        {u.curriculumProfile && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
                            Curriculum: {u.curriculumProfile.system} · {u.curriculumProfile.year}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Login as "${u.username || u.firstName}"? You will be signed out of your superadmin session.`)) return;
                              try {
                                const admin = getAdminClient();
                                const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
                                  type: 'magiclink',
                                  email: u.email,
                                });
                                if (linkError) throw linkError;
                                const token_hash = linkData?.properties?.hashed_token;
                                if (!token_hash) throw new Error('No token returned.');
                                const supabase = requireSupabase();
                                // Do NOT signOut first — it triggers onAuthStateChange which
                                // unmounts this component before verifyOtp can run.
                                // verifyOtp will replace the current session automatically.
                                const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
                                if (verifyErr) throw verifyErr;
                                localStorage.removeItem('ll:superadmin_session');
                                window.location.href = '/';
                              } catch (e: any) {
                                console.error('Impersonation error:', e);
                                window.alert('Impersonation failed: ' + (e.message || String(e)));
                              }
                            }}
                            style={{
                              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold',
                              fontFamily: 'inherit', cursor: 'pointer',
                              background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)',
                              color: '#c084fc',
                            }}
                          >
                            🔑 Login as {u.username || u.firstName}
                          </button>
                        </div>
                        <div style={{ color: '#475569', fontSize: 10, marginTop: 6 }}>UID: {u.uid}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PROGRAMS ── */}
        <div style={{ display: tab === 'programs' ? 'block' : 'none' }}>
          <ProgramsAdmin />
        </div>

        {/* ── LOGIC GAMES ── */}
        {tab === 'logicGames' && (
          <LogicGamesAdmin />
        )}

        {/* ── TESTING (MyScript) ── */}
        {tab === 'testing' && (
          <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 420 }}>
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 16 }}>
              <h2 style={{ color: 'white', margin: '0 0 6px', fontSize: 18 }}>🧪 Testing — MyScript Whiteboard</h2>
              <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                Write with your finger or mouse. When MyScript SDK is connected, ink will be replaced inline with text/math/shapes.
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap', color: '#cbd5e1', fontSize: 12 }}>
                <div><b>VITE_MYSCRIPT_APP_KEY:</b> {import.meta.env.VITE_MYSCRIPT_APP_KEY ? 'set' : 'missing'}</div>
                <div><b>VITE_MYSCRIPT_HMAC_KEY:</b> {import.meta.env.VITE_MYSCRIPT_HMAC_KEY ? 'set' : 'missing'}</div>
                <div><b>VITE_MYSCRIPT_JS_URL:</b> {import.meta.env.VITE_MYSCRIPT_JS_URL || '/myscript/iink.min.js'}</div>
                <div><b>VITE_MYSCRIPT_CSS_URL:</b> {import.meta.env.VITE_MYSCRIPT_CSS_URL || '/myscript/iink.css'}</div>
                <div><b>VITE_MYSCRIPT_TAG:</b> {import.meta.env.VITE_MYSCRIPT_TAG || 'iink-editor'}</div>
                <div><b>VITE_MYSCRIPT_GLOBAL:</b> {import.meta.env.VITE_MYSCRIPT_GLOBAL || 'iink'}</div>
                <div><b>VITE_MYSCRIPT_SERVER_SCHEME:</b> {import.meta.env.VITE_MYSCRIPT_SERVER_SCHEME || 'unset'}</div>
                <div><b>VITE_MYSCRIPT_SERVER_HOST:</b> {import.meta.env.VITE_MYSCRIPT_SERVER_HOST || 'unset'}</div>
              </div>
            </div>
            <TestingWhiteboard />
          </div>
        )}

      </div>

      {/* Economy modal */}
      {econModal && (
        <>
          <div onClick={() => setEconModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(360px, 92vw)',
            border: '2px solid #fbbf24', zIndex: 1001, animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 14px', color: 'white', fontSize: 17 }}>✏️ Adjust Economy — {econModal.name}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 14 }}>
              <div>
                <label style={{ color: '#fbbf24', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>🪙 Gold Δ</label>
                <input type="number" placeholder="0" value={econModal.goldDelta}
                  onChange={e => setEconModal(p => p ? { ...p, goldDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#10b981', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>⭐ XP Δ</label>
                <input type="number" placeholder="0" value={econModal.xpDelta}
                  onChange={e => setEconModal(p => p ? { ...p, xpDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#06b6d4', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>⚡ Energy Δ</label>
                <input type="number" placeholder="0" value={econModal.energyDelta}
                  onChange={e => setEconModal(p => p ? { ...p, energyDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#f97316', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>🔥 Streak Δ</label>
                <input type="number" placeholder="0" value={econModal.streakDelta}
                  onChange={e => setEconModal(p => p ? { ...p, streakDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEconModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleEconApply} disabled={applyingEcon} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {applyingEcon ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Account modal */}
      {createModal && (
        <>
          <div onClick={() => setCreateModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 14, border: '2px solid #a855f7', padding: 24,
            zIndex: 1001, width: 'min(380px, 90vw)', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          }}>
            <h3 style={{ color: 'white', margin: '0 0 16px', fontSize: 16 }}>Create Teacher / Admin Account</h3>
            {createError && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>{createError}</div>}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['teacher', 'admin'] as const).map(r => (
                <button key={r} onClick={() => setCreateRole(r)} style={{
                  flex: 1, padding: '8px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', cursor: 'pointer',
                  background: createRole === r ? `${ROLE_COLORS[r]}22` : 'transparent',
                  border: `1px solid ${createRole === r ? `${ROLE_COLORS[r]}88` : '#334155'}`,
                  color: createRole === r ? ROLE_COLORS[r] : '#64748b',
                }}>{ROLE_LABELS[r]}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={createFname} onChange={e => setCreateFname(e.target.value)} placeholder="First Name" style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              <input value={createLname} onChange={e => setCreateLname(e.target.value)} placeholder="Last Name" style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <input value={createUsername} onChange={e => setCreateUsername(e.target.value.toLowerCase().trim())} placeholder="Username" style={{ width: '100%', padding: '9px 12px', marginBottom: 8, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            <input value={createEmail} onChange={e => setCreateEmail(e.target.value.trim())} placeholder="Email" type="email" style={{ width: '100%', padding: '9px 12px', marginBottom: 8, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            <input value={createPass} onChange={e => setCreatePass(e.target.value)} placeholder="Password (min 6)" type="password" style={{ width: '100%', padding: '9px 12px', marginBottom: 14, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCreateModal(false)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleCreateAccount} disabled={creating} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {creating ? 'Creating...' : `Create ${ROLE_LABELS[createRole]}`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Admin ↔ Teacher assignment modal */}
      {ataModal && (() => {
        const allTeachers = users.filter(u => u.role === 'teacher');
        const assignedIds = new Set(ataLinks.filter(a => a.admin_id === ataModal.adminUid).map(a => a.teacher_id));

        async function toggleTeacher(teacherId: string) {
          setAtaSaving(true);
          try {
            if (assignedIds.has(teacherId)) {
              await removeAdminTeacherAssignment(ataModal!.adminUid, teacherId);
              setAtaLinks(prev => prev.filter(a => !(a.admin_id === ataModal!.adminUid && a.teacher_id === teacherId)));
            } else {
              await addAdminTeacherAssignment(ataModal!.adminUid, teacherId);
              setAtaLinks(prev => [...prev, { admin_id: ataModal!.adminUid, teacher_id: teacherId }]);
            }
          } catch (e) {
            console.error('Failed to update teacher assignment:', e);
            window.alert('Failed: ' + (e instanceof Error ? e.message : String(e)));
          } finally {
            setAtaSaving(false);
          }
        }

        return (
          <>
            <div onClick={() => setAtaModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(420px, 92vw)',
              maxHeight: '80vh', display: 'flex', flexDirection: 'column',
              border: `2px solid ${ROLE_COLORS.teacher}`, zIndex: 1001, animation: 'slideUp 0.2s ease'
            }}>
              <h2 style={{ margin: '0 0 6px', color: 'white', fontSize: 17 }}>
                👥 Manage Teachers — {ataModal.adminName}
              </h2>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 14 }}>
                Check/uncheck teachers this admin manages. {allTeachers.length === 0 && <span style={{ color: '#f59e0b' }}>No users with Teacher role found.</span>}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allTeachers.map(t => {
                  const checked = assignedIds.has(t.uid);
                  return (
                    <label key={t.uid} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      background: checked ? `${ROLE_COLORS.teacher}15` : 'transparent',
                      border: `1px solid ${checked ? `${ROLE_COLORS.teacher}55` : '#334155'}`,
                    }}>
                      <input
                        type="checkbox" checked={checked} disabled={ataSaving}
                        onChange={() => toggleTeacher(t.uid)}
                        style={{ accentColor: ROLE_COLORS.teacher, width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{t.username || `${t.firstName} ${t.lastName}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{t.email}</div>
                      </div>
                      {checked && <span style={{ color: ROLE_COLORS.teacher, fontSize: 11, fontWeight: 'bold' }}>✓ Assigned</span>}
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setAtaModal(null)} className="ll-btn" style={{ padding: '10px 22px' }}>Done</button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function LogicGamesAdmin() {
  const { userData } = useAuth();
  const [, setLocation] = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [draftNodes, setDraftNodes] = useState<LogicGameNode[]>([]);
  const [selectedDraftNodeId, setSelectedDraftNodeId] = useState<string | null>(null);

  const [draftQuestionsJson, setDraftQuestionsJson] = useState('');
  const [draftQuestionsStatus, setDraftQuestionsStatus] = useState<string | null>(null);

  const [publishedNodes, setPublishedNodes] = useState<LogicGameNode[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const [draft, pub] = await Promise.all([listDraftLogicGameNodes(), listPublishedLogicGameNodes()]);
      setDraftNodes(draft);
      setPublishedNodes(pub);

      if (!selectedDraftNodeId && draft.length > 0) setSelectedDraftNodeId(draft[0].id);
      if (selectedDraftNodeId && draft.every((n) => n.id !== selectedDraftNodeId)) {
        setSelectedDraftNodeId(draft[0]?.id ?? null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to load logic game nodes');
    } finally {
      setLoading(false);
    }
  }

  async function renameDraftNode(nodeId: string) {
    const n = draftNodes.find((x) => x.id === nodeId);
    if (!n) return;
    const next = window.prompt('Enter node name', n.label ?? '') ?? '';
    const label = next.trim();

    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await upsertDraftLogicGameNode({ ...n, label });
      setDraftNodes((prev) => prev.map((x) => (x.id === nodeId ? { ...x, label } : x)));
      setStatus('✅ Renamed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to rename node');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadDraftQuestions() {
      if (!selectedDraftNodeId) return;
      setSaving(true);
      setErr(null);
      setDraftQuestionsStatus(null);
      try {
        const doc0 = await getDraftLogicGameQuestions(selectedDraftNodeId);
        const arr = Array.isArray(doc0?.questions) ? doc0!.questions : [];
        if (!alive) return;
        setDraftQuestionsJson(JSON.stringify(arr, null, 2));
        setDraftQuestionsStatus('Loaded draft JSON');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!alive) return;
        setErr(msg || 'Failed to load draft questions');
      } finally {
        if (alive) setSaving(false);
      }
    }
    void loadDraftQuestions();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftNodeId]);

  function validateQuestionsJson(arr: any[]): string | null {
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      if (!q || typeof q !== 'object') return `Question at index ${i} must be an object`;
      if (typeof q.id !== 'string' || !q.id.trim()) return `Question at index ${i} is missing a string 'id'`;
      if (!q.interaction || typeof q.interaction !== 'object') return `Question ${q.id} is missing 'interaction'`;
      if (typeof q.timeLimitSec !== 'number' || !Number.isFinite(q.timeLimitSec)) return `Question ${q.id} is missing numeric 'timeLimitSec'`;
      if (typeof q.iqDeltaCorrect !== 'number' || !Number.isFinite(q.iqDeltaCorrect)) return `Question ${q.id} is missing numeric 'iqDeltaCorrect'`;
      if (typeof q.iqDeltaWrong !== 'number' || !Number.isFinite(q.iqDeltaWrong)) return `Question ${q.id} is missing numeric 'iqDeltaWrong'`;
    }
    return null;
  }

  async function saveDraftQuestions() {
    if (!selectedDraftNodeId) return;
    setSaving(true);
    setErr(null);
    setDraftQuestionsStatus(null);
    try {
      const raw = draftQuestionsJson.trim() ? JSON.parse(draftQuestionsJson) : [];
      if (!Array.isArray(raw)) throw new Error('JSON must be an array of questions');
      const validationErr = validateQuestionsJson(raw);
      if (validationErr) throw new Error(validationErr);
      await upsertDraftLogicGameQuestions(selectedDraftNodeId, {
        questions: raw,
        updatedAt: new Date().toISOString(),
      } satisfies Omit<LogicGameQuestionsDoc, 'nodeId'>);
      setDraftQuestionsStatus('✅ Saved successfully');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to save draft JSON');
    } finally {
      setSaving(false);
    }
  }

  async function addDraftNode() {
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const nextOrder = draftNodes.length > 0 ? Math.max(...draftNodes.map((n) => n.order ?? 0)) + 1 : 0;
      const nextIq = draftNodes.length > 0 ? (draftNodes[draftNodes.length - 1].iq ?? 80) + 10 : 80;
      const id = `iq-${nextIq}`;
      const node: LogicGameNode = { id, iq: nextIq, order: nextOrder, label: '' };
      await upsertDraftLogicGameNode(node);
      await upsertDraftLogicGameQuestions(id, { questions: [], updatedAt: new Date().toISOString() });

      setDraftNodes((prev) => {
        const next = prev.some((n) => n.id === node.id) ? prev : [...prev, node];
        return next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      });
      setSelectedDraftNodeId(id);
      setStatus('✅ Node added');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to add node');
    } finally {
      setSaving(false);
    }
  }

  async function setDraftNodeIq(nodeId: string, nextIqRaw: string) {
    const nextIq = Number(nextIqRaw);
    if (!Number.isFinite(nextIq)) return;
    const n = draftNodes.find((x) => x.id === nodeId);
    if (!n) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await upsertDraftLogicGameNode({ ...n, iq: nextIq });

      setDraftNodes((prev) =>
        prev
          .map((x) => (x.id === nodeId ? { ...x, iq: nextIq } : x))
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
      setStatus('✅ Node IQ saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to save node IQ');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraftNode(nodeId: string) {
    if (!window.confirm('Delete this draft node + its draft questions?')) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await deleteDraftLogicGameNode(nodeId);
      if (selectedDraftNodeId === nodeId) setSelectedDraftNodeId(null);
      setDraftQuestionsJson('');
      setDraftQuestionsStatus(null);
      await load();
      setStatus('✅ Draft node deleted');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to delete draft node');
    } finally {
      setSaving(false);
    }
  }

  function openPreviewAll() {
    localStorage.setItem('ll:logicGamePreviewUnlockAll', '1');
    setLocation('/logic-preview');
  }

  function openPreviewPublishedAll() {
    localStorage.setItem('ll:logicGamePreviewUnlockAll', '1');
    setLocation('/logic-preview');
  }

  async function publishSelectedDraftNode() {
    if (!selectedDraftNodeId) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await publishLogicGameNode(selectedDraftNodeId);
      await publishLogicGameQuestions(selectedDraftNodeId);
      await load();
      setStatus('✅ Published');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to publish');
    } finally {
      setSaving(false);
    }
  }

  async function publishAllDraftNodes() {
    if (draftNodes.length === 0) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      if (selectedDraftNodeId) {
        const raw = draftQuestionsJson.trim() ? JSON.parse(draftQuestionsJson) : [];
        if (!Array.isArray(raw)) throw new Error('JSON must be an array of questions');
        const validationErr = validateQuestionsJson(raw);
        if (validationErr) throw new Error(validationErr);
        await upsertDraftLogicGameQuestions(selectedDraftNodeId, {
          questions: raw,
          updatedAt: new Date().toISOString(),
        } satisfies Omit<LogicGameQuestionsDoc, 'nodeId'>);
        setDraftQuestionsStatus('✅ Saved successfully');
      }

      const sorted = draftNodes.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const n of sorted) {
        await publishLogicGameNode(n.id);
        try {
          await publishLogicGameQuestions(n.id);
        } catch (e) {
          const existing = await getDraftLogicGameQuestions(n.id);
          if (!existing) {
            await upsertDraftLogicGameQuestions(n.id, { questions: [], updatedAt: new Date().toISOString() });
            await publishLogicGameQuestions(n.id);
          } else {
            throw e;
          }
        }
      }

      const pub = await listPublishedLogicGameNodes();
      setPublishedNodes(pub);
      setStatus(`✅ Published ${sorted.length} nodes`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to publish draft nodes');
    } finally {
      setSaving(false);
    }
  }

  if (!userData || userData.role !== 'superadmin') return null;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>🧩 Logic Games</h3>
        <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>
          ↺ Refresh
        </button>
      </div>

      {err && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {status && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10 }}>{status}</div>}


      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Current Nodes (Draft)</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>{draftNodes.length}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={addDraftNode} disabled={saving} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12, fontWeight: 1000 }}>
                +
              </button>
              <button onClick={publishAllDraftNodes} disabled={saving || draftNodes.length === 0} className="ll-btn ll-btn-primary" style={{ padding: '7px 12px', fontSize: 12 }}>
                Publish
              </button>
            </div>
          </div>

          <div style={{ padding: 12 }}>
            {loading ? (
              <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>
            ) : draftNodes.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No draft nodes yet. Click + to add one.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {draftNodes
                  .slice()
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((n, idx, arr) => {
                    const active = n.id === selectedDraftNodeId;
                    return (
                      <div key={n.id}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                          <button
                            onClick={() => setSelectedDraftNodeId(n.id)}
                            className="ll-btn"
                            style={{
                              flex: 1,
                              textAlign: 'left',
                              padding: '10px 10px',
                              borderRadius: 12,
                              background: active ? 'rgba(34,197,94,0.12)' : 'rgba(15,23,42,0.55)',
                              border: active ? '1px solid rgba(34,197,94,0.45)' : '1px solid #334155',
                              color: active ? '#bbf7d0' : 'white',
                              fontWeight: 900,
                            }}
                          >
                            {n.label}
                          </button>

                          <button
                            className="ll-btn"
                            title="Rename"
                            onClick={() => void renameDraftNode(n.id)}
                            style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000 }}
                          >
                            ✎
                          </button>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 900 }}>Start IQ</div>
                            <input
                              defaultValue={String(n.iq ?? 80)}
                              onBlur={(e) => void setDraftNodeIq(n.id, e.target.value)}
                              style={{ width: 90, padding: '9px 10px', borderRadius: 10, border: '1px solid #475569', background: '#0f172a', color: 'white', fontWeight: 900, outline: 'none' }}
                            />
                          </div>

                          <button
                            className="ll-btn"
                            title="Delete"
                            onClick={() => void deleteDraftNode(n.id)}
                            style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                          >
                            🗑
                          </button>
                        </div>

                        {idx < arr.length - 1 && (
                          <div style={{ paddingLeft: 12, paddingTop: 8, color: '#64748b', fontWeight: 900 }}>
                            →
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Selected Node JSON (Draft)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={openPreviewAll} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>Preview</button>
                <button onClick={saveDraftQuestions} disabled={!selectedDraftNodeId || saving} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>Save</button>
              </div>
            </div>

            {draftQuestionsStatus && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10 }}>{draftQuestionsStatus}</div>}

            {!selectedDraftNodeId ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>Select a draft node to edit its JSON.</div>
            ) : (
              <textarea
                value={draftQuestionsJson}
                onChange={(e) => setDraftQuestionsJson(e.target.value)}
                placeholder='Paste JSON array of questions here. Each question must include: id, interaction, timeLimitSec, iqDeltaCorrect, iqDeltaWrong.'
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 420,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: 'white',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>

          <div style={{ background: '#0b1220', border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: 12, borderBottom: '1px solid #1f2a44', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Published Nodes</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#64748b', fontSize: 11 }}>{publishedNodes.length}</div>
                <button onClick={openPreviewPublishedAll} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>
                  Preview
                </button>
              </div>
            </div>
            <div style={{ padding: 12 }}>
              {publishedNodes.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 12 }}>No published nodes yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {publishedNodes
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((n) => (
                      <div key={n.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                        <div
                          style={{
                            flex: 1,
                            padding: '10px 10px',
                            borderRadius: 12,
                            background: 'rgba(15,23,42,0.55)',
                            border: '1px solid #334155',
                            color: 'white',
                            fontWeight: 900,
                          }}
                        >
                          {n.label}
                          <span style={{ color: '#64748b', fontWeight: 800, marginLeft: 8, fontSize: 11 }}>(order {n.order})</span>
                        </div>
                        <button
                          className="ll-btn"
                          title="Delete"
                          onClick={async () => {
                            if (!window.confirm('Delete this published node + its questions?')) return;
                            setSaving(true);
                            setErr(null);
                            setStatus(null);
                            try {
                              await deletePublishedLogicGameNode(n.id);
                              await load();
                              setStatus('✅ Published node deleted');
                            } catch (e) {
                              const msg = e instanceof Error ? e.message : String(e);
                              setErr(msg || 'Failed to delete node');
                            } finally {
                              setSaving(false);
                            }
                          }}
                          style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgramsAdmin() {
  const { user, userData } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [draftItems, setDraftItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'list' | 'builder' | 'preview'>('list');
  const [previewReturnView, setPreviewReturnView] = useState<'list' | 'builder'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubject, setDraftSubject] = useState('mathematics');
  const [draftGradeBand, setDraftGradeBand] = useState('');
  const [draftEmoji, setDraftEmoji] = useState('📘');
  const [draftTocJson, setDraftTocJson] = useState('');
  const [draftQuestionBankJson, setDraftQuestionBankJson] = useState('');
  const [draftAnnotationsJson, setDraftAnnotationsJson] = useState('');
  const [draftProgramMetaJson, setDraftProgramMetaJson] = useState('');
  const [draftNestedJson, setDraftNestedJson] = useState('');
  const [nestedGenStatus, setNestedGenStatus] = useState<string>('');

  const [builder, setBuilder] = useState<BuilderSpec>(() => newBuilderSpec());
  const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);
  const [builderSelectedQuestionTypeId, setBuilderSelectedQuestionTypeId] = useState<string | null>(null);
  const [previewProgramId, setPreviewProgramId] = useState<string | null>(null);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadedImageErr, setUploadedImageErr] = useState<string>('');

  const [digitalizeFiles, setDigitalizeFiles] = useState<File[]>([]);
  const [digitalizeBusy, setDigitalizeBusy] = useState(false);
  const [digitalizeStatus, setDigitalizeStatus] = useState('');
  const [digitalizeError, setDigitalizeError] = useState('');
  const [digitalizePastedText, setDigitalizePastedText] = useState('');
  const [aiImportJson, setAiImportJson] = useState('');
  const [aiImportStatus, setAiImportStatus] = useState('');
  const [aiImportError, setAiImportError] = useState('');
  const [notebookImportJson, setNotebookImportJson] = useState('');
  const [notebookValidation, setNotebookValidation] = useState<NotebookValidationResult | null>(null);

  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 13px',
    marginBottom: 12,
    borderRadius: 8,
    border: '1px solid #475569',
    background: 'rgba(0,0,0,0.4)',
    color: 'white',
    boxSizing: 'border-box',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
  };

  function cleanGeneratedTitle(raw: string | null | undefined, fallbackFileName?: string): string {
    const source = (raw ?? '').trim() || (fallbackFileName ?? '').replace(/\.[^.]+$/, '');
    const withoutPrefix = source.replace(/^[a-z0-9]{6,}(?:[-_\s]+|$)/i, '');
    const normalized = withoutPrefix
      .replace(/[_-]+/g, ' ')
      .replace(/\bEquation\s*20a\b/i, 'Equation')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized || /^[a-z0-9]{6,}$/i.test(normalized) || /^worksheet$/i.test(normalized)) return 'Imported Worksheet';
    return normalized;
  }

  function cleanFolderLabel(raw: string): string {
    const cleaned = raw
      .replace(/\.[^.]+$/, '')
      .replace(/^[a-z0-9]{6,}[-_]+/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'Topic 1';
  }

  function summarizeImportedTopic(text: string): string {
    const joined = text.toLowerCase();
    if (/equation of the line|line passes through|points .* line|y\s*=/.test(joined)) return 'Lines and Linear Equations';
    if (/graph|coordinate/.test(joined)) return 'Graphs and Coordinates';
    if (/fraction/.test(joined)) return 'Fractions';
    if (/algebra/.test(joined)) return 'Algebra Practice';
    return 'Worksheet Practice';
  }

  function chooseImportedQuestionTypeTitle(text: string): string {
    if (/equation of the line|line passes through|points .* line|y\s*=/.test(text.toLowerCase())) return 'Line Questions';
    return 'Practice Questions';
  }

  function normalizeOrganizationLabel(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function extractQuestionPromptText(question: Record<string, unknown>): string {
    const promptBlocks = Array.isArray(question.promptBlocks) ? question.promptBlocks as Array<Record<string, unknown>> : [];
    return promptBlocks
      .map((block) => (typeof block?.text === 'string' ? block.text : (typeof block?.latex === 'string' ? block.latex : '')))
      .join('\n')
      .trim() || (typeof question.question === 'string' ? question.question : '');
  }

  function buildImportedQuestionSignature(question: Record<string, unknown>): string {
    const promptText = normalizeOrganizationLabel(extractQuestionPromptText(question));
    const interaction = question.interaction as { type?: string; final?: { type?: string } } | null | undefined;
    const interactionType = typeof interaction?.type === 'string'
      ? (interaction.type === 'composite' ? `composite:${interaction.final?.type ?? 'unknown'}` : interaction.type)
      : 'unknown';
    return `${interactionType}::${promptText}`;
  }

  function classifyImportedQuestionType(
    interaction: ProgramAtomicInteractionSpec | ({ type: 'composite'; final: ProgramAtomicInteractionSpec; steps: ProgramStepSpec[]; allowDirectFinalAnswer?: boolean; scoreStrategy?: 'final_only' | 'final_plus_steps' }) | null,
    questionText: string,
  ): string {
    const lower = questionText.toLowerCase();
    if (interaction?.type === 'composite') {
      if (interaction.steps.some((step) => step.interaction.type === 'points_on_line')) return 'Find Equation and Other Points';
      return 'Multi-Step Questions';
    }
    if (interaction?.type === 'point_list') return 'Generate Points from Equation';
    if (interaction?.type === 'points_on_line') return 'Find Other Points on the Line';
    if (interaction?.type === 'line_equation') return 'Find Equation from Two Points';
    if (/find\s+3\s+other\s+points|other\s+points\s+.*line/.test(lower)) return 'Find Equation and Other Points';
    if (/list\s+10\s+points|generate\s+10\s+points|points\s+that\s+(?:lie|satisfy)/.test(lower)) return 'Generate Points from Equation';
    if (/equation of the line|passing through the points|passes through/.test(lower)) return 'Find Equation from Two Points';
    return chooseImportedQuestionTypeTitle(questionText);
  }

  function collectBuilderQuestions(node: BuilderNode): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const qt of node.questionTypes) {
      try {
        const parsed = JSON.parse(qt.jsonText);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              out.push(item as Record<string, unknown>);
            }
          }
        }
      } catch {
        // ignore malformed builder question JSON during auto-organization
      }
    }
    for (const child of node.children) {
      out.push(...collectBuilderQuestions(child));
    }
    return out;
  }

  function collectExistingOrganizationTitles(chapters: BuilderNode[]): {
    chapterTitlesByKey: Map<string, string>;
    questionTypeTitlesByKey: Map<string, string>;
  } {
    const chapterTitlesByKey = new Map<string, string>();
    const questionTypeTitlesByKey = new Map<string, string>();
    for (const chapter of chapters) {
      const chapterKey = normalizeOrganizationLabel(chapter.title);
      if (chapterKey && !chapterTitlesByKey.has(chapterKey)) {
        chapterTitlesByKey.set(chapterKey, chapter.title);
      }
      for (const qt of chapter.questionTypes) {
        const qtKey = normalizeOrganizationLabel(qt.title);
        if (qtKey && !questionTypeTitlesByKey.has(qtKey)) {
          questionTypeTitlesByKey.set(qtKey, qt.title);
        }
      }
    }
    return { chapterTitlesByKey, questionTypeTitlesByKey };
  }

  function rebuildImportedOrganization(
    prev: BuilderSpec,
    importedQuestions: Array<Record<string, unknown>>,
    fallbackChapterTitle: string,
    fallbackProgramTitle: string,
  ): { builder: BuilderSpec; selectedPathIds: string[]; selectedQuestionTypeId: string | null } {
    const spec = ensureFixedFirstDivisionContainer({ ...prev, divisions: ['Chapters'] });
    const fixedIdx = spec.root.children.findIndex((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID);
    const fixed = fixedIdx >= 0 ? spec.root.children[fixedIdx]! : { id: FIXED_FIRST_DIVISION_NODE_ID, title: 'Chapters', children: [], questionTypes: [] };
    const { chapterTitlesByKey, questionTypeTitlesByKey } = collectExistingOrganizationTitles(fixed.children);
    const existingQuestions = fixed.children.flatMap((chapter) => collectBuilderQuestions(chapter));
    const dedupedQuestions: Array<Record<string, unknown>> = [];
    const seenQuestionSignatures = new Set<string>();
    for (const question of [...existingQuestions, ...importedQuestions]) {
      const signature = buildImportedQuestionSignature(question);
      if (!signature || seenQuestionSignatures.has(signature)) continue;
      seenQuestionSignatures.add(signature);
      dedupedQuestions.push(question);
    }
    const chapterMap = new Map<string, { title: string; questionTypes: Map<string, Array<Record<string, unknown>>> }>();

    for (const question of dedupedQuestions) {
      const promptText = extractQuestionPromptText(question);
      const classifiedChapterTitle = summarizeImportedTopic(promptText) || fallbackChapterTitle || 'Worksheet Practice';
      const classifiedChapterKey = normalizeOrganizationLabel(classifiedChapterTitle);
      const chapterTitle = chapterTitlesByKey.get(classifiedChapterKey) ?? classifiedChapterTitle;
      const chapterKey = normalizeOrganizationLabel(chapterTitle);
      const interaction = (question.interaction ?? null) as ProgramAtomicInteractionSpec | ({ type: 'composite'; final: ProgramAtomicInteractionSpec; steps: ProgramStepSpec[]; allowDirectFinalAnswer?: boolean; scoreStrategy?: 'final_only' | 'final_plus_steps' }) | null;
      const classifiedQuestionTypeTitle = classifyImportedQuestionType(interaction, promptText);
      const questionTypeTitle = questionTypeTitlesByKey.get(normalizeOrganizationLabel(classifiedQuestionTypeTitle)) ?? classifiedQuestionTypeTitle;
      const questionTypeKey = normalizeOrganizationLabel(questionTypeTitle);
      const existingChapter = chapterMap.get(chapterKey) ?? { title: chapterTitle, questionTypes: new Map<string, Array<Record<string, unknown>>>() };
      const existingQuestionsForType = existingChapter.questionTypes.get(questionTypeKey) ?? [];
      existingQuestionsForType.push(question);
      existingChapter.questionTypes.set(questionTypeKey, existingQuestionsForType);
      chapterMap.set(chapterKey, existingChapter);
    }

    const rebuiltChapters: BuilderNode[] = Array.from(chapterMap.values())
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((chapter) => ({
        id: makeStableId('node'),
        title: cleanGeneratedTitle(chapter.title || fallbackChapterTitle || 'Imported Chapter'),
        children: [],
        questionTypes: Array.from(chapter.questionTypes.values())
          .sort((a, b) => {
            const aTitle = classifyImportedQuestionType((a[0]?.interaction ?? null) as any, typeof a[0]?.question === 'string' ? a[0]!.question as string : '');
            const bTitle = classifyImportedQuestionType((b[0]?.interaction ?? null) as any, typeof b[0]?.question === 'string' ? b[0]!.question as string : '');
            return aTitle.localeCompare(bTitle);
          })
          .map((questionsForType) => ({
            id: makeStableId('qt'),
            title: classifyImportedQuestionType((questionsForType[0]?.interaction ?? null) as any, typeof questionsForType[0]?.question === 'string' ? questionsForType[0]!.question as string : ''),
            jsonText: JSON.stringify(questionsForType, null, 2),
          })),
      }));

    const nextChildren = [...spec.root.children];
    const updatedFixed = { ...fixed, title: 'Chapters', children: rebuiltChapters };
    if (fixedIdx >= 0) {
      nextChildren[fixedIdx] = updatedFixed;
    } else {
      nextChildren.unshift(updatedFixed);
    }

    const selectedChapter = rebuiltChapters.find((chapter) => {
      const key = normalizeOrganizationLabel(chapter.title);
      return key === normalizeOrganizationLabel(fallbackChapterTitle);
    }) ?? rebuiltChapters[0] ?? null;
    const selectedQuestionType = selectedChapter?.questionTypes[0] ?? null;

    return {
      builder: ensureFixedFirstDivisionContainer({
        ...spec,
        divisions: ['Chapters'],
        programTitle: cleanGeneratedTitle(spec.programTitle || fallbackProgramTitle || selectedChapter?.title || 'Imported Worksheet'),
        root: {
          ...spec.root,
          title: spec.root.title === 'Enter program title' ? cleanGeneratedTitle(fallbackProgramTitle || selectedChapter?.title || 'Imported Worksheet') : spec.root.title,
          children: nextChildren,
        },
      }),
      selectedPathIds: ['root', selectedChapter?.id ?? 'root'],
      selectedQuestionTypeId: selectedQuestionType?.id ?? null,
    };
  }

  function isPlaceholderExtractionText(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.length === 0 || /no extractable text found/i.test(trimmed);
  }

  async function handleDigitalize() {
    if (!userData || (userData.role !== 'superadmin' && userData.role !== 'admin')) {
      setDigitalizeError('Only admins and superadmins can digitalize PDFs.');
      return;
    }
    const trimmedPastedText = digitalizePastedText.trim();
    const filesToProcess = digitalizeFiles.length > 0
      ? digitalizeFiles
      : (trimmedPastedText
          ? [new File([
              trimmedPastedText,
            ], `${makeIdFromTitle(builder.programTitle || 'worksheet') || 'worksheet'}.txt`, { type: 'text/plain' })]
          : []);
    if (filesToProcess.length === 0) {
      setDigitalizeError('Add at least one PDF file or paste worksheet text first.');
      return;
    }
    const adminUserId = user?.id;
    if (!adminUserId) {
      setDigitalizeError('Authenticated user id is missing. Please sign in again.');
      return;
    }

    setDigitalizeBusy(true);
    setDigitalizeError('');
    setDigitalizeStatus('Starting digitalization...');

    try {
      const allQuestions: Array<{
        id: string;
        rawText: string;
        page: number;
        kind: string;
        prompt: ProgramPromptBlock[];
        interaction: ProgramAtomicInteractionSpec | ({ type: 'composite'; final: ProgramAtomicInteractionSpec; steps: ProgramStepSpec[]; allowDirectFinalAnswer?: boolean; scoreStrategy?: 'final_only' | 'final_plus_steps' }) | null;
        difficulty: 'easy' | 'medium' | 'hard';
        hint: string[];
        solution: string | null;
        explanationScenes: ProgramExplanationScene[];
        stepSolutions: ProgramStepSpec[];
      }> = [];
      let titleGuess = '';
      let structuredHierarchy: Array<{ id: string; type: string; title: string; children: Array<{ id: string; type: string; title: string; children: unknown[]; questionRefs?: string[]; questionTypeTitle?: string }>; questionRefs?: string[]; questionTypeTitle?: string }> = [];

      for (let fi = 0; fi < filesToProcess.length; fi++) {
        const file = filesToProcess[fi]!;
        setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] Creating job for ${file.name}...`);

        const created = await createProgramIngestionJob({
          adminUserId,
          visibility: 'public',
          sourceFileName: file.name,
          title: builder.programTitle.trim() || undefined,
        });

        setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] Uploading ${file.name}...`);
        await uploadProgramIngestionSource(created.jobId, file);

        const stages = [
          { stage: 'extractDocument' as const, label: 'Extracting text...' },
          { stage: 'auditExtraction' as const, label: 'Auditing extraction...' },
          { stage: 'segmentQuestions' as const, label: 'Segmenting questions...' },
          { stage: 'normalizeQuestions' as const, label: 'Normalizing with AI...' },
          { stage: 'structureDraft' as const, label: 'Structuring draft with AI...' },
        ];

        for (const step of stages) {
          setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] ${step.label}`);
          await runProgramIngestionStage(created.jobId, step.stage);
        }

        setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] Fetching results...`);
        const state = await getProgramIngestionJob(created.jobId);

        const extractedPages = ((state.draft as { extractedDocument?: { pages?: Array<{ fullText?: string | null }> } }).extractedDocument?.pages ?? []);
        const hasReadableExtraction = extractedPages.some((page: { fullText?: string | null }) => !isPlaceholderExtractionText(page.fullText ?? ''));
        if (!hasReadableExtraction) {
          throw new Error(
            `Could not extract readable text from ${file.name}. The PDF appears to be scanned/image-based and OCR did not return usable text. Try a text-based PDF, or we can next improve the OCR prompt/provider.`,
          );
        }

        if (!titleGuess && state.draft.extractionReport?.titleGuess) {
          titleGuess = cleanGeneratedTitle(state.draft.extractionReport.titleGuess, file.name);
        }

        if (Array.isArray(state.draft.hierarchy) && state.draft.hierarchy.length > 0) {
          structuredHierarchy = state.draft.hierarchy;
        }

        for (const q of state.questions) {
          const nq = q.normalizedQuestion as Record<string, unknown> | null;
          const prompt = toPromptBlocks(nq?.prompt, q.rawExtractedBlock.rawText);
          const promptText = prompt.map((b) => ('text' in b ? b.text : 'latex' in b ? b.latex : '')).join(' ').trim() || q.rawExtractedBlock.rawText;
          if (isPlaceholderExtractionText(promptText)) {
            continue;
          }
          const answerData = asRecord(nq?.answerData);
          const finalInteraction = deterministicAnswerToInteraction(answerData?.final);
          const stepSolutions = getNormalizedSolutionSteps(answerData?.steps);
          const explanationScenes = getNormalizedExplanationScenes(answerData?.explanationScenes);
          const scoreStrategy: 'final_only' | 'final_plus_steps' = (asRecord(nq?.grading)?.mode === 'step_based' || stepSolutions.length > 0)
            ? 'final_plus_steps'
            : 'final_only';
          const fallbackGrading: 'ai' | 'manual' = asRecord(nq?.grading)?.mode === 'ai_rubric' ? 'ai' : 'manual';
          const interaction = finalInteraction
            ? (stepSolutions.length > 0
              ? {
                  type: 'composite' as const,
                  final: finalInteraction,
                  steps: stepSolutions,
                  allowDirectFinalAnswer: answerData?.allowDirectFinalAnswer !== false,
                  scoreStrategy,
                }
              : finalInteraction)
            : { type: 'freeform' as const, grading: fallbackGrading, placeholder: 'Type your answer', rubricSummary: typeof nq?.explanation === 'string' ? nq.explanation : null, acceptSteps: true };
          const difficulty = nq?.difficulty === 'easy' || nq?.difficulty === 'hard' ? nq.difficulty : 'medium';
          allQuestions.push({
            id: q.id,
            rawText: q.rawExtractedBlock.rawText,
            page: q.rawExtractedBlock.page,
            kind: (nq?.kind ?? 'open_response_ai') as string,
            prompt,
            interaction,
            difficulty,
            hint: getStringArray(nq?.hints),
            solution: typeof answerData?.solution === 'string'
              ? answerData.solution
              : (typeof nq?.explanation === 'string' ? nq.explanation : null),
            explanationScenes,
            stepSolutions,
          });
        }
      }

      if (allQuestions.length === 0) {
        throw new Error('No usable questions were extracted from the selected PDF(s). The OCR/extraction output was empty or placeholder-only.');
      }

      setDigitalizeStatus('Populating builder...');

      const groupedById: Record<string, Record<string, unknown>> = {};
      const allQuestionText = allQuestions
        .map((q) => q.prompt.map((b) => ('text' in b ? b.text : 'latex' in b ? b.latex : '')).join('\n').trim() || q.rawText)
        .join('\n\n');
      const inferredTopicTitle = summarizeImportedTopic(allQuestionText);
      const cleanedTitleGuess = cleanGeneratedTitle(titleGuess);
      const finalTitleGuess = cleanedTitleGuess !== 'Imported Worksheet'
        ? cleanedTitleGuess
        : cleanGeneratedTitle(inferredTopicTitle || 'Imported Worksheet');

      for (const q of allQuestions) {
        const questionText = q.prompt.map((b) => ('text' in b ? b.text : 'latex' in b ? b.latex : '')).join('\n').trim() || q.rawText;
        groupedById[q.id] = {
          id: q.id,
          question: questionText,
          promptBlocks: q.prompt,
          interaction: q.interaction,
          difficulty: q.difficulty,
          hint: q.hint,
          solution: q.solution,
          stepSolutions: q.stepSolutions,
        };
      }

      const importedQuestionDocs = Object.keys(groupedById).map((id) => groupedById[id]).filter(Boolean);
      const reorganized = rebuildImportedOrganization(builder, importedQuestionDocs, inferredTopicTitle || finalTitleGuess, finalTitleGuess);
      setBuilder(reorganized.builder);
      setBuilderPathIds(reorganized.selectedPathIds);
      setBuilderSelectedQuestionTypeId(reorganized.selectedQuestionTypeId);
      setDigitalizeStatus(`✅ Imported ${allQuestions.length} question(s) from ${filesToProcess.length} source(s)`);
    } catch (error) {
      setDigitalizeError(error instanceof Error ? error.message : String(error));
    } finally {
      setDigitalizeBusy(false);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [next, dnext] = await Promise.all([
        listProgramsAdmin('published'),
        listProgramsAdmin('draft'),
      ]);
      setItems(next as typeof items);
      setDraftItems(dnext as typeof draftItems);
    } catch (error) {
      console.error('Failed to load programs:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load programs.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetDraft() {
    setEditingId(null);
    setEditingDraftId(null);
    setView('list');
    setDraftId('');
    setDraftTitle('');
    setDraftSubject('mathematics');
    setDraftGradeBand('');
    setDraftEmoji('📘');
    setDraftTocJson('');
    setDraftQuestionBankJson('');
    setDraftAnnotationsJson('');
    setDraftProgramMetaJson('');
    setDraftNestedJson('');
    setNestedGenStatus('');

    setBuilder(newBuilderSpec());
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);

    setDigitalizeFiles([]);
    setDigitalizeStatus('');
    setDigitalizeError('');
    setDigitalizePastedText('');
  }

  function startNewBuilder() {
    const b = newBuilderSpec();
    setEditingId(null);
    setEditingDraftId(null);
    setView('builder');
    setBuilder(b);
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);
  }

  async function startEditBuilder(p: (typeof items)[number]) {
    setEditingId(p.id);
    setEditingDraftId(null);
    try {
      const data = await getPublishedProgramAdmin(p.id);
      if (!data) {
        window.alert('Published program not found');
        return;
      }
      const spec = data.builderSpec as BuilderSpec | undefined;
      const next = spec && typeof spec === 'object' && (spec as BuilderSpec).version === '1.0'
        ? spec
        : (() => {
            const b = newBuilderSpec();
            b.programId = p.id;
            b.programTitle = (data.title as string) ?? p.id;
            b.subject = (data.subject as string) ?? 'mathematics';
            b.gradeBand = (data.grade_band as string) ?? '';
            b.coverEmoji = (data.coverEmoji as string) ?? '📘';
            b.root.title = (data.title as string) ?? p.id;
            return b;
          })();
      setBuilder(ensureFixedFirstDivisionContainer(next));
      setBuilderPathIds(['root']);
      setBuilderSelectedQuestionTypeId(null);
      setView('builder');
    } catch (e) {
      window.alert(formatBuilderError(e));
    }
  }

  async function startEditDraftBuilder(d: (typeof draftItems)[number]) {
    setEditingId(null);
    setEditingDraftId(d.id);
    try {
      const data = await getDraftProgramAdmin(d.id);
      if (!data) {
        window.alert('Draft not found');
        return;
      }
      const spec = data?.builderSpec as BuilderSpec | undefined;
      const next = spec && typeof spec === 'object' && spec.version === '1.0'
        ? spec
        : (() => {
            const b = newBuilderSpec();
            b.programId = d.id;
            b.programTitle = (data?.title as string) ?? d.id;
            b.subject = (data?.subject as string) ?? 'mathematics';
            b.gradeBand = (data?.grade_band as string) ?? '';
            b.coverEmoji = (data?.coverEmoji as string) ?? '📘';
            b.root.title = (data?.title as string) ?? d.id;
            return b;
          })();
      setBuilder(ensureFixedFirstDivisionContainer(next));
      setBuilderPathIds(['root']);
      setBuilderSelectedQuestionTypeId(null);
      setView('builder');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  function setBuilderAtNode(nodeId: string, fn: (n: BuilderNode) => BuilderNode) {
    setBuilder((prev) => {
      function mapNode(n: BuilderNode): BuilderNode {
        if (n.id === nodeId) return fn(n);
        return { ...n, children: n.children.map(mapNode) };
      }
      return ensureFixedFirstDivisionContainer({ ...prev, root: mapNode(prev.root) });
    });
  }

  function findNodeByPath(b: BuilderSpec, pathIds: string[]): BuilderNode | null {
    const normalized = ensureFixedFirstDivisionContainer(b);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;

    let cur: BuilderNode = normalized.root;
    for (const id of pathIds.slice(1)) {
      const pool = cur.id === 'root' && fixed ? fixed.children : cur.children;
      const next = pool.find((c) => c.id === id);
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  function pathNodes(b: BuilderSpec, pathIds: string[]): BuilderNode[] {
    const normalized = ensureFixedFirstDivisionContainer(b);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;

    const nodes: BuilderNode[] = [];
    let cur: BuilderNode = normalized.root;
    nodes.push(cur);

    for (const id of pathIds.slice(1)) {
      const pool = cur.id === 'root' && fixed ? fixed.children : cur.children;
      const next = pool.find((c) => c.id === id);
      if (!next) break;
      nodes.push(next);
      cur = next;
    }
    return nodes;
  }

  function computeProgramIdAndTitle(): { id: string; title: string } {
    const title = builder.programTitle.trim() || builder.root.title.trim();
    const idBase = builder.programId.trim() || makeIdFromTitle(title) || 'program';
    const id = String(editingId || editingDraftId || idBase).trim() || idBase;
    return { id, title: title || id };
  }

  function assertBuilderHasContent(spec: BuilderSpec): void {
    const normalized = ensureFixedFirstDivisionContainer(spec);
    const fixedContainer = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
    const topFolders = fixedContainer ? fixedContainer.children : normalized.root.children;
    const hasAnyQuestions = topFolders.some((chapter) => {
      const stack: BuilderNode[] = [chapter];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.questionTypes.some((qt) => qt.jsonText.trim().length > 0)) return true;
        stack.push(...node.children);
      }
      return false;
    });

    if (!hasAnyQuestions) {
      throw new Error('This program has no question content yet. Add at least one chapter/question type with questions before saving or publishing.');
    }
  }

  function formatBuilderError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (error && typeof error === 'object') {
      const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
      const parts: string[] = [];
      if (typeof e.message === 'string' && e.message.trim()) parts.push(e.message.trim());
      if (typeof e.details === 'string' && e.details.trim()) parts.push(e.details.trim());
      if (typeof e.hint === 'string' && e.hint.trim()) parts.push(`Hint: ${e.hint.trim()}`);
      if (typeof e.code === 'string' && e.code.trim()) parts.push(`(${e.code.trim()})`);
      if (parts.length > 0) return parts.join('\n');
    }
    return String(error);
  }

  function getQuestionPromptLabel(question: any): string {
    if (typeof question?.question === 'string' && question.question.trim()) return question.question.trim().slice(0, 80);
    if (Array.isArray(question?.promptBlocks)) {
      const textBlock = question.promptBlocks.find((block: any) => block && typeof block.text === 'string' && block.text.trim());
      if (textBlock) return String(textBlock.text).trim().slice(0, 80);
    }
    return '—';
  }

  async function handleQuestionImageUpload(nodeId: string, questionTypeId: string, questionTypeJsonText: string, questionIndex: number, questionId: string, file: File): Promise<void> {
    if (!userData || userData.role !== 'superadmin') throw new Error('Only super admins can upload images.');
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('Unsupported file type. Please upload PNG, JPG/JPEG, WEBP, or GIF.');
    if (typeof file.size === 'number' && file.size > MAX_IMAGE_BYTES) throw new Error('Image is too large. Max size is 5MB.');

    setUploadingImage(true);
    setUploadedImageErr('');
    try {
      const raw = questionTypeJsonText.trim() ? JSON.parse(questionTypeJsonText) : [];
      if (!Array.isArray(raw)) throw new Error('Question Type JSON must be a JSON array');

      const programId = (builder.programId || makeIdFromTitle(builder.programTitle) || 'program').trim() || 'program';
      const uploaded = await uploadProgramQuestionAsset(file, programId);
      const url = uploaded.url;

      const next = [...raw];
      const question = next[questionIndex] && typeof next[questionIndex] === 'object' ? { ...(next[questionIndex] as any) } : { id: questionId };
      const promptBlocks = Array.isArray((question as any).promptBlocks) ? ([...(question as any).promptBlocks] as any[]) : [];
      promptBlocks.push({ type: 'image', url, alt: 'diagram' });
      (question as any).promptBlocks = promptBlocks;
      next[questionIndex] = question;

      const nextText = JSON.stringify(next, null, 2);
      setBuilderAtNode(nodeId, (n) => ({
        ...n,
        questionTypes: n.questionTypes.map((x) => x.id === questionTypeId ? { ...x, jsonText: nextText } : x),
      }));
    } catch (err) {
      setUploadedImageErr(formatBuilderError(err));
      throw err;
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleQuestionImageDelete(nodeId: string, questionTypeId: string, questionTypeJsonText: string, questionIndex: number, imageIndex: number): Promise<void> {
    if (!userData || userData.role !== 'superadmin') {
      setUploadedImageErr('Only super admins can delete images.');
      return;
    }

    setUploadingImage(true);
    setUploadedImageErr('');
    try {
      const raw = questionTypeJsonText.trim() ? JSON.parse(questionTypeJsonText) : [];
      if (!Array.isArray(raw)) throw new Error('Question Type JSON must be a JSON array');

      const next = [...raw];
      const question = next[questionIndex] && typeof next[questionIndex] === 'object' ? { ...(next[questionIndex] as any) } : null;
      if (!question) throw new Error('Question not found.');

      const promptBlocks = Array.isArray((question as any).promptBlocks) ? ([...(question as any).promptBlocks] as any[]) : [];
      const imageBlocks = promptBlocks
        .map((block, idx) => ({ block, idx }))
        .filter(({ block }) => block && block.type === 'image' && typeof block.url === 'string' && block.url.trim());

      const target = imageBlocks[imageIndex];
      if (!target) throw new Error('Image not found.');

      await deleteProgramQuestionAsset(String(target.block.url));
      promptBlocks.splice(target.idx, 1);
      (question as any).promptBlocks = promptBlocks;
      next[questionIndex] = question;

      const nextText = JSON.stringify(next, null, 2);
      setBuilderAtNode(nodeId, (n) => ({
        ...n,
        questionTypes: n.questionTypes.map((x) => x.id === questionTypeId ? { ...x, jsonText: nextText } : x),
      }));
    } catch (err) {
      setUploadedImageErr(formatBuilderError(err));
    } finally {
      setUploadingImage(false);
    }
  }

  function handleImportAiJson() {
    setAiImportError('');
    setAiImportStatus('');
    try {
      const imported = parseAIProgramImport(aiImportJson);
      setBuilder(imported);
      setBuilderPathIds(['root']);
      setBuilderSelectedQuestionTypeId(null);
      setAiImportStatus('✅ AI JSON imported into the builder. Preview and save/publish when ready.');
    } catch (error) {
      setAiImportError(formatBuilderError(error));
    }
  }

  function handleValidateNotebookJson() {
    setNotebookValidation(validateNotebookExerciseImport(notebookImportJson));
  }

  function handleAddNotebookExerciseToBuilder() {
    const validation = notebookValidation ?? validateNotebookExerciseImport(notebookImportJson);
    setNotebookValidation(validation);
    if (!validation.payload || !validation.summary) return;
    if (validation.errorCount > 0) {
      window.alert('Fix validation errors before adding this exercise to the builder.');
      return;
    }
    const convertedQuestions = convertNotebookExerciseToBuilderQuestions(validation.payload);
    const title = validation.summary.sourceExercise || 'NotebookLM Exercise';
    const jsonText = JSON.stringify(convertedQuestions, null, 2);
    let selectedQuestionTypeId: string | null = null;
    let targetPathIds: string[] = ['root'];
    setBuilder((prev) => {
      const base = ensureFixedFirstDivisionContainer({
        ...prev,
        divisions: prev.divisions.length >= 2 ? prev.divisions : ['Chapters', 'Topics'],
      });
      const fixed = base.root.children.find((child) => child.id === FIXED_FIRST_DIVISION_NODE_ID);
      if (!fixed) return base;

      const chapterTitle = validation.payload?.chapterTitle || validation.payload?.chapterId || 'Imported Chapter';
      const exerciseTitle = validation.payload?.sourceExercise || 'Imported Exercise';
      let chapterNode = fixed.children.find((child) => child.title === chapterTitle);
      if (!chapterNode) {
        chapterNode = { id: makeStableId('node'), title: chapterTitle, children: [], questionTypes: [] };
        fixed.children = [...fixed.children, chapterNode];
      }

      let targetNode = chapterNode;
      if (base.divisions.length >= 2) {
        let exerciseNode = chapterNode.children.find((child) => child.title === exerciseTitle);
        if (!exerciseNode) {
          exerciseNode = { id: makeStableId('node'), title: exerciseTitle, children: [], questionTypes: [] };
          chapterNode.children = [...chapterNode.children, exerciseNode];
        }
        targetNode = exerciseNode;
        targetPathIds = ['root', chapterNode.id, exerciseNode.id];
      } else {
        targetPathIds = ['root', chapterNode.id];
      }

      const existing = targetNode.questionTypes.find((qt) => qt.title === title);
      const questionTypeId = existing?.id ?? makeStableId('qt');
      selectedQuestionTypeId = questionTypeId;
      targetNode.questionTypes = existing
        ? targetNode.questionTypes.map((qt) => (qt.id === existing.id ? { ...qt, jsonText } : qt))
        : [...targetNode.questionTypes, { id: questionTypeId, title, jsonText }];

      return ensureFixedFirstDivisionContainer(base);
    });
    setBuilderPathIds(targetPathIds);
    setBuilderSelectedQuestionTypeId(selectedQuestionTypeId);
    window.alert(`Added ${convertedQuestions.length} builder questions from ${title}. Folders were created automatically when needed.`);
  }

  async function saveBuilderDraft() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) {
      window.alert('Missing program id');
      return;
    }
    setSaving(true);
    try {
      assertBuilderHasContent({ ...builder, programId, programTitle: title });
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title,
        subject: builder.subject ?? 'mathematics',
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: { ...builder, programId, programTitle: title },
        updatedAt: new Date().toISOString(),
      });
      const gb = (builder.gradeBand ?? '').trim();
      if (gb) payload.grade_band = gb;

      await saveDraftProgramAdmin(programId, payload);
      setEditingDraftId(programId);
      await load();
      window.alert('Draft saved');
    } catch (e) {
      window.alert(formatBuilderError(e));
    } finally {
      setSaving(false);
    }
  }

  async function publishBuilder() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) {
      window.alert('Missing program id');
      return;
    }

    setSaving(true);
    try {
      assertBuilderHasContent({ ...builder, programId, programTitle: title });
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title,
        subject: builder.subject ?? 'mathematics',
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: { ...builder, programId, programTitle: title },
        updatedAt: new Date().toISOString(),
      });
      const gb = (builder.gradeBand ?? '').trim();
      if (gb) payload.grade_band = gb;

      await publishProgramAdmin(programId, payload, editingDraftId);
      if (editingDraftId) setEditingDraftId(null);
      await load();
      setView('list');
      setEditingId(programId);
      window.alert('Published');
    } catch (e) {
      window.alert(formatBuilderError(e));
    } finally {
      setSaving(false);
    }
  }

  function previewBuilder() {
    try {
      const { id: programId, title } = computeProgramIdAndTitle();
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });

      const key = `${Date.now()}`;
      setDraftProgram(key, {
        id: programId,
        title,
        subject: builder.subject ?? 'mathematics',
        grade_band: (builder.gradeBand ?? '').trim() || undefined,
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        questionBanksByChapter: internal.questionBanksByChapter,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
      });

      const pid = `ll-draft:${key}`;
      setPreviewProgramId(pid);
      setPreviewReturnView('builder');
      setView('preview');
    } catch (e) {
      window.alert(formatBuilderError(e));
    }
  }

  async function previewSavedDraft(programId: string) {
    setPreviewProgramId(`ll-draftdb:${programId}`);
    setPreviewReturnView('list');
    setView('preview');
  }

  async function removeDraft(programId: string) {
    if (!window.confirm('Delete this draft?')) return;
    await deleteDraftProgramAdmin(programId);
    await load();
    if (editingDraftId === programId) resetDraft();
  }

  function generateFromNested() {
    const nested = parseNestedProgramJson(draftNestedJson);
    const converted = convertNestedProgramToInternal(nested);
    setDraftId(nested.program_id);
    setDraftTitle(nested.book_name);
    setDraftTocJson(JSON.stringify(converted.toc, null, 2));
    const firstChapterId = Object.keys(converted.questionBanksByChapter)[0] ?? null;
    if (firstChapterId) {
      setDraftQuestionBankJson(JSON.stringify(converted.questionBanksByChapter[firstChapterId], null, 2));
    }
    setDraftAnnotationsJson(JSON.stringify(converted.annotations, null, 2));
    setDraftProgramMetaJson(JSON.stringify(converted.programMeta, null, 2));
  }

  async function save() {
    const id = draftId.trim();
    if (!id) return;
    setSaving(true);
    try {
      let toc: unknown = undefined;
      if (draftTocJson.trim()) {
        toc = JSON.parse(draftTocJson);
      }

      let questionBank: unknown = undefined;
      if (draftQuestionBankJson.trim()) {
        questionBank = JSON.parse(draftQuestionBankJson);
      }

      let annotations: unknown = undefined;
      if (draftAnnotationsJson.trim()) {
        annotations = JSON.parse(draftAnnotationsJson);
      }

      let programMeta: unknown = undefined;
      if (draftProgramMetaJson.trim()) {
        programMeta = JSON.parse(draftProgramMetaJson);
      }

      const payload: Record<string, unknown> = {
        title: draftTitle.trim() || id,
        subject: draftSubject.trim() || 'mathematics',
        coverEmoji: draftEmoji.trim() || '📘',
        toc,
        questionBank,
        annotations,
        programMeta,
        updatedAt: new Date().toISOString(),
      };

      const gb = draftGradeBand.trim();
      if (gb) payload.grade_band = gb;

      if (draftNestedJson.trim()) {
        const nested = parseNestedProgramJson(draftNestedJson);
        const converted = convertNestedProgramToInternal(nested);
        payload.questionBanksByChapter = converted.questionBanksByChapter;

        let total = 0;
        for (const ch of Object.values(converted.questionBanksByChapter)) {
          const nodes = Array.isArray((ch as any)?.nodes) ? ((ch as any).nodes as any[]) : [];
          for (const n of nodes) {
            const qs = Array.isArray(n?.questions) ? (n.questions as any[]) : [];
            total += qs.length;
          }
        }
        payload.rankedTotalQuestionCount = total;
      }

      await savePublishedProgramAdmin(id, payload);

      await load();
      resetDraft();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('are you sure you want to delete this?')) return;
    await softDeletePublishedProgramAdmin(id);
    await load();
    if (editingId === id) resetDraft();
  }

  async function previewProgram(programId: string) {
    try {
      const data = await getPublishedProgramAdmin(programId);
      const spec = data?.builderSpec as BuilderSpec | undefined;
      if (spec && spec.version === '1.0') {
        const normalized = ensureFixedFirstDivisionContainer(spec);
        const title = normalized.programTitle || normalized.root.title || data?.title || programId;
        const internal = convertBuilderToInternal({ ...normalized, programId, programTitle: title });
        const key = `published-preview:${programId}`;
        setDraftProgram(key, {
          id: programId,
          title,
          subject: normalized.subject ?? data?.subject ?? 'mathematics',
          grade_band: normalized.gradeBand ?? data?.grade_band,
          coverEmoji: normalized.coverEmoji ?? data?.coverEmoji ?? '📘',
          toc: internal.toc,
          questionBanksByChapter: internal.questionBanksByChapter,
          annotations: internal.annotations,
          programMeta: internal.programMeta,
          rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        });
        setPreviewProgramId(`ll-draft:${key}`);
      } else {
        setPreviewProgramId(programId);
      }
      setPreviewReturnView('list');
      setView('preview');
    } catch (e) {
      window.alert(formatBuilderError(e));
    }
  }

  if (loading) return <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>Loading programs...</div>;

  if (loadError) {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #7f1d1d', padding: 16, color: '#fecaca' }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Failed to load programs</div>
          <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{loadError}</div>
          <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {view === 'preview' ? (
        <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderBottom: '1px solid #1f2a44', background: '#1e293b' }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>👁️ Preview</div>
            <button
              className="ll-btn"
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={() => {
                if (previewProgramId && previewProgramId.startsWith('ll-draft:')) {
                  const key = previewProgramId.slice('ll-draft:'.length);
                  clearDraftProgram(key);
                }
                setView(previewReturnView);
              }}
            >
              ← {previewReturnView === 'builder' ? 'Back to Builder' : 'Back'}
            </button>
          </div>
          <div style={{ height: 'calc(100vh - 260px)', minHeight: 560 }}>
            {previewProgramId ? (
              <ProgramMapView onBack={() => setView(previewReturnView)} programId={previewProgramId} />
            ) : (
              <div style={{ padding: 18, color: '#64748b' }}>No preview loaded.</div>
            )}
          </div>
        </div>
      ) : view === 'builder' ? (
        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>🧱 Program Builder</div>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setView('list')}>← Back</button>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={previewBuilder}>
              Preview
            </button>
            <button
              className="ll-btn"
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={saveBuilderDraft}
              disabled={saving}
              title="Save draft (not published)"
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              className="ll-btn ll-btn-primary"
              style={{ padding: '7px 12px', fontSize: 12, background: '#10b981', borderColor: '#059669', color: 'white' }}
              onClick={publishBuilder}
              disabled={saving}
            >
              {saving ? 'Publishing...' : 'Publish'}
            </button>
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>🤖 Paste AI JSON Import</label>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Paste output from your external AI using the fixed `ai_program_import_v1` template. This replaces the current builder content with validated chapters, question types, and questions.
            </div>
            <textarea
              value={aiImportJson}
              onChange={(e) => setAiImportJson(e.target.value)}
              placeholder="Paste AI JSON here..."
              style={{
                width: '100%',
                minHeight: 180,
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0b1220',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 8,
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handleImportAiJson}
                className="ll-btn ll-btn-primary"
                disabled={aiImportJson.trim().length === 0}
                style={{ padding: '7px 14px', fontSize: 12, background: '#2563eb', borderColor: '#1d4ed8', color: 'white' }}
              >
                Import AI JSON
              </button>
              <button
                onClick={() => {
                  setAiImportJson('');
                  setAiImportStatus('');
                  setAiImportError('');
                }}
                className="ll-btn"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                Clear
              </button>
            </div>
            {aiImportStatus && <div style={{ color: '#93c5fd', fontSize: 11, marginTop: 8 }}>{aiImportStatus}</div>}
            {aiImportError && <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 8, whiteSpace: 'pre-wrap' }}>{aiImportError}</div>}
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>📚 NotebookLM Exercise Import Sandbox</label>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Paste one complete exercise extraction from NotebookLM. This validates schema, formats, answers, manual-review flags, and source-asset warnings before we convert it into program content.
            </div>
            <textarea
              value={notebookImportJson}
              onChange={(e) => setNotebookImportJson(e.target.value)}
              placeholder="Paste NotebookLM exercise JSON here..."
              style={{
                width: '100%',
                minHeight: 180,
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0b1220',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 8,
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <button
                onClick={handleValidateNotebookJson}
                className="ll-btn ll-btn-primary"
                disabled={notebookImportJson.trim().length === 0}
                style={{ padding: '7px 14px', fontSize: 12, background: '#0d9488', borderColor: '#0f766e', color: 'white' }}
              >
                Validate NotebookLM JSON
              </button>
              <button
                onClick={handleAddNotebookExerciseToBuilder}
                className="ll-btn ll-btn-primary"
                disabled={!notebookValidation?.payload || notebookValidation.errorCount > 0}
                style={{ padding: '7px 14px', fontSize: 12, background: '#16a34a', borderColor: '#15803d', color: 'white' }}
                title="Adds this exercise as a question type file inside the currently selected final folder."
              >
                Add to Builder
              </button>
              <button
                onClick={() => {
                  setNotebookImportJson('');
                  setNotebookValidation(null);
                }}
                className="ll-btn"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                Clear
              </button>
            </div>
            {notebookValidation?.summary ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
                {[
                  ['Exercise', notebookValidation.summary.sourceExercise || 'Unknown'],
                  ['Questions', String(notebookValidation.summary.questionCount)],
                  ['Parts', String(notebookValidation.summary.partCount)],
                  ['Manual review', String(notebookValidation.summary.manualReviewCount)],
                  ['Source assets', String(notebookValidation.summary.sourceAssetCount)],
                  ['Errors / warnings', `${notebookValidation.errorCount} / ${notebookValidation.warningCount}`],
                ].map(([label, value]) => (
                  <div key={label} style={{ border: '1px solid #1f2a44', borderRadius: 10, background: '#0b1220', padding: 10 }}>
                    <div style={{ color: '#64748b', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.7 }}>{label}</div>
                    <div style={{ color: 'white', fontSize: 14, fontWeight: 900, marginTop: 3 }}>{value}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {notebookValidation?.summary ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {Object.entries(notebookValidation.summary.formatCounts).map(([format, count]) => (
                  <span key={format} style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(20,184,166,0.14)', color: '#5eead4', fontSize: 11, fontWeight: 900 }}>{format}: {count}</span>
                ))}
              </div>
            ) : null}
            {notebookValidation?.issues.length ? (
              <div style={{ border: '1px solid #1f2a44', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
                {notebookValidation.issues.slice(0, 12).map((issue, index) => (
                  <div key={`${issue.path}:${index}`} style={{ padding: '7px 9px', borderBottom: index === Math.min(notebookValidation.issues.length, 12) - 1 ? 'none' : '1px solid #1f2a44', background: issue.severity === 'error' ? 'rgba(127,29,29,0.25)' : issue.severity === 'warning' ? 'rgba(146,64,14,0.20)' : 'rgba(30,64,175,0.16)' }}>
                    <div style={{ color: issue.severity === 'error' ? '#fca5a5' : issue.severity === 'warning' ? '#fdba74' : '#93c5fd', fontSize: 11, fontWeight: 900 }}>{issue.severity.toUpperCase()} · {issue.path}</div>
                    <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>{issue.message}</div>
                  </div>
                ))}
              </div>
            ) : notebookValidation ? (
              <div style={{ color: '#86efac', fontSize: 12, fontWeight: 900, marginBottom: 10 }}>✅ No validation issues found.</div>
            ) : null}
            {notebookValidation?.payload ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {notebookValidation.payload.questions.slice(0, 6).map((question) => (
                  <div key={question.questionId} style={{ border: '1px solid #1f2a44', borderRadius: 10, background: '#0b1220', padding: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ color: 'white', fontSize: 12, fontWeight: 900 }}>{question.questionId}</span>
                      <span style={{ color: '#5eead4', fontSize: 11, fontWeight: 900 }}>{question.questionFormat}</span>
                      <span style={{ color: '#c4b5fd', fontSize: 11, fontWeight: 900 }}>{question.difficulty}</span>
                      {question.needsManualReview ? <span style={{ color: '#fdba74', fontSize: 11, fontWeight: 900 }}>manual review</span> : null}
                      {question.requiresDiagram ? <span style={{ color: '#fca5a5', fontSize: 11, fontWeight: 900 }}>source asset</span> : null}
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.4 }}>{question.questionText}</div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 5 }}>{question.parts.length} part{question.parts.length === 1 ? '' : 's'} · first answer: {question.parts[0]?.answer || '—'}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* ── AI DIGITALIZE SECTION ── */}
          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>📄 Upload PDFs to Digitalize</label>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Upload worksheet PDF(s), or paste worksheet text below, then click Digitalize to auto-populate the builder.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <input
                type="file"
                accept=".pdf,.txt"
                multiple
                onChange={(e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  if (chosen.length > 0) {
                    setDigitalizeFiles((prev) => [...prev, ...chosen]);
                  }
                }}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 12 }}
              />
              <button
                onClick={() => void handleDigitalize()}
                className="ll-btn ll-btn-primary"
                disabled={digitalizeBusy || (digitalizeFiles.length === 0 && digitalizePastedText.trim().length === 0)}
                style={{ padding: '7px 14px', fontSize: 12, background: '#8b5cf6', borderColor: '#7c3aed', color: 'white' }}
              >
                {digitalizeBusy ? 'Digitalizing...' : `Digitalize (${digitalizeFiles.length > 0 ? `${digitalizeFiles.length} file${digitalizeFiles.length !== 1 ? 's' : ''}` : digitalizePastedText.trim().length > 0 ? 'pasted text' : '0 sources'})`}
              </button>
            </div>
            <textarea
              value={digitalizePastedText}
              onChange={(e) => setDigitalizePastedText(e.target.value)}
              placeholder="Or paste worksheet content here to bypass OCR entirely. Example: 1. Find the equation of the line..."
              style={{
                width: '100%',
                minHeight: 160,
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0b1220',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 8,
                fontFamily: 'inherit',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Tip: if OCR fails, paste the sheet text here and Digitalize will send it through the AI structuring pipeline as plain text.
            </div>
            {digitalizeFiles.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {digitalizeFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
                    <span style={{ color: '#c4b5fd', fontSize: 11 }}>{f.name}</span>
                    <button
                      onClick={() => setDigitalizeFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
                      title="Remove file"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {digitalizeStatus && <div style={{ color: '#93c5fd', fontSize: 11 }}>{digitalizeStatus}</div>}
            {digitalizeError && <div style={{ color: '#fca5a5', fontSize: 11 }}>{digitalizeError}</div>}
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>Division Path (ends with Question Types)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {builder.divisions.map((d, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    value={d}
                    onChange={(e) => {
                      const v = e.target.value as BuilderDivisionLabel;
                      setBuilder((p) => {
                        const next = [...p.divisions];
                        next[idx] = v;
                        return ensureFixedFirstDivisionContainer({ ...p, divisions: next });
                      });
                    }}
                    style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #334155', background: '#0b1220', color: 'white', outline: 'none', fontSize: 12, fontWeight: 900 }}
                  >
                    {BUILDER_DIVISION_LABELS.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                  <button
                    className="ll-btn"
                    style={{ padding: '6px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                    onClick={() => {
                      setBuilder((p) => ensureFixedFirstDivisionContainer({ ...p, divisions: p.divisions.filter((_, i) => i !== idx) }));
                      setBuilderPathIds(['root']);
                      setBuilderSelectedQuestionTypeId(null);
                    }}
                    disabled={builder.divisions.length <= 1}
                    title={builder.divisions.length <= 1 ? 'At least one division is required' : 'Remove division'}
                  >
                    −
                  </button>
                  <div style={{ color: '#64748b', fontSize: 12 }}>→</div>
                </div>
              ))}
              <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 900 }}>Question Types</div>
              <button
                className="ll-btn"
                style={{ padding: '6px 10px', fontSize: 11 }}
                onClick={() => {
                  setBuilder((p) => (p.divisions.length >= 5 ? p : ensureFixedFirstDivisionContainer({ ...p, divisions: [...p.divisions, 'Lessons'] })));
                }}
                disabled={builder.divisions.length >= 5}
                title={builder.divisions.length >= 5 ? 'Max depth is 5' : 'Add a division'}
              >
                +
              </button>
            </div>
          </div>

          {(() => {
            const normalized = ensureFixedFirstDivisionContainer(builder);
            const fixedContainer = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
            const path = pathNodes(normalized, builderPathIds);
            const cur = findNodeByPath(normalized, builderPathIds) ?? normalized.root;
            const depth = builderPathIds.length - 1;
            const isLeaf = depth === normalized.divisions.length;

            function selectAtDivision(divisionIndex: number, nodeId: string) {
              const next = ['root', ...builderPathIds.slice(1, divisionIndex + 1), nodeId];
              setBuilderPathIds(next);
              setBuilderSelectedQuestionTypeId(null);
            }

            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', color: '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>
                    Program Folder
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #334155', background: '#0b1220', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16 }}>
                        {(builder.coverEmoji ?? '📘').slice(0, 2)}
                      </div>
                      <input
                        value={builder.root.title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBuilder((p) => ({ ...p, programTitle: v, root: { ...p.root, title: v } }));
                        }}
                        style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#0b1220', color: 'white', outline: 'none', fontWeight: 900 }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {normalized.divisions.map((divisionLabel, divisionIndex) => {
                        const containerNode = divisionIndex === 0
                          ? fixedContainer
                          : findNodeByPath(normalized, ['root', ...builderPathIds.slice(1, divisionIndex + 1)]);

                        if (!containerNode) return null;

                        const selectedId = builderPathIds[divisionIndex + 1] ?? null;
                        const canAdd = divisionIndex < normalized.divisions.length;
                        const children = containerNode.children;

                        return (
                          <div key={divisionLabel + ':' + divisionIndex} style={{ border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 900, flex: 1 }}>{divisionLabel}</div>
                              {canAdd && (
                                <button
                                  className="ll-btn"
                                  style={{ padding: '5px 9px', fontSize: 11 }}
                                  onClick={() => {
                                    const title = window.prompt(`New ${divisionLabel} name`);
                                    if (!title) return;
                                    const id = makeStableId('node');
                                    setBuilderAtNode(containerNode.id, (n) => ({
                                      ...n,
                                      children: [...n.children, { id, title, children: [], questionTypes: [] }],
                                    }));
                                    selectAtDivision(divisionIndex, id);
                                  }}
                                >
                                  + Folder
                                </button>
                              )}
                            </div>
                            <div style={{ padding: 10 }}>
                              {children.length === 0 ? (
                                <div style={{ color: '#64748b', fontSize: 12 }}>No folders.</div>
                              ) : (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  {children.map((child) => {
                                    const active = selectedId === child.id;
                                    return (
                                      <div
                                        key={child.id}
                                        style={{
                                          padding: '10px 10px',
                                          borderRadius: 12,
                                          border: `${active ? 2 : 1}px solid ${active ? 'rgba(59,130,246,0.85)' : '#334155'}`,
                                          background: active ? 'rgba(59,130,246,0.22)' : '#0b1220',
                                          boxShadow: active ? '0 0 0 3px rgba(59,130,246,0.18)' : undefined,
                                          minWidth: 180,
                                          cursor: 'pointer',
                                        }}
                                        onClick={() => selectAtDivision(divisionIndex, child.id)}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <div style={{ color: 'white', fontWeight: 900, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.title}</div>
                                          {active && (
                                            <div style={{ color: '#93c5fd', fontSize: 11, fontWeight: 900 }}>Selected</div>
                                          )}
                                          <button
                                            className="ll-btn"
                                            style={{ padding: '4px 8px', fontSize: 11 }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const nextTitle = window.prompt('Rename folder', child.title);
                                              if (!nextTitle) return;
                                              setBuilderAtNode(child.id, (n) => ({ ...n, title: nextTitle }));
                                            }}
                                          >
                                            Rename
                                          </button>
                                          <button
                                            className="ll-btn"
                                            style={{ padding: '4px 8px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (!window.confirm('Delete this folder?')) return;
                                              setBuilderAtNode(containerNode.id, (n) => ({ ...n, children: n.children.filter((c) => c.id !== child.id) }));
                                              if (builderPathIds.includes(child.id)) {
                                                setBuilderPathIds(['root', ...builderPathIds.slice(1, divisionIndex + 1)]);
                                                setBuilderSelectedQuestionTypeId(null);
                                              }
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div style={{ border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 900, flex: 1 }}>Question Types</div>
                          {isLeaf && (
                            <button
                              className="ll-btn"
                              style={{ padding: '5px 9px', fontSize: 11 }}
                              onClick={() => {
                                const title = window.prompt('Question Type name (free-form)');
                                if (!title) return;
                                const id = makeStableId('qt');
                                const qt: BuilderQuestionTypeFile = { id, title, jsonText: '[]' };
                                setBuilderAtNode(cur.id, (n) => ({ ...n, questionTypes: [...n.questionTypes, qt] }));
                                setBuilderSelectedQuestionTypeId(id);
                              }}
                            >
                              + Add
                            </button>
                          )}
                        </div>
                        <div style={{ padding: 10 }}>
                          {!isLeaf ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>
                              Open folders until the last division to manage Question Types.
                              <div style={{ marginTop: 6, color: '#cbd5e1' }}>{path.map((x: BuilderNode) => x.title).join(' / ')}</div>
                            </div>
                          ) : cur.questionTypes.length === 0 ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>No question types yet.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {cur.questionTypes.map((qt) => {
                                const active = builderSelectedQuestionTypeId === qt.id;
                                return (
                                  <div
                                    key={qt.id}
                                    style={{
                                      padding: '10px 10px',
                                      borderRadius: 12,
                                      border: `1px solid ${active ? 'rgba(168,85,247,0.65)' : '#334155'}`,
                                      background: active ? 'rgba(168,85,247,0.12)' : '#0b1220',
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => setBuilderSelectedQuestionTypeId(qt.id)}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{ color: 'white', fontWeight: 900, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qt.title}</div>
                                      {active && <div style={{ color: '#d8b4fe', fontSize: 11, fontWeight: 900 }}>Selected</div>}
                                    </div>
                                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <button
                                        className="ll-btn"
                                        style={{ padding: '5px 10px', fontSize: 11 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const nextTitle = window.prompt('Rename question type', qt.title);
                                          if (!nextTitle) return;
                                          setBuilderAtNode(cur.id, (n) => ({
                                            ...n,
                                            questionTypes: n.questionTypes.map((x) => x.id === qt.id ? { ...x, title: nextTitle } : x),
                                          }));
                                        }}
                                      >
                                        Rename
                                      </button>
                                      <button
                                        className="ll-btn"
                                        style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!window.confirm('Delete this question type file?')) return;
                                          setBuilderAtNode(cur.id, (n) => ({
                                            ...n,
                                            questionTypes: n.questionTypes.filter((x) => x.id !== qt.id),
                                          }));
                                          if (builderSelectedQuestionTypeId === qt.id) setBuilderSelectedQuestionTypeId(null);
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {isLeaf && (
                  <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', color: '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>
                      Question Type JSON
                    </div>
                    <div style={{ padding: 12 }}>
                      {(() => {
                        const qt = cur.questionTypes.find((x) => x.id === builderSelectedQuestionTypeId) ?? null;
                        if (!qt) {
                          return <div style={{ color: '#64748b', fontSize: 12 }}>Select a question type above to edit its JSON.</div>;
                        }
                        return (
                          <div>
                            <div style={{ color: 'white', fontWeight: 900, fontSize: 13, marginBottom: 8 }}>{qt.title} JSON</div>
                            <textarea
                              value={qt.jsonText}
                              onChange={(e) => {
                                const v = e.target.value;
                                setBuilderAtNode(cur.id, (n) => ({
                                  ...n,
                                  questionTypes: n.questionTypes.map((x) => x.id === qt.id ? { ...x, jsonText: v } : x),
                                }));
                              }}
                              rows={16}
                              style={{ width: '100%', padding: '10px 10px', borderRadius: 12, border: '1px solid #334155', background: '#0b1220', color: 'white', fontFamily: 'monospace', fontSize: 12, outline: 'none', resize: 'vertical' }}
                            />

                            <div style={{ height: 1, background: '#1f2a44', margin: '14px 0' }} />

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                              <div style={{ color: '#cbd5e1', fontWeight: 900, fontSize: 12 }}>Upload image (Supabase Storage)</div>
                              <div style={{ color: '#64748b', fontSize: 11 }}>
                                Public read
                              </div>
                            </div>

                            {uploadedImageErr && (
                              <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8 }}>{uploadedImageErr}</div>
                            )}

                            {(() => {
                              let parsed: any[] | null = null;
                              try {
                                const raw = qt.jsonText.trim() ? JSON.parse(qt.jsonText) : [];
                                parsed = Array.isArray(raw) ? raw : null;
                              } catch {
                                parsed = null;
                              }

                              if (!parsed) {
                                return (
                                  <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
                                    Fix the Question Type JSON so it is a valid JSON array before managing question images.
                                  </div>
                                );
                              }

                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                                  {parsed.length === 0 ? (
                                    <div style={{ color: '#64748b', fontSize: 12 }}>Add at least one question in the JSON array to attach images to a specific question.</div>
                                  ) : (
                                    parsed.slice(0, 50).map((q: any, idx: number) => {
                                      const qid = typeof q?.id === 'string' ? q.id : `q_${idx + 1}`;
                                      const label = getQuestionPromptLabel(q);
                                      const imageBlocks = Array.isArray(q?.promptBlocks)
                                        ? q.promptBlocks.filter((block: any) => block && block.type === 'image' && typeof block.url === 'string' && block.url.trim())
                                        : [];

                                      return (
                                        <div key={`${qid}_${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', border: '1px solid #1f2a44', borderRadius: 12, background: 'rgba(2,6,23,0.25)' }}>
                                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                              <div style={{ color: 'white', fontWeight: 900, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qid}</div>
                                              <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-word', marginTop: 4 }}>{label}</div>
                                            </div>
                                            <input
                                              type="file"
                                              accept="image/png,image/jpeg,image/webp,image/gif"
                                              disabled={uploadingImage}
                                              onChange={async (e) => {
                                                const f = e.target.files?.[0] ?? null;
                                                if (!f) return;
                                                try {
                                                  await handleQuestionImageUpload(cur.id, qt.id, qt.jsonText, idx, qid, f);
                                                } catch {}
                                                finally {
                                                  e.target.value = '';
                                                }
                                              }}
                                              style={{
                                                width: 220,
                                                padding: '8px 10px',
                                                borderRadius: 12,
                                                border: '1px solid #334155',
                                                background: '#0b1220',
                                                color: 'white',
                                                outline: 'none',
                                                fontSize: 12,
                                              }}
                                            />
                                          </div>

                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                            {imageBlocks.length === 0 ? (
                                              <div style={{ color: '#64748b', fontSize: 12 }}>No uploaded images for this question.</div>
                                            ) : (
                                              imageBlocks.map((block: any, imageIdx: number) => (
                                                <div key={`${qid}_img_${imageIdx}`} style={{ border: '1px solid #1f2a44', borderRadius: 12, padding: 10, background: 'rgba(15,23,42,0.45)' }}>
                                                  <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 8 }}>Image {imageIdx + 1}</div>
                                                  <img
                                                    src={String(block.url)}
                                                    alt={typeof block.alt === 'string' && block.alt.trim() ? block.alt : 'diagram'}
                                                    style={{ display: 'block', maxWidth: '100%', maxHeight: 240, borderRadius: 10, marginBottom: 10, objectFit: 'contain', background: '#020617' }}
                                                  />
                                                  <div style={{ color: '#93c5fd', fontSize: 11, wordBreak: 'break-all', marginBottom: 10 }}>{String(block.url)}</div>
                                                  <button
                                                    type="button"
                                                    className="ll-btn"
                                                    disabled={uploadingImage}
                                                    onClick={() => void handleQuestionImageDelete(cur.id, qt.id, qt.jsonText, idx, imageIdx)}
                                                    style={{ padding: '7px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                                  >
                                                    Delete image
                                                  </button>
                                                </div>
                                              ))
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>📚 Programs ({items.length})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>↺ Refresh</button>
          <button onClick={startNewBuilder} className="ll-btn ll-btn-primary" style={{ padding: '7px 14px', fontSize: 12, background: '#a855f7', borderColor: '#7c3aed', color: 'white' }}>+ New</button>
        </div>
      </div>

      <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>📝 Drafts ({draftItems.length})</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>Only visible to superadmins</div>
        </div>
        <div style={{ padding: 12 }}>
          {draftItems.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12 }}>No drafts yet. Use “Save Draft” inside the builder.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draftItems.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.25)' }}>
                  <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{(d.coverEmoji as string) ?? '📝'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(d.title as string) ?? d.id}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{(d.subject as string) ?? 'subject'}{d.grade_band ? ` • ${d.grade_band}` : ''}</div>
                  </div>
                  <button onClick={() => previewSavedDraft(d.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
                  <button onClick={() => startEditDraftBuilder(d)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
                  <button onClick={() => removeDraft(d.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: 18, color: '#64748b' }}>No public programs yet.</div>
        ) : (
          items.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #0f172a' }}>
              <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{(p.coverEmoji as string) ?? '📘'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(p.title as string) ?? p.id}
                </div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{(p.subject as string) ?? 'subject'}{p.grade_band ? ` • ${p.grade_band}` : ''}</div>
              </div>
              <button onClick={() => previewProgram(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
              <button onClick={() => startEditBuilder(p)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
              <button onClick={() => remove(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
            </div>
          ))
        )}
      </div>
      </>
      )}
    </div>
  );
}
