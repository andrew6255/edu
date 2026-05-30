import { getUserDoc, setUserDoc, updateUserDoc, runDocTransaction } from '@/lib/supabaseDocStore';
import type { RealmId } from '@/types/realms';
import type { RealmUpgradeDef, RealmUpgradeId, UserRealmUpgradesDoc } from '@/types/realmUpgrades';

export const REALM_UPGRADES: RealmUpgradeDef[] = [
  {
    id: 'ren_workbench_1',
    realmId: 'renaissance',
    name: 'Workbench I',
    description: 'Unlocks basic prototyping tools for your realm outpost.',
    costCoins: 120,
    effectKey: 'ren_workbench_1',
  },
  {
    id: 'ren_workbench_2',
    realmId: 'renaissance',
    name: 'Workbench II',
    description: 'Upgrades your prototypes: faster research loops (effects later).',
    costCoins: 220,
    requires: 'ren_workbench_1',
    effectKey: 'ren_workbench_2',
  },
  {
    id: 'ind_foundry_1',
    realmId: 'industrial',
    name: 'Foundry I',
    description: 'Builds a small production line for Chrono parts (effects later).',
    costCoins: 140,
    effectKey: 'ind_foundry_1',
  },
  {
    id: 'ind_foundry_2',
    realmId: 'industrial',
    name: 'Foundry II',
    description: 'Improves efficiency and stabilizes weekly output (effects later).',
    costCoins: 260,
    requires: 'ind_foundry_1',
    effectKey: 'ind_foundry_2',
  },
  {
    id: 'sp_lab_1',
    realmId: 'space',
    name: 'Lab Module I',
    description: 'Installs a station-side lab bay (effects later).',
    costCoins: 160,
    effectKey: 'sp_lab_1',
  },
  {
    id: 'sp_lab_2',
    realmId: 'space',
    name: 'Lab Module II',
    description: 'Expands anomaly detection arrays (effects later).',
    costCoins: 320,
    requires: 'sp_lab_1',
    effectKey: 'sp_lab_2',
  },
];

export function upgradesForRealm(realmId: RealmId): RealmUpgradeDef[] {
  return REALM_UPGRADES.filter((u) => u.realmId === realmId);
}

export async function getUserRealmUpgrades(uid: string): Promise<UserRealmUpgradesDoc | null> {
  const raw = await getUserDoc(uid, 'realm_upgrades', 'global');
  if (!raw) return null;
  const data = raw as Partial<UserRealmUpgradesDoc>;
  return {
    id: 'global',
    purchased: Array.isArray((data as any).purchased) ? ((data as any).purchased as RealmUpgradeId[]) : [],
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureUserRealmUpgrades(uid: string): Promise<UserRealmUpgradesDoc> {
  const existing = await getUserRealmUpgrades(uid);
  if (existing) return existing;
  const init: UserRealmUpgradesDoc = {
    id: 'global',
    purchased: [],
    updatedAt: new Date().toISOString(),
  };
  await setUserDoc(uid, 'realm_upgrades', 'global', init as any);
  return init;
}

export async function purchaseRealmUpgrade(uid: string, upgradeId: RealmUpgradeId): Promise<void> {
  const def = REALM_UPGRADES.find((u) => u.id === upgradeId);
  if (!def) throw new Error('Unknown upgrade');

  await runDocTransaction(async (tx) => {
    const inv = await tx.getUserDoc(uid, 'inventory', 'global');
    const up = await tx.getUserDoc(uid, 'realm_upgrades', 'global');
    if (!inv) throw new Error('Inventory missing');
    if (!up) throw new Error('Upgrades missing');

    const coins = typeof inv.chronoCoins === 'number' ? (inv.chronoCoins as number) : 0;
    const purchased: RealmUpgradeId[] = Array.isArray(up.purchased) ? (up.purchased as RealmUpgradeId[]) : [];

    if (purchased.includes(upgradeId)) return;
    if (def.requires && !purchased.includes(def.requires)) throw new Error('Requires previous upgrade');
    if (coins < def.costCoins) throw new Error('Not enough Chrono Coins');

    tx.updateUserDoc(uid, 'inventory', 'global', {
      chronoCoins: coins - def.costCoins,
      updatedAt: new Date().toISOString(),
    });
    tx.updateUserDoc(uid, 'realm_upgrades', 'global', {
      purchased: [...purchased, upgradeId],
      updatedAt: new Date().toISOString(),
    });
  });
}
