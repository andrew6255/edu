import { useState, useRef, useCallback } from 'react';
import { GameMode } from '@/types/warmup';

interface GameProps { gameId: string; mode: GameMode; onGameOver: (score: number) => void; }

/* ── Constants ─────────────────────────────────────────────────────────────── */
const SIZE = 8;
const CELL = 40;
const GAP = 2;
const PAD = 4;
const TRAY_CELL = 20;

type Board = (string | null)[][];
type Shape = { cells: number[][]; color: string };

/* ── Block Blast Shapes ────────────────────────────────────────────────────── */
const SHAPES: Shape[] = [
  // Singles / small
  { cells: [[0,0]], color: '#fbbf24' },
  { cells: [[0,0],[1,0]], color: '#3b82f6' },
  { cells: [[0,0],[0,1]], color: '#3b82f6' },
  { cells: [[0,0],[1,0],[2,0]], color: '#06b6d4' },
  { cells: [[0,0],[0,1],[0,2]], color: '#06b6d4' },
  // 2x2
  { cells: [[0,0],[1,0],[0,1],[1,1]], color: '#fbbf24' },
  // L shapes
  { cells: [[0,0],[0,1],[1,1]], color: '#f97316' },
  { cells: [[1,0],[0,1],[1,1]], color: '#f97316' },
  { cells: [[0,0],[1,0],[0,1]], color: '#f97316' },
  { cells: [[0,0],[1,0],[1,1]], color: '#f97316' },
  // T shapes
  { cells: [[0,0],[1,0],[2,0],[1,1]], color: '#8b5cf6' },
  { cells: [[1,0],[0,1],[1,1],[1,2]], color: '#8b5cf6' },
  { cells: [[1,0],[0,1],[1,1],[2,1]], color: '#8b5cf6' },
  { cells: [[0,0],[0,1],[1,1],[0,2]], color: '#8b5cf6' },
  // Long bars
  { cells: [[0,0],[1,0],[2,0],[3,0]], color: '#10b981' },
  { cells: [[0,0],[0,1],[0,2],[0,3]], color: '#10b981' },
  { cells: [[0,0],[1,0],[2,0],[3,0],[4,0]], color: '#ec4899' },
  { cells: [[0,0],[0,1],[0,2],[0,3],[0,4]], color: '#ec4899' },
  // S / Z
  { cells: [[0,0],[1,0],[1,1],[2,1]], color: '#ef4444' },
  { cells: [[1,0],[0,1],[1,1],[0,2]], color: '#ef4444' },
  { cells: [[1,0],[2,0],[0,1],[1,1]], color: '#22d3ee' },
  { cells: [[0,0],[0,1],[1,1],[1,2]], color: '#22d3ee' },
  // Big L shapes
  { cells: [[0,0],[0,1],[0,2],[1,2]], color: '#a855f7' },
  { cells: [[0,0],[1,0],[2,0],[0,1]], color: '#a855f7' },
  { cells: [[0,0],[1,0],[1,1],[1,2]], color: '#a855f7' },
  { cells: [[2,0],[0,1],[1,1],[2,1]], color: '#a855f7' },
  // 3x3
  { cells: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1],[0,2],[1,2],[2,2]], color: '#f43f5e' },
];

function randomShape(): Shape {
  const s = SHAPES[Math.floor(Math.random() * SHAPES.length)];
  return { cells: s.cells.map(c => [...c]), color: s.color };
}

function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function randomTray(): (Shape | null)[] {
  return [randomShape(), randomShape(), randomShape()];
}

function canPlace(board: Board, shape: Shape, ox: number, oy: number): boolean {
  return shape.cells.every(([cx, cy]) => {
    const x = ox + cx, y = oy + cy;
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE && !board[y][x];
  });
}

function place(board: Board, shape: Shape, ox: number, oy: number): Board {
  const nb = board.map(r => [...r]);
  shape.cells.forEach(([cx, cy]) => { nb[oy + cy][ox + cx] = shape.color; });
  return nb;
}

