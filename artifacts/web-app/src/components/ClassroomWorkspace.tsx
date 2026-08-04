import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  type ClassSession,
  type SessionSheet,
  type TeacherClass,
  type ClassMember,
  type SheetStrokeData,
  getTeacherClassById,
  getClassMembers,
  getSheetStrokes,
  toggleStudentAccess,
  toggleMasterAccess,
  setSectionHeight,
  getParticipantColor,
  getTeacherColor,
  TEACHER_LAYER_ID,
  annotationLayerId,
} from '@/lib/classroomService';
import { useSheetPolling } from '@/lib/sheetPollingService';
import ClassroomCanvas from '@/components/classroom/ClassroomCanvas';
import { type Stroke } from '@/components/FullScreenWorkspace';

interface ClassroomWorkspaceProps {
  sheet: SessionSheet;
  session: ClassSession;
  onClose: () => void;
}

const PAGE_W = 794;
const PAGE_H = 1123;
const SECTION_MIN_H = 400;
const SECTION_GROW = 200;
const TOOLBAR_COLORS = ['#1e293b', '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed'];

// ─── Editable layer hook ────────────────────────────────────────────────────────
// Wraps useSheetPolling with a local, undoable strokes buffer for whichever layer
// the current user is actively writing to.

function useEditableLayer(sheetId: string, layerId: string, myUserId: string) {
  const { remoteLayers, access, canWrite, saveStrokes, forceSave, loading: pollLoading } = useSheetPolling({
    sheetId, layerId, userId: myUserId, enabled: !!sheetId,
  });

  const [localStrokes, setLocalStrokes] = useState<Stroke[]>([]);
  const [layerLoading, setLayerLoading] = useState(true);
  const localStrokesRef = useRef<Stroke[]>([]);
  useEffect(() => { localStrokesRef.current = localStrokes; }, [localStrokes]);

  useEffect(() => {
    let alive = true;
    setLayerLoading(true);
    getSheetStrokes(sheetId, layerId).then(rows => {
      if (!alive) return;
      const mine = rows.find(r => r.layerId === layerId);
      setLocalStrokes((mine?.strokes as Stroke[]) || []);
      setLayerLoading(false);
    });
    return () => { alive = false; };
  }, [sheetId, layerId]);

  const undoStack = useRef<Array<{ type: 'add' | 'remove'; stroke: Stroke }>>([]);
  const redoStack = useRef<Array<{ type: 'add' | 'remove'; stroke: Stroke }>>([]);

  const addStroke = useCallback((stroke: Stroke) => {
    setLocalStrokes(prev => {
      const next = [...prev, stroke];
      saveStrokes(next);
      return next;
    });
    undoStack.current.push({ type: 'add', stroke });
    redoStack.current = [];
  }, [saveStrokes]);

  const removeStroke = useCallback((strokeId: string) => {
    setLocalStrokes(prev => {
      const removed = prev.find(s => s.id === strokeId);
      const next = prev.filter(s => s.id !== strokeId);
      saveStrokes(next);
      if (removed) {
        undoStack.current.push({ type: 'remove', stroke: removed });
        redoStack.current = [];
      }
      return next;
    });
  }, [saveStrokes]);

  const undo = useCallback(() => {
    const action = undoStack.current.pop();
    if (!action) return;
    setLocalStrokes(prev => {
      const next = action.type === 'add'
        ? prev.filter(s => s.id !== action.stroke.id)
        : [...prev, action.stroke];
      saveStrokes(next);
      return next;
    });
    redoStack.current.push(action);
  }, [saveStrokes]);

  const redo = useCallback(() => {
    const action = redoStack.current.pop();
    if (!action) return;
    setLocalStrokes(prev => {
      const next = action.type === 'add'
        ? [...prev, action.stroke]
        : prev.filter(s => s.id !== action.stroke.id);
      saveStrokes(next);
      return next;
    });
    undoStack.current.push(action);
  }, [saveStrokes]);

  // Flush pending debounced save whenever we switch away from this layer / unmount.
  useEffect(() => {
    return () => { forceSave(localStrokesRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId, layerId]);

  return {
    remoteLayers, access, canWrite, localStrokes, addStroke, removeStroke, undo, redo,
    loading: pollLoading || layerLoading,
  };
}

type EditableLayer = ReturnType<typeof useEditableLayer>;

function layerStrokes(all: SheetStrokeData[], layerId: string): Stroke[] {
  const found = all.find(l => l.layerId === layerId);
  return (found?.strokes as Stroke[]) || [];
}

// ─── Small shared UI bits ───────────────────────────────────────────────────────

function LoadingShell() {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#94a3b8' }}>
      Loading…
    </div>
  );
}

function LockedShell({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#94a3b8' }}>
      <div style={{ fontSize: 32 }}>🔒</div>
      <div>{message}</div>
      <button onClick={onClose} style={{ background: '#1e293b', border: '1px solid #334155', color: 'white', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}>
        Back
      </button>
    </div>
  );
}

// ─── Participants sidebar (teacher-only) ────────────────────────────────────────

function ParticipantsSidebar({
  sheetType, teacherName, participants, nameFor, access, onToggleMaster, onToggleStudent,
  teacherTarget, onSelectTarget, onClose,
}: {
  sheetType: 'group' | 'individual';
  teacherName: string;
  participants: string[];
  nameFor: (id: string) => string;
  access: { masterAccess: boolean; studentAccess: Record<string, boolean> };
  onToggleMaster: (v: boolean) => void;
  onToggleStudent: (id: string, v: boolean) => void;
  teacherTarget: string | null;
  onSelectTarget?: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div style={{ width: 280, flexShrink: 0, background: '#1e293b', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column', color: 'white' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #334155' }}>
        <div style={{ fontWeight: 'bold' }}>Participants</div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}>✕</button>
      </div>

      <div
        onClick={() => onSelectTarget?.(null)}
        style={{ padding: '10px 16px', fontWeight: 'bold', borderBottom: '1px solid #334155', cursor: onSelectTarget ? 'pointer' : 'default', background: teacherTarget === null && onSelectTarget ? '#334155' : 'transparent' }}
      >
        👤 {teacherName} (You)
      </div>

      <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155' }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>Allow all to write</span>
        <input type="checkbox" checked={access.masterAccess} onChange={e => onToggleMaster(e.target.checked)} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {participants.map(pid => (
          <div key={pid} style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #33415555' }}>
            <span
              onClick={() => onSelectTarget?.(pid)}
              style={{ cursor: onSelectTarget ? 'pointer' : 'default', fontWeight: teacherTarget === pid ? 'bold' : 'normal', color: teacherTarget === pid ? '#60a5fa' : 'white' }}
            >
              {nameFor(pid)}
            </span>
            <input
              type="checkbox"
              disabled={!access.masterAccess}
              checked={access.studentAccess[pid] === true}
              onChange={e => onToggleStudent(pid, e.target.checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Header toolbar ──────────────────────────────────────────────────────────────

function Header({
  sheet, canWriteNow, color, setColor, tool, setTool, onUndo, onRedo, showParticipantsBtn,
  onToggleParticipants, readOnlyReason, onClose,
}: {
  sheet: SessionSheet;
  canWriteNow: boolean;
  color: string;
  setColor: (c: string) => void;
  tool: 'pen' | 'eraser';
  setTool: (t: 'pen' | 'eraser') => void;
  onUndo: () => void;
  onRedo: () => void;
  showParticipantsBtn: boolean;
  onToggleParticipants: () => void;
  readOnlyReason: string | null;
  onClose: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold' }}>
          ← Close
        </button>
        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{sheet.name}</div>
        <div style={{ color: '#64748b', fontSize: 12, textTransform: 'capitalize' }}>{sheet.type} Sheet</div>
        {!canWriteNow && (
          <div style={{ background: '#ef444422', border: '1px solid #ef444455', color: '#ef4444', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 'bold' }}>
            {readOnlyReason || 'READ ONLY'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {canWriteNow && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#0f172a', padding: 4, borderRadius: 8 }}>
            {TOOLBAR_COLORS.map(c => (
              <button
                key={c}
                onClick={() => { setColor(c); setTool('pen'); }}
                style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c && tool === 'pen' ? '2px solid white' : '2px solid transparent', cursor: 'pointer', outline: 'none' }}
              />
            ))}
            <div style={{ width: 1, height: 24, background: '#334155', margin: '0 4px' }} />
            <button
              onClick={() => setTool(tool === 'eraser' ? 'pen' : 'eraser')}
              style={{ background: tool === 'eraser' ? '#334155' : 'transparent', color: tool === 'eraser' ? 'white' : '#94a3b8', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}
            >
              Eraser
            </button>
            <div style={{ width: 1, height: 24, background: '#334155', margin: '0 4px' }} />
            <button onClick={onUndo} title="Undo" style={{ background: 'transparent', color: '#94a3b8', border: 'none', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 15 }}>↶</button>
            <button onClick={onRedo} title="Redo" style={{ background: 'transparent', color: '#94a3b8', border: 'none', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 15 }}>↷</button>
          </div>
        )}
        {showParticipantsBtn && (
          <button onClick={onToggleParticipants} style={{ background: '#334155', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>
            👥 Participants
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function ClassroomWorkspace({ sheet, session, onClose }: ClassroomWorkspaceProps) {
  const { user, userData } = useAuth();
  const myId = user!.uid;
  const isTeacher = userData!.role === 'teacher';

  const [classInfo, setClassInfo] = useState<TeacherClass | null>(null);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getTeacherClassById(sheet.classId), getClassMembers(sheet.classId)]).then(([cls, mem]) => {
      if (!alive) return;
      setClassInfo(cls);
      setMembers(mem);
      setMetaLoading(false);
    });
    return () => { alive = false; };
  }, [sheet.classId]);

  const nameFor = useCallback((userId: string): string => {
    if (classInfo && userId === classInfo.teacherId) return classInfo.teacherName || 'Teacher';
    const m = members.find(mm => mm.userId === userId);
    return m?.fullName || m?.username || 'Student';
  }, [classInfo, members]);

  // Deterministic "random" order — stable across every viewer without persisting anything.
  const participantOrder = useMemo(() => {
    function hash(s: string): number {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
      return Math.abs(h);
    }
    return [...session.participantIds].sort((a, b) => hash(sheet.id + a) - hash(sheet.id + b));
  }, [session.participantIds, sheet.id]);

  const [color, setColor] = useState('#1e293b');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const strokeWidth = 3;

  const [showParticipants, setShowParticipants] = useState(false);
  // Individual sheets: which student's composed page the teacher is currently viewing (null = teacher's own page).
  const [teacherTarget, setTeacherTarget] = useState<string | null>(null);
  const [teacherWriteMode, setTeacherWriteMode] = useState<'broadcast' | 'annotate'>('broadcast');
  // Group sheets: which student's section the teacher is currently annotating (null = teacher's own top section).
  const [activeSectionOwner, setActiveSectionOwner] = useState<string | null>(null);

  const sessionEnded = session.status === 'ended';
  const sessionScheduled = session.status === 'scheduled';
  const sessionLocksWriting = sessionEnded && sheet.type !== 'personal';

  const handleSelectTarget = useCallback((id: string | null) => {
    if (sheet.type === 'group') {
      setActiveSectionOwner(id);
    } else {
      setTeacherTarget(id);
      setTeacherWriteMode('broadcast');
    }
  }, [sheet.type]);

  const activeLayerId = useMemo(() => {
    if (sheet.type === 'personal') return myId;
    if (sheet.type === 'group') {
      return isTeacher ? (activeSectionOwner ? annotationLayerId(activeSectionOwner) : TEACHER_LAYER_ID) : myId;
    }
    // individual
    if (isTeacher) {
      return teacherTarget && teacherWriteMode === 'annotate' ? annotationLayerId(teacherTarget) : TEACHER_LAYER_ID;
    }
    return myId;
  }, [sheet.type, isTeacher, myId, activeSectionOwner, teacherTarget, teacherWriteMode]);

  const layer = useEditableLayer(sheet.id, activeLayerId, myId);

  const getLayerStrokes = useCallback((layerId: string): Stroke[] => {
    if (layerId === activeLayerId) return layer.localStrokes;
    return layerStrokes(layer.remoteLayers, layerId);
  }, [activeLayerId, layer.localStrokes, layer.remoteLayers]);

  if (metaLoading) return <LoadingShell />;
  if (sessionScheduled) return <LockedShell message="This session hasn't started yet." onClose={onClose} />;
  if (layer.loading) return <LoadingShell />;

  const teacherName = classInfo?.teacherName || 'Teacher';

  // ── Effective write permission for the toolbar / active canvas ──
  let canWriteNow: boolean;
  if (sheet.type === 'personal') {
    canWriteNow = true;
  } else if (isTeacher) {
    canWriteNow = !sessionLocksWriting;
  } else {
    canWriteNow = !sessionLocksWriting && layer.canWrite;
  }

  const readOnlyReason = sessionLocksWriting
    ? 'SESSION ENDED'
    : (!isTeacher && sheet.type !== 'personal' && !layer.canWrite ? 'NO WRITE ACCESS' : null);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      <Header
        sheet={sheet}
        canWriteNow={canWriteNow}
        color={color}
        setColor={setColor}
        tool={tool}
        setTool={setTool}
        onUndo={layer.undo}
        onRedo={layer.redo}
        showParticipantsBtn={isTeacher && sheet.type !== 'personal'}
        onToggleParticipants={() => setShowParticipants(v => !v)}
        readOnlyReason={readOnlyReason}
        onClose={onClose}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: sheet.type === 'group' ? '24px 0' : 24 }}>
          {sheet.type === 'personal' && (
            <div style={{ width: PAGE_W, height: PAGE_H, background: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
              <ClassroomCanvas
                pageWidth={PAGE_W}
                pageHeight={PAGE_H}
                strokes={layer.localStrokes}
                onStrokeAdd={layer.addStroke}
                onStrokeRemove={layer.removeStroke}
                color={color}
                strokeWidth={strokeWidth}
                tool={tool}
                disabled={!canWriteNow}
              />
            </div>
          )}

          {sheet.type === 'group' && (
            <div style={{ width: PAGE_W, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <GroupSection
                label={`${teacherName} (Teacher)`}
                accentColor={getTeacherColor()}
                height={SECTION_MIN_H}
                canExpand={false}
                strokes={getLayerStrokes(TEACHER_LAYER_ID)}
                writable={canWriteNow && isTeacher && activeLayerId === TEACHER_LAYER_ID}
                color={color}
                tool={tool}
                strokeWidth={strokeWidth}
                onStrokeAdd={layer.addStroke}
                onStrokeRemove={layer.removeStroke}
                onClick={isTeacher ? () => handleSelectTarget(null) : undefined}
                onExpand={() => {}}
              />
              {participantOrder.map((pid, idx) => {
                const merged = [...getLayerStrokes(pid), ...getLayerStrokes(annotationLayerId(pid)).map(s => ({ ...s, color: getTeacherColor() }))];
                const isMine = pid === myId;
                const writable = canWriteNow && (isMine ? activeLayerId === myId : isTeacher && activeSectionOwner === pid);
                return (
                  <GroupSection
                    key={pid}
                    label={nameFor(pid)}
                    accentColor={getParticipantColor(idx)}
                    height={layer.access.sectionHeights[pid] || SECTION_MIN_H}
                    canExpand
                    strokes={merged}
                    writable={writable}
                    color={color}
                    tool={tool}
                    strokeWidth={strokeWidth}
                    onStrokeAdd={layer.addStroke}
                    onStrokeRemove={layer.removeStroke}
                    onClick={isTeacher && !isMine ? () => handleSelectTarget(pid) : undefined}
                    onExpand={() => setSectionHeight(sheet.id, pid, (layer.access.sectionHeights[pid] || SECTION_MIN_H) + SECTION_GROW)}
                  />
                );
              })}
            </div>
          )}

          {sheet.type === 'individual' && (() => {
            let displayStrokes: Stroke[];
            if (isTeacher) {
              if (teacherTarget) {
                displayStrokes = [
                  ...getLayerStrokes(TEACHER_LAYER_ID),
                  ...getLayerStrokes(teacherTarget),
                  ...getLayerStrokes(annotationLayerId(teacherTarget)).map(s => ({ ...s, color: getTeacherColor() })),
                ];
              } else {
                displayStrokes = getLayerStrokes(TEACHER_LAYER_ID);
              }
            } else {
              displayStrokes = [
                ...getLayerStrokes(TEACHER_LAYER_ID),
                ...getLayerStrokes(myId),
                ...getLayerStrokes(annotationLayerId(myId)).map(s => ({ ...s, color: getTeacherColor() })),
              ];
            }
            return (
              <div style={{ width: PAGE_W, height: PAGE_H, background: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                <ClassroomCanvas
                  pageWidth={PAGE_W}
                  pageHeight={PAGE_H}
                  strokes={displayStrokes}
                  onStrokeAdd={layer.addStroke}
                  onStrokeRemove={layer.removeStroke}
                  color={color}
                  strokeWidth={strokeWidth}
                  tool={tool}
                  disabled={!canWriteNow}
                />
              </div>
            );
          })()}
        </div>

        {showParticipants && sheet.type !== 'personal' && isTeacher && (
          <ParticipantsSidebar
            sheetType={sheet.type as 'group' | 'individual'}
            teacherName={teacherName}
            participants={participantOrder}
            nameFor={nameFor}
            access={layer.access}
            onToggleMaster={v => toggleMasterAccess(sheet.id, v)}
            onToggleStudent={(id, v) => toggleStudentAccess(sheet.id, id, v)}
            teacherTarget={sheet.type === 'group' ? activeSectionOwner : teacherTarget}
            onSelectTarget={handleSelectTarget}
            onClose={() => setShowParticipants(false)}
          />
        )}
      </div>

      {sheet.type === 'individual' && isTeacher && teacherTarget && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '8px 0', background: '#1e293b', borderTop: '1px solid #334155' }}>
          <button
            onClick={() => setTeacherWriteMode('broadcast')}
            style={{ background: teacherWriteMode === 'broadcast' ? '#2563eb' : '#334155', color: 'white', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}
          >
            Write to my page
          </button>
          <button
            onClick={() => setTeacherWriteMode('annotate')}
            style={{ background: teacherWriteMode === 'annotate' ? '#2563eb' : '#334155', color: 'white', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold' }}
          >
            Annotate {nameFor(teacherTarget)}'s page
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Group sheet section ─────────────────────────────────────────────────────────

function GroupSection({
  label, accentColor, height, canExpand, strokes, writable, color, tool, strokeWidth,
  onStrokeAdd, onStrokeRemove, onClick, onExpand,
}: {
  label: string;
  accentColor: string;
  height: number;
  canExpand: boolean;
  strokes: Stroke[];
  writable: boolean;
  color: string;
  tool: 'pen' | 'eraser';
  strokeWidth: number;
  onStrokeAdd: (s: Stroke) => void;
  onStrokeRemove: (id: string) => void;
  onClick?: () => void;
  onExpand: () => void;
}) {
  return (
    <div style={{ background: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden', border: writable ? `2px solid ${accentColor}` : '2px solid transparent' }}>
      <div
        onClick={onClick}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: accentColor + '15', cursor: onClick ? 'pointer' : 'default' }}
      >
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: accentColor }} />
        <div style={{ fontWeight: 'bold', fontSize: 13, color: '#1e293b' }}>{label}</div>
        {writable && <div style={{ fontSize: 10, color: accentColor, fontWeight: 'bold', marginLeft: 4 }}>WRITABLE</div>}
      </div>
      <div style={{ height, overflowY: 'auto' }}>
        <ClassroomCanvas
          pageWidth={PAGE_W - 2}
          pageHeight={height}
          strokes={strokes}
          onStrokeAdd={onStrokeAdd}
          onStrokeRemove={onStrokeRemove}
          color={color}
          strokeWidth={strokeWidth}
          tool={tool}
          disabled={!writable}
        />
      </div>
      {canExpand && (
        <button
          onClick={onExpand}
          style={{ width: '100%', padding: '6px 0', background: '#f1f5f9', border: 'none', borderTop: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer', fontSize: 12 }}
        >
          + More space
        </button>
      )}
    </div>
  );
}
