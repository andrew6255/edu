import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSession } from '@/contexts/SessionContext';
import { GameMode, GameSession } from '@/types/warmup';
import ModePicker from '@/components/warmup/ModePicker';
import MatchmakingScreen from '@/components/warmup/MatchmakingScreen';
import FriendChallengeModal from '@/components/warmup/FriendChallengeModal';
import MultiplayerGame from '@/components/warmup/MultiplayerGame';
import { getLeaderboard, submitScore } from '@/lib/leaderboardService';
import { LeaderboardEntry } from '@/types/warmup';
import { updateHighScore } from '@/lib/userService';
import QuickMathGame from '@/games/QuickMathGame';
import PyramidGame from '@/games/PyramidGame';
import BlockPuzzleGame from '@/games/BlockPuzzleGame';
import FlipNodesGame from '@/games/FlipNodesGame';
import FifteenGame from '@/games/FifteenGame';
import SequenceGame from '@/games/SequenceGame';
import CompareExpGame from '@/games/CompareExpGame';
import TrueFalseGame from '@/games/TrueFalseGame';
import MissingOpGame from '@/games/MissingOpGame';
import MemoCellsGame from '@/games/MemoCellsGame';
import MemoOrderGame from '@/games/MemoOrderGame';
import CompleteEqGame from '@/games/CompleteEqGame';
import NeonGridGame from '@/games/NeonGridGame';
import FlipCupGame from '@/games/FlipCupGame';
import TicTacToeGame from '@/games/TicTacToeGame';
import ChessMemoryGame from '@/games/ChessMemoryGame';

export type WarmupCategory = 'rapid' | 'memory' | 'spatial' | 'logic';

type GamePhase =
  | 'hub'
  | 'mode_picker'
  | 'matchmaking'
  | 'friend_challenge'
  | 'playing_solo'
  | 'playing_multi'
  | 'solo_result';

export interface GameConfig {
  id: string;
  label: string;
  icon: string;
  category: WarmupCategory;
  description: string;
  component: React.ComponentType<{ gameId: string; mode: GameMode; onGameOver: (score: number) => void }>;
  isNew?: boolean;
}

const GAMES: GameConfig[] = [
  { id: 'quickMath',    label: 'Quick Math',         icon: '🧮', category: 'rapid',   description: '10 sec per question. One wrong = game over!',   component: QuickMathGame },
  { id: 'timeLimit',    label: 'Time Limit',         icon: '⏱️', category: 'rapid',   description: '60 seconds, max questions. Wrong = -1.',        component: QuickMathGame },
  { id: 'advQuickMath', label: 'Advanced Math',      icon: '⚡', category: 'rapid',   description: 'Harder questions, survival mode',               component: QuickMathGame },
  { id: 'trueFalse',    label: 'True or False',      icon: '✅', category: 'rapid',   description: 'Judge math statements in 60 seconds',           component: TrueFalseGame, isNew: true },
  { id: 'compareExp',   label: 'Compare Expressions',icon: '⚖️', category: 'rapid',   description: 'Which side is bigger? <, =, or >?',            component: CompareExpGame, isNew: true },
  { id: 'missingOp',    label: 'Missing Operator',   icon: '🔣', category: 'rapid',   description: 'Find the missing +, −, ×, or ÷',               component: MissingOpGame, isNew: true },
  { id: 'completeEq',   label: 'Complete Equation',  icon: '📝', category: 'rapid',   description: 'Fill both blanks to complete the equation',      component: CompleteEqGame, isNew: true },
  { id: 'sequence',     label: 'Sequence',           icon: '🔗', category: 'rapid',   description: 'Complete the number pattern',                   component: SequenceGame },
  { id: 'memoCells',    label: 'Memo Cells',         icon: '🧠', category: 'memory',  description: 'Memorize flashing cells, then recall them',      component: MemoCellsGame, isNew: true },
  { id: 'memoOrder',    label: 'Memo Order',         icon: '🔢', category: 'memory',  description: 'Tap numbers in the order they appeared',        component: MemoOrderGame, isNew: true },
  { id: 'pyramid',      label: 'Number Pyramid',     icon: '△',  category: 'logic',   description: 'Fill in the pyramid using addition',            component: PyramidGame },
  { id: 'flipNodes',    label: 'Flip Nodes',         icon: '⬡',  category: 'logic',   description: 'Solve the parity flipping puzzle',              component: FlipNodesGame },
  { id: 'blockPuzzle',  label: 'Block Puzzle',       icon: '🟦', category: 'spatial', description: 'Drop blocks and clear the grid',               component: BlockPuzzleGame },
  { id: 'fifteenPuzzle',label: '15 Puzzle',          icon: '🔀', category: 'spatial', description: 'Slide tiles to sort 1–15 in order',             component: FifteenGame },
  { id: 'neonGrid',     label: 'Neon Grid',          icon: '💡', category: 'spatial', description: 'Copy the glowing pattern by toggling cells',      component: NeonGridGame,   isNew: true },
  { id: 'flipCup',      label: 'Flip Cup',           icon: '🥤', category: 'logic',   description: 'Tap to flip cups and neighbors — all upright!',  component: FlipCupGame,    isNew: true },
  { id: 'ticTacToe',   label: 'Tic Tac Toe',        icon: '❌', category: 'logic',   description: 'Beat the unbeatable bot as many times as you can',component: TicTacToeGame,  isNew: true },
  { id: 'chessMemory', label: 'Chess Memory',        icon: '♟️', category: 'memory',  description: 'Memorise piece positions then place them back',   component: ChessMemoryGame, isNew: true },
];

