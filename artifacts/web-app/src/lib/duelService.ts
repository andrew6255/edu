import { db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  getDocs,
  increment,
} from 'firebase/firestore';
import type { DuelDoc, DuelPlayer, UserDuelStateDoc } from '@/types/duels';
import type { RealmId } from '@/types/realms';
import { ensureUserInventory } from '@/lib/inventoryService';
import { grantReward } from '@/lib/battlePassRewards';

function nowIso(): string {
  return new Date().toISOString();
}

function plusHoursIso(h: number): string {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function getUserDuelState(uid: string): Promise<UserDuelStateDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'duel_state', 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<UserDuelStateDoc>;

  const recentDuelIds = Array.isArray((data as any).recentDuelIds) ? ((data as any).recentDuelIds as unknown[]).filter((x) => typeof x === 'string') as string[] : undefined;
  const lastScoreAtByDuelIdRaw = (data as any).lastScoreAtByDuelId;
  const lastScoreAtByDuelId = lastScoreAtByDuelIdRaw && typeof lastScoreAtByDuelIdRaw === 'object' ? (lastScoreAtByDuelIdRaw as Record<string, unknown>) : undefined;
  const lastScoreAtByDuelIdSanitized: Record<string, string> | undefined = lastScoreAtByDuelId
    ? (Object.fromEntries(Object.entries(lastScoreAtByDuelId).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')) as Record<string, string>)
    : undefined;

  return {
    id: 'global',
    activeDuelId: typeof (data as any).activeDuelId === 'string' ? ((data as any).activeDuelId as string) : undefined,
    recentDuelIds,
    lastScoreAtByDuelId: lastScoreAtByDuelIdSanitized,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
  };
}

export async function ensureUserDuelState(uid: string): Promise<UserDuelStateDoc> {
  const existing = await getUserDuelState(uid);
  if (existing) return existing;
  const init: UserDuelStateDoc = { id: 'global', updatedAt: nowIso(), recentDuelIds: [], lastScoreAtByDuelId: {} };
  await setDoc(doc(db, 'users', uid, 'duel_state', 'global'), {
    id: init.id,
    activeDuelId: null,
    recentDuelIds: [],
    lastScoreAtByDuelId: {},
    updatedAt: init.updatedAt,
  } as any);
  return init;
}

function clampRecent(ids: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

export async function recordRecentDuel(uid: string, duelId: string): Promise<void> {
  await ensureUserDuelState(uid);
  const stRef = doc(db, 'users', uid, 'duel_state', 'global');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(stRef);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const recent: string[] = Array.isArray(data.recentDuelIds) ? (data.recentDuelIds as string[]) : [];
    const next = clampRecent([duelId, ...recent], 12);
    tx.update(stRef, { recentDuelIds: next, updatedAt: nowIso() } as any);
  });
}

export async function listRecentDuels(uid: string): Promise<DuelDoc[]> {
  await ensureUserDuelState(uid);
  const st = await getUserDuelState(uid);
  const ids = (st?.recentDuelIds ?? []).slice(0, 12);
  const docs = await Promise.all(ids.map((id) => getDuel(id).catch(() => null)));
  return docs.filter(Boolean) as DuelDoc[];
}

export async function setActiveDuelId(uid: string, duelId: string | undefined): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'duel_state', 'global'), {
    activeDuelId: duelId ?? null,
    updatedAt: nowIso(),
  } as any);
}

export async function getDuel(duelId: string): Promise<DuelDoc | null> {
  const snap = await getDoc(doc(db, 'duels', duelId));
  if (!snap.exists()) return null;
  return { id: duelId, ...(snap.data() as any) } as DuelDoc;
}

export async function findDuelByCode(code: string): Promise<DuelDoc | null> {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const q0 = query(collection(db, 'duels'), where('code', '==', c));
  const snaps = await getDocs(q0);
  const first = snaps.docs[0];
  if (!first) return null;
  return { id: first.id, ...(first.data() as any) } as DuelDoc;
}

