import { getCollectionSetsState } from '@/lib/chronoCollectionSetsService';
import { getDiscoveryState } from '@/lib/chronoDiscoveryService';
import { getGemMilestonesState } from '@/lib/chronoGemMilestonesService';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';
import { getTasksState } from '@/lib/chronoTasksService';

export interface ChronoBattlePassReward {
  coins?: number;
  gems?: number;
  energy?: number;
}

export interface ChronoBattlePassTierDef {
  tier: number;
  xpRequired: number;
  reward: ChronoBattlePassReward;
}

export interface ChronoBattlePassStateDoc {
  claimedTiers: number[];
  updatedAt: string;
}

export interface ChronoBattlePassTierViewModel {
  def: ChronoBattlePassTierDef;
  unlocked: boolean;
  claimed: boolean;
}

export interface ChronoBattlePassViewModel {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  tiers: ChronoBattlePassTierViewModel[];
}

export type ClaimChronoBattlePassRewardResult =
  | { ok: true; reward: ChronoBattlePassReward }
  | { ok: false; reason: string };

const BATTLEPASS_COL = 'chrono_battle_pass';
const BATTLEPASS_DOC = 'state';
const XP_PER_TIER = 100;
const MAX_TIER = 20;

function nowIso(): string {
  return new Date().toISOString();
}

function buildReward(tier: number): ChronoBattlePassReward {
  const major = tier % 5 === 0;
  return {
    coins: major ? tier * 2500 : tier * 800,
    gems: major ? 5 : tier % 2 === 0 ? 1 : 0,
    energy: tier % 3 === 0 ? 1 : 0,
  };
}

export const CHRONO_BATTLE_PASS_TIERS: ChronoBattlePassTierDef[] = Array.from({ length: MAX_TIER }, (_, index) => {
  const tier = index + 1;
  return {
    tier,
    xpRequired: (tier - 1) * XP_PER_TIER,
    reward: buildReward(tier),
  };
});

function emptyState(): ChronoBattlePassStateDoc {
  return {
    claimedTiers: [],
    updatedAt: nowIso(),
  };
}

export async function getChronoBattlePassState(uid: string): Promise<ChronoBattlePassStateDoc> {
  const raw = await getUserDoc(uid, BATTLEPASS_COL, BATTLEPASS_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, BATTLEPASS_COL, BATTLEPASS_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoBattlePassStateDoc>;
  return {
    claimedTiers: Array.isArray(d.claimedTiers) ? d.claimedTiers.filter((x): x is number => typeof x === 'number') : [],
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

export async function computeChronoBattlePassXp(uid: string): Promise<number> {
  const [tasks, sets, discovery, gemMilestones, friendGifts] = await Promise.all([
    getTasksState(uid),
    getCollectionSetsState(uid),
    getDiscoveryState(uid),
    getGemMilestonesState(uid),
    getUserDoc(uid, 'chrono_friend_gifts', 'state'),
  ]);

  const taskXp = Object.values(tasks.progress).reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0) * 2;
  const claimedTaskXp = Object.keys(tasks.claimed).length * 20;
  const setXp = Object.keys(sets.claimed).length * 30;
  const discoveryXp = discovery.discoveredRecipeIds.length * 35;
  const gemMilestoneXp = Object.keys(gemMilestones.claimed).length * 40;

  const today = new Date().toISOString().slice(0, 10);
  const sentMap = friendGifts && typeof friendGifts === 'object' && typeof (friendGifts as any).sent === 'object'
    ? (friendGifts as any).sent as Record<string, string>
    : {};
  const giftXp = Object.values(sentMap).filter((day) => day === today).length * 10;

  return taskXp + claimedTaskXp + setXp + discoveryXp + gemMilestoneXp + giftXp;
}

export async function buildChronoBattlePassViewModel(uid: string): Promise<ChronoBattlePassViewModel> {
  const [state, xp] = await Promise.all([
    getChronoBattlePassState(uid),
    computeChronoBattlePassXp(uid),
  ]);

  const level = Math.max(1, Math.min(MAX_TIER, Math.floor(xp / XP_PER_TIER) + 1));
  const xpIntoLevel = xp % XP_PER_TIER;
  const xpForNextLevel = XP_PER_TIER;

  const tiers = CHRONO_BATTLE_PASS_TIERS.map((def) => ({
    def,
    unlocked: xp >= def.xpRequired,
    claimed: state.claimedTiers.includes(def.tier),
  }));

  return {
    level,
    xp,
    xpIntoLevel,
    xpForNextLevel,
    tiers,
  };
}

export async function claimChronoBattlePassReward(uid: string, tier: number): Promise<ClaimChronoBattlePassRewardResult> {
  const def = CHRONO_BATTLE_PASS_TIERS.find((entry) => entry.tier === tier);
  if (!def) return { ok: false, reason: 'Unknown tier.' };

  const [state, xp] = await Promise.all([
    getChronoBattlePassState(uid),
    computeChronoBattlePassXp(uid),
  ]);
  if (state.claimedTiers.includes(tier)) return { ok: false, reason: 'Already claimed.' };
  if (xp < def.xpRequired) return { ok: false, reason: 'Tier not unlocked yet.' };

  try {
    const { updateEconomy } = await import('@/lib/userService');
    await updateEconomy(uid, {
      gold: def.reward.coins ?? 0,
      gems: def.reward.gems ?? 0,
      energy: def.reward.energy ?? 0,
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Reward failed.' };
  }

  const nextClaimedTiers = [...state.claimedTiers, tier].sort((a, b) => a - b);
  if (await getUserDoc(uid, BATTLEPASS_COL, BATTLEPASS_DOC)) {
    await updateUserDoc(uid, BATTLEPASS_COL, BATTLEPASS_DOC, {
      claimedTiers: nextClaimedTiers,
      updatedAt: nowIso(),
    });
  } else {
    await setUserDoc(uid, BATTLEPASS_COL, BATTLEPASS_DOC, {
      claimedTiers: nextClaimedTiers,
      updatedAt: nowIso(),
    } as any);
  }

  return { ok: true, reward: def.reward };
}
