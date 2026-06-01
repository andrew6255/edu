import { ALL_CATEGORY_CARDS } from '@/lib/chronoCards';
import { addCardCopies } from '@/lib/chronoInventoryService';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

export interface DiscoveryElement {
  id: string;
  label: string;
  emoji: string;
}

export interface DiscoveryRecipe {
  id: string;
  ingredients: [string, string];
  resultCardId: string;
}

export interface ChronoDiscoveryStateDoc {
  unlockedElements: string[];
  discoveredRecipeIds: string[];
  discoveredCards: Record<string, number>;
  updatedAt: string;
}

export interface DiscoveryWorkshopView {
  elements: DiscoveryElement[];
  discovered: Array<{
    recipeId: string;
    cardId: string;
    discoveredAt: number;
    cardName: string;
    cardEmoji: string;
    boardId: number;
  }>;
  totalRecipesUnlocked: number;
  totalRecipesAvailable: number;
}

export type CombineDiscoveryResult =
  | { ok: true; alreadyDiscovered: boolean; cardId: string; cardName: string; cardEmoji: string; boardId: number }
  | { ok: false; reason: string };

const DISCOVERY_COL = 'chrono_discovery';
const DISCOVERY_DOC = 'state';

function nowIso(): string {
  return new Date().toISOString();
}

export const DISCOVERY_ELEMENTS: DiscoveryElement[] = [
  { id: 'street', label: 'Street', emoji: '🛣️' },
  { id: 'beans', label: 'Beans', emoji: '🫘' },
  { id: 'water', label: 'Water', emoji: '💧' },
  { id: 'flower', label: 'Flower', emoji: '🌺' },
  { id: 'sound', label: 'Sound', emoji: '🔊' },
  { id: 'neon', label: 'Neon', emoji: '💡' },
  { id: 'market', label: 'Market', emoji: '🛍️' },
  { id: 'stone', label: 'Stone', emoji: '🪨' },
  { id: 'rice', label: 'Rice', emoji: '🍚' },
  { id: 'pasta', label: 'Pasta', emoji: '🍝' },
  { id: 'river', label: 'River', emoji: '🏞️' },
  { id: 'festival', label: 'Festival', emoji: '🎉' },
] as const;

const STARTER_ELEMENT_IDS = DISCOVERY_ELEMENTS.map((e) => e.id);

function keyForIngredients(a: string, b: string): string {
  return [a, b].sort().join('::');
}

export const DISCOVERY_RECIPES: DiscoveryRecipe[] = [
  { id: 'r_foul', ingredients: ['street', 'beans'], resultCardId: 'b400_foo_1' },
  { id: 'r_khan', ingredients: ['market', 'stone'], resultCardId: 'b500_geo_1' },
  { id: 'r_pyramid', ingredients: ['stone', 'river'], resultCardId: 'b600_hist_1' },
  { id: 'r_nour', ingredients: ['sound', 'neon'], resultCardId: 'b1100_ent_1' },
  { id: 'r_koshary', ingredients: ['rice', 'pasta'], resultCardId: 'b1600_foo_1' },
  { id: 'r_karkadeh', ingredients: ['water', 'flower'], resultCardId: 'b1700_foo_2' },
  { id: 'r_niletv', ingredients: ['festival', 'sound'], resultCardId: 'b1700_ent_3' },
  { id: 'r_mall', ingredients: ['market', 'neon'], resultCardId: 'b2300_geo_1' },
  { id: 'r_marassi', ingredients: ['river', 'festival'], resultCardId: 'b2800_geo_1' },
  { id: 'r_iconic', ingredients: ['stone', 'neon'], resultCardId: 'b2900_geo_1' },
  { id: 'r_culturvator', ingredients: ['festival', 'stone'], resultCardId: 'b3000_hist_1' },
];

const RECIPE_MAP = new Map(DISCOVERY_RECIPES.map((recipe) => [keyForIngredients(recipe.ingredients[0], recipe.ingredients[1]), recipe]));

