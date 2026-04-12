/* ═══════════════════════════════════════════════════════════
   Chrono Empires — Board State Service
   Per-board tile ownership, bot state, auction logic.
   Firestore: users/{uid}/chrono_empires/global/boards/{boardId}/state
   For MVP: stored in-memory per session, persisted to Firestore.
   ═══════════════════════════════════════════════════════════ */

import { getUserDoc, setUserDoc } from '@/lib/supabaseDocStore';
import { calcRent, type ZoneName } from '@/lib/chronoCards';

function nowIso(): string { return new Date().toISOString(); }

/* ── Types ─────────────────────────────────────────────── */

export type OwnerId = 'player' | 'tarek' | 'sara' | 'ahmed';

export interface BoothState {
  tileId: number;
  owner: OwnerId | null;
  cardId: string | null;    // category card placed here
  cardLevel: number;        // 1–4
}

export interface BotState {
  id: OwnerId;
  name: string;
  emoji: string;
  personality: 'aggressive' | 'hoarder' | 'hustler';
  position: number;
  coins: number;
  ownedBooths: number[];    // tile IDs
}

export interface BoardGameState {
  boardId: number;
  booths: Record<number, BoothState>;  // tileId → BoothState
  bots: BotState[];
  playerCoins: number;
  updatedAt: string;
}

/* ── Bot definitions ───────────────────────────────────── */
const BOT_DEFS: Omit<BotState, 'position' | 'coins' | 'ownedBooths'>[] = [
  { id: 'tarek', name: 'Tarek',  emoji: '🔴', personality: 'aggressive' },
  { id: 'sara',  name: 'Sara',   emoji: '🟢', personality: 'hoarder' },
  { id: 'ahmed', name: 'Ahmed',  emoji: '🟡', personality: 'hustler' },
];

/* ── Booth tile IDs (non-corner, non-action, just booths) ── */
const BOOTH_TILE_IDS = [1, 3, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 24, 25, 27];

/* ── Initialize a fresh board game state ───────────────── */
export function createFreshBoardState(boardId: number, startingCoins: number): BoardGameState {
  const booths: Record<number, BoothState> = {};
  for (const tid of BOOTH_TILE_IDS) {
    booths[tid] = { tileId: tid, owner: null, cardId: null, cardLevel: 1 };
  }

  // Bots start with some random booths pre-owned
  const bots: BotState[] = BOT_DEFS.map((def) => ({
    ...def,
    position: 0,
    coins: startingCoins,
    ownedBooths: [],
  }));

  // Distribute ~6 random booths to bots (2 each)
  const shuffled = [...BOOTH_TILE_IDS].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 6 && i < shuffled.length; i++) {
    const bot = bots[i % 3];
    const tid = shuffled[i];
    booths[tid].owner = bot.id;
    bot.ownedBooths.push(tid);
  }

  return {
    boardId,
    booths,
    bots,
    playerCoins: startingCoins,
    updatedAt: nowIso(),
  };
}

/* ── Persistence ───────────────────────────────────────── */

export async function loadBoardState(uid: string, boardId: number): Promise<BoardGameState | null> {
  const raw = await getUserDoc(uid, 'chrono_board_state', String(boardId));
  if (!raw) return null;
  return raw as any as BoardGameState;
}

export async function saveBoardState(uid: string, boardId: number, state: BoardGameState): Promise<void> {
  await setUserDoc(uid, 'chrono_board_state', String(boardId), { ...state, updatedAt: nowIso() } as any);
}

export async function ensureBoardState(uid: string, boardId: number, classLevel: number): Promise<BoardGameState> {
  const existing = await loadBoardState(uid, boardId);
  if (existing) return existing;
  const startCoins = 500 * classLevel;
  const fresh = createFreshBoardState(boardId, startCoins);
  await saveBoardState(uid, boardId, fresh);
  return fresh;
}

/* ── Tile zone mapping ─────────────────────────────────── */
const TILE_ZONE: Record<number, ZoneName> = {};
// Bottom: entertainment (tiles 1-6)
for (const t of [1, 2, 3, 4, 5, 6]) TILE_ZONE[t] = 'entertainment';
// Left: history (tiles 8-13)
for (const t of [8, 9, 10, 11, 12, 13]) TILE_ZONE[t] = 'history';
// Top: geography (tiles 15-20)
for (const t of [15, 16, 17, 18, 19, 20]) TILE_ZONE[t] = 'geography';
// Right: food (tiles 22-27)
for (const t of [22, 23, 24, 25, 26, 27]) TILE_ZONE[t] = 'food';

export function getTileZone(tileId: number): ZoneName | null {
  return TILE_ZONE[tileId] ?? null;
}

/* ── Rent calculation for a booth ──────────────────────── */
export function getBoothRent(booth: BoothState, classLevel: number): number {
  const zone = getTileZone(booth.tileId);
  if (!zone) return 0;
  return calcRent(classLevel, zone, booth.cardLevel);
}

/* ── Landing logic result types ────────────────────────── */
export type LandingResult =
  | { type: 'empty_booth'; tileId: number; buyPrice: number }
  | { type: 'own_booth'; tileId: number; rent: number }
  | { type: 'bot_booth'; tileId: number; owner: BotState; rent: number }
  | { type: 'power_station' }
  | { type: 'sponsor_tent' }
  | { type: 'vendor_tax'; amount: number }
  | { type: 'corner'; cornerCode: string }
  | null;

