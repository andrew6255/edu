import { useState } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

type Cell = { value: number | null; fixed: boolean; state?: 'correct' | 'wrong' | null };
type Grid = Cell[][];

function makePyramid(): { grid: Grid; answers: number[][] } {
  const ROWS = 5;
  const bottom: number[] = Array.from({ length: ROWS }, () => Math.floor(Math.random() * 9) + 1);
  const fullGrid: number[][] = [bottom];
  for (let r = 1; r < ROWS; r++) {
    const prev = fullGrid[r - 1];
    fullGrid.push(prev.slice(0, -1).map((v, i) => v + prev[i + 1]));
  }
  fullGrid.reverse();

  const grid: Grid = fullGrid.map((row, ri) =>
    row.map(v => {
      const isFixed = ri === fullGrid.length - 1 || (Math.random() < 0.4 && ri > 0);
      return { value: isFixed ? v : null, fixed: isFixed };
    })
  );
  return { grid, answers: fullGrid };
}

export default function PyramidGame({ onGameOver }: GameProps) {
  const [puzzle, setPuzzle] = useState(() => makePyramid());
  const [grid, setGrid] = useState<Grid>(puzzle.grid);
  const [answers] = useState(puzzle.answers);
  const [selected, setSelected] = useState<[number, number] | null>(null);
  const [input, setInput] = useState('');
  const [score, setScore] = useState(0);
  const [solved, setSolved] = useState(false);
  const [errors, setErrors] = useState(0);
  const [started, setStarted] = useState(false);

  function handleCellTap(ri: number, ci: number) {
    if (grid[ri][ci].fixed || solved) return;
    setSelected([ri, ci]);
    setInput('');
  }

  function handleNumpad(val: string) {
    if (!selected) return;
    if (val === '⌫') {
      setInput(prev => prev.slice(0, -1));
    } else if (val === '✓') {
      confirmInput();
    } else {
      setInput(prev => (prev + val).slice(0, 3));
    }
  }

  function confirmInput() {
    if (!selected || !input) return;
    const [ri, ci] = selected;
    const num = parseInt(input);
    const correct = answers[ri][ci];

    if (num === correct) {
      const newGrid = grid.map((r, rr) => r.map((c, cc) => {
        if (rr === ri && cc === ci) return { value: num, fixed: true, state: 'correct' as const };
        return c;
      }));
      setGrid(newGrid);
      setScore(s => s + 20);
      setSelected(null);
      setInput('');

      const allFilled = newGrid.every(row => row.every(c => c.fixed));
      if (allFilled) {
        setSolved(true);
        const bonus = Math.max(0, 100 - errors * 20);
        const final = score + 20 + bonus;
        setScore(final);
        setTimeout(() => onGameOver(final), 1500);
      }
    } else {
      setErrors(e => e + 1);
      setGrid(g => g.map((r, rr) => r.map((c, cc) => {
        if (rr === ri && cc === ci) return { ...c, value: num, state: 'wrong' as const };
        return c;
      })));
      setTimeout(() => {
        setGrid(g => g.map((r, rr) => r.map((c, cc) => {
          if (rr === ri && cc === ci) return { value: null, fixed: false, state: null };
          return c;
        })));
      }, 800);
      setSelected(null);
      setInput('');
    }
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>△</div>
        <h2 style={{ margin: 0, fontSize: 28, color: 'white' }}>Number Pyramid</h2>
        <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          Each cell equals the <strong style={{ color: '#f8fafc' }}>sum of the two below it</strong>. Fill in the missing values!
        </p>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '16px 50px' }} onClick={() => setStarted(true)}>
          START
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 20, gap: 15 }}>
      <div style={{ display: 'flex', gap: 20, fontSize: 15 }}>
        <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>Score: {score}</span>
        <span style={{ color: '#ef4444' }}>Errors: {errors}</span>
      </div>

      {/* Pyramid grid */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
        {grid.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: 5 }}>
            {row.map((cell, ci) => {
              const isSel = selected?.[0] === ri && selected?.[1] === ci;
              const bg = cell.state === 'correct' ? 'rgba(16,185,129,0.3)' : cell.state === 'wrong' ? 'rgba(239,68,68,0.3)' : cell.fixed ? '#1e293b' : '#0f172a';
              const border = isSel ? '2px solid #3b82f6' : cell.state === 'correct' ? '2px solid #10b981' : cell.state === 'wrong' ? '2px solid #ef4444' : cell.fixed ? '2px solid #334155' : '2px solid #475569';
              return (
                <div
                  key={ci}
                  onClick={() => handleCellTap(ri, ci)}
                  style={{
                    width: 58, height: 50, borderRadius: 8,
                    background: bg, border, cursor: cell.fixed ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, fontWeight: 'bold', color: 'white', transition: '0.15s',
                    boxShadow: isSel ? '0 0 15px rgba(59,130,246,0.5)' : 'none'
                  }}
                >
                  {isSel && input ? input : (cell.value ?? '')}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Numpad */}
      {!solved && (
        <div style={{ maxWidth: 240, width: '100%', marginTop: 10 }}>
          {!selected && (
            <div style={{ textAlign: 'center', color: '#64748b', fontSize: 12, marginBottom: 8 }}>
              Tap a square to enter a number
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: '100%' }}>
            {['1','2','3','4','5','6','7','8','9','⌫','0','✓'].map(k => (
              <button
                key={k}
                onClick={() => handleNumpad(k)}
                disabled={!selected}
                style={{
                  padding: '14px', borderRadius: 10, fontSize: 18, fontWeight: 'bold',
                  background: k === '✓' ? 'rgba(16,185,129,0.2)' : k === '⌫' ? 'rgba(239,68,68,0.2)' : '#1e293b',
                  border: k === '✓' ? '1px solid #10b981' : k === '⌫' ? '1px solid #ef4444' : '1px solid #334155',
                  color: k === '✓' ? '#10b981' : k === '⌫' ? '#ef4444' : 'white',
                  cursor: !selected ? 'not-allowed' : 'pointer', fontFamily: 'inherit', transition: '0.15s',
                  opacity: !selected ? 0.45 : 1
                }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      )}

      {solved && (
        <div style={{ color: '#10b981', fontSize: 22, fontWeight: 'bold', animation: 'fadeIn 0.4s ease' }}>
          ✅ Pyramid Complete! {score} pts
        </div>
      )}
    </div>
  );
}