/* Find which rows/cols would be cleared on this board */
function findFullLines(board: Board): { rows: Set<number>; cols: Set<number> } {
  const rows = new Set<number>();
  const cols = new Set<number>();
  for (let r = 0; r < SIZE; r++) { if (board[r].every(c => c !== null)) rows.add(r); }
  for (let c = 0; c < SIZE; c++) { if (board.every(row => row[c] !== null)) cols.add(c); }
  return { rows, cols };
}

function clearLines(board: Board): [Board, number] {
  const { rows, cols } = findFullLines(board);
  const cleared = rows.size + cols.size;
  if (cleared === 0) return [board, 0];
  const nb = board.map(r => [...r]);
  rows.forEach(r => { for (let c = 0; c < SIZE; c++) nb[r][c] = null; });
  cols.forEach(c => { for (let r = 0; r < SIZE; r++) nb[r][c] = null; });
  return [nb, cleared];
}

function anyFits(board: Board, tray: (Shape | null)[]): boolean {
  return tray.some(s => {
    if (!s) return false;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if (canPlace(board, s, x, y)) return true;
    return false;
  });
}

function shapeBounds(s: Shape) {
  let mx = 0, my = 0;
  s.cells.forEach(([cx, cy]) => { mx = Math.max(mx, cx); my = Math.max(my, cy); });
  return { w: mx + 1, h: my + 1 };
}

/* Find best placement origin that keeps the shape centered on cell (cx,cy) */
function bestGhostPos(board: Board, shape: Shape, cellX: number, cellY: number): { x: number; y: number } | null {
  const bounds = shapeBounds(shape);
  // Try centered first, then nearby offsets in a spiral
  const offsets: [number, number][] = [[0, 0]];
  for (let d = 1; d <= 3; d++) {
    for (let dx = -d; dx <= d; dx++) {
      for (let dy = -d; dy <= d; dy++) {
        if (Math.abs(dx) === d || Math.abs(dy) === d) offsets.push([dx, dy]);
      }
    }
  }
  for (const [dx, dy] of offsets) {
    const ox = cellX - Math.floor(bounds.w / 2) + dx;
    const oy = cellY - Math.floor(bounds.h / 2) + dy;
    if (canPlace(board, shape, ox, oy)) return { x: ox, y: oy };
  }
  return null;
}