const CATEGORIES = [
  { id: 'all', label: 'All', icon: '🎮' },
  { id: 'rapid', label: 'Speed Math', icon: '⚡' },
  { id: 'memory', label: 'Memory', icon: '🧠' },
  { id: 'logic', label: 'Logic', icon: '🧩' },
  { id: 'spatial', label: 'Spatial', icon: '🟦' },
];

export default function WarmupView() {
  const { user, userData, refreshUserData } = useAuth();

  const [phase, setPhase] = useState<GamePhase>('hub');
  const [category, setCategory] = useState<string>('all');
  const [selectedGame, setSelectedGame] = useState<GameConfig | null>(null);
  const [selectedMode, setSelectedMode] = useState<GameMode | null>(null);
  const [multiSession, setMultiSession] = useState<GameSession | null>(null);
  const [soloScore, setSoloScore] = useState<number>(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);

  const { activeSession, setActiveSession, pendingSession, setPendingSession } = useSession();
  const highScores = userData?.high_scores ?? {};
  const filtered = category === 'all' ? GAMES : GAMES.filter(g => g.category === category);

  useEffect(() => {
    if (pendingSession) {
      const game = GAMES.find(g => g.id === pendingSession.gameId);
      if (game) {
        setSelectedGame(game);
        setMultiSession(pendingSession.session);
        setSelectedMode('friend');
        setPhase('playing_multi');
        setPendingSession(null);
      }
    }
  }, [pendingSession]);

  function selectGame(game: GameConfig) {
    setSelectedGame(game);
    setPhase('mode_picker');
  }

  async function selectMode(mode: GameMode) {
    if (!selectedGame) return;
    setSelectedMode(mode);
    if (mode === 'solo') {
      setPhase('playing_solo');
    } else if (mode === 'ranked') {
      setPhase('matchmaking');
    } else {
      setPhase('friend_challenge');
    }
  }

  async function handleSoloGameOver(score: number) {
    if (!user || !userData || !selectedGame) return;
    setSoloScore(score);

    const [{ newBest, rank }, lb] = await Promise.all([
      submitScore(selectedGame.id, user.uid, userData.username || 'Player', score),
      getLeaderboard(selectedGame.id)
    ]);
    setLeaderboard(lb);
    setMyRank(rank);
    setIsNewBest(newBest);

    const prev = highScores[selectedGame.id] ?? 0;
    if (score > prev) {
      await updateHighScore(user.uid, selectedGame.id, score);
      await refreshUserData();
    }
    setPhase('solo_result');
  }

  function backToHub() {
    setPhase('hub');
    setSelectedGame(null);
    setSelectedMode(null);
    setMultiSession(null);
  }

  // ── Solo Result Screen ────────────────────────────────────────────────────
  if (phase === 'solo_result' && selectedGame) {
    const best = highScores[selectedGame.id] ?? 0;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }}>
        <div style={{ fontSize: 56 }}>{isNewBest ? '🏆' : selectedGame.icon}</div>
        <div style={{ textAlign: 'center' }}>
          {isNewBest && <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 13, marginBottom: 4, letterSpacing: 1 }}>NEW BEST!</div>}
          <div style={{ fontSize: 48, fontWeight: 'bold', color: 'white' }}>{soloScore}</div>
          <div style={{ color: '#64748b', fontSize: 14 }}>{selectedGame.label}</div>
        </div>

        {/* Top 5 leaderboard */}
        <div style={{ background: '#1e293b', borderRadius: 16, padding: '16px 20px', width: '100%', maxWidth: 340, border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: 12, fontWeight: 'bold', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
            🏆 Top 5 — {selectedGame.label}
          </div>
          {leaderboard.length === 0 ? (
            <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>No scores yet</div>
          ) : (
            leaderboard.map((entry, i) => {
              const isMe = entry.uid === user?.uid;
              return (
                <div key={entry.uid} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                  borderBottom: i < leaderboard.length - 1 ? '1px solid #334155' : 'none',
                  background: isMe ? 'rgba(59,130,246,0.08)' : 'transparent',
                  borderRadius: isMe ? 8 : 0, paddingLeft: isMe ? 8 : 0
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold',
                    background: i === 0 ? 'rgba(251,191,36,0.2)' : i === 1 ? 'rgba(148,163,184,0.2)' : i === 2 ? 'rgba(180,83,9,0.2)' : '#1e293b',
                    color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : '#64748b',
                    border: `1px solid ${i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : '#334155'}`
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, color: isMe ? 'white' : '#94a3b8', fontWeight: isMe ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.username} {isMe && '(you)'}
                  </div>
                  <div style={{ fontWeight: 'bold', color: isMe ? '#fbbf24' : '#64748b', fontSize: 14, flexShrink: 0 }}>
                    {entry.score}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 340 }}>
          <button onClick={() => setPhase('playing_solo')} className="ll-btn" style={{ flex: 1 }}>Play Again</button>
          <button onClick={backToHub} className="ll-btn ll-btn-primary" style={{ flex: 1 }}>Back to Hub</button>
        </div>
      </div>
    );
  }

  // ── Multiplayer flows ────────────────────────────────────────────────────
  if (phase === 'matchmaking' && selectedGame) {
    return (
      <MatchmakingScreen
        gameId={selectedGame.id}
        gameLabel={selectedGame.label}
        onMatched={session => { setMultiSession(session); setPhase('playing_multi'); }}
        onCancel={backToHub}
      />
    );
  }

  if (phase === 'friend_challenge' && selectedGame) {
    return (
      <FriendChallengeModal
        gameId={selectedGame.id}
        gameLabel={selectedGame.label}
        onSessionReady={session => { setMultiSession(session); setPhase('playing_multi'); }}
        onCancel={backToHub}
      />
    );
  }

  if (phase === 'playing_multi' && selectedGame && multiSession) {
    return (
      <MultiplayerGame
        session={multiSession}
        game={selectedGame}
        onLeave={backToHub}
      />
    );
  }

  // ── Mode picker ──────────────────────────────────────────────────────────
  if (phase === 'mode_picker' && selectedGame) {
    return (
      <ModePicker
        game={selectedGame}
        onSelect={selectMode}
        onBack={backToHub}
      />
    );
  }

  // ── Solo playing ─────────────────────────────────────────────────────────
  if (phase === 'playing_solo' && selectedGame) {
    const GameComp = selectedGame.component;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '10px 16px', background: 'rgba(0,0,0,0.5)',
          borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0
        }}>
          <button onClick={backToHub} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>← Back</button>
          <span style={{ fontWeight: 'bold', fontSize: 14, color: 'white' }}>{selectedGame.icon} {selectedGame.label}</span>
          <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11, background: '#1e293b', padding: '3px 8px', borderRadius: 6, border: '1px solid #334155' }}>
            🎯 Solo Practice
          </span>
          {(highScores[selectedGame.id] ?? 0) > 0 && (
            <span style={{ color: '#fbbf24', fontSize: 12 }}>🏆 {highScores[selectedGame.id]}</span>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GameComp gameId={selectedGame.id} mode="solo" onGameOver={handleSoloGameOver} />
        </div>
      </div>
    );
  }

  // ── Hub ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 28px' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ color: 'white', margin: '0 0 3px', fontSize: 20 }}>⚡ Warmup Games</h2>
        <p style={{ color: '#64748b', margin: 0, fontSize: 12 }}>{GAMES.length} games · Solo, Ranked, or Play a Friend</p>
      </div>

      {/* Ongoing session banner */}
      {activeSession && (
        <div
          onClick={() => {
            const game = GAMES.find(g => g.id === activeSession.gameId);
            if (game) { setSelectedGame(game); setPhase('playing_multi'); }
          }}
          style={{
            background: 'rgba(249,115,22,0.1)', border: '1.5px solid #f97316', borderRadius: 12,
            padding: '10px 16px', marginBottom: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10
          }}
        >
          <div style={{ fontSize: 18 }}>⚔️</div>
          <div style={{ flex: 1 }}>
            <div style={{ color: '#f97316', fontWeight: 'bold', fontSize: 13 }}>Match in Progress</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>Tap to rejoin · {activeSession.gameLabel}</div>
          </div>
          <div style={{ color: '#f97316', fontSize: 18 }}>→</div>
        </div>
      )}

      {/* Category filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 12, fontFamily: 'inherit',
              border: `2px solid ${category === cat.id ? '#3b82f6' : '#334155'}`,
              background: category === cat.id ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: category === cat.id ? '#93c5fd' : '#64748b',
              cursor: 'pointer', fontWeight: 'bold', transition: '0.2s'
            }}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Game grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))', gap: 10 }}>
        {filtered.map(game => {
          const best = highScores[game.id] ?? 0;
          return (
            <div
              key={game.id}
              onClick={() => selectGame(game)}
              style={{
                background: '#1e293b', borderRadius: 14, padding: '15px 12px 12px',
                border: '1px solid #334155', cursor: 'pointer', textAlign: 'center',
                transition: 'all 0.2s', position: 'relative', overflow: 'hidden'
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = 'translateY(-3px)';
                el.style.borderColor = '#3b82f6';
                el.style.boxShadow = '0 6px 20px rgba(59,130,246,0.18)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = '';
                el.style.borderColor = '#334155';
                el.style.boxShadow = '';
              }}
            >
              {game.isNew && (
                <div style={{
                  position: 'absolute', top: 7, left: 7,
                  background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)',
                  borderRadius: 4, padding: '1px 5px', fontSize: 8, color: '#10b981', fontWeight: 'bold'
                }}>NEW</div>
              )}
              <div style={{
                position: 'absolute', top: 7, right: 7,
                background: 'rgba(30,41,59,0.8)', borderRadius: 4, padding: '2px 6px',
                fontSize: 9, color: '#475569', fontWeight: 'bold', textTransform: 'capitalize'
              }}>
                {game.category}
              </div>
              <div style={{ fontSize: 32, marginBottom: 7, marginTop: 4 }}>{game.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: 'white', marginBottom: 4, lineHeight: 1.3 }}>{game.label}</div>
              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, marginBottom: best > 0 ? 7 : 0 }}>{game.description}</div>
              {best > 0 && (
                <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 'bold' }}>🏆 {best}</div>
              )}
              {/* Mode indicator */}
              <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 8 }}>
                {['🎯', '⚔️', '👥'].map((icon, i) => (
                  <div key={i} style={{ fontSize: 9, opacity: 0.5 }}>{icon}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
