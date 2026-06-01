import { useState, useEffect, useRef, useCallback } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

const GRID = 5;
const TOTAL = GRID * GRID;

function getRandomCells(count: number): Set<number> {
  const set = new Set<number>();
  while (set.size < count) set.add(Math.floor(Math.random() * TOTAL));
  return set;
}

export default function MemoCellsGame({ gameId, onGameOver }: GameProps) {
  const [phase, setPhase] = useState<'ready' | 'show' | 'recall' | 'feedback' | 'done'>('ready');
  const [level, setLevel] = useState(1);
  const [targetCells, setTargetCells] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showTime, setShowTime] = useState(2);
  const [recallTime, setRecallTime] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [feedbackCells, setFeedbackCells] = useState<Record<number, 'correct' | 'wrong' | 'missed'>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cellCount = Math.min(3 + level, 15);
  const recallLimit = Math.max(8, 20 - level);

  const startLevel = useCallback((lvl: number) => {
    const cells = getRandomCells(Math.min(3 + lvl, 15));
    setTargetCells(cells);
    setSelected(new Set());
    setFeedbackCells({});
    setShowTime(Math.max(1.5, 3.5 - lvl * 0.25));
    setPhase('show');
  }, []);

  useEffect(() => {
    if (phase !== 'show') return;
    const t = setTimeout(() => {
      setRecallTime(recallLimit);
      setPhase('recall');
    }, showTime * 1000);
    return () => clearTimeout(t);
  }, [phase, showTime, recallLimit]);

  useEffect(() => {
    if (phase !== 'recall') return;
    timerRef.current = setInterval(() => {
      setRecallTime(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function handleSubmit() {
    if (timerRef.current) clearInterval(timerRef.current);

    const fb: Record<number, 'correct' | 'wrong' | 'missed'> = {};
    let correct = 0;

    selected.forEach(idx => {
      if (targetCells.has(idx)) { fb[idx] = 'correct'; correct++; }
      else fb[idx] = 'wrong';
    });
    targetCells.forEach(idx => {
      if (!selected.has(idx)) fb[idx] = 'missed';
    });

    setFeedbackCells(fb);
    setPhase('feedback');

    const perfect = correct === targetCells.size && selected.size === targetCells.size;
    const levelScore = Math.floor(correct * (level + 1));

    if (perfect) {
      setScore(s => s + levelScore + level * 5);
      setTimeout(() => {
        const nextLevel = level + 1;
        setLevel(nextLevel);
        startLevel(nextLevel);
      }, 1200);
    } else {
      const newLives = lives - 1;
      setLives(newLives);
      setScore(s => s + levelScore);
      setTimeout(() => {
        if (newLives <= 0) {
          setPhase('done');
        } else {
          startLevel(level);
        }
      }, 1400);
    }
  }

  function toggleCell(idx: number) {
    if (phase !== 'recall') return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  useEffect(() => {
    if (phase === 'done') onGameOver(score);
  }, [phase]);

  function getCellStyle(idx: number): React.CSSProperties {
    const isTarget = targetCells.has(idx);
    const isSel = selected.has(idx);
    const fb = feedbackCells[idx];

    if (phase === 'show') {
      return {
        background: isTarget ? '#3b82f6' : '#1e293b',
        border: `2px solid ${isTarget ? '#60a5fa' : '#334155'}`,
        boxShadow: isTarget ? '0 0 12px rgba(59,130,246,0.6)' : 'none',
        transform: isTarget ? 'scale(1.05)' : 'none',
        transition: '0.2s'
      };
    }
    if (phase === 'feedback') {
      if (fb === 'correct') return { background: 'rgba(16,185,129,0.4)', border: '2px solid #10b981', boxShadow: '0 0 10px rgba(16,185,129,0.4)' };
      if (fb === 'wrong') return { background: 'rgba(239,68,68,0.4)', border: '2px solid #ef4444' };
      if (fb === 'missed') return { background: 'rgba(251,191,36,0.2)', border: '2px dashed #fbbf24' };
      return { background: '#1e293b', border: '2px solid #334155' };
    }
    if (isSel) return { background: 'rgba(59,130,246,0.4)', border: '2px solid #3b82f6', boxShadow: '0 0 8px rgba(59,130,246,0.4)', transform: 'scale(0.95)', transition: '0.1s' };
    return { background: '#1e293b', border: '2px solid #334155', cursor: 'pointer', transition: '0.1s' };
  }

  const timerPct = recallLimit > 0 ? (recallTime / recallLimit) * 100 : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16, background: '#0f172a' }}>
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>🧠</div>
          <h2 style={{ color: 'white', margin: '0 0 10px', fontSize: 26 }}>Memo Cells</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
            A pattern of cells will flash briefly.<br />Memorize them, then click the same cells!<br />Levels get harder — more cells, less time to memorize.
          </p>
          <button className="ll-btn ll-btn-primary" style={{ padding: '14px 40px', fontSize: 18 }} onClick={() => { setLevel(1); setScore(0); setLives(3); startLevel(1); }}>START</button>
        </div>
      )}

      {(phase === 'show' || phase === 'recall' || phase === 'feedback') && (
        <>
          {/* Header */}
          <div style={{ width: '100%', maxWidth: 340, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: '#c084fc', fontWeight: 'bold' }}>Level {level}</span>
            <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>⭐ {score}</span>
            <span style={{ color: '#ef4444', fontWeight: 'bold' }}>{'❤️'.repeat(lives)}</span>
          </div>

          {/* Status */}
          <div style={{ fontSize: 15, fontWeight: 'bold', color: phase === 'show' ? '#3b82f6' : phase === 'recall' ? '#10b981' : '#fbbf24', letterSpacing: 1 }}>
            {phase === 'show' ? `👁️ MEMORIZE! (${cellCount} cells)` : phase === 'recall' ? `🧠 RECALL! (${recallTime}s)` : '📋 Checking...'}
          </div>

          {phase === 'recall' && (
            <div style={{ width: '100%', maxWidth: 340, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${timerPct}%`, height: '100%', background: timerPct < 33 ? '#ef4444' : '#10b981', transition: 'width 1s linear' }} />
            </div>
          )}

          {/* Grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${GRID}, 1fr)`, gap: 6,
            width: 'min(320px, 85vw)'
          }}>
            {Array.from({ length: TOTAL }, (_, i) => (
              <div
                key={i}
                onClick={() => toggleCell(i)}
                style={{
                  aspectRatio: '1', borderRadius: 8,
                  ...getCellStyle(i)
                }}
              />
            ))}
          </div>

          {phase === 'recall' && (
            <button
              className="ll-btn ll-btn-primary"
              style={{ padding: '11px 32px', fontSize: 15 }}
              onClick={handleSubmit}
            >
              Submit ✓
            </button>
          )}
        </>
      )}

      {phase === 'done' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>{level >= 8 ? '🧠' : level >= 4 ? '⭐' : '💡'}</div>
          <h2 style={{ color: 'white', margin: '0 0 8px', fontSize: 28 }}>Score: {score}</h2>
          <p style={{ color: '#64748b', marginBottom: 20 }}>Reached Level {level}</p>
          <button className="ll-btn ll-btn-primary" style={{ padding: '12px 32px', fontSize: 16 }} onClick={() => { setScore(0); setLives(3); setLevel(1); setPhase('ready'); }}>Play Again</button>
        </div>
      )}
    </div>
  );
}