/* ── Component ─────────────────────────────────────────────────────────────── */
export default function BlockPuzzleGame({ onGameOver }: GameProps) {
  const [board, setBoard] = useState<Board>(emptyBoard());
  const [tray, setTray] = useState<(Shape | null)[]>(randomTray());
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [linesCleared, setLinesCleared] = useState(0);

  // Drag / select state
  const [selected, setSelected] = useState<number | null>(null);  // tap-to-select mode
  const [dragging, setDragging] = useState<number | null>(null);  // pointer-drag mode
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);

  const getBoardCell = useCallback((clientX: number, clientY: number) => {
    if (!boardRef.current) return null;
    const rect = boardRef.current.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - PAD) / (CELL + GAP));
    const y = Math.floor((clientY - rect.top - PAD) / (CELL + GAP));
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    return { x, y };
  }, []);

  const activeIdx = dragging ?? selected;
  const activeShape = activeIdx !== null ? tray[activeIdx] : null;

  /* ── Place the active piece and update state ─────────────────────────────── */
  function commitPlace(idx: number, pos: { x: number; y: number }) {
    const shape = tray[idx];
    if (!shape || !canPlace(board, shape, pos.x, pos.y)) return;
    let nb = place(board, shape, pos.x, pos.y);
    const placePts = shape.cells.length;
    const [cleared, lines] = clearLines(nb);
    nb = cleared;
    const newCombo = lines > 0 ? combo + 1 : 0;
    const linePts = lines > 0 ? lines * lines * 100 + (newCombo > 1 ? newCombo * 50 : 0) : 0;

    setBoard(nb);
    setScore(s => s + placePts * 10 + linePts);
    setCombo(newCombo);
    setLinesCleared(l => l + lines);

    const newTray = [...tray];
    newTray[idx] = null;
    const nextTray = newTray.every(s => s === null) ? randomTray() : newTray;
    setTray(nextTray);
    setSelected(null);
    setDragging(null);
    setGhostPos(null);

    if (!anyFits(nb, nextTray)) setOver(true);
  }

  /* ── Drag handlers ───────────────────────────────────────────────────────── */
  function handleTrayPointerDown(idx: number, e: React.PointerEvent) {
    if (over || !tray[idx]) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(idx);
    setSelected(null);
    setGhostPos(null);
    didDragRef.current = false;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (dragging === null) return;
    didDragRef.current = true;
    const shape = tray[dragging];
    if (!shape) return;
    const cell = getBoardCell(e.clientX, e.clientY);
    if (!cell) { setGhostPos(null); return; }
    setGhostPos(bestGhostPos(board, shape, cell.x, cell.y));
  }

  function handlePointerUp() {
    if (dragging !== null) {
      if (ghostPos) {
        commitPlace(dragging, ghostPos);
      } else if (!didDragRef.current) {
        // User just tapped on a tray piece without dragging → select it
        setSelected(dragging);
        setDragging(null);
      } else {
        setDragging(null);
        setGhostPos(null);
      }
    }
  }

  /* ── Board click handler (for tap-to-select mode) ────────────────────────── */
  function handleBoardClick(e: React.MouseEvent) {
    if (selected === null || !activeShape) return;
    const cell = getBoardCell(e.clientX, e.clientY);
    if (!cell) return;
    const pos = bestGhostPos(board, activeShape, cell.x, cell.y);
    if (pos) commitPlace(selected, pos);
  }

  function handleBoardHover(e: React.MouseEvent) {
    if (selected === null || !activeShape) return;
    const cell = getBoardCell(e.clientX, e.clientY);
    if (!cell) { setGhostPos(null); return; }
    setGhostPos(bestGhostPos(board, activeShape, cell.x, cell.y));
  }

  /* ── Build display board with ghost + line-clear preview ─────────────────── */
  const displayBoard: Board = board.map(r => [...r]);
  const ghostCellSet = new Set<string>();
  const clearPreviewSet = new Set<string>();

  if (activeShape && ghostPos) {
    // Add ghost cells to display board
    activeShape.cells.forEach(([cx, cy]) => {
      const x = ghostPos.x + cx, y = ghostPos.y + cy;
      if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) {
        displayBoard[y][x] = activeShape.color;
        ghostCellSet.add(`${y}-${x}`);
      }
    });
    // Check which rows/cols would clear after placing
    const { rows, cols } = findFullLines(displayBoard);
    rows.forEach(r => { for (let c = 0; c < SIZE; c++) clearPreviewSet.add(`${r}-${c}`); });
    cols.forEach(c => { for (let r = 0; r < SIZE; r++) clearPreviewSet.add(`${r}-${c}`); });
  }

  /* ── Screens ─────────────────────────────────────────────────────────────── */
  if (!started) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 30 }}>
        <div style={{ fontSize: 64 }}>🟦</div>
        <h2 style={{ margin: 0, fontSize: 28, color: 'white' }}>Block Blast</h2>
        <p style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
          Drag blocks onto the 8×8 grid. Fill entire <strong style={{ color: '#f8fafc' }}>rows or columns</strong> to clear them.
          Game ends when no piece can fit!
        </p>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 18, padding: '16px 50px' }} onClick={() => setStarted(true)}>
          START
        </button>
      </div>
    );
  }

  if (over) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20 }}>
        <div style={{ fontSize: 64 }}>💀</div>
        <h2 style={{ color: '#ef4444', margin: 0 }}>Game Over</h2>
        <div style={{ fontSize: 28, fontWeight: 'bold', color: '#fbbf24' }}>Score: {score}</div>
        <div style={{ color: '#94a3b8' }}>Lines cleared: {linesCleared}{combo > 1 ? ` · Best combo ×${combo}` : ''}</div>
        <button className="ll-btn ll-btn-primary" style={{ fontSize: 16, padding: '14px 40px' }} onClick={() => onGameOver(score)}>
          Continue
        </button>
      </div>
    );
  }

  /* ── Main Game ───────────────────────────────────────────────────────────── */
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 10, userSelect: 'none', touchAction: 'none' }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Score bar */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1 }}>SCORE</div>
          <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 22 }}>{score}</div>
        </div>
        {combo > 1 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1 }}>COMBO</div>
            <div style={{ color: '#f97316', fontWeight: 'bold', fontSize: 22 }}>×{combo}</div>
          </div>
        )}
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: '#94a3b8', fontSize: 11, letterSpacing: 1 }}>LINES</div>
          <div style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: 22 }}>{linesCleared}</div>
        </div>
      </div>

      {/* Board */}
      <div
        ref={boardRef}
        onClick={handleBoardClick}
        onMouseMove={handleBoardHover}
        onMouseLeave={() => { if (selected !== null) setGhostPos(null); }}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${SIZE}, ${CELL}px)`,
          gridTemplateRows: `repeat(${SIZE}, ${CELL}px)`,
          gap: GAP,
          background: '#0f172a',
          border: '2px solid #334155',
          borderRadius: 10,
          padding: PAD,
        }}
      >
        {displayBoard.flatMap((row, ri) => row.map((cell, ci) => {
          const key = `${ri}-${ci}`;
          const isGhost = ghostCellSet.has(key);
          const willClear = clearPreviewSet.has(key);
          return (
            <div key={key} style={{
              width: CELL, height: CELL,
              background: cell
                ? willClear
                  ? '#ffffff'
                  : isGhost ? cell + 'bb' : cell
                : 'rgba(255,255,255,0.03)',
              borderRadius: 4,
              boxShadow: cell
                ? willClear
                  ? '0 0 8px rgba(255,255,255,0.5)'
                  : `inset 0 0 ${isGhost ? '12px' : '6px'} rgba(255,255,255,${isGhost ? 0.25 : 0.1})`
                : 'none',
              transition: 'background 0.1s, box-shadow 0.1s',
            }} />
          );
        }))}
      </div>

      {/* Tray — 3 pieces */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'center', minHeight: 80 }}>
        {tray.map((shape, idx) => {
          if (!shape) return <div key={idx} style={{ width: 70, height: 70 }} />;
          const bounds = shapeBounds(shape);
          const isActive = idx === selected || idx === dragging;
          return (
            <div
              key={idx}
              onPointerDown={(e) => handleTrayPointerDown(idx, e)}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${bounds.w}, ${TRAY_CELL}px)`,
                gridTemplateRows: `repeat(${bounds.h}, ${TRAY_CELL}px)`,
                gap: 2,
                padding: 8,
                borderRadius: 10,
                background: isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                border: `2px solid ${isActive ? '#a855f7' : '#334155'}`,
                cursor: 'grab',
                opacity: dragging === idx ? 0.5 : 1,
                transform: isActive ? 'scale(1.05)' : 'scale(1)',
                transition: 'opacity 0.15s, border 0.15s, transform 0.15s',
              }}
            >
              {Array.from({ length: bounds.h }, (_, r) =>
                Array.from({ length: bounds.w }, (_, c) => {
                  const filled = shape.cells.some(([cx, cy]) => cx === c && cy === r);
                  return (
                    <div key={`${r}-${c}`} style={{
                      width: TRAY_CELL, height: TRAY_CELL,
                      borderRadius: 3,
                      background: filled ? shape.color : 'transparent',
                      boxShadow: filled ? 'inset 0 0 4px rgba(255,255,255,0.15)' : 'none',
                    }} />
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {/* Hint text */}
      {selected !== null && (
        <div style={{ color: '#64748b', fontSize: 11, textAlign: 'center' }}>
          Tap the board to place · Tap another piece to switch
        </div>
      )}
    </div>
  );
}
