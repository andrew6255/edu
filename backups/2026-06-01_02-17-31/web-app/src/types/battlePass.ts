export type BattlePassRewardType =
  | 'theme'
  | 'ink'
  | 'aura'
  | 'title'
  | 'decor'
  | 'utility'
  | 'currency';

export type BattlePassCurrency = 'credits' | 'insight' | 'gold' | 'energy' | 'chrono_coins' | 'relics';

export type BattlePassReward = {
  id: string;
  type: BattlePassRewardType;
  name: string;
  description?: string;
  payload?:
    | { kind: 'currency'; currency: BattlePassCurrency; amount: number }
    | { kind: 'item'; itemId: string };
};

export type BattlePassTier = {
  tier: number;
  free?: BattlePassReward;
  premium?: BattlePassReward;
};

export type BattlePassSeasonDoc = {
  id: string;
  version?: number;
  title: string;
  startAt: string;
  endAt: string;
  tiers: BattlePassTier[];
  energyPerTier: number;
  premiumPriceCredits: number;
};

export type UserInventoryDoc = {
  id: 'global';
  credits: number;
  insight: number;
  chronoCoins?: number;
  relics?: number;
  owned: {
    themes: string[];
    inks: string[];
    auras: string[];
    titles: string[];
    decor: string[];
    utilities: Record<string, number>;
  };
  equipped: {
    theme?: string;
    ink?: string;
    aura?: string;
    title?: string;
  };
  updatedAt: string;
};

export type UserBattlePassProgressDoc = {
  id: string; // seasonId
  seasonId: string;
  energyXp: number;
  premiumActive: boolean;
  claimedFreeTiers: number[];
  claimedPremiumTiers: number[];
  dailyKey?: string;
  weeklyKey?: string;
  dailyQuests?: import('@/types/quests').UserQuest[];
  weeklyQuests?: import('@/types/quests').UserQuest[];
  contracts?: import('@/types/quests').UserQuest[];
  rewardGrants?: string[];
  updatedAt: string;
};
