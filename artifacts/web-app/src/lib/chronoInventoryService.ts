/* ═══════════════════════════════════════════════════════════
   Chrono Empires — Player Inventory Service
   Supabase path: user_docs/{uid}/chrono_empires/inventory
   ═══════════════════════════════════════════════════════════ */

import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

function nowIso(): string {
  return new Date().toISOString();
}

/* ── Types ──────────────────────────────────────────────── */

export interface OwnedCard {
  copies: number;  // total copies collected
  level: number;   // 1–4
}

export interface ChronoInventoryDoc {
  cards: Record<string, OwnedCard>;       // cardId → { copies, level }
  transportCards: Record<string, number>;  // transportCardId → count owned
  deck: string[];                          // up to 12 card IDs (active deck)
  attackCards: number;                     // 0–3
  defendCards: number;                     // 0–3
  activeToken: string;                     // token skin id
  ownedTokens: string[];                   // owned token skin ids
  updatedAt: string;
}

const EMPTY_INVENTORY: ChronoInventoryDoc = {
  cards: {},
  transportCards: {},
  deck: [],
  attackCards: 0,
  defendCards: 0,
  activeToken: 'default',
  ownedTokens: ['default'],
  updatedAt: '',
};

const INV_COL = 'chrono_inventory';
const INV_DOC = 'global';

/* ── Read / Ensure ─────────────────────────────────────── */

export async function getInventory(uid: string): Promise<ChronoInventoryDoc> {
  const raw = await getUserDoc(uid, INV_COL, INV_DOC);
  if (!raw) return { ...EMPTY_INVENTORY, updatedAt: nowIso() };
  const d = raw as any;
  return {
    cards: (d.cards && typeof d.cards === 'object') ? d.cards : {},
    transportCards: (d.transportCards && typeof d.transportCards === 'object') ? d.transportCards : {},
    deck: Array.isArray(d.deck) ? d.deck.slice(0, 12) : [],
    attackCards: typeof d.attackCards === 'number' ? Math.min(3, Math.max(0, d.attackCards)) : 0,
    defendCards: typeof d.defendCards === 'number' ? Math.min(3, Math.max(0, d.defendCards)) : 0,
    activeToken: typeof d.activeToken === 'string' ? d.activeToken : 'default',
    ownedTokens: Array.isArray(d.ownedTokens) ? d.ownedTokens : ['default'],
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

export async function ensureInventory(uid: string): Promise<ChronoInventoryDoc> {
  const existing = await getInventory(uid);
  if (existing.updatedAt) {
    const check = await getUserDoc(uid, INV_COL, INV_DOC);
    if (check) return existing;
  }
  const init: ChronoInventoryDoc = { ...EMPTY_INVENTORY, updatedAt: nowIso() };
  await setUserDoc(uid, INV_COL, INV_DOC, init as any);
  return init;
}

/* ── Add card copies ───────────────────────────────────── */

export async function addCardCopies(uid: string, cardId: string, count: number): Promise<OwnedCard> {
  const inv = await getInventory(uid);
  const existing = inv.cards[cardId] ?? { copies: 0, level: 0 };
  const newCopies = existing.copies + Math.max(0, count);
  const newLevel = existing.level === 0 ? 1 : existing.level; // auto-unlock level 1
  const updated: OwnedCard = { copies: newCopies, level: newLevel };
  await updateUserDoc(uid, INV_COL, INV_DOC, {
    [`cards.${cardId}`]: updated,
    updatedAt: nowIso(),
  });
  try {
    const { incrementTaskProgress } = await import('@/lib/chronoTasksService');
    await incrementTaskProgress(uid, 'card_copies', Math.max(0, count));
  } catch {
    // Best-effort task hook.
  }
  return updated;
}

/* ── Upgrade card ──────────────────────────────────────── */

export type UpgradeResult =
  | { ok: true; card: OwnedCard }
  | { ok: false; reason: string };

export async function upgradeCard(uid: string, cardId: string): Promise<UpgradeResult> {
  try {
    const { purchaseChronoCardUpgrade } = await import('@/lib/economyApiService');
    const result = await purchaseChronoCardUpgrade(cardId);
    const { incrementTaskProgress } = await import('@/lib/chronoTasksService');
    await incrementTaskProgress(uid, 'card_upgrade', 1);
    return { ok: true, card: result.card };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Upgrade failed.' };
  }
}

/* ── Deck management ───────────────────────────────────── */

export async function setDeck(uid: string, deck: string[]): Promise<void> {
  const trimmed = deck.slice(0, 12);
  await updateUserDoc(uid, INV_COL, INV_DOC, {
    deck: trimmed,
    updatedAt: nowIso(),
  });
}

export async function addToDeck(uid: string, cardId: string): Promise<string[]> {
  const inv = await getInventory(uid);
  if (inv.deck.length >= 12) throw new Error('Deck full (12 max).');
  if (inv.deck.includes(cardId)) throw new Error('Card already in deck.');
  const newDeck = [...inv.deck, cardId];
  await setDeck(uid, newDeck);
  return newDeck;
}

export async function removeFromDeck(uid: string, cardId: string): Promise<string[]> {
  const inv = await getInventory(uid);
  const newDeck = inv.deck.filter((id) => id !== cardId);
  await setDeck(uid, newDeck);
  return newDeck;
}

/* ── Transport cards ───────────────────────────────────── */

export async function addTransportCard(uid: string, transportId: string, count = 1): Promise<void> {
  const inv = await getInventory(uid);
  const cur = inv.transportCards[transportId] ?? 0;
  await updateUserDoc(uid, INV_COL, INV_DOC, {
    [`transportCards.${transportId}`]: cur + count,
    updatedAt: nowIso(),
  });
}

export async function useTransportCard(uid: string, transportId: string): Promise<boolean> {
  const inv = await getInventory(uid);
  const cur = inv.transportCards[transportId] ?? 0;
  if (cur <= 0) return false;
  await updateUserDoc(uid, INV_COL, INV_DOC, {
    [`transportCards.${transportId}`]: cur - 1,
    updatedAt: nowIso(),
  });
  return true;
}

/* ── Attack / Defend cards ─────────────────────────────── */

export async function addCombatCard(uid: string, type: 'attack' | 'defend', count = 1): Promise<void> {
  const inv = await getInventory(uid);
  const field = type === 'attack' ? 'attackCards' : 'defendCards';
  const cur = inv[field];
  const next = Math.min(3, cur + count);
  await updateUserDoc(uid, INV_COL, INV_DOC, { [field]: next, updatedAt: nowIso() });
}

/* ── Token management ──────────────────────────────────── */

export async function setActiveToken(uid: string, tokenId: string): Promise<void> {
  const inv = await getInventory(uid);
  if (!inv.ownedTokens.includes(tokenId)) throw new Error('Token not owned.');
  await updateUserDoc(uid, INV_COL, INV_DOC, { activeToken: tokenId, updatedAt: nowIso() });
}

export async function buyToken(uid: string, tokenId: string, cost: number): Promise<boolean> {
  try {
    void uid;
    void cost;
    const { purchaseChronoToken } = await import('@/lib/economyApiService');
    await purchaseChronoToken(tokenId);
    return true;
  } catch {
    return false;
  }
}
