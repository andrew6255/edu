/**
 * Sheet Realtime Service — near-instant sync for a classroom sheet.
 *
 * Strokes and access both live in `global_docs` and are pushed via Supabase
 * Realtime (`listenGlobalCollection`/`listenGlobalDoc`), the same mechanism
 * already used for chat, lobby, and notifications elsewhere in this app —
 * this used to be a `setInterval` poll (2.5s for strokes, 5s for access),
 * which is what made writing/drawing and access changes feel laggy.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  saveSheetStrokes,
  getSheetStrokes,
  getSheetAccess,
  docToStrokeData,
  docToAccess,
  type SheetStrokeData,
  type SheetAccess,
} from '@/lib/classroomService';
import { listenGlobalCollection, listenGlobalDoc } from '@/lib/supabaseDocStore';

// Strokes now arrive via realtime push, not a poll wait — this debounce only
// batches a fast burst of strokes into one write, it no longer gates how
// soon other participants see them.
const SAVE_DEBOUNCE = 200;

export interface UseSheetRealtimeOptions {
  sheetId: string;
  layerId: string;
  userId: string;
  enabled: boolean;
}

export interface UseSheetRealtimeResult {
  /** All remote stroke layers (other users' strokes) */
  remoteLayers: SheetStrokeData[];
  /** Current access configuration */
  access: SheetAccess;
  /** Whether the current user can write */
  canWrite: boolean;
  /** Save local strokes (debounced) */
  saveStrokes: (strokes: unknown[]) => void;
  /** Force an immediate save */
  forceSave: (strokes: unknown[]) => Promise<void>;
  /** Whether we're currently loading initial data */
  loading: boolean;
}

export function useSheetRealtime({
  sheetId,
  layerId,
  userId,
  enabled,
}: UseSheetRealtimeOptions): UseSheetRealtimeResult {
  const [remoteLayers, setRemoteLayers] = useState<SheetStrokeData[]>([]);
  const [access, setAccess] = useState<SheetAccess>({ sheetId, masterAccess: false, studentAccess: {}, sectionHeights: {} });
  const [loading, setLoading] = useState(true);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStrokesRef = useRef<unknown[] | null>(null);

  // Strokes: initial load, then live push updates.
  useEffect(() => {
    if (!enabled || !sheetId) return;
    let alive = true;
    setLoading(true);

    getSheetStrokes(sheetId).then((strokes) => {
      if (!alive) return;
      setRemoteLayers(strokes.filter((s) => s.layerId !== layerId));
    }).catch((err) => {
      console.warn('[sheetRealtime] initial strokes load error:', err);
    }).finally(() => {
      if (alive) setLoading(false);
    });

    const unsub = listenGlobalCollection('sheet_strokes', [{ field: 'sheetId', value: sheetId }], (docs) => {
      if (!alive) return;
      const all = docs.map((d) => docToStrokeData(d.data));
      setRemoteLayers(all.filter((s) => s.layerId !== layerId));
    });
    return () => { alive = false; unsub(); };
  }, [sheetId, layerId, enabled]);

  // Access: initial load, then live push updates — this is what makes a
  // teacher's own toggle/expand clicks and a student's canvas unlocking show
  // up immediately instead of waiting on the next poll tick.
  useEffect(() => {
    if (!enabled || !sheetId) return;
    let alive = true;

    getSheetAccess(sheetId).then((acc) => {
      if (alive) setAccess(acc);
    }).catch((err) => {
      console.warn('[sheetRealtime] initial access load error:', err);
    });

    const unsub = listenGlobalDoc('sheet_access', `sa_${sheetId}`, (data) => {
      if (!alive) return;
      setAccess(docToAccess(data));
    });
    return () => { alive = false; unsub(); };
  }, [sheetId, enabled]);

  // Debounced save
  const saveStrokes = useCallback((strokes: unknown[]) => {
    pendingStrokesRef.current = strokes;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const toSave = pendingStrokesRef.current;
      if (!toSave) return;
      pendingStrokesRef.current = null;
      try {
        await saveSheetStrokes(sheetId, userId, layerId, toSave);
      } catch (err) {
        console.warn('[sheetRealtime] save error:', err);
      }
    }, SAVE_DEBOUNCE);
  }, [sheetId, userId, layerId]);

  // Force save (for unmount or explicit save)
  const forceSave = useCallback(async (strokes: unknown[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    pendingStrokesRef.current = null;
    try {
      await saveSheetStrokes(sheetId, userId, layerId, strokes);
    } catch (err) {
      console.warn('[sheetRealtime] force save error:', err);
    }
  }, [sheetId, userId, layerId]);

  // Cleanup pending saves on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Compute whether current user can write
  const canWrite = access.masterAccess
    ? (access.studentAccess[userId] === true)
    : false;

  return { remoteLayers, access, canWrite, saveStrokes, forceSave, loading };
}
