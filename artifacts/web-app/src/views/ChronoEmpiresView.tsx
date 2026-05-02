import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { ensureChronoEmpiresState, getChronoEmpiresState, type ChronoEmpiresStateDoc } from '@/lib/chronoEmpiresService';
import { BOARDS, boardToClass, gemsToClass, ALL_CATEGORY_CARDS, ALL_TRANSPORT_CARDS, CARD_UPGRADE_LEVELS, WHEEL_SEGMENTS, spinWheel, type CardCategory, type CategoryCard } from '@/lib/chronoCards';
import { getInventory, ensureInventory, addCardCopies, upgradeCard, addToDeck, removeFromDeck, addTransportCard, addCombatCard, type ChronoInventoryDoc, type OwnedCard } from '@/lib/chronoInventoryService';
import { claimIdleVault, syncIdleVault, type ChronoIdleVaultStatus } from '@/lib/chronoIdleVaultService';
import { buildCollectionSetViewModels, claimCollectionSetReward } from '@/lib/chronoCollectionSetsService';
import { buildDiscoveryWorkshopView, combineDiscovery } from '@/lib/chronoDiscoveryService';
import { buildChronoPrestigeViewModel, prestigeChronoRun, type ChronoPrestigeViewModel } from '@/lib/chronoPrestigeService';
import { claimChronoRewardChest, getChronoRewardChestStatus, type ChronoRewardChestStatus } from '@/lib/chronoRewardChestService';

type Section = 'road' | 'wheel' | 'inventory' | 'workshop' | 'shop' | 'tasks' | 'friends' | 'battlepass';

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'road',       label: 'Road',        icon: '🛣️' },
  { id: 'wheel',      label: 'Wheel',       icon: '🎡' },
  { id: 'inventory',  label: 'Inventory',   icon: '🎒' },
  { id: 'workshop',   label: 'Workshop',    icon: '🧪' },
  { id: 'shop',       label: 'Shop',        icon: '🛒' },
  { id: 'tasks',      label: 'Tasks',       icon: '✅' },
  { id: 'friends',    label: 'Friends',     icon: '👥' },
  { id: 'battlepass', label: 'Battle Pass', icon: '🎟️' },
];

