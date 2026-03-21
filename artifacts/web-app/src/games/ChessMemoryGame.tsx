import { useState, useEffect, useRef } from 'react';
import { GameMode } from '@/types/warmup';

interface Props {
  gameId: string;
  mode: GameMode;
  onGameOver: (score: number) => void;
}

const PIECE_LIST = ['♔', '♕', '♖', '♗', '♘', '♙', '♚', '♛', '♜', '♝', '♞', '♟'];
const PIECE_LABELS: Record<string, string> = {
  '♔': 'W.King', '♕': 'W.Queen', '♖': 'W.Rook', '♗': 'W.Bishop', '♘': 'W.Knight', '♙': 'W.Pawn',
  '♚': 'B.King', '♛': 'B.Queen', '♜': 'B.Rook', '♝': 'B.Bishop', '♞': 'B.Knight', '♟': 'B.Pawn',
};
const WHITE_PIECES = new Set(['♔', '♕', '♖', '♗', '♘', '♙']);

const MEMORIZE_SEC = 4;
const PIECES_PER_ROUND = 5;
const TIME_LIMIT = 120;
const BOARD = 6;

interface PiecePlacement {
  piece: string;
  row: number;
  col: number;
}

function generateRound(): PiecePlacement[] {
  const shuffled = [...PIECE_LIST].sort(() => Math.random() - 0.5).slice(0, PIECES_PER_ROUND);
  const used = new Set<string>();
  return shuffled.map(piece => {
    let r, c, key;
    do { r = Math.floor(Math.random() * BOARD); c = Math.floor(Math.random() * BOARD); key = `${r},${c}`; } while (used.has(key));
    used.add(key);
    return { piece, row: r, col: c };
  });
}

type Phase = 'memorize' | 'recall';

