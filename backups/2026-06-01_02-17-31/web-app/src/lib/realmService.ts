import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';
import type { RealmId, RealmMode, UserRealmStateDoc } from '@/types/realms';

export const DEFAULT_REALM_ID: RealmId = 'renaissance';
export const DEFAULT_REALM_MODE: RealmMode = 'cozy';

export async function getUserRealmState(uid: string): Promise<UserRealmStateDoc | null> {
  const raw = await getUserDoc(uid, 'realm_state', 'global');
  if (!raw) return null;
  const data = raw as Partial<UserRealmStateDoc>;
  const selectedRealmId = (data.selectedRealmId ?? DEFAULT_REALM_ID) as RealmId;
  const mode = (data.mode ?? DEFAULT_REALM_MODE) as RealmMode;
  return {
    id: 'global',
    selectedRealmId,
    mode,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureUserRealmState(uid: string): Promise<UserRealmStateDoc> {
  const existing = await getUserRealmState(uid);
  if (existing) return existing;
  const init: UserRealmStateDoc = {
    id: 'global',
    selectedRealmId: DEFAULT_REALM_ID,
    mode: DEFAULT_REALM_MODE,
    updatedAt: new Date().toISOString(),
  };
  await setUserDoc(uid, 'realm_state', 'global', init as any);
  return init;
}

export async function setSelectedRealm(uid: string, selectedRealmId: RealmId): Promise<void> {
  await updateUserDoc(uid, 'realm_state', 'global', {
    selectedRealmId,
    updatedAt: new Date().toISOString(),
  });
}

export async function setRealmMode(uid: string, mode: RealmMode): Promise<void> {
  await updateUserDoc(uid, 'realm_state', 'global', {
    mode,
    updatedAt: new Date().toISOString(),
  });
}
