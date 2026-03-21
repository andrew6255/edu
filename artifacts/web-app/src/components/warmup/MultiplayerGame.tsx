import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/contexts/SessionContext';
import RoundTracker from './RoundTracker';
import {
  listenSession, submitRoundScore, resolveRound,
  generateBotScore
} from '@/lib/gameSessionService';
import { GameSession, GameMode } from '@/types/warmup';
import { updateDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface GameConfig {
  id: string;
  label: string;
  icon: string;
  component: React.ComponentType<{ gameId: string; mode: GameMode; onGameOver: (score: number) => void }>;
}

interface Props {
  session: GameSession;
  game: GameConfig;
  onComplete: (session: GameSession) => void;
  onLeave: () => void;
}

type RoundPhase = 'playing' | 'waiting_opponent' | 'round_result' | 'match_complete';

export default function MultiplayerGame({ session: initialSession, game, onComplete, onLeave }: Props) {
  const { user, userData, refreshUserData } = useAuth();
  const { setActiveSession } = useSession();
  const [session, setSession] = useState<GameSession>(initialSession);
  const [phase, setPhase] = useState<RoundPhase>('playing');
  const [myLastScore, setMyLastScore] = useState<number | null>(null);
  const [oppLastScore, setOppLastScore] = useState<number | null>(null);
  const [roundWinner, setRoundWinner] = useState<'me' | 'opp' | 'draw' | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const resolvedRounds = useRef<Set<number>>(new Set());

  const isP1 = session.player1.uid === user?.uid;
  const myKey = isP1 ? 'player1' : 'player2';
  const oppKey = isP1 ? 'player2' : 'player1';
  const mode = (session.mode as GameMode) || 'ranked';

  useEffect(() => {
    setActiveSession({ sessionId: session.id, gameId: game.id, gameLabel: game.label, mode: session.mode });
    unsubRef.current = listenSession(session.id, handleSessionUpdate);
    return () => { unsubRef.current?.(); };
  }, []);

  function handleSessionUpdate(updated: GameSession) {
    setSession(updated);
    const me = isP1 ? updated.player1 : updated.player2;
    const opp = isP1 ? updated.player2 : updated.player1;

    if (updated.state === 'complete') {
      unsubRef.current?.();
      setActiveSession(null);
      handleMatchComplete(updated);
      return;
    }

    if (updated.state === 'round_end') {
      const roundNum = updated.rounds[updated.rounds.length - 1]?.round;
      if (!resolvedRounds.current.has(roundNum)) return;
      return;
    }

    const myScore = me.roundScore;
    const oppScore = opp.roundScore;

    if (myScore !== null && oppScore !== null && phase === 'waiting_opponent') {
      if (!isP1 || opp.isBot) {
        handleBothScoresReady(updated);
      }
    }

    if (oppScore !== null && phase === 'waiting_opponent' && myScore !== null) {
      handleBothScoresReady(updated);
    }
  }

  async function handleBothScoresReady(updated: GameSession) {
    const roundNum = updated.currentRound - 1;
    if (resolvedRounds.current.has(roundNum)) return;
    resolvedRounds.current.add(roundNum);

    const resolved = await resolveRound(updated.id);
    if (!resolved) return;

    const lastRound = resolved.rounds[resolved.rounds.length - 1];
    if (!lastRound) return;

    setMyLastScore(isP1 ? lastRound.p1Score : lastRound.p2Score);
    setOppLastScore(isP1 ? lastRound.p2Score : lastRound.p1Score);
    const w = lastRound.winner;
    setRoundWinner(w === 'draw' ? 'draw' : (isP1 ? w === 'p1' : w === 'p2') ? 'me' : 'opp');
    setSession(resolved);
    setPhase(resolved.state === 'complete' ? 'match_complete' : 'round_result');
  }

  async function handleGameOver(score: number) {
    setMyLastScore(score);
    setPhase('waiting_opponent');
    await submitRoundScore(session.id, myKey, score);

    const opp = isP1 ? session.player2 : session.player1;
    if (opp.isBot) {
      const difficulty = opp.uid.includes('easy') ? 'easy' : opp.uid.includes('hard') ? 'hard' : 'medium';
      const delay = 800 + Math.random() * 1500;
      setTimeout(async () => {
        const botScore = generateBotScore(game.id, difficulty);
        await submitRoundScore(session.id, oppKey, botScore);
        const snap = await import('@/lib/gameSessionService').then(m => m.getSession(session.id));
        if (snap) handleBothScoresReady(snap);
      }, delay);
    }
  }

  function startNextRound() {
    setMyLastScore(null);
    setOppLastScore(null);
    setRoundWinner(null);
    setPhase('playing');
  }

  async function handleMatchComplete(finalSession: GameSession) {
    const me = isP1 ? finalSession.player1 : finalSession.player2;
    const opp = isP1 ? finalSession.player2 : finalSession.player1;
    const won = finalSession.winner === (isP1 ? 'p1' : 'p2');

    if (user) {
      const xpGain = won ? 150 : 50;
      const goldGain = won ? 50 : 0;
      const snap = await import('@/lib/userService').then(m => m.getUserData(user.uid));
      if (snap) {
        await updateDoc(doc(db, 'users', user.uid), {
          'economy.global_xp': (snap.economy.global_xp || 0) + xpGain,
          'economy.gold': (snap.economy.gold || 0) + goldGain
        });
        await refreshUserData();
      }
    }

    setSession(finalSession);
    setPhase('match_complete');
    onComplete(finalSession);
  }

  const GameComp = game.component;

  if (phase === 'match_complete') {
    const me = isP1 ? session.player1 : session.player2;
    const opp = isP1 ? session.player2 : session.player1;
    const won = session.winner === (isP1 ? 'p1' : 'p2');
    const draw = session.winner === 'draw';

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>{won ? '🏆' : draw ? '🤝' : '💀'}</div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 'bold', color: won ? '#fbbf24' : draw ? '#64748b' : '#ef4444', marginBottom: 8 }}>
            {won ? 'You Won!' : draw ? 'Draw!' : 'You Lost'}
          </div>
          <div style={{ fontSize: 30, fontWeight: 'bold', color: 'white', marginBottom: 4 }}>
            {me.roundWins} — {opp.roundWins}
          </div>
          <div style={{ color: '#64748b', fontSize: 14 }}>{me.username} vs {opp.username}</div>
        </div>

        <div style={{ background: '#1e293b', borderRadius: 14, padding: '16px 24px', border: '1px solid #334155', width: '100%', maxWidth: 320 }}>
          <div style={{ color: '#64748b', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>Round History</div>
          {session.rounds.map(r => {
            const myS = isP1 ? r.p1Score : r.p2Score;
            const opS = isP1 ? r.p2Score : r.p1Score;
            const iWon = r.winner === (isP1 ? 'p1' : 'p2');
            return (
              <div key={r.round} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>Round {r.round}</span>
                <span style={{ fontWeight: 'bold', color: iWon ? '#10b981' : '#ef4444' }}>
                  {myS} — {opS} {iWon ? '✓' : '✗'}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 320 }}>
          <button onClick={onLeave} className="ll-btn" style={{ flex: 1, fontSize: 14 }}>Back to Hub</button>
        </div>

        <div style={{ color: '#64748b', fontSize: 12 }}>
          +{won ? 150 : 50} XP {won ? '· +50 🪙' : ''} earned
        </div>
      </div>
    );
  }

  if (phase === 'round_result') {
    const won = roundWinner === 'me';
    const draw = roundWinner === 'draw';
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <RoundTracker session={session} myUid={user?.uid ?? ''} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 30 }}>
          <div style={{ fontSize: 52 }}>{won ? '🎉' : draw ? '🤝' : '💥'}</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: won ? '#10b981' : draw ? '#64748b' : '#ef4444', marginBottom: 8 }}>
              {won ? 'Round Won!' : draw ? 'Round Draw' : 'Round Lost'}
            </div>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: 'white' }}>
              {myLastScore} — {oppLastScore}
            </div>
          </div>
          <button onClick={startNextRound} className="ll-btn ll-btn-primary" style={{ padding: '14px 40px', fontSize: 16 }}>
            Next Round →
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'waiting_opponent') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <RoundTracker session={session} myUid={user?.uid ?? ''} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 30 }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', border: '3px solid #334155', borderTopColor: '#3b82f6', animation: 'spin 1s linear infinite' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 6 }}>
              Your score: <span style={{ color: '#10b981' }}>{myLastScore}</span>
            </div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Waiting for opponent...</div>
          </div>
          <button onClick={onLeave} className="ll-btn" style={{ fontSize: 13 }}>
            Leave (forfeit round)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <RoundTracker session={session} myUid={user?.uid ?? ''} />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <GameComp gameId={game.id} mode={mode} onGameOver={handleGameOver} />
      </div>
    </div>
  );
}