export async function createDuel(opts: {
  uid: string;
  username: string;
  seasonId: string;
  realmId: RealmId;
}): Promise<DuelDoc> {
  await ensureUserDuelState(opts.uid);

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const duelId = `${code}_${Date.now()}`;
    const ref = doc(db, 'duels', duelId);

    const host: DuelPlayer = { uid: opts.uid, username: opts.username };
    const init: Omit<DuelDoc, 'id'> = {
      code,
      seasonId: opts.seasonId,
      realmId: opts.realmId,
      createdAt: nowIso(),
      expiresAt: plusHoursIso(24),
      status: 'active',

      participantUids: [opts.uid],

      host,
      guest: null,
      hostScore: 0,
      guestScore: 0,
      completedAt: null,
      rewardClaimedByUids: [],
    };

    try {
      await setDoc(ref, init);
      await setActiveDuelId(opts.uid, duelId);
      return { id: duelId, ...init };
    } catch {
      // retry
    }
  }

  throw new Error('Failed to create duel');
}

export async function joinDuelByCode(opts: {
  uid: string;
  username: string;
  code: string;
}): Promise<DuelDoc> {
  await ensureUserDuelState(opts.uid);
  const duel = await findDuelByCode(opts.code);
  if (!duel) throw new Error('Invalid duel code');

  const ref = doc(db, 'duels', duel.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Duel missing');
    const data = snap.data() as any;

    const status = (data.status ?? 'active') as string;
    if (status !== 'active') throw new Error('Duel not active');

    const expiresAt = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : 0;
    if (expiresAt && Date.now() > expiresAt) {
      tx.update(ref, { status: 'expired', completedAt: nowIso() } as any);
      throw new Error('Duel expired');
    }

    const hostUid = data.host?.uid;
    const guestUid = data.guest?.uid;
    const participantUids = Array.isArray(data.participantUids)
      ? (data.participantUids as string[])
      : [hostUid, guestUid].filter(Boolean);

    if (hostUid === opts.uid) return;
    if (guestUid === opts.uid) return;
    if (data.guest != null && data.guest.uid) throw new Error('Duel already has a guest');

    tx.update(ref, {
      guest: { uid: opts.uid, username: opts.username },
      participantUids: Array.from(new Set([...(participantUids as string[]), opts.uid])),
    } as any);
  });

  await setActiveDuelId(opts.uid, duel.id);
  const next = await getDuel(duel.id);
  if (!next) throw new Error('Failed to join');
  return next;
}

export async function leaveActiveDuel(uid: string): Promise<void> {
  await ensureUserDuelState(uid);
  const st = await getUserDuelState(uid);
  if (!st?.activeDuelId) return;
  await recordRecentDuel(uid, st.activeDuelId).catch(() => {});
  await setActiveDuelId(uid, undefined);
}

