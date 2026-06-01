import { useState, useEffect } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

const SIZE = 4;

function shuffle(arr: number[]): number[] {
  let a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeSolvable(): number[] {
  while (true) {
    const arr = shuffle([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0]);
    if (isSolvable(arr)) return arr;
  }
}

function isSolvable(arr: number[]): boolean {
  let inv = 0;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] && arr[j] && arr[i] > arr[j]) inv++;
    }
  }
  const blankRow = Math.floor(arr.indexOf(0) / SIZE);
  const rowFromBottom = SIZE - blankRow;
  if (SIZE % 2 === 0) return (inv % 2 === 0) === (rowFromBottom % 2 !== 0);
  return inv % 2 === 0;
}

function isSolved(arr: number[]): boolean {
  return arr.every((v, i) => i === arr.length - 1 ? v === 0 : v === i + 1);
}

export default function FifteenGame({ onGameOver }: GameProps) {
  const [tiles, setTiles] = useState<number[]>(() => makeSolvable());
  const [moves, setMoves] = useState(0);
  const [started, setStarted] = useState(false);
  const [solved, setSolved] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!started || solved) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 500);
    return () => clearInterval(interval);
  }, [started, solved, startTime]);

  function handleTap(idx: number) {
    if (solved) return;
    const blank = tiles.indexOf(0);
    const r1 = Math.floor(idx / SIZE), c1 = idx % SIZE;
    const r2 = Math.floor(blank / SIZE), c2 = blank % SIZE;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;

    const newTiles = [...tiles];
    [newTiles[idx], newTiles[blank]] = [newTiles[blank], newTiles[idx]];
    setTiles(newTiles);
    setMoves(m => m + 1);

    if (isSolved(newTiles)) {
      setSolved(true);
      const time = Math.floor((Date.now() - startTime) / 1000);
      const score = Math.max(0, 1000 - moves * 5 - time * 2);
      setTimeout(() => onGameOver(score), 1000);
    }
  }

  useEffect(() => {
    if (!started) return;
    function onKey(e: KeyboardEvent) {
      const blank = tiles.indexOf(0);
      const br = Math.floor(blank / SIZE), bc = blank % SIZE;
      const dirs: Record<string, [number, number]> = {
        ArrowLeft: [0, 1], ArrowRight: [0, -1], ArrowUp: [1, 0], ArrowDown: [-1, 0]
      };
      const d = dirs[e.key];
      if (!d) return;
      const nr = br + d[0], nc = bc + d[1];
      if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) handleTap(nr * SIZE + nc);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, tiles]);

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>🔢</div>
        <h2 style={{ margin: 0, fontSize: 28, color: 'white' }}>15 Puzzle</h2>
        <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          Slide tiles to arrange them in order from 1-15. Use <strong style={{ color: '#f8fafc' }}>arrow keys</strong> or tap adjacent tiles!
        </p>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '16px 50px' }} onClick={() => { setStarted(true); setStartTime(Date.now()); }}>
          START
        </button>
      </div>
    );
  }

  const CELL = Math.min(78, (Math.min(window.innerWidth, 360) - 60) / 4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 20 }}>
      <div style={{ display: 'flex', gap: 25, fontSize: 15 }}>
        <span style={{ color: '#94a3b8' }}>Moves: <strong style={{ color: 'white' }}>{moves}</strong></span>
        <span style={{ color: '#94a3b8' }}>Time: <strong style={{ color: 'white' }}>{elapsed}s</strong></span>
      </div>

      {solved && <div style={{ color: '#10b981', fontSize: 20, fontWeight: 'bold', animation: 'fadeIn 0.3s ease' }}>🎉 Solved!</div>}

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${SIZE}, ${CELL}px)`,
        gap: 5,
        background: '#0f172a',
        padding: 8,
        borderRadius: 12,
        border: '2px solid #334155'
      }}>
        {tiles.map((tile, idx) => (
          <div
            key={idx}
            onClick={() => handleTap(idx)}
            style={{
              width: CELL, height: CELL,
              borderRadius: 8,
              background: tile === 0 ? 'transparent' : tile === idx + 1 ? 'rgba(16,185,129,0.3)' : '#1e293b',
              border: tile === 0 ? 'none' : `2px solid ${tile === idx + 1 ? '#10b981' : '#334155'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: CELL > 70 ? 22 : 18, fontWeight: 'bold', color: 'white',
              cursor: tile === 0 ? 'default' : 'pointer',
              transition: 'all 0.15s',
              userSelect: 'none'
            }}
          >
            {tile || ''}
          </div>
        ))}
      </div>

      <button className="ll-btn" style={{ fontSize: 13, padding: '8px 20px' }} onClick={() => { setTiles(makeSolvable()); setMoves(0); setSolved(false); setStartTime(Date.now()); setElapsed(0); }}>
        New Puzzle
      </button>
    </div>
  );
}
