import { boardToClass } from '@/lib/chronoCards';
import { ensureBoardState, getBoothRent, loadBoardState, type BoardGameState } from '@/lib/chronoBoardStateService';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

export interface ChronoIdleVaultDoc {
  accruedCoins: number;
  warmupProgress: number;
  warmupGoal: number;
  lastCalculatedAt: string;
  lastClaimedAt?: string;
  updatedAt: string;
}

export interface ChronoIdleVaultStatus extends ChronoIdleVaultDoc {
  hourlyIncome: number;
  maxStoredCoins: number;
  claimReady: boolean;
}

export type ClaimIdleVaultResult =
  | { ok: true; coins: number }
  | { ok: false; reason: string };

const IDLE_VAULT_COL = 'chrono_idle_vault';
const IDLE_VAULT_DOC = 'state';
const WARMUP_GOAL = 3;
const MAX_STORED_HOURS = 12;
const OFFLINE_RENT_FACTOR = 0.35;

function nowIso(): string {
  return new Date().toISOString();
}

function emptyState(): ChronoIdleVaultDoc {
  return {
    accruedCoins: 0,
    warmupProgress: 0,
    warmupGoal: WARMUP_GOAL,
    lastCalculatedAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeState(raw: unknown): ChronoIdleVaultDoc {
  const data = (raw && typeof raw === 'object') ? raw as Partial<ChronoIdleVaultDoc> : {};
  const warmupGoal = typeof data.warmupGoal === 'number' && Number.isFinite(data.warmupGoal)
    ? Math.max(1, Math.floor(data.warmupGoal))
    : WARMUP_GOAL;
  const warmupProgressRaw = typeof data.warmupProgress === 'number' && Number.isFinite(data.warmupProgress)
    ? Math.max(0, Math.floor(data.warmupProgress))
    : 0;
  return {
    accruedCoins: typeof data.accruedCoins === 'number' && Number.isFinite(data.accruedCoins)
      ? Math.max(0, Math.floor(data.accruedCoins))
      : 0,
    warmupProgress: Math.min(warmupGoal, warmupProgressRaw),
    warmupGoal,
    lastCalculatedAt: typeof data.lastCalculatedAt === 'string' ? data.lastCalculatedAt : nowIso(),
    lastClaimedAt: typeof data.lastClaimedAt === 'string' ? data.lastClaimedAt : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
  };
}

async function readState(uid: string): Promise<ChronoIdleVaultDoc> {
  const raw = await getUserDoc(uid, IDLE_VAULT_COL, IDLE_VAULT_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, IDLE_VAULT_COL, IDLE_VAULT_DOC, init as any);
    return init;
  }
  return normalizeState(raw);
}

function computeBoardHourlyIncome(state: BoardGameState, classLevel: number): number {
  const ownedBooths = Object.values(state.booths).filter((booth) => booth.owner === 'player');
  const hourlyIncome = ownedBooths.reduce((sum, booth) => sum + getBoothRent(booth, classLevel), 0);
  return Math.max(0, Math.floor(hourlyIncome * OFFLINE_RENT_FACTOR));
}

function buildStatus(state: ChronoIdleVaultDoc, hourlyIncome: number): ChronoIdleVaultStatus {
  const maxStoredCoins = Math.max(0, Math.floor(hourlyIncome * MAX_STORED_HOURS));
  return {
    ...state,
    hourlyIncome,
    maxStoredCoins,
    claimReady: state.accruedCoins > 0 && state.warmupProgress >= state.warmupGoal,
  };
}

export async function syncIdleVault(uid: string, boardId: number): Promise<ChronoIdleVaultStatus> {
  const classLevel = boardToClass(boardId);
  const boardState = await loadBoardState(uid, boardId) ?? await ensureBoardState(uid, boardId, classLevel);
  const hourlyIncome = computeBoardHourlyIncome(boardState, classLevel);
  const current = await readState(uid);
  const now = Date.now();
  const last = new Date(current.lastCalculatedAt).getTime();
  const elapsedMs = Number.isFinite(last) ? Math.max(0, now - last) : 0;
  const maxStoredCoins = Math.max(0, Math.floor(hourlyIncome * MAX_STORED_HOURS));
  const accruedDelta = hourlyIncome > 0 ? Math.floor((hourlyIncome * elapsedMs) / 3600000) : 0;
  const nextAccruedCoins = Math.min(maxStoredCoins, current.accruedCoins + accruedDelta);
  const nextWarmupProgress = nextAccruedCoins > 0 ? current.warmupProgress : 0;
  const changed =
    nextAccruedCoins !== current.accruedCoins ||
    nextWarmupProgress !== current.warmupProgress ||
    elapsedMs > 0;

  if (!changed) {
    return buildStatus(current, hourlyIncome);
  }

  const nextState: ChronoIdleVaultDoc = {
    ...current,
    accruedCoins: nextAccruedCoins,
    warmupProgress: Math.min(current.warmupGoal, nextWarmupProgress),
    lastCalculatedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await setUserDoc(uid, IDLE_VAULT_COL, IDLE_VAULT_DOC, nextState as any);
  return buildStatus(nextState, hourlyIncome);
}

export async function recordIdleVaultStudyCorrect(uid: string): Promise<ChronoIdleVaultDoc | null> {
  const current = await readState(uid);
  if (current.accruedCoins <= 0) {
    if (current.warmupProgress === 0) return current;
    const resetState: ChronoIdleVaultDoc = {
      ...current,
      warmupProgress: 0,
      updatedAt: nowIso(),
    };
    await updateUserDoc(uid, IDLE_VAULT_COL, IDLE_VAULT_DOC, {
      warmupProgress: 0,
      updatedAt: resetState.updatedAt,
    });
    return resetState;
  }
  if (current.warmupProgress >= current.warmupGoal) return current;
  const nextProgress = Math.min(current.warmupGoal, current.warmupProgress + 1);
  await updateUserDoc(uid, IDLE_VAULT_COL, IDLE_VAULT_DOC, {
    warmupProgress: nextProgress,
    updatedAt: nowIso(),
  });
  return {
    ...current,
    warmupProgress: nextProgress,
    updatedAt: nowIso(),
  };
}

export async function claimIdleVault(uid: string): Promise<ClaimIdleVaultResult> {
  const current = await readState(uid);
  if (current.accruedCoins <= 0) return { ok: false, reason: 'No offline coins ready yet.' };
  if (current.warmupProgress < current.warmupGoal) {
    return { ok: false, reason: `Answer ${current.warmupGoal} study questions correctly to unlock the vault.` };
  }

  const econRaw = await getUserDoc(uid, 'chrono_economy', 'global');
  const curGold = econRaw && typeof (econRaw as any).gold === 'number' ? Math.max(0, Math.floor((econRaw as any).gold as number)) : 0;
  const nextGold = curGold + current.accruedCoins;
  if (econRaw) {
    await updateUserDoc(uid, 'chrono_economy', 'global', { gold: nextGold });
  } else {
    await setUserDoc(uid, 'chrono_economy', 'global', { gold: nextGold } as any);
  }

  const nextState: ChronoIdleVaultDoc = {
    ...current,
    accruedCoins: 0,
    warmupProgress: 0,
    lastCalculatedAt: nowIso(),
    lastClaimedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await setUserDoc(uid, IDLE_VAULT_COL, IDLE_VAULT_DOC, nextState as any);
  return { ok: true, coins: current.accruedCoins };
}
