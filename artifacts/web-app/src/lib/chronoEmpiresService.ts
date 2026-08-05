import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

function nowIso(): string {
  return new Date().toISOString();
}

function clampBoardId(boardId: number): number {
  return Math.max(100, Math.min(3000, Math.round(boardId)));
}

export async function getChronoBoardProgress(uid: string, boardId: number): Promise<ChronoEmpiresBoardProgressDoc | null> {
  const b = clampBoardId(boardId);
  const raw = await getUserDoc(uid, 'chrono_board', String(b));
  if (!raw) return null;
  const data = raw as Partial<ChronoEmpiresBoardProgressDoc>;
  const position = typeof data.position === 'number' && Number.isFinite(data.position) ? Math.max(0, Math.floor(data.position)) : 0;
  const lastRoll = typeof data.lastRoll === 'number' && Number.isFinite(data.lastRoll) ? Math.max(1, Math.min(6, Math.floor(data.lastRoll))) : undefined;
  const jailTurnsRemaining = typeof data.jailTurnsRemaining === 'number' && Number.isFinite(data.jailTurnsRemaining) ? Math.max(0, Math.min(9, Math.floor(data.jailTurnsRemaining))) : 0;
  const extraRolls = typeof data.extraRolls === 'number' && Number.isFinite(data.extraRolls) ? Math.max(0, Math.min(9, Math.floor(data.extraRolls))) : 0;
  const lastEvent = typeof data.lastEvent === 'string' ? data.lastEvent : undefined;
  return {
    id: String(b),
    boardId: b,
    position,
    lastRoll,
    jailTurnsRemaining,
    extraRolls,
    lastEvent,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
  };
}

export async function ensureChronoBoardProgress(uid: string, boardId: number): Promise<ChronoEmpiresBoardProgressDoc> {
  const b = clampBoardId(boardId);
  const existing = await getChronoBoardProgress(uid, b);
  if (existing) return existing;
  const init: ChronoEmpiresBoardProgressDoc = { id: String(b), boardId: b, position: 0, jailTurnsRemaining: 0, extraRolls: 0, updatedAt: nowIso() };
  await setUserDoc(uid, 'chrono_board', String(b), init as any);
  return init;
}

export type ChronoEmpiresRollTurnResult = {
  progress: ChronoEmpiresBoardProgressDoc;
  gold: number;
};

export async function rollBoardTurn(
  uid: string,
  boardId: number,
  tilesCount: number,
  opts?: { rng?: () => number; payBail?: boolean }
): Promise<ChronoEmpiresRollTurnResult | null> {
  const b = clampBoardId(boardId);
  void uid; void tilesCount; void opts?.rng;
  const turnId=typeof crypto.randomUUID==='function'?crypto.randomUUID():`${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const {rollChronoBoard}=await import('@/lib/economyApiService');
  const result=await rollChronoBoard(b,Boolean(opts?.payBail),turnId);
  return {progress:result.progress as unknown as ChronoEmpiresBoardProgressDoc,gold:result.gold};
}

export type ChronoEmpiresStateDoc = {
  id: 'global';
  currentBoard: number;
  updatedAt: string;
};

export type ChronoEmpiresBoardProgressDoc = {
  id: string;
  boardId: number;
  position: number;
  lastRoll?: number;
  jailTurnsRemaining: number;
  extraRolls: number;
  lastEvent?: string;
  updatedAt: string;
};

export async function getChronoEmpiresState(uid: string): Promise<ChronoEmpiresStateDoc | null> {
  const raw = await getUserDoc(uid, 'chrono_empires', 'global');
  if (!raw) return null;
  const data = raw as Partial<ChronoEmpiresStateDoc>;
  const currentBoard = typeof data.currentBoard === 'number' && Number.isFinite(data.currentBoard)
    ? Math.max(100, Math.min(3000, Math.round(data.currentBoard)))
    : 100;
  return {
    id: 'global',
    currentBoard,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
  };
}

export async function ensureChronoEmpiresState(uid: string): Promise<ChronoEmpiresStateDoc> {
  const existing = await getChronoEmpiresState(uid);
  if (existing) return existing;
  const init: ChronoEmpiresStateDoc = { id: 'global', currentBoard: 100, updatedAt: nowIso() };
  await setUserDoc(uid, 'chrono_empires', 'global', init as any);
  return init;
}

export async function setCurrentBoard(uid: string, board: number): Promise<void> {
  const next = Math.max(100, Math.min(3000, Math.round(board)));
  await updateUserDoc(uid, 'chrono_empires', 'global', {
    currentBoard: next,
    updatedAt: nowIso(),
  });
}

export async function bumpBoardIfAt(uid: string, expectedBoard: number, nextBoard: number): Promise<void> {
  const raw = await getUserDoc(uid, 'chrono_empires', 'global');
  if (!raw) {
    await setUserDoc(uid, 'chrono_empires', 'global', { id: 'global', currentBoard: 100, updatedAt: nowIso() } as any);
    return;
  }
  const cur = typeof (raw as any).currentBoard === 'number' ? (raw as any).currentBoard : 100;
  if (cur !== expectedBoard) return;
  await updateUserDoc(uid, 'chrono_empires', 'global', { currentBoard: Math.max(100, Math.min(3000, Math.round(nextBoard))), updatedAt: nowIso() });
}
