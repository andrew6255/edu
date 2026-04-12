import { getUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';
import { ensureUserBattlePassProgress } from '@/lib/battlePassService';
import { ensureUserInventory } from '@/lib/inventoryService';
import type { UserBattlePassProgressDoc } from '@/types/battlePass';
import type { SolveEvent } from '@/lib/battlePassEvents';
import type { UserQuest, QuestType } from '@/types/quests';
import { grantReward } from '@/lib/battlePassRewards';
import { getUserRealmState } from '@/lib/realmService';

type ProgressWithQuests = UserBattlePassProgressDoc & {
  dailyQuests?: UserQuest[];
  weeklyQuests?: UserQuest[];
  contracts?: UserQuest[];
  dailyKey?: string;
  weeklyKey?: string;
  rewardGrants?: string[];
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoWeekKey(d: Date): string {
  // ISO week approximation (good enough for v1): year-week based on UTC Thursday
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function clampQuestTarget(n: number): number {
  return Math.max(1, Math.min(9999, Math.floor(n)));
}

function makeQuest(opts: {
  type: QuestType;
  id: string;
  title: string;
  description: string;
  requirement: UserQuest['requirement'];
  reward: UserQuest['reward'];
}): UserQuest {
  return {
    id: opts.id,
    type: opts.type,
    title: opts.title,
    description: opts.description,
    requirement: { kind: opts.requirement.kind, target: clampQuestTarget(opts.requirement.target) },
    progress: 0,
    reward: opts.reward,
  };
}

function buildDefaultDailies(realmName: string): UserQuest[] {
  return [
    makeQuest({
      type: 'daily',
      id: 'd_solve_8',
      title: `${realmName}: Prototype Run`,
      description: 'Solve 8 questions anywhere.',
      requirement: { kind: 'solve_total', target: 8 },
      reward: { id: 'r_daily_energy', type: 'currency', name: '+25 Energy', payload: { kind: 'currency', currency: 'energy', amount: 25 } },
    }),
    makeQuest({
      type: 'daily',
      id: 'd_numeric_3',
      title: `${realmName}: Precision Check`,
      description: 'Get 3 numeric answers correct.',
      requirement: { kind: 'correct_numeric', target: 3 },
      reward: { id: 'r_daily_coins', type: 'currency', name: '+30 Chrono Coins', payload: { kind: 'currency', currency: 'chrono_coins', amount: 30 } },
    }),
    makeQuest({
      type: 'daily',
      id: 'd_step_1',
      title: `${realmName}: Lab Notes`,
      description: 'Complete 1 step-by-step solution.',
      requirement: { kind: 'complete_step', target: 1 },
      reward: { id: 'r_daily_insight', type: 'currency', name: '+5 Insight', payload: { kind: 'currency', currency: 'insight', amount: 5 } },
    }),
  ];
}

function buildDefaultWeeklies(realmName: string): UserQuest[] {
  return [
    makeQuest({
      type: 'weekly',
      id: 'w_solve_40',
      title: `${realmName}: Stabilize the Week`,
      description: 'Solve 40 questions anywhere.',
      requirement: { kind: 'solve_total', target: 40 },
      reward: { id: 'r_weekly_relic', type: 'currency', name: '+2 Relics', payload: { kind: 'currency', currency: 'relics', amount: 2 } },
    }),
    makeQuest({
      type: 'weekly',
      id: 'w_correct_25',
      title: `${realmName}: Clean Run`,
      description: 'Get 25 answers correct (any type).',
      requirement: { kind: 'correct_total', target: 25 },
      reward: { id: 'r_weekly_coins', type: 'currency', name: '+150 Chrono Coins', payload: { kind: 'currency', currency: 'chrono_coins', amount: 150 } },
    }),
  ];
}

function buildDefaultContracts(): UserQuest[] {
  return [
    makeQuest({
      type: 'contract',
      id: 'c_solve_200',
      title: 'Season Contract: Atlas Contributor',
      description: 'Solve 200 questions this season.',
      requirement: { kind: 'solve_total', target: 200 },
      reward: { id: 'r_contract_title', type: 'title', name: 'Title: Atlas Contributor', payload: { kind: 'item', itemId: 'title_atlas_contributor' } },
    }),
  ];
}

function applySolveToQuest(q: UserQuest, e: SolveEvent): number {
  const kind = q.requirement.kind;
  if (kind === 'solve_total') return 1;
  if (kind === 'correct_total') return e.correct ? 1 : 0;
  if (kind === 'correct_numeric') return e.correct && e.kind === 'numeric' ? 1 : 0;
  if (kind === 'complete_step') return e.correct && e.kind === 'step' ? 1 : 0;
  return 0;
}

function completeIfReady(q: UserQuest, nowIso: string): UserQuest {
  if (q.completedAt) return q;
  if (q.progress >= q.requirement.target) return { ...q, completedAt: nowIso };
  return q;
}

export async function ensureQuestsForToday(uid: string, seasonId: string): Promise<void> {
  await Promise.all([ensureUserInventory(uid), ensureUserBattlePassProgress(uid, seasonId)]);
  const now = new Date();
  const dk = dayKey(now);
  const wk = isoWeekKey(now);

  const realm = await getUserRealmState(uid);
  const realmName = realm?.selectedRealmId === 'renaissance'
    ? 'Renaissance'
    : realm?.selectedRealmId === 'industrial'
      ? 'Industrial'
      : realm?.selectedRealmId === 'space'
        ? 'Orbital'
        : 'Realm';

  const raw = await getUserDoc(uid, 'battlepass', seasonId);
  if (!raw) return;
  const data = raw as ProgressWithQuests;

  const next: Partial<ProgressWithQuests> = { updatedAt: new Date().toISOString() };

  if (data.dailyKey !== dk || !Array.isArray(data.dailyQuests) || data.dailyQuests.length === 0) {
    next.dailyKey = dk;
    next.dailyQuests = buildDefaultDailies(realmName);
  }

  if (data.weeklyKey !== wk || !Array.isArray(data.weeklyQuests) || data.weeklyQuests.length === 0) {
    next.weeklyKey = wk;
    next.weeklyQuests = buildDefaultWeeklies(realmName);
  }

  if (!Array.isArray(data.contracts) || data.contracts.length === 0) {
    next.contracts = buildDefaultContracts();
  }

  if (Object.keys(next).length > 1) {
    await updateUserDoc(uid, 'battlepass', seasonId, next as any);
  }
}

export async function applySolveEventToQuests(uid: string, seasonId: string, e: SolveEvent): Promise<void> {
  await ensureQuestsForToday(uid, seasonId);
  const nowIso = new Date().toISOString();

  // 1) Update quest progress and mark any newly completed quests.
  const newlyCompleted: Array<{ questId: string; reward: UserQuest['reward'] }> = [];

  const raw = await getUserDoc(uid, 'battlepass', seasonId);
  if (!raw) return;
  const data = raw as ProgressWithQuests;

  const daily = Array.isArray(data.dailyQuests) ? data.dailyQuests : [];
  const weekly = Array.isArray(data.weeklyQuests) ? data.weeklyQuests : [];
  const contracts = Array.isArray(data.contracts) ? data.contracts : [];
  const rewardGrants = Array.isArray(data.rewardGrants) ? [...data.rewardGrants] : [];

  function bump(list: UserQuest[], listKey: string): UserQuest[] {
    return list.map((q) => {
      const inc = applySolveToQuest(q, e);
      const progressed = inc > 0 && !q.completedAt ? { ...q, progress: Math.min(q.requirement.target, q.progress + inc) } : q;
      const completed = completeIfReady(progressed, nowIso);

      if (completed.completedAt && !completed.claimedAt) {
        const grantId = `${listKey}:${completed.id}:${completed.completedAt}`;
        if (!rewardGrants.includes(grantId)) {
          newlyCompleted.push({ questId: grantId, reward: completed.reward });
          rewardGrants.push(grantId);
        }
        return { ...completed, claimedAt: completed.completedAt };
      }

      return completed;
    });
  }

  const nextDaily = bump(daily, 'daily');
  const nextWeekly = bump(weekly, 'weekly');
  const nextContracts = bump(contracts, 'contract');

  await updateUserDoc(uid, 'battlepass', seasonId, {
    dailyQuests: nextDaily,
    weeklyQuests: nextWeekly,
    contracts: nextContracts,
    rewardGrants,
    updatedAt: nowIso,
  } as any);

  // 2) Grant rewards (idempotence is protected by rewardGrants stored in battlepass doc).
  for (const g of newlyCompleted) {
    try {
      await grantReward(uid, seasonId, g.reward);
    } catch {
      // ignore
    }
  }
}
