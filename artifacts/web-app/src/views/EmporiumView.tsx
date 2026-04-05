import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  computeTierFromEnergy,
  ensureBattlePassSeason,
  ensureUserBattlePassProgress,
  getDefaultSeasonId,
  markClaimedFreeTier,
  markClaimedPremiumTier,
  setBattlePassPremium,
} from '@/lib/battlePassService';
import {
  addCredits,
  ensureUserInventory,
  getUserInventory,
  equipInventory,
} from '@/lib/inventoryService';
import { findTierReward, grantReward } from '@/lib/battlePassRewards';
import type { BattlePassSeasonDoc, UserBattlePassProgressDoc, UserInventoryDoc } from '@/types/battlePass';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { RealmId, RealmMode, UserRealmStateDoc } from '@/types/realms';
import { ensureUserRealmState, getUserRealmState, setRealmMode, setSelectedRealm } from '@/lib/realmService';
import { ensureQuestsForToday } from '@/lib/battlePassQuestService';
import type { UserQuest } from '@/types/quests';
import type { UserDropsDoc, WeeklyCrateKind } from '@/types/drops';
import { canClaimWeeklyCrate, claimWeeklyCrate, ensureUserDrops, getUserDrops } from '@/lib/dropsService';
import type { ExpeditionDoc, UserExpeditionStateDoc } from '@/types/expeditions';
import {
  claimExpeditionReward,
  createExpedition,
  ensureUserExpeditionState,
  getExpedition,
  getUserExpeditionState,
  joinExpeditionByCode,
  leaveActiveExpedition,
} from '@/lib/expeditionService';
import type { RealmUpgradeId, UserRealmUpgradesDoc } from '@/types/realmUpgrades';
import { ensureUserRealmUpgrades, getUserRealmUpgrades, purchaseRealmUpgrade, upgradesForRealm } from '@/lib/realmUpgradesService';

type Tab = 'season' | 'realms' | 'legacy' | 'cosmetics' | 'inventory' | 'room';

const REALM_META: Record<RealmId, { name: string; subtitle: string; icon: string; gradient: string }> = {
  renaissance: {
    name: 'Renaissance Workshop',
    subtitle: 'Blueprints, prototypes, curiosity',
    icon: '🛠️',
    gradient: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(245,158,11,0.08))',
  },
  industrial: {
    name: 'Industrial Foundry',
    subtitle: 'Systems, engines, precision',
    icon: '⚙️',
    gradient: 'linear-gradient(135deg, rgba(148,163,184,0.10), rgba(245,158,11,0.06))',
  },
  space: {
    name: 'Orbital Research Station',
    subtitle: 'Experiments, anomalies, signal hunting',
    icon: '🛰️',
    gradient: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(168,85,247,0.10))',
  },
};

const MODE_META: Array<{ id: RealmMode; label: string; desc: string }> = [
  { id: 'cozy', label: 'Cozy', desc: 'Collect + build, low pressure' },
  { id: 'scholar', label: 'Scholar', desc: 'Clean progress + titles + lore' },
  { id: 'competitive', label: 'Competitive', desc: 'Opt-in duels + leaderboards later' },
];

async function ensureProfileRoom(uid: string): Promise<void> {
  const ref = doc(db, 'users', uid, 'profile_room', 'global');
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    version: 1,
    placed: [],
    updatedAt: new Date().toISOString(),
  });
}

