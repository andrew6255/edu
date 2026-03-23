import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/contexts/SessionContext';
import RoundTracker from './RoundTracker';
import {
  listenSession, submitRoundScore, resolveRound,
  generateBotScore, getSession
} from '@/lib/gameSessionService';
import { forfeitSession } from '@/lib/gameSessionService';
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
  onLeave: () => void;
}

type RoundPhase = 'playing' | 'waiting_opponent' | 'round_result' | 'match_complete';

export default function MultiplayerGame({ session: initialSession, game, onLeave }: Props) {
  const { user, userData, refreshUserData } = useAuth();
  const { setActiveSession } = useSession();

  const [session, setSession] = useState<GameSession>(initialSession);
  const [phase, setPhase] = useState<RoundPhase>('playing');
  const [myLastScore, setMyLastScore] = useState<number | null>(null);
  const [oppLastScore, setOppLastScore] = useState<number | null>(null);
  const [roundWinner, setRoundWinner] = useState<'me' | 'opp' | 'draw' | null>(null);
  const [xpGained, setXpGained] = useState(0);
  const [goldGained, setGoldGained] = useState(0);

  // Refs to avoid stale closures in Firestore callbacks
  const phaseRef = useRef<RoundPhase>('playing');
  const resolvedRounds = useRef<Set<number>>(new Set());
  const xpAwardedRef = useRef(false);
  const unsubRef = useRef<(() => void) | null>(null);

  const isP1 = initialSession.player1.uid === user?.uid;
  const myKey = isP1 ? 'player1' : 'player2';
  const oppKey = isP1 ? 'player2' : 'player1';
  const opp = isP1 ? session.player2 : session.player1;
  const mode = (session.mode as GameMode) || 'ranked';

  function updatePhase(p: RoundPhase) {
    phaseRef.current = p;
    setPhase(p);
  }

  // Award XP/gold once when match is over
  async function awardMatchRewards(won: boolean, drew: boolean) {
    if (xpAwardedRef.current || !user) return;
    xpAwardedRef.current = true;

    const xp = won ? 150 : drew ? 75 : 50;
    const gold = won ? 50 : 0;
    setXpGained(xp);
    setGoldGained(gold);

    try {
      const userService = await import('@/lib/userService');
      const snap = await userService.getUserData(user.uid);
      if (snap) {
        await updateDoc(doc(db, 'users', user.uid), {
          'economy.global_xp': (snap.economy.global_xp || 0) + xp,
          'economy.gold': (snap.economy.gold || 0) + gold,
        });
        if (mode === 'ranked' || mode === 'friend') {
           const result = won ? 'win' : drew ? 'draw' : 'loss';
           await userService.updateRankedStats(user.uid, game.id, result);
        }
        await refreshUserData();
      }
    } catch (e) {
      console.error('Failed to award rewards:', e);
    }
  }

  const handleBothScoresReady = useCallback(async (updated: GameSession) => {
    // Round number is 1-indexed (currentRound before resolving)
    const roundNum = updated.currentRound;
    if (resolvedRounds.current.has(roundNum)) return;
    resolvedRounds.current.add(roundNum);

    const resolved = await resolveRound(updated.id);
    if (!resolved) return;

    const lastRound = resolved.rounds[resolved.rounds.length - 1];
    if (!lastRound) return;

    const myRoundScore = isP1 ? lastRound.p1Score : lastRound.p2Score;
    const oppRoundScore = isP1 ? lastRound.p2Score : lastRound.p1Score;
    const w = lastRound.winner;
    const rw: 'me' | 'opp' | 'draw' =
      w === 'draw' ? 'draw' : (isP1 ? w === 'p1' : w === 'p2') ? 'me' : 'opp';

    setMyLastScore(myRoundScore);
    setOppLastScore(oppRoundScore);
    setRoundWinner(rw);
    setSession(resolved);

    if (resolved.state === 'complete') {
      const won = resolved.winner === (isP1 ? 'p1' : 'p2');
      const drew = resolved.winner === 'draw';
      await awardMatchRewards(won, drew);
      setActiveSession(null);
      updatePhase('match_complete');
    } else {
      updatePhase('round_result');
    }
  }, [isP1]);

  useEffect(() => {
    setActiveSession({
      sessionId: session.id,
      gameId: game.id,
      gameLabel: game.label,
      mode: session.mode,
    });

    unsubRef.current = listenSession(session.id, (updated: GameSession) => {
      setSession(updated);

      // Match already complete via direct path — listener only used for real opponent sync
      if (updated.state === 'complete' && phaseRef.current !== 'match_complete') {
        const won = updated.winner === (isP1 ? 'p1' : 'p2');
        const drew = updated.winner === 'draw';
        awardMatchRewards(won, drew);
        setActiveSession(null);
        updatePhase('match_complete');
        return;
      }

      // Both scores present: only handle via listener when in waiting phase
      if (phaseRef.current !== 'waiting_opponent') return;
      const me = isP1 ? updated.player1 : updated.player2;
      const oppPlayer = isP1 ? updated.player2 : updated.player1;
      if (me.roundScore !== null && oppPlayer.roundScore !== null) {
        handleBothScoresReady(updated);
      }
    });

    return () => {
      unsubRef.current?.();
      setActiveSession(null);
    };
  }, []);

  async function handleGameOver(score: number) {
    if (phaseRef.current !== 'playing') return;
    setMyLastScore(score);
    updatePhase('waiting_opponent');

    await submitRoundScore(session.id, myKey, score);

    const oppPlayer = isP1 ? session.player2 : session.player1;
    if (oppPlayer.isBot) {
      const diff = oppPlayer.uid.includes('easy') ? 'easy' : oppPlayer.uid.includes('hard') ? 'hard' : 'medium';
      const delay = 800 + Math.random() * 1500;
      setTimeout(async () => {
        const botScore = generateBotScore(game.id, diff);
        await submitRoundScore(session.id, oppKey, botScore);
        const snap = await getSession(session.id);
        if (snap) handleBothScoresReady(snap);
      }, delay);
    }
  }

  function startNextRound() {
    setMyLastScore(null);
    setOppLastScore(null);
    setRoundWinner(null);
    updatePhase('playing');
  }

  function handleLeave() {
    unsubRef.current?.();

    if (user && (mode === 'ranked' || mode === 'friend')) {
      forfeitSession(session.id, user.uid)
        .catch(e => console.error('Failed to forfeit session:', e))
        .finally(() => {
          setActiveSession(null);
          onLeave();
        });
      return;
    }

    setActiveSession(null);
    onLeave();
  }

  const GameComp = game.component;
  const me = isP1 ? session.player1 : session.player2;

  const leaveLabel = mode === 'ranked' || mode === 'friend' ? 'Forfeit & Leave' : 'Leave Match';
  const leaveBtnClass = mode === 'ranked' || mode === 'friend' ? 'll-btn ll-btn-danger' : 'll-btn';

  function ActionBar() {
    return (
      <div style={{
        padding: '10px 16px', background: 'rgba(0,0,0,0.5)',
        borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0
      }}>
        <button
          onClick={handleLeave}
          className={leaveBtnClass}
          style={{ padding: '7px 14px', fontSize: 12 }}
        >
          {leaveLabel}
        </button>
        <span style={{ fontWeight: 'bold', fontSize: 14, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {game.icon} {game.label}
        </span>
        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11, background: '#1e293b', padding: '3px 8px', borderRadius: 6, border: '1px solid #334155' }}>
          ⚔️ {mode === 'friend' ? 'Play a Friend' : 'Ranked'}
        </span>
      </div>
    );
  }

  // ── Match Complete ────────────────────────────────────────────────────────
  if (phase === 'match_complete') {
    const won = session.winner === (isP1 ? 'p1' : 'p2');
    const drew = session.winner === 'draw';

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '24px 20px' }}>
        <div style={{ fontSize: 64 }}>{won ? '🏆' : drew ? '🤝' : '💀'}</div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 'bold', color: won ? '#fbbf24' : drew ? '#64748b' : '#ef4444', marginBottom: 6 }}>
            {won ? 'You Won!' : drew ? 'Draw!' : 'You Lost'}
          </div>
          <div style={{ fontSize: 34, fontWeight: 'bold', color: 'white', marginBottom: 4 }}>
            {me.roundWins} — {opp.roundWins}
          </div>
          <div style={{ color: '#64748b', fontSize: 13 }}>{me.username} vs {opp.username}</div>
        </div>

        {/* Rewards */}
        {xpGained > 0 && (
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 10, padding: '8px 16px', textAlign: 'center' }}>
              <div style={{ color: '#93c5fd', fontSize: 11, marginBottom: 2 }}>XP EARNED</div>
              <div style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: 18 }}>+{xpGained}</div>
            </div>
            {goldGained > 0 && (
              <div style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, padding: '8px 16px', textAlign: 'center' }}>
                <div style={{ color: '#fcd34d', fontSize: 11, marginBottom: 2 }}>GOLD EARNED</div>
                <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 18 }}>+{goldGained} 🪙</div>
              </div>
            )}
          </div>
        )}

        {/* Round history */}
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 20px', border: '1px solid #334155', width: '100%', maxWidth: 320 }}>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 10, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }}>Round History</div>
          {session.rounds.map(r => {
            const myS = isP1 ? r.p1Score : r.p2Score;
            const opS = isP1 ? r.p2Score : r.p1Score;
            const iWon = r.winner === (isP1 ? 'p1' : 'p2');
            const isDraw = r.winner === 'draw';
            return (
              <div key={r.round} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: r.round < session.rounds.length ? '1px solid #1e293b' : 'none', fontSize: 13 }}>
                <span style={{ color: '#64748b' }}>Round {r.round}</span>
                <span style={{ fontWeight: 'bold', color: iWon ? '#10b981' : isDraw ? '#64748b' : '#ef4444' }}>
                  {myS} — {opS} {iWon ? '✓' : isDraw ? '=' : '✗'}
                </span>
              </div>
            );
          })}
        </div>

        <button onClick={handleLeave} className="ll-btn ll-btn-primary" style={{ width: '100%', maxWidth: 320, padding: '14px' }}>
          Back to Hub
        </button>
      </div>
    );
  }

  // ── Round Result ──────────────────────────────────────────────────────────
  if (phase === 'round_result') {
    const won = roundWinner === 'me';
    const drew = roundWinner === 'draw';
    const color = won ? '#10b981' : drew ? '#64748b' : '#ef4444';

    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <RoundTracker session={session} myUid={user?.uid ?? ''} />
        <ActionBar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
          <div style={{ fontSize: 52 }}>{won ? '🎉' : drew ? '🤝' : '💥'}</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color, marginBottom: 8 }}>
              {won ? 'Round Won!' : drew ? 'Round Draw' : 'Round Lost'}
            </div>
            <div style={{ fontSize: 30, fontWeight: 'bold', color: 'white' }}>
              {myLastScore} — {oppLastScore}
            </div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Your score — {opp.username}</div>
          </div>
          <button onClick={startNextRound} className="ll-btn ll-btn-primary" style={{ padding: '14px 44px', fontSize: 16 }}>
            Next Round →
          </button>
        </div>
      </div>
    );
  }

  // ── Waiting for Opponent ──────────────────────────────────────────────────
  if (phase === 'waiting_opponent') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <RoundTracker session={session} myUid={user?.uid ?? ''} />
        <ActionBar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
          <div style={{ width: 60, height: 60, borderRadius: '50%', border: '3px solid #334155', borderTopColor: '#3b82f6', animation: 'spin 1s linear infinite' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 6 }}>
              Your score: <span style={{ color: '#10b981' }}>{myLastScore}</span>
            </div>
            <div style={{ color: '#64748b', fontSize: 14 }}>
              {opp.isBot ? `${opp.username} is calculating…` : `Waiting for ${opp.username}…`}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <RoundTracker session={session} myUid={user?.uid ?? ''} />
      <ActionBar />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <GameComp gameId={game.id} mode={mode} onGameOver={handleGameOver} />
      </div>
    </div>
  );
}
