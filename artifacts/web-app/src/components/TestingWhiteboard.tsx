import { useState, useEffect, useRef } from 'react';

// Enhanced TestingWhiteboard component with all features we built
export default function TestingWhiteboard() {
  const [activeTool, setActiveTool] = useState<'write' | 'erase' | 'line' | 'circle' | 'rectangle' | 'arrow'>('write');
  const editorInstanceRef = useRef<any>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [sdkLoaded, setSdkLoaded] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [initStatus, setInitStatus] = useState<string | null>(null);
  const [recognized, setRecognized] = useState<string>('');
  const [exportFormat, setExportFormat] = useState<'text' | 'latex'>('text');
  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  function computeDiagnostics(extra?: string) {
    try {
      const jsTag = document.querySelector('script[data-myscript-js]') ? 'js:yes' : 'js:no';
      const cssTag = document.querySelector('link[data-myscript-css]') ? 'css:yes' : 'css:no';
      const host = editorHostRef.current;
      const rect = host ? host.getBoundingClientRect() : { width: 0, height: 0 } as DOMRect;
      const ns = ((import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink').trim();
      const g = (window as any)[ns];
      const api = g ? Object.keys(g).slice(0, 6).join(',') : 'none';
      const msg = `assets[${jsTag},${cssTag}] size=${Math.round(rect.width)}x${Math.round(rect.height)} ns=${ns} api=${api}${extra ? ' ' + extra : ''}`;
    } catch {}
  }

  // Auto-load SDK and initialize editor
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMyScriptAssets();
        if (cancelled) return;
        setSdkLoaded(true);
        let tries = 0;
        while (!cancelled && !editorHostRef.current && tries < 20) {
          tries += 1; await new Promise(r => setTimeout(r, 50));
        }
        if (!cancelled && editorHostRef.current) {
          try {
            await createEditorNow();
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
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [historyIndex, history]);

  async function loadMyScriptAssets() {
    const jsUrl = import.meta.env.VITE_MYSCRIPT_JS_URL as string | undefined;
    const cssUrl = import.meta.env.VITE_MYSCRIPT_CSS_URL as string | undefined;
    const isHttp = (u?: string) => !!u && /^https?:\/\//i.test(u);
    if (!isHttp(jsUrl) || !isHttp(cssUrl)) {
      throw new Error('Official MyScript SDK URLs required. Set VITE_MYSCRIPT_JS_URL and VITE_MYSCRIPT_CSS_URL to https URLs from MyScript.');
    }
    // CSS: replace mismatched
    const existingCss = document.querySelector('link[data-myscript-css]') as HTMLLinkElement | null;
    if (existingCss && existingCss.href !== cssUrl) {
      existingCss.parentElement?.removeChild(existingCss);
    }
    if (!document.querySelector(`link[data-myscript-css]`)) {
      await new Promise<void>((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl!;
        link.setAttribute('data-myscript-css', 'true');
        link.onload = () => resolve();
        link.onerror = () => reject(new Error('Failed to load MyScript CSS'));
        document.head.appendChild(link);
      });
    }
    // JS: replace mismatched
    const existingJs = document.querySelector('script[data-myscript-js]') as HTMLScriptElement | null;
    if (existingJs && existingJs.src !== jsUrl) {
      existingJs.parentElement?.removeChild(existingJs);
    }
    if (!document.querySelector(`script[data-myscript-js]`)) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = jsUrl!;
        script.setAttribute('data-myscript-js', 'true');
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load MyScript JS'));
        document.head.appendChild(script);
      });
    }
  }

  async function createEditorNow() {
    const host = editorHostRef.current;
    const ns = ((import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink').trim();
    const appKey = import.meta.env.VITE_MYSCRIPT_APP_KEY as string | undefined;
    const hmacKey = import.meta.env.VITE_MYSCRIPT_HMAC_KEY as string | undefined;
    const contentType = (import.meta.env.VITE_MYSCRIPT_CONTENT_TYPE as string | undefined) || 'TEXT';
    const serverScheme = (import.meta.env.VITE_MYSCRIPT_SERVER_SCHEME as string | undefined) || undefined;
    const serverHost = (import.meta.env.VITE_MYSCRIPT_SERVER_HOST as string | undefined) || undefined;
    
    if (!host) throw new Error('Missing editor host');
    if (window && (window as any).isSecureContext === false) {
      throw new Error('MyScript requires a secure context (HTTPS)');
    }
    
    try {
      const originalAdd = host.classList.add;
      const originalRemove = host.classList.remove;
      host.classList.add = (...tokens: any[]) => {
        const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
        if (valid.length) originalAdd(...valid);
      };
      host.classList.remove = (...tokens: any[]) => {
        const valid = tokens.filter(t => typeof t === 'string' && !t.includes(' ') && t !== '[object Object]');
        if (valid.length) originalRemove(...valid);
      };
    } catch {}
    
    const w: any = window as any; const api = w[ns];
    if (!api || typeof api.Editor !== 'function') throw new Error('window.' + ns + '.Editor not found');
    
    const serverCfg = (serverScheme && serverHost)
      ? { scheme: serverScheme, host: serverHost, applicationKey: appKey, hmacKey }
      : { scheme: 'https', host: 'cloud.myscript.com', applicationKey: appKey, hmacKey };

    const options: any = {
      recognitionParams: {
        type: contentType,
        protocol: 'WEBSOCKET',
        server: serverCfg,
        text: { smartGuide: { enable: false } },
        math: { smartGuide: { enable: false } },
      },
      configuration: {
        server: serverCfg,
        applicationKey: appKey,
        hmacKey: hmacKey,
      },
    };
    
    // Create editor using whichever API is available (Factory, function, or constructor)
    let ed: any = null;
    if (api && api.EditorFactory && typeof api.EditorFactory.createEditor === 'function') {
      ed = await api.EditorFactory.createEditor(host, 'TEXT', options);
    } else if (api && typeof api.createEditor === 'function') {
      ed = await api.createEditor(host, options);
    } else if (api && typeof api.Editor === 'function') {
      ed = new api.Editor(host, options);
      try {
        if (typeof ed.init === 'function') {
          const r = ed.init(host, options); if (r && typeof r.then === 'function') await r;
        } else if (typeof ed.mount === 'function') {
          const r = ed.mount(host, options); if (r && typeof r.then === 'function') await r;
        } else if (typeof ed.start === 'function') {
          const r = ed.start(options); if (r && typeof r.then === 'function') await r;
        }
      } catch {}
    }
    if (!ed) throw new Error('No compatible MyScript editor API found on window.' + ns);
    editorInstanceRef.current = ed;
    computeDiagnostics('auto-mounted');
    
    try { setInitStatus('Ready'); } catch {}
    try { host.style.touchAction = 'none'; host.style.cursor = 'crosshair'; host.focus(); } catch {}
    
    try {
      const ns = ((import.meta.env.VITE_MYSCRIPT_GLOBAL as string | undefined) || 'iink').trim();
      const apiNS: any = (window as any)[ns];
      const writeTool = apiNS?.EditorTool?.Write || apiNS?.EditorWriteTool || 'write';
      if (typeof (ed as any).setTool === 'function') (ed as any).setTool(writeTool);
      else if (typeof (ed as any).setMode === 'function') (ed as any).setMode('write');
    } catch {}
    
    setActiveTool('write');
    
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

  // Canvas fallback handlers
  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
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
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 540 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', position: 'relative', zIndex: 10, pointerEvents: 'auto' }}>
        {/* Undo/Redo */}
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
        
        {/* Drawing Tools */}
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
                
        <div style={{ width: 1, height: 20, background: '#334155', margin: '0 4px' }} />
        
        {/* Shape Tools */}
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
        
        <button
          className="ll-btn"
          type="button"
          onClick={() => {
            if (editorInstanceRef.current && typeof editorInstanceRef.current.clear === 'function') {
              editorInstanceRef.current.clear();
            }
            setRecognized('');
          }}
          title="Clear Canvas"
        >🗑️ Clear</button>
        
        {initStatus && !sdkError && <span style={{ color: '#a3e635', fontSize: 12 }}>{initStatus}</span>}
        {sdkError && <span style={{ color: '#f87171', fontSize: 12 }}>{sdkError}</span>}
        <span style={{ color: '#94a3b8', fontSize: 12 }}>Editor: {editorInstanceRef.current ? '✓' : '✗'}</span>
      </div>
      
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', minHeight: 520 }}>
        <div ref={containerRef} style={{ flex: 1, minHeight: 520, border: '1px solid #334155', borderRadius: 14, overflow: 'hidden', background: '#ffffff', position: 'relative' }}>
          {!editorInstanceRef.current && (
            <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              style={{ position: 'absolute', inset: 0, display: 'block', touchAction: 'none', cursor: 'crosshair', zIndex: 1 }} />
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
              style={{ position: 'absolute', inset: 0, minHeight: 520, background: '#ffffff', pointerEvents: sdkLoaded ? 'auto' : 'none', opacity: sdkLoaded ? 1 : 0, zIndex: 10, cursor: 'crosshair', touchAction: 'none' }}
            >
              <div data-placeholder style={{ padding: 12, color: '#0f172a', fontSize: 13, userSelect: 'none' }}>
                Start writing here...
              </div>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 520, border: '1px solid #334155', borderRadius: 14, overflow: 'auto', background: '#ffffff' }}>
          <div style={{ padding: 12, color: '#0f172a' }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>Converted Text</div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 16, lineHeight: 1.5 }}>
              {recognized || '— Start writing on the left. Text will appear here automatically.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
