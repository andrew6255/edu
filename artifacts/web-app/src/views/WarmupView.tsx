import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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

export type WarmupCategory = 'rapid' | 'memory' | 'spatial' | 'logic';
export type GameId = string;

export interface GameProps {
  gameId: string;
  onGameOver: (score: number) => void;
}

interface GameConfig {
  id: string;
  label: string;
  icon: string;
  category: WarmupCategory;
  description: string;
  component: React.ComponentType<GameProps>;
  isNew?: boolean;
}

const GAMES: GameConfig[] = [
  // Rapid fire
  { id: 'quickMath',    label: 'Quick Math',         icon: '🧮', category: 'rapid',   description: 'Answer math MCQs against the clock',           component: QuickMathGame },
  { id: 'advQuickMath', label: 'Advanced Math',       icon: '⚡', category: 'rapid',   description: 'Harder questions, less time, bigger rewards',   component: QuickMathGame },
  { id: 'trueFalse',    label: 'True or False',       icon: '✅', category: 'rapid',   description: 'Judge math statements in 60 seconds',          component: TrueFalseGame,  isNew: true },
  { id: 'compareExp',   label: 'Compare Expressions', icon: '⚖️', category: 'rapid',   description: 'Which expression is bigger? <, =, or >?',      component: CompareExpGame, isNew: true },
  { id: 'missingOp',    label: 'Missing Operator',    icon: '🔣', category: 'rapid',   description: 'Find the missing +, −, ×, or ÷ operator',      component: MissingOpGame,  isNew: true },
  { id: 'completeEq',   label: 'Complete Equation',   icon: '📝', category: 'rapid',   description: 'Fill in the blank to complete the equation',   component: CompleteEqGame, isNew: true },

  // Memory
  { id: 'memoCells',    label: 'Memo Cells',          icon: '🧠', category: 'memory',  description: 'Memorize flashing cells and recall them',      component: MemoCellsGame,  isNew: true },
  { id: 'memoOrder',    label: 'Memo Order',          icon: '🔢', category: 'memory',  description: 'Tap numbers in the order they appeared',       component: MemoOrderGame,  isNew: true },
  { id: 'sequence',     label: 'Sequence',            icon: '🔗', category: 'memory',  description: 'Complete the number pattern',                  component: SequenceGame },

  // Logic
  { id: 'pyramid',      label: 'Number Pyramid',      icon: '△',  category: 'logic',   description: 'Fill in the pyramid using number addition',    component: PyramidGame },
  { id: 'flipNodes',    label: 'Flip Nodes',          icon: '⬡',  category: 'logic',   description: 'Solve the parity flipping puzzle',             component: FlipNodesGame },

  // Spatial
  { id: 'blockPuzzle',  label: 'Block Puzzle',        icon: '🟦', category: 'spatial', description: 'Drop tetrominoes and clear the grid',          component: BlockPuzzleGame },
  { id: 'fifteenPuzzle',label: '15 Puzzle',           icon: '🔀', category: 'spatial', description: 'Slide tiles to sort 1–15 in order',            component: FifteenGame },
];

const CATEGORIES = [
  { id: 'all',     label: 'All Games', icon: '🎮' },
  { id: 'rapid',   label: 'Rapid Fire', icon: '⚡' },
  { id: 'memory',  label: 'Memory',    icon: '🧠' },
  { id: 'logic',   label: 'Logic',     icon: '🧩' },
  { id: 'spatial', label: 'Spatial',   icon: '🟦' },
];

