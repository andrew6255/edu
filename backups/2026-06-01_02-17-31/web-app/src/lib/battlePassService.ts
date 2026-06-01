import { getUserDoc, setUserDoc, updateUserDoc, getGlobalDoc, setGlobalDoc, queryGlobalDocs, resolveIncrement } from '@/lib/supabaseDocStore';
import type {
  BattlePassReward,
  BattlePassSeasonDoc,
  UserBattlePassProgressDoc,
} from '@/types/battlePass';

const DEFAULT_SEASON_ID = 'qc_s1';
const SEASON_VERSION = 2;

export function getDefaultSeasonId(): string {
  return DEFAULT_SEASON_ID;
}

export type UserBattlePassMetaDoc = {
  id: 'global';
  activeSeasonId: string;
  updatedAt: string;
};

export async function getUserBattlePassMeta(uid: string): Promise<UserBattlePassMetaDoc | null> {
  const raw = await getUserDoc(uid, 'battlepass_meta', 'global');
  if (!raw) return null;
  const data = raw as any;
  return {
    id: 'global',
    activeSeasonId: typeof data.activeSeasonId === 'string' ? data.activeSeasonId : DEFAULT_SEASON_ID,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureUserBattlePassMeta(uid: string): Promise<UserBattlePassMetaDoc> {
  const existing = await getUserBattlePassMeta(uid);
  if (existing) return existing;
  const init: UserBattlePassMetaDoc = {
    id: 'global',
    activeSeasonId: DEFAULT_SEASON_ID,
    updatedAt: new Date().toISOString(),
  };
  await setUserDoc(uid, 'battlepass_meta', 'global', init as any);
  return init;
}

export async function getUserActiveSeasonId(uid: string): Promise<string> {
  const meta = await getUserBattlePassMeta(uid);
  return meta?.activeSeasonId || DEFAULT_SEASON_ID;
}

export async function setUserActiveSeasonId(uid: string, seasonId: string): Promise<void> {
  await setUserDoc(uid, 'battlepass_meta', 'global', { id: 'global', activeSeasonId: seasonId, updatedAt: new Date().toISOString() }, true);
}

export function computeTierFromEnergy(energyXp: number, energyPerTier: number): number {
  const ept = Math.max(1, Math.floor(energyPerTier));
  return Math.min(100, Math.max(0, Math.floor(energyXp / ept)) + 1);
}

export async function getBattlePassSeason(seasonId: string): Promise<BattlePassSeasonDoc | null> {
  const raw = await getGlobalDoc('battlepass_seasons', seasonId);
  if (!raw) return null;
  const data = raw as Partial<BattlePassSeasonDoc>;
  if (!data || typeof data.title !== 'string' || !Array.isArray((data as any).tiers)) return null;
  return { id: seasonId, ...(data as Omit<BattlePassSeasonDoc, 'id'>) };
}

export async function listBattlePassSeasons(): Promise<BattlePassSeasonDoc[]> {
  const rows = await queryGlobalDocs('battlepass_seasons');
  const out: BattlePassSeasonDoc[] = [];
  for (const row of rows) {
    const data = row.data as any;
    if (!data || typeof data.title !== 'string' || !Array.isArray(data.tiers)) continue;
    out.push({ id: row.id, ...(data as Omit<BattlePassSeasonDoc, 'id'>) });
  }
  return out;
}

export async function ensureBattlePassSeason(seasonId: string): Promise<BattlePassSeasonDoc> {
  const existing = await getBattlePassSeason(seasonId);
  if (existing && (existing.version ?? 0) >= SEASON_VERSION) return existing;

  const now = new Date();
  const startAt = new Date(now.getTime()).toISOString();
  const endAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7 * 8).toISOString();

  const tiers: BattlePassSeasonDoc['tiers'] = Array.from({ length: 100 }, (_, i) => {
    const tier = i + 1;
    const isMajor = tier % 10 === 0;

    const free: BattlePassReward = {
      id: `free_${tier}`,
      type: 'currency',
      name: `+${isMajor ? 50 : 10} Energy`,
      payload: { kind: 'currency', currency: 'energy', amount: isMajor ? 50 : 10 },
    };

    const premium: BattlePassReward = {
      id: `prem_${tier}`,
      type: 'currency',
      name: `+${isMajor ? 10 : 2} Credits`,
      payload: { kind: 'currency', currency: 'credits', amount: isMajor ? 10 : 2 },
    };

    const titleRewardByTier: Record<number, BattlePassReward> = {
      5: { id: 'title_apprentice', type: 'title', name: 'Title: The Apprentice', payload: { kind: 'item', itemId: 'title_apprentice' } },
      15: { id: 'title_vector_vanguard', type: 'title', name: 'Title: Vector Vanguard', payload: { kind: 'item', itemId: 'title_vector_vanguard' } },
      30: { id: 'title_proofsmith', type: 'title', name: 'Title: Proofsmith', payload: { kind: 'item', itemId: 'title_proofsmith' } },
      50: { id: 'title_time_architect', type: 'title', name: 'Title: Time Architect', payload: { kind: 'item', itemId: 'title_time_architect' } },
    };

    const premiumTitleRewardByTier: Record<number, BattlePassReward> = {
      10: { id: 'title_lab_elite', type: 'title', name: 'Title: Lab Elite', payload: { kind: 'item', itemId: 'title_lab_elite' } },
      25: { id: 'title_relativity_runner', type: 'title', name: 'Title: Relativity Runner', payload: { kind: 'item', itemId: 'title_relativity_runner' } },
      40: { id: 'title_quantum_scholar', type: 'title', name: 'Title: Quantum Scholar', payload: { kind: 'item', itemId: 'title_quantum_scholar' } },
      75: { id: 'title_void_walker', type: 'title', name: 'Title: Void Walker', payload: { kind: 'item', itemId: 'title_void_walker' } },
    };

    const titleFree = titleRewardByTier[tier];
    const titlePremium = premiumTitleRewardByTier[tier];

    return {
      tier,
      free: titleFree ?? free,
      premium: titlePremium ?? premium,
    };
  });

  const season: BattlePassSeasonDoc = {
    id: seasonId,
    version: SEASON_VERSION,
    title: 'Quantum Codex — Season 1',
    startAt,
    endAt,
    tiers,
    energyPerTier: 100,
    premiumPriceCredits: 500,
  };

  try {
    await setGlobalDoc('battlepass_seasons', seasonId, {
      version: season.version ?? SEASON_VERSION,
      title: season.title,
      startAt: season.startAt,
      endAt: season.endAt,
      tiers: season.tiers,
      energyPerTier: season.energyPerTier,
      premiumPriceCredits: season.premiumPriceCredits,
    }, true);
  } catch {
    // If the current user doesn't have permission to seed season content,
    // fall back to the in-memory seeded season so Emporium can still render.
  }

  return season;
}

export async function getUserBattlePassProgress(uid: string, seasonId: string): Promise<UserBattlePassProgressDoc | null> {
  const raw = await getUserDoc(uid, 'battlepass', seasonId);
  if (!raw) return null;
  const data = raw as Partial<UserBattlePassProgressDoc>;
  return {
    id: seasonId,
    seasonId,
    energyXp: typeof data.energyXp === 'number' ? data.energyXp : 0,
    premiumActive: !!data.premiumActive,
    claimedFreeTiers: Array.isArray((data as any).claimedFreeTiers) ? ((data as any).claimedFreeTiers as number[]) : [],
    claimedPremiumTiers: Array.isArray((data as any).claimedPremiumTiers) ? ((data as any).claimedPremiumTiers as number[]) : [],
    dailyKey: typeof (data as any).dailyKey === 'string' ? ((data as any).dailyKey as string) : undefined,
    weeklyKey: typeof (data as any).weeklyKey === 'string' ? ((data as any).weeklyKey as string) : undefined,
    dailyQuests: Array.isArray((data as any).dailyQuests) ? ((data as any).dailyQuests as any) : [],
    weeklyQuests: Array.isArray((data as any).weeklyQuests) ? ((data as any).weeklyQuests as any) : [],
    contracts: Array.isArray((data as any).contracts) ? ((data as any).contracts as any) : [],
    rewardGrants: Array.isArray((data as any).rewardGrants) ? ((data as any).rewardGrants as string[]) : [],
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
  };
}

export async function ensureUserBattlePassProgress(uid: string, seasonId: string): Promise<UserBattlePassProgressDoc> {
  const existing = await getUserBattlePassProgress(uid, seasonId);
  if (existing) return existing;
  const init: UserBattlePassProgressDoc = {
    id: seasonId,
    seasonId,
    energyXp: 0,
    premiumActive: false,
    claimedFreeTiers: [],
    claimedPremiumTiers: [],
    updatedAt: new Date().toISOString(),
  };
  await setUserDoc(uid, 'battlepass', seasonId, init as any);
  return init;
}

export async function addBattlePassEnergy(uid: string, seasonId: string, delta: number): Promise<void> {
  const existing = await getUserDoc(uid, 'battlepass', seasonId);
  if (!existing) return;
  const newVal = resolveIncrement(existing, 'energyXp', delta);
  await updateUserDoc(uid, 'battlepass', seasonId, { energyXp: newVal, updatedAt: new Date().toISOString() });
}

export async function setBattlePassPremium(uid: string, seasonId: string, premiumActive: boolean): Promise<void> {
  await updateUserDoc(uid, 'battlepass', seasonId, { premiumActive: !!premiumActive, updatedAt: new Date().toISOString() });
}

export async function markClaimedFreeTier(uid: string, seasonId: string, tier: number): Promise<void> {
  const prog = await ensureUserBattlePassProgress(uid, seasonId);
  if (prog.claimedFreeTiers.includes(tier)) return;
  await updateUserDoc(uid, 'battlepass', seasonId, {
    claimedFreeTiers: [...prog.claimedFreeTiers, tier],
    updatedAt: new Date().toISOString(),
  });
}

export async function markClaimedPremiumTier(uid: string, seasonId: string, tier: number): Promise<void> {
  const prog = await ensureUserBattlePassProgress(uid, seasonId);
  if (prog.claimedPremiumTiers.includes(tier)) return;
  await updateUserDoc(uid, 'battlepass', seasonId, {
    claimedPremiumTiers: [...prog.claimedPremiumTiers, tier],
    updatedAt: new Date().toISOString(),
  });
}
