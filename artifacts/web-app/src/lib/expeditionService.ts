import { db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  runTransaction,
  collection,
  query,
  where,
  getDocs,
  increment,
} from 'firebase/firestore';
import type { ExpeditionDoc, ExpeditionMember, UserExpeditionStateDoc } from '@/types/expeditions';
import type { RealmId } from '@/types/realms';
import { ensureUserInventory } from '@/lib/inventoryService';
import { grantReward } from '@/lib/battlePassRewards';

function nowIso(): string {
  return new Date().toISOString();
}

function makeCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function getUserExpeditionState(uid: string): Promise<UserExpeditionStateDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'expedition_state', 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<UserExpeditionStateDoc>;
  return {
    id: 'global',
    activeExpeditionId: typeof (data as any).activeExpeditionId === 'string' ? ((data as any).activeExpeditionId as string) : undefined,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : nowIso(),
  };
}

export async function ensureUserExpeditionState(uid: string): Promise<UserExpeditionStateDoc> {
  const existing = await getUserExpeditionState(uid);
  if (existing) return existing;
  const init: UserExpeditionStateDoc = { id: 'global', updatedAt: nowIso() };
  // Firestore does not allow undefined values in setDoc.
  await setDoc(doc(db, 'users', uid, 'expedition_state', 'global'), {
    id: init.id,
    activeExpeditionId: null,
    updatedAt: init.updatedAt,
  } as any);
  return init;
}

export async function setActiveExpeditionId(uid: string, expeditionId: string | undefined): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'expedition_state', 'global'), {
    activeExpeditionId: expeditionId ?? null,
    updatedAt: nowIso(),
  } as any);
}

export async function getExpedition(expeditionId: string): Promise<ExpeditionDoc | null> {
  const snap = await getDoc(doc(db, 'expeditions', expeditionId));
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return { id: expeditionId, ...(data as Omit<ExpeditionDoc, 'id'>) };
}

export async function findExpeditionByCode(code: string): Promise<ExpeditionDoc | null> {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  const q0 = query(collection(db, 'expeditions'), where('code', '==', c));
  const snaps = await getDocs(q0);
  const first = snaps.docs[0];
  if (!first) return null;
  return { id: first.id, ...(first.data() as any) } as ExpeditionDoc;
}

export async function createExpedition(opts: {
  uid: string;
  username: string;
  seasonId: string;
  realmId: RealmId;
}): Promise<ExpeditionDoc> {
  await ensureUserExpeditionState(opts.uid);

  // Try a few codes to avoid collisions
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode();
    const expeditionId = `${code}_${Date.now()}`;
    const ref = doc(db, 'expeditions', expeditionId);

    const member: ExpeditionMember = { uid: opts.uid, username: opts.username, joinedAt: nowIso() };
    const init: Omit<ExpeditionDoc, 'id'> = {
      code,
      realmId: opts.realmId,
      seasonId: opts.seasonId,
      createdAt: nowIso(),
      createdByUid: opts.uid,
      status: 'active',
      members: [member],
      memberUids: [opts.uid],
      progress: 0,
      target: 60,
      rewardClaimedByUids: [],
    };

    try {
      await setDoc(ref, init);
      await setActiveExpeditionId(opts.uid, expeditionId);
      return { id: expeditionId, ...init };
    } catch {
      // retry
    }
  }

  throw new Error('Failed to create expedition');
}

export async function joinExpeditionByCode(opts: {
  uid: string;
  username: string;
  code: string;
}): Promise<ExpeditionDoc> {
  await ensureUserExpeditionState(opts.uid);
  const exp = await findExpeditionByCode(opts.code);
  if (!exp) throw new Error('Invalid expedition code');

  const ref = doc(db, 'expeditions', exp.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Expedition missing');
    const data = snap.data() as ExpeditionDoc;
    if (data.status !== 'active') throw new Error('Expedition is not active');
    const members = Array.isArray((data as any).members) ? ((data as any).members as ExpeditionMember[]) : [];
    const memberUids = Array.isArray((data as any).memberUids) ? ((data as any).memberUids as string[]) : members.map((m) => m.uid);
    if (members.some((m) => m.uid === opts.uid)) return;
    if (members.length >= 6) throw new Error('Expedition is full');
    tx.update(ref, {
      members: [...members, { uid: opts.uid, username: opts.username, joinedAt: nowIso() }],
      memberUids: Array.from(new Set([...memberUids, opts.uid])),
    } as any);
  });

  await setActiveExpeditionId(opts.uid, exp.id);
  const next = await getExpedition(exp.id);
  if (!next) throw new Error('Failed to join');
  return next;
}

export async function leaveActiveExpedition(uid: string): Promise<void> {
  await ensureUserExpeditionState(uid);
  const st = await getUserExpeditionState(uid);
  if (!st?.activeExpeditionId) return;
  const expId = st.activeExpeditionId;
  const ref = doc(db, 'expeditions', expId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const members = Array.isArray(data.members) ? (data.members as ExpeditionMember[]) : [];
    const nextMembers = members.filter((m) => m.uid !== uid);
    const nextMemberUids = Array.isArray(data.memberUids)
      ? (data.memberUids as string[]).filter((x) => x !== uid)
      : nextMembers.map((m) => m.uid);
    tx.update(ref, { members: nextMembers, memberUids: nextMemberUids } as any);
  });
  await setActiveExpeditionId(uid, undefined);
}

export async function applySolveToActiveExpedition(uid: string, seasonId: string): Promise<void> {
  await ensureUserExpeditionState(uid);
  const st = await getUserExpeditionState(uid);
  if (!st?.activeExpeditionId) return;

  const expId = st.activeExpeditionId;
  const ref = doc(db, 'expeditions', expId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    if (data.status !== 'active') return;
    if (data.seasonId !== seasonId) return;

    const nextProgress = (typeof data.progress === 'number' ? data.progress : 0) + 1;
    const target = typeof data.target === 'number' ? data.target : 60;
    const completed = nextProgress >= target;

    tx.update(ref, {
      progress: increment(1),
      status: completed ? 'completed' : 'active',
      completedAt: completed ? nowIso() : (data.completedAt ?? null),
    } as any);
  });
}

export async function claimExpeditionReward(uid: string, expeditionId: string): Promise<void> {
  await ensureUserInventory(uid);
  const ref = doc(db, 'expeditions', expeditionId);

  let realmId: RealmId = 'renaissance';
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Expedition missing');
    const data = snap.data() as any;
    if (data.status !== 'completed') throw new Error('Expedition not completed yet');
    realmId = (data.realmId ?? 'renaissance') as RealmId;

    const claimed = Array.isArray(data.rewardClaimedByUids) ? (data.rewardClaimedByUids as string[]) : [];
    if (claimed.includes(uid)) return;
    tx.update(ref, { rewardClaimedByUids: [...claimed, uid] } as any);
  });

  // Reward payload: coins + relics + some energy.
  const rewardId = `exp_reward_${realmId}`;
  await Promise.all([
    grantReward(uid, 'qc_s1', { id: rewardId + '_coins', type: 'currency', name: '+120 Chrono Coins', payload: { kind: 'currency', currency: 'chrono_coins', amount: 120 } }),
    grantReward(uid, 'qc_s1', { id: rewardId + '_relic', type: 'currency', name: '+1 Relic', payload: { kind: 'currency', currency: 'relics', amount: 1 } }),
    grantReward(uid, 'qc_s1', { id: rewardId + '_energy', type: 'currency', name: '+40 Energy', payload: { kind: 'currency', currency: 'energy', amount: 40 } }),
  ]);
}
