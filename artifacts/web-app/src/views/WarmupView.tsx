import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import QuickMathGame from '@/games/QuickMathGame';
import PyramidGame from '@/games/PyramidGame';
import BlockPuzzleGame from '@/games/BlockPuzzleGame';
import FlipNodesGame from '@/games/FlipNodesGame';
import FifteenGame from '@/games/FifteenGame';
import SequenceGame from '@/games/SequenceGame';

export type WarmupCategory = 'rapid' | 'memory' | 'spatial' | 'logic' | 'chess';
export type GameId = string;

interface GameConfig {
  id: string;
  label: string;
  icon: string;
  category: WarmupCategory;
  description: string;
  component: React.ComponentType<GameProps>;
}

export interface GameProps {
  gameId: string;
  onGameOver: (score: number) => void;
}

const GAMES: GameConfig[] = [
  { id: 'quickMath', label: 'Quick Math', icon: '🧮', category: 'rapid', description: 'Answer math MCQs as fast as possible', component: QuickMathGame },
  { id: 'advQuickMath', label: 'Advanced Math', icon: '⚡', category: 'rapid', description: 'Harder math questions, less time', component: QuickMathGame },
  { id: 'pyramid', label: 'Number Pyramid', icon: '△', category: 'logic', description: 'Fill in the pyramid of numbers', component: PyramidGame },
  { id: 'blockPuzzle', label: 'Block Puzzle', icon: '🟦', category: 'spatial', description: 'Drop tetrominoes to fill the grid', component: BlockPuzzleGame },
  { id: 'flipNodes', label: 'Flip Nodes', icon: '⬡', category: 'logic', description: 'Parity flipping puzzle', component: FlipNodesGame },
  { id: 'fifteenPuzzle', label: '15 Puzzle', icon: '🔢', category: 'spatial', description: 'Classic sliding tile puzzle', component: FifteenGame },
  { id: 'sequence', label: 'Sequence', icon: '🔗', category: 'memory', description: 'Complete the number pattern', component: SequenceGame },
];

const CATEGORIES = [
  { id: 'all', label: 'All Games', icon: '🎮' },
  { id: 'rapid', label: 'Rapid Fire', icon: '⚡' },
  { id: 'logic', label: 'Logic', icon: '🧩' },
  { id: 'spatial', label: 'Spatial', icon: '🟦' },
  { id: 'memory', label: 'Memory', icon: '🧠' },
];

export default function WarmupView() {
  const { userData, refreshUserData } = useAuth();
  const [category, setCategory] = useState<string>('all');
  const [activeGame, setActiveGame] = useState<GameConfig | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);

  const filtered = category === 'all' ? GAMES : GAMES.filter(g => g.category === category);
  const highScores = userData?.high_scores ?? {};

  function handleGameOver(gameId: string, score: number) {
    setLastScore(score);
    setActiveGame(null);
    const current = highScores[gameId] ?? 0;
    if (score > current) {
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
          padding: '12px 20px', background: 'rgba(0,0,0,0.5)',
          borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 10
        }}>
          <button
            onClick={() => { setActiveGame(null); }}
            className="ll-btn"
            style={{ padding: '7px 14px', fontSize: 13 }}
          >
            ← Back
          </button>
          <span style={{ fontWeight: 'bold', fontSize: 16 }}>{activeGame.icon} {activeGame.label}</span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <GameComp gameId={activeGame.id} onGameOver={(score) => handleGameOver(activeGame.id, score)} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, paddingBottom: 30 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ color: 'white', margin: '0 0 5px', fontSize: 24 }}>⚡ Warmup Games</h2>
        <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>Sharpen your mind with quick challenges</p>
      </div>

      {lastScore !== null && (
        <div style={{
          background: 'rgba(16,185,129,0.1)', border: '1px solid #10b981',
          borderRadius: 12, padding: '12px 20px', marginBottom: 20,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          animation: 'slideUp 0.3s ease'
        }}>
          <span style={{ color: '#10b981', fontWeight: 'bold' }}>✅ Game over! Score: <strong>{lastScore}</strong></span>
          <button onClick={() => setLastScore(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
      )}

      {/* Category pills */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            style={{
              padding: '7px 16px', borderRadius: 20,
              border: `2px solid ${category === cat.id ? '#3b82f6' : '#334155'}`,
              background: category === cat.id ? 'rgba(59,130,246,0.2)' : 'transparent',
              color: category === cat.id ? '#93c5fd' : '#64748b',
              cursor: 'pointer', fontWeight: 'bold', fontSize: 13,
              fontFamily: 'inherit', transition: '0.2s'
            }}
          >
            {cat.icon} {cat.label}
          </button>
        ))}
      </div>

      {/* Game cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        {filtered.map(game => {
          const best = highScores[game.id] ?? 0;
          return (
            <div
              key={game.id}
              onClick={() => setActiveGame(game)}
              style={{
                background: '#1e293b', borderRadius: 14, padding: '18px 14px',
                border: '1px solid #334155', cursor: 'pointer', textAlign: 'center',
                transition: 'all 0.25s', position: 'relative', overflow: 'hidden'
              }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = 'translateY(-4px)';
                el.style.borderColor = '#3b82f6';
                el.style.boxShadow = '0 8px 25px rgba(59,130,246,0.25)';
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = '';
                el.style.borderColor = '#334155';
                el.style.boxShadow = '';
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>{game.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 'bold', color: 'white', marginBottom: 5 }}>{game.label}</div>
              <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4, marginBottom: 10 }}>{game.description}</div>
              {best > 0 && (
                <div style={{ fontSize: 12, color: '#fbbf24', fontWeight: 'bold' }}>
                  🏆 Best: {best}
                </div>
              )}
              <div style={{
                position: 'absolute', top: 8, right: 8,
                background: 'rgba(59,130,246,0.15)', borderRadius: 6, padding: '2px 7px',
                fontSize: 11, color: '#93c5fd', fontWeight: 'bold'
              }}>
                {game.category}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
