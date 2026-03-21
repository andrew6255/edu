import { useState, useEffect, useRef } from 'react';
import { GameProps } from '@/views/WarmupView';

function rand(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a; }

type Op = '+' | '−' | '×' | '÷';

function makeRound(): { left: number; right: number; result: number; op: Op; wrong: Op[] } {
  const ops: Op[] = ['+', '−', '×', '÷'];
  const op = ops[rand(0, 3)];
  let left: number, right: number, result: number;

  if (op === '+') {
    left = rand(2, 30); right = rand(2, 30); result = left + right;
  } else if (op === '−') {
    left = rand(5, 30); right = rand(1, left - 1); result = left - right;
  } else if (op === '×') {
    left = rand(2, 12); right = rand(2, 12); result = left * right;
  } else {
    right = rand(2, 9); result = rand(2, 12); left = right * result;
  }

  const wrongOps = ops.filter(o => o !== op);
  return { left, right, result, op, wrong: wrongOps };
}

export default function MissingOpGame({ gameId, onGameOver }: GameProps) {
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [score, setScore] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [round, setRound] = useState(makeRound());
  const [feedback, setFeedback] = useState<{ op: Op; correct: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shuffle options
  const [options] = useState<Op[]>(['+', '−', '×', '÷']);

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

  function answer(op: Op) {
    if (feedback) return;
    const ok = op === round.op;
    setFeedback({ op, correct: ok });
    if (ok) {
      const ns = streak + 1;
      setStreak(ns);
      setMaxStreak(m => Math.max(m, ns));
      setScore(s => s + 1 + (ns >= 4 ? 1 : 0));
    } else {
      setWrong(w => w + 1);
      setStreak(0);
    }
    setTimeout(() => { setFeedback(null); setRound(makeRound()); }, 600);
  }

  const timerPct = (timeLeft / 60) * 100;
  const total = score + wrong;
  const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;

  const OP_COLORS: Record<Op, string> = { '+': '#10b981', '−': '#3b82f6', '×': '#f97316', '÷': '#c084fc' };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 20, background: '#0f172a' }}>
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>🔣</div>
          <h2 style={{ color: 'white', margin: '0 0 10px', fontSize: 26 }}>Missing Operator</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
            Fill in the missing operator to make the equation true.<br />60 seconds. Streak bonus after 4 in a row!
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
              <div style={{ width: `${timerPct}%`, height: '100%', background: timerPct < 33 ? '#ef4444' : '#f97316', transition: 'width 1s linear' }} />
            </div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 16, fontSize: 34, fontWeight: 'bold', color: 'white',
            animation: 'fadeIn 0.2s ease'
          }}>
            <span>{round.left}</span>
            <div style={{
              width: 56, height: 56, borderRadius: 12, background: '#1e293b',
              border: '2px dashed #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, color: '#3b82f6'
            }}>
              {feedback ? (
                <span style={{ color: feedback.correct ? '#10b981' : '#ef4444' }}>{feedback.op}</span>
              ) : '?'}
            </div>
            <span>{round.right}</span>
            <span style={{ color: '#64748b' }}>=</span>
            <span style={{ color: '#fbbf24' }}>{round.result}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 20 }}>
            {options.map(op => {
              let bg = `${OP_COLORS[op]}18`;
              let border = `${OP_COLORS[op]}44`;
              if (feedback?.op === op) {
                bg = feedback.correct ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)';
                border = feedback.correct ? '#10b981' : '#ef4444';
              } else if (feedback && !feedback.correct && op === round.op) {
                bg = 'rgba(16,185,129,0.1)';
                border = 'rgba(16,185,129,0.5)';
              }
              return (
                <button key={op} onClick={() => answer(op)} disabled={!!feedback} style={{
                  padding: '18px 24px', borderRadius: 14, fontSize: 28, fontWeight: 'bold',
                  background: bg, border: `2px solid ${border}`, color: OP_COLORS[op],
                  cursor: feedback ? 'default' : 'pointer', fontFamily: 'inherit', transition: '0.2s'
                }}>
                  {op}
                </button>
              );
            })}
          </div>
        </>
      )}

      {phase === 'done' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>{accuracy >= 80 ? '🎯' : accuracy >= 60 ? '⭐' : '💡'}</div>
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
          <button className="ll-btn ll-btn-primary" style={{ padding: '12px 32px', fontSize: 16 }} onClick={() => { setScore(0); setWrong(0); setStreak(0); setMaxStreak(0); setTimeLeft(60); setRound(makeRound()); setFeedback(null); setPhase('ready'); }}>
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