export default function EmporiumView() {
  const { user, userData } = useAuth();
  const uid = user?.uid ?? null;

  const [tab, setTab] = useState<Tab>('season');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [season, setSeason] = useState<BattlePassSeasonDoc | null>(null);
  const [progress, setProgress] = useState<UserBattlePassProgressDoc | null>(null);
  const [inv, setInv] = useState<UserInventoryDoc | null>(null);
  const [realm, setRealm] = useState<UserRealmStateDoc | null>(null);
  const [drops, setDrops] = useState<UserDropsDoc | null>(null);
  const [crateStatus, setCrateStatus] = useState<{ ok: boolean; reason?: string; weekKey?: string } | null>(null);

  const [expState, setExpState] = useState<UserExpeditionStateDoc | null>(null);
  const [exp, setExp] = useState<ExpeditionDoc | null>(null);
  const [joinCode, setJoinCode] = useState('');

  const [realmUp, setRealmUp] = useState<UserRealmUpgradesDoc | null>(null);

  const seasonId = useMemo(() => getDefaultSeasonId(), []);

  async function load() {
    if (!uid) return;
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const s = await ensureBattlePassSeason(seasonId);
      await ensureUserInventory(uid);
      await ensureUserRealmState(uid);
      await ensureQuestsForToday(uid, seasonId);
      await ensureUserDrops(uid);
      await ensureUserExpeditionState(uid);
      await ensureUserRealmUpgrades(uid);
      const [p, i] = await Promise.all([
        ensureUserBattlePassProgress(uid, seasonId),
        getUserInventory(uid),
      ]);
      const r = await getUserRealmState(uid);
      const d = await getUserDrops(uid);
      const cs = await canClaimWeeklyCrate(uid, seasonId);

      const es = await getUserExpeditionState(uid);
      const eDoc = es?.activeExpeditionId ? await getExpedition(es.activeExpeditionId) : null;
      const ru = await getUserRealmUpgrades(uid);
      setSeason(s);
      setProgress(p);
      setInv(i);
      setRealm(r);
      setDrops(d);
      setCrateStatus(cs);

      setExpState(es);
      setExp(eDoc);
      setRealmUp(ru);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to load Emporium');
    } finally {
      setLoading(false);
    }
  }

  async function handlePurchaseUpgrade(upgradeId: RealmUpgradeId) {
    if (!uid) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await ensureUserRealmUpgrades(uid);
      await purchaseRealmUpgrade(uid, upgradeId);
      await load();
      setStatus('✅ Upgrade purchased');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to purchase upgrade');
    } finally {
      setSaving(false);
    }
  }

  async function handleClaimWeeklyCrate() {
    if (!uid) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const mode = realm?.mode ?? 'cozy';
      const kind: WeeklyCrateKind = mode === 'competitive' ? 'competitive' : mode === 'scholar' ? 'scholar' : 'builder';
      await claimWeeklyCrate(uid, seasonId, kind);
      await load();
      setStatus('✅ Weekly crate claimed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to claim crate');
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateExpedition() {
    if (!uid || !userData) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const realmId = realm?.selectedRealmId ?? 'renaissance';
      await createExpedition({ uid, username: userData.username, seasonId, realmId });
      await load();
      setStatus('✅ Expedition created');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to create expedition');
    } finally {
      setSaving(false);
    }
  }

  async function handleJoinExpedition() {
    if (!uid || !userData) return;
    const code = joinCode.trim();
    if (!code) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await joinExpeditionByCode({ uid, username: userData.username, code });
      setJoinCode('');
      await load();
      setStatus('✅ Joined expedition');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to join expedition');
    } finally {
      setSaving(false);
    }
  }

  async function handleLeaveExpedition() {
    if (!uid) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await leaveActiveExpedition(uid);
      await load();
      setStatus('✅ Left expedition');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to leave expedition');
    } finally {
      setSaving(false);
    }
  }

  async function handleClaimExpeditionReward() {
    if (!uid || !exp) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await claimExpeditionReward(uid, exp.id);
      await load();
      setStatus('✅ Expedition reward claimed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to claim reward');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const tier = useMemo(() => {
    if (!season || !progress) return 1;
    return computeTierFromEnergy(progress.energyXp, season.energyPerTier);
  }, [season, progress]);

  async function upgradePremium() {
    if (!uid || !season || !inv) return;
    if (progress?.premiumActive) return;
    if (inv.credits < season.premiumPriceCredits) {
      setErr('Not enough Credits to upgrade.');
      return;
    }

    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await addCredits(uid, -season.premiumPriceCredits);
      await setBattlePassPremium(uid, seasonId, true);
      await load();
      setStatus('✅ Premium unlocked');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to upgrade');
    } finally {
      setSaving(false);
    }
  }

  function renderQuestSection(label: string, qs: UserQuest[]) {
    const items = Array.isArray(qs) ? qs : [];
    if (items.length === 0) return null;
    return (
      <div style={{ marginTop: 12 }}>
        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 1000, textTransform: 'uppercase', letterSpacing: 1 }}>
          {label}
        </div>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((q) => {
            const target = Math.max(1, Math.floor(q.requirement?.target ?? 1));
            const prog = Math.max(0, Math.min(target, Math.floor(q.progress ?? 0)));
            const pct = Math.min(100, (prog / target) * 100);
            const done = !!q.completedAt;
            const claimed = !!q.claimedAt;
            const rewardLabel = q.reward?.name ?? 'Reward';
            return (
              <div key={q.id} style={{ border: '1px solid #334155', borderRadius: 12, padding: 10, background: 'rgba(15,23,42,0.55)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div>
                    <div style={{ color: 'white', fontSize: 12, fontWeight: 1000 }}>{q.title}</div>
                    <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>{q.description}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: done ? '#34d399' : '#60a5fa', fontSize: 12, fontWeight: 1000 }}>
                      {prog}/{target}
                    </div>
                    <div style={{ color: claimed ? '#34d399' : '#fbbf24', fontSize: 11, fontWeight: 1000, marginTop: 2 }}>
                      {claimed ? 'Claimed' : done ? 'Claiming…' : rewardLabel}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 8, height: 8, borderRadius: 999, background: '#0b1220', border: '1px solid #1f2a44', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: done ? 'linear-gradient(90deg, #34d399, #60a5fa)' : 'linear-gradient(90deg, #60a5fa, #a78bfa)', transition: 'width 0.3s ease' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  async function claimTier(which: 'free' | 'premium', t: number) {
    if (!uid || !season || !progress) return;
    if (t > tier) {
      setErr('Tier not unlocked yet');
      return;
    }

    const already = which === 'free'
      ? progress.claimedFreeTiers.includes(t)
      : progress.claimedPremiumTiers.includes(t);
    if (already) return;

    if (which === 'premium' && !progress.premiumActive) {
      setErr('Premium required for this reward');
      return;
    }

    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const r = findTierReward(season, t);
      const reward = which === 'free' ? r.free : r.premium;
      if (!reward) throw new Error('Reward missing');
      await Promise.all([
        grantReward(uid, seasonId, reward),
        which === 'free' ? markClaimedFreeTier(uid, seasonId, t) : markClaimedPremiumTier(uid, seasonId, t),
      ]);
      await load();
      setStatus(`✅ Claimed Tier ${t} (${which})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to claim');
    } finally {
      setSaving(false);
    }
  }

  async function openRoom() {
    if (!uid) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await ensureProfileRoom(uid);
      setTab('room');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to open room');
    } finally {
      setSaving(false);
    }
  }

  if (!uid || !userData) return null;

  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'season', label: 'Quantum Codex', icon: '📘' },
    { id: 'realms', label: 'Realms', icon: '🧭' },
    { id: 'legacy', label: 'Legacy', icon: '🧾' },
    { id: 'cosmetics', label: 'Cosmetics', icon: '🎨' },
    { id: 'inventory', label: 'Inventory', icon: '🎒' },
    { id: 'room', label: 'Room', icon: '🧪' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 12, padding: 12, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: 'white', fontWeight: 1000, fontSize: 16 }}>🏪 Emporium</div>
          <div style={{ color: '#64748b', fontSize: 12, fontWeight: 800 }}>Quantum Codex + Inventory + Room</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ color: '#eab308', fontWeight: 1000, fontSize: 12 }}>Credits: {inv?.credits ?? 0}</div>
          <div style={{ color: '#60a5fa', fontWeight: 1000, fontSize: 12 }}>Insight: {inv?.insight ?? 0}</div>
          <div style={{ color: '#34d399', fontWeight: 1000, fontSize: 12 }}>Coins: {inv?.chronoCoins ?? 0}</div>
          <div style={{ color: '#fbbf24', fontWeight: 1000, fontSize: 12 }}>Relics: {inv?.relics ?? 0}</div>
          <button onClick={() => void load()} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>↺ Refresh</button>
        </div>
      </div>

      {err && <div style={{ color: '#fca5a5', fontSize: 12 }}>{err}</div>}
      {status && <div style={{ color: '#34d399', fontSize: 12 }}>{status}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              className="ll-btn"
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 12px',
                fontSize: 12,
                borderRadius: 999,
                background: active ? 'rgba(59,130,246,0.18)' : 'rgba(15,23,42,0.55)',
                border: active ? '1px solid rgba(59,130,246,0.55)' : '1px solid #334155',
                color: active ? '#bfdbfe' : 'white',
                fontWeight: 1000,
              }}
            >
              {t.icon} {t.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading ? (
          <div style={{ color: '#94a3b8', padding: 10 }}>Loading…</div>
        ) : tab === 'season' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>{season?.title ?? 'Quantum Codex'}</div>
                  <div style={{ color: '#64748b', fontSize: 12, fontWeight: 900 }}>
                    Tier {tier} / 100
                    {realm?.selectedRealmId ? ` · ${REALM_META[realm.selectedRealmId].name}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button onClick={openRoom} disabled={saving} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>🧪 Room</button>
                  <button onClick={upgradePremium} disabled={saving || !!progress?.premiumActive} className="ll-btn ll-btn-primary" style={{ padding: '7px 12px', fontSize: 12 }}>
                    {progress?.premiumActive ? 'Premium Active' : `Upgrade (${season?.premiumPriceCredits ?? 0} Credits)`}
                  </button>
                </div>
              </div>
              <div style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>
                Energy XP: {progress?.energyXp ?? 0}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {[...Array(12)].map((_, i) => {
                const t = Math.max(1, tier - 2) + i;
                if (t > 100) return null;
                const unlocked = t <= tier;
                const freeClaimed = !!progress?.claimedFreeTiers.includes(t);
                const premClaimed = !!progress?.claimedPremiumTiers.includes(t);
                const r = season ? findTierReward(season, t) : { free: undefined, premium: undefined };
                return (
                  <div key={t} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>Tier {t}</div>
                      <div style={{ color: unlocked ? '#34d399' : '#64748b', fontSize: 11, fontWeight: 900 }}>
                        {unlocked ? 'Unlocked' : 'Locked'}
                      </div>
                    </div>

                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 8, background: 'rgba(30,41,59,0.35)' }}>
                        <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900 }}>FREE</div>
                        <div style={{ color: 'white', fontSize: 12, fontWeight: 900, marginTop: 4 }}>{r.free?.name ?? '—'}</div>
                        <button
                          onClick={() => void claimTier('free', t)}
                          disabled={!unlocked || freeClaimed || saving}
                          className="ll-btn"
                          style={{ width: '100%', marginTop: 8, padding: '7px 10px', fontSize: 12 }}
                        >
                          {freeClaimed ? 'Claimed' : 'Claim'}
                        </button>
                      </div>

                      <div style={{ border: '1px solid rgba(168,85,247,0.45)', borderRadius: 10, padding: 8, background: 'rgba(168,85,247,0.08)' }}>
                        <div style={{ color: '#c4b5fd', fontSize: 10, fontWeight: 900 }}>PREMIUM</div>
                        <div style={{ color: 'white', fontSize: 12, fontWeight: 900, marginTop: 4 }}>{r.premium?.name ?? '—'}</div>
                        <button
                          onClick={() => void claimTier('premium', t)}
                          disabled={!unlocked || premClaimed || saving || !progress?.premiumActive}
                          className="ll-btn"
                          style={{ width: '100%', marginTop: 8, padding: '7px 10px', fontSize: 12 }}
                        >
                          {premClaimed ? 'Claimed' : progress?.premiumActive ? 'Claim' : 'Locked'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {userData.role === 'superadmin' && (
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
                <div style={{ color: 'white', fontWeight: 1000, fontSize: 13, marginBottom: 8 }}>Dev Tools</div>
                <button
                  onClick={async () => {
                    const amtRaw = window.prompt('Grant credits amount', '500') ?? '';
                    const amt = Number(amtRaw);
                    if (!Number.isFinite(amt)) return;
                    setSaving(true);
                    setErr(null);
                    setStatus(null);
                    try {
                      await ensureUserInventory(uid);
                      await addCredits(uid, Math.max(0, Math.floor(amt)));
                      await load();
                      setStatus('✅ Credits granted');
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      setErr(msg || 'Failed to grant');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  className="ll-btn"
                  style={{ padding: '7px 12px', fontSize: 12 }}
                >
                  Grant Credits
                </button>
              </div>
            )}
          </div>
        ) : tab === 'realms' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>🧭 Realms</div>
              <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                Switch anytime. Your tier progress stays global across all books.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {(Object.keys(REALM_META) as RealmId[]).map((rid) => {
                const active = realm?.selectedRealmId === rid;
                const m = REALM_META[rid];
                return (
                  <button
                    key={rid}
                    className="ll-btn"
                    disabled={saving}
                    onClick={async () => {
                      if (!uid) return;
                      setSaving(true);
                      setErr(null);
                      setStatus(null);
                      try {
                        await ensureUserRealmState(uid);
                        await setSelectedRealm(uid, rid);
                        await load();
                        setStatus(`✅ Realm set: ${m.name}`);
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e);
                        setErr(msg || 'Failed to set realm');
                      } finally {
                        setSaving(false);
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      padding: 12,
                      borderRadius: 14,
                      border: active ? '1px solid rgba(59,130,246,0.65)' : '1px solid #334155',
                      background: active ? m.gradient : 'rgba(15,23,42,0.55)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ color: 'white', fontWeight: 1000, fontSize: 13 }}>{m.icon} {m.name}</div>
                      <div style={{ color: active ? '#34d399' : '#64748b', fontWeight: 1000, fontSize: 11 }}>
                        {active ? 'Selected' : 'Select'}
                      </div>
                    </div>
                    <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12, fontWeight: 800 }}>{m.subtitle}</div>
                  </button>
                );
              })}
            </div>

            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 13 }}>Mode</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {MODE_META.map((mm) => {
                  const active = realm?.mode === mm.id;
                  return (
                    <button
                      key={mm.id}
                      className="ll-btn"
                      disabled={saving}
                      onClick={async () => {
                        if (!uid) return;
                        setSaving(true);
                        setErr(null);
                        setStatus(null);
                        try {
                          await ensureUserRealmState(uid);
                          await setRealmMode(uid, mm.id);
                          await load();
                          setStatus(`✅ Mode set: ${mm.label}`);
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : String(e);
                          setErr(msg || 'Failed to set mode');
                        } finally {
                          setSaving(false);
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 999,
                        border: active ? '1px solid rgba(168,85,247,0.60)' : '1px solid #334155',
                        background: active ? 'rgba(168,85,247,0.12)' : 'rgba(30,41,59,0.35)',
                        color: active ? '#ddd6fe' : 'white',
                        fontWeight: 1000,
                        fontSize: 12,
                      }}
                      title={mm.desc}
                    >
                      {mm.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>
                {realm?.mode
                  ? MODE_META.find((x) => x.id === realm.mode)?.desc
                  : 'Pick a mode to shape the vibe (progress stays the same).'
                }
              </div>
              {realm?.mode === 'competitive' && (
                <div style={{ marginTop: 10, color: '#fbbf24', fontSize: 12, fontWeight: 900 }}>
                  Competitive is opt-in. Duels/leaderboards will be added later.
                </div>
              )}
            </div>

            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Tasks</div>
              <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                These update automatically as you solve.
              </div>

              {renderQuestSection('Daily', (progress?.dailyQuests ?? []) as UserQuest[])}
              {renderQuestSection('Weekly', (progress?.weeklyQuests ?? []) as UserQuest[])}
              {renderQuestSection('Contracts', (progress?.contracts ?? []) as UserQuest[])}
            </div>

            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Realm Upgrades</div>
              <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                Spend Chrono Coins to improve your outpost modules. (Effects will be expanded later.)
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {upgradesForRealm(realm?.selectedRealmId ?? 'renaissance').map((u) => {
                  const purchased = (realmUp?.purchased ?? []).includes(u.id);
                  const lockedByReq = u.requires ? !(realmUp?.purchased ?? []).includes(u.requires) : false;
                  const afford = (inv?.chronoCoins ?? 0) >= u.costCoins;
                  return (
                    <div key={u.id} style={{ border: '1px solid #334155', borderRadius: 12, padding: 10, background: 'rgba(30,41,59,0.35)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                        <div>
                          <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>{u.name}</div>
                          <div style={{ marginTop: 2, color: '#94a3b8', fontSize: 12 }}>{u.description}</div>
                          <div style={{ marginTop: 6, color: '#64748b', fontSize: 12 }}>
                            Cost: {u.costCoins} Coins
                            {u.requires ? ` · Requires: ${u.requires}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                          <div style={{ color: purchased ? '#34d399' : '#60a5fa', fontWeight: 1000, fontSize: 12 }}>
                            {purchased ? 'Owned' : 'Available'}
                          </div>
                          <button
                            className="ll-btn"
                            disabled={saving || purchased || lockedByReq || !afford}
                            onClick={() => void handlePurchaseUpgrade(u.id)}
                            style={{ padding: '8px 12px', fontSize: 12, fontWeight: 1000 }}
                            title={
                              purchased ? 'Already purchased'
                                : lockedByReq ? 'Buy the previous upgrade first'
                                  : !afford ? 'Not enough Chrono Coins'
                                    : 'Purchase'
                            }
                          >
                            {purchased ? 'Purchased' : lockedByReq ? 'Locked' : 'Buy'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Expedition (Co-op)</div>
                  <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 12 }}>
                    Solve together to fill the bar and earn a team reward.
                  </div>
                </div>
              </div>

              {exp ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <div style={{ color: 'white', fontWeight: 1000, fontSize: 12 }}>
                      Code: <span style={{ color: '#bfdbfe' }}>{exp.code}</span>
                    </div>
                    <div style={{ color: exp.status === 'completed' ? '#34d399' : '#60a5fa', fontWeight: 1000, fontSize: 12 }}>
                      {exp.status.toUpperCase()}
                    </div>
                  </div>

                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 12 }}>
                    <span>Progress</span>
                    <span>{exp.progress}/{exp.target}</span>
                  </div>
                  <div style={{ marginTop: 6, height: 10, borderRadius: 999, background: '#0b1220', border: '1px solid #1f2a44', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (exp.progress / Math.max(1, exp.target)) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #60a5fa, #a78bfa)', transition: 'width 0.3s ease' }} />
                  </div>

                  <div style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>
                    Members: {(exp.members ?? []).map((m) => m.username).join(', ') || '—'}
                  </div>

                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="ll-btn" disabled={saving} onClick={() => void handleLeaveExpedition()} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 1000 }}>
                      Leave
                    </button>
                    <button
                      className="ll-btn ll-btn-primary"
                      disabled={saving || exp.status !== 'completed'}
                      onClick={() => void handleClaimExpeditionReward()}
                      style={{ padding: '8px 12px', fontSize: 12, fontWeight: 1000 }}
                    >
                      Claim Reward
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="ll-btn ll-btn-primary" disabled={saving} onClick={() => void handleCreateExpedition()} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 1000 }}>
                      Create Expedition
                    </button>
                    <button className="ll-btn" disabled={saving} onClick={() => { void handleJoinExpedition(); }} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 1000 }}>
                      Join
                    </button>
                  </div>
                  <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="Enter code (e.g. A1B2C3)"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid #334155',
                      background: 'rgba(15,23,42,0.55)',
                      color: 'white',
                      outline: 'none',
                      fontSize: 12,
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              )}
            </div>

            <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Weekly Crate</div>
                  <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 12 }}>
                    Complete your weekly tasks to unlock a realm-themed reward.
                  </div>
                </div>
                <button
                  className="ll-btn ll-btn-primary"
                  disabled={saving || loading || !crateStatus?.ok}
                  onClick={() => void handleClaimWeeklyCrate()}
                  style={{ padding: '8px 12px', fontSize: 12, fontWeight: 1000 }}
                  title={crateStatus?.ok ? 'Claim your weekly crate' : (crateStatus?.reason ?? 'Locked')}
                >
                  {crateStatus?.ok ? 'Claim' : 'Locked'}
                </button>
              </div>

              {!crateStatus?.ok && (
                <div style={{ marginTop: 10, color: '#64748b', fontSize: 12 }}>
                  {crateStatus?.reason ?? 'Complete your weekly tasks to unlock.'}
                </div>
              )}

              {drops?.lastWeeklyCrate && (
                <div style={{ marginTop: 12, borderTop: '1px solid #334155', paddingTop: 12 }}>
                  <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 1000, textTransform: 'uppercase', letterSpacing: 1 }}>Last crate</div>
                  <div style={{ marginTop: 6, color: 'white', fontSize: 12, fontWeight: 1000 }}>
                    {drops.lastWeeklyCrate.rewardName}
                  </div>
                  <div style={{ marginTop: 4, color: drops.lastWeeklyCrate.duplicate ? '#fbbf24' : '#34d399', fontSize: 12, fontWeight: 900 }}>
                    {drops.lastWeeklyCrate.duplicate ? 'Duplicate → converted to Relics + Coins' : 'New unlock'}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : tab === 'inventory' ? (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
            <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Inventory</div>
            <div style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>Credits: {inv?.credits ?? 0}</div>
            <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>Insight: {inv?.insight ?? 0}</div>
            <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>Chrono Coins: {inv?.chronoCoins ?? 0}</div>
            <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>Relics: {inv?.relics ?? 0}</div>

            <div style={{ marginTop: 12, borderTop: '1px solid #334155', paddingTop: 12 }}>
              <div style={{ color: 'white', fontWeight: 1000, fontSize: 13 }}>Profile Titles</div>
              <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                Equipped: {inv?.equipped?.title ? inv.equipped.title : '—'}
              </div>

              {(!inv || inv.owned.titles.length === 0) ? (
                <div style={{ marginTop: 10, color: '#64748b', fontSize: 12 }}>No titles owned yet. Claim some tiers that grant titles.</div>
              ) : (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {inv.owned.titles.slice().sort().map((t) => {
                    const equipped = inv.equipped?.title === t;
                    return (
                      <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ flex: 1, color: 'white', fontWeight: 900, fontSize: 12, padding: '10px 10px', borderRadius: 12, border: '1px solid #334155', background: 'rgba(15,23,42,0.55)' }}>
                          {t}
                        </div>
                        <button
                          className="ll-btn"
                          disabled={saving}
                          onClick={async () => {
                            if (!uid) return;
                            setSaving(true);
                            setErr(null);
                            setStatus(null);
                            try {
                              await equipInventory(uid, { title: equipped ? undefined : t });
                              await load();
                              setStatus(equipped ? '✅ Unequipped' : '✅ Equipped');
                            } catch (e) {
                              const msg = e instanceof Error ? e.message : String(e);
                              setErr(msg || 'Failed to equip');
                            } finally {
                              setSaving(false);
                            }
                          }}
                          style={{ padding: '8px 12px', fontSize: 12, fontWeight: 1000 }}
                        >
                          {equipped ? 'Unequip' : 'Equip'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : tab === 'room' ? (
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
            <div style={{ color: 'white', fontWeight: 1000, fontSize: 14 }}>Profile Room</div>
            <div style={{ marginTop: 8, color: '#94a3b8', fontSize: 12 }}>
              v1 foundation: your room is initialized in Firestore. Interactive/3D upgrades come later.
            </div>
            <div style={{ marginTop: 12, height: 240, borderRadius: 12, border: '1px solid #334155', background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(168,85,247,0.08))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontWeight: 900 }}>
              Room Preview Placeholder
            </div>
          </div>
        ) : (
          <div style={{ color: '#94a3b8', padding: 10 }}>Coming soon.</div>
        )}
      </div>
    </div>
  );
}
