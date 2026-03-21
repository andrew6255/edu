import { useState, useEffect, useCallback } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps {
  gameId: string;
  mode: GameMode;
  onGameOver: (score: number) => void;
}

interface Question {
  q: string;
  options: number[];
  answer: number;
}

function genQuestion(hard = false): Question {
  const ops = hard ? ['+', '-', '*', '/'] : ['+', '-', '*', '/'];
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

const Q_TIME = 10;
const TOTAL_TIME = 60;

export default function QuickMathGame({ gameId, mode, onGameOver }: GameProps) {
  const isTimeLimit = gameId === 'timeLimit';
  const hard = gameId === 'advQuickMath';

  const [question, setQuestion] = useState<Question>(() => genQuestion(hard));
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [timeLeft, setTimeLeft] = useState(isTimeLimit ? TOTAL_TIME : Q_TIME);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [started, setStarted] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [ended, setEnded] = useState(false);

  const nextQuestion = useCallback(() => {
    setQuestion(genQuestion(hard));
    setFeedback(null);
    setAnswered(false);
    if (!isTimeLimit) setTimeLeft(Q_TIME);
  }, [hard, isTimeLimit]);

  useEffect(() => {
    if (!started || ended) return;
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(interval);
          if (isTimeLimit) {
            setEnded(true);
            onGameOver(score);
          } else {
            setEnded(true);
            onGameOver(correct);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [started, ended, score, correct, isTimeLimit]);

  function handleAnswer(opt: number) {
    if (!started || answered || ended) return;
    setAnswered(true);
    const isCorrect = opt === question.answer;

    if (isCorrect) {
      setFeedback('correct');
      if (isTimeLimit) {
        setScore(s => s + 1);
      } else {
        setCorrect(c => c + 1);
        setStreak(s => s + 1);
      }
      setTimeout(nextQuestion, 350);
    } else {
      setFeedback('wrong');
      if (isTimeLimit) {
        setScore(s => Math.max(0, s - 1));
        setTimeout(nextQuestion, 500);
      } else {
        if (mode === 'friend') {
          setCorrect(c => Math.max(0, c - 1));
        }
        setTimeout(() => {
          setEnded(true);
          onGameOver(mode === 'friend' ? Math.max(0, correct - 1) : correct);
        }, 600);
      }
    }
  }

  const displayScore = isTimeLimit ? score : correct;
  const pct = isTimeLimit
    ? (timeLeft / TOTAL_TIME) * 100
    : (timeLeft / Q_TIME) * 100;
  const timerColor = pct > 50 ? '#10b981' : pct > 25 ? '#fbbf24' : '#ef4444';

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 56 }}>{hard ? '⚡' : isTimeLimit ? '⏱️' : '🧮'}</div>
        <h2 style={{ margin: 0, fontSize: 26, color: 'white' }}>
          {hard ? 'Advanced Math' : isTimeLimit ? 'Time Limit' : 'Quick Math'}
        </h2>
        <div style={{ background: '#1e293b', borderRadius: 12, padding: '14px 20px', border: '1px solid #334155', maxWidth: 360, width: '100%' }}>
          {isTimeLimit ? (
            <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.6, fontSize: 14, textAlign: 'center' }}>
              Solve as many questions as you can in <strong style={{ color: 'white' }}>60 seconds</strong>.<br />
              ✅ Correct = +1 &nbsp; ❌ Wrong = -1 (min 0)
            </p>
          ) : (
            <p style={{ color: '#94a3b8', margin: 0, lineHeight: 1.6, fontSize: 14, textAlign: 'center' }}>
              <strong style={{ color: 'white' }}>10 seconds</strong> per question. Survival mode!<br />
              ✅ Score per correct &nbsp;
              {mode === 'friend' ? '❌ Wrong = -1 penalty' : '❌ 1 wrong = game over'}
            </p>
          )}
        </div>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '14px 50px' }} onClick={() => setStarted(true)}>
          START
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 20, gap: 18 }}>
      <div style={{ display: 'flex', gap: 24, fontSize: 15 }}>
        <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>
          {isTimeLimit ? `Score: ${displayScore}` : `Streak: ${displayScore}`}
        </span>
        {!isTimeLimit && streak >= 3 && (
          <span style={{ color: '#f97316', fontWeight: 'bold' }}>🔥 ×{streak}</span>
        )}
      </div>

      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 5 }}>
          <span>{isTimeLimit ? 'Time Left' : 'Question Timer'}</span>
          <span style={{ color: timerColor, fontWeight: 'bold' }}>{timeLeft}s</span>
        </div>
        <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden', border: '1px solid #334155' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: timerColor, transition: isTimeLimit ? '1s linear' : '0.2s', borderRadius: 3 }} />
        </div>
      </div>

      <div style={{
        fontSize: 'clamp(32px, 8vw, 52px)', fontWeight: 'bold', fontFamily: 'monospace',
        color: feedback === 'correct' ? '#10b981' : feedback === 'wrong' ? '#ef4444' : 'white',
        transition: '0.15s', textAlign: 'center', letterSpacing: 2
      }}>
        {question.q} = ?
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, width: '100%', maxWidth: 380 }}>
        {question.options.map((opt, i) => (
          <button
            key={i}
            className="custom-btn"
            onClick={() => handleAnswer(opt)}
            disabled={answered}
            style={{ padding: '16px 10px', fontSize: 22, transition: '0.15s', opacity: answered ? 0.7 : 1 }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
