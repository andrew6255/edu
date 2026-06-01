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
import { NameSquareGame, FindSquareGame } from '@/games/ChessSquareGame';

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
  supportsVariants?: boolean;
}

const GAMES: GameConfig[] = [
  { id: 'quickMath',    label: 'Quick Math',         icon: '🧮', category: 'rapid',   description: 'Choose 10s or 60s mode',   component: QuickMathGame, supportsVariants: true },
  { id: 'advQuickMath', label: 'Advanced Math',      icon: '⚡', category: 'rapid',   description: 'Choose 10s or 60s mode',   component: QuickMathGame, supportsVariants: true },
  { id: 'trueFalse',    label: 'True or False',      icon: '✅', category: 'rapid',   description: 'Choose 10s or 60s mode',   component: TrueFalseGame, supportsVariants: true },
  { id: 'compareExp',   label: 'Compare Expressions',icon: '⚖️', category: 'rapid',   description: 'Choose 10s or 60s mode',   component: CompareExpGame, supportsVariants: true },
  { id: 'missingOp',    label: 'Missing Operator',   icon: '🔣', category: 'rapid',   description: 'Choose 10s or 60s mode',   component: MissingOpGame, supportsVariants: true },
  { id: 'completeEq',   label: 'Complete Equation',  icon: '📝', category: 'rapid',   description: 'Choose 10s or 60s mode',   component: CompleteEqGame, supportsVariants: true },
  { id: 'sequence',     label: 'Sequence',           icon: '🔗', category: 'rapid',   description: 'Choose 10s or 60s mode',   component: SequenceGame, supportsVariants: true },
  { id: 'memoCells',    label: 'Memo Cells',         icon: '🧠', category: 'memory',  description: 'Memorize flashing cells, then recall them',      component: MemoCellsGame },
  { id: 'memoOrder',    label: 'Memo Order',         icon: '🔢', category: 'memory',  description: 'Tap numbers in the order they appeared',        component: MemoOrderGame },
  { id: 'pyramid',      label: 'Number Pyramid',     icon: '△',  category: 'rapid',   description: 'Fill in the pyramid using addition',            component: PyramidGame },
  { id: 'flipNodes',    label: 'Flip Nodes',         icon: '⬡',  category: 'logic',   description: 'Solve the parity flipping puzzle',              component: FlipNodesGame },
  { id: 'blockPuzzle',  label: 'Block Blast',        icon: '🟦', category: 'spatial', description: 'Drag blocks to fill rows & columns',           component: BlockPuzzleGame },
  { id: 'fifteenPuzzle',label: '15 Puzzle',          icon: '🔀', category: 'spatial', description: 'Slide tiles to sort 1–15 in order',             component: FifteenGame },
  { id: 'neonGrid',     label: 'Neon Grid',          icon: '💡', category: 'spatial', description: 'Copy the glowing pattern by toggling cells',      component: NeonGridGame },
  { id: 'flipCup',      label: 'Flip Cup',           icon: '🥤', category: 'logic',   description: 'Tap to flip cups and neighbors — all upright!',  component: FlipCupGame },
  { id: 'ticTacToe',   label: 'Tic Tac Toe',        icon: '❌', category: 'logic',   description: 'Beat the unbeatable bot as many times as you can',component: TicTacToeGame },
  { id: 'chessMemory',   label: 'Chess Memory',          icon: '♟️', category: 'memory',  description: 'Memorise piece positions then place them back',      component: ChessMemoryGame },
  { id: 'nameSquare',    label: 'Name Square',            icon: '♜', category: 'memory',  description: 'Choose 10s or 60s mode',                             component: NameSquareGame, supportsVariants: true },
  { id: 'findSquare',    label: 'Find Square',            icon: '♞', category: 'memory',  description: 'Choose 10s or 60s mode',                             component: FindSquareGame, supportsVariants: true },
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
  const [selectedVariant, setSelectedVariant] = useState<'10s' | '60s'>('10s');
  const [selectedMode, setSelectedMode] = useState<GameMode | null>(null);
  const [multiSession, setMultiSession] = useState<GameSession | null>(null);
  const [soloScore, setSoloScore] = useState<number>(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);

  const { activeSession, setActiveSession, pendingSession, setPendingSession, ongoingWarmup, setOngoingWarmup } = useSession();
  const highScores = userData?.high_scores ?? {};
  const filtered = category === 'all' ? GAMES : GAMES.filter(g => g.category === category);

  const effectiveGameId = selectedGame
    ? selectedGame.supportsVariants
      ? `${selectedGame.id}_${selectedVariant}`
      : selectedGame.id
    : null;

  useEffect(() => {
    if (phase === 'playing_solo' && selectedGame && effectiveGameId) {
      setOngoingWarmup({ kind: 'solo', gameId: effectiveGameId, gameLabel: selectedGame.label });
      return;
    }
    if (phase === 'playing_multi' && selectedGame && effectiveGameId) {
      setOngoingWarmup({ kind: 'multi', gameId: effectiveGameId, gameLabel: selectedGame.label });
      return;
    }
    setOngoingWarmup(null);
  }, [phase, selectedGame, effectiveGameId]);

  useEffect(() => {
    if (pendingSession) {
      const baseId = pendingSession.gameId.replace(/_(10s|60s)$/i, '');
      const game = GAMES.find(g => g.id === baseId);
      if (game) {
        setSelectedGame(game);
        setSelectedVariant(pendingSession.gameId.endsWith('_60s') ? '60s' : '10s');
        setMultiSession(pendingSession.session);
        setSelectedMode('friend');
        setPhase('playing_multi');
        setPendingSession(null);
      }
    }
  }, [pendingSession]);

  function selectGame(game: GameConfig) {
    if (activeSession || ongoingWarmup) return;
    setSelectedGame(game);
    setSelectedVariant('10s');
    setPhase('mode_picker');
  }

  async function selectMode(mode: GameMode) {
    if (!selectedGame) return;
    if (activeSession || ongoingWarmup) return;
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
    if (!user || !userData || !selectedGame || !effectiveGameId) return;
    setSoloScore(score);

    const [{ newBest, rank }, lb] = await Promise.all([
      submitScore(effectiveGameId, user.uid, userData.username || 'Player', score),
      getLeaderboard(effectiveGameId)
    ]);
    setLeaderboard(lb);
    setMyRank(rank);
    setIsNewBest(newBest);

    const prev = highScores[effectiveGameId] ?? 0;
    if (score > prev) {
      await updateHighScore(user.uid, effectiveGameId, score);
      await refreshUserData();
    }
    setPhase('solo_result');
  }

  function backToHub() {
    setPhase('hub');
    setSelectedGame(null);
    setSelectedMode(null);
    setMultiSession(null);
    setActiveSession(null);
    setOngoingWarmup(null);
  }

  // ── Solo Result Screen ────────────────────────────────────────────────────
  if (phase === 'solo_result' && selectedGame) {
    const best = effectiveGameId ? (highScores[effectiveGameId] ?? 0) : 0;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, background: 'var(--ll-surface-0)', color: 'var(--ll-text)' }}>
        <div style={{ fontSize: 56 }}>{isNewBest ? '🏆' : selectedGame.icon}</div>
        <div style={{ textAlign: 'center' }}>
          {isNewBest && <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 13, marginBottom: 4, letterSpacing: 1 }}>NEW BEST!</div>}
          <div style={{ fontSize: 48, fontWeight: 'bold', color: 'var(--ll-text)' }}>{soloScore}</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 14 }}>{selectedGame.label}</div>
        </div>

        {/* Top 5 leaderboard */}
        <div style={{ background: 'var(--ll-surface-1)', borderRadius: 16, padding: '16px 20px', width: '100%', maxWidth: 340, border: '1px solid var(--ll-border)' }}>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 12, fontWeight: 'bold', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
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
                  borderBottom: i < leaderboard.length - 1 ? '1px solid var(--ll-border)' : 'none',
                  background: isMe ? 'rgba(59,130,246,0.08)' : 'transparent',
                  borderRadius: isMe ? 8 : 0, paddingLeft: isMe ? 8 : 0
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold',
                    background: i === 0 ? 'rgba(251,191,36,0.2)' : i === 1 ? 'rgba(148,163,184,0.2)' : i === 2 ? 'rgba(180,83,9,0.2)' : 'var(--ll-surface-2)',
                    color: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--ll-text-muted)',
                    border: `1px solid ${i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'var(--ll-border)'}`
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, color: isMe ? 'var(--ll-text)' : 'var(--ll-text-soft)', fontWeight: isMe ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.username} {isMe && '(you)'}
                  </div>
                  <div style={{ fontWeight: 'bold', color: isMe ? '#fbbf24' : 'var(--ll-text-muted)', fontSize: 14, flexShrink: 0 }}>
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
    if (!effectiveGameId) return null;
    return (
      <MatchmakingScreen
        gameId={effectiveGameId}
        gameLabel={selectedGame.label}
        onMatched={session => { setMultiSession(session); setPhase('playing_multi'); }}
        onCancel={backToHub}
      />
    );
  }

  if (phase === 'friend_challenge' && selectedGame) {
    if (!effectiveGameId) return null;
    return (
      <FriendChallengeModal
        gameId={effectiveGameId}
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
        game={{ ...selectedGame, id: effectiveGameId || selectedGame.id }}
        onLeave={backToHub}
      />
    );
  }

  // ── Mode picker ──────────────────────────────────────────────────────────
  if (phase === 'mode_picker' && selectedGame) {
    if (!effectiveGameId) return null;
    return (
      <ModePicker
        game={selectedGame}
        gameId={effectiveGameId}
        variant={selectedVariant}
        supportsVariants={!!selectedGame.supportsVariants}
        onVariantChange={setSelectedVariant}
        onSelect={selectMode}
        onBack={backToHub}
      />
    );
  }

  // ── Solo playing ─────────────────────────────────────────────────────────
  if (phase === 'playing_solo' && selectedGame) {
    if (!effectiveGameId) return null;
    const GameComp = selectedGame.component;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '10px 16px', background: 'var(--ll-overlay)',
          borderBottom: '1px solid var(--ll-border)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0
        }}>
          <button onClick={backToHub} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>Leave Game</button>
          <span style={{ fontWeight: 'bold', fontSize: 14, color: 'var(--ll-text)' }}>{selectedGame.icon} {selectedGame.label}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--ll-text-muted)', fontSize: 11, background: 'var(--ll-surface-1)', padding: '3px 8px', borderRadius: 6, border: '1px solid var(--ll-border)' }}>
            🎯 Solo Practice
          </span>
          {(highScores[effectiveGameId] ?? 0) > 0 && (
            <span style={{ color: '#fbbf24', fontSize: 12 }}>🏆 {highScores[effectiveGameId]}</span>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GameComp gameId={effectiveGameId} mode="solo" onGameOver={handleSoloGameOver} />
        </div>
      </div>
    );
  }

  // ── Hub ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 28px', background: 'var(--ll-surface-0)', color: 'var(--ll-text)' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ color: 'var(--ll-text)', margin: '0 0 3px', fontSize: 20 }}>⚡ Warmup Games</h2>
        <p style={{ color: 'var(--ll-text-muted)', margin: 0, fontSize: 12 }}>{GAMES.length} games · Solo, Ranked, or Play a Friend</p>
      </div>

      {/* Ongoing session banner */}
      {activeSession && (
        <div
          onClick={() => {
            const baseId = activeSession.gameId.replace(/_(10s|60s)$/i, '');
            const game = GAMES.find(g => g.id === baseId);
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
              border: `2px solid ${category === cat.id ? 'var(--ll-accent)' : 'var(--ll-border)'}`,
              background: category === cat.id ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: category === cat.id ? '#93c5fd' : 'var(--ll-text-muted)',
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
          const bestKey = game.supportsVariants ? `${game.id}_10s` : game.id;
          const best = highScores[bestKey] ?? 0;
          return (
            <div
              key={game.id}
              onClick={() => selectGame(game)}
              style={{
                background: 'var(--ll-surface-1)', borderRadius: 14, padding: '15px 12px 12px',
                border: '1px solid var(--ll-border)', cursor: 'pointer', textAlign: 'center',
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
                el.style.borderColor = 'var(--ll-border)';
                el.style.boxShadow = '';
              }}
            >
              <div style={{
                position: 'absolute', top: 7, right: 7,
                background: 'var(--ll-surface-2)', borderRadius: 4, padding: '2px 6px',
                fontSize: 9, color: 'var(--ll-text-muted)', fontWeight: 'bold', textTransform: 'capitalize'
              }}>
                {game.category}
              </div>
              <div style={{ fontSize: 32, marginBottom: 7, marginTop: 4 }}>{game.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: 'var(--ll-text)', marginBottom: 4, lineHeight: 1.3 }}>{game.label}</div>
              <div style={{ fontSize: 10, color: 'var(--ll-text-muted)', lineHeight: 1.4, marginBottom: best > 0 ? 7 : 0 }}>{game.description}</div>
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
