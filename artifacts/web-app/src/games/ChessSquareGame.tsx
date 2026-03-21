import { useState, useEffect, useRef, useCallback } from 'react';
import { GameMode } from '@/types/warmup';

// Chess coordinate helpers
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1']; // top to bottom visually

function colRow(sq: string): [number, number] {
  const f = FILES.indexOf(sq[0]);
  const r = RANKS.indexOf(sq[1]);
  return [f, r];
}

function randomSquare(): string {
  return FILES[Math.floor(Math.random() * 8)] + (Math.floor(Math.random() * 8) + 1);
}

function isDark(col: number, row: number): boolean {
  return (col + row) % 2 === 1;
}

interface Props {
  gameId: string;
  mode: GameMode;
  onGameOver: (score: number) => void;
  variant: 'name' | 'find';
  timeMode: '10s' | '60s';
}

export default function ChessSquareGame({ gameId, mode, onGameOver, variant, timeMode }: Props) {
  const CELL = 44;
  const timeLimit = timeMode === '10s' ? 10 : 60;

  const [score, setScore] = useState(0);
  const [questionCount, setQuestionCount] = useState(0);
  const [currentSquare, setCurrentSquare] = useState(() => randomSquare());
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const [gameOver, setGameOver] = useState(false);
  const [wrongAnim, setWrongAnim] = useState(false);
  const [clickedCell, setClickedCell] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const TOTAL_QUESTIONS = timeMode === '10s' ? null : null; // unlimited in 60s mode

  const endGame = useCallback((finalScore: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setGameOver(true);
    setTimeout(() => onGameOver(finalScore), 1000);
  }, [onGameOver]);

  useEffect(() => {
    if (gameOver) return;
    if (timeMode === '60s') {
      timerRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) { endGame(score); return 0; }
          return t - 1;
        });
      }, 1000);
    } else {
      // 10s per question
      timerRef.current = setInterval(() => {
        setTimeLeft(t => {
          if (t <= 1) {
            // Time's up for this question — wrong
            setFeedback('wrong');
            setWrongAnim(true);
            setTimeout(() => { setWrongAnim(false); setFeedback(null); nextQuestion(); }, 700);
            return timeLimit;
          }
          return t - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameOver, currentSquare]);

  function nextQuestion(newScore?: number) {
    setCurrentSquare(randomSquare());
    setInput('');
    setClickedCell(null);
    setFeedback(null);
    if (timeMode === '10s') setTimeLeft(timeLimit);
    setQuestionCount(q => q + 1);
  }

  function resetTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(timeLimit);
  }

  function handleCorrect(newScore: number) {
    setFeedback('correct');
    setScore(newScore);
    if (timeMode === '10s') {
      setTimeout(() => {
        setFeedback(null);
        nextQuestion(newScore);
        resetTimer();
      }, 500);
    } else {
      setTimeout(() => { setFeedback(null); nextQuestion(newScore); }, 300);
    }
  }

  function handleWrong() {
    if (timeMode === '60s') {
      setFeedback('wrong');
      setWrongAnim(true);
      setTimeout(() => { setWrongAnim(false); setFeedback(null); }, 600);
    } else {
      setFeedback('wrong');
      setWrongAnim(true);
      setTimeout(() => { setWrongAnim(false); setFeedback(null); nextQuestion(); resetTimer(); }, 700);
    }
  }

  // ── Name variant: type the coordinate of the highlighted square ──
  function handleSubmitName(e: React.FormEvent) {
    e.preventDefault();
    const val = input.trim().toLowerCase();
    if (!val) return;
    if (val === currentSquare) {
      handleCorrect(score + 1);
    } else {
      handleWrong();
      setInput('');
    }
  }

  // ── Find variant: click the correct square ──
  function handleClickCell(sq: string) {
    if (feedback || gameOver) return;
    setClickedCell(sq);
    if (sq === currentSquare) {
      handleCorrect(score + 1);
    } else {
      handleWrong();
      setClickedCell(null);
    }
  }

  const [col, row] = colRow(currentSquare);
  const timerPct = (timeLeft / timeLimit) * 100;
  const timerColor = timerPct > 50 ? '#10b981' : timerPct > 25 ? '#fbbf24' : '#ef4444';

  if (gameOver) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0f172a' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏁</div>
          <div style={{ color: 'white', fontSize: 22, fontWeight: 'bold' }}>Final Score: {score}</div>
          <div style={{ color: '#64748b', fontSize: 14, marginTop: 6 }}>{questionCount} questions</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', alignItems: 'center', padding: '12px 12px 8px', overflow: 'hidden' }}>
      {/* HUD */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', maxWidth: 400, marginBottom: 8 }}>
        <div style={{ background: '#1e293b', borderRadius: 8, padding: '6px 14px', textAlign: 'center', border: '1px solid #334155' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#10b981' }}>{score}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>Score</div>
        </div>
        {/* Timer */}
        <div style={{ background: '#1e293b', borderRadius: 8, padding: '6px 14px', textAlign: 'center', border: `1px solid ${timerColor}44` }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: timerColor }}>{timeLeft}s</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{timeMode === '60s' ? 'Total' : 'Per Q'}</div>
        </div>
        <div style={{ background: '#1e293b', borderRadius: 8, padding: '6px 14px', textAlign: 'center', border: '1px solid #334155' }}>
          <div style={{ fontSize: 18, fontWeight: 'bold', color: '#94a3b8' }}>#{questionCount + 1}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>Q</div>
        </div>
      </div>

      {/* Timer bar */}
      <div style={{ width: '100%', maxWidth: 400, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${timerPct}%`, height: '100%', background: timerColor, transition: '1s linear', borderRadius: 3 }} />
      </div>

      {/* Instruction */}
      <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10, textAlign: 'center' }}>
        {variant === 'name'
          ? <><span style={{ color: '#fbbf24', fontWeight: 'bold' }}>Name</span> the highlighted square</>
          : <><span style={{ color: '#fbbf24', fontWeight: 'bold' }}>Find</span> square <span style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: 18 }}>{currentSquare}</span></>
        }
      </div>

      {/* Chessboard */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(8, ${CELL}px)`, gridTemplateRows: `repeat(8, ${CELL}px)`,
        border: '2px solid #475569', borderRadius: 8, overflow: 'hidden', flexShrink: 0,
        boxShadow: wrongAnim ? '0 0 20px rgba(239,68,68,0.6)' : feedback === 'correct' ? '0 0 20px rgba(16,185,129,0.5)' : 'none',
        transition: 'box-shadow 0.2s'
      }}>
        {RANKS.map((rank, r) =>
          FILES.map((file, c) => {
            const sq = file + rank;
            const isHighlight = variant === 'name' && sq === currentSquare;
            const isTarget = variant === 'find' && sq === currentSquare;
            const isClicked = clickedCell === sq;
            const dark = isDark(c, r);

            let bg = dark ? '#b58863' : '#f0d9b5';
            if (isHighlight) bg = feedback === 'wrong' ? '#ef4444' : feedback === 'correct' ? '#10b981' : '#3b82f6';
            if (variant === 'find' && isClicked && !isTarget) bg = '#ef4444';
            if (variant === 'find' && isClicked && isTarget) bg = '#10b981';

            return (
              <div
                key={sq}
                onClick={() => variant === 'find' && handleClickCell(sq)}
                style={{
                  width: CELL, height: CELL, background: bg, position: 'relative',
                  cursor: variant === 'find' ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s',
                  boxSizing: 'border-box',
                  border: isTarget && variant === 'find' ? '2px solid transparent' : 'none',
                }}
              >
                {c === 0 && (
                  <span style={{ position: 'absolute', top: 2, left: 3, fontSize: 9, color: dark ? '#f0d9b5' : '#b58863', fontWeight: 'bold', userSelect: 'none' }}>
                    {rank}
                  </span>
                )}
                {r === 7 && (
                  <span style={{ position: 'absolute', bottom: 1, right: 3, fontSize: 9, color: dark ? '#f0d9b5' : '#b58863', fontWeight: 'bold', userSelect: 'none' }}>
                    {file}
                  </span>
                )}
                {isHighlight && (
                  <div style={{ width: CELL * 0.6, height: CELL * 0.6, borderRadius: '50%', background: 'rgba(255,255,255,0.4)', border: '2px solid white' }} />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Name input */}
      {variant === 'name' && (
        <form onSubmit={handleSubmitName} style={{ marginTop: 14, display: 'flex', gap: 8, width: '100%', maxWidth: 320 }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value.toLowerCase())}
            placeholder="Type e.g. e4, a1…"
            maxLength={2}
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1, padding: '11px 14px', borderRadius: 8, fontSize: 18, fontFamily: 'monospace',
              border: `2px solid ${feedback === 'correct' ? '#10b981' : feedback === 'wrong' ? '#ef4444' : '#475569'}`,
              background: 'rgba(0,0,0,0.4)', color: 'white', outline: 'none', textAlign: 'center',
              letterSpacing: 3, transition: '0.2s', textTransform: 'lowercase'
            }}
          />
          <button type="submit" className="ll-btn ll-btn-primary" style={{ padding: '11px 18px', fontSize: 16 }}>
            ✓
          </button>
        </form>
      )}

      {feedback && (
        <div style={{ marginTop: 8, fontSize: 20, color: feedback === 'correct' ? '#10b981' : '#ef4444', fontWeight: 'bold', animation: 'fadeIn 0.15s ease' }}>
          {feedback === 'correct' ? '✓ Correct!' : `✗ It was ${currentSquare}`}
        </div>
      )}
    </div>
  );
}

// ── 4 exported wrappers ──────────────────────────────────────────────────────

export function NameSquare10Game(props: { gameId: string; mode: GameMode; onGameOver: (s: number) => void }) {
  return <ChessSquareGame {...props} variant="name" timeMode="10s" />;
}
export function NameSquare60Game(props: { gameId: string; mode: GameMode; onGameOver: (s: number) => void }) {
  return <ChessSquareGame {...props} variant="name" timeMode="60s" />;
}
export function FindSquare10Game(props: { gameId: string; mode: GameMode; onGameOver: (s: number) => void }) {
  return <ChessSquareGame {...props} variant="find" timeMode="10s" />;
}
export function FindSquare60Game(props: { gameId: string; mode: GameMode; onGameOver: (s: number) => void }) {
  return <ChessSquareGame {...props} variant="find" timeMode="60s" />;
}
