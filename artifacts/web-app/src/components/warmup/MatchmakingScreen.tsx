import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  listenMatchmakingEntry, getSession
} from '@/lib/gameSessionService';
import { GameSession } from '@/types/warmup';

interface Props {
  gameId: string;
  gameLabel: string;
  onMatched: (session: GameSession) => void;
  onCancel: () => void;
}

const TIMEOUT_SEC = 8;

export default function MatchmakingScreen({ gameId, gameLabel, onMatched, onCancel }: Props) {
  const { user, userData, refreshUserData } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SEC);
  const [status, setStatus] = useState<'searching' | 'found' | 'bot' | 'error'>('searching');
  const [error, setError] = useState<string | null>(null);
  const entryIdRef = useRef<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user || !userData) return;
    let cancelled = false;

    async function start() {
      const attemptId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      attemptIdRef.current = attemptId;
      const { startRankedMatchmaking } = await import('@/lib/economyApiService');
      const result = await startRankedMatchmaking(gameId, attemptId);
      await refreshUserData();
      const { matched, session, entryId } = result as typeof result & { session?: GameSession };
      entryIdRef.current = entryId;

      if (matched && session && !cancelled) {
        setStatus('found');
        setTimeout(() => onMatched(session), 1000);
        return;
      }

      unsubRef.current = listenMatchmakingEntry(entryId, async (sessionId) => {
        if (cancelled) return;
        const s = await getSession(sessionId);
        if (s) { setStatus('found'); setTimeout(() => onMatched(s), 1000); }
      });
    }

    start().catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : 'Matchmaking could not start.');
      setStatus('error');
    });
    return () => { cancelled = true; unsubRef.current?.(); };
  }, []);

  useEffect(() => {
    if (status !== 'searching') return;
    const interval = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(interval);
          handleBotMatch();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  async function handleBotMatch() {
    if (!user || !userData || !attemptIdRef.current) return;
    unsubRef.current?.();
    try {
      const { startRankedBotMatch } = await import('@/lib/economyApiService');
      const result = await startRankedBotMatch(gameId, attemptIdRef.current);
      const session = result.session as GameSession;
      entryIdRef.current = result.entryId;
      setStatus(session.player2.isBot ? 'bot' : 'found');
      setTimeout(() => onMatched(session), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bot match could not start.');
      setStatus('error');
    }
  }

  async function handleCancel() {
    unsubRef.current?.();
    if (user && userData && attemptIdRef.current) {
      const { cancelRankedMatchmaking } = await import('@/lib/economyApiService');
      await cancelRankedMatchmaking(gameId, attemptIdRef.current);
      await refreshUserData();
    }
    onCancel();
  }

  const dots = '.'.repeat((TIMEOUT_SEC - secondsLeft) % 4);

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 28, padding: 30
    }}>
      {status === 'error' && (
        <div style={{ textAlign: 'center', display: 'grid', gap: 14 }}>
          <div style={{ color: '#fca5a5', fontWeight: 800 }}>{error}</div>
          <button onClick={onCancel} className="ll-btn">Back</button>
        </div>
      )}
      {status === 'searching' && (
        <>
          <div style={{ position: 'relative' }}>
            <div style={{
              width: 100, height: 100, borderRadius: '50%',
              border: '3px solid #334155', borderTopColor: '#f97316',
              animation: 'spin 1s linear infinite'
            }} />
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 32
            }}>⚔️</div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 6 }}>
              Finding Opponent{dots}
            </div>
            <div style={{ color: '#64748b', fontSize: 14 }}>
              {gameLabel} · Ranked Match
            </div>
          </div>

          <div style={{ position: 'relative', width: 200, height: 6, background: '#1e293b', borderRadius: 3 }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, height: '100%',
              width: `${((TIMEOUT_SEC - secondsLeft) / TIMEOUT_SEC) * 100}%`,
              background: secondsLeft <= 3 ? '#ef4444' : '#f97316',
              borderRadius: 3, transition: '1s linear'
            }} />
          </div>

          <div style={{ color: '#64748b', fontSize: 13 }}>
            {secondsLeft > 0
              ? `LogicBot steps in if no match in ${secondsLeft}s`
              : 'Preparing LogicBot...'}
          </div>

          <button onClick={handleCancel} className="ll-btn" style={{ fontSize: 13 }}>
            Cancel & Refund 25 🪙
          </button>
        </>
      )}

      {status === 'found' && (
        <>
          <div style={{ fontSize: 56 }}>⚔️</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#10b981', fontSize: 22, fontWeight: 'bold', marginBottom: 6 }}>
              Opponent Found!
            </div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Starting match...</div>
          </div>
        </>
      )}

      {status === 'bot' && (
        <>
          <div style={{ fontSize: 56 }}>🤖</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#f97316', fontSize: 20, fontWeight: 'bold', marginBottom: 6 }}>
              LogicBot is ready!
            </div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Starting match...</div>
          </div>
        </>
      )}
    </div>
  );
}
