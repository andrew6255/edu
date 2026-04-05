import { db } from '@/lib/firebase';
import { arrayUnion, doc, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
import type { UserInventoryDoc } from '@/types/battlePass';

export async function getUserInventory(uid: string): Promise<UserInventoryDoc | null> {
  const snap = await getDoc(doc(db, 'users', uid, 'inventory', 'global'));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<UserInventoryDoc>;
  return {
    id: 'global',
    credits: typeof data.credits === 'number' ? data.credits : 0,
    insight: typeof data.insight === 'number' ? data.insight : 0,
    chronoCoins: typeof (data as any).chronoCoins === 'number' ? ((data as any).chronoCoins as number) : 0,
    relics: typeof (data as any).relics === 'number' ? ((data as any).relics as number) : 0,
    owned: {
      themes: Array.isArray((data as any).owned?.themes) ? ((data as any).owned.themes as string[]) : [],
      inks: Array.isArray((data as any).owned?.inks) ? ((data as any).owned.inks as string[]) : [],
      auras: Array.isArray((data as any).owned?.auras) ? ((data as any).owned.auras as string[]) : [],
      titles: Array.isArray((data as any).owned?.titles) ? ((data as any).owned.titles as string[]) : [],
      decor: Array.isArray((data as any).owned?.decor) ? ((data as any).owned.decor as string[]) : [],
      utilities: typeof (data as any).owned?.utilities === 'object' && (data as any).owned?.utilities ? ((data as any).owned.utilities as Record<string, number>) : {},
    },
    equipped: {
      theme: typeof (data as any).equipped?.theme === 'string' ? ((data as any).equipped.theme as string) : undefined,
      ink: typeof (data as any).equipped?.ink === 'string' ? ((data as any).equipped.ink as string) : undefined,
      aura: typeof (data as any).equipped?.aura === 'string' ? ((data as any).equipped.aura as string) : undefined,
      title: typeof (data as any).equipped?.title === 'string' ? ((data as any).equipped.title as string) : undefined,
    },
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureUserInventory(uid: string): Promise<UserInventoryDoc> {
  const existing = await getUserInventory(uid);
  if (existing) return existing;
  const init: UserInventoryDoc = {
    id: 'global',
    credits: 0,
    insight: 0,
    chronoCoins: 0,
    relics: 0,
    owned: { themes: [], inks: [], auras: [], titles: [], decor: [], utilities: {} },
    equipped: {},
    updatedAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'users', uid, 'inventory', 'global'), init);
  return init;
}

export async function addCredits(uid: string, delta: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'inventory', 'global'), {
    credits: increment(delta),
    updatedAt: new Date().toISOString(),
  });
}

export async function addInsight(uid: string, delta: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'inventory', 'global'), {
    insight: increment(delta),
    updatedAt: new Date().toISOString(),
  });
}

export async function addChronoCoins(uid: string, delta: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'inventory', 'global'), {
    chronoCoins: increment(delta),
    updatedAt: new Date().toISOString(),
  });
}

export async function addRelics(uid: string, delta: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'inventory', 'global'), {
    relics: increment(delta),
    updatedAt: new Date().toISOString(),
  });
}

export async function equipInventory(uid: string, patch: Partial<UserInventoryDoc['equipped']>): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof UserInventoryDoc['equipped']>;
  const update: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const k of keys) update[`equipped.${k}`] = (patch as any)[k];
  await updateDoc(doc(db, 'users', uid, 'inventory', 'global'), update);
}

export async function addOwnedTitle(uid: string, titleId: string): Promise<void> {
  const id = String(titleId || '').trim();
  if (!id) return;
  await updateDoc(doc(db, 'users', uid, 'inventory', 'global'), {
    'owned.titles': arrayUnion(id),
    updatedAt: new Date().toISOString(),
  });
}
