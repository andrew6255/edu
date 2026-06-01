import { useState, useEffect, useRef } from 'react';
import { GameMode } from '@/types/warmup';

interface Props {
  gameId: string;
  mode: GameMode;
  onGameOver: (score: number) => void;
}

const CUPS = 6;
const TIME_LIMIT = 90;

function applyFlip(state: boolean[], i: number): boolean[] {
  const next = [...state];
  next[i] = !next[i];
  if (i > 0) next[i - 1] = !next[i - 1];
  if (i < CUPS - 1) next[i + 1] = !next[i + 1];
  return next;
}

function generatePuzzle(): boolean[] {
  let state = Array(CUPS).fill(true);
  const moves = 2 + Math.floor(Math.random() * 4);
  for (let m = 0; m < moves; m++) {
    const i = Math.floor(Math.random() * CUPS);
    state = applyFlip(state, i);
  }
  if (state.every(Boolean)) return generatePuzzle();
  return state;
}

export default function FlipCupGame({ onGameOver }: Props) {
  const [cups, setCups] = useState<boolean[]>(generatePuzzle());
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [flash, setFlash] = useState(false);
  const [started, setStarted] = useState(false);
  const [lastFlipped, setLastFlipped] = useState<number | null>(null);
  const scoreRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!started) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current!); onGameOver(scoreRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [started]);

  function flip(i: number) {
    if (!started || flash) return;
    const next = applyFlip(cups, i);
    setCups(next);
    setLastFlipped(i);
    setTimeout(() => setLastFlipped(null), 200);
    if (next.every(Boolean)) {
      setFlash(true);
      scoreRef.current += 1;
      setScore(s => s + 1);
      setTimeout(() => { setFlash(false); setCups(generatePuzzle()); }, 700);
    }
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 24 }}>
        <div style={{ fontSize: 52 }}>🥤</div>
        <div style={{ fontSize: 22, fontWeight: 'bold', color: 'white' }}>Flip Cup</div>
        <div style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
          Tap a cup to flip it and its neighbors. Get all 6 cups standing upright! Solve as many as you can in 90 seconds.
        </div>
        <button className="ll-btn ll-btn-primary" style={{ padding: '14px 44px', fontSize: 16, marginTop: 8 }} onClick={() => setStarted(true)}>
          Start
        </button>
      </div>
    );
  }

  const pct = (timeLeft / TIME_LIMIT) * 100;
  const barColor = timeLeft > 30 ? '#3b82f6' : timeLeft > 10 ? '#f59e0b' : '#ef4444';

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, height: '100%', boxSizing: 'border-box', justifyContent: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 360 }}>
        <div style={{ color: '#94a3b8', fontSize: 14 }}>Score: <span style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{score}</span></div>
        <div style={{ color: barColor, fontWeight: 'bold', fontSize: 15 }}>{timeLeft}s</div>
      </div>
      <div style={{ width: '100%', maxWidth: 360, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 1s linear, background 0.3s' }} />
      </div>

      <div style={{ color: '#94a3b8', fontSize: 13 }}>
        {flash ? '' : 'Tap to flip a cup and its neighbors'}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        {cups.map((up, i) => (
          <button
            key={i}
            onClick={() => flip(i)}
            style={{
              width: 52, height: 80, borderRadius: 10, border: 'none',
              background: up ? 'linear-gradient(180deg,#059669,#065f46)' : 'linear-gradient(180deg,#334155,#1e293b)',
              cursor: 'pointer', padding: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              transform: up ? 'none' : 'scaleY(-1)',
              transition: 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1), background 0.2s',
              boxShadow: lastFlipped === i ? '0 0 20px rgba(16,185,129,0.5)' : (up ? '0 4px 12px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.3)'),
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <span style={{ fontSize: 28, display: 'block', transform: up ? 'none' : 'scaleY(-1)', transition: 'transform 0.25s' }}>🥤</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: -10 }}>
        {cups.map((up, i) => (
          <div key={i} style={{
            width: 52, height: 8, borderRadius: 4,
            background: up ? '#10b981' : '#475569',
            transition: 'background 0.2s'
          }} />
        ))}
      </div>

      {flash && (
        <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 18, animation: 'fadeIn 0.2s ease' }}>
          ✅ Solved! +1
        </div>
      )}
    </div>
  );
}
