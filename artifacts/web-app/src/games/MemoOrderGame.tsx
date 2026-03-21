import { useState, useEffect, useRef, useCallback } from 'react';
import { GameProps } from '@/views/WarmupView';

const GRID_SIZE = 3;
const TOTAL = GRID_SIZE * GRID_SIZE;

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

interface NumberTile { value: number; cellIndex: number; }

export default function MemoOrderGame({ gameId, onGameOver }: GameProps) {
  const [phase, setPhase] = useState<'ready' | 'show' | 'recall' | 'done'>('ready');
  const [level, setLevel] = useState(1);
  const [tiles, setTiles] = useState<NumberTile[]>([]);
  const [visibleTiles, setVisibleTiles] = useState<Set<number>>( new Set());
  const [nextExpected, setNextExpected] = useState(1);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [clickFeedback, setClickFeedback] = useState<Record<number, 'correct' | 'wrong'>>({});
  const [recallTime, setRecallTime] = useState(0);
  const showRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const count = Math.min(3 + level, 9);
  const recallLimit = Math.max(8, 18 - level);

  const startLevel = useCallback((lvl: number) => {
    const cnt = Math.min(3 + lvl, 9);
    const positions = shuffle(Array.from({ length: TOTAL }, (_, i) => i)).slice(0, cnt);
    const newTiles: NumberTile[] = positions.map((cellIndex, i) => ({ value: i + 1, cellIndex }));
    setTiles(newTiles);
    setVisibleTiles(new Set(newTiles.map(t => t.cellIndex)));
    setNextExpected(1);
    setClickFeedback({});
    setPhase('show');
  }, []);

  useEffect(() => {
    if (phase !== 'show') return;
    const showDuration = Math.max(1200, 3000 - level * 200);
    showRef.current = setTimeout(() => {
      setVisibleTiles(new Set());
      setRecallTime(recallLimit);
      setPhase('recall');
    }, showDuration);
    return () => { if (showRef.current) clearTimeout(showRef.current); };
  }, [phase, level, recallLimit]);

  useEffect(() => {
    if (phase !== 'recall') return;
    timerRef.current = setInterval(() => {
      setRecallTime(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          loseLife();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function loseLife() {
    const newLives = lives - 1;
    setLives(newLives);
    if (newLives <= 0) { setPhase('done'); return; }
    setTimeout(() => startLevel(level), 800);
  }

  function handleCellClick(cellIndex: number) {
    if (phase !== 'recall') return;
    const tile = tiles.find(t => t.cellIndex === cellIndex);
    if (!tile) return;

    if (tile.value === nextExpected) {
      setClickFeedback(prev => ({ ...prev, [cellIndex]: 'correct' }));
      setVisibleTiles(prev => new Set([...prev, cellIndex]));
      const nextExp = nextExpected + 1;
      setNextExpected(nextExp);

      if (nextExp > count) {
        if (timerRef.current) clearInterval(timerRef.current);
        const roundScore = level * 10 + Math.floor(recallTime * 2);
        setScore(s => s + roundScore);
        setTimeout(() => {
          const nextLevel = level + 1;
          setLevel(nextLevel);
          startLevel(nextLevel);
        }, 800);
      }
    } else {
      setClickFeedback(prev => ({ ...prev, [cellIndex]: 'wrong' }));
      setTimeout(() => loseLife(), 600);
    }
  }

  useEffect(() => {
    if (phase === 'done') onGameOver(score);
  }, [phase]);

  const timerPct = recallLimit > 0 ? (recallTime / recallLimit) * 100 : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 18, background: '#0f172a' }}>
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>🔢</div>
          <h2 style={{ color: 'white', margin: '0 0 10px', fontSize: 26 }}>Memo Order</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
            Numbers appear on the grid.<br />Remember their positions, then<br /><strong style={{ color: 'white' }}>tap them in order from 1 to N!</strong><br />Each level adds more numbers.
          </p>
          <button className="ll-btn ll-btn-primary" style={{ padding: '14px 40px', fontSize: 18 }} onClick={() => { setScore(0); setLives(3); setLevel(1); startLevel(1); }}>START</button>
        </div>
      )}

      {(phase === 'show' || phase === 'recall') && (
        <>
          <div style={{ width: '100%', maxWidth: 300, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: '#c084fc', fontWeight: 'bold' }}>Level {level} ({count} numbers)</span>
            <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>⭐ {score}</span>
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{'❤️'.repeat(lives)}</span>
          </div>

          <div style={{
            fontSize: 14, fontWeight: 'bold', letterSpacing: 1,
            color: phase === 'show' ? '#3b82f6' : '#10b981'
          }}>
            {phase === 'show' ? '👁️ MEMORIZE!' : `🧠 TAP IN ORDER (${recallTime}s) — Next: ${nextExpected}`}
          </div>

          {phase === 'recall' && (
            <div style={{ width: '100%', maxWidth: 300, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${timerPct}%`, height: '100%', background: timerPct < 33 ? '#ef4444' : '#10b981', transition: 'width 1s linear' }} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`, gap: 10, width: 'min(280px, 85vw)' }}>
            {Array.from({ length: TOTAL }, (_, cellIndex) => {
              const tile = tiles.find(t => t.cellIndex === cellIndex);
              const isVisible = visibleTiles.has(cellIndex);
              const fb = clickFeedback[cellIndex];
              const isHidden = phase === 'recall' && !fb && !isVisible;

              return (
                <div
                  key={cellIndex}
                  onClick={() => handleCellClick(cellIndex)}
                  style={{
                    aspectRatio: '1', borderRadius: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 26, fontWeight: 'bold',
                    cursor: phase === 'recall' && tile && !fb ? 'pointer' : 'default',
                    transition: '0.15s',
                    background: fb === 'correct' ? 'rgba(16,185,129,0.3)' : fb === 'wrong' ? 'rgba(239,68,68,0.3)' : isVisible && tile ? 'rgba(59,130,246,0.25)' : '#1e293b',
                    border: fb === 'correct' ? '2px solid #10b981' : fb === 'wrong' ? '2px solid #ef4444' : isVisible && tile ? '2px solid rgba(59,130,246,0.6)' : '2px solid #334155',
                    boxShadow: fb === 'correct' ? '0 0 12px rgba(16,185,129,0.3)' : isVisible && tile && phase === 'show' ? '0 0 10px rgba(59,130,246,0.3)' : 'none',
                    color: fb === 'correct' ? '#10b981' : fb === 'wrong' ? '#ef4444' : 'white',
                    transform: fb ? 'scale(0.92)' : 'scale(1)'
                  }}
                >
                  {isHidden ? '' : tile ? tile.value : ''}
                </div>
              );
            })}
          </div>
        </>
      )}

      {phase === 'done' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>{level >= 6 ? '🧠' : level >= 3 ? '⭐' : '💡'}</div>
          <h2 style={{ color: 'white', margin: '0 0 8px', fontSize: 28 }}>Score: {score}</h2>
          <p style={{ color: '#64748b', marginBottom: 20 }}>Reached Level {level}</p>
          <button className="ll-btn ll-btn-primary" style={{ padding: '12px 32px', fontSize: 16 }} onClick={() => { setScore(0); setLives(3); setLevel(1); setPhase('ready'); }}>Play Again</button>
        </div>
      )}
    </div>
  );
}
