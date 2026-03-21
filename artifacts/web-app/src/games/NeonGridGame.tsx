import { useState, useEffect, useRef } from 'react';
import { GameMode } from '@/types/warmup';

interface Props {
  gameId: string;
  mode: GameMode;
  onGameOver: (score: number) => void;
}

const GRID = 4;
const TIME_LIMIT = 90;

function randomPattern(): boolean[] {
  const arr = Array(GRID * GRID).fill(false);
  const count = 4 + Math.floor(Math.random() * 6);
  const indices = Array.from({ length: GRID * GRID }, (_, i) => i)
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
  indices.forEach(i => (arr[i] = true));
  return arr;
}

export default function NeonGridGame({ onGameOver }: Props) {
  const [target, setTarget] = useState<boolean[]>(randomPattern());
  const [player, setPlayer] = useState<boolean[]>(Array(GRID * GRID).fill(false));
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [flash, setFlash] = useState(false);
  const [started, setStarted] = useState(false);
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

  function toggle(i: number) {
    if (!started || flash) return;
    const next = [...player];
    next[i] = !next[i];
    setPlayer(next);
    if (next.every((v, idx) => v === target[idx])) {
      setFlash(true);
      scoreRef.current += 1;
      setScore(s => s + 1);
      setTimeout(() => {
        setFlash(false);
        setTarget(randomPattern());
        setPlayer(Array(GRID * GRID).fill(false));
      }, 600);
    }
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 24 }}>
        <div style={{ fontSize: 52 }}>💡</div>
        <div style={{ fontSize: 22, fontWeight: 'bold', color: 'white' }}>Neon Grid</div>
        <div style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
          Copy the glowing blue pattern onto your green grid by tapping cells. Match as many patterns as you can in 90 seconds!
        </div>
        <button className="ll-btn ll-btn-primary" style={{ padding: '14px 44px', fontSize: 16, marginTop: 8 }} onClick={() => setStarted(true)}>
          Start
        </button>
      </div>
    );
  }

  const pct = (timeLeft / TIME_LIMIT) * 100;
  const barColor = timeLeft > 30 ? '#3b82f6' : timeLeft > 10 ? '#f59e0b' : '#ef4444';

  const cellSize = 52;

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 360 }}>
        <div style={{ color: '#94a3b8', fontSize: 14 }}>Score: <span style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>{score}</span></div>
        <div style={{ color: barColor, fontWeight: 'bold', fontSize: 15 }}>{timeLeft}s</div>
      </div>
      <div style={{ width: '100%', maxWidth: 360, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 1s linear, background 0.3s' }} />
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginTop: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Target</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${GRID}, 1fr)`, gap: 5 }}>
            {target.map((on, i) => (
              <div key={i} style={{
                width: cellSize, height: cellSize, borderRadius: 10,
                background: on ? '#1d4ed8' : '#0f172a',
                border: `2px solid ${on ? '#3b82f6' : '#1e293b'}`,
                boxShadow: on ? '0 0 14px rgba(59,130,246,0.6)' : 'none',
                transition: 'all 0.2s'
              }} />
            ))}
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Your Grid</div>
          <div style={{
            display: 'grid', gridTemplateColumns: `repeat(${GRID}, 1fr)`, gap: 5,
            borderRadius: 12, padding: 2,
            outline: flash ? '3px solid #10b981' : '2px solid transparent',
            transition: 'outline 0.2s'
          }}>
            {player.map((on, i) => (
              <button key={i} onClick={() => toggle(i)} style={{
                width: cellSize, height: cellSize, borderRadius: 10,
                background: on ? '#065f46' : '#0f172a',
                border: `2px solid ${on ? '#10b981' : '#1e293b'}`,
                boxShadow: on ? '0 0 14px rgba(16,185,129,0.6)' : 'none',
                cursor: 'pointer', transition: 'all 0.15s', padding: 0,
                WebkitTapHighlightColor: 'transparent'
              }} />
            ))}
          </div>
        </div>
      </div>

      <div style={{ color: flash ? '#10b981' : '#475569', fontSize: 13, fontWeight: flash ? 'bold' : 'normal', minHeight: 20, transition: 'color 0.2s' }}>
        {flash ? '✅ Pattern matched! Next one...' : 'Tap cells to toggle them on/off'}
      </div>
    </div>
  );
}
