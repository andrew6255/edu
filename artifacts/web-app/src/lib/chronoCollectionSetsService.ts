import { ALL_CATEGORY_CARDS, type CardCategory } from '@/lib/chronoCards';
import { getInventory } from '@/lib/chronoInventoryService';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

export interface CollectionSetReward {
  coins?: number;
  gems?: number;
  energy?: number;
}

export interface CollectionSetDef {
  id: string;
  boardId: number;
  category: CardCategory;
  label: string;
  emoji: string;
  cardIds: string[];
  reward: CollectionSetReward;
}

export interface ChronoCollectionSetsStateDoc {
  claimed: Record<string, number>;
  updatedAt: string;
}

export interface CollectionSetViewModel {
  def: CollectionSetDef;
  ownedCount: number;
  totalCount: number;
  completed: boolean;
  claimed: boolean;
}

export type ClaimCollectionSetResult =
  | { ok: true; reward: CollectionSetReward }
  | { ok: false; reason: string };

const SETS_COL = 'chrono_collection_sets';
const SETS_DOC = 'state';

const CATEGORY_META: Record<CardCategory, { emoji: string; label: string }> = {
  geography: { emoji: '🗺️', label: 'Geography' },
  food: { emoji: '🥙', label: 'Food' },
  entertainment: { emoji: '🎭', label: 'Entertainment' },
  history: { emoji: '🏛️', label: 'History' },
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildReward(boardId: number, category: CardCategory): CollectionSetReward {
  const boardTier = Math.max(1, Math.round(boardId / 100));
  const gems = boardTier >= 20 ? 3 : boardTier >= 10 ? 2 : 1;
  const categoryBonus = category === 'entertainment' ? 500 : category === 'food' ? 350 : 250;
  return {
    coins: boardTier * 750 + categoryBonus,
    gems,
  };
}

export const COLLECTION_SET_CATALOG: CollectionSetDef[] = Object.values(
  ALL_CATEGORY_CARDS.reduce<Record<string, CollectionSetDef>>((acc, card) => {
    const key = `${card.boardId}_${card.category}`;
    if (!acc[key]) {
      const meta = CATEGORY_META[card.category];
      acc[key] = {
        id: `set_${card.boardId}_${card.category}`,
        boardId: card.boardId,
        category: card.category,
        label: `${meta.label} Set · Board ${card.boardId}`,
        emoji: meta.emoji,
        cardIds: [],
        reward: buildReward(card.boardId, card.category),
      };
    }
    acc[key].cardIds.push(card.id);
    return acc;
  }, {}),
).sort((a, b) => a.boardId - b.boardId || a.category.localeCompare(b.category));

function emptyState(): ChronoCollectionSetsStateDoc {
  return {
    claimed: {},
    updatedAt: nowIso(),
  };
}

export async function getCollectionSetsState(uid: string): Promise<ChronoCollectionSetsStateDoc> {
  const raw = await getUserDoc(uid, SETS_COL, SETS_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, SETS_COL, SETS_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoCollectionSetsStateDoc>;
  return {
    claimed: d.claimed && typeof d.claimed === 'object' ? d.claimed as Record<string, number> : {},
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

export async function buildCollectionSetViewModels(uid: string, currentBoard: number): Promise<CollectionSetViewModel[]> {
  const [state, inventory] = await Promise.all([
    getCollectionSetsState(uid),
    getInventory(uid),
  ]);
  return COLLECTION_SET_CATALOG
    .filter((set) => set.boardId <= currentBoard)
    .map((def) => {
      const ownedCount = def.cardIds.reduce((sum, cardId) => {
        const owned = inventory.cards[cardId];
        return sum + (owned && owned.level > 0 ? 1 : 0);
      }, 0);
      const totalCount = def.cardIds.length;
      const completed = ownedCount >= totalCount;
      const claimed = !!state.claimed[def.id];
      return { def, ownedCount, totalCount, completed, claimed };
    });
}

export async function claimCollectionSetReward(uid: string, setId: string): Promise<ClaimCollectionSetResult> {
  const def = COLLECTION_SET_CATALOG.find((set) => set.id === setId);
  if (!def) return { ok: false, reason: 'Unknown set.' };

  const [state, inventory] = await Promise.all([
    getCollectionSetsState(uid),
    getInventory(uid),
  ]);
  if (state.claimed[setId]) return { ok: false, reason: 'Already claimed.' };

  const ownedCount = def.cardIds.reduce((sum, cardId) => {
    const owned = inventory.cards[cardId];
    return sum + (owned && owned.level > 0 ? 1 : 0);
  }, 0);
  if (ownedCount < def.cardIds.length) return { ok: false, reason: 'Set not completed yet.' };

  try {
    const { updateEconomy } = await import('@/lib/userService');
    await updateEconomy(uid, {
      gold: def.reward.coins ?? 0,
      gems: def.reward.gems ?? 0,
      energy: def.reward.energy ?? 0,
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Reward failed.' };
  }

  const nextClaimed = { ...state.claimed, [setId]: Date.now() };
  if (await getUserDoc(uid, SETS_COL, SETS_DOC)) {
    await updateUserDoc(uid, SETS_COL, SETS_DOC, {
      claimed: nextClaimed,
      updatedAt: nowIso(),
    });
  } else {
    await setUserDoc(uid, SETS_COL, SETS_DOC, {
      claimed: nextClaimed,
      updatedAt: nowIso(),
    } as any);
  }

  return { ok: true, reward: def.reward };
}
