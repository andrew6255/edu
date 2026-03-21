import { useState, useEffect, useCallback } from 'react';
import { GameProps } from '@/views/WarmupView';

interface Question {
  q: string;
  options: number[];
  answer: number;
}

function genQuestion(hard = false): Question {
  const ops = hard ? ['+', '-', '*', '/'] : ['+', '-', '*'];
  const op = ops[Math.floor(Math.random() * ops.length)];
  let a = hard ? Math.floor(Math.random() * 20) + 2 : Math.floor(Math.random() * 12) + 1;
  let b = hard ? Math.floor(Math.random() * 20) + 2 : Math.floor(Math.random() * 12) + 1;
  let answer: number;
  let q: string;

  if (op === '+') { answer = a + b; q = `${a} + ${b}`; }
  else if (op === '-') {
    if (a < b) [a, b] = [b, a];
    answer = a - b; q = `${a} − ${b}`;
  } else if (op === '*') { answer = a * b; q = `${a} × ${b}`; }
  else {
    b = Math.max(1, b);
    answer = a;
    q = `${a * b} ÷ ${b}`;
    a = a * b;
  }

  const distractors = new Set<number>();
  distractors.add(answer);
  while (distractors.size < 4) {
    const offset = Math.floor(Math.random() * 10) - 5;
    if (offset !== 0) distractors.add(answer + offset);
  }
  const options = Array.from(distractors).sort(() => Math.random() - 0.5);
  return { q, options, answer };
}

export default function QuickMathGame({ gameId, onGameOver }: GameProps) {
  const hard = gameId === 'advQuickMath' || gameId === 'timeLimit';
  const TIME_LIMIT = 60;
  const POINTS_PER_Q = 10;
  const PENALTY = -3;

  const [question, setQuestion] = useState<Question>(() => genQuestion(hard));
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [started, setStarted] = useState(false);
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (!started) return;
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(interval); onGameOver(score); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [started, score]);

  function handleAnswer(opt: number) {
    if (!started || answered) return;
    setAnswered(true);
    if (opt === question.answer) {
      const bonus = Math.floor(streak / 3);
      setScore(s => s + POINTS_PER_Q + bonus);
      setStreak(s => s + 1);
      setFeedback('correct');
    } else {
      setScore(s => Math.max(0, s + PENALTY));
      setStreak(0);
      setFeedback('wrong');
    }
    setTimeout(() => {
      setQuestion(genQuestion(hard));
      setFeedback(null);
      setAnswered(false);
    }, 400);
  }

  const pct = (timeLeft / TIME_LIMIT) * 100;
  const timerColor = pct > 40 ? '#10b981' : pct > 20 ? '#fbbf24' : '#ef4444';

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>🧮</div>
        <h2 style={{ margin: 0, fontSize: 28, color: 'white' }}>{hard ? 'Advanced Math' : 'Quick Math'}</h2>
        <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          Answer as many {hard ? 'advanced ' : ''}math questions as you can in <strong style={{ color: '#f8fafc' }}>60 seconds</strong>. 
          +10 per correct, -3 per wrong. Build streaks for bonus points!
        </p>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '16px 50px' }} onClick={() => setStarted(true)}>
          START
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 25, gap: 20 }}>
      {/* Stats */}
      <div style={{ display: 'flex', gap: 30, fontSize: 15 }}>
        <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>Score: {score}</span>
        {streak >= 3 && <span style={{ color: '#f97316', fontWeight: 'bold' }}>🔥 Streak x{streak}</span>}
      </div>

      {/* Timer bar */}
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
          <span>Time Left</span><span style={{ color: timerColor, fontWeight: 'bold' }}>{timeLeft}s</span>
        </div>
        <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden', border: '1px solid #334155' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: timerColor, transition: '0.5s linear', borderRadius: 4 }} />
        </div>
      </div>

      {/* Question */}
      <div className="huge-display" style={{
        color: feedback === 'correct' ? '#10b981' : feedback === 'wrong' ? '#ef4444' : 'white',
        transition: '0.2s'
      }}>
        {question.q} = ?
      </div>

      {/* Options */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 400 }}>
        {question.options.map((opt, i) => (
          <button
            key={i}
            className="custom-btn"
            onClick={() => handleAnswer(opt)}
            style={{ padding: '18px 10px', fontSize: 22, transition: '0.15s' }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
