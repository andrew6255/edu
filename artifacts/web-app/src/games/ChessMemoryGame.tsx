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
const BOARD_CELL = 54;

function pieceStyle(piece: string): React.CSSProperties {
  const isWhite = WHITE_PIECES.has(piece);
  return {
    fontSize: 34,
    lineHeight: 1,
    color: isWhite ? '#f8fafc' : '#0f172a',
    textShadow: isWhite
      ? '0 2px 0 rgba(15,23,42,0.9), 0 0 8px rgba(255,255,255,0.18)'
      : '0 2px 0 rgba(255,255,255,0.18), 0 0 8px rgba(15,23,42,0.25)',
    filter: isWhite ? 'drop-shadow(0 2px 6px rgba(15,23,42,0.35))' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.35))',
  };
}

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
  const [draggingPiece, setDraggingPiece] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const scoreRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  function startRound() {
    const r = generateRound();
    setRound(r);
    setPlaced(new Map());
    setSelected(null);
    setDraggingPiece(null);
    setDragPoint(null);
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
    if (phase !== 'recall' || !(draggingPiece ?? selected)) return;
    const key = `${r},${c}`;
    const activePiece = draggingPiece ?? selected;
    if (!activePiece) return;
    const correct = round.find(p => p.row === r && p.col === c && p.piece === activePiece);
    const newPlaced = new Map(placed);
    newPlaced.set(key, activePiece);
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
    setDraggingPiece(null);
    setDragPoint(null);
    if (newPlaced.size >= PIECES_PER_ROUND) {
      setTimeout(() => { setTotalPlaced(0); startRound(); }, 800);
    }
  }

  function boardCellFromPoint(clientX: number, clientY: number): { row: number; col: number } | null {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * BOARD);
    const row = Math.floor(((clientY - rect.top) / rect.height) * BOARD);
    if (row < 0 || row >= BOARD || col < 0 || col >= BOARD) return null;
    return { row, col };
  }

  function handlePiecePointerDown(piece: string, e: React.PointerEvent) {
    if (phase !== 'recall') return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(piece);
    setDraggingPiece(piece);
    setDragPoint({ x: e.clientX, y: e.clientY });
  }

  function handlePiecePointerMove(e: React.PointerEvent) {
    if (!draggingPiece) return;
    setDragPoint({ x: e.clientX, y: e.clientY });
  }

  function handlePiecePointerUp(e: React.PointerEvent) {
    if (draggingPiece) {
      const cell = boardCellFromPoint(e.clientX, e.clientY);
      if (cell) {
        clickSquare(cell.row, cell.col);
        return;
      }
    }
    setDraggingPiece(null);
    setDragPoint(null);
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
          {selected ? `Place ${PIECE_LABELS[selected]} on the board` : 'Select or drag a piece below, then place it on the board'}
        </div>
      )}

      {/* Chess board */}
      <div ref={boardRef} style={{ display: 'grid', gridTemplateColumns: `repeat(${BOARD}, 1fr)`, gap: 2, borderRadius: 10, overflow: 'hidden', border: '2px solid #334155', boxShadow: '0 10px 26px rgba(0,0,0,0.25)' }}>
        {Array.from({ length: BOARD * BOARD }, (_, idx) => {
          const r = Math.floor(idx / BOARD);
          const c = idx % BOARD;
          const key = `${r},${c}`;
          const isLight = (r + c) % 2 === 0;
          const targetPiece = targetMap.get(key);
          const placedPiece = placed.get(key);
          const isFlashing = flashCell?.key === key;
          const isCorrect = flashCell?.correct;

          return (
            <button
              key={idx}
              onClick={() => clickSquare(r, c)}
              style={{
                width: BOARD_CELL, height: BOARD_CELL,
                background: isFlashing
                  ? (isCorrect ? '#065f46' : '#7f1d1d')
                  : isLight ? '#e2e8f0' : '#64748b',
                border: selected && phase === 'recall' ? '1px solid rgba(59,130,246,0.45)' : '1px solid rgba(255,255,255,0.03)',
                cursor: phase === 'recall' && (selected || draggingPiece) ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0,
                transition: 'background 0.2s, transform 0.15s, box-shadow 0.15s',
                boxShadow: selected && phase === 'recall' ? 'inset 0 0 0 1px rgba(96,165,250,0.25)' : 'none',
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <span style={pieceStyle((phase === 'memorize' ? targetPiece : placedPiece) ?? '')}>
                {phase === 'memorize' ? targetPiece ?? '' : placedPiece ?? ''}
              </span>
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
              onPointerDown={(e) => handlePiecePointerDown(piece, e)}
              onPointerMove={handlePiecePointerMove}
              onPointerUp={(e) => handlePiecePointerUp(e)}
              onPointerCancel={(e) => handlePiecePointerUp(e)}
              style={{
                width: 56, height: 56, borderRadius: 12, border: 'none',
                background: selected === piece ? 'linear-gradient(180deg, #1d4ed8, #1e3a8a)' : 'linear-gradient(180deg, #1e293b, #0f172a)',
                color: WHITE_PIECES.has(piece) ? '#f1f5f9' : '#0f172a',
                cursor: 'grab',
                outline: selected === piece ? '2px solid #60a5fa' : '2px solid #334155',
                boxShadow: selected === piece ? '0 10px 18px rgba(37,99,235,0.28)' : '0 6px 12px rgba(0,0,0,0.2)',
                transition: 'all 0.15s', padding: 0,
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              <span style={pieceStyle(piece)}>{piece}</span>
            </button>
          ))}
          {remainingPieces.length === 0 && (
            <div style={{ color: '#10b981', fontSize: 13, fontWeight: 'bold' }}>✅ Next round loading…</div>
          )}
        </div>
      )}

      {draggingPiece && dragPoint && (
        <div
          style={{
            position: 'fixed',
            left: dragPoint.x,
            top: dragPoint.y,
            transform: 'translate(-50%, -55%)',
            width: 62,
            height: 62,
            borderRadius: 14,
            background: 'rgba(15,23,42,0.88)',
            border: '2px solid #60a5fa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            boxShadow: '0 14px 28px rgba(37,99,235,0.28)',
            zIndex: 30,
          }}
        >
          <span style={pieceStyle(draggingPiece)}>{draggingPiece}</span>
        </div>
      )}
    </div>
  );
}