export function resolveLanding(
  tileId: number,
  tileKind: string,
  state: BoardGameState,
  classLevel: number,
): LandingResult {
  // Corners handled separately by rollBoardTurn
  if (tileKind === 'corner') return { type: 'corner', cornerCode: '' };

  if (tileKind === 'power') return { type: 'power_station' };
  if (tileKind === 'sponsor') return { type: 'sponsor_tent' };
  if (tileKind === 'tax') {
    const taxPct = 0.10; // 10% of coins
    return { type: 'vendor_tax', amount: Math.ceil(state.playerCoins * taxPct) };
  }

  if (tileKind === 'booth') {
    const booth = state.booths[tileId];
    if (!booth || !booth.owner) {
      const buyPrice = 200 * classLevel;
      return { type: 'empty_booth', tileId, buyPrice };
    }
    const rent = getBoothRent(booth, classLevel);
    if (booth.owner === 'player') {
      return { type: 'own_booth', tileId, rent };
    }
    const ownerBot = state.bots.find((b) => b.id === booth.owner);
    if (ownerBot) {
      return { type: 'bot_booth', tileId, owner: ownerBot, rent };
    }
  }

  return null;
}

/* ── Buy a booth (player) ──────────────────────────────── */
export function buyBooth(state: BoardGameState, tileId: number, price: number): BoardGameState {
  const next = structuredClone(state);
  if (next.playerCoins < price) return next;
  next.playerCoins -= price;
  if (next.booths[tileId]) {
    next.booths[tileId].owner = 'player';
  }
  return next;
}

/* ── Pay rent to a bot ─────────────────────────────────── */
export function payRent(state: BoardGameState, rent: number, botId: OwnerId): BoardGameState {
  const next = structuredClone(state);
  const actualRent = Math.min(rent, next.playerCoins);
  next.playerCoins -= actualRent;
  const bot = next.bots.find((b) => b.id === botId);
  if (bot) bot.coins += actualRent;
  return next;
}

/* ── Pay tax ───────────────────────────────────────────── */
export function payTax(state: BoardGameState, amount: number): BoardGameState {
  const next = structuredClone(state);
  next.playerCoins -= Math.min(amount, next.playerCoins);
  return next;
}

/* ═══════════════════════════════════════════════════════════
   Auction System — El Mazad
   ═══════════════════════════════════════════════════════════ */

export interface AuctionState {
  tileId: number;
  currentBid: number;
  currentBidder: OwnerId | null;
  timer: number;            // seconds remaining
  active: boolean;
  log: string[];
}

export function createAuction(tileId: number, startBid: number): AuctionState {
  return {
    tileId,
    currentBid: startBid,
    currentBidder: null,
    timer: 7,
    active: true,
    log: [`🔨 Auction started for Booth #${tileId}! Starting bid: ${startBid} coins.`],
  };
}

/* ── Bot bidding AI ────────────────────────────────────── */
export function botBid(bot: BotState, auction: AuctionState): { bid: number; folds: boolean } {
  const maxAfford = Math.floor(bot.coins * 0.6); // won't spend more than 60%
  if (auction.currentBid >= maxAfford) return { bid: 0, folds: true };

  switch (bot.personality) {
    case 'aggressive': {
      // Tarek: bids high early, +1000 when possible
      const raise = auction.currentBid < 500 ? 1000 : 100;
      const newBid = auction.currentBid + raise;
      if (newBid > maxAfford) return { bid: 0, folds: true };
      return { bid: newBid, folds: false };
    }
    case 'hoarder': {
      // Sara: always bids minimum (+100), never stops
      const newBid = auction.currentBid + 100;
      if (newBid > maxAfford) return { bid: 0, folds: true };
      return { bid: newBid, folds: false };
    }
    case 'hustler': {
      // Ahmed: bids strategically — sometimes folds to bait
      if (Math.random() < 0.30) return { bid: 0, folds: true }; // 30% bluff fold
      const raise = Math.random() < 0.5 ? 100 : 1000;
      const newBid = auction.currentBid + raise;
      if (newBid > maxAfford) return { bid: 0, folds: true };
      return { bid: newBid, folds: false };
    }
    default:
      return { bid: 0, folds: true };
  }
}

/* ── Player bid ────────────────────────────────────────── */
export function playerBid(auction: AuctionState, raise: number, playerCoins: number): AuctionState {
  const newBid = auction.currentBid + raise;
  if (newBid > playerCoins) return auction;
  return {
    ...auction,
    currentBid: newBid,
    currentBidder: 'player',
    timer: 3, // reset to 3s on new bid
    log: [...auction.log, `🙋 You bid ${newBid} coins!`],
  };
}

/* ── Apply auction result to board state ───────────────── */
export function resolveAuction(state: BoardGameState, auction: AuctionState): BoardGameState {
  const next = structuredClone(state);
  if (!auction.currentBidder) return next; // no winner

  const winner = auction.currentBidder;
  const price = auction.currentBid;

  if (winner === 'player') {
    next.playerCoins -= price;
    if (next.booths[auction.tileId]) {
      next.booths[auction.tileId].owner = 'player';
    }
  } else {
    const bot = next.bots.find((b) => b.id === winner);
    if (bot) {
      bot.coins -= price;
      bot.ownedBooths.push(auction.tileId);
      if (next.booths[auction.tileId]) {
        next.booths[auction.tileId].owner = winner;
      }
    }
  }

  return next;
}

/* ── Sponsor tent reward ───────────────────────────────── */
export type SponsorReward =
  | { type: 'coins'; amount: number }
  | { type: 'energy'; amount: number }
  | { type: 'card_copy' };

export function rollSponsorReward(): SponsorReward {
  const r = Math.random();
  if (r < 0.50) return { type: 'coins', amount: Math.floor(Math.random() * 500) + 100 };
  if (r < 0.80) return { type: 'energy', amount: 1 };
  return { type: 'card_copy' };
}
