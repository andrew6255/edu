import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { type ClassSession, type SessionSheet } from '@/lib/classroomService';
import { useSheetPolling } from '@/lib/sheetPollingService';
import PaperPageCanvas from '@/components/PaperPageCanvas';
import { type Stroke, type StrokePoint } from '@/components/FullScreenWorkspace';

interface ClassroomWorkspaceProps {
  sheet: SessionSheet;
  session: ClassSession;
  onClose: () => void;
}

const PAGE_W = 794;
const PAGE_H = 1123;
const ERASER_RADIUS = 14;

export default function ClassroomWorkspace({ sheet, session, onClose }: ClassroomWorkspaceProps) {
  const { userData } = useAuth();
  
  const layerId = userData!.uid; // In this MVP, the layer ID is just the user's ID
  const isTeacher = userData!.role === 'teacher';

  const {
    remoteLayers,
    access,
    canWrite,
    saveStrokes,
    loading
  } = useSheetPolling({
    sheetId: sheet.id,
    layerId,
    userId: userData!.uid,
    enabled: true
  });

  const [localStrokes, setLocalStrokes] = useState<Stroke[]>([]);
  
  // We maintain a ref for strokes to avoid dependency cycles in callbacks
  const localStrokesRef = useRef<Stroke[]>([]);
  useEffect(() => { localStrokesRef.current = localStrokes; }, [localStrokes]);

  // When remote layers come in, we find our own layer to initialize if local is empty
  // Wait, useSheetPolling excludes our own layer. So we don't get our initial data from it!
  // Ah, let's load our initial data directly here, or modify useSheetPolling to give it to us.
  useEffect(() => {
    // Initial fetch of our own layer
    import('@/lib/classroomService').then(({ getSheetStrokes }) => {
      getSheetStrokes(sheet.id).then(allLayers => {
        const myLayer = allLayers.find(l => l.layerId === layerId);
        if (myLayer && Array.isArray(myLayer.data)) {
          setLocalStrokes(myLayer.data as Stroke[]);
        }
      });
    });
  }, [sheet.id, layerId]);

  // Combine remote strokes and local strokes
  const allStrokes = useMemo(() => {
    // For student personal sheets, we shouldn't see anyone else
    // For group sheets, we see everyone
    // For individual sheets, teachers see all, students see only their own
    
    let allowedRemotes = remoteLayers;
    if (sheet.type === 'personal') {
      allowedRemotes = [];
    } else if (sheet.type === 'individual' && !isTeacher) {
      allowedRemotes = [];
    }
    
    const remote = allowedRemotes.flatMap(l => {
      const strokes = Array.isArray(l.data) ? l.data as Stroke[] : [];
      // To differentiate users visually, we could apply opacity or slightly shift colors,
      // but for now we just render them. We'll add a semi-transparent effect for other students' strokes.
      return strokes.map(s => ({
        ...s,
        // Make other students' strokes slightly transparent for the teacher/others to distinguish
        color: (isTeacher || sheet.type === 'group') ? s.color : s.color + 'aa' 
      }));
    });
    
    return [...remote, ...localStrokes];
  }, [remoteLayers, localStrokes, sheet.type, isTeacher]);

  const handleStrokeDraw = useCallback((points: StrokePoint[], color: string, width: number, isEraser?: boolean) => {
    if (!canWrite) return;
    
    if (isEraser) {
      const newStrokes = localStrokesRef.current.filter(stroke => {
        return !stroke.points.some(p => points.some(ep => (p.x - ep.x) ** 2 + (p.y - ep.y) ** 2 < ERASER_RADIUS ** 2));
      });
      if (newStrokes.length !== localStrokesRef.current.length) {
        setLocalStrokes(newStrokes);
        saveStrokes(newStrokes);
      }
    } else {
      const newStroke: Stroke = {
        id: `s-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        points,
        color,
        width,
      };
      const next = [...localStrokesRef.current, newStroke];
      setLocalStrokes(next);
      saveStrokes(next);
    }
  }, [canWrite, saveStrokes]);

  const [color, setColor] = useState('#1e293b');
  const [eraser, setEraser] = useState(false);

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#94a3b8' }}>
        Loading Sheet...
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#cbd5e1' }}>
      {/* Header Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
            ← Close
          </button>
          <div style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{sheet.name}</div>
          <div style={{ color: '#64748b', fontSize: 12, textTransform: 'capitalize' }}>{sheet.type} Sheet</div>
          {!canWrite && <div style={{ background: '#ef444422', border: '1px solid #ef444455', color: '#ef4444', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 'bold' }}>READ ONLY</div>}
        </div>

        {canWrite && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#0f172a', padding: 4, borderRadius: 8 }}>
            {['#1e293b', '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed'].map(c => (
              <button
                key={c}
                onClick={() => { setColor(c); setEraser(false); }}
                style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c && !eraser ? '2px solid white' : '2px solid transparent', cursor: 'pointer', outline: 'none' }}
              />
            ))}
            <div style={{ width: 1, height: 24, background: '#334155', margin: '0 4px' }} />
            <button
              onClick={() => setEraser(!eraser)}
              style={{ background: eraser ? '#334155' : 'transparent', color: eraser ? 'white' : '#94a3b8', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}
            >
              Eraser
            </button>
          </div>
        )}
      </div>

      {/* Canvas Area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ width: PAGE_W, height: PAGE_H, background: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', position: 'relative' }}>
          <PaperPageCanvas
            width={PAGE_W}
            height={PAGE_H}
            strokes={allStrokes}
            currentColor={color}
            currentWidth={3}
            isEraser={eraser}
            disabled={!canWrite}
            onStrokeDraw={handleStrokeDraw}
          />
        </div>
      </div>
    </div>
  );
}