/* ── Spectrum-of-Luxury gradient helpers ───────────────── */
function spectrumColor(pct: number): string {
  // pct 0 = top (budget/red), pct 1 = bottom (elite/black)
  if (pct < 0.33) {
    const t = pct / 0.33;
    return lerpColor('#EF4444', '#3B82F6', t);
  } else if (pct < 0.66) {
    const t = (pct - 0.33) / 0.33;
    return lerpColor('#3B82F6', '#064E3B', t);
  } else {
    const t = (pct - 0.66) / 0.34;
    return lerpColor('#064E3B', '#111827', t);
  }
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/* ── Tier label for each class range ───────────────────── */
function tierInfo(cls: number): { label: string; emoji: string } {
  if (cls <= 10) return { label: 'Low Class', emoji: '🌿' };
  if (cls <= 20) return { label: 'Mid Class', emoji: '📻' };
  return { label: 'Elite', emoji: '💎' };
}

export default function ChronoEmpiresView() {
  const { user, userData } = useAuth();
  const uid = user?.uid ?? null;
  const [, setLocation] = useLocation();

  const [section, setSection] = useState<Section>('road');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<ChronoEmpiresStateDoc | null>(null);
  const [idleVault, setIdleVault] = useState<ChronoIdleVaultStatus | null>(null);
  const [idleVaultBusy, setIdleVaultBusy] = useState(false);
  const [idleVaultMsg, setIdleVaultMsg] = useState<string | null>(null);
  const [rewardChest, setRewardChest] = useState<ChronoRewardChestStatus | null>(null);
  const [rewardChestBusy, setRewardChestBusy] = useState(false);
  const [rewardChestMsg, setRewardChestMsg] = useState<string | null>(null);
  const [prestige, setPrestige] = useState<ChronoPrestigeViewModel | null>(null);
  const [prestigeBusy, setPrestigeBusy] = useState(false);
  const [prestigeMsg, setPrestigeMsg] = useState<string | null>(null);

  const roadRef = useRef<HTMLDivElement | null>(null);
  const [inventory, setInventory] = useState<ChronoInventoryDoc | null>(null);

  const loadInventory = useCallback(async () => {
    if (!uid) return;
    await ensureInventory(uid);
    const inv = await getInventory(uid);
    setInventory(inv);
  }, [uid]);

  async function load() {
    if (!uid) return;
    setLoading(true);
    setErr(null);
    try {
      await ensureChronoEmpiresState(uid);
      const s = await getChronoEmpiresState(uid);
      setState(s);
      const board = s?.currentBoard ?? 100;
      const vault = await syncIdleVault(uid, board);
      const chest = await getChronoRewardChestStatus(uid, board);
      const prestigeVm = await buildChronoPrestigeViewModel(uid, board);
      setIdleVault(vault);
      setRewardChest(chest);
      setPrestige(prestigeVm);
      await loadInventory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to load Chrono Empires');
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimIdleVault() {
    if (!uid) return;
    setIdleVaultBusy(true);
    setIdleVaultMsg(null);
    try {
      const result = await claimIdleVault(uid);
      if (!result.ok) {
        setIdleVaultMsg(result.reason);
        return;
      }
      setIdleVaultMsg(`💰 Claimed ${result.coins.toLocaleString()} coins from your Idle Vault.`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setIdleVaultMsg(msg || 'Failed to claim Idle Vault.');
    } finally {
      setIdleVaultBusy(false);
    }
  }

  async function handleClaimRewardChest() {
    if (!uid) return;
    setRewardChestBusy(true);
    setRewardChestMsg(null);
    try {
      const result = await claimChronoRewardChest(uid, state?.currentBoard ?? 100);
      if (!result.ok) {
        setRewardChestMsg(result.reason);
        return;
      }
      const cardPart = result.reward.cardName ? ` + ${result.reward.cardEmoji ?? '🎴'} ${result.reward.cardName}` : '';
      setRewardChestMsg(`🎁 Claimed ${result.reward.coins.toLocaleString()} coins, ${result.reward.gems} gems, ${result.reward.energy} energy${cardPart}.`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRewardChestMsg(msg || 'Failed to claim reward chest.');
    } finally {
      setRewardChestBusy(false);
    }
  }

  async function handlePrestige() {
    if (!uid) return;
    setPrestigeBusy(true);
    setPrestigeMsg(null);
    try {
      const result = await prestigeChronoRun(uid, state?.currentBoard ?? 100);
      if (!result.ok) {
        setPrestigeMsg(result.reason);
        return;
      }
      setPrestigeMsg(`✨ Prestiged into Season ${result.newSeason} and earned ${result.sigilsEarned} Chrono Sigil${result.sigilsEarned === 1 ? '' : 's'}.`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPrestigeMsg(msg || 'Failed to prestige.');
    } finally {
      setPrestigeBusy(false);
    }
  }

  useEffect(() => { void load(); }, [uid]);

  if (!uid || !userData) return null;

  const currentBoard = state?.currentBoard ?? 100;
  const gems = (userData as any)?.economy?.gems ?? 0;
  const energy = (userData as any)?.economy?.energy ?? 0;
  const currentClass = boardToClass(currentBoard);
  const gemClass = gemsToClass(gems);

  /* ━━━━━━━━━━━━━━━━━━ RENDER ━━━━━━━━━━━━━━━━━━ */
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>

      {/* ── Header ─────────────────────────────────── */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 16 }}>🏰 Chrono Empires</div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>Build your empire one board at a time.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 900, color: '#6ee7b7' }}>
            ⚡ {energy}
          </span>
          <span style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.30)', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 900, color: '#c4b5fd' }}>
            💎 {gems}
          </span>
          <button onClick={() => void load()} style={{
            background: 'rgba(51,65,85,0.45)', border: '1px solid #334155', borderRadius: 8,
            color: '#94a3b8', padding: '5px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer',
          }}>↺</button>
        </div>
      </div>

      {/* ── Section tabs ───────────────────────────── */}
      <div style={{ padding: '0 12px 8px', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
        {SECTIONS.map((s) => {
          const active = s.id === section;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              style={{
                padding: '6px 12px', fontSize: 11, borderRadius: 999, whiteSpace: 'nowrap',
                background: active ? 'rgba(139,92,246,0.18)' : 'rgba(15,23,42,0.55)',
                border: active ? '1px solid rgba(139,92,246,0.50)' : '1px solid #334155',
                color: active ? '#ddd6fe' : '#94a3b8', fontWeight: 1000, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {s.icon} {s.label}
            </button>
          );
        })}
      </div>

      {err && (
        <div style={{ margin: '0 12px 8px', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.18)', color: '#fecaca', fontSize: 12, fontWeight: 900 }}>
          {err}
        </div>
      )}

      <div style={{ padding: '0 12px 8px' }}>
        <IdleVaultCard
          status={idleVault}
          busy={idleVaultBusy}
          message={idleVaultMsg}
          onClaim={() => void handleClaimIdleVault()}
        />
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <RewardChestCard
          status={rewardChest}
          busy={rewardChestBusy}
          message={rewardChestMsg}
          onClaim={() => void handleClaimRewardChest()}
        />
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <PrestigeCard
          prestige={prestige}
          currentBoard={currentBoard}
          busy={prestigeBusy}
          message={prestigeMsg}
          onPrestige={() => void handlePrestige()}
        />
      </div>

      {/* ── Content area ───────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 12px 12px' }}>
        {loading ? (
          <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading…</div>
        ) : section === 'road' ? (
          <RoadSection
            currentBoard={currentBoard}
            currentClass={currentClass}
            gemClass={gemClass}
            gems={gems}
            roadRef={roadRef}
            onOpenBoard={(b) => setLocation(`/chrono/board/${b}`)}
          />
        ) : section === 'wheel' ? (
          <WheelSection uid={uid} energy={energy} inventory={inventory} onRefresh={loadInventory} onReload={load} />
        ) : section === 'inventory' ? (
          <InventorySection uid={uid} currentBoard={currentBoard} inventory={inventory} onRefresh={loadInventory} />
        ) : section === 'workshop' ? (
          <DiscoveryWorkshopSection uid={uid} currentBoard={currentBoard} onRefresh={loadInventory} />
        ) : section === 'shop' ? (
          <ShopSection uid={uid} currentBoard={currentBoard} inventory={inventory} onRefresh={loadInventory} />
        ) : section === 'tasks' ? (
          <TasksSection uid={uid} currentBoard={currentBoard} currentClass={currentClass} gems={gems} onReload={load} />
        ) : section === 'friends' ? (
          <FriendsSection currentClass={currentClass} />
        ) : (
          <BattlePassSection />
        )}
      </div>

      <style>{`
        @keyframes ce-road-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(139,92,246,0.30)} 50%{box-shadow:0 0 0 6px rgba(139,92,246,0)} }
        @keyframes ce-wheel-spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(1800deg)} }
        @keyframes ce-wheel-result { 0%{transform:scale(0.5);opacity:0} 50%{transform:scale(1.15);opacity:1} 100%{transform:scale(1);opacity:1} }
      `}</style>
    </div>
  );
}

function IdleVaultCard({
  status,
  busy,
  message,
  onClaim,
}: {
  status: ChronoIdleVaultStatus | null;
  busy: boolean;
  message: string | null;
  onClaim: () => void;
}) {
  const accruedCoins = status?.accruedCoins ?? 0;
  const warmupProgress = status?.warmupProgress ?? 0;
  const warmupGoal = status?.warmupGoal ?? 3;
  const claimReady = !!status?.claimReady;
  const hourlyIncome = status?.hourlyIncome ?? 0;
  const maxStoredCoins = status?.maxStoredCoins ?? 0;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.98))',
      border: '1px solid rgba(250,204,21,0.24)',
      borderRadius: 14,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 15 }}>🏦 Idle Vault</div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
            Your owned booths generate offline rent while you are away. Answer 3 study questions correctly to unlock the vault.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#facc15', fontWeight: 1000, fontSize: 20 }}>🪙 {accruedCoins.toLocaleString()}</div>
          <div style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>Stored cap: {maxStoredCoins.toLocaleString()}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <div style={{ background: 'rgba(15,23,42,0.65)', border: '1px solid #334155', borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ color: '#64748b', fontSize: 10, fontWeight: 900 }}>Offline income / hour</div>
          <div style={{ color: 'white', fontWeight: 1000, marginTop: 4 }}>{hourlyIncome.toLocaleString()} coins</div>
        </div>
        <div style={{ background: 'rgba(15,23,42,0.65)', border: '1px solid #334155', borderRadius: 10, padding: '8px 10px' }}>
          <div style={{ color: '#64748b', fontSize: 10, fontWeight: 900 }}>Morning warmup</div>
          <div style={{ color: claimReady ? '#6ee7b7' : '#fde68a', fontWeight: 1000, marginTop: 4 }}>
            {warmupProgress}/{warmupGoal} correct answers
          </div>
        </div>
      </div>

      <div style={{ height: 10, borderRadius: 999, overflow: 'hidden', background: 'rgba(51,65,85,0.75)', border: '1px solid #334155' }}>
        <div style={{
          width: `${Math.max(0, Math.min(100, (warmupProgress / warmupGoal) * 100))}%`,
          height: '100%',
          background: claimReady ? 'linear-gradient(90deg, #10b981, #34d399)' : 'linear-gradient(90deg, #f59e0b, #facc15)',
          transition: 'width 0.2s ease',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ color: message ? '#e2e8f0' : '#94a3b8', fontSize: 12, fontWeight: 800 }}>
          {message ?? (claimReady ? 'Vault unlocked. Claim your offline coins now.' : 'Study progress updates this warmup automatically when you answer correctly.')}
        </div>
        <button
          onClick={onClaim}
          disabled={busy || !claimReady || accruedCoins <= 0}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: claimReady ? '1px solid rgba(250,204,21,0.45)' : '1px solid #334155',
            background: claimReady ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(30,41,59,0.8)',
            color: claimReady ? 'white' : '#64748b',
            fontSize: 12,
            fontWeight: 1000,
            cursor: busy || !claimReady || accruedCoins <= 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Claiming…' : claimReady ? 'Claim Idle Vault' : 'Study to Unlock'}
        </button>
      </div>
    </div>
  );
}

function DiscoveryWorkshopSection({ uid, currentBoard, onRefresh }: {
  uid: string;
  currentBoard: number;
  onRefresh: () => Promise<void>;
}) {
  type WorkshopVm = Awaited<ReturnType<typeof buildDiscoveryWorkshopView>>;
  const [workshop, setWorkshop] = useState<WorkshopVm | null>(null);
  const [loadingWorkshop, setLoadingWorkshop] = useState(true);
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [combining, setCombining] = useState(false);
  const [workshopMsg, setWorkshopMsg] = useState<string | null>(null);

  const loadWorkshop = useCallback(async () => {
    setLoadingWorkshop(true);
    try {
      const next = await buildDiscoveryWorkshopView(uid, currentBoard);
      setWorkshop(next);
      setLeft((prev) => prev || next.elements[0]?.id || '');
      setRight((prev) => prev || next.elements[1]?.id || next.elements[0]?.id || '');
    } catch (e) {
      setWorkshopMsg(e instanceof Error ? e.message : 'Failed to load Discovery Workshop.');
    } finally {
      setLoadingWorkshop(false);
    }
  }, [uid, currentBoard]);

  useEffect(() => { void loadWorkshop(); }, [loadWorkshop]);

  async function handleCombine() {
    setCombining(true);
    setWorkshopMsg(null);
    try {
      const res = await combineDiscovery(uid, currentBoard, left, right);
      if (res.ok) {
        setWorkshopMsg(
          res.alreadyDiscovered
            ? `🧠 Already discovered: ${res.cardEmoji} ${res.cardName}`
            : `✨ New discovery: ${res.cardEmoji} ${res.cardName} (Board ${res.boardId})`
        );
        await Promise.all([loadWorkshop(), onRefresh()]);
      } else {
        setWorkshopMsg(`❌ ${res.reason}`);
      }
    } catch (e) {
      setWorkshopMsg(e instanceof Error ? e.message : 'Discovery failed.');
    } finally {
      setCombining(false);
    }
  }

  const elements = workshop?.elements ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        padding: 14,
        borderRadius: 14,
        background: 'linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.98))',
        border: '1px solid rgba(34,211,238,0.20)',
      }}>
        <div style={{ color: 'white', fontWeight: 1000, fontSize: 15 }}>🧪 Discovery Workshop</div>
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
          Combine cultural elements to discover real Chrono cards. First-time discoveries grant a card copy to your inventory.
        </div>
      </div>

      {workshopMsg && (
        <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.30)', color: '#67e8f9', fontSize: 12, fontWeight: 900 }}>
          {workshopMsg}
        </div>
      )}

      {loadingWorkshop ? (
        <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading workshop…</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 12, background: 'rgba(30,41,59,0.8)', border: '1px solid #334155' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 1000, fontSize: 12, marginBottom: 8 }}>Element A</div>
              <select value={left} onChange={(e) => setLeft(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: '#0f172a', color: 'white', border: '1px solid #334155' }}>
                {elements.map((element) => (
                  <option key={element.id} value={element.id}>{element.emoji} {element.label}</option>
                ))}
              </select>
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: 'rgba(30,41,59,0.8)', border: '1px solid #334155' }}>
              <div style={{ color: '#e2e8f0', fontWeight: 1000, fontSize: 12, marginBottom: 8 }}>Element B</div>
              <select value={right} onChange={(e) => setRight(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: '#0f172a', color: 'white', border: '1px solid #334155' }}>
                {elements.map((element) => (
                  <option key={element.id} value={element.id}>{element.emoji} {element.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={() => void handleCombine()}
            disabled={combining || !left || !right}
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid rgba(34,211,238,0.35)',
              background: 'linear-gradient(135deg, #0891b2, #7c3aed)',
              color: 'white',
              fontSize: 13,
              fontWeight: 1000,
              cursor: combining || !left || !right ? 'not-allowed' : 'pointer',
              opacity: combining || !left || !right ? 0.7 : 1,
            }}
          >
            {combining ? 'Combining…' : '⚗️ Combine Elements'}
          </button>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div style={{ padding: 12, borderRadius: 12, background: 'rgba(15,23,42,0.75)', border: '1px solid #334155' }}>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 900 }}>Unlocked elements</div>
              <div style={{ color: 'white', fontWeight: 1000, marginTop: 4 }}>{elements.length}</div>
            </div>
            <div style={{ padding: 12, borderRadius: 12, background: 'rgba(15,23,42,0.75)', border: '1px solid #334155' }}>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 900 }}>Recipes discovered</div>
              <div style={{ color: 'white', fontWeight: 1000, marginTop: 4 }}>{workshop?.totalRecipesUnlocked ?? 0} / {workshop?.totalRecipesAvailable ?? 0}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>📓 Discovery Journal</div>
            {workshop && workshop.discovered.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                {workshop.discovered.map((entry) => (
                  <div key={entry.recipeId} style={{
                    padding: 12,
                    borderRadius: 12,
                    background: 'rgba(30,41,59,0.80)',
                    border: '1px solid rgba(16,185,129,0.25)',
                  }}>
                    <div style={{ fontSize: 24 }}>{entry.cardEmoji}</div>
                    <div style={{ color: 'white', fontWeight: 1000, fontSize: 12, marginTop: 6 }}>{entry.cardName}</div>
                    <div style={{ color: '#64748b', fontSize: 10, marginTop: 3 }}>Board {entry.boardId}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: '#64748b', fontSize: 12, padding: 16, textAlign: 'center', borderRadius: 12, background: 'rgba(15,23,42,0.55)', border: '1px solid #334155' }}>
                No discoveries yet. Start experimenting with combinations.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RewardChestCard({
  status,
  busy,
  message,
  onClaim,
}: {
  status: ChronoRewardChestStatus | null;
  busy: boolean;
  message: string | null;
  onClaim: () => void;
}) {
  const ready = !!status?.ready;
  const preview = status?.rewardPreview ?? { coins: 0, gems: 0, energy: 0 };
  const lastReward = status?.lastReward;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.98))',
      border: '1px solid rgba(251,191,36,0.22)',
      borderRadius: 14,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 15 }}>🎁 Daily Reward Chest</div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
            Open one chest per day after making study progress. Rewards scale with your current board.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: ready ? '#fde68a' : '#94a3b8', fontWeight: 1000, fontSize: 16 }}>{ready ? 'Ready now' : `${status?.hoursRemaining ?? 0}h left`}</div>
          <div style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>Next: {preview.coins.toLocaleString()} coins · 💎 {preview.gems} · ⚡ {preview.energy}</div>
        </div>
      </div>

      {lastReward && (
        <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.65)', border: '1px solid #334155', color: '#cbd5e1', fontSize: 11, fontWeight: 800 }}>
          Last chest: {lastReward.coins.toLocaleString()} coins · 💎 {lastReward.gems} · ⚡ {lastReward.energy}{lastReward.cardName ? ` · ${lastReward.cardEmoji ?? '🎴'} ${lastReward.cardName}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ color: message ? '#e2e8f0' : '#94a3b8', fontSize: 12, fontWeight: 800 }}>
          {message ?? (ready ? 'Your chest is ready to open.' : 'Complete at least 5 study-question task progress and wait for the daily reset.')}
        </div>
        <button
          onClick={onClaim}
          disabled={busy || !ready}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: ready ? '1px solid rgba(251,191,36,0.40)' : '1px solid #334155',
            background: ready ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(30,41,59,0.8)',
            color: ready ? 'white' : '#64748b',
            fontSize: 12,
            fontWeight: 1000,
            cursor: busy || !ready ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Opening…' : ready ? 'Open Chest' : 'Chest Locked'}
        </button>
      </div>
    </div>
  );
}

function PrestigeCard({
  prestige,
  currentBoard,
  busy,
  message,
  onPrestige,
}: {
  prestige: ChronoPrestigeViewModel | null;
  currentBoard: number;
  busy: boolean;
  message: string | null;
  onPrestige: () => void;
}) {
  const eligible = !!prestige?.eligibility.eligible;
  const blockers = prestige?.eligibility.reasons ?? [];

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(49,46,129,0.92), rgba(15,23,42,0.98))',
      border: '1px solid rgba(167,139,250,0.30)',
      borderRadius: 14,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 15 }}>🌌 Season Prestige</div>
          <div style={{ color: '#c4b5fd', fontSize: 12, marginTop: 4 }}>
            Reset your current run to Board 100, start a new season, and bank permanent Chrono Sigils.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: '#ede9fe', fontWeight: 1000, fontSize: 16 }}>Season {prestige?.currentSeason ?? 1}</div>
          <div style={{ color: '#c4b5fd', fontSize: 10, fontWeight: 800 }}>Sigils: {prestige?.sigils ?? 0} · Prestiges: {prestige?.prestigeCount ?? 0}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(99,102,241,0.30)' }}>
          <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 800 }}>Current Board</div>
          <div style={{ color: 'white', fontSize: 14, fontWeight: 1000, marginTop: 2 }}>{currentBoard}</div>
        </div>
        <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(15,23,42,0.55)', border: '1px solid rgba(99,102,241,0.30)' }}>
          <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 800 }}>Next Reward</div>
          <div style={{ color: '#fde68a', fontSize: 14, fontWeight: 1000, marginTop: 2 }}>{prestige?.nextPrestigeRewardSigils ?? 1} Sigil{(prestige?.nextPrestigeRewardSigils ?? 1) === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div style={{ color: message ? '#e9d5ff' : eligible ? '#86efac' : '#cbd5e1', fontSize: 12, fontWeight: 800 }}>
        {message ?? (eligible ? 'You can prestige now.' : blockers[0] ?? 'Keep progressing to unlock prestige.')}
      </div>

      {!eligible && blockers.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {blockers.slice(0, 3).map((reason) => (
            <div key={reason} style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700 }}>
              {reason}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={onPrestige}
          disabled={busy || !eligible}
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            border: eligible ? '1px solid rgba(167,139,250,0.45)' : '1px solid #334155',
            background: eligible ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)' : 'rgba(30,41,59,0.8)',
            color: eligible ? 'white' : '#64748b',
            fontSize: 12,
            fontWeight: 1000,
            cursor: busy || !eligible ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Prestiging…' : eligible ? 'Prestige Run' : 'Locked'}
        </button>
      </div>
    </div>
  );
}

function RoadSection({
  currentBoard, currentClass, gemClass, gems, roadRef, onOpenBoard,
}: {
  currentBoard: number;
  currentClass: number;
  gemClass: number;
  gems: number;
  roadRef: React.RefObject<HTMLDivElement | null>;
  onOpenBoard: (b: number) => void;
}) {
  const tier = tierInfo(currentClass);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(30,41,59,0.90), rgba(15,23,42,0.95))',
        border: '1px solid #334155', borderRadius: 14, padding: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ color: 'white', fontWeight: 1000, fontSize: 15 }}>🛣️ The Road</div>
            <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 12 }}>
              Board <span style={{ color: 'white', fontWeight: 1000 }}>{currentBoard}</span> · Class <span style={{ color: 'white', fontWeight: 1000 }}>{currentClass}</span> · {tier.emoji} {tier.label}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#c4b5fd', fontWeight: 1000, fontSize: 18 }}>💎 {gems}</div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>Gem Class: {gemClass}</div>
          </div>
        </div>
        <button
          onClick={() => onOpenBoard(currentBoard)}
          style={{
            marginTop: 12, width: '100%', padding: '10px 0', borderRadius: 10,
            background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', border: 'none',
            color: 'white', fontSize: 14, fontWeight: 1000, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(124,58,237,0.35)', transition: 'all 0.2s',
          }}
        >
          🎮 Open Current Board
        </button>
      </div>

      <div
        ref={roadRef}
        style={{
          display: 'flex', gap: 0, height: 'min(520px, 62vh)', overflow: 'hidden', borderRadius: 12,
          border: '1px solid #334155', background: 'rgba(15,23,42,0.55)',
        }}
      >
        <div style={{ width: 36, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, #EF4444 0%, #3B82F6 33%, #064E3B 66%, #111827 100%)',
          }} />
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '55%', bottom: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 40%, rgba(255,255,255,0.05) 60%, transparent 100%)',
          }} />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BOARDS.map((boardId, idx) => {
            const cls = idx + 1;
            const active = boardId === currentBoard;
            const unlocked = cls <= gemClass + 1;
            return (
              <button
                key={boardId}
                onClick={() => onOpenBoard(boardId)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  width: '100%', padding: '10px 12px', borderRadius: 12,
                  background: active ? 'rgba(139,92,246,0.16)' : 'rgba(30,41,59,0.75)',
                  border: active ? '1px solid rgba(139,92,246,0.50)' : `1px solid ${unlocked ? '#334155' : 'rgba(51,65,85,0.45)'}`,
                  color: unlocked ? 'white' : '#64748b',
                  cursor: 'pointer', textAlign: 'left',
                  opacity: unlocked ? 1 : 0.6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: spectrumColor(idx / Math.max(1, BOARDS.length - 1)),
                    boxShadow: active ? '0 0 0 6px rgba(139,92,246,0.15)' : 'none',
                    animation: active ? 'ce-road-pulse 1.8s infinite' : 'none',
                  }} />
                  <div>
                    <div style={{ fontWeight: 1000, fontSize: 12 }}>Board {boardId}</div>
                    <div style={{ color: active ? '#c4b5fd' : '#94a3b8', fontSize: 10 }}>Class {cls}</div>
                  </div>
                </div>
                <div style={{
                  padding: '4px 8px', borderRadius: 999,
                  background: active ? 'rgba(139,92,246,0.18)' : unlocked ? 'rgba(16,185,129,0.10)' : 'rgba(51,65,85,0.45)',
                  border: active ? '1px solid rgba(139,92,246,0.35)' : unlocked ? '1px solid rgba(16,185,129,0.25)' : '1px solid #334155',
                  color: active ? '#ddd6fe' : unlocked ? '#86efac' : '#64748b',
                  fontSize: 10, fontWeight: 1000,
                }}>
                  {active ? 'Current' : unlocked ? 'Open' : 'Locked'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   🎡 Wheel Section
   ══════════════════════════════════════════════════════════ */
const SEGMENT_COLORS = [
  '#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626',
  '#0891b2', '#7c3aed', '#2563eb', '#dc2626', '#059669',
];

function WheelSection({ uid, energy, inventory, onRefresh, onReload }: {
  uid: string;
  energy: number;
  inventory: ChronoInventoryDoc | null;
  onRefresh: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ segment: (typeof WHEEL_SEGMENTS)[number]; emoji: string; label: string } | null>(null);
  const [angle, setAngle] = useState(0);
  const [spinError, setSpinError] = useState<string | null>(null);

  async function handleSpin() {
    if (spinning) return;
    setSpinError(null);
    if (energy < 1) {
      setSpinError('⚡ Not enough energy! Solve 3 questions in a row to earn energy.');
      return;
    }
    setResult(null);
    setSpinning(true);
    // Deduct 1 energy
    try {
      const { getUserData, updateUserData } = await import('@/lib/userService');
      const ud = await getUserData(uid);
      if (ud) await updateUserData(uid, { economy: { ...ud.economy, energy: Math.max(0, energy - 1) } } as any);
    } catch { /* best-effort */ }

    const seg = spinWheel();
    const segIdx = WHEEL_SEGMENTS.findIndex((s) => s.id === seg.id);
    const segAngle = (segIdx / WHEEL_SEGMENTS.length) * 360;
    const spins = 5 * 360; // 5 full rotations
    const targetAngle = spins + (360 - segAngle);
    setAngle(targetAngle);

    // Apply reward after animation
    setTimeout(async () => {
      try {
        const COIN_AMOUNTS: Record<string, number> = {
          w_1k: 1000, w_5k: 5000, w_10k: 10000, w_25k: 25000, w_50k: 50000, w_100k: 100000,
        };
        if (COIN_AMOUNTS[seg.id] !== undefined) {
          const { getUserDoc, updateUserDoc, setUserDoc } = await import('@/lib/supabaseDocStore');
          const econRaw = await getUserDoc(uid, 'chrono_economy', 'global');
          const curGold = econRaw && typeof (econRaw as any).gold === 'number' ? (econRaw as any).gold as number : 0;
          const next = curGold + COIN_AMOUNTS[seg.id];
          if (econRaw) await updateUserDoc(uid, 'chrono_economy', 'global', { gold: next });
          else await setUserDoc(uid, 'chrono_economy', 'global', { gold: next });
        } else if (seg.id === 'w_cat') {
          const randomCard = ALL_CATEGORY_CARDS[Math.floor(Math.random() * ALL_CATEGORY_CARDS.length)];
          await addCardCopies(uid, randomCard.id, 1);
        } else if (seg.id === 'w_trans') {
          const randomTrans = ALL_TRANSPORT_CARDS[Math.floor(Math.random() * ALL_TRANSPORT_CARDS.length)];
          await addTransportCard(uid, randomTrans.id, 1);
        } else if (seg.id === 'w_defend') {
          await addCombatCard(uid, 'defend', 1);
        } else if (seg.id === 'w_attack') {
          await addCombatCard(uid, 'attack', 1);
        }
        try {
          const { incrementTaskProgress } = await import('@/lib/chronoTasksService');
          await incrementTaskProgress(uid, 'wheel_spin', 1);
        } catch { /* best-effort */ }
        await onRefresh();
        await onReload();
      } catch { /* ignore */ }

      setResult({ segment: seg, emoji: seg.emoji, label: seg.label });
      setSpinning(false);
    }, 3500);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 12 }}>

      {/* Wheel visual */}
      <div style={{ position: 'relative', width: 260, height: 260 }}>
        {/* Pointer */}
        <div style={{
          position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0, borderLeft: '10px solid transparent', borderRight: '10px solid transparent',
          borderTop: '18px solid #f59e0b', zIndex: 10, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.30))',
        }} />

        {/* Spinning disc */}
        <div style={{
          width: 260, height: 260, borderRadius: '50%',
          background: `conic-gradient(${WHEEL_SEGMENTS.map((s, i) => {
            const start = (i / WHEEL_SEGMENTS.length) * 100;
            const end = ((i + 1) / WHEEL_SEGMENTS.length) * 100;
            return `${SEGMENT_COLORS[i % SEGMENT_COLORS.length]} ${start}% ${end}%`;
          }).join(', ')})`,
          border: '4px solid #1e293b', boxShadow: '0 0 30px rgba(0,0,0,0.40), inset 0 0 20px rgba(0,0,0,0.15)',
          transition: spinning ? 'transform 3.5s cubic-bezier(0.17, 0.67, 0.12, 0.99)' : 'none',
          transform: `rotate(${angle}deg)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Segment labels */}
          {WHEEL_SEGMENTS.map((s, i) => {
            const rot = (i / WHEEL_SEGMENTS.length) * 360 + (180 / WHEEL_SEGMENTS.length);
            return (
              <div key={s.id} style={{
                position: 'absolute', left: '50%', top: '50%',
                transform: `rotate(${rot}deg) translateY(-90px)`,
                transformOrigin: '0 0', fontSize: 16, userSelect: 'none',
              }}>
                {s.emoji}
              </div>
            );
          })}
          {/* Center circle */}
          <div style={{
            width: 50, height: 50, borderRadius: '50%', background: '#0f172a',
            border: '3px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, zIndex: 2,
          }}>
            🎡
          </div>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div style={{
          padding: '12px 20px', borderRadius: 12,
          background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.40)',
          color: '#86efac', fontWeight: 1000, fontSize: 14, textAlign: 'center',
          animation: 'ce-wheel-result 0.4s ease-out',
        }}>
          {result.emoji} {result.label}!
        </div>
      )}

      {/* Energy counter */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 16px', borderRadius: 20,
        background: energy > 0 ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
        border: `1px solid ${energy > 0 ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'}`,
      }}>
        <span style={{ fontSize: 16 }}>⚡</span>
        <span style={{ color: energy > 0 ? '#6ee7b7' : '#fca5a5', fontWeight: 1000, fontSize: 14 }}>
          {energy} Energy
        </span>
      </div>

      {/* Error */}
      {spinError && (
        <div style={{
          padding: '8px 16px', borderRadius: 8,
          background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)',
          color: '#fca5a5', fontSize: 12, fontWeight: 900, textAlign: 'center',
        }}>
          {spinError}
        </div>
      )}

      {/* Spin button */}
      <button
        disabled={spinning || energy < 1}
        onClick={() => void handleSpin()}
        style={{
          background: spinning ? 'linear-gradient(135deg,#78716c,#57534e)'
            : energy < 1 ? 'linear-gradient(135deg,#78716c,#57534e)'
            : 'linear-gradient(135deg,#7c3aed,#6d28d9)',
          border: 'none', borderRadius: 12, color: 'white', padding: '12px 32px',
          fontSize: 15, fontWeight: 1000, cursor: spinning || energy < 1 ? 'not-allowed' : 'pointer',
          boxShadow: spinning || energy < 1 ? 'none' : '0 4px 16px rgba(124,58,237,0.35)',
          opacity: spinning || energy < 1 ? 0.6 : 1, transition: 'all 0.2s',
        }}
      >
        {spinning ? '⏳ Spinning…' : '🎡 Spin (1 ⚡)'}
      </button>

      <div style={{ color: '#64748b', fontSize: 11, textAlign: 'center', maxWidth: 280 }}>
        Each spin costs 1 energy. Win coins, cards, transport cards, or combat cards!
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   🎒 Inventory Section
   ══════════════════════════════════════════════════════════ */
const CAT_LABELS: Record<CardCategory, { emoji: string; label: string; color: string }> = {
  geography: { emoji: '🗺️', label: 'Geography', color: '#3b82f6' },
  food: { emoji: '🥙', label: 'Food', color: '#f97316' },
  entertainment: { emoji: '🎭', label: 'Entertainment', color: '#8b5cf6' },
  history: { emoji: '🏛️', label: 'History', color: '#d97706' },
};

type InvTab = 'collection' | 'sets' | 'deck' | 'transport' | 'tokens';

function InventorySection({ uid, currentBoard, inventory, onRefresh }: {
  uid: string;
  currentBoard: number;
  inventory: ChronoInventoryDoc | null;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<InvTab>('collection');
  const [filterCat, setFilterCat] = useState<CardCategory | 'all'>('all');
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);
  type CollectionSetVm = Awaited<ReturnType<typeof buildCollectionSetViewModels>>[number];
  const [sets, setSets] = useState<CollectionSetVm[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [claimingSet, setClaimingSet] = useState<string | null>(null);

  if (!inventory) return <div style={{ color: '#94a3b8', padding: 20 }}>Loading inventory…</div>;

  const loadSets = useCallback(async () => {
    setSetsLoading(true);
    try {
      const next = await buildCollectionSetViewModels(uid, currentBoard);
      setSets(next);
    } catch (e) {
      setUpgradeMsg(e instanceof Error ? e.message : 'Failed to load collection sets.');
    } finally {
      setSetsLoading(false);
    }
  }, [uid, currentBoard]);

  useEffect(() => { void loadSets(); }, [loadSets, inventory.updatedAt]);

  const tabs: Array<{ id: InvTab; icon: string; label: string }> = [
    { id: 'collection', icon: '🎴', label: 'Cards' },
    { id: 'sets', icon: '🧩', label: 'Sets' },
    { id: 'deck', icon: '🃏', label: 'Deck' },
    { id: 'transport', icon: '🚐', label: 'Transport' },
    { id: 'tokens', icon: '🎯', label: 'Tokens' },
  ];

  const cards = filterCat === 'all'
    ? ALL_CATEGORY_CARDS.filter((c) => c.boardId <= currentBoard)
    : ALL_CATEGORY_CARDS.filter((c) => c.boardId <= currentBoard && c.category === filterCat);

  async function handleUpgrade(cardId: string) {
    setUpgrading(cardId);
    setUpgradeMsg(null);
    const res = await upgradeCard(uid, cardId);
    if (res.ok) {
      setUpgradeMsg('✅ Upgraded!');
      await onRefresh();
    } else {
      setUpgradeMsg('❌ ' + res.reason);
    }
    setUpgrading(null);
    setTimeout(() => setUpgradeMsg(null), 2500);
  }

  async function handleDeckToggle(cardId: string) {
    try {
      if (inventory!.deck.includes(cardId)) {
        await removeFromDeck(uid, cardId);
      } else {
        await addToDeck(uid, cardId);
      }
      await onRefresh();
    } catch (e) {
      setUpgradeMsg(e instanceof Error ? e.message : 'Error');
      setTimeout(() => setUpgradeMsg(null), 2000);
    }
  }

  async function handleClaimSet(setId: string) {
    setClaimingSet(setId);
    setUpgradeMsg(null);
    try {
      const res = await claimCollectionSetReward(uid, setId);
      if (res.ok) {
        const rewardParts = [
          (res.reward.coins ?? 0) > 0 ? `${(res.reward.coins ?? 0).toLocaleString()} coins` : null,
          (res.reward.gems ?? 0) > 0 ? `${res.reward.gems} gems` : null,
          (res.reward.energy ?? 0) > 0 ? `${res.reward.energy} energy` : null,
        ].filter(Boolean).join(' + ');
        setUpgradeMsg(`✅ Set reward claimed: ${rewardParts}`);
        await loadSets();
      } else {
        setUpgradeMsg(`❌ ${res.reason}`);
      }
    } catch (e) {
      setUpgradeMsg(e instanceof Error ? e.message : 'Failed to claim set reward.');
    }
    setClaimingSet(null);
    setTimeout(() => setUpgradeMsg(null), 2500);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '5px 10px', fontSize: 11, borderRadius: 8, cursor: 'pointer',
            background: tab === t.id ? 'rgba(139,92,246,0.18)' : 'rgba(15,23,42,0.55)',
            border: tab === t.id ? '1px solid rgba(139,92,246,0.50)' : '1px solid #334155',
            color: tab === t.id ? '#ddd6fe' : '#94a3b8', fontWeight: 1000,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {upgradeMsg && (
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.30)', color: '#67e8f9', fontSize: 12, fontWeight: 900 }}>
          {upgradeMsg}
        </div>
      )}

      {tab === 'collection' && (
        <>
          {/* Category filter */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => setFilterCat('all')} style={{
              padding: '4px 10px', fontSize: 10, borderRadius: 6, cursor: 'pointer',
              background: filterCat === 'all' ? 'rgba(255,255,255,0.10)' : 'transparent',
              border: '1px solid #334155', color: '#94a3b8', fontWeight: 900,
            }}>All</button>
            {(Object.keys(CAT_LABELS) as CardCategory[]).map((c) => (
              <button key={c} onClick={() => setFilterCat(c)} style={{
                padding: '4px 10px', fontSize: 10, borderRadius: 6, cursor: 'pointer',
                background: filterCat === c ? `${CAT_LABELS[c].color}22` : 'transparent',
                border: `1px solid ${filterCat === c ? CAT_LABELS[c].color : '#334155'}`,
                color: filterCat === c ? CAT_LABELS[c].color : '#94a3b8', fontWeight: 900,
              }}>
                {CAT_LABELS[c].emoji} {CAT_LABELS[c].label}
              </button>
            ))}
          </div>

          {/* Card grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {cards.map((card) => {
              const owned = inventory.cards[card.id] as OwnedCard | undefined;
              const isOwned = owned && owned.level > 0;
              const lvl = owned?.level ?? 0;
              const copies = owned?.copies ?? 0;
              const lvlDef = CARD_UPGRADE_LEVELS.find((l) => l.level === lvl);
              const nextLvl = CARD_UPGRADE_LEVELS.find((l) => l.level === lvl + 1);
              const inDeck = inventory.deck.includes(card.id);

              return (
                <div key={card.id} style={{
                  borderRadius: 10, padding: 10,
                  background: isOwned ? 'rgba(30,41,59,0.80)' : 'rgba(15,23,42,0.55)',
                  border: `2px solid ${isOwned && lvlDef ? lvlDef.borderColor : '#1e293b'}`,
                  opacity: isOwned ? 1 : 0.45,
                  transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 22, textAlign: 'center' }}>{card.emoji}</div>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 11, textAlign: 'center', marginTop: 4, lineHeight: 1.2 }}>
                    {card.name}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 9, textAlign: 'center', marginTop: 2 }}>
                    Board {card.boardId} · {CAT_LABELS[card.category].emoji}
                  </div>

                  {isOwned && (
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                        <span style={{ color: lvlDef?.borderColor ?? '#94a3b8', fontWeight: 1000 }}>
                          Lv.{lvl}
                        </span>
                        <span style={{ color: '#94a3b8', fontWeight: 800 }}>
                          x{copies}
                        </span>
                      </div>

                      {/* Upgrade progress bar */}
                      {nextLvl && (
                        <div style={{ width: '100%', height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, (copies / nextLvl.copiesNeeded) * 100)}%`,
                            height: '100%', background: nextLvl.borderColor, transition: '0.3s',
                          }} />
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 4 }}>
                        {nextLvl && copies >= nextLvl.copiesNeeded && (
                          <button
                            disabled={upgrading === card.id}
                            onClick={() => void handleUpgrade(card.id)}
                            style={{
                              flex: 1, padding: '3px 0', borderRadius: 6, fontSize: 9, fontWeight: 1000,
                              background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.40)',
                              color: '#6ee7b7', cursor: 'pointer',
                            }}
                          >
                            ⬆ Upgrade
                          </button>
                        )}
                        <button
                          onClick={() => void handleDeckToggle(card.id)}
                          style={{
                            flex: 1, padding: '3px 0', borderRadius: 6, fontSize: 9, fontWeight: 1000,
                            background: inDeck ? 'rgba(248,113,113,0.12)' : 'rgba(139,92,246,0.12)',
                            border: `1px solid ${inDeck ? 'rgba(248,113,113,0.35)' : 'rgba(139,92,246,0.35)'}`,
                            color: inDeck ? '#fca5a5' : '#c4b5fd', cursor: 'pointer',
                          }}
                        >
                          {inDeck ? '− Deck' : '+ Deck'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'sets' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{
            padding: 12,
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(30,41,59,0.88), rgba(15,23,42,0.95))',
            border: '1px solid #334155',
          }}>
            <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>🧩 Collection Sets</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
              Complete all 3 cards from a board-category album to claim a set reward.
            </div>
          </div>

          {setsLoading ? (
            <div style={{ color: '#94a3b8', fontSize: 12, padding: 16 }}>Loading sets…</div>
          ) : sets.length === 0 ? (
            <div style={{ color: '#475569', fontSize: 12, padding: 16, textAlign: 'center' }}>No sets unlocked yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {sets.map((set) => (
                <div key={set.def.id} style={{
                  padding: 12,
                  borderRadius: 12,
                  background: set.completed ? 'rgba(30,41,59,0.88)' : 'rgba(15,23,42,0.6)',
                  border: `1px solid ${set.claimed ? 'rgba(16,185,129,0.35)' : set.completed ? 'rgba(250,204,21,0.35)' : '#334155'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div>
                      <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{set.def.emoji} {set.def.label}</div>
                      <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>Board {set.def.boardId} · {set.ownedCount}/{set.totalCount} cards</div>
                    </div>
                    <div style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      background: set.claimed ? 'rgba(16,185,129,0.12)' : set.completed ? 'rgba(250,204,21,0.12)' : 'rgba(51,65,85,0.55)',
                      border: `1px solid ${set.claimed ? 'rgba(16,185,129,0.35)' : set.completed ? 'rgba(250,204,21,0.35)' : '#334155'}`,
                      color: set.claimed ? '#6ee7b7' : set.completed ? '#fde68a' : '#94a3b8',
                      fontSize: 10,
                      fontWeight: 1000,
                    }}>
                      {set.claimed ? 'Claimed' : set.completed ? 'Complete' : 'In Progress'}
                    </div>
                  </div>

                  <div style={{ marginTop: 10, height: 8, borderRadius: 999, overflow: 'hidden', background: 'rgba(51,65,85,0.75)', border: '1px solid #334155' }}>
                    <div style={{
                      width: `${Math.max(0, Math.min(100, (set.ownedCount / set.totalCount) * 100))}%`,
                      height: '100%',
                      background: set.completed ? 'linear-gradient(90deg, #f59e0b, #facc15)' : 'linear-gradient(90deg, #8b5cf6, #3b82f6)',
                    }} />
                  </div>

                  <div style={{ marginTop: 10, color: '#cbd5e1', fontSize: 11, fontWeight: 800 }}>
                    Reward: {set.def.reward.coins ? `${set.def.reward.coins.toLocaleString()} coins` : ''}{set.def.reward.coins && set.def.reward.gems ? ' + ' : ''}{set.def.reward.gems ? `${set.def.reward.gems} gems` : ''}
                  </div>

                  <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {set.def.cardIds.map((cardId) => {
                      const card = ALL_CATEGORY_CARDS.find((c) => c.id === cardId);
                      const owned = inventory.cards[cardId];
                      return (
                        <div key={cardId} style={{
                          flex: '1 1 30%',
                          minWidth: 58,
                          padding: '6px 4px',
                          borderRadius: 8,
                          textAlign: 'center',
                          background: owned && owned.level > 0 ? 'rgba(16,185,129,0.10)' : 'rgba(30,41,59,0.65)',
                          border: `1px solid ${owned && owned.level > 0 ? 'rgba(16,185,129,0.30)' : '#334155'}`,
                          color: owned && owned.level > 0 ? '#d1fae5' : '#64748b',
                        }}>
                          <div style={{ fontSize: 18 }}>{card?.emoji ?? '🎴'}</div>
                          <div style={{ fontSize: 9, fontWeight: 900, lineHeight: 1.2 }}>{card?.name ?? cardId}</div>
                        </div>
                      );
                    })}
                  </div>

                  {!set.claimed && (
                    <button
                      disabled={!set.completed || claimingSet === set.def.id}
                      onClick={() => void handleClaimSet(set.def.id)}
                      style={{
                        marginTop: 10,
                        width: '100%',
                        padding: '8px 0',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 1000,
                        cursor: !set.completed || claimingSet === set.def.id ? 'not-allowed' : 'pointer',
                        background: set.completed ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(30,41,59,0.7)',
                        border: set.completed ? '1px solid rgba(250,204,21,0.35)' : '1px solid #334155',
                        color: set.completed ? 'white' : '#64748b',
                      }}
                    >
                      {claimingSet === set.def.id ? 'Claiming…' : set.completed ? 'Claim Set Reward' : 'Collect Missing Cards'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'deck' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 900 }}>
            🃏 Active Deck ({inventory.deck.length}/12)
          </div>
          {inventory.deck.length === 0 ? (
            <div style={{ color: '#475569', fontSize: 12, padding: 16, textAlign: 'center' }}>
              No cards in deck. Go to Cards tab to add some.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {inventory.deck.map((cardId) => {
                const card = ALL_CATEGORY_CARDS.find((c) => c.id === cardId);
                const owned = inventory.cards[cardId] as OwnedCard | undefined;
                if (!card) return null;
                const lvlDef = CARD_UPGRADE_LEVELS.find((l) => l.level === (owned?.level ?? 1));
                return (
                  <div key={cardId} style={{
                    borderRadius: 10, padding: 10,
                    background: 'rgba(30,41,59,0.80)',
                    border: `2px solid ${lvlDef?.borderColor ?? '#334155'}`,
                  }}>
                    <div style={{ fontSize: 22, textAlign: 'center' }}>{card.emoji}</div>
                    <div style={{ color: 'white', fontWeight: 1000, fontSize: 11, textAlign: 'center', marginTop: 4 }}>{card.name}</div>
                    <div style={{ color: '#64748b', fontSize: 9, textAlign: 'center', marginTop: 2 }}>
                      Lv.{owned?.level ?? 1} · x{owned?.copies ?? 0}
                    </div>
                    <button
                      onClick={() => void handleDeckToggle(cardId)}
                      style={{
                        marginTop: 6, width: '100%', padding: '3px 0', borderRadius: 6, fontSize: 9, fontWeight: 1000,
                        background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)',
                        color: '#fca5a5', cursor: 'pointer',
                      }}
                    >
                      − Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Combat cards */}
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <div style={{
              flex: 1, padding: 12, borderRadius: 10,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 24 }}>⚔️</div>
              <div style={{ color: '#fca5a5', fontWeight: 1000, fontSize: 12 }}>Attack</div>
              <div style={{ color: '#f87171', fontWeight: 1000, fontSize: 18 }}>{inventory.attackCards}/3</div>
            </div>
            <div style={{
              flex: 1, padding: 12, borderRadius: 10,
              background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 24 }}>🛡️</div>
              <div style={{ color: '#93c5fd', fontWeight: 1000, fontSize: 12 }}>Defend</div>
              <div style={{ color: '#60a5fa', fontWeight: 1000, fontSize: 18 }}>{inventory.defendCards}/3</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'transport' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {ALL_TRANSPORT_CARDS.map((tc) => {
            const count = inventory.transportCards[tc.id] ?? 0;
            const unlocked = currentBoard >= tc.unlockBoard;
            return (
              <div key={tc.id} style={{
                borderRadius: 10, padding: 12, textAlign: 'center',
                background: unlocked ? 'rgba(30,41,59,0.80)' : 'rgba(15,23,42,0.55)',
                border: `1px solid ${count > 0 ? 'rgba(16,185,129,0.30)' : '#334155'}`,
                opacity: unlocked ? 1 : 0.4,
              }}>
                <div style={{ fontSize: 28 }}>{tc.emoji}</div>
                <div style={{ color: 'white', fontWeight: 1000, fontSize: 11, marginTop: 4 }}>{tc.name}</div>
                <div style={{ color: '#64748b', fontSize: 9, marginTop: 2 }}>
                  {tc.tier === 'low' ? '🌿 Low' : tc.tier === 'mid' ? '📻 Mid' : '💎 High'} · {!unlocked ? `🔒 Board ${tc.unlockBoard}+` : `x${count}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'tokens' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 900 }}>
            🎯 Active Token: <span style={{ color: '#c4b5fd' }}>{inventory.activeToken}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {inventory.ownedTokens.map((tk) => (
              <div key={tk} style={{
                padding: '10px 16px', borderRadius: 10,
                background: tk === inventory.activeToken ? 'rgba(139,92,246,0.18)' : 'rgba(30,41,59,0.60)',
                border: tk === inventory.activeToken ? '2px solid rgba(139,92,246,0.50)' : '1px solid #334155',
                color: 'white', fontWeight: 1000, fontSize: 12,
              }}>
                {tk === 'default' ? '⚪' : '🔵'} {tk}
              </div>
            ))}
          </div>
          <div style={{ color: '#475569', fontSize: 11, marginTop: 4 }}>
            Buy more tokens from the Shop tab.
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   🛒 Shop Section
   ══════════════════════════════════════════════════════════ */
const SHOP_CARD_PACKS = [
  { id: 'pack_basic', name: '📦 Basic Pack', desc: '3 random cards', cost: 500, cards: 3 },
  { id: 'pack_premium', name: '🎁 Premium Pack', desc: '5 random cards + 1 rare', cost: 2000, cards: 5 },
  { id: 'pack_elite', name: '👑 Elite Pack', desc: '10 random cards + guaranteed transport', cost: 8000, cards: 10 },
];

const SHOP_TOKENS = [
  { id: 'gold_token', name: '🟡 Gold Token', cost: 5000 },
  { id: 'diamond_token', name: '💎 Diamond Token', cost: 15000 },
  { id: 'fire_token', name: '🔥 Fire Token', cost: 10000 },
  { id: 'crown_token', name: '👑 Crown Token', cost: 25000 },
];

function ShopSection({ uid, currentBoard, inventory, onRefresh }: {
  uid: string;
  currentBoard: number;
  inventory: ChronoInventoryDoc | null;
  onRefresh: () => Promise<void>;
}) {
  const [buying, setBuying] = useState<string | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);

  async function buyPack(pack: typeof SHOP_CARD_PACKS[0]) {
    setBuying(pack.id);
    setShopMsg(null);
    try {
      // Give random cards (simplified — doesn't deduct coins yet, that will be added)
      const availableCards = ALL_CATEGORY_CARDS.filter((c) => c.boardId <= currentBoard);
      for (let i = 0; i < pack.cards; i++) {
        if (availableCards.length === 0) break;
        const random = availableCards[Math.floor(Math.random() * availableCards.length)];
        await addCardCopies(uid, random.id, 1);
      }
      // Give transport card for elite pack
      if (pack.id === 'pack_elite') {
        const available = ALL_TRANSPORT_CARDS.filter((t) => currentBoard >= t.unlockBoard);
        if (available.length > 0) {
          const random = available[Math.floor(Math.random() * available.length)];
          await addTransportCard(uid, random.id, 1);
        }
      }
      await onRefresh();
      setShopMsg(`✅ Opened ${pack.name}!`);
    } catch {
      setShopMsg('❌ Purchase failed.');
    }
    setBuying(null);
    setTimeout(() => setShopMsg(null), 2500);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {shopMsg && (
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.30)', color: '#67e8f9', fontSize: 12, fontWeight: 900 }}>
          {shopMsg}
        </div>
      )}

      {/* Card packs */}
      <div>
        <div style={{ color: 'white', fontWeight: 1000, fontSize: 14, marginBottom: 8 }}>🎴 Card Packs</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
          {SHOP_CARD_PACKS.map((pack) => (
            <div key={pack.id} style={{
              borderRadius: 12, padding: 14,
              background: 'rgba(30,41,59,0.80)', border: '1px solid #334155',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>{pack.name}</div>
              <div style={{ color: '#94a3b8', fontSize: 11 }}>{pack.desc}</div>
              <button
                disabled={buying === pack.id}
                onClick={() => void buyPack(pack)}
                style={{
                  marginTop: 4, padding: '6px 0', borderRadius: 8, fontSize: 12, fontWeight: 1000,
                  background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', border: 'none',
                  color: 'white', cursor: buying === pack.id ? 'wait' : 'pointer',
                  opacity: buying === pack.id ? 0.6 : 1,
                }}
              >
                🪙 {pack.cost.toLocaleString()} Coins
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Token skins */}
      <div>
        <div style={{ color: 'white', fontWeight: 1000, fontSize: 14, marginBottom: 8 }}>🎯 Token Skins</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {SHOP_TOKENS.map((tk) => {
            const owned = inventory?.ownedTokens.includes(tk.id);
            return (
              <div key={tk.id} style={{
                borderRadius: 10, padding: 12, textAlign: 'center',
                background: owned ? 'rgba(16,185,129,0.08)' : 'rgba(30,41,59,0.80)',
                border: `1px solid ${owned ? 'rgba(16,185,129,0.30)' : '#334155'}`,
              }}>
                <div style={{ fontSize: 28 }}>{tk.name.split(' ')[0]}</div>
                <div style={{ color: 'white', fontWeight: 1000, fontSize: 12, marginTop: 4 }}>{tk.name.split(' ').slice(1).join(' ')}</div>
                {owned ? (
                  <div style={{ color: '#4ade80', fontSize: 10, fontWeight: 900, marginTop: 6 }}>✅ Owned</div>
                ) : (
                  <button style={{
                    marginTop: 6, padding: '5px 0', width: '100%', borderRadius: 6, fontSize: 11, fontWeight: 1000,
                    background: 'linear-gradient(135deg,#d97706,#b45309)', border: 'none',
                    color: 'white', cursor: 'pointer',
                  }}>
                    🪙 {tk.cost.toLocaleString()}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   ✅ Tasks Section (real — daily / weekly / lifetime + gem milestones)
   ══════════════════════════════════════════════════════════ */

type TaskTab = 'daily' | 'weekly' | 'lifetime' | 'gems';

function formatReward(reward: { coins?: number; energy?: number; gems?: number }): string {
  const parts: string[] = [];
  if (reward.coins)  parts.push(`🪙 ${reward.coins.toLocaleString()}`);
  if (reward.energy) parts.push(`⚡ ${reward.energy}`);
  if (reward.gems)   parts.push(`💎 ${reward.gems}`);
  return parts.join(' + ') || '—';
}

function TasksSection({ uid, currentBoard, currentClass, gems, onReload }: {
  uid: string;
  currentBoard: number;
  currentClass: number;
  gems: number;
  onReload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<TaskTab>('daily');
  type TasksState = Awaited<ReturnType<typeof import('@/lib/chronoTasksService').getTasksState>>;
  type GemMilestoneVm = Awaited<ReturnType<typeof import('@/lib/chronoGemMilestonesService').buildGemMilestoneViewModels>>[number];
  const [state, setState] = useState<TasksState | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [gemMilestones, setGemMilestones] = useState<GemMilestoneVm[]>([]);
  const [loadingGemMilestones, setLoadingGemMilestones] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const { getTasksState } = await import('@/lib/chronoTasksService');
      const s = await getTasksState(uid);
      setState(s);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load tasks.');
    } finally {
      setLoadingTasks(false);
    }
  }, [uid]);

  const loadGemMilestones = useCallback(async () => {
    setLoadingGemMilestones(true);
    try {
      const { buildGemMilestoneViewModels } = await import('@/lib/chronoGemMilestonesService');
      const next = await buildGemMilestoneViewModels(uid, currentBoard);
      setGemMilestones(next);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Failed to load gem milestones.');
    } finally {
      setLoadingGemMilestones(false);
    }
  }, [uid, currentBoard]);

  useEffect(() => { void loadTasks(); }, [loadTasks]);
  useEffect(() => { void loadGemMilestones(); }, [loadGemMilestones]);

  async function handleClaim(taskId: string) {
    setClaiming(taskId);
    setMsg(null);
    try {
      const isGemMilestone = taskId.startsWith(`gm_${currentBoard}_`);
      const res = isGemMilestone
        ? await (async () => {
            const { claimGemMilestoneReward } = await import('@/lib/chronoGemMilestonesService');
            const gemRes = await claimGemMilestoneReward(uid, taskId);
            return gemRes.ok
              ? { ok: true as const, reward: { gems: gemRes.reward.gems } }
              : { ok: false as const, reason: gemRes.reason };
          })()
        : await (async () => {
            const { claimTaskReward } = await import('@/lib/chronoTasksService');
            return claimTaskReward(uid, taskId);
          })();
      if (res.ok) {
        setMsg(`✅ Claimed: ${formatReward(res.reward)}`);
        await loadTasks();
        await loadGemMilestones();
        await onReload();
      } else {
        setMsg(`❌ ${res.reason}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Claim failed.');
    }
    setClaiming(null);
    setTimeout(() => setMsg(null), 2500);
  }

  const gemsNeededForNextClass = currentClass * 100;
  const gemsInCurrentClass = gems - (currentClass - 1) * 100;
  const gemsRemaining = Math.max(0, gemsNeededForNextClass - gems);

  const tabs: Array<{ id: TaskTab; icon: string; label: string }> = [
    { id: 'daily',    icon: '📅', label: 'Daily' },
    { id: 'weekly',   icon: '📆', label: 'Weekly' },
    { id: 'lifetime', icon: '🏆', label: 'Lifetime' },
    { id: 'gems',     icon: '💎', label: 'Gem Milestones' },
  ];

  return <TasksSectionBody
    tab={tab} setTab={setTab} tabs={tabs}
    uid={uid} currentBoard={currentBoard} currentClass={currentClass} gems={gems}
    gemsInCurrentClass={gemsInCurrentClass} gemsRemaining={gemsRemaining}
    milestones={gemMilestones}
    state={state} loadingTasks={loadingTasks}
    loadingGemMilestones={loadingGemMilestones}
    claiming={claiming} msg={msg}
    onClaim={handleClaim}
  />;
}

function TasksSectionBody(_props: {
  tab: TaskTab;
  setTab: (t: TaskTab) => void;
  tabs: Array<{ id: TaskTab; icon: string; label: string }>;
  uid: string;
  currentBoard: number;
  currentClass: number;
  gems: number;
  gemsInCurrentClass: number;
  gemsRemaining: number;
  milestones: Array<{ def: { id: string; label: string; emoji: string; reward: { gems: number }; goal: number }; progress: number; completed: boolean; claimed: boolean }>;
  state: Awaited<ReturnType<typeof import('@/lib/chronoTasksService').getTasksState>> | null;
  loadingTasks: boolean;
  loadingGemMilestones: boolean;
  claiming: string | null;
  msg: string | null;
  onClaim: (taskId: string) => Promise<void>;
}) {
  const { tab, setTab, tabs, currentBoard, currentClass, gems, gemsInCurrentClass, gemsRemaining, milestones, state, loadingTasks, loadingGemMilestones, claiming, msg, onClaim } = _props;
  // Gates unused currentClass warning
  void currentClass; void gems;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '5px 10px', fontSize: 11, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
            background: tab === t.id ? 'rgba(139,92,246,0.18)' : 'rgba(15,23,42,0.55)',
            border: tab === t.id ? '1px solid rgba(139,92,246,0.50)' : '1px solid #334155',
            color: tab === t.id ? '#ddd6fe' : '#94a3b8', fontWeight: 1000,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.30)', color: '#67e8f9', fontSize: 12, fontWeight: 900 }}>
          {msg}
        </div>
      )}

      {/* Gem progress bar */}
      {tab === 'gems' && (
        <div style={{
          padding: 12, borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(139,92,246,0.10), rgba(15,23,42,0.60))',
          border: '1px solid rgba(139,92,246,0.30)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ color: '#c4b5fd', fontWeight: 1000, fontSize: 12 }}>
              💎 Board {currentBoard} · Class {currentClass}
            </span>
            <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 900 }}>
              {gems} / {currentClass * 100} gems
            </span>
          </div>
          <div style={{ width: '100%', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (gemsInCurrentClass / 100) * 100)}%`,
              height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>
            {gemsRemaining > 0
              ? `${gemsRemaining} more gems to unlock Class ${currentClass + 1}`
              : '✅ Ready for next class!'
            }
          </div>
        </div>
      )}

      {/* Info banner */}
      {tab !== 'gems' && (
        <div style={{
          padding: '8px 12px', borderRadius: 8,
          background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.18)',
          color: '#94a3b8', fontSize: 11, fontWeight: 800,
        }}>
          {tab === 'daily' && '📅 Resets daily (UTC). Answer study questions in your program to progress the 📚 tasks — each correct ranked answer counts.'}
          {tab === 'weekly' && '📆 Resets weekly (UTC Monday). Bigger challenges, bigger rewards.'}
          {tab === 'lifetime' && '🏆 Permanent achievements. No reset.'}
        </div>
      )}

      {/* Task list */}
      {tab === 'gems' ? (
        loadingGemMilestones ? (
          <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading gem milestones…</div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {milestones.map((milestone) => {
            const task = milestone.def;
            const pct = Math.min(100, (milestone.progress / task.goal) * 100);
            return (
            <div key={task.id} style={{
              padding: '10px 12px', borderRadius: 10,
              background: milestone.claimed ? 'rgba(16,185,129,0.08)' : milestone.completed ? 'rgba(251,191,36,0.08)' : 'rgba(30,41,59,0.60)',
              border: `1px solid ${milestone.claimed ? 'rgba(16,185,129,0.30)' : milestone.completed ? 'rgba(251,191,36,0.35)' : '#334155'}`,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{task.emoji}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{task.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <div style={{ flex: 1, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: milestone.claimed ? '#4ade80' : milestone.completed ? '#fbbf24' : '#7c3aed', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ color: '#64748b', fontSize: 9, fontWeight: 900, flexShrink: 0 }}>
                    {milestone.progress}/{task.goal}
                  </span>
                </div>
              </div>
              {milestone.claimed ? (
                <span style={{ color: '#4ade80', fontSize: 10, fontWeight: 1000 }}>✅ Claimed</span>
              ) : milestone.completed ? (
                <button
                  disabled={claiming === task.id}
                  onClick={() => void onClaim(task.id)}
                  style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                    background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none',
                    color: 'white', cursor: claiming === task.id ? 'wait' : 'pointer',
                    opacity: claiming === task.id ? 0.6 : 1,
                  }}
                >
                  {claiming === task.id ? '…' : `Claim 💎 ${task.reward.gems}`}
                </button>
              ) : (
                <div style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                  background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.30)',
                  color: '#c4b5fd', whiteSpace: 'nowrap' }}>
                  💎 {task.reward.gems}
                </div>
              )}
            </div>
          );})}
        </div>
        )
      ) : loadingTasks || !state ? (
        <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading tasks…</div>
      ) : (
        (() => {
          // Lazy import type-only; catalog loaded synchronously via module-level require substitute
          // We'll dynamic-import here via a React state (one-shot fetch)
          return <TasksListForPeriod period={tab} state={state} claiming={claiming} onClaim={onClaim} />;
        })()
      )}
    </div>
  );
}

function TasksListForPeriod({ period, state, claiming, onClaim }: {
  period: TaskTab;
  state: Awaited<ReturnType<typeof import('@/lib/chronoTasksService').getTasksState>>;
  claiming: string | null;
  onClaim: (taskId: string) => Promise<void>;
}) {
  const [vms, setVms] = useState<Array<{ def: { id: string; label: string; emoji: string; goal: number; reward: { coins?: number; energy?: number; gems?: number } }; progress: number; completed: boolean; claimed: boolean }>>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (period === 'gems') return;
      const { buildTaskViewModels } = await import('@/lib/chronoTasksService');
      const next = buildTaskViewModels(state, period as 'daily' | 'weekly' | 'lifetime');
      if (alive) setVms(next as any);
    })();
    return () => { alive = false; };
  }, [period, state]);

  if (vms.length === 0) return (
    <div style={{ color: '#64748b', padding: 12, textAlign: 'center', fontSize: 12 }}>No tasks in this tab yet.</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {vms.map((vm) => {
        const t = vm.def;
        const pct = Math.min(100, (vm.progress / t.goal) * 100);
        const stateColor = vm.claimed ? '#4ade80' : vm.completed ? '#fbbf24' : '#7c3aed';
        return (
          <div key={t.id} style={{
            padding: '10px 12px', borderRadius: 10,
            background: vm.claimed ? 'rgba(16,185,129,0.08)' : vm.completed ? 'rgba(251,191,36,0.08)' : 'rgba(30,41,59,0.60)',
            border: `1px solid ${vm.claimed ? 'rgba(16,185,129,0.30)' : vm.completed ? 'rgba(251,191,36,0.35)' : '#334155'}`,
            display: 'flex', alignItems: 'center', gap: 10,
            opacity: vm.claimed ? 0.75 : 1,
          }}>
            <div style={{ fontSize: 22, flexShrink: 0 }}>{t.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{t.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ flex: 1, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: stateColor, transition: 'width 0.3s' }} />
                </div>
                <span style={{ color: '#64748b', fontSize: 9, fontWeight: 900, flexShrink: 0 }}>
                  {vm.progress}/{t.goal}
                </span>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 80 }}>
              {vm.claimed ? (
                <span style={{ color: '#4ade80', fontSize: 10, fontWeight: 1000 }}>✅ Claimed</span>
              ) : vm.completed ? (
                <button
                  disabled={claiming === t.id}
                  onClick={() => void onClaim(t.id)}
                  style={{
                    padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                    background: 'linear-gradient(135deg,#f59e0b,#d97706)', border: 'none',
                    color: 'white', cursor: claiming === t.id ? 'wait' : 'pointer',
                    opacity: claiming === t.id ? 0.6 : 1,
                  }}
                >
                  {claiming === t.id ? '…' : `Claim ${formatReward(t.reward)}`}
                </button>
              ) : (
                <div style={{ padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                  background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.30)',
                  color: '#c4b5fd', whiteSpace: 'nowrap' }}>
                  {formatReward(t.reward)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Legacy placeholder removed; TasksSection and TasksListForPeriod above are the real implementation.
function _LegacyTasksSectionNoop_Unused() {
  return null;
}

// The following block is unreachable legacy JSX that was part of the removed placeholder component.
// It is gated behind a constant-false conditional to keep the file diff minimal; tree-shaken in prod.
function _LegacyTasksJsxRemoved() {
  const tab = 'daily' as TaskTab;
  const currentBoard = 0; const currentClass = 0; const gems = 0;
  const gemsInCurrentClass = 0; const gemsRemaining = 0;
  const setTab = (_t: TaskTab) => {};
  const tabs: Array<{ id: TaskTab; icon: string; label: string }> = [];
  const tasks: Array<{ id: string; label: string; emoji: string; reward: string; rewardEmoji: string; progress: number; goal: number; completed: boolean }> = [];
  void tab; void currentBoard; void currentClass; void gems; void gemsInCurrentClass; void gemsRemaining; void setTab; void tabs; void tasks;
  if (true) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '5px 10px', fontSize: 11, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
            background: tab === t.id ? 'rgba(139,92,246,0.18)' : 'rgba(15,23,42,0.55)',
            border: tab === t.id ? '1px solid rgba(139,92,246,0.50)' : '1px solid #334155',
            color: tab === t.id ? '#ddd6fe' : '#94a3b8', fontWeight: 1000,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Gem progress bar (shown on gem milestones tab) */}
      {tab === 'gems' && (
        <div style={{
          padding: 12, borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(139,92,246,0.10), rgba(15,23,42,0.60))',
          border: '1px solid rgba(139,92,246,0.30)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ color: '#c4b5fd', fontWeight: 1000, fontSize: 12 }}>
              💎 Board {currentBoard} · Class {currentClass}
            </span>
            <span style={{ color: '#94a3b8', fontSize: 11, fontWeight: 900 }}>
              {gems} / {currentClass * 100} gems
            </span>
          </div>
          <div style={{ width: '100%', height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(100, (gemsInCurrentClass / 100) * 100)}%`,
              height: '100%', borderRadius: 4,
              background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>
            {gemsRemaining > 0
              ? `${gemsRemaining} more gems to unlock Class ${currentClass + 1}`
              : '✅ Ready for next class!'
            }
          </div>
        </div>
      )}

      {/* Info banner */}
      {tab !== 'gems' && (
        <div style={{
          padding: '8px 12px', borderRadius: 8,
          background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.18)',
          color: '#94a3b8', fontSize: 11, fontWeight: 800,
        }}>
          {tab === 'daily' && '📅 Resets every 24 hours. Complete tasks to earn rewards!'}
          {tab === 'weekly' && '📆 Resets every Monday. Bigger challenges, bigger rewards!'}
          {tab === 'lifetime' && '🏆 Permanent achievements. Flex your progress!'}
        </div>
      )}

      {/* Task list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.map((task) => (
          <div key={task.id} style={{
            padding: '10px 12px', borderRadius: 10,
            background: task.completed ? 'rgba(16,185,129,0.08)' : 'rgba(30,41,59,0.60)',
            border: `1px solid ${task.completed ? 'rgba(16,185,129,0.30)' : '#334155'}`,
            display: 'flex', alignItems: 'center', gap: 10,
            opacity: task.completed ? 0.65 : 1,
          }}>
            <div style={{ fontSize: 22, flexShrink: 0 }}>{task.emoji}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{task.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                {/* Progress bar */}
                <div style={{ flex: 1, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (task.progress / task.goal) * 100)}%`,
                    height: '100%', borderRadius: 3,
                    background: task.completed ? '#4ade80' : '#7c3aed',
                    transition: 'width 0.3s',
                  }} />
                </div>
                <span style={{ color: '#64748b', fontSize: 9, fontWeight: 900, flexShrink: 0 }}>
                  {task.progress}/{task.goal}
                </span>
              </div>
            </div>
            <div style={{
              textAlign: 'right', flexShrink: 0,
            }}>
              {task.completed ? (
                <span style={{ color: '#4ade80', fontSize: 10, fontWeight: 1000 }}>✅ Done</span>
              ) : (
                <div style={{
                  padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                  background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.30)',
                  color: '#c4b5fd', whiteSpace: 'nowrap',
                }}>
                  {task.rewardEmoji} {task.reward}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Placeholder notice */}
      <div style={{
        padding: '10px 14px', borderRadius: 8, marginTop: 4,
        background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.18)',
        color: '#fde68a', fontSize: 11, fontWeight: 800, textAlign: 'center',
      }}>
        🚧 Task tracking coming soon — task definitions are placeholders
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   👥 Friends / Class Level Section
   ══════════════════════════════════════════════════════════ */

function FriendsSection({ currentClass }: { currentClass: number }) {
  const { user, userData, refreshUserData } = useAuth();
  const [friendTab, setFriendTab] = useState<'leaderboard' | 'gifts' | 'visit'>('leaderboard');
  type FriendsSnapshot = Awaited<ReturnType<typeof import('@/lib/chronoFriendsService').getChronoFriendsSnapshot>>;
  const [snapshot, setSnapshot] = useState<FriendsSnapshot | null>(null);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [friendMsg, setFriendMsg] = useState<string | null>(null);
  const [sendingGift, setSendingGift] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    if (!user || !userData) {
      setSnapshot(null);
      setLoadingFriends(false);
      return;
    }
    setLoadingFriends(true);
    try {
      const { getChronoFriendsSnapshot } = await import('@/lib/chronoFriendsService');
      const next = await getChronoFriendsSnapshot(user.uid, userData);
      setSnapshot(next);
    } catch (e) {
      setFriendMsg(e instanceof Error ? e.message : 'Failed to load friends.');
    } finally {
      setLoadingFriends(false);
    }
  }, [user, userData]);

  useEffect(() => { void loadFriends(); }, [loadFriends]);

  async function handleSendGift(friendUid: string) {
    if (!user) return;
    setSendingGift(friendUid);
    setFriendMsg(null);
    try {
      const { sendChronoEnergyGift } = await import('@/lib/chronoFriendsService');
      const res = await sendChronoEnergyGift(user.uid, friendUid);
      if (res.ok) {
        setFriendMsg('✅ Sent 1 energy gift.');
        await Promise.all([loadFriends(), refreshUserData()]);
      } else {
        setFriendMsg(`❌ ${res.reason}`);
      }
    } catch (e) {
      setFriendMsg(e instanceof Error ? e.message : 'Failed to send gift.');
    } finally {
      setSendingGift(null);
      setTimeout(() => setFriendMsg(null), 2500);
    }
  }

  const tabs = [
    { id: 'leaderboard' as const, icon: '🏆', label: 'Leaderboard' },
    { id: 'gifts' as const,       icon: '🎁', label: 'Energy Gifts' },
    { id: 'visit' as const,       icon: '🗺️', label: 'Visit Boards' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 5 }}>
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setFriendTab(t.id)} style={{
            padding: '5px 10px', fontSize: 11, borderRadius: 8, cursor: 'pointer',
            background: friendTab === t.id ? 'rgba(139,92,246,0.18)' : 'rgba(15,23,42,0.55)',
            border: friendTab === t.id ? '1px solid rgba(139,92,246,0.50)' : '1px solid #334155',
            color: friendTab === t.id ? '#ddd6fe' : '#94a3b8', fontWeight: 1000,
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {friendMsg && (
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.30)', color: '#67e8f9', fontSize: 12, fontWeight: 900 }}>
          {friendMsg}
        </div>
      )}

      {friendTab === 'leaderboard' && (
        loadingFriends ? (
        <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading friends…</div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 800, marginBottom: 2 }}>
            🏆 Class Level Ranking Among Friends
          </div>
          {(snapshot?.leaderboard ?? []).map((f, i) => {
            const isYou = f.isYou;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            return (
              <div key={f.uid} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
                background: isYou ? 'rgba(139,92,246,0.12)' : 'rgba(30,41,59,0.60)',
                border: isYou ? '1.5px solid rgba(139,92,246,0.40)' : '1px solid #334155',
              }}>
                <div style={{ fontSize: 16, fontWeight: 1000, width: 28, textAlign: 'center', flexShrink: 0 }}>
                  {medal}
                </div>
                <div style={{ fontSize: 22, flexShrink: 0 }}>{isYou ? '🏰' : '👥'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isYou ? '#c4b5fd' : 'white', fontWeight: 1000, fontSize: 13 }}>
                    {f.username} {isYou && <span style={{ fontSize: 10, color: '#a78bfa' }}>(you)</span>}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>
                    Class {f.classLevel} · 💎 {f.gems} · Board {f.currentBoard}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )
      )}

      {friendTab === 'gifts' && (
        loadingFriends ? (
        <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>Loading gifts…</div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 48 }}>🎁</div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 16 }}>Daily Energy Gifts</div>
          <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', maxWidth: 300 }}>
            Send free ⚡ energy to your friends once a day! They can send energy back to you too.
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 8,
          }}>
            {(snapshot?.gifts ?? []).map((f) => (
              <div key={f.uid} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
                background: 'rgba(30,41,59,0.60)', border: '1px solid #334155',
              }}>
                <div style={{ fontSize: 20 }}>👥</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{f.username}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{f.sentToday ? 'Gift already sent today' : 'Ready to send 1 ⚡ energy'}</div>
                </div>
                <button
                  disabled={!f.canSend || sendingGift === f.uid}
                  onClick={() => void handleSendGift(f.uid)}
                  style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                  background: f.canSend ? 'linear-gradient(135deg, #059669, #047857)' : 'rgba(51,65,85,0.8)', border: 'none',
                  color: f.canSend ? 'white' : '#64748b', cursor: f.canSend ? 'pointer' : 'not-allowed',
                  opacity: sendingGift === f.uid ? 0.6 : 1,
                }}>
                  {sendingGift === f.uid ? '…' : f.canSend ? '⚡ Send' : 'Sent'}
                </button>
              </div>
            ))}
          </div>
        </div>
        )
      )}

      {friendTab === 'visit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 48 }}>🗺️</div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 16 }}>Visit Friends' Boards</div>
          <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', maxWidth: 300 }}>
            Explore your friends' boards, see their card setups, and even launch remote attacks!
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 8,
          }}>
            {(snapshot?.leaderboard ?? []).filter((f) => !f.isYou).map((f) => (
              <div key={f.uid} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
                background: 'rgba(30,41,59,0.60)', border: '1px solid #334155',
              }}>
                <div style={{ fontSize: 20 }}>👥</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{f.username}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>Class {f.classLevel} · Board {f.currentBoard}</div>
                </div>
                <button style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                  background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.35)',
                  color: '#c4b5fd', cursor: 'pointer',
                }}>
                  👁️ Visit
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   🎟️ Battle Pass Section
   ══════════════════════════════════════════════════════════ */

function BattlePassSection() {
  const { user } = useAuth();
  type BattlePassVm = Awaited<ReturnType<typeof import('@/lib/chronoBattlePassService').buildChronoBattlePassViewModel>>;
  const [battlePass, setBattlePass] = useState<BattlePassVm | null>(null);
  const [loadingPass, setLoadingPass] = useState(true);
  const [battlePassMsg, setBattlePassMsg] = useState<string | null>(null);
  const [claimingTier, setClaimingTier] = useState<number | null>(null);

  const loadBattlePass = useCallback(async () => {
    if (!user) {
      setBattlePass(null);
      setLoadingPass(false);
      return;
    }
    setLoadingPass(true);
    try {
      const { buildChronoBattlePassViewModel } = await import('@/lib/chronoBattlePassService');
      const next = await buildChronoBattlePassViewModel(user.uid);
      setBattlePass(next);
    } catch (e) {
      setBattlePassMsg(e instanceof Error ? e.message : 'Failed to load Battle Pass.');
    } finally {
      setLoadingPass(false);
    }
  }, [user]);

  useEffect(() => { void loadBattlePass(); }, [loadBattlePass]);

  async function handleClaimTier(tier: number) {
    if (!user) return;
    setClaimingTier(tier);
    setBattlePassMsg(null);
    try {
      const { claimChronoBattlePassReward } = await import('@/lib/chronoBattlePassService');
      const res = await claimChronoBattlePassReward(user.uid, tier);
      if (res.ok) {
        setBattlePassMsg(`✅ Claimed: ${formatReward(res.reward)}`);
        await loadBattlePass();
      } else {
        setBattlePassMsg(`❌ ${res.reason}`);
      }
    } catch (e) {
      setBattlePassMsg(e instanceof Error ? e.message : 'Failed to claim tier reward.');
    } finally {
      setClaimingTier(null);
      setTimeout(() => setBattlePassMsg(null), 2500);
    }
  }

  const visibleTiers = battlePass?.tiers.slice(0, 10) ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      <div style={{
        padding: 18, borderRadius: 16, border: '1px solid rgba(234,179,8,0.28)', background: 'linear-gradient(135deg, rgba(30,41,59,0.92), rgba(15,23,42,0.98))',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'white', fontWeight: 1000, fontSize: 20 }}>🎟️ Chrono Battle Pass</div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>Earn pass XP from your real Chrono progress across tasks, sets, discoveries, milestones, and gifts.</div>
          </div>
          <div style={{ color: '#fde68a', fontWeight: 1000, fontSize: 14 }}>
            {battlePass ? `Level ${battlePass.level}` : 'Loading…'}
          </div>
        </div>

        {battlePassMsg && (
          <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.30)', color: '#67e8f9', fontSize: 12, fontWeight: 900 }}>
            {battlePassMsg}
          </div>
        )}

        {loadingPass || !battlePass ? (
          <div style={{ color: '#94a3b8', padding: 12, textAlign: 'center' }}>Loading Battle Pass…</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 900 }}>{battlePass.xp} XP total</span>
              <span style={{ color: '#64748b', fontSize: 11, fontWeight: 800 }}>{battlePass.xpIntoLevel} / {battlePass.xpForNextLevel} to next level</span>
            </div>
            <div style={{ width: '100%', height: 10, background: '#1e293b', borderRadius: 999, overflow: 'hidden', border: '1px solid #334155' }}>
              <div style={{ width: `${Math.min(100, (battlePass.xpIntoLevel / battlePass.xpForNextLevel) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #f59e0b, #facc15)', transition: 'width 0.3s' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginTop: 4 }}>
              {visibleTiers.map((tier) => (
                <div key={tier.def.tier} style={{
                  padding: 12,
                  borderRadius: 12,
                  background: tier.claimed ? 'rgba(16,185,129,0.08)' : tier.unlocked ? 'rgba(251,191,36,0.08)' : 'rgba(30,41,59,0.70)',
                  border: `1px solid ${tier.claimed ? 'rgba(16,185,129,0.30)' : tier.unlocked ? 'rgba(251,191,36,0.35)' : '#334155'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>Tier {tier.def.tier}</div>
                    <div style={{ color: tier.claimed ? '#4ade80' : tier.unlocked ? '#fde68a' : '#64748b', fontSize: 10, fontWeight: 1000 }}>
                      {tier.claimed ? 'Claimed' : tier.unlocked ? 'Unlocked' : `${tier.def.xpRequired} XP`}
                    </div>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 800, marginTop: 8 }}>
                    {formatReward(tier.def.reward)}
                  </div>
                  {tier.claimed ? (
                    <div style={{ marginTop: 10, color: '#4ade80', fontSize: 10, fontWeight: 1000 }}>✅ Reward claimed</div>
                  ) : (
                    <button
                      disabled={!tier.unlocked || claimingTier === tier.def.tier}
                      onClick={() => void handleClaimTier(tier.def.tier)}
                      style={{
                        marginTop: 10,
                        width: '100%',
                        padding: '7px 0',
                        borderRadius: 8,
                        fontSize: 10,
                        fontWeight: 1000,
                        background: tier.unlocked ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'rgba(51,65,85,0.8)',
                        border: 'none',
                        color: tier.unlocked ? 'white' : '#64748b',
                        cursor: tier.unlocked ? 'pointer' : 'not-allowed',
                        opacity: claimingTier === tier.def.tier ? 0.6 : 1,
                      }}
                    >
                      {claimingTier === tier.def.tier ? '…' : tier.unlocked ? 'Claim Reward' : 'Locked'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
