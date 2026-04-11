import { db } from '@/lib/firebase';
import { doc, getDoc, runTransaction, setDoc, updateDoc } from 'firebase/firestore';

function nowIso(): string {
  return new Date().toISOString();
}

function clampBoardId(boardId: number): number {
  return Math.max(100, Math.min(3000, Math.round(boardId)));
}

export async function getChronoBoardProgress(uid: string, boardId: number): Promise<ChronoEmpiresBoardProgressDoc | null> {
  const b = clampBoardId(boardId);
  const snap = await getDoc(doc(db, 'users', uid, 'chrono_empires', 'global', 'boards', String(b)));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<ChronoEmpiresBoardProgressDoc>;
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
  await setDoc(doc(db, 'users', uid, 'chrono_empires', 'global', 'boards', String(b)), init as any);
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
  const count = Math.max(1, Math.floor(tilesCount));
  const progRef = doc(db, 'users', uid, 'chrono_empires', 'global', 'boards', String(b));
  const userRef = doc(db, 'users', uid);

  const GO_GOLD = 200;
  const BAIL_GOLD = 100;
  const JAIL_TURNS = 1;
  // 28-slot board: corners at 0 (Main Gate), 7 (Zahma), 14 (El Ahwa), 21 (El Lagna)

  return runTransaction(db, async (tx) => {
    const [pSnap, uSnap] = await Promise.all([tx.get(progRef), tx.get(userRef)]);
    if (!uSnap.exists()) return null;
    if (!pSnap.exists()) {
      tx.set(progRef, { id: String(b), boardId: b, position: 0, jailTurnsRemaining: 0, extraRolls: 0, updatedAt: nowIso() } as any);
      return null;
    }

    const pData = pSnap.data() as any;
    const uData = uSnap.data() as any;

    const curPos = typeof pData.position === 'number' && Number.isFinite(pData.position) ? Math.max(0, Math.floor(pData.position)) : 0;
    const curJail = typeof pData.jailTurnsRemaining === 'number' && Number.isFinite(pData.jailTurnsRemaining) ? Math.max(0, Math.min(9, Math.floor(pData.jailTurnsRemaining))) : 0;
    const curExtra = typeof pData.extraRolls === 'number' && Number.isFinite(pData.extraRolls) ? Math.max(0, Math.min(9, Math.floor(pData.extraRolls))) : 0;

    const econ = (uData.economy && typeof uData.economy === 'object') ? uData.economy : {};
    const curGold = typeof econ.gold === 'number' && Number.isFinite(econ.gold) ? Math.max(0, Math.floor(econ.gold)) : 0;

    let nextGold = curGold;
    let nextPos = curPos;
    let nextJail = curJail;
    let nextExtra = curExtra;
    let lastRoll: number | undefined = undefined;
    let lastEvent = '';

    const payBail = Boolean(opts?.payBail);
    if (curJail > 0) {
      if (payBail) {
        if (curGold < BAIL_GOLD) {
          lastEvent = `Not enough coins to pay bail (need ${BAIL_GOLD}).`;
          const blocked: ChronoEmpiresBoardProgressDoc = {
            id: String(b),
            boardId: b,
            position: curPos,
            lastRoll: undefined,
            jailTurnsRemaining: curJail,
            extraRolls: curExtra,
            lastEvent,
            updatedAt: nowIso(),
          };
          tx.set(progRef, blocked as any, { merge: true } as any);
          return { progress: blocked, gold: curGold };
        }
        nextGold = curGold - BAIL_GOLD;
        nextJail = 0;
        lastEvent = `Paid bail (-${BAIL_GOLD}).`;
      } else {
        nextJail = Math.max(0, curJail - 1);
        lastEvent = 'Maintenance Mode: turn skipped.';
        const skipped: ChronoEmpiresBoardProgressDoc = {
          id: String(b),
          boardId: b,
          position: curPos,
          lastRoll: undefined,
          jailTurnsRemaining: nextJail,
          extraRolls: curExtra,
          lastEvent,
          updatedAt: nowIso(),
        };
        tx.set(progRef, skipped as any, { merge: true } as any);
        return { progress: skipped, gold: curGold };
      }
    }

    const rng = opts?.rng ?? Math.random;
    const die1 = Math.max(1, Math.min(6, Math.floor(rng() * 6) + 1));
    const die2 = Math.max(1, Math.min(6, Math.floor(rng() * 6) + 1));
    const roll = die1 + die2;
    lastRoll = roll;
    const oldPos = curPos;
    nextPos = (curPos + roll) % count;

    if (curExtra > 0) nextExtra = Math.max(0, curExtra - 1);

    // Pass GO reward (passing slot 0 without landing)
    if (nextPos < oldPos && nextPos !== 0) {
      nextGold += GO_GOLD;
      lastEvent = `Passed Main Gate: +${GO_GOLD} coins. `;
    }

    // Corner effects (28-slot board)
    if (nextPos === 0) {
      // 🚪 The Main Gate (GO)
      nextGold += GO_GOLD;
      nextExtra += 1;
      lastEvent = `🚪 MAIN GATE: +${GO_GOLD} coins, +1 free spin!`;
    } else if (nextPos === 7) {
      // 🚦 Zahma (Traffic Jam / Jail) — just visiting
      lastEvent = (lastEvent || '') + '🚦 Zahma — just visiting.';
    } else if (nextPos === 14) {
      // ☕ El Ahwa (Cafe / Free Parking) — safe zone + energy
      lastEvent = (lastEvent || '') + '☕ El Ahwa — safe zone, +1 energy.';
    } else if (nextPos === 21) {
      // 🛑 El Lagna (Checkpoint → Go To Jail)
      nextPos = 7;
      nextJail = Math.max(nextJail, JAIL_TURNS);
      lastEvent = '🛑 El Lagna! Checkpoint sends you to Zahma (Traffic Jam).';
    } else if (!lastEvent) {
      lastEvent = 'Moved.';
    }

    const next: ChronoEmpiresBoardProgressDoc = {
      id: String(b),
      boardId: b,
      position: nextPos,
      lastRoll,
      jailTurnsRemaining: nextJail,
      extraRolls: nextExtra,
      lastEvent,
      updatedAt: nowIso(),
    };

    tx.set(progRef, next as any, { merge: true } as any);
    if (nextGold !== curGold) {
      tx.update(userRef, { 'economy.gold': nextGold } as any);
    }

    return { progress: next, gold: nextGold };
  });
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
  const snap = await getDoc(doc(db, 'users', uid, 'chrono_empires', 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<ChronoEmpiresStateDoc>;
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
  await setDoc(doc(db, 'users', uid, 'chrono_empires', 'global'), init as any);
  return init;
}

export async function setCurrentBoard(uid: string, board: number): Promise<void> {
  const next = Math.max(100, Math.min(3000, Math.round(board)));
  await updateDoc(doc(db, 'users', uid, 'chrono_empires', 'global'), {
    currentBoard: next,
    updatedAt: nowIso(),
  } as any);
}

export async function bumpBoardIfAt(uid: string, expectedBoard: number, nextBoard: number): Promise<void> {
  const ref = doc(db, 'users', uid, 'chrono_empires', 'global');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, { id: 'global', currentBoard: 100, updatedAt: nowIso() } as any);
      return;
    }
    const data = snap.data() as any;
    const cur = typeof data.currentBoard === 'number' ? data.currentBoard : 100;
    if (cur !== expectedBoard) return;
    tx.update(ref, { currentBoard: Math.max(100, Math.min(3000, Math.round(nextBoard))), updatedAt: nowIso() } as any);
  });
}
