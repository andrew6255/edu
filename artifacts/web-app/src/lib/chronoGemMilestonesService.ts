import { ALL_CATEGORY_CARDS } from '@/lib/chronoCards';
import { loadBoardState } from '@/lib/chronoBoardStateService';
import { buildCollectionSetViewModels } from '@/lib/chronoCollectionSetsService';
import { getInventory } from '@/lib/chronoInventoryService';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

export interface GemMilestoneReward {
  gems: number;
}

export interface GemMilestoneDef {
  id: string;
  boardId: number;
  label: string;
  emoji: string;
  goal: number;
  reward: GemMilestoneReward;
}

export interface ChronoGemMilestonesStateDoc {
  claimed: Record<string, number>;
  updatedAt: string;
}

export interface GemMilestoneViewModel {
  def: GemMilestoneDef;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export type ClaimGemMilestoneResult =
  | { ok: true; reward: GemMilestoneReward }
  | { ok: false; reason: string };

const GEM_COL = 'chrono_gem_milestones';
const GEM_DOC = 'state';
const GEM_REWARD = 25;

function nowIso(): string {
  return new Date().toISOString();
}

export function buildBoardGemMilestoneDefs(boardId: number): GemMilestoneDef[] {
  return [
    { id: `gm_${boardId}_cards`, boardId, label: `Own 3 cards from Board ${boardId}`, emoji: '🎴', goal: 3, reward: { gems: GEM_REWARD } },
    { id: `gm_${boardId}_set`, boardId, label: `Complete 1 collection set on Board ${boardId}`, emoji: '🧩', goal: 1, reward: { gems: GEM_REWARD } },
    { id: `gm_${boardId}_upgrade`, boardId, label: `Upgrade 1 Board ${boardId} card to Level 2+`, emoji: '⬆️', goal: 1, reward: { gems: GEM_REWARD } },
    { id: `gm_${boardId}_booths`, boardId, label: `Own 2 booths on Board ${boardId}`, emoji: '🏠', goal: 2, reward: { gems: GEM_REWARD } },
  ];
}

function emptyState(): ChronoGemMilestonesStateDoc {
  return {
    claimed: {},
    updatedAt: nowIso(),
  };
}

export async function getGemMilestonesState(uid: string): Promise<ChronoGemMilestonesStateDoc> {
  const raw = await getUserDoc(uid, GEM_COL, GEM_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, GEM_COL, GEM_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoGemMilestonesStateDoc>;
  return {
    claimed: d.claimed && typeof d.claimed === 'object' ? d.claimed as Record<string, number> : {},
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

async function computeBoardMilestoneProgress(uid: string, boardId: number): Promise<Record<string, number>> {
  const defs = buildBoardGemMilestoneDefs(boardId);
  const [inventory, sets, boardState] = await Promise.all([
    getInventory(uid),
    buildCollectionSetViewModels(uid, boardId),
    loadBoardState(uid, boardId),
  ]);

  const boardCards = ALL_CATEGORY_CARDS.filter((card) => card.boardId === boardId);
  const ownedBoardCards = boardCards.reduce((sum, card) => {
    const owned = inventory.cards[card.id];
    return sum + (owned && owned.level > 0 ? 1 : 0);
  }, 0);
  const upgradedBoardCards = boardCards.reduce((sum, card) => {
    const owned = inventory.cards[card.id];
    return sum + (owned && owned.level >= 2 ? 1 : 0);
  }, 0);
  const completedBoardSets = sets.filter((set) => set.def.boardId === boardId && set.completed).length;
  const ownedBooths = boardState
    ? Object.values(boardState.booths).filter((booth) => booth.owner === 'player').length
    : 0;

  return {
    [defs[0].id]: Math.min(defs[0].goal, ownedBoardCards),
    [defs[1].id]: Math.min(defs[1].goal, completedBoardSets),
    [defs[2].id]: Math.min(defs[2].goal, upgradedBoardCards),
    [defs[3].id]: Math.min(defs[3].goal, ownedBooths),
  };
}

export async function buildGemMilestoneViewModels(uid: string, boardId: number): Promise<GemMilestoneViewModel[]> {
  const [state, progressMap] = await Promise.all([
    getGemMilestonesState(uid),
    computeBoardMilestoneProgress(uid, boardId),
  ]);
  return buildBoardGemMilestoneDefs(boardId).map((def) => {
    const progress = Math.min(def.goal, progressMap[def.id] ?? 0);
    return {
      def,
      progress,
      completed: progress >= def.goal,
      claimed: !!state.claimed[def.id],
    };
  });
}

export async function claimGemMilestoneReward(uid: string, milestoneId: string): Promise<ClaimGemMilestoneResult> {
  const state = await getGemMilestonesState(uid);
  if (state.claimed[milestoneId]) return { ok: false, reason: 'Already claimed.' };

  const match = milestoneId.match(/^gm_(\d+)_(cards|set|upgrade|booths)$/);
  if (!match) return { ok: false, reason: 'Unknown gem milestone.' };
  const boardId = Number(match[1]);
  const defs = buildBoardGemMilestoneDefs(boardId);
  const def = defs.find((item) => item.id === milestoneId);
  if (!def) return { ok: false, reason: 'Unknown gem milestone.' };

  const progressMap = await computeBoardMilestoneProgress(uid, boardId);
  const progress = Math.min(def.goal, progressMap[def.id] ?? 0);
  if (progress < def.goal) return { ok: false, reason: 'Milestone not completed yet.' };

  try {
    const { updateEconomy } = await import('@/lib/userService');
    await updateEconomy(uid, { gems: def.reward.gems });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Reward failed.' };
  }

  const nextClaimed = { ...state.claimed, [milestoneId]: Date.now() };
  if (await getUserDoc(uid, GEM_COL, GEM_DOC)) {
    await updateUserDoc(uid, GEM_COL, GEM_DOC, {
      claimed: nextClaimed,
      updatedAt: nowIso(),
    });
  } else {
    await setUserDoc(uid, GEM_COL, GEM_DOC, {
      claimed: nextClaimed,
      updatedAt: nowIso(),
    } as any);
  }

  return { ok: true, reward: def.reward };
}
