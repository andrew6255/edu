import { useState, useEffect, useRef } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

function rand(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function makeStatement(): { text: string; isTrue: boolean } {
  const type = rand(0, 5);

  if (type === 0) {
    const a = rand(1, 12), b = rand(1, 12);
    const realResult = a + b;
    const shown = Math.random() < 0.5 ? realResult : realResult + rand(-3, 3) || realResult + 1;
    return { text: `${a} + ${b} = ${shown}`, isTrue: shown === realResult };
  }
  if (type === 1) {
    const a = rand(2, 12), b = rand(2, 12);
    const realResult = a * b;
    const shown = Math.random() < 0.5 ? realResult : realResult + rand(-4, 4) || realResult + 2;
    return { text: `${a} × ${b} = ${shown}`, isTrue: shown === realResult };
  }
  if (type === 2) {
    const a = rand(5, 20), b = rand(1, a);
    const realResult = a - b;
    const shown = Math.random() < 0.5 ? realResult : realResult + rand(-3, 3) || realResult + 1;
    return { text: `${a} − ${b} = ${shown}`, isTrue: shown === realResult };
  }
  if (type === 3) {
    const b = rand(2, 9), c = rand(1, 10);
    const a = b * c;
    const shown = Math.random() < 0.5 ? c : c + rand(-2, 2) || c + 1;
    return { text: `${a} ÷ ${b} = ${shown}`, isTrue: shown === c };
  }
  if (type === 4) {
    const a = rand(2, 12);
    const realSq = a * a;
    const shown = Math.random() < 0.5 ? realSq : realSq + rand(-5, 5) || realSq + 3;
    return { text: `${a}² = ${shown}`, isTrue: shown === realSq };
  }
  // Prime number fact
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
  const nonPrimes = [4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 22, 24, 25, 26, 27, 28, 30];
  const isPrime = Math.random() < 0.5;
  const n = isPrime ? primes[rand(0, primes.length - 1)] : nonPrimes[rand(0, nonPrimes.length - 1)];
  const statementIsPrime = Math.random() < 0.5;
  return { text: `${n} is a prime number`, isTrue: (isPrime && statementIsPrime) || (!isPrime && !statementIsPrime) ? statementIsPrime === isPrime : statementIsPrime === isPrime };
}

export default function TrueFalseGame({ gameId, onGameOver }: GameProps) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [score, setScore] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [statement, setStatement] = useState(makeStatement());
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
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

  function answer(val: boolean) {
    if (phase !== 'playing' || feedback) return;
    const ok = val === statement.isTrue;
    setFeedback(ok ? 'correct' : 'wrong');
    if (ok) {
      const ns = streak + 1;
      setStreak(ns);
      setMaxStreak(m => Math.max(m, ns));
      setScore(s => s + 1 + (ns >= 5 ? 1 : 0));
    } else {
      setWrong(w => w + 1);
      setStreak(0);
    }
    setTimeout(() => { setFeedback(null); setStatement(makeStatement()); }, 500);
  }

  const timerPct = (timeLeft / 60) * 100;
  const total = score + wrong;
  const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 20, background: '#0f172a' }}>
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>✅❌</div>
          <h2 style={{ color: 'white', margin: '0 0 10px', fontSize: 26 }}>True or False</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
            Is the math statement correct?<br />60 seconds. Streaks of 5+ give bonus points!
          </p>
          <button className="ll-btn ll-btn-primary" style={{ padding: '14px 40px', fontSize: 18 }} onClick={() => setPhase('playing')}>START</button>
        </div>
      )}

      {phase === 'playing' && (
        <>
          <div style={{ width: '100%', maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
              <span style={{ color: '#10b981', fontWeight: 'bold' }}>✅ {score}  ❌ {wrong}</span>
              {streak >= 3 && <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>🔥 {streak} streak!</span>}
              <span style={{ color: timerPct < 33 ? '#ef4444' : '#94a3b8', fontWeight: 'bold' }}>{timeLeft}s</span>
            </div>
            <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden', marginBottom: 30 }}>
              <div style={{ width: `${timerPct}%`, height: '100%', background: timerPct < 33 ? '#ef4444' : '#10b981', transition: 'width 1s linear' }} />
            </div>
          </div>

          <div style={{
            background: '#1e293b', borderRadius: 20, padding: '32px 40px', maxWidth: 360, width: '100%',
            border: `2px solid ${feedback === 'correct' ? '#10b981' : feedback === 'wrong' ? '#ef4444' : '#334155'}`,
            textAlign: 'center', transition: '0.3s', boxShadow: feedback === 'correct' ? '0 0 20px rgba(16,185,129,0.2)' : feedback === 'wrong' ? '0 0 20px rgba(239,68,68,0.2)' : 'none',
            animation: 'fadeIn 0.2s ease'
          }}>
            <div style={{ fontSize: 28, fontWeight: 'bold', color: 'white', lineHeight: 1.4 }}>{statement.text}</div>
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
            <button onClick={() => answer(true)} style={{
              padding: '18px 36px', borderRadius: 14, fontSize: 20, fontWeight: 'bold',
              background: 'rgba(16,185,129,0.15)', border: '2px solid rgba(16,185,129,0.4)',
              color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
            }}>✅ TRUE</button>
            <button onClick={() => answer(false)} style={{
              padding: '18px 36px', borderRadius: 14, fontSize: 20, fontWeight: 'bold',
              background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.4)',
              color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
            }}>❌ FALSE</button>
          </div>
        </>
      )}

      {phase === 'done' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>{accuracy >= 80 ? '🧠' : accuracy >= 60 ? '⭐' : '💡'}</div>
          <h2 style={{ color: 'white', margin: '0 0 20px', fontSize: 28 }}>Score: {score}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24, maxWidth: 280 }}>
            {[
              { label: 'Correct', value: score, color: '#10b981' },
              { label: 'Accuracy', value: `${accuracy}%`, color: '#3b82f6' },
              { label: 'Wrong', value: wrong, color: '#ef4444' },
              { label: 'Best Streak', value: maxStreak, color: '#fbbf24' },
            ].map(s => (
              <div key={s.label} style={{ background: '#1e293b', borderRadius: 10, padding: '12px', textAlign: 'center', border: '1px solid #334155' }}>
                <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <button className="ll-btn ll-btn-primary" style={{ padding: '12px 32px', fontSize: 16 }} onClick={() => { setScore(0); setWrong(0); setStreak(0); setMaxStreak(0); setTimeLeft(60); setStatement(makeStatement()); setFeedback(null); setPhase('ready'); }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
