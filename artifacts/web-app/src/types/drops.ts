import type { RealmId } from '@/types/realms';

export type WeeklyCrateKind = 'builder' | 'scholar' | 'competitive';

export type UserDropsDoc = {
  id: 'global';
  weeklyKey?: string;
  weeklyCrateClaimedKey?: string;
  lastWeeklyCrate?: {
    key: string;
    kind: WeeklyCrateKind;
    realmId: RealmId;
    rewardId: string;
    rewardName: string;
    duplicate: boolean;
    claimedAt: string;
  };
  updatedAt: string;
};
