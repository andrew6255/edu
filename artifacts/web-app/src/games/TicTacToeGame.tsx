import { useState, useEffect, useRef } from 'react';
import { GameMode } from '@/types/warmup';

interface Props {
  gameId: string;
  mode: GameMode;
  onGameOver: (score: number) => void;
}

type Cell = 'X' | 'O' | null;

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function checkWinner(b: Cell[]): 'X' | 'O' | 'draw' | null {
  for (const [a, c, d] of LINES) {
    if (b[a] && b[a] === b[c] && b[c] === b[d]) return b[a] as 'X' | 'O';
  }
  if (b.every(Boolean)) return 'draw';
  return null;
}

function minimax(b: Cell[], isMax: boolean): number {
  const w = checkWinner(b);
  if (w === 'O') return 10;
  if (w === 'X') return -10;
  if (w === 'draw') return 0;
  const moves = b.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0);
  if (isMax) {
    let best = -Infinity;
    for (const i of moves) { b[i] = 'O'; best = Math.max(best, minimax(b, false)); b[i] = null; }
    return best;
  } else {
    let best = Infinity;
    for (const i of moves) { b[i] = 'X'; best = Math.min(best, minimax(b, true)); b[i] = null; }
    return best;
  }
}

function botMove(board: Cell[]): number {
  const b = [...board];
  const moves = b.map((v, i) => (v === null ? i : -1)).filter(i => i >= 0);
  let best = -Infinity, bestMove = moves[0];
  for (const i of moves) {
    b[i] = 'O'; const val = minimax(b, false); b[i] = null;
    if (val > best) { best = val; bestMove = i; }
  }
  return bestMove;
}

function getWinLine(b: Cell[]): number[] | null {
  for (const line of LINES) {
    const [a, c, d] = line;
    if (b[a] && b[a] === b[c] && b[c] === b[d]) return line;
  }
  return null;
}

const TIME_LIMIT = 120;

export default function TicTacToeGame({ onGameOver }: Props) {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [playerTurn, setPlayerTurn] = useState(true);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [draws, setDraws] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [winLine, setWinLine] = useState<number[] | null>(null);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [started, setStarted] = useState(false);
  const winsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!started) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current!); onGameOver(winsRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [started]);

  useEffect(() => {
    if (!started || playerTurn || msg || processingRef.current) return;
    processingRef.current = true;
    const t = setTimeout(() => {
      setBoard(prev => {
        const move = botMove(prev);
        const next = [...prev];
        next[move] = 'O';
        const w = checkWinner(next);
        if (w) {
          setWinLine(getWinLine(next));
          endRound(w, next);
        } else {
          setPlayerTurn(true);
          processingRef.current = false;
        }
        return next;
      });
    }, 500);
    return () => clearTimeout(t);
  }, [playerTurn, started, msg]);

  function endRound(w: 'X' | 'O' | 'draw', _b: Cell[]) {
    if (w === 'X') { winsRef.current += 1; setWins(v => v + 1); setMsg('🎉 You win!'); }
    else if (w === 'O') { setLosses(v => v + 1); setMsg('🤖 Bot wins'); }
    else { setDraws(v => v + 1); setMsg("🤝 Draw!"); }
    setTimeout(() => {
      setBoard(Array(9).fill(null));
      setWinLine(null);
      setMsg(null);
      setPlayerTurn(true);
      processingRef.current = false;
    }, 1300);
  }

  function clickCell(i: number) {
    if (!started || !playerTurn || board[i] || msg || processingRef.current) return;
    const next = [...board];
    next[i] = 'X';
    setBoard(next);
    const w = checkWinner(next);
    if (w) {
      setWinLine(getWinLine(next));
      endRound(w, next);
    } else {
      setPlayerTurn(false);
    }
  }

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 24 }}>
        <div style={{ fontSize: 52 }}>❌⭕</div>
        <div style={{ fontSize: 22, fontWeight: 'bold', color: 'white' }}>Tic Tac Toe</div>
        <div style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
          You are <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>X</span>, the bot is <span style={{ color: '#ef4444', fontWeight: 'bold' }}>O</span>. Beat the bot as many times as you can in 2 minutes!
        </div>
        <button className="ll-btn ll-btn-primary" style={{ padding: '14px 44px', fontSize: 16, marginTop: 8 }} onClick={() => setStarted(true)}>
          Start
        </button>
      </div>
    );
  }

  const pct = (timeLeft / TIME_LIMIT) * 100;
  const barColor = timeLeft > 40 ? '#3b82f6' : timeLeft > 15 ? '#f59e0b' : '#ef4444';
  const msgColor = msg?.includes('win') ? '#10b981' : msg?.includes('Bot') ? '#ef4444' : '#f59e0b';

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, height: '100%', boxSizing: 'border-box', justifyContent: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 300 }}>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          <span style={{ color: '#10b981', fontWeight: 'bold' }}>{wins}W</span>{' '}
          <span style={{ color: '#ef4444' }}>{losses}L</span>{' '}
          <span style={{ color: '#94a3b8' }}>{draws}D</span>
        </div>
        <div style={{ color: barColor, fontWeight: 'bold', fontSize: 15 }}>{timeLeft}s</div>
      </div>
      <div style={{ width: '100%', maxWidth: 300, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 1s linear' }} />
      </div>

      <div style={{ color: msg ? msgColor : (playerTurn ? '#3b82f6' : '#94a3b8'), fontSize: 14, fontWeight: 'bold', minHeight: 22, transition: 'color 0.2s' }}>
        {msg ?? (playerTurn ? 'Your turn (X)' : '🤖 Bot is thinking…')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {board.map((cell, i) => {
          const isWinCell = winLine?.includes(i);
          return (
            <button
              key={i}
              onClick={() => clickCell(i)}
              style={{
                width: 84, height: 84, borderRadius: 12,
                background: isWinCell ? (cell === 'X' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)') : '#1e293b',
                border: `2px solid ${isWinCell ? (cell === 'X' ? '#10b981' : '#ef4444') : '#334155'}`,
                color: cell === 'X' ? '#3b82f6' : '#ef4444',
                fontSize: 40, fontWeight: 'bold', cursor: cell || msg ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', padding: 0,
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {cell}
            </button>
          );
        })}
      </div>

      <div style={{ color: '#334155', fontSize: 11 }}>Wins count as your score</div>
    </div>
  );
}
