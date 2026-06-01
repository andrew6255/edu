import { useState, useEffect, useRef } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

function rand(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function shuffle<T>(arr: T[]): T[] { return [...arr].sort(() => Math.random() - 0.5); }

interface Round {
  equation: string;
  answer: number;
  options: number[];
  correctIdx: number;
}

function makeRound(): Round {
  const type = rand(0, 4);
  let answer: number, equation: string;

  if (type === 0) {
    answer = rand(1, 12); const b = rand(1, 20);
    equation = `___ + ${b} = ${answer + b}`;
  } else if (type === 1) {
    const a = rand(5, 30); answer = rand(1, a - 1);
    equation = `${a} − ___ = ${a - answer}`;
  } else if (type === 2) {
    answer = rand(2, 12); const b = rand(2, 9);
    equation = `${b} × ___ = ${b * answer}`;
  } else if (type === 3) {
    const b = rand(2, 9); answer = rand(2, 12);
    equation = `${b * answer} ÷ ___ = ${answer}`;
  } else {
    answer = rand(2, 9); const b = rand(2, 3);
    equation = `___ ${b === 2 ? '²' : '³'} = ${Math.pow(answer, b)}`;
  }

  const distractors: number[] = [];
  while (distractors.length < 3) {
    const d = answer + (Math.random() < 0.5 ? 1 : -1) * rand(1, 5);
    if (d > 0 && d !== answer && !distractors.includes(d)) distractors.push(d);
  }

  const options = shuffle([answer, ...distractors]);
  const correctIdx = options.indexOf(answer);
  return { equation, answer, options, correctIdx };
}

export default function CompleteEqGame({ gameId, onGameOver }: GameProps) {
  const is60s = /_60s$/i.test(gameId);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [score, setScore] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(is60s ? 60 : 10);
  const [round, setRound] = useState(makeRound());
  const [feedback, setFeedback] = useState<{ idx: number; correct: boolean } | null>(null);
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

  function answer(idx: number) {
    if (feedback) return;
    const correct = idx === round.correctIdx;
    setFeedback({ idx, correct });
    if (correct) {
      const ns = streak + 1;
      setStreak(ns);
      setMaxStreak(m => Math.max(m, ns));
      setScore(s => s + 1);
      if (!is60s) setTimeLeft(10);
    } else {
      setWrong(w => w + 1);
      setStreak(0);
      if (is60s) setScore(s => Math.max(0, s - 1));
    }
    setTimeout(() => {
      if (!correct && !is60s) { setPhase('done'); return; }
      setFeedback(null);
      setRound(makeRound());
    }, 650);
  }

  const timerPct = (timeLeft / (is60s ? 60 : 10)) * 100;
  const total = score + wrong;
  const accuracy = total > 0 ? Math.round((score / total) * 100) : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 22, background: '#0f172a' }}>
      {phase === 'ready' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 60, marginBottom: 16 }}>📝</div>
          <h2 style={{ color: 'white', margin: '0 0 10px', fontSize: 26 }}>Complete the Equation</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24, lineHeight: 1.6 }}>
            Fill in the blank to make the equation true.<br />
            {is60s ? '60 seconds. Wrong = -1.' : '10 seconds per question. One wrong = game over.'}
          </p>
          <button className="ll-btn ll-btn-primary" style={{ padding: '14px 40px', fontSize: 18 }} onClick={() => setPhase('playing')}>START</button>
        </div>
      )}

      {phase === 'playing' && (
        <>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
              <span style={{ color: '#10b981', fontWeight: 'bold' }}>✅ {score}  ❌ {wrong}</span>
              {streak >= 3 && <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>🔥 {streak} streak!</span>}
              <span style={{ color: timerPct < 33 ? '#ef4444' : '#94a3b8', fontWeight: 'bold' }}>{timeLeft}s</span>
            </div>
            <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden', marginBottom: 22 }}>
              <div style={{ width: `${timerPct}%`, height: '100%', background: timerPct < 33 ? '#ef4444' : '#c084fc', transition: 'width 1s linear' }} />
            </div>
          </div>

          <div style={{
            background: '#1e293b', borderRadius: 20, padding: '24px 32px', maxWidth: 380, width: '100%',
            border: `2px solid ${feedback?.correct ? '#10b981' : feedback ? '#ef4444' : '#334155'}`,
            textAlign: 'center', transition: '0.3s', animation: 'fadeIn 0.2s ease'
          }}>
            <div style={{ fontSize: 30, fontWeight: 'bold', color: 'white', letterSpacing: 1 }}>{round.equation}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 320 }}>
            {round.options.map((opt, i) => {
              let bg = '#1e293b', border = '#475569', color = 'white';
              if (feedback?.idx === i) {
                bg = feedback.correct ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)';
                border = feedback.correct ? '#10b981' : '#ef4444';
                color = feedback.correct ? '#10b981' : '#ef4444';
              } else if (feedback && !feedback.correct && i === round.correctIdx) {
                bg = 'rgba(16,185,129,0.1)'; border = 'rgba(16,185,129,0.5)'; color = '#10b981';
              }
              return (
                <button key={i} onClick={() => answer(i)} disabled={!!feedback} style={{
                  padding: '18px', borderRadius: 14, fontSize: 24, fontWeight: 'bold',
                  background: bg, border: `2px solid ${border}`, color,
                  cursor: feedback ? 'default' : 'pointer', fontFamily: 'inherit', transition: '0.2s'
                }}>
                  {opt}
                </button>
              );
            })}
          </div>
        </>
      )}

      {phase === 'done' && (
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.4s ease' }}>
          <div style={{ fontSize: 64, marginBottom: 12 }}>{accuracy >= 80 ? '🎓' : accuracy >= 60 ? '⭐' : '📝'}</div>
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
          <button className="ll-btn ll-btn-primary" style={{ padding: '12px 32px', fontSize: 16 }} onClick={() => { setScore(0); setWrong(0); setStreak(0); setMaxStreak(0); setTimeLeft(60); setRound(makeRound()); setFeedback(null); setPhase('ready'); }}>Play Again</button>
        </div>
      )}
    </div>
  );
}