export default function ChessMemoryGame({ onGameOver }: Props) {
  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<Phase>('memorize');
  const [round, setRound] = useState<PiecePlacement[]>([]);
  const [countdown, setCountdown] = useState(MEMORIZE_SEC);
  const [placed, setPlaced] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [totalPlaced, setTotalPlaced] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_LIMIT);
  const [flashCell, setFlashCell] = useState<{ key: string; correct: boolean } | null>(null);
  const scoreRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startRound() {
    const r = generateRound();
    setRound(r);
    setPlaced(new Map());
    setSelected(null);
    setPhase('memorize');
    setCountdown(MEMORIZE_SEC);
    clearInterval(cdRef.current!);
    let cd = MEMORIZE_SEC;
    cdRef.current = setInterval(() => {
      cd -= 1;
      setCountdown(cd);
      if (cd <= 0) { clearInterval(cdRef.current!); setPhase('recall'); }
    }, 1000);
  }

  useEffect(() => {
    if (!started) return;
    startRound();
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current!); clearInterval(cdRef.current!); onGameOver(scoreRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { clearInterval(timerRef.current!); clearInterval(cdRef.current!); };
  }, [started]);

  function clickSquare(r: number, c: number) {
    if (phase !== 'recall' || !selected) return;
    const key = `${r},${c}`;
    const correct = round.find(p => p.row === r && p.col === c && p.piece === selected);
    const newPlaced = new Map(placed);
    newPlaced.set(key, selected);
    setPlaced(newPlaced);
    setFlashCell({ key, correct: !!correct });
    setTimeout(() => setFlashCell(null), 400);
    const newTotal = totalPlaced + 1;
    setTotalPlaced(newTotal);
    if (correct) {
      scoreRef.current += 1;
      setScore(s => s + 1);
    }
    setSelected(null);
    if (newPlaced.size >= PIECES_PER_ROUND) {
      setTimeout(() => { setTotalPlaced(0); startRound(); }, 800);
    }
  }

  const targetMap = new Map(round.map(p => [`${p.row},${p.col}`, p.piece]));

  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 24 }}>
        <div style={{ fontSize: 52 }}>♟️</div>
        <div style={{ fontSize: 22, fontWeight: 'bold', color: 'white' }}>Chess Memory</div>
        <div style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
          Memorise {PIECES_PER_ROUND} chess pieces on the board for {MEMORIZE_SEC} seconds. Then place them back in the correct squares! Score per correct placement.
        </div>
        <button className="ll-btn ll-btn-primary" style={{ padding: '14px 44px', fontSize: 16, marginTop: 8 }} onClick={() => setStarted(true)}>
          Start
        </button>
      </div>
    );
  }

  const pct = (timeLeft / TIME_LIMIT) * 100;
  const barColor = timeLeft > 40 ? '#3b82f6' : timeLeft > 15 ? '#f59e0b' : '#ef4444';

  const remainingPieces = round.map(p => p.piece).filter(p => {
    return !Array.from(placed.values()).includes(p);
  });

  return (
    <div style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', maxWidth: 380 }}>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>Score: <span style={{ color: 'white', fontWeight: 'bold' }}>{score}</span></div>
        <div style={{ color: barColor, fontWeight: 'bold', fontSize: 14 }}>{timeLeft}s</div>
      </div>
      <div style={{ width: '100%', maxWidth: 380, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 1s linear' }} />
      </div>

      {phase === 'memorize' ? (
        <div style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: 14 }}>
          Memorise! {countdown}s remaining…
        </div>
      ) : (
        <div style={{ color: selected ? '#3b82f6' : '#94a3b8', fontSize: 13, fontWeight: selected ? 'bold' : 'normal' }}>
          {selected ? `Place ${PIECE_LABELS[selected]} on the board` : 'Select a piece below, then tap its square'}
        </div>
      )}

      {/* Chess board */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD}, 1fr)`, gap: 2, borderRadius: 8, overflow: 'hidden', border: '2px solid #334155' }}>
        {Array.from({ length: BOARD * BOARD }, (_, idx) => {
          const r = Math.floor(idx / BOARD);
          const c = idx % BOARD;
          const key = `${r},${c}`;
          const isLight = (r + c) % 2 === 0;
          const targetPiece = targetMap.get(key);
          const placedPiece = placed.get(key);
          const isFlashing = flashCell?.key === key;
          const isCorrect = flashCell?.correct;
          const isWhite = targetPiece ? WHITE_PIECES.has(targetPiece) : (placedPiece ? WHITE_PIECES.has(placedPiece) : false);

          return (
            <button
              key={idx}
              onClick={() => clickSquare(r, c)}
              style={{
                width: 46, height: 46,
                background: isFlashing
                  ? (isCorrect ? '#065f46' : '#7f1d1d')
                  : isLight ? '#cbd5e1' : '#475569',
                border: selected && phase === 'recall' ? '1px solid rgba(59,130,246,0.4)' : '1px solid transparent',
                cursor: phase === 'recall' && selected ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24, padding: 0,
                transition: 'background 0.2s',
                color: isWhite ? '#0f172a' : '#1e293b',
                textShadow: isWhite ? '0 1px 2px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.5)',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {phase === 'memorize' ? targetPiece ?? '' : placedPiece ?? ''}
            </button>
          );
        })}
      </div>

      {/* Piece picker (recall phase only) */}
      {phase === 'recall' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 380 }}>
          {remainingPieces.map((piece, i) => (
            <button
              key={`${piece}-${i}`}
              onClick={() => setSelected(selected === piece ? null : piece)}
              style={{
                width: 46, height: 46, borderRadius: 10, border: 'none',
                background: selected === piece ? '#1d4ed8' : '#1e293b',
                color: WHITE_PIECES.has(piece) ? '#f1f5f9' : '#94a3b8',
                fontSize: 24, cursor: 'pointer',
                outline: selected === piece ? '2px solid #60a5fa' : '2px solid #334155',
                transition: 'all 0.15s', padding: 0,
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {piece}
            </button>
          ))}
          {remainingPieces.length === 0 && (
            <div style={{ color: '#10b981', fontSize: 13, fontWeight: 'bold' }}>✅ Next round loading…</div>
          )}
        </div>
      )}
    </div>
  );
}
