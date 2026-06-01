import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  joinMatchmaking, listenMatchmakingEntry, cancelMatchmaking,
  createSession, generateBotScore, getSession
} from '@/lib/gameSessionService';
import { updateEconomy } from '@/lib/userService';
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
  const [status, setStatus] = useState<'searching' | 'found' | 'bot'>('searching');
  const entryIdRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user || !userData) return;
    let cancelled = false;

    async function start() {
      const goldCost = 25;
      await updateEconomy(user!.uid, { gold: -goldCost });
      await refreshUserData();

      const { matched, session, entryId } = await joinMatchmaking(
        user!.uid, userData!.username || 'Player', gameId
      );
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

    start();
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
    if (!user || !userData) return;
    unsubRef.current?.();
    if (entryIdRef.current) await cancelMatchmaking(entryIdRef.current);

    const p1 = { uid: user.uid, username: userData.username || 'You', roundScore: null, roundWins: 0, isBot: false };
    const p2 = { uid: 'logicbot_medium', username: '🤖 LogicBot', roundScore: null, roundWins: 0, isBot: true };
    const session = await createSession(gameId, 'ranked', p1, p2);
    setStatus('bot');
    setTimeout(() => onMatched(session), 1000);
  }

  async function handleCancel() {
    unsubRef.current?.();
    if (entryIdRef.current) await cancelMatchmaking(entryIdRef.current);
    if (user && userData) {
      await updateEconomy(user.uid, { gold: 25 });
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
