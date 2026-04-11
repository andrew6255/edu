import { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { ensureChronoBoardProgress, getChronoBoardProgress, rollBoardTurn, type ChronoEmpiresBoardProgressDoc } from '@/lib/chronoEmpiresService';
import { boardToClass, ALL_CATEGORY_CARDS, ALL_TRANSPORT_CARDS, CARD_UPGRADE_LEVELS, type CategoryCard } from '@/lib/chronoCards';
import { getInventory, ensureInventory, useTransportCard, type ChronoInventoryDoc, type OwnedCard } from '@/lib/chronoInventoryService';
import {
  ensureBoardState, saveBoardState, resolveLanding, buyBooth, payRent, payTax,
  createAuction, botBid, playerBid, resolveAuction, rollSponsorReward,
  type BoardGameState, type AuctionState, type LandingResult, type OwnerId,
} from '@/lib/chronoBoardStateService';

/* ══════════════════════════════════════════════════════════
   28-Slot Board Blueprint (8×8 grid, 4 corners + 6/side)
   ══════════════════════════════════════════════════════════ */

type TileKind = 'corner' | 'booth' | 'power' | 'sponsor' | 'tax';
type ZoneId = 'entertainment' | 'history' | 'geography' | 'food' | null;
type CornerCode = 'main_gate' | 'zahma' | 'el_ahwa' | 'el_lagna';

interface Tile {
  id: number;
  label: string;
  kind: TileKind;
  emoji: string;
  zone: ZoneId;
  cornerCode?: CornerCode;
  subLabel?: string;
}

const ZONE_COLOR: Record<string, { bar: string; bg: string; label: string }> = {
  entertainment: { bar: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',  label: '🎭 Entertainment' },
  history:       { bar: '#d97706', bg: 'rgba(217,119,6,0.08)',   label: '🏛️ History' },
  geography:     { bar: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  label: '🗺️ Geography' },
  food:          { bar: '#f97316', bg: 'rgba(249,115,22,0.08)',  label: '🥙 Food' },
};

const CORNER_BG: Record<CornerCode, string> = {
  main_gate: 'linear-gradient(135deg, #d1fae5, #ecfdf5)',
  zahma:     'linear-gradient(135deg, #fef3c7, #fefce8)',
  el_ahwa:   'linear-gradient(135deg, #e0e7ff, #eef2ff)',
  el_lagna:  'linear-gradient(135deg, #fee2e2, #fef2f2)',
};

const TILES: Tile[] = [
  // ⬇️ Bottom (Entertainment & Pop Culture — Purple)
  { id: 0,  label: 'THE\nMAIN GATE',     kind: 'corner',  emoji: '🚪', zone: null, cornerCode: 'main_gate', subLabel: 'GO — Collect 200 +1 Spin' },
  { id: 1,  label: 'Pop Culture\nBooth 1', kind: 'booth',   emoji: '🎭', zone: 'entertainment' },
  { id: 2,  label: 'POWER\nSTATION',      kind: 'power',   emoji: '🔋', zone: 'entertainment', subLabel: '+1 Energy' },
  { id: 3,  label: 'Pop Culture\nBooth 2', kind: 'booth',   emoji: '🎭', zone: 'entertainment' },
  { id: 4,  label: 'Pop Culture\nBooth 3', kind: 'booth',   emoji: '🎭', zone: 'entertainment' },
  { id: 5,  label: 'SPONSOR\nTENT',       kind: 'sponsor', emoji: '🎁', zone: 'entertainment', subLabel: 'Mystery Crate' },
  { id: 6,  label: 'Pop Culture\nBooth 4', kind: 'booth',   emoji: '🎭', zone: 'entertainment' },

  // ⬅️ Left (History & Culture — Gold)
  { id: 7,  label: 'ZAHMA\nTRAFFIC JAM',  kind: 'corner',  emoji: '🚦', zone: null, cornerCode: 'zahma', subLabel: 'Stuck in traffic!' },
  { id: 8,  label: 'History\nBooth 1',     kind: 'booth',   emoji: '🏛️', zone: 'history' },
  { id: 9,  label: 'History\nBooth 2',     kind: 'booth',   emoji: '🏛️', zone: 'history' },
  { id: 10, label: 'VENDOR\nTAX',         kind: 'tax',     emoji: '💸', zone: 'history', subLabel: 'Pay % of Coins' },
  { id: 11, label: 'History\nBooth 3',     kind: 'booth',   emoji: '🏛️', zone: 'history' },
  { id: 12, label: 'POWER\nSTATION',      kind: 'power',   emoji: '🔋', zone: 'history', subLabel: '+1 Energy' },
  { id: 13, label: 'History\nBooth 4',     kind: 'booth',   emoji: '🏛️', zone: 'history' },

  // ⬆️ Top (Geography & Places — Blue)
  { id: 14, label: 'EL AHWA\nTHE CAFE',   kind: 'corner',  emoji: '☕', zone: null, cornerCode: 'el_ahwa', subLabel: 'Safe zone +1 Energy' },
  { id: 15, label: 'Geography\nBooth 1',   kind: 'booth',   emoji: '🗺️', zone: 'geography' },
  { id: 16, label: 'SPONSOR\nTENT',       kind: 'sponsor', emoji: '🎁', zone: 'geography', subLabel: 'Mystery Crate' },
  { id: 17, label: 'Geography\nBooth 2',   kind: 'booth',   emoji: '🗺️', zone: 'geography' },
  { id: 18, label: 'Geography\nBooth 3',   kind: 'booth',   emoji: '🗺️', zone: 'geography' },
  { id: 19, label: 'VENDOR\nTAX',         kind: 'tax',     emoji: '💸', zone: 'geography', subLabel: 'Pay % of Coins' },
  { id: 20, label: 'Geography\nBooth 4',   kind: 'booth',   emoji: '🗺️', zone: 'geography' },

  // ➡️ Right (Food & Drinks — Orange)
  { id: 21, label: 'EL LAGNA\nCHECKPOINT', kind: 'corner', emoji: '🛑', zone: null, cornerCode: 'el_lagna', subLabel: 'Sent to Zahma!' },
  { id: 22, label: 'Food\nBooth 1',        kind: 'booth',   emoji: '🥙', zone: 'food' },
  { id: 23, label: 'POWER\nSTATION',       kind: 'power',   emoji: '🔋', zone: 'food', subLabel: '+1 Energy' },
  { id: 24, label: 'Food\nBooth 2',        kind: 'booth',   emoji: '🥙', zone: 'food' },
  { id: 25, label: 'Food\nBooth 3',        kind: 'booth',   emoji: '🥙', zone: 'food' },
  { id: 26, label: 'SPONSOR\nTENT',        kind: 'sponsor', emoji: '🎁', zone: 'food', subLabel: 'Mystery Crate' },
  { id: 27, label: 'Food\nBooth 4',        kind: 'booth',   emoji: '🥙', zone: 'food' },
];

const TILE_COUNT = TILES.length; // 28

/* ── Grid placement: 8×8, corners at 4 corners, 6 per side ── */
type Side = 'corner' | 'bottom' | 'left' | 'top' | 'right';
interface CellPlacement { col: number; row: number; side: Side }

function placeTile(idx: number): CellPlacement {
  const i = ((idx % TILE_COUNT) + TILE_COUNT) % TILE_COUNT;
  // Bottom row (right→left): slots 0–6  →  col 8→2, row 8
  if (i === 0) return { col: 8, row: 8, side: 'corner' };
  if (i >= 1 && i <= 6) return { col: 8 - i, row: 8, side: 'bottom' };
  // Left col (bottom→top): slots 7–13  →  col 1, row 8→2
  if (i === 7) return { col: 1, row: 8, side: 'corner' };
  if (i >= 8 && i <= 13) return { col: 1, row: 8 - (i - 7), side: 'left' };
  // Top row (left→right): slots 14–20  →  col 1→7, row 1
  if (i === 14) return { col: 1, row: 1, side: 'corner' };
  if (i >= 15 && i <= 20) return { col: 1 + (i - 14), row: 1, side: 'top' };
  // Right col (top→bottom): slots 21–27  →  col 8, row 1→7
  if (i === 21) return { col: 8, row: 1, side: 'corner' };
  return { col: 8, row: 1 + (i - 21), side: 'right' };
}

/* ═══════════════════════════════════════════════════════════ */

/* ── Owner color map ───────────────────────────────────── */
const OWNER_COLORS: Record<OwnerId, string> = {
  player: '#a78bfa',
  tarek: '#ef4444',
  sara: '#22c55e',
  ahmed: '#eab308',
};

export default function ChronoBoardPage() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [match, params] = useRoute('/chrono/board/:board');

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<ChronoEmpiresBoardProgressDoc | null>(null);
  const [diceAnim, setDiceAnim] = useState(false);

  // Board game state (tile ownership, bots, coins)
  const [gameState, setGameState] = useState<BoardGameState | null>(null);

  // Landing panel
  const [landing, setLanding] = useState<LandingResult>(null);

  // Auction
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const auctionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Landing message
  const [landingMsg, setLandingMsg] = useState<string | null>(null);

  // Inventory (for deck strip + transport + combat)
  const [inventory, setInventory] = useState<ChronoInventoryDoc | null>(null);

  // Attack modal
  const [attackModal, setAttackModal] = useState<{ type: 'attack' | 'defend'; } | null>(null);
  const [attackTarget, setAttackTarget] = useState<{ kind: 'board'; tileId: number } | { kind: 'friend' } | null>(null);

  const board = useMemo(() => {
    if (!match) return 100;
    const raw = (params as any)?.board;
    const n = typeof raw === 'string' ? Number(raw) : 100;
    if (!Number.isFinite(n)) return 100;
    return Math.max(100, Math.min(3000, Math.round(n)));
  }, [match, params]);

  const classLevel = boardToClass(board);

  const cells = useMemo(() => TILES.map((t) => ({ ...t, ...placeTile(t.id) })), []);

  useEffect(() => { if (!loading && !user) setLocation('/'); }, [user, loading]);

  useEffect(() => {
    async function loadAll() {
      if (!user) return;
      setErr(null);
      try {
        await ensureChronoBoardProgress(user.uid, board);
        const p = await getChronoBoardProgress(user.uid, board);
        setProgress(p);
        const gs = await ensureBoardState(user.uid, board, classLevel);
        setGameState(gs);
        await ensureInventory(user.uid);
        const inv = await getInventory(user.uid);
        setInventory(inv);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg || 'Failed to load board');
      }
    }
    void loadAll();
  }, [user, board, classLevel]);

  // Cleanup auction timer
  useEffect(() => {
    return () => { if (auctionTimerRef.current) clearInterval(auctionTimerRef.current); };
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', color: '#94a3b8' }}>Loading…</div>;
  }
  if (!user) return null;

  const pos = progress?.position ?? 0;
  const lastRoll = progress?.lastRoll;
  const jailTurns = progress?.jailTurnsRemaining ?? 0;
  const extraRolls = progress?.extraRolls ?? 0;
  const lastEvent = progress?.lastEvent;

  /* ── Save game state helper ────────────────────────── */
  async function persistState(gs: BoardGameState) {
    if (!user) return;
    setGameState(gs);
    await saveBoardState(user.uid, board, gs).catch(() => {});
  }

  /* ── Process landing after dice roll ───────────────── */
  function processLanding(tileId: number) {
    if (!gameState) return;
    const tile = TILES.find((t) => t.id === tileId);
    if (!tile) return;

    const result = resolveLanding(tileId, tile.kind, gameState, classLevel);
    if (!result || result.type === 'corner') return; // corners handled by service

    if (result.type === 'power_station') {
      setLandingMsg('🔋 Power Station: +1 Energy!');
      setTimeout(() => setLandingMsg(null), 2500);
      return;
    }

    if (result.type === 'sponsor_tent') {
      const reward = rollSponsorReward();
      if (reward.type === 'coins') {
        const gs = { ...structuredClone(gameState), playerCoins: gameState.playerCoins + reward.amount };
        void persistState(gs);
        setLandingMsg(`🎁 Sponsor Tent: +${reward.amount} coins!`);
      } else if (reward.type === 'energy') {
        setLandingMsg('🎁 Sponsor Tent: +1 Energy!');
      } else {
        setLandingMsg('🎁 Sponsor Tent: +1 Card Copy!');
      }
      setTimeout(() => setLandingMsg(null), 2500);
      return;
    }

    if (result.type === 'vendor_tax') {
      const gs = payTax(gameState, result.amount);
      void persistState(gs);
      setLandingMsg(`💸 Vendor Tax: -${result.amount} coins!`);
      setTimeout(() => setLandingMsg(null), 2500);
      return;
    }

    if (result.type === 'own_booth') {
      setLandingMsg(`🏠 Your booth! Rent value: ${result.rent} coins.`);
      setTimeout(() => setLandingMsg(null), 2500);
      return;
    }

    if (result.type === 'bot_booth') {
      const gs = payRent(gameState, result.rent, result.owner.id);
      void persistState(gs);
      setLandingMsg(`💰 Paid ${result.rent} rent to ${result.owner.emoji} ${result.owner.name}!`);
      setTimeout(() => setLandingMsg(null), 3000);
      return;
    }

    if (result.type === 'empty_booth') {
      setLanding(result);
      return;
    }
  }

  /* ── Handle dice roll ──────────────────────────────── */
  async function handleRoll(opts?: { payBail?: boolean }) {
    if (!user || landing || auction) return;
    setSaving(true); setErr(null); setDiceAnim(true); setLandingMsg(null);
    try {
      const res = await rollBoardTurn(user.uid, board, TILE_COUNT, { payBail: Boolean(opts?.payBail) });
      if (res?.progress) {
        setProgress(res.progress);
        // Process landing effect
        setTimeout(() => processLanding(res.progress.position), 400);
      } else {
        setProgress(await getChronoBoardProgress(user.uid, board));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to roll');
    } finally {
      setSaving(false);
      setTimeout(() => setDiceAnim(false), 600);
    }
  }

  /* ── Buy Now (empty booth) ─────────────────────────── */
  function handleBuyNow() {
    if (!gameState || !landing || landing.type !== 'empty_booth') return;
    if (gameState.playerCoins < landing.buyPrice) {
      setLandingMsg('❌ Not enough coins!');
      setLanding(null);
      setTimeout(() => setLandingMsg(null), 2000);
      return;
    }
    const gs = buyBooth(gameState, landing.tileId, landing.buyPrice);
    void persistState(gs);
    setLandingMsg(`✅ Bought Booth #${landing.tileId} for ${landing.buyPrice} coins!`);
    setLanding(null);
    setTimeout(() => setLandingMsg(null), 2500);
  }

  /* ── Start Auction (El Mazad) ──────────────────────── */
  function handleStartAuction() {
    if (!landing || landing.type !== 'empty_booth') return;
    const auc = createAuction(landing.tileId, Math.floor(landing.buyPrice * 0.5));
    setAuction(auc);
    setLanding(null);

    // Start auction timer
    if (auctionTimerRef.current) clearInterval(auctionTimerRef.current);
    auctionTimerRef.current = setInterval(() => {
      setAuction((prev) => {
        if (!prev || !prev.active) {
          if (auctionTimerRef.current) clearInterval(auctionTimerRef.current);
          return prev;
        }
        const newTimer = prev.timer - 1;
        if (newTimer <= 0) {
          // Auction ends
          if (auctionTimerRef.current) clearInterval(auctionTimerRef.current);
          return { ...prev, timer: 0, active: false, log: [...prev.log, `⏰ Time's up! ${prev.currentBidder ? (prev.currentBidder === 'player' ? 'You win!' : `${prev.currentBidder} wins!`) : 'No bids — booth stays empty.'}`] };
        }

        // Bot turn every other second
        if (newTimer % 2 === 0 && gameState) {
          const activeBots = gameState.bots.filter((b) => b.coins > prev.currentBid);
          if (activeBots.length > 0) {
            const bot = activeBots[Math.floor(Math.random() * activeBots.length)];
            const { bid, folds } = botBid(bot, prev);
            if (!folds && bid > prev.currentBid) {
              return {
                ...prev,
                timer: 3, // reset timer on new bid
                currentBid: bid,
                currentBidder: bot.id,
                log: [...prev.log, `${bot.emoji} ${bot.name} bids ${bid} coins!`],
              };
            }
          }
        }

        return { ...prev, timer: newTimer };
      });
    }, 1000);
  }

  /* ── Player auction bid ────────────────────────────── */
  function handlePlayerBid(raise: number) {
    if (!auction || !auction.active || !gameState) return;
    const updated = playerBid(auction, raise, gameState.playerCoins);
    setAuction(updated);
  }

  /* ── Fold auction ──────────────────────────────────── */
  function handleFold() {
    if (!auction || !auction.active) return;
    setAuction({
      ...auction,
      active: false,
      log: [...auction.log, '🙅 You folded.'],
    });
    if (auctionTimerRef.current) clearInterval(auctionTimerRef.current);
    // Let bots finish fighting
    finishAuctionBotOnly();
  }

  function finishAuctionBotOnly() {
    if (!gameState || !auction) return;
    // Quick bot auction resolution
    let auc = { ...auction };
    for (let round = 0; round < 5; round++) {
      const activeBots = gameState.bots.filter((b) => b.coins > auc.currentBid);
      if (activeBots.length === 0) break;
      const bot = activeBots[Math.floor(Math.random() * activeBots.length)];
      const { bid, folds } = botBid(bot, auc);
      if (folds) continue;
      auc = { ...auc, currentBid: bid, currentBidder: bot.id, log: [...auc.log, `${bot.emoji} ${bot.name} bids ${bid}!`] };
    }
    auc.active = false;
    auc.log.push(auc.currentBidder ? `🏆 ${auc.currentBidder} wins the auction!` : 'No winner.');
    setAuction(auc);
  }

  /* ── Resolve finished auction ──────────────────────── */
  function handleCloseAuction() {
    if (!auction || !gameState) return;
    const gs = resolveAuction(gameState, auction);
    void persistState(gs);
    setLandingMsg(auction.currentBidder === 'player'
      ? `🏆 You won Booth #${auction.tileId} for ${auction.currentBid} coins!`
      : auction.currentBidder
        ? `${auction.currentBidder} won the auction.`
        : 'Booth stays empty.'
    );
    setAuction(null);
    setTimeout(() => setLandingMsg(null), 3000);
  }

  /* ── Use transport card (move 2–12 on the board) ──── */
  async function handleUseTransport() {
    if (!user || !inventory || landing || auction) return;
    // Find a transport card the player owns
    const available = ALL_TRANSPORT_CARDS.filter((tc) => (inventory.transportCards[tc.id] ?? 0) > 0 && board >= tc.unlockBoard);
    if (available.length === 0) { setLandingMsg('❌ No transport cards available!'); setTimeout(() => setLandingMsg(null), 2000); return; }
    // Use the first available (could add picker later)
    const card = available[0];
    const used = await useTransportCard(user.uid, card.id);
    if (!used) { setLandingMsg('❌ Failed to use transport card.'); setTimeout(() => setLandingMsg(null), 2000); return; }
    // Refresh inventory
    const inv = await getInventory(user.uid);
    setInventory(inv);
    // Roll and move (uses transport → rollBoardTurn)
    setSaving(true); setDiceAnim(true); setLandingMsg(null);
    try {
      const res = await rollBoardTurn(user.uid, board, TILE_COUNT);
      if (res?.progress) {
        setProgress(res.progress);
        setTimeout(() => processLanding(res.progress.position), 400);
      }
      setLandingMsg(`🚗 Used ${card.emoji} ${card.name}!`);
      setTimeout(() => setLandingMsg(null), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); setTimeout(() => setDiceAnim(false), 600); }
  }

  /* ── Attack a bot-owned booth on this board ────────── */
  function handleAttackBooth(tileId: number) {
    if (!gameState || !inventory || inventory.attackCards <= 0) return;
    const booth = gameState.booths[tileId];
    if (!booth || !booth.owner || booth.owner === 'player') return;
    // Check sabotage defense
    const cardLvl = CARD_UPGRADE_LEVELS.find((l) => l.level === booth.cardLevel);
    const defense = cardLvl?.sabotageDefense ?? 0;
    if (Math.random() < defense) {
      setLandingMsg(`🛡️ Attack deflected! Booth #${tileId} has ${Math.round(defense * 100)}% defense.`);
      setTimeout(() => setLandingMsg(null), 2500);
      return;
    }
    // Remove ownership
    const next = structuredClone(gameState);
    next.booths[tileId].owner = null;
    next.booths[tileId].cardId = null;
    next.booths[tileId].cardLevel = 1;
    const bot = next.bots.find((b) => b.id === booth.owner);
    if (bot) bot.ownedBooths = bot.ownedBooths.filter((id) => id !== tileId);
    void persistState(next);
    setLandingMsg(`⚔️ Successfully attacked Booth #${tileId}! Card removed.`);
    setAttackModal(null);
    setTimeout(() => setLandingMsg(null), 3000);
    // Decrement attack card (via inventory service update in future)
  }

  /* ── Zone color bar positioning ────────────────────── */
  function zoneBar(side: string, color: string): React.CSSProperties {
    const base: React.CSSProperties = { position: 'absolute', background: color, zIndex: 1 };
    if (side === 'bottom') return { ...base, top: 0, left: 0, width: '100%', height: '22%' };
    if (side === 'top')    return { ...base, bottom: 0, left: 0, width: '100%', height: '22%' };
    if (side === 'left')   return { ...base, right: 0, top: 0, width: '22%', height: '100%' };
    if (side === 'right')  return { ...base, left: 0, top: 0, width: '22%', height: '100%' };
    return {};
  }

  function rotateForSide(side: string): string {
    if (side === 'left')  return 'rotate(90deg)';
    if (side === 'right') return 'rotate(-90deg)';
    if (side === 'top')   return 'rotate(180deg)';
    return 'none';
  }

  /* ── Event banner color ────────────────────────────── */
  function eventBannerStyle(): React.CSSProperties {
    if (!lastEvent) return {};
    if (lastEvent.includes('MAIN GATE'))
      return { border: '1px solid rgba(16,185,129,0.40)', background: 'rgba(6,78,59,0.25)', color: '#86efac' };
    if (lastEvent.includes('El Lagna') || lastEvent.includes('Zahma'))
      return { border: '1px solid rgba(248,113,113,0.40)', background: 'rgba(127,29,29,0.22)', color: '#fecaca' };
    if (lastEvent.includes('bail') || lastEvent.includes('Bail'))
      return { border: '1px solid rgba(234,179,8,0.35)', background: 'rgba(113,63,18,0.22)', color: '#fde68a' };
    if (lastEvent.includes('El Ahwa'))
      return { border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(30,58,138,0.22)', color: '#bfdbfe' };
    return { border: '1px solid rgba(34,211,238,0.22)', background: 'rgba(2,132,199,0.12)', color: '#bae6fd' };
  }

  /* ━━━━━━━━━━━━━━━━━━━━━━ RENDER ━━━━━━━━━━━━━━━━━━━━━━ */
  const disableRoll = saving || !!landing || !!auction;

  return (
    <div style={{ height: '100vh', background: '#0f172a', color: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ─── Top bar ─────────────────────────────────── */}
      <div style={{
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid #1e293b', background: 'linear-gradient(180deg, rgba(15,23,42,0.98), rgba(15,23,42,0.92))',
      }}>
        <button onClick={() => setLocation('/app')} style={{
          background: 'rgba(51,65,85,0.45)', border: '1px solid #334155', borderRadius: 8,
          color: '#94a3b8', padding: '6px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer',
        }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 1000 }}>🏰 Board {board} · Class {classLevel}</div>
        </div>
        {/* Coins */}
        {gameState && (
          <span style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.30)', borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 1000, color: '#fde68a' }}>
            🪙 {gameState.playerCoins.toLocaleString()}
          </span>
        )}
        {/* Dice display */}
        <div style={{
          width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 1000, background: 'rgba(30,41,59,0.80)', border: '1px solid #334155',
          color: '#e2e8f0', transition: 'transform 0.3s', transform: diceAnim ? 'rotate(360deg) scale(1.15)' : 'none',
        }}>
          {typeof lastRoll === 'number' ? lastRoll : '🎲'}
        </div>
      </div>

      {/* ─── Banners ─────────────────────────────────── */}
      <div style={{ padding: '0 14px' }}>
        {err && (
          <div style={{ marginTop: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.18)', color: '#fecaca', fontSize: 11, fontWeight: 900 }}>{err}</div>
        )}
        {lastEvent && lastEvent !== 'Moved.' && (
          <div style={{ marginTop: 6, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 1000, ...eventBannerStyle() }}>{lastEvent}</div>
        )}
        {landingMsg && (
          <div style={{ marginTop: 6, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 1000, border: '1px solid rgba(34,211,238,0.30)', background: 'rgba(2,132,199,0.15)', color: '#67e8f9' }}>{landingMsg}</div>
        )}
      </div>

      {/* ─── Board + controls ────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 12, gap: 10 }}>

        {/* Status pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ background: 'rgba(167,139,250,0.14)', border: '1px solid rgba(167,139,250,0.30)', borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 900, color: '#c4b5fd' }}>
            Slot {pos}/{TILE_COUNT - 1}
          </span>
          {extraRolls > 0 && (
            <span style={{ background: 'rgba(52,211,153,0.14)', border: '1px solid rgba(52,211,153,0.30)', borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 900, color: '#6ee7b7' }}>
              +{extraRolls} spin
            </span>
          )}
          {jailTurns > 0 && (
            <span style={{ background: 'rgba(248,113,113,0.14)', border: '1px solid rgba(248,113,113,0.30)', borderRadius: 20, padding: '3px 10px', fontSize: 10, fontWeight: 900, color: '#fca5a5' }}>
              🚦 {jailTurns}t
            </span>
          )}
          {/* Bot coin summary */}
          {gameState?.bots.map((b) => (
            <span key={b.id} style={{ background: 'rgba(30,41,59,0.50)', border: '1px solid #334155', borderRadius: 20, padding: '3px 8px', fontSize: 9, fontWeight: 900, color: OWNER_COLORS[b.id] }}>
              {b.emoji} {b.coins}
            </span>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={disableRoll} onClick={() => void handleRoll()} style={{
            background: jailTurns > 0 ? 'linear-gradient(135deg,#78716c,#57534e)' : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
            border: 'none', borderRadius: 10, color: 'white', padding: '8px 18px', fontSize: 12, fontWeight: 1000,
            cursor: disableRoll ? 'wait' : 'pointer', opacity: disableRoll ? 0.5 : 1,
            boxShadow: jailTurns > 0 ? 'none' : '0 3px 12px rgba(124,58,237,0.35)', transition: 'all 0.2s',
          }}>
            {jailTurns > 0 ? '⏭ Skip' : '🎲 Roll'}
          </button>
          {jailTurns > 0 && (
            <button disabled={disableRoll} onClick={() => void handleRoll({ payBail: true })} style={{
              background: 'linear-gradient(135deg,#d97706,#b45309)', border: 'none', borderRadius: 10,
              color: 'white', padding: '8px 18px', fontSize: 12, fontWeight: 1000,
              cursor: disableRoll ? 'wait' : 'pointer', opacity: disableRoll ? 0.5 : 1,
              boxShadow: '0 3px 12px rgba(217,119,6,0.30)', transition: 'all 0.2s',
            }}>
              🚁 Pay 100
            </button>
          )}
        </div>

        {/* ━━ THE BOARD (8×8) ━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr repeat(6, 1fr) 1.4fr',
          gridTemplateRows: '1.4fr repeat(6, 1fr) 1.4fr',
          width: 'min(90vmin, 640px)',
          height: 'min(90vmin, 640px)',
          background: '#dde4ed',
          border: '3px solid #1e293b',
          borderRadius: 10,
          boxShadow: '0 8px 40px rgba(0,0,0,0.50)',
          overflow: 'hidden',
          flexShrink: 0,
        }}>

          {/* Center area */}
          <div style={{
            gridColumn: '2 / 8', gridRow: '2 / 8',
            background: 'radial-gradient(ellipse at 40% 40%, #1e293b, #0f172a)',
            border: '2px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', inset: 0, opacity: 0.03,
              backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 14px, white 14px, white 15px)',
            }} />
            <div style={{
              fontSize: 'clamp(16px,5vmin,42px)', fontWeight: 1000, color: '#22d3ee',
              textTransform: 'uppercase', letterSpacing: 4, transform: 'rotate(-45deg)',
              textShadow: '0 0 20px rgba(34,211,238,0.25)', textAlign: 'center', lineHeight: 1.1,
              userSelect: 'none',
            }}>
              Chrono<br/>Empires
            </div>
          </div>

          {/* Tiles */}
          {cells.map((t) => {
            const active = t.id === pos;
            const side = t.side;
            const isCorner = side === 'corner';
            const zc = t.zone ? ZONE_COLOR[t.zone] : null;
            const showBar = t.kind === 'booth' && zc;
            const labelLines = t.label.split('\n');

            // Ownership indicator
            const boothState = gameState?.booths[t.id];
            const owner = boothState?.owner;
            const ownerColor = owner ? OWNER_COLORS[owner] : null;

            // Bot tokens on this tile
            const botsHere = gameState?.bots.filter((b) => b.position === t.id) ?? [];

            return (
              <div
                key={t.id}
                style={{
                  gridColumn: String(t.col), gridRow: String(t.row),
                  border: active ? '2px solid #a78bfa'
                    : ownerColor ? `2px solid ${ownerColor}`
                    : '1px solid rgba(30,41,59,0.50)',
                  background: isCorner && t.cornerCode
                    ? CORNER_BG[t.cornerCode]
                    : active
                      ? 'linear-gradient(135deg, rgba(167,139,250,0.12), rgba(96,165,250,0.08)), #fff'
                      : '#fff',
                  color: '#0f172a', position: 'relative',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                  textAlign: 'center', boxSizing: 'border-box', padding: 2, overflow: 'hidden',
                  transform: rotateForSide(side), transformOrigin: 'center',
                  zIndex: active ? 2 : 1,
                  boxShadow: active ? '0 0 14px rgba(167,139,250,0.40)' : 'none',
                }}
                title={`#${t.id} — ${t.label.replace(/\n/g, ' ')}${owner ? ' (owned by ' + owner + ')' : ''}`}
              >
                {/* Zone color bar for booths */}
                {showBar && zc && <div style={zoneBar(side, zc.bar)} />}

                {/* Owner dot (top-right) */}
                {ownerColor && (
                  <div style={{
                    position: 'absolute', top: 2, right: 2, width: 'clamp(5px,1vmin,8px)', height: 'clamp(5px,1vmin,8px)',
                    borderRadius: 999, background: ownerColor, zIndex: 3, border: '1px solid white',
                  }} />
                )}

                {/* Tile emoji */}
                <div style={{
                  fontSize: isCorner ? 'clamp(12px,2.4vmin,22px)' : 'clamp(10px,1.8vmin,16px)',
                  lineHeight: 1, zIndex: 2,
                }}>
                  {t.emoji}
                </div>

                {/* Label */}
                <div style={{
                  fontSize: isCorner ? 'clamp(5px,0.9vmin,9px)' : 'clamp(5px,0.8vmin,8px)',
                  fontWeight: 900, color: '#1e293b', lineHeight: 1.05, zIndex: 2, marginTop: 1, padding: '0 1px',
                }}>
                  {labelLines.map((ln, idx) => <div key={idx}>{ln}</div>)}
                </div>

                {/* Player token */}
                {active && (
                  <div style={{
                    position: 'absolute', bottom: 2, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 5, pointerEvents: 'none',
                  }}>
                    <div style={{
                      width: 'clamp(8px,1.5vmin,14px)', height: 'clamp(8px,1.5vmin,14px)',
                      borderRadius: 999, background: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
                      border: '2px solid white', animation: 'ce-pulse 1.8s ease-in-out infinite',
                    }} />
                  </div>
                )}

                {/* Bot tokens on tile */}
                {botsHere.length > 0 && (
                  <div style={{
                    position: 'absolute', bottom: 2, right: 2, zIndex: 4,
                    display: 'flex', gap: 1, pointerEvents: 'none',
                  }}>
                    {botsHere.map((b) => (
                      <div key={b.id} style={{
                        width: 'clamp(6px,1vmin,10px)', height: 'clamp(6px,1vmin,10px)',
                        borderRadius: 999, background: OWNER_COLORS[b.id],
                        border: '1px solid white', fontSize: 'clamp(5px,0.7vmin,7px)',
                      }} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ─── Landing Panel (empty booth) ─────────────── */}
        {landing && landing.type === 'empty_booth' && (
          <div style={{
            width: '100%', maxWidth: 640, borderRadius: 12, padding: 16,
            background: 'linear-gradient(135deg, rgba(30,41,59,0.95), rgba(15,23,42,0.98))',
            border: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>
              🏗️ Empty Booth #{landing.tileId}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>
              Buy this booth for <span style={{ color: '#fde68a', fontWeight: 1000 }}>{landing.buyPrice} coins</span>, or send it to auction!
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleBuyNow} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                background: 'linear-gradient(135deg,#059669,#047857)', border: 'none',
                color: 'white', cursor: 'pointer',
              }}>
                💰 Buy Now ({landing.buyPrice})
              </button>
              <button onClick={handleStartAuction} style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                background: 'linear-gradient(135deg,#d97706,#b45309)', border: 'none',
                color: 'white', cursor: 'pointer',
              }}>
                🔨 El Mazad (Auction)
              </button>
              <button onClick={() => setLanding(null)} style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                background: 'rgba(51,65,85,0.45)', border: '1px solid #334155',
                color: '#94a3b8', cursor: 'pointer',
              }}>
                Skip
              </button>
            </div>
          </div>
        )}

        {/* ─── Auction Overlay (El Mazad) ────────────── */}
        {auction && (
          <div style={{
            width: '100%', maxWidth: 640, borderRadius: 12, padding: 16,
            background: 'linear-gradient(135deg, rgba(113,63,18,0.20), rgba(15,23,42,0.98))',
            border: '2px solid rgba(217,119,6,0.40)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ color: '#fbbf24', fontWeight: 1000, fontSize: 14 }}>
                🔨 El Mazad — Booth #{auction.tileId}
              </div>
              <div style={{
                background: auction.active ? 'rgba(239,68,68,0.20)' : 'rgba(34,211,238,0.15)',
                border: `1px solid ${auction.active ? 'rgba(239,68,68,0.40)' : 'rgba(34,211,238,0.30)'}`,
                borderRadius: 20, padding: '3px 10px', fontSize: 12, fontWeight: 1000,
                color: auction.active ? '#fca5a5' : '#67e8f9',
              }}>
                {auction.active ? `⏱ ${auction.timer}s` : '✅ Done'}
              </div>
            </div>

            {/* Current bid */}
            <div style={{ color: 'white', fontSize: 18, fontWeight: 1000, textAlign: 'center' }}>
              🪙 {auction.currentBid.toLocaleString()}
              {auction.currentBidder && (
                <span style={{ fontSize: 12, color: OWNER_COLORS[auction.currentBidder] ?? '#94a3b8', marginLeft: 8 }}>
                  ({auction.currentBidder === 'player' ? 'You' : auction.currentBidder})
                </span>
              )}
            </div>

            {/* Bid log */}
            <div style={{
              maxHeight: 100, overflowY: 'auto', padding: 8, borderRadius: 8,
              background: 'rgba(0,0,0,0.20)', fontSize: 10, color: '#94a3b8', lineHeight: 1.5,
            }}>
              {auction.log.map((msg, i) => <div key={i}>{msg}</div>)}
            </div>

            {/* Player actions */}
            {auction.active ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handlePlayerBid(100)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                  background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', border: 'none',
                  color: 'white', cursor: 'pointer',
                }}>
                  +100
                </button>
                <button onClick={() => handlePlayerBid(1000)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                  background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: 'none',
                  color: 'white', cursor: 'pointer',
                }}>
                  +1000
                </button>
                <button onClick={handleFold} style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                  background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
                  color: '#fca5a5', cursor: 'pointer',
                }}>
                  🙅 Fold
                </button>
              </div>
            ) : (
              <button onClick={handleCloseAuction} style={{
                padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                background: 'linear-gradient(135deg,#059669,#047857)', border: 'none',
                color: 'white', cursor: 'pointer', width: '100%',
              }}>
                ✅ Close Auction
              </button>
            )}
          </div>
        )}

        {/* Bot bar at bottom */}
        {gameState && (
          <div style={{
            width: '100%', maxWidth: 640, display: 'flex', gap: 6, justifyContent: 'center',
          }}>
            {gameState.bots.map((b) => (
              <div key={b.id} style={{
                flex: 1, padding: '8px 6px', borderRadius: 8, textAlign: 'center',
                background: 'rgba(30,41,59,0.60)', border: `1px solid ${OWNER_COLORS[b.id]}40`,
              }}>
                <div style={{ fontSize: 16 }}>{b.emoji}</div>
                <div style={{ color: OWNER_COLORS[b.id], fontWeight: 1000, fontSize: 10 }}>{b.name}</div>
                <div style={{ color: '#64748b', fontSize: 9 }}>
                  {b.ownedBooths.length} booths · 🪙{b.coins}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ━━ DECK STRIP + TRANSPORT ━━━━━━━━━━━━━━━━━━━━ */}
        {inventory && (
          <div style={{
            width: '100%', maxWidth: 640, display: 'flex', gap: 6, alignItems: 'stretch',
          }}>
            {/* Active deck cards */}
            <div style={{
              flex: 1, display: 'flex', gap: 4, overflowX: 'auto', padding: '6px 0',
              minWidth: 0,
            }}>
              {inventory.deck.length === 0 ? (
                <div style={{ color: '#475569', fontSize: 10, fontWeight: 900, padding: '8px 12px', whiteSpace: 'nowrap' }}>
                  🃏 No cards in deck — add via Inventory
                </div>
              ) : (
                inventory.deck.map((cardId) => {
                  const card = ALL_CATEGORY_CARDS.find((c) => c.id === cardId);
                  const owned = inventory.cards[cardId] as OwnedCard | undefined;
                  const lvlDef = CARD_UPGRADE_LEVELS.find((l) => l.level === (owned?.level ?? 1));
                  if (!card) return null;
                  return (
                    <div key={cardId} style={{
                      minWidth: 48, width: 48, padding: '4px 2px', borderRadius: 6, textAlign: 'center',
                      background: 'rgba(30,41,59,0.80)',
                      border: `1.5px solid ${lvlDef?.borderColor ?? '#334155'}`,
                      flexShrink: 0,
                    }}>
                      <div style={{ fontSize: 14, lineHeight: 1 }}>{card.emoji}</div>
                      <div style={{ fontSize: 7, fontWeight: 900, color: '#e2e8f0', lineHeight: 1.1, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {card.name}
                      </div>
                      <div style={{ fontSize: 6, color: lvlDef?.borderColor ?? '#64748b', fontWeight: 1000 }}>
                        Lv.{owned?.level ?? 1}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Transport card button */}
            <button
              disabled={saving || !!landing || !!auction}
              onClick={() => void handleUseTransport()}
              style={{
                minWidth: 56, padding: '6px 8px', borderRadius: 8, textAlign: 'center',
                background: 'linear-gradient(135deg, rgba(6,78,59,0.40), rgba(5,150,105,0.20))',
                border: '1.5px solid rgba(16,185,129,0.40)',
                color: '#6ee7b7', cursor: 'pointer', flexShrink: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                opacity: saving || !!landing || !!auction ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 16 }}>🚗</div>
              <div style={{ fontSize: 8, fontWeight: 1000, lineHeight: 1 }}>Transport</div>
              <div style={{ fontSize: 7, color: '#4ade80', fontWeight: 900 }}>
                {ALL_TRANSPORT_CARDS.reduce((sum, tc) => sum + (inventory.transportCards[tc.id] ?? 0), 0)} left
              </div>
            </button>
          </div>
        )}

        {/* ━━ ATTACK / DEFEND SLOTS ━━━━━━━━━━━━━━━━━━━━━ */}
        {inventory && (
          <div style={{
            width: '100%', maxWidth: 640, display: 'flex', gap: 8, justifyContent: 'center',
          }}>
            {/* Attack cards */}
            <div style={{
              flex: 1, display: 'flex', gap: 4, alignItems: 'center',
              padding: '6px 8px', borderRadius: 8,
              background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.20)',
            }}>
              <div style={{ fontSize: 16, flexShrink: 0 }}>⚔️</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 1000, color: '#fca5a5' }}>Attack</div>
                <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: i < inventory.attackCards ? 'rgba(239,68,68,0.30)' : 'rgba(30,41,59,0.50)',
                      border: `1px solid ${i < inventory.attackCards ? 'rgba(239,68,68,0.50)' : '#334155'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9,
                    }}>
                      {i < inventory.attackCards ? '⚔️' : ''}
                    </div>
                  ))}
                </div>
              </div>
              {inventory.attackCards > 0 && (
                <button
                  onClick={() => setAttackModal({ type: 'attack' })}
                  style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: 9, fontWeight: 1000,
                    background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.40)',
                    color: '#fca5a5', cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  Use
                </button>
              )}
            </div>

            {/* Defend cards */}
            <div style={{
              flex: 1, display: 'flex', gap: 4, alignItems: 'center',
              padding: '6px 8px', borderRadius: 8,
              background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.20)',
            }}>
              <div style={{ fontSize: 16, flexShrink: 0 }}>🛡️</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 1000, color: '#93c5fd' }}>Defend</div>
                <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: i < inventory.defendCards ? 'rgba(59,130,246,0.30)' : 'rgba(30,41,59,0.50)',
                      border: `1px solid ${i < inventory.defendCards ? 'rgba(59,130,246,0.50)' : '#334155'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9,
                    }}>
                      {i < inventory.defendCards ? '🛡️' : ''}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 9, color: '#64748b', fontWeight: 900, flexShrink: 0 }}>
                {inventory.defendCards}/3
              </div>
            </div>
          </div>
        )}

        {/* ━━ ATTACK TARGET MODAL ━━━━━━━━━━━━━━━━━━━━━━━ */}
        {attackModal && (
          <div style={{
            width: '100%', maxWidth: 640, borderRadius: 12, padding: 16,
            background: 'linear-gradient(135deg, rgba(127,29,29,0.15), rgba(15,23,42,0.98))',
            border: '2px solid rgba(239,68,68,0.35)',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{ color: '#fca5a5', fontWeight: 1000, fontSize: 14 }}>
              ⚔️ Choose Attack Target
            </div>
            <div style={{ color: '#94a3b8', fontSize: 11 }}>
              Select a bot-owned booth on this board to attack, or attack a friend's board.
            </div>

            {/* Bot-owned booths on this board */}
            {gameState && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.values(gameState.booths)
                  .filter((b) => b.owner && b.owner !== 'player')
                  .map((b) => {
                    const botOwner = gameState.bots.find((bt) => bt.id === b.owner);
                    return (
                      <button
                        key={b.tileId}
                        onClick={() => handleAttackBooth(b.tileId)}
                        style={{
                          padding: '6px 10px', borderRadius: 8, fontSize: 10, fontWeight: 1000,
                          background: 'rgba(239,68,68,0.10)', border: `1px solid ${OWNER_COLORS[b.owner!]}50`,
                          color: OWNER_COLORS[b.owner!], cursor: 'pointer',
                        }}
                      >
                        Booth #{b.tileId} · {botOwner?.emoji} {botOwner?.name}
                      </button>
                    );
                  })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => { setLandingMsg('👥 Friend attack coming soon!'); setAttackModal(null); setTimeout(() => setLandingMsg(null), 2000); }}
                style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 11, fontWeight: 1000,
                  background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.35)',
                  color: '#c4b5fd', cursor: 'pointer',
                }}
              >
                👥 Attack Friend's Board
              </button>
              <button
                onClick={() => setAttackModal(null)}
                style={{
                  padding: '7px 14px', borderRadius: 8, fontSize: 11, fontWeight: 1000,
                  background: 'rgba(51,65,85,0.45)', border: '1px solid #334155',
                  color: '#94a3b8', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes ce-pulse {
          0%, 100% { box-shadow: 0 0 10px rgba(167,139,250,0.60), 0 0 25px rgba(124,58,237,0.25); }
          50% { box-shadow: 0 0 18px rgba(167,139,250,0.90), 0 0 40px rgba(124,58,237,0.40); }
        }
      `}</style>
    </div>
  );
}
