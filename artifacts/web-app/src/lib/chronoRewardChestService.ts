import { ALL_CATEGORY_CARDS } from '@/lib/chronoCards';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';
import { getTasksState } from '@/lib/chronoTasksService';

export interface ChronoRewardChestReward {
  coins: number;
  gems: number;
  energy: number;
  cardId?: string;
  cardName?: string;
  cardEmoji?: string;
}

export interface ChronoRewardChestStateDoc {
  lastClaimedAt?: string;
  lastReward?: ChronoRewardChestReward;
  updatedAt: string;
}

export interface ChronoRewardChestStatus {
  ready: boolean;
  nextReadyAt: string;
  hoursRemaining: number;
  rewardPreview: {
    coins: number;
    gems: number;
    energy: number;
  };
  lastReward?: ChronoRewardChestReward;
}

export type ClaimChronoRewardChestResult =
  | { ok: true; reward: ChronoRewardChestReward }
  | { ok: false; reason: string };

const CHEST_COL = 'chrono_reward_chest';
const CHEST_DOC = 'state';
const CHEST_COOLDOWN_MS = 1000 * 60 * 60 * 24;

function nowIso(): string {
  return new Date().toISOString();
}

function emptyState(): ChronoRewardChestStateDoc {
  return {
    updatedAt: nowIso(),
  };
}

export async function getChronoRewardChestState(uid: string): Promise<ChronoRewardChestStateDoc> {
  const raw = await getUserDoc(uid, CHEST_COL, CHEST_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, CHEST_COL, CHEST_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoRewardChestStateDoc>;
  return {
    lastClaimedAt: typeof d.lastClaimedAt === 'string' ? d.lastClaimedAt : undefined,
    lastReward: d.lastReward && typeof d.lastReward === 'object' ? d.lastReward as ChronoRewardChestReward : undefined,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

function buildPreview(currentBoard: number): { coins: number; gems: number; energy: number } {
  const boardTier = Math.max(1, Math.round(currentBoard / 100));
  return {
    coins: boardTier * 900,
    gems: boardTier >= 20 ? 3 : boardTier >= 10 ? 2 : 1,
    energy: boardTier >= 15 ? 2 : 1,
  };
}

export async function getChronoRewardChestStatus(uid: string, currentBoard: number): Promise<ChronoRewardChestStatus> {
  const state = await getChronoRewardChestState(uid);
  const now = Date.now();
  const lastClaimedAtMs = state.lastClaimedAt ? new Date(state.lastClaimedAt).getTime() : 0;
  const nextReadyAtMs = lastClaimedAtMs > 0 ? lastClaimedAtMs + CHEST_COOLDOWN_MS : now;
  const ready = now >= nextReadyAtMs;
  const hoursRemaining = ready ? 0 : Math.max(0, Math.ceil((nextReadyAtMs - now) / (1000 * 60 * 60)));
  return {
    ready,
    nextReadyAt: new Date(nextReadyAtMs).toISOString(),
    hoursRemaining,
    rewardPreview: buildPreview(currentBoard),
    lastReward: state.lastReward,
  };
}

async function canClaimChest(uid: string): Promise<boolean> {
  const tasks = await getTasksState(uid);
  const studyProgress = Object.entries(tasks.progress)
    .filter(([taskId]) => taskId.includes('study'))
    .reduce((sum, [, value]) => sum + (typeof value === 'number' ? value : 0), 0);
  return studyProgress >= 5;
}

export async function claimChronoRewardChest(uid: string, currentBoard: number): Promise<ClaimChronoRewardChestResult> {
  const status = await getChronoRewardChestStatus(uid, currentBoard);
  if (!status.ready) return { ok: false, reason: 'Chest is still cooling down.' };

  const eligible = await canClaimChest(uid);
  if (!eligible) return { ok: false, reason: 'Answer more study questions to unlock today\'s chest.' };

  try {
    const { claimChronoRewardChestEconomy } = await import('@/lib/economyApiService');
    const result = await claimChronoRewardChestEconomy();
    const card = result.reward.cardId ? ALL_CATEGORY_CARDS.find((entry) => entry.id === result.reward.cardId) : undefined;
    const reward: ChronoRewardChestReward = {
      ...result.reward,
      cardName: card?.name,
      cardEmoji: card?.emoji,
    };
    return { ok: true, reward };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Failed to grant chest reward.' };
  }
}
