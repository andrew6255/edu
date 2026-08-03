/**
 * Sheet Polling Service — Provides polling-based near-real-time sync for sheets.
 *
 * React hook that polls for stroke updates every 2.5s and saves local changes
 * with a 1s debounce after the user stops drawing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  pollSheetUpdates,
  saveSheetStrokes,
  getSheetStrokes,
  getSheetAccess,
  type SheetStrokeData,
  type SheetAccess,
} from '@/lib/classroomService';

const POLL_INTERVAL = 2500;   // Poll for new strokes every 2.5s
const SAVE_DEBOUNCE = 1000;   // Save 1s after user stops drawing
const ACCESS_POLL_INTERVAL = 5000; // Poll access changes every 5s

export interface UseSheetPollingOptions {
  sheetId: string;
  layerId: string;
  userId: string;
  enabled: boolean;
}

export interface UseSheetPollingResult {
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

export function useSheetPolling({
  sheetId,
  layerId,
  userId,
  enabled,
}: UseSheetPollingOptions): UseSheetPollingResult {
  const [remoteLayers, setRemoteLayers] = useState<SheetStrokeData[]>([]);
  const [access, setAccess] = useState<SheetAccess>({ sheetId, masterAccess: false, studentAccess: {} });
  const [loading, setLoading] = useState(true);

  const lastPollRef = useRef<string>(new Date(0).toISOString());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStrokesRef = useRef<unknown[] | null>(null);

  // Initial load
  useEffect(() => {
    if (!enabled || !sheetId) return;
    let alive = true;

    async function init() {
      try {
        const [strokes, acc] = await Promise.all([
          getSheetStrokes(sheetId),
          getSheetAccess(sheetId),
        ]);
        if (!alive) return;
        // Exclude our own layer from remote layers
        setRemoteLayers(strokes.filter(s => s.layerId !== layerId));
        setAccess(acc);
        // Set last poll to the latest update time
        const latest = strokes.reduce((max, s) => s.updatedAt > max ? s.updatedAt : max, new Date(0).toISOString());
        lastPollRef.current = latest;
      } catch (err) {
        console.warn('[sheetPolling] init error:', err);
      } finally {
        if (alive) setLoading(false);
      }
    }
    init();
    return () => { alive = false; };
  }, [sheetId, layerId, enabled]);

  // Polling for stroke updates
  useEffect(() => {
    if (!enabled || !sheetId) return;
    const interval = setInterval(async () => {
      try {
        const updates = await pollSheetUpdates(sheetId, lastPollRef.current);
        if (updates.length === 0) return;
        // Update last poll timestamp
        const latest = updates.reduce((max, s) => s.updatedAt > max ? s.updatedAt : max, lastPollRef.current);
        lastPollRef.current = latest;
        // Merge updates into remote layers (exclude our own)
        const remote = updates.filter(s => s.layerId !== layerId);
        if (remote.length > 0) {
          setRemoteLayers(prev => {
            const map = new Map(prev.map(s => [s.layerId, s]));
            for (const update of remote) {
              map.set(update.layerId, update);
            }
            return [...map.values()];
          });
        }
      } catch (err) {
        console.warn('[sheetPolling] poll error:', err);
      }
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [sheetId, layerId, enabled]);

  // Polling for access changes
  useEffect(() => {
    if (!enabled || !sheetId) return;
    const interval = setInterval(async () => {
      try {
        const acc = await getSheetAccess(sheetId);
        setAccess(acc);
      } catch (err) {
        console.warn('[sheetPolling] access poll error:', err);
      }
    }, ACCESS_POLL_INTERVAL);
    return () => clearInterval(interval);
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
        console.warn('[sheetPolling] save error:', err);
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
      console.warn('[sheetPolling] force save error:', err);
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
