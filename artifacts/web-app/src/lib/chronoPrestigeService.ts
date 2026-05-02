import { buildChronoBattlePassViewModel } from '@/lib/chronoBattlePassService';
import { getGemMilestonesState } from '@/lib/chronoGemMilestonesService';
import { setCurrentBoard } from '@/lib/chronoEmpiresService';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

export interface ChronoPrestigeStateDoc {
  prestigeCount: number;
  sigils: number;
  currentSeason: number;
  lastPrestigeAt?: string;
  updatedAt: string;
}

export interface ChronoPrestigeEligibility {
  eligible: boolean;
  reasons: string[];
}

export interface ChronoPrestigeViewModel {
  prestigeCount: number;
  sigils: number;
  currentSeason: number;
  nextPrestigeRewardSigils: number;
  eligibility: ChronoPrestigeEligibility;
}

export type ChronoPrestigeResult =
  | { ok: true; sigilsEarned: number; newPrestigeCount: number; newSeason: number }
  | { ok: false; reason: string };

const PRESTIGE_COL = 'chrono_prestige';
const PRESTIGE_DOC = 'state';
const REQUIRED_BOARD = 500;
const REQUIRED_BATTLE_PASS_LEVEL = 10;
const REQUIRED_GEM_MILESTONES = 4;

function nowIso(): string {
  return new Date().toISOString();
}

function emptyState(): ChronoPrestigeStateDoc {
  return {
    prestigeCount: 0,
    sigils: 0,
    currentSeason: 1,
    updatedAt: nowIso(),
  };
}

export async function getChronoPrestigeState(uid: string): Promise<ChronoPrestigeStateDoc> {
  const raw = await getUserDoc(uid, PRESTIGE_COL, PRESTIGE_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, PRESTIGE_COL, PRESTIGE_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoPrestigeStateDoc>;
  return {
    prestigeCount: typeof d.prestigeCount === 'number' ? Math.max(0, Math.floor(d.prestigeCount)) : 0,
    sigils: typeof d.sigils === 'number' ? Math.max(0, Math.floor(d.sigils)) : 0,
    currentSeason: typeof d.currentSeason === 'number' ? Math.max(1, Math.floor(d.currentSeason)) : 1,
    lastPrestigeAt: typeof d.lastPrestigeAt === 'string' ? d.lastPrestigeAt : undefined,
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

async function computeEligibility(uid: string, currentBoard: number): Promise<ChronoPrestigeEligibility> {
  const [battlePass, gemMilestones] = await Promise.all([
    buildChronoBattlePassViewModel(uid),
    getGemMilestonesState(uid),
  ]);

  const reasons: string[] = [];
  if (currentBoard < REQUIRED_BOARD) reasons.push(`Reach Board ${REQUIRED_BOARD}.`);
  if (battlePass.level < REQUIRED_BATTLE_PASS_LEVEL) reasons.push(`Reach Battle Pass level ${REQUIRED_BATTLE_PASS_LEVEL}.`);
  if (Object.keys(gemMilestones.claimed).length < REQUIRED_GEM_MILESTONES) reasons.push(`Claim ${REQUIRED_GEM_MILESTONES} gem milestones.`);

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export async function buildChronoPrestigeViewModel(uid: string, currentBoard: number): Promise<ChronoPrestigeViewModel> {
  const [state, eligibility] = await Promise.all([
    getChronoPrestigeState(uid),
    computeEligibility(uid, currentBoard),
  ]);

  return {
    prestigeCount: state.prestigeCount,
    sigils: state.sigils,
    currentSeason: state.currentSeason,
    nextPrestigeRewardSigils: state.prestigeCount + 1,
    eligibility,
  };
}

export async function prestigeChronoRun(uid: string, currentBoard: number): Promise<ChronoPrestigeResult> {
  const [state, eligibility] = await Promise.all([
    getChronoPrestigeState(uid),
    computeEligibility(uid, currentBoard),
  ]);

  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reasons[0] ?? 'Not eligible to prestige yet.' };
  }

  const sigilsEarned = state.prestigeCount + 1;
  const nextState: ChronoPrestigeStateDoc = {
    prestigeCount: state.prestigeCount + 1,
    sigils: state.sigils + sigilsEarned,
    currentSeason: state.currentSeason + 1,
    lastPrestigeAt: nowIso(),
    updatedAt: nowIso(),
  };

  try {
    await Promise.all([
      setCurrentBoard(uid, 100),
      updateUserDoc(uid, 'chrono_battle_pass', 'state', { claimedTiers: [], updatedAt: nowIso() }),
      updateUserDoc(uid, PRESTIGE_COL, PRESTIGE_DOC, nextState as any),
    ]);
  } catch (e) {
    if (!(await getUserDoc(uid, PRESTIGE_COL, PRESTIGE_DOC))) {
      await setUserDoc(uid, PRESTIGE_COL, PRESTIGE_DOC, nextState as any);
    }
    return { ok: false, reason: e instanceof Error ? e.message : 'Failed to prestige run.' };
  }

  return {
    ok: true,
    sigilsEarned,
    newPrestigeCount: nextState.prestigeCount,
    newSeason: nextState.currentSeason,
  };
}