export default function WarmupView() {
  const { userData, refreshUserData } = useAuth();
  const [category, setCategory] = useState<string>('all');
  const [activeGame, setActiveGame] = useState<GameConfig | null>(null);
  const [lastScore, setLastScore] = useState<{ score: number; label: string; newBest: boolean } | null>(null);

  const filtered = category === 'all' ? GAMES : GAMES.filter(g => g.category === category);
  const highScores = userData?.high_scores ?? {};

  function handleGameOver(gameId: string, score: number) {
    const current = highScores[gameId] ?? 0;
    const newBest = score > current;
    setLastScore({ score, label: activeGame?.label ?? '', newBest });
    setActiveGame(null);
    if (newBest) {
      import('@/lib/firebase').then(({ auth }) => {
        import('@/lib/userService').then(({ updateHighScore }) => {
          if (auth.currentUser) updateHighScore(auth.currentUser.uid, gameId, score).then(refreshUserData);
        });
      });
    }
  }

  if (activeGame) {
    const GameComp = activeGame.component;
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          padding: '10px 16px', background: 'rgba(0,0,0,0.6)',
          borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0
        }}>
          <button onClick={() => setActiveGame(null)} className="ll-btn" style={{ padding: '7px 14px', fontSize: 13 }}>← Back</button>
          <span style={{ fontWeight: 'bold', fontSize: 15 }}>{activeGame.icon} {activeGame.label}</span>
          {highScores[activeGame.id] > 0 && (
            <span style={{ marginLeft: 'auto', color: '#fbbf24', fontSize: 13 }}>🏆 Best: {highScores[activeGame.id]}</span>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GameComp gameId={activeGame.id} onGameOver={(score) => handleGameOver(activeGame.id, score)} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 28px' }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ color: 'white', margin: '0 0 4px', fontSize: 22 }}>⚡ Warmup Games</h2>
        <p style={{ color: '#64748b', margin: 0, fontSize: 13 }}>{GAMES.length} games • Sharpen your mind before diving in</p>
      </div>

      {lastScore && (
        <div style={{
          background: lastScore.newBest ? 'rgba(251,191,36,0.1)' : 'rgba(16,185,129,0.08)',
          border: `1px solid ${lastScore.newBest ? '#fbbf24' : '#10b981'}`,
          borderRadius: 10, padding: '10px 16px', marginBottom: 16,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          animation: 'slideUp 0.3s ease'
        }}>
          <span style={{ color: lastScore.newBest ? '#fbbf24' : '#10b981', fontWeight: 'bold', fontSize: 14 }}>
            {lastScore.newBest ? '🏆 New Best! ' : '✅ '}
            {lastScore.label}: <strong>{lastScore.score}</strong>
          </span>
          <button onClick={() => setLastScore(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      )}

      {/* Category filters */}
      <div style={{ display: 'flex', gap: 7, marginBottom: 18, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 13, fontFamily: 'inherit',
              border: `2px solid ${category === cat.id ? '#3b82f6' : '#334155'}`,
              background: category === cat.id ? 'rgba(59,130,246,0.18)' : 'transparent',
              color: category === cat.id ? '#93c5fd' : '#64748b',
              cursor: 'pointer', fontWeight: 'bold', transition: '0.2s'
            }}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Game grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {filtered.map(game => {
          const best = highScores[game.id] ?? 0;
          return (
            <div
              key={game.id}
              onClick={() => setActiveGame(game)}
              style={{
                background: '#1e293b', borderRadius: 14, padding: '16px 12px',
                border: '1px solid #334155', cursor: 'pointer', textAlign: 'center',
                transition: 'all 0.2s', position: 'relative', overflow: 'hidden'
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = 'translateY(-3px)';
                el.style.borderColor = '#3b82f6';
                el.style.boxShadow = '0 6px 20px rgba(59,130,246,0.2)';
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
                  position: 'absolute', top: 8, left: 8,
                  background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)',
                  borderRadius: 5, padding: '1px 6px', fontSize: 9, color: '#10b981', fontWeight: 'bold'
                }}>NEW</div>
              )}
              <div style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(59,130,246,0.12)', borderRadius: 5, padding: '2px 7px',
                fontSize: 10, color: '#64748b', fontWeight: 'bold', textTransform: 'capitalize'
              }}>
                {game.category}
              </div>
              <div style={{ fontSize: 34, marginBottom: 8, marginTop: 6 }}>{game.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 'bold', color: 'white', marginBottom: 5, lineHeight: 1.3 }}>{game.label}</div>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4, marginBottom: best > 0 ? 8 : 0 }}>{game.description}</div>
              {best > 0 && (
                <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 'bold' }}>🏆 {best}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