export async function applySolveToActiveDuel(uid: string, seasonId: string): Promise<void> {
  await ensureUserDuelState(uid);
  const st = await getUserDuelState(uid);
  if (!st?.activeDuelId) return;

  const duelId = st.activeDuelId;
  const ref = doc(db, 'duels', duelId);

  // Minimal anti-spam: only score once per 8 seconds per user per duel.
  // This is client-enforced (rules do not validate timestamps).
  const rateLimitMs = 8000;
  const stRef = doc(db, 'users', uid, 'duel_state', 'global');

  await runTransaction(db, async (tx) => {
    const stSnap = await tx.get(stRef);
    if (stSnap.exists()) {
      const stData = stSnap.data() as any;
      const lastBy: Record<string, string> = stData.lastScoreAtByDuelId && typeof stData.lastScoreAtByDuelId === 'object' ? stData.lastScoreAtByDuelId : {};
      const lastIso = typeof lastBy[duelId] === 'string' ? lastBy[duelId] : undefined;
      const lastMs = lastIso ? Date.parse(lastIso) : 0;
      if (lastMs && Date.now() - lastMs < rateLimitMs) return;
      tx.update(stRef, { lastScoreAtByDuelId: { ...lastBy, [duelId]: nowIso() }, updatedAt: nowIso() } as any);
    }

    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;

    if (data.seasonId !== seasonId) return;
    if (data.status !== 'active') return;

    const expiresAt = typeof data.expiresAt === 'string' ? Date.parse(data.expiresAt) : 0;
    if (expiresAt && Date.now() > expiresAt) {
      tx.update(ref, { status: 'expired', completedAt: nowIso() } as any);
      return;
    }

    const hostUid = data.host?.uid;
    const guestUid = data.guest?.uid;

    if (uid === hostUid) {
      tx.update(ref, { hostScore: increment(1) } as any);
    } else if (uid === guestUid) {
      tx.update(ref, { guestScore: increment(1) } as any);
    }

    // Auto-complete if both players have joined and one reaches 25
    const hostScore = (typeof data.hostScore === 'number' ? data.hostScore : 0) + (uid === hostUid ? 1 : 0);
    const guestScore = (typeof data.guestScore === 'number' ? data.guestScore : 0) + (uid === guestUid ? 1 : 0);
    const hasGuest = !!guestUid;
    if (hasGuest && (hostScore >= 25 || guestScore >= 25)) {
      tx.update(ref, { status: 'completed', completedAt: nowIso() } as any);
    }
  });

  // Best-effort: keep a local recent history.
  await recordRecentDuel(uid, duelId).catch(() => {});
}

export async function claimDuelReward(uid: string, duelId: string): Promise<void> {
  await ensureUserInventory(uid);
  const ref = doc(db, 'duels', duelId);

  const outcome = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Duel missing');
    const data = snap.data() as any;

    if (data.status !== 'completed' && data.status !== 'expired') throw new Error('Duel not finished');

    const claimed: string[] = Array.isArray(data.rewardClaimedByUids) ? data.rewardClaimedByUids : [];
    if (claimed.includes(uid)) return;

    const hostUid = data.host?.uid;
    const guestUid = data.guest?.uid;
    const hostScore = typeof data.hostScore === 'number' ? data.hostScore : 0;
    const guestScore = typeof data.guestScore === 'number' ? data.guestScore : 0;

    if (uid !== hostUid && uid !== guestUid) throw new Error('Not a participant');

    let win: 'win' | 'lose' | 'draw' = 'draw';
    if (hostScore > guestScore) win = uid === hostUid ? 'win' : 'lose';
    else if (guestScore > hostScore) win = uid === guestUid ? 'win' : 'lose';
    else win = 'draw';

    tx.update(ref, { rewardClaimedByUids: [...claimed, uid] } as any);

    return win;
  });

  await recordRecentDuel(uid, duelId).catch(() => {});

  const baseId = `duel_${duelId}_${uid}`;
  if (outcome === 'win') {
    await Promise.all([
      grantReward(uid, 'qc_s1', { id: baseId + '_coins', type: 'currency', name: '+200 Chrono Coins', payload: { kind: 'currency', currency: 'chrono_coins', amount: 200 } }),
      grantReward(uid, 'qc_s1', { id: baseId + '_relic', type: 'currency', name: '+2 Relics', payload: { kind: 'currency', currency: 'relics', amount: 2 } }),
    ]);
  } else if (outcome === 'lose') {
    await grantReward(uid, 'qc_s1', { id: baseId + '_coins', type: 'currency', name: '+80 Chrono Coins', payload: { kind: 'currency', currency: 'chrono_coins', amount: 80 } });
  } else {
    await grantReward(uid, 'qc_s1', { id: baseId + '_coins', type: 'currency', name: '+120 Chrono Coins', payload: { kind: 'currency', currency: 'chrono_coins', amount: 120 } });
  }
}
