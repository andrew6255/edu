import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import type { UserDropsDoc, WeeklyCrateKind } from '@/types/drops';
import type { RealmId } from '@/types/realms';
import { getUserRealmState } from '@/lib/realmService';
import { ensureUserInventory, getUserInventory, addOwnedTitle, addRelics, addChronoCoins } from '@/lib/inventoryService';
import { getUserBattlePassProgress } from '@/lib/battlePassService';

function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function pickFrom<T>(arr: T[], seed: number): T {
  if (arr.length === 0) throw new Error('Empty drop table');
  const idx = Math.abs(seed) % arr.length;
  return arr[idx];
}

function titlePoolForRealm(realmId: RealmId): Array<{ id: string; name: string }> {
  if (realmId === 'renaissance') {
    return [
      { id: 'title_blueprint_bard', name: 'Title: Blueprint Bard' },
      { id: 'title_sketchsmith', name: 'Title: Sketchsmith' },
      { id: 'title_workshop_wonder', name: 'Title: Workshop Wonder' },
    ];
  }
  if (realmId === 'industrial') {
    return [
      { id: 'title_gearwright', name: 'Title: Gearwright' },
      { id: 'title_foundry_foreman', name: 'Title: Foundry Foreman' },
      { id: 'title_precision_engineer', name: 'Title: Precision Engineer' },
    ];
  }
  return [
    { id: 'title_signal_hunter', name: 'Title: Signal Hunter' },
    { id: 'title_orbital_analyst', name: 'Title: Orbital Analyst' },
    { id: 'title_anomaly_runner', name: 'Title: Anomaly Runner' },
  ];
}

export async function getUserDrops(uid: string): Promise<UserDropsDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'drops', 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<UserDropsDoc>;
  return {
    id: 'global',
    weeklyKey: typeof (data as any).weeklyKey === 'string' ? ((data as any).weeklyKey as string) : undefined,
    weeklyCrateClaimedKey: typeof (data as any).weeklyCrateClaimedKey === 'string' ? ((data as any).weeklyCrateClaimedKey as string) : undefined,
    lastWeeklyCrate: (data as any).lastWeeklyCrate,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureUserDrops(uid: string): Promise<UserDropsDoc> {
  const existing = await getUserDrops(uid);
  if (existing) return existing;
  const init: UserDropsDoc = {
    id: 'global',
    weeklyKey: isoWeekKey(new Date()),
    updatedAt: new Date().toISOString(),
  };

  // Firestore does not allow undefined values in setDoc.
  await setDoc(doc(db, 'users', uid, 'drops', 'global'), {
    id: init.id,
    weeklyKey: init.weeklyKey,
    weeklyCrateClaimedKey: null,
    lastWeeklyCrate: null,
    updatedAt: init.updatedAt,
  } as any);

  return init;
}

export async function canClaimWeeklyCrate(uid: string, seasonId: string): Promise<{ ok: boolean; reason?: string; weekKey: string }> {
  const weekKey = isoWeekKey(new Date());
  const drops = await ensureUserDrops(uid);
  if (drops.weeklyCrateClaimedKey === weekKey) return { ok: false, reason: 'Already claimed this week', weekKey };

  const bp = await getUserBattlePassProgress(uid, seasonId);
  const weekly = Array.isArray((bp as any)?.weeklyQuests) ? ((bp as any).weeklyQuests as any[]) : [];
  if (weekly.length === 0) return { ok: false, reason: 'No weekly quests yet', weekKey };

  // v1 rule: all weekly quests must be completed.
  const done = weekly.every((q) => !!q.completedAt);
  if (!done) return { ok: false, reason: 'Complete your weekly tasks to unlock the crate', weekKey };

  return { ok: true, weekKey };
}

export async function claimWeeklyCrate(uid: string, seasonId: string, kind: WeeklyCrateKind): Promise<void> {
  await ensureUserInventory(uid);
  await ensureUserDrops(uid);

  const realm = await getUserRealmState(uid);
  const realmId: RealmId = realm?.selectedRealmId ?? 'renaissance';
  const weekKey = isoWeekKey(new Date());

  const eligible = await canClaimWeeklyCrate(uid, seasonId);
  if (!eligible.ok) throw new Error(eligible.reason || 'Not eligible');

  // Reserve claim in transaction to avoid double claim.
  const dropsRef = doc(db, 'users', uid, 'drops', 'global');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(dropsRef);
    if (!snap.exists()) return;
    const data = snap.data() as Partial<UserDropsDoc>;
    const claimedKey = (data as any).weeklyCrateClaimedKey;
    if (claimedKey === weekKey) throw new Error('Already claimed this week');
    tx.update(dropsRef, {
      weeklyKey: weekKey,
      weeklyCrateClaimedKey: weekKey,
      updatedAt: new Date().toISOString(),
    });
  });

  // Determine reward.
  const inv = await getUserInventory(uid);
  const ownedTitles = inv?.owned?.titles ?? [];
  const pool = titlePoolForRealm(realmId);
  const seed = Date.now();
  const picked = pickFrom(pool, seed);

  const duplicate = ownedTitles.includes(picked.id);
  if (duplicate) {
    await Promise.all([
      addRelics(uid, 1),
      addChronoCoins(uid, 50),
    ]);
  } else {
    await addOwnedTitle(uid, picked.id);
  }

  // Record last drop.
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(dropsRef);
    if (!snap.exists()) return;
    tx.update(dropsRef, {
      lastWeeklyCrate: {
        key: weekKey,
        kind,
        realmId,
        rewardId: picked.id,
        rewardName: picked.name,
        duplicate,
        claimedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    } as any);
  });
}
