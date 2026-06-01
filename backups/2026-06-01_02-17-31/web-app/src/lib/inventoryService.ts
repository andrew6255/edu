import { getUserDoc, setUserDoc, updateUserDoc, resolveIncrement, resolveArrayUnion } from '@/lib/supabaseDocStore';
import type { UserInventoryDoc } from '@/types/battlePass';

export async function getUserInventory(uid: string): Promise<UserInventoryDoc | null> {
  const raw = await getUserDoc(uid, 'inventory', 'global');
  if (!raw) return null;
  const data = raw as Partial<UserInventoryDoc>;
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
  await setUserDoc(uid, 'inventory', 'global', init as any);
  return init;
}

async function incrementField(uid: string, field: string, delta: number): Promise<void> {
  const existing = await getUserDoc(uid, 'inventory', 'global');
  if (!existing) throw new Error('Inventory missing');
  const newVal = resolveIncrement(existing, field, delta);
  await updateUserDoc(uid, 'inventory', 'global', { [field]: newVal, updatedAt: new Date().toISOString() });
}

export async function addCredits(uid: string, delta: number): Promise<void> {
  await incrementField(uid, 'credits', delta);
}

export async function addInsight(uid: string, delta: number): Promise<void> {
  await incrementField(uid, 'insight', delta);
}

export async function addChronoCoins(uid: string, delta: number): Promise<void> {
  await incrementField(uid, 'chronoCoins', delta);
}

export async function addRelics(uid: string, delta: number): Promise<void> {
  await incrementField(uid, 'relics', delta);
}

export async function equipInventory(uid: string, patch: Partial<UserInventoryDoc['equipped']>): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof UserInventoryDoc['equipped']>;
  const update: Record<string, any> = { updatedAt: new Date().toISOString() };
  for (const k of keys) update[`equipped.${k}`] = (patch as any)[k];
  await updateUserDoc(uid, 'inventory', 'global', update);
}

export async function addOwnedTitle(uid: string, titleId: string): Promise<void> {
  const id = String(titleId || '').trim();
  if (!id) return;
  const existing = await getUserDoc(uid, 'inventory', 'global') ?? {};
  const titles = resolveArrayUnion(existing, 'owned.titles', id);
  await updateUserDoc(uid, 'inventory', 'global', {
    'owned.titles': titles,
    updatedAt: new Date().toISOString(),
  });
}
