import { useState, useEffect, useCallback, useRef } from 'react';
import { GameProps } from '@/views/WarmupView';

const COLS = 7;
const ROWS = 12;
const CELL = 38;

const TETROMINOES = [
  { cells: [[0,0],[1,0],[0,1],[1,1]], color: '#fbbf24' }, // O
  { cells: [[0,0],[1,0],[2,0],[3,0]], color: '#3b82f6' }, // I
  { cells: [[0,0],[1,0],[2,0],[1,1]], color: '#8b5cf6' }, // T
  { cells: [[0,0],[1,0],[1,1],[2,1]], color: '#10b981' }, // S
  { cells: [[1,0],[2,0],[0,1],[1,1]], color: '#ef4444' }, // Z
  { cells: [[0,0],[0,1],[1,1],[2,1]], color: '#f97316' }, // J
  { cells: [[2,0],[0,1],[1,1],[2,1]], color: '#06b6d4' }, // L
];

type Board = (string | null)[][];
type Piece = { cells: number[][]; color: string; x: number; y: number };

function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function randomPiece(): Piece {
  const t = TETROMINOES[Math.floor(Math.random() * TETROMINOES.length)];
  return { ...t, cells: t.cells.map(c => [...c]), x: Math.floor(COLS / 2) - 1, y: 0 };
}

function collision(board: Board, piece: Piece, dx=0, dy=0): boolean {
  return piece.cells.some(([cx, cy]) => {
    const nx = piece.x + cx + dx;
    const ny = piece.y + cy + dy;
    return nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && board[ny][nx]);
  });
}

function merge(board: Board, piece: Piece): Board {
  const nb = board.map(r => [...r]);
  piece.cells.forEach(([cx, cy]) => {
    const nx = piece.x + cx;
    const ny = piece.y + cy;
    if (ny >= 0) nb[ny][nx] = piece.color;
  });
  return nb;
}

function clearLines(board: Board): [Board, number] {
  const kept = board.filter(row => row.some(c => !c));
  const cleared = ROWS - kept.length;
  const nb = [...Array.from({ length: cleared }, () => Array(COLS).fill(null)), ...kept];
  return [nb, cleared];
}

export default function BlockPuzzleGame({ onGameOver }: GameProps) {
  const [board, setBoard] = useState<Board>(emptyBoard());
  const [piece, setPiece] = useState<Piece>(randomPiece());
  const [next, setNext] = useState<Piece>(randomPiece());
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [lines, setLines] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const drop = useCallback(() => {
    setBoard(b => {
      setPiece(p => {
        if (!collision(b, p, 0, 1)) return { ...p, y: p.y + 1 };
        const nb = merge(b, p);
        const [cleared, linesCleared] = clearLines(nb);
        if (linesCleared > 0) {
          setScore(s => s + linesCleared * linesCleared * 100 * level);
          setLines(l => {
            const nl = l + linesCleared;
            setLevel(Math.floor(nl / 5) + 1);
            return nl;
          });
          setBoard(cleared);
          return next;
        }
        if (p.y <= 0) {
          setOver(true);
          setBoard(nb);
          return p;
        }
        setBoard(nb);
        return next;
      });
      setNext(randomPiece());
      return b;
    });
  }, [next, level]);

  useEffect(() => {
    if (!started || over) return;
    const ms = Math.max(100, 600 - (level - 1) * 60);
    tick.current = setInterval(drop, ms);
    return () => { if (tick.current) clearInterval(tick.current); };
  }, [started, over, drop, level]);

  useEffect(() => {
    if (!started || over) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') setPiece(p => collision(board, p, -1, 0) ? p : { ...p, x: p.x - 1 });
      if (e.key === 'ArrowRight') setPiece(p => collision(board, p, 1, 0) ? p : { ...p, x: p.x + 1 });
      if (e.key === 'ArrowDown') drop();
      if (e.key === 'ArrowUp') {
        setPiece(p => {
          const rot = { ...p, cells: p.cells.map(([cx, cy]) => [-cy, cx] as number[]) };
          return collision(board, rot) ? p : rot;
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, over, board, drop]);

  const displayBoard: Board = board.map(r => [...r]);
  if (!over) {
    piece.cells.forEach(([cx, cy]) => {
      const nx = piece.x + cx;
      const ny = piece.y + cy;
      if (ny >= 0 && ny < ROWS && nx >= 0 && nx < COLS) displayBoard[ny][nx] = piece.color;
    });
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>🟦</div>
        <h2 style={{ margin: 0, fontSize: 28, color: 'white' }}>Block Puzzle</h2>
        <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          Drop tetrominoes to fill rows. Use <strong style={{ color: '#f8fafc' }}>arrow keys</strong> or the buttons below to move and rotate.
        </p>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '16px 50px' }} onClick={() => setStarted(true)}>
          START
        </button>
      </div>
    );
  }

  if (over) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20 }}>
        <div style={{ fontSize: 64 }}>💀</div>
        <h2 style={{ color: '#ef4444', margin: 0 }}>Game Over</h2>
        <div style={{ fontSize: 28, fontWeight: 'bold', color: '#fbbf24' }}>Score: {score}</div>
        <div style={{ color: '#94a3b8' }}>Lines: {lines} | Level: {level}</div>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 16, padding: '14px 40px' }} onClick={() => onGameOver(score)}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 15, padding: 15 }}>
      {/* Board */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, ${CELL}px)`,
        gridTemplateRows: `repeat(${ROWS}, ${CELL}px)`,
        gap: 1,
        background: '#0f172a',
        border: '2px solid #334155',
        borderRadius: 8
      }}>
        {displayBoard.flatMap((row, ri) => row.map((cell, ci) => (
          <div key={`${ri}-${ci}`} style={{
            width: CELL, height: CELL,
            background: cell || 'rgba(255,255,255,0.03)',
            borderRadius: 3,
            boxShadow: cell ? 'inset 0 0 8px rgba(255,255,255,0.1)' : 'none',
            transition: '0.05s'
          }} />
        )))}
      </div>

      {/* Side panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 15, minWidth: 100 }}>
        <div style={{ background: '#1e293b', borderRadius: 10, padding: 12, textAlign: 'center', border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>SCORE</div>
          <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 20 }}>{score}</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 10, padding: 12, textAlign: 'center', border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4 }}>LEVEL</div>
          <div style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: 20 }}>{level}</div>
        </div>

        {/* Touch controls */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {[
            { label: '↺', action: () => setPiece(p => { const rot = { ...p, cells: p.cells.map(([cx, cy]) => [-cy, cx] as number[]) }; return collision(board, rot) ? p : rot; }) },
            { label: '↑', action: drop },
            { label: '←', action: () => setPiece(p => collision(board, p, -1, 0) ? p : { ...p, x: p.x - 1 }) },
            { label: '→', action: () => setPiece(p => collision(board, p, 1, 0) ? p : { ...p, x: p.x + 1 }) },
          ].map(btn => (
            <button
              key={btn.label}
              onMouseDown={btn.action}
              style={{
                padding: '10px', borderRadius: 8, fontSize: 18, fontWeight: 'bold',
                background: '#1e293b', border: '1px solid #334155', color: 'white',
                cursor: 'pointer', fontFamily: 'inherit'
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
