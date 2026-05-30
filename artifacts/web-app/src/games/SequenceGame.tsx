import { useEffect, useRef, useState } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

interface Sequence {
  nums: (number | null)[];
  answer: number;
  blankIdx: number;
  rule: string;
}

function makeSequence(difficulty: number): Sequence {
  const types = ['arithmetic', 'geometric', 'squares', 'fibonacci'];
  const type = types[Math.floor(Math.random() * (difficulty > 2 ? 4 : 2))];
  let nums: number[] = [];
  let rule = '';

  if (type === 'arithmetic') {
    const start = Math.floor(Math.random() * 10) + 1;
    const d = Math.floor(Math.random() * 5) + 1;
    nums = Array.from({ length: 6 }, (_, i) => start + i * d);
    rule = `+${d} each time`;
  } else if (type === 'geometric') {
    const start = Math.floor(Math.random() * 3) + 1;
    const r = Math.floor(Math.random() * 2) + 2;
    nums = Array.from({ length: 5 }, (_, i) => start * Math.pow(r, i));
    rule = `×${r} each time`;
  } else if (type === 'squares') {
    nums = Array.from({ length: 5 }, (_, i) => (i + 1) * (i + 1));
    rule = 'squares';
  } else {
    nums = [1, 1];
    for (let i = 2; i < 6; i++) nums.push(nums[i-1] + nums[i-2]);
    rule = 'each = sum of previous two';
  }

  const blankIdx = Math.floor(Math.random() * (nums.length - 1)) + 1;
  const answer = nums[blankIdx];
  const display = nums.map((v, i) => i === blankIdx ? null : v);
  return { nums: display, answer, blankIdx, rule };
}

function genWrongAnswers(correct: number): number[] {
  const set = new Set([correct]);
  while (set.size < 4) {
    const offset = Math.floor(Math.random() * 20) - 10;
    if (offset !== 0) set.add(Math.max(1, correct + offset));
  }
  return Array.from(set).sort(() => Math.random() - 0.5);
}

export default function SequenceGame({ gameId, onGameOver }: GameProps) {
  const is60s = /_60s$/i.test(gameId);
  const [question, setQuestion] = useState<Sequence & { options: number[] }>(() => {
    const q = makeSequence(1);
    return { ...q, options: genWrongAnswers(q.answer) };
  });
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [started, setStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(is60s ? 60 : 10);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!started) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          onGameOver(score);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [started, score]);

  function handleAnswer(opt: number) {
    if (feedback) return;
    const ok = opt === question.answer;
    if (ok) {
      setScore(s => s + 1);
      setFeedback('correct');
      if (!is60s) setTimeLeft(10);
    } else {
      setFeedback('wrong');
      if (is60s) setScore(s => Math.max(0, s - 1));
    }
    setTimeout(() => {
      if (!ok && !is60s) { onGameOver(score); return; }
      const nextRound = round + 1;
      const q = makeSequence(Math.min(4, Math.floor(nextRound / 3) + 1));
      setQuestion({ ...q, options: genWrongAnswers(q.answer) });
      setFeedback(null);
      setRound(nextRound);
    }, 800);
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>🔗</div>
        <h2 style={{ margin: 0, fontSize: 28, color: 'white' }}>Sequence</h2>
        <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          Find the <strong style={{ color: '#f8fafc' }}>missing number</strong> in each sequence.<br />
          {is60s ? '60 seconds. Wrong = -1.' : '10 seconds per question. One wrong = game over.'}
        </p>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '16px 50px' }} onClick={() => setStarted(true)}>
          START
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 25, padding: 25 }}>
      <div style={{ display: 'flex', gap: 20, fontSize: 15 }}>
        <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>Score: {score}</span>
        <span style={{ color: '#94a3b8' }}>{is60s ? `${timeLeft}s` : `Q: ${timeLeft}s`}</span>
      </div>

      {/* Sequence display */}
      <div style={{
        display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center',
        padding: 20, background: '#1e293b', borderRadius: 14, border: '1px solid #334155'
      }}>
        {question.nums.map((v, i) => (
          <div key={i} style={{
            minWidth: 55, height: 55, borderRadius: 10,
            background: v === null ? 'rgba(59,130,246,0.2)' : '#0f172a',
            border: `2px solid ${v === null ? (feedback === 'correct' ? '#10b981' : feedback === 'wrong' ? '#ef4444' : '#3b82f6') : '#334155'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 'bold', color: 'white',
            boxShadow: v === null ? '0 0 15px rgba(59,130,246,0.3)' : 'none',
            animation: v === null ? 'pulseGlow 2s infinite' : 'none'
          }}>
            {v === null ? (feedback === 'correct' ? question.answer : feedback === 'wrong' ? '✗' : '?') : v}
          </div>
        ))}
      </div>

      {/* Options */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 320 }}>
        {question.options.map((opt, i) => (
          <button
            key={i}
            className="custom-btn"
            onClick={() => handleAnswer(opt)}
            style={{ padding: '16px', fontSize: 20, transition: '0.15s' }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
