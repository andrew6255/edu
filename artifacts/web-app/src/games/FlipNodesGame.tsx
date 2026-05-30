import { useState } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

const SIZE = 5;

function makeGrid(difficulty = 1): boolean[][] {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const moves = 5 + difficulty * 2;
  for (let m = 0; m < moves; m++) {
    const r = Math.floor(Math.random() * SIZE);
    const c = Math.floor(Math.random() * SIZE);
    flip(grid, r, c);
  }
  return grid;
}

function flip(grid: boolean[][], r: number, c: number) {
  const dirs = [[0,0],[0,1],[0,-1],[1,0],[-1,0]];
  dirs.forEach(([dr, dc]) => {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) {
      grid[nr][nc] = !grid[nr][nc];
    }
  });
}

export default function FlipNodesGame({ onGameOver }: GameProps) {
  const [difficulty, setDifficulty] = useState(1);
  const [grid, setGrid] = useState<boolean[][]>(() => makeGrid(1));
  const [moves, setMoves] = useState(0);
  const [solved, setSolved] = useState(false);
  const [started, setStarted] = useState(false);
  const [level, setLevel] = useState(1);

  function handleFlip(r: number, c: number) {
    if (solved) return;
    const newGrid = grid.map(row => [...row]);
    flip(newGrid, r, c);
    const allOn = newGrid.every(row => row.every(c => c));
    setGrid(newGrid);
    setMoves(m => m + 1);
    if (allOn) {
      setSolved(true);
      const bonus = Math.max(0, 200 - moves * 10);
      const score = bonus + level * 100;
      if (level < 5) {
        setTimeout(() => {
          setLevel(l => l + 1);
          setGrid(makeGrid(level + 1));
          setMoves(0);
          setSolved(false);
        }, 1200);
      } else {
        setTimeout(() => onGameOver(score), 1200);
      }
    }
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>⬡</div>
        <h2 style={{ margin: 0, fontSize: 28, color: 'white' }}>Flip Nodes</h2>
        <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          Tap a cell to flip it and its <strong style={{ color: '#f8fafc' }}>4 neighbours</strong>. Turn all cells ON to solve the puzzle!
        </p>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '16px 50px' }} onClick={() => setStarted(true)}>
          START
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 15, padding: 25 }}>
      <div style={{ display: 'flex', gap: 25, fontSize: 15 }}>
        <span style={{ color: '#3b82f6' }}>Level: {level}/5</span>
        <span style={{ color: '#94a3b8' }}>Moves: {moves}</span>
      </div>

      {solved && (
        <div style={{ color: '#10b981', fontSize: 18, fontWeight: 'bold', animation: 'fadeIn 0.3s ease' }}>
          ✅ Level {level} Solved!
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${SIZE}, 1fr)`, gap: 8 }}>
        {grid.map((row, ri) => row.map((cell, ci) => (
          <div
            key={`${ri}-${ci}`}
            onClick={() => handleFlip(ri, ci)}
            style={{
              width: 56, height: 56, borderRadius: 10, cursor: 'pointer',
              background: cell ? 'rgba(59,130,246,0.8)' : 'rgba(255,255,255,0.04)',
              border: `2px solid ${cell ? '#3b82f6' : '#334155'}`,
              transition: 'all 0.15s',
              boxShadow: cell ? '0 0 15px rgba(59,130,246,0.5)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: cell ? 'white' : '#475569'
            }}
          >
            {cell ? '●' : '○'}
          </div>
        )))}
      </div>
      <p style={{ color: '#64748b', fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
        Goal: turn all cells ON (blue)
      </p>
    </div>
  );
}
