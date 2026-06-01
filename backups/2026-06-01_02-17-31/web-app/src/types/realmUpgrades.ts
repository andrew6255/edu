import type { RealmId } from '@/types/realms';

export type RealmUpgradeId =
  | 'ren_workbench_1'
  | 'ren_workbench_2'
  | 'ind_foundry_1'
  | 'ind_foundry_2'
  | 'sp_lab_1'
  | 'sp_lab_2';

export type RealmUpgradeDef = {
  id: RealmUpgradeId;
  realmId: RealmId;
  name: string;
  description: string;
  costCoins: number;
  requires?: RealmUpgradeId;
  effectKey: string;
};

export type UserRealmUpgradesDoc = {
  id: 'global';
  purchased: RealmUpgradeId[];
  updatedAt: string;
};
