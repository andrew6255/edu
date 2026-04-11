import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { ensureChronoEmpiresState, getChronoEmpiresState, type ChronoEmpiresStateDoc } from '@/lib/chronoEmpiresService';
import { BOARDS, boardToClass, gemsToClass, ALL_CATEGORY_CARDS, ALL_TRANSPORT_CARDS, CARD_UPGRADE_LEVELS, WHEEL_SEGMENTS, spinWheel, type CardCategory, type CategoryCard } from '@/lib/chronoCards';
import { getInventory, ensureInventory, addCardCopies, upgradeCard, addToDeck, removeFromDeck, addTransportCard, addCombatCard, type ChronoInventoryDoc, type OwnedCard } from '@/lib/chronoInventoryService';

type Section = 'road' | 'wheel' | 'inventory' | 'shop' | 'tasks' | 'friends' | 'battlepass';

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'road',       label: 'Road',        icon: '🛣️' },
  { id: 'wheel',      label: 'Wheel',       icon: '🎡' },
  { id: 'inventory',  label: 'Inventory',   icon: '🎒' },
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
      await loadInventory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to load Chrono Empires');
    } finally {
      setLoading(false);
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
        ) : section === 'shop' ? (
          <ShopSection uid={uid} currentBoard={currentBoard} inventory={inventory} onRefresh={loadInventory} />
        ) : section === 'tasks' ? (
          <TasksSection currentBoard={currentBoard} currentClass={currentClass} gems={gems} />
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


/* ══════════════════════════════════════════════════════════
   Board Road Section
   ══════════════════════════════════════════════════════════ */
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
  /* ── Top info card ─────────────────────────── */
  const tier = tierInfo(currentClass);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Status card ─────────────────────────── */}
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

      {/* ── Road list with spectrum bar ──────────── */}
      <div
        ref={roadRef}
        style={{
          display: 'flex', gap: 0, height: 'min(520px, 62vh)', overflow: 'hidden', borderRadius: 12,
          border: '1px solid #334155', background: 'rgba(15,23,42,0.55)',
        }}
      >
        {/* Left: Spectrum bar */}
        <div style={{ width: 36, flexShrink: 0, position: 'relative', overflow: 'hidden' }}>
          {/* Main gradient */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, #EF4444 0%, #3B82F6 33%, #064E3B 66%, #111827 100%)',
          }} />
          {/* Metallic sheen on lower half */}
          <div style={{
            position: 'absolute', left: 0, right: 0, top: '55%', bottom: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 40%, rgba(255,255,255,0.05) 60%, transparent 100%)',
            pointerEvents: 'none',
          }} />
          {/* Class labels */}
          {BOARDS.map((b, i) => {
            const cls = i + 1;
            const pct = i / (BOARDS.length - 1);
            return (
              <div key={b} style={{
                position: 'absolute', left: 0, right: 0,
                top: `${pct * 100}%`, transform: 'translateY(-50%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 1000, color: pct < 0.5 ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.55)',
                textShadow: '0 1px 3px rgba(0,0,0,0.60)', lineHeight: 1,
                userSelect: 'none',
              }}>
                C{cls}
              </div>
            );
          })}
        </div>

        {/* Right: Board list (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {BOARDS.map((b, i) => {
            const cls = i + 1;
            const isCurrent = b === currentBoard;
            const isPast = b < currentBoard;
            const isLocked = b > currentBoard;
            const pct = i / (BOARDS.length - 1);
            const dotColor = spectrumColor(pct);
            const ti = tierInfo(cls);

            return (
              <button
                key={b}
                disabled={isLocked}
                onClick={() => { if (isCurrent) onOpenBoard(b); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '10px 10px', marginBottom: 4, borderRadius: 10, cursor: isCurrent ? 'pointer' : 'default',
                  textAlign: 'left', boxSizing: 'border-box',
                  background: isCurrent
                    ? 'linear-gradient(135deg, rgba(139,92,246,0.16), rgba(96,165,250,0.08))'
                    : 'transparent',
                  border: isCurrent ? '1px solid rgba(139,92,246,0.45)' : '1px solid transparent',
                  opacity: isLocked ? 0.38 : isPast ? 0.60 : 1,
                  animation: isCurrent ? 'ce-road-pulse 2.5s ease-in-out infinite' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                {/* Dot */}
                <div style={{
                  width: 12, height: 12, borderRadius: 999, flexShrink: 0,
                  background: isCurrent ? '#a78bfa' : dotColor,
                  border: isCurrent ? '2px solid white' : `2px solid ${dotColor}`,
                  boxShadow: isCurrent ? '0 0 8px rgba(167,139,250,0.50)' : 'none',
                }} />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 13 }}>
                    Board {b}
                    <span style={{ marginLeft: 8, color: '#64748b', fontSize: 10, fontWeight: 800 }}>
                      Class {cls} · {ti.emoji} {ti.label}
                    </span>
                  </div>
                </div>

                {/* Status */}
                <div style={{ flexShrink: 0 }}>
                  {isCurrent ? (
                    <span style={{ background: 'rgba(139,92,246,0.20)', border: '1px solid rgba(139,92,246,0.40)', borderRadius: 20, padding: '2px 10px', fontSize: 10, fontWeight: 1000, color: '#c4b5fd' }}>
                      ▶ Current
                    </span>
                  ) : isPast ? (
                    <span style={{ color: '#4ade80', fontSize: 10, fontWeight: 900 }}>✅ Cleared</span>
                  ) : (
                    <span style={{ color: '#475569', fontSize: 10, fontWeight: 900 }}>🔒</span>
                  )}
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
      const { doc: fDoc, updateDoc: fUpdate } = await import('firebase/firestore');
      const { db: fDb } = await import('@/lib/firebase');
      await fUpdate(fDoc(fDb, 'users', uid), { 'economy.energy': Math.max(0, energy - 1) } as any);
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
        if (seg.id.startsWith('w_') && seg.id !== 'w_cat' && seg.id !== 'w_trans' && seg.id !== 'w_defend' && seg.id !== 'w_attack') {
          // Coin reward — would update gold via service (simplified)
        } else if (seg.id === 'w_cat') {
          // Random category card
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

type InvTab = 'collection' | 'deck' | 'transport' | 'tokens';

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

  if (!inventory) return <div style={{ color: '#94a3b8', padding: 20 }}>Loading inventory…</div>;

  const tabs: Array<{ id: InvTab; icon: string; label: string }> = [
    { id: 'collection', icon: '🎴', label: 'Cards' },
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
   ✅ Tasks Section (Daily / Weekly / Lifetime + Gem Milestones)
   ══════════════════════════════════════════════════════════ */

type TaskTab = 'daily' | 'weekly' | 'lifetime' | 'gems';

interface TaskItem {
  id: string;
  label: string;
  emoji: string;
  reward: string;
  rewardEmoji: string;
  progress: number;
  goal: number;
  completed: boolean;
}

const PLACEHOLDER_DAILY: TaskItem[] = [
  { id: 'd1', label: 'Spin the Wheel 3 times',        emoji: '🎡', reward: '500 Coins',   rewardEmoji: '🪙', progress: 0, goal: 3, completed: false },
  { id: 'd2', label: 'Win 1 Auction',                  emoji: '🔨', reward: '1 Energy',    rewardEmoji: '⚡', progress: 0, goal: 1, completed: false },
  { id: 'd3', label: 'Land on 5 booths',               emoji: '🎲', reward: '200 Coins',   rewardEmoji: '🪙', progress: 0, goal: 5, completed: false },
  { id: 'd4', label: 'Use a Transport Card',           emoji: '🚗', reward: '10 XP',       rewardEmoji: '⭐', progress: 0, goal: 1, completed: false },
];

const PLACEHOLDER_WEEKLY: TaskItem[] = [
  { id: 'w1', label: 'Collect 10 card copies',         emoji: '🎴', reward: '3,000 Coins', rewardEmoji: '🪙', progress: 0, goal: 10, completed: false },
  { id: 'w2', label: 'Bankrupt 1 bot',                 emoji: '💀', reward: '5 Energy',    rewardEmoji: '⚡', progress: 0, goal: 1,  completed: false },
  { id: 'w3', label: 'Win 5 Auctions',                 emoji: '🔨', reward: '2,000 Coins', rewardEmoji: '🪙', progress: 0, goal: 5,  completed: false },
  { id: 'w4', label: 'Upgrade any card to Lv.2',       emoji: '⬆️', reward: '50 XP',       rewardEmoji: '⭐', progress: 0, goal: 1,  completed: false },
];

const PLACEHOLDER_LIFETIME: TaskItem[] = [
  { id: 'l1', label: 'Own 50 unique cards',            emoji: '📚', reward: '10,000 Coins', rewardEmoji: '🪙', progress: 0, goal: 50,  completed: false },
  { id: 'l2', label: 'Reach Class 10',                 emoji: '🏆', reward: '20 Energy',    rewardEmoji: '⚡', progress: 0, goal: 1,   completed: false },
  { id: 'l3', label: 'Max upgrade a card to Lv.4',     emoji: '💎', reward: '500 XP',       rewardEmoji: '⭐', progress: 0, goal: 1,   completed: false },
  { id: 'l4', label: 'Win 100 total Auctions',         emoji: '🔨', reward: '50,000 Coins', rewardEmoji: '🪙', progress: 0, goal: 100, completed: false },
];

function TasksSection({ currentBoard, currentClass, gems }: {
  currentBoard: number;
  currentClass: number;
  gems: number;
}) {
  const [tab, setTab] = useState<TaskTab>('daily');

  const gemsNeededForNextClass = currentClass * 100;
  const gemsInCurrentClass = gems - (currentClass - 1) * 100;
  const gemsRemaining = Math.max(0, gemsNeededForNextClass - gems);

  // Placeholder gem milestones for current board
  const milestones = [
    { id: `gm_${currentBoard}_1`, label: `Complete Board ${currentBoard} — Milestone 1`, emoji: '🎯', reward: `25 💎 Gems`, rewardEmoji: '💎', progress: 0, goal: 1, completed: false },
    { id: `gm_${currentBoard}_2`, label: `Complete Board ${currentBoard} — Milestone 2`, emoji: '🎯', reward: `25 💎 Gems`, rewardEmoji: '💎', progress: 0, goal: 1, completed: false },
    { id: `gm_${currentBoard}_3`, label: `Complete Board ${currentBoard} — Milestone 3`, emoji: '🎯', reward: `25 💎 Gems`, rewardEmoji: '💎', progress: 0, goal: 1, completed: false },
    { id: `gm_${currentBoard}_4`, label: `Complete Board ${currentBoard} — Milestone 4`, emoji: '🎯', reward: `25 💎 Gems`, rewardEmoji: '💎', progress: 0, goal: 1, completed: false },
  ];

  const tabs: Array<{ id: TaskTab; icon: string; label: string }> = [
    { id: 'daily',    icon: '📅', label: 'Daily' },
    { id: 'weekly',   icon: '📆', label: 'Weekly' },
    { id: 'lifetime', icon: '🏆', label: 'Lifetime' },
    { id: 'gems',     icon: '💎', label: 'Gem Milestones' },
  ];

  const tasks = tab === 'daily' ? PLACEHOLDER_DAILY
    : tab === 'weekly' ? PLACEHOLDER_WEEKLY
    : tab === 'lifetime' ? PLACEHOLDER_LIFETIME
    : milestones;

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
  const [friendTab, setFriendTab] = useState<'leaderboard' | 'gifts' | 'visit'>('leaderboard');

  const placeholderFriends = [
    { name: 'Ali M.', class: 12, emoji: '👨‍🎓', gems: 1150 },
    { name: 'Nour K.', class: 8, emoji: '👩‍💼', gems: 780 },
    { name: 'Omar S.', class: 15, emoji: '🧑‍🔬', gems: 1490 },
    { name: 'Yasmin R.', class: 5, emoji: '👩‍🎨', gems: 420 },
    { name: 'You', class: currentClass, emoji: '🏰', gems: 0 },
  ].sort((a, b) => b.class - a.class);

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

      {friendTab === 'leaderboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 800, marginBottom: 2 }}>
            🏆 Class Level Ranking Among Friends
          </div>
          {placeholderFriends.map((f, i) => {
            const isYou = f.name === 'You';
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            return (
              <div key={f.name} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
                background: isYou ? 'rgba(139,92,246,0.12)' : 'rgba(30,41,59,0.60)',
                border: isYou ? '1.5px solid rgba(139,92,246,0.40)' : '1px solid #334155',
              }}>
                <div style={{ fontSize: 16, fontWeight: 1000, width: 28, textAlign: 'center', flexShrink: 0 }}>
                  {medal}
                </div>
                <div style={{ fontSize: 22, flexShrink: 0 }}>{f.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isYou ? '#c4b5fd' : 'white', fontWeight: 1000, fontSize: 13 }}>
                    {f.name} {isYou && <span style={{ fontSize: 10, color: '#a78bfa' }}>(you)</span>}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>
                    Class {f.class} · 💎 {f.gems}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {friendTab === 'gifts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', padding: '16px 0' }}>
          <div style={{ fontSize: 48 }}>🎁</div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 16 }}>Daily Energy Gifts</div>
          <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', maxWidth: 300 }}>
            Send free ⚡ energy to your friends once a day! They can send energy back to you too.
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6, width: '100%', marginTop: 8,
          }}>
            {placeholderFriends.filter((f) => f.name !== 'You').map((f) => (
              <div key={f.name} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
                background: 'rgba(30,41,59,0.60)', border: '1px solid #334155',
              }}>
                <div style={{ fontSize: 20 }}>{f.emoji}</div>
                <div style={{ flex: 1, color: 'white', fontWeight: 1000, fontSize: 12 }}>{f.name}</div>
                <button style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 10, fontWeight: 1000,
                  background: 'linear-gradient(135deg, #059669, #047857)', border: 'none',
                  color: 'white', cursor: 'pointer',
                }}>
                  ⚡ Send
                </button>
              </div>
            ))}
          </div>
        </div>
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
            {placeholderFriends.filter((f) => f.name !== 'You').map((f) => (
              <div key={f.name} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
                background: 'rgba(30,41,59,0.60)', border: '1px solid #334155',
              }}>
                <div style={{ fontSize: 20 }}>{f.emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{f.name}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>Class {f.class}</div>
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

      {/* Placeholder notice */}
      <div style={{
        padding: '10px 14px', borderRadius: 8, marginTop: 4,
        background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.18)',
        color: '#fde68a', fontSize: 11, fontWeight: 800, textAlign: 'center',
      }}>
        🚧 Friends system integration coming soon
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   🎟️ Battle Pass Section
   ══════════════════════════════════════════════════════════ */

function BattlePassSection() {
  return (
    <div style={{
      padding: 30, borderRadius: 16, border: '1px solid #334155', background: 'rgba(15,23,42,0.55)',
      textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 8,
    }}>
      <div style={{ fontSize: 56 }}>🎟️</div>
      <div style={{ color: 'white', fontWeight: 1000, fontSize: 20 }}>Battle Pass</div>
      <div style={{ color: '#94a3b8', fontSize: 13, maxWidth: 320, lineHeight: 1.5 }}>
        Exclusive seasonal rewards, premium card skins, and bonus gems.
      </div>
      <div style={{
        marginTop: 8, padding: '10px 28px', borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(234,179,8,0.15), rgba(217,119,6,0.08))',
        border: '1.5px solid rgba(234,179,8,0.35)',
        color: '#fde68a', fontWeight: 1000, fontSize: 14,
      }}>
        🔜 Coming Soon
      </div>
    </div>
  );
}
