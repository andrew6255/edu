/* ═══════════════════════════════════════════════════════════
   Chrono Empires — Player Inventory Service
   Firestore path: users/{uid}/chrono_empires/inventory
   ═══════════════════════════════════════════════════════════ */

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { CARD_UPGRADE_LEVELS } from '@/lib/chronoCards';

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

const INV_PATH = (uid: string) => doc(db, 'users', uid, 'chrono_empires', 'inventory');

/* ── Read / Ensure ─────────────────────────────────────── */

export async function getInventory(uid: string): Promise<ChronoInventoryDoc> {
  const snap = await getDoc(INV_PATH(uid));
  if (!snap.exists()) return { ...EMPTY_INVENTORY, updatedAt: nowIso() };
  const d = snap.data() as any;
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
    const snap = await getDoc(INV_PATH(uid));
    if (snap.exists()) return existing;
  }
  const init: ChronoInventoryDoc = { ...EMPTY_INVENTORY, updatedAt: nowIso() };
  await setDoc(INV_PATH(uid), init as any);
  return init;
}

/* ── Add card copies ───────────────────────────────────── */

export async function addCardCopies(uid: string, cardId: string, count: number): Promise<OwnedCard> {
  const inv = await getInventory(uid);
  const existing = inv.cards[cardId] ?? { copies: 0, level: 0 };
  const newCopies = existing.copies + Math.max(0, count);
  const newLevel = existing.level === 0 ? 1 : existing.level; // auto-unlock level 1
  const updated: OwnedCard = { copies: newCopies, level: newLevel };
  await updateDoc(INV_PATH(uid), {
    [`cards.${cardId}`]: updated,
    updatedAt: nowIso(),
  } as any);
  return updated;
}

/* ── Upgrade card ──────────────────────────────────────── */

export type UpgradeResult =
  | { ok: true; card: OwnedCard }
  | { ok: false; reason: string };

export async function upgradeCard(uid: string, cardId: string): Promise<UpgradeResult> {
  const inv = await getInventory(uid);
  const card = inv.cards[cardId];
  if (!card || card.level === 0) return { ok: false, reason: 'Card not owned.' };
  if (card.level >= 4) return { ok: false, reason: 'Already max level.' };

  const nextDef = CARD_UPGRADE_LEVELS.find((l) => l.level === card.level + 1);
  if (!nextDef) return { ok: false, reason: 'Invalid level.' };

  if (card.copies < nextDef.copiesNeeded) {
    return { ok: false, reason: `Need ${nextDef.copiesNeeded} copies (have ${card.copies}).` };
  }

  // Check coin cost from user economy
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists()) return { ok: false, reason: 'User not found.' };
  const econ = (userSnap.data() as any)?.economy ?? {};
  const gold = typeof econ.gold === 'number' ? econ.gold : 0;
  if (gold < nextDef.coinCost) {
    return { ok: false, reason: `Need ${nextDef.coinCost.toLocaleString()} coins (have ${gold.toLocaleString()}).` };
  }

  // Apply upgrade
  const updated: OwnedCard = { copies: card.copies, level: card.level + 1 };
  await updateDoc(INV_PATH(uid), {
    [`cards.${cardId}`]: updated,
    updatedAt: nowIso(),
  } as any);

  // Deduct coins
  if (nextDef.coinCost > 0) {
    await updateDoc(doc(db, 'users', uid), {
      'economy.gold': gold - nextDef.coinCost,
    } as any);
  }

  return { ok: true, card: updated };
}

/* ── Deck management ───────────────────────────────────── */

export async function setDeck(uid: string, deck: string[]): Promise<void> {
  const trimmed = deck.slice(0, 12);
  await updateDoc(INV_PATH(uid), {
    deck: trimmed,
    updatedAt: nowIso(),
  } as any);
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
  await updateDoc(INV_PATH(uid), {
    [`transportCards.${transportId}`]: cur + count,
    updatedAt: nowIso(),
  } as any);
}

export async function useTransportCard(uid: string, transportId: string): Promise<boolean> {
  const inv = await getInventory(uid);
  const cur = inv.transportCards[transportId] ?? 0;
  if (cur <= 0) return false;
  await updateDoc(INV_PATH(uid), {
    [`transportCards.${transportId}`]: cur - 1,
    updatedAt: nowIso(),
  } as any);
  return true;
}

/* ── Attack / Defend cards ─────────────────────────────── */

export async function addCombatCard(uid: string, type: 'attack' | 'defend', count = 1): Promise<void> {
  const inv = await getInventory(uid);
  const field = type === 'attack' ? 'attackCards' : 'defendCards';
  const cur = inv[field];
  const next = Math.min(3, cur + count);
  await updateDoc(INV_PATH(uid), { [field]: next, updatedAt: nowIso() } as any);
}

/* ── Token management ──────────────────────────────────── */

export async function setActiveToken(uid: string, tokenId: string): Promise<void> {
  const inv = await getInventory(uid);
  if (!inv.ownedTokens.includes(tokenId)) throw new Error('Token not owned.');
  await updateDoc(INV_PATH(uid), { activeToken: tokenId, updatedAt: nowIso() } as any);
}

export async function buyToken(uid: string, tokenId: string, cost: number): Promise<boolean> {
  const inv = await getInventory(uid);
  if (inv.ownedTokens.includes(tokenId)) return false; // already owned
  const userSnap = await getDoc(doc(db, 'users', uid));
  if (!userSnap.exists()) return false;
  const gold = (userSnap.data() as any)?.economy?.gold ?? 0;
  if (gold < cost) return false;
  await updateDoc(INV_PATH(uid), {
    ownedTokens: [...inv.ownedTokens, tokenId],
    updatedAt: nowIso(),
  } as any);
  await updateDoc(doc(db, 'users', uid), { 'economy.gold': gold - cost } as any);
  return true;
}