function emptyState(): ChronoDiscoveryStateDoc {
  return {
    unlockedElements: [...STARTER_ELEMENT_IDS],
    discoveredRecipeIds: [],
    discoveredCards: {},
    updatedAt: nowIso(),
  };
}

export async function getDiscoveryState(uid: string): Promise<ChronoDiscoveryStateDoc> {
  const raw = await getUserDoc(uid, DISCOVERY_COL, DISCOVERY_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, DISCOVERY_COL, DISCOVERY_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoDiscoveryStateDoc>;
  return {
    unlockedElements: Array.isArray(d.unlockedElements) ? d.unlockedElements.filter((x): x is string => typeof x === 'string') : [...STARTER_ELEMENT_IDS],
    discoveredRecipeIds: Array.isArray(d.discoveredRecipeIds) ? d.discoveredRecipeIds.filter((x): x is string => typeof x === 'string') : [],
    discoveredCards: d.discoveredCards && typeof d.discoveredCards === 'object' ? d.discoveredCards as Record<string, number> : {},
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

export async function buildDiscoveryWorkshopView(uid: string, currentBoard: number): Promise<DiscoveryWorkshopView> {
  const state = await getDiscoveryState(uid);
  const elements = DISCOVERY_ELEMENTS.filter((element) => state.unlockedElements.includes(element.id));
  const availableRecipes = DISCOVERY_RECIPES.filter((recipe) => {
    const card = ALL_CATEGORY_CARDS.find((c) => c.id === recipe.resultCardId);
    return !!card && card.boardId <= currentBoard;
  });
  const discovered = state.discoveredRecipeIds
    .map((recipeId) => {
      const recipe = DISCOVERY_RECIPES.find((r) => r.id === recipeId);
      if (!recipe) return null;
      const card = ALL_CATEGORY_CARDS.find((c) => c.id === recipe.resultCardId);
      if (!card || card.boardId > currentBoard) return null;
      return {
        recipeId,
        cardId: card.id,
        discoveredAt: state.discoveredCards[card.id] ?? 0,
        cardName: card.name,
        cardEmoji: card.emoji,
        boardId: card.boardId,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .sort((a, b) => b.discoveredAt - a.discoveredAt);

  return {
    elements,
    discovered,
    totalRecipesUnlocked: discovered.length,
    totalRecipesAvailable: availableRecipes.length,
  };
}

export async function combineDiscovery(uid: string, currentBoard: number, leftElementId: string, rightElementId: string): Promise<CombineDiscoveryResult> {
  if (!leftElementId || !rightElementId) return { ok: false, reason: 'Choose two elements first.' };
  if (leftElementId === rightElementId) return { ok: false, reason: 'Choose two different elements.' };

  const state = await getDiscoveryState(uid);
  if (!state.unlockedElements.includes(leftElementId) || !state.unlockedElements.includes(rightElementId)) {
    return { ok: false, reason: 'You do not own those elements yet.' };
  }

  const recipe = RECIPE_MAP.get(keyForIngredients(leftElementId, rightElementId));
  if (!recipe) return { ok: false, reason: 'No discovery found for that combination yet.' };

  const card = ALL_CATEGORY_CARDS.find((c) => c.id === recipe.resultCardId);
  if (!card) return { ok: false, reason: 'Discovery card data is missing.' };
  if (card.boardId > currentBoard) return { ok: false, reason: `Reach board ${card.boardId} to discover this recipe.` };

  const alreadyDiscovered = state.discoveredRecipeIds.includes(recipe.id);
  if (!alreadyDiscovered) {
    await addCardCopies(uid, card.id, 1);
    await updateUserDoc(uid, DISCOVERY_COL, DISCOVERY_DOC, {
      discoveredRecipeIds: [...state.discoveredRecipeIds, recipe.id],
      discoveredCards: { ...state.discoveredCards, [card.id]: Date.now() },
      updatedAt: nowIso(),
    });
  }

  return {
    ok: true,
    alreadyDiscovered,
    cardId: card.id,
    cardName: card.name,
    cardEmoji: card.emoji,
    boardId: card.boardId,
  };
}
