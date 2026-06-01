import { useState, useEffect, useRef } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

function rand(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function makeExpr(): { label: string; value: number } {
  const type = rand(0, 4);
  if (type === 0) {
    const a = rand(2, 15), b = rand(2, 15);
    return { label: `${a} + ${b}`, value: a + b };
  }
  if (type === 1) {
    const a = rand(5, 20), b = rand(1, a);
    return { label: `${a} − ${b}`, value: a - b };
  }
  if (type === 2) {
    const a = rand(2, 12), b = rand(2, 9);
    return { label: `${a} × ${b}`, value: a * b };
  }
  if (type === 3) {
    const b = rand(2, 9), a = b * rand(1, 10);
    return { label: `${a} ÷ ${b}`, value: a / b };
  }
  const a = rand(2, 9), b = rand(2, 3);
  return { label: `${a}${b === 2 ? '²' : '³'}`, value: Math.pow(a, b) };
}

function makeRound() {
  let left = makeExpr(), right = makeExpr();
  // Occasionally force equality
  if (Math.random() < 0.2) right = { label: right.label, value: left.value };
  return { left, right };
}

export default function CompareExpGame({ gameId, onGameOver }: GameProps) {
  const is60s = /_60s$/i.test(gameId);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(is60s ? 60 : 10);
  const [round, setRound] = useState(makeRound());
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [total, setTotal] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phase !== 'playing') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current!); setPhase('done'); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase]);

  useEffect(() => {
    if (phase === 'done') onGameOver(score);
  }, [phase]);

  function answer(op: '<' | '=' | '>') {
    if (phase !== 'playing' || feedback) return;
    const { left, right } = round;
    const correct = left.value < right.value ? '<' : left.value === right.value ? '=' : '>';
    const ok = op === correct;
    setFeedback(ok ? 'correct' : 'wrong');
    setTotal(t => t + 1);
    if (ok) {
      const ns = streak + 1;
      setStreak(ns);
      setMaxStreak(m => Math.max(m, ns));
      setScore(s => s + 1);
      if (!is60s) setTimeLeft(10);
    } else {
      setStreak(0);
      if (is60s) setScore(s => Math.max(0, s - 1));
    }
    setTimeout(() => {
      if (!ok && !is60s) { setPhase('done'); return; }
      setFeedback(null);
      setRound(makeRound());
    }, 550);
  }

  const timerPct = (timeLeft / (is60s ? 60 : 10)) * 100;
  const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 20, background: '#0f172a' }}>
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>⚖️</div>
          <h2 style={{ color: 'white', margin: '0 0 10px', fontSize: 26 }}>Compare Expressions</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
            Decide whether the left expression is<br /><strong style={{ color: 'white' }}>less than, equal to, or greater than</strong> the right.<br />
            {is60s ? '60 seconds. Wrong = -1.' : '10 seconds per question. One wrong = game over.'}
          </p>
          <button className="ll-btn ll-btn-primary" style={{ padding: '14px 40px', fontSize: 18 }} onClick={() => setPhase('playing')}>
            START
          </button>
        </div>
      )}

      {phase === 'playing' && (
        <>
          <div style={{ width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
              <span style={{ color: '#10b981', fontWeight: 'bold' }}>✅ {score}</span>
              {streak >= 2 && <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>🔥 x{streak} streak!</span>}
              <span style={{ color: timerPct < 33 ? '#ef4444' : '#94a3b8', fontWeight: 'bold' }}>{timeLeft}s</span>
            </div>
            <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden', marginBottom: 20 }}>
              <div style={{ width: `${timerPct}%`, height: '100%', background: timerPct < 33 ? '#ef4444' : '#3b82f6', transition: 'width 1s linear' }} />
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'center',
            animation: 'fadeIn 0.2s ease'
          }}>
            {[round.left, round.right].map((expr, i) => (
              <div key={i} style={{
                background: '#1e293b', borderRadius: 16, padding: '22px 30px',
                border: '2px solid #334155', minWidth: 120, textAlign: 'center',
                boxShadow: feedback === 'correct' ? '0 0 20px rgba(16,185,129,0.3)' : feedback === 'wrong' ? '0 0 20px rgba(239,68,68,0.3)' : 'none',
                transition: '0.3s'
              }}>
                <div style={{ fontSize: 28, fontWeight: 'bold', color: 'white' }}>{expr.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
            {(['<', '=', '>'] as const).map(op => (
              <button key={op} onClick={() => answer(op)} style={{
                width: 72, height: 72, borderRadius: 16, fontSize: 28, fontWeight: 'bold',
                background: '#1e293b', border: '2px solid #475569', color: 'white',
                cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
              }}
                onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = '#3b82f6'; (e.target as HTMLButtonElement).style.background = 'rgba(59,130,246,0.15)'; }}
                onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = '#475569'; (e.target as HTMLButtonElement).style.background = '#1e293b'; }}
              >
                {op}
              </button>
            ))}
          </div>
        </>
      )}

      {phase === 'done' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>{score >= 30 ? '🏆' : score >= 15 ? '⭐' : '💫'}</div>
          <h2 style={{ color: 'white', margin: '0 0 20px', fontSize: 28 }}>Score: {score}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24, maxWidth: 280 }}>
            {[
              { label: 'Correct', value: score, color: '#10b981' },
              { label: 'Accuracy', value: `${accuracy}%`, color: '#3b82f6' },
              { label: 'Total Answered', value: total, color: '#c084fc' },
              { label: 'Best Streak', value: maxStreak, color: '#fbbf24' },
            ].map(s => (
              <div key={s.label} style={{ background: '#1e293b', borderRadius: 10, padding: '12px', textAlign: 'center', border: '1px solid #334155' }}>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button className="ll-btn ll-btn-primary" style={{ padding: '12px 32px', fontSize: 16 }} onClick={() => { setScore(0); setStreak(0); setMaxStreak(0); setTotal(0); setTimeLeft(45); setRound(makeRound()); setPhase('ready'); }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
