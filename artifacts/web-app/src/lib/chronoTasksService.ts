/* ═══════════════════════════════════════════════════════════
   Chrono Empires — Tasks Service
   Real daily / weekly / lifetime task tracking and rewards.
   Supabase path: user_docs/{uid}/chrono_tasks/state
   ═══════════════════════════════════════════════════════════ */

import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';

export type TaskPeriod = 'daily' | 'weekly' | 'lifetime';

export type TaskEventKey =
  | 'wheel_spin'
  | 'card_upgrade'
  | 'booth_buy'
  | 'auction_win'
  | 'card_copies'
  | 'transport_use'
  | 'study_correct';

export interface TaskReward {
  coins?: number;
  energy?: number;
  gems?: number;
}

export interface TaskDef {
  id: string;
  period: TaskPeriod;
  eventKey: TaskEventKey;
  goal: number;
  label: string;
  emoji: string;
  reward: TaskReward;
}

/* ── Task Catalog ──────────────────────────────────────── */

export const TASK_CATALOG: TaskDef[] = [
  // Daily
  { id: 'd_spin_3',      period: 'daily', eventKey: 'wheel_spin',    goal: 3,  label: 'Spin the Wheel 3 times',     emoji: '🎡', reward: { coins: 500 } },
  { id: 'd_study_10',    period: 'daily', eventKey: 'study_correct', goal: 10, label: 'Answer 10 study questions',  emoji: '📚', reward: { energy: 2 } },
  { id: 'd_buy_1',       period: 'daily', eventKey: 'booth_buy',     goal: 1,  label: 'Buy 1 booth',                 emoji: '🏠', reward: { coins: 1000 } },
  { id: 'd_upgrade_1',   period: 'daily', eventKey: 'card_upgrade',  goal: 1,  label: 'Upgrade a card',              emoji: '⬆️', reward: { coins: 2000 } },
  { id: 'd_copies_5',    period: 'daily', eventKey: 'card_copies',   goal: 5,  label: 'Collect 5 new card copies',   emoji: '🎴', reward: { coins: 1500 } },

  // Weekly
  { id: 'w_spin_20',     period: 'weekly', eventKey: 'wheel_spin',    goal: 20,  label: 'Spin 20 times',              emoji: '🎡', reward: { coins: 10000, gems: 2 } },
  { id: 'w_study_100',   period: 'weekly', eventKey: 'study_correct', goal: 100, label: 'Answer 100 questions',       emoji: '📚', reward: { energy: 20, gems: 5 } },
  { id: 'w_auction_5',   period: 'weekly', eventKey: 'auction_win',   goal: 5,   label: 'Win 5 auctions',             emoji: '🔨', reward: { coins: 15000 } },
  { id: 'w_upgrade_5',   period: 'weekly', eventKey: 'card_upgrade',  goal: 5,   label: 'Upgrade 5 cards',            emoji: '⬆️', reward: { coins: 20000, gems: 3 } },
  { id: 'w_buy_10',      period: 'weekly', eventKey: 'booth_buy',     goal: 10,  label: 'Buy 10 booths',              emoji: '🏠', reward: { coins: 25000 } },

  // Lifetime
  { id: 'l_spin_100',    period: 'lifetime', eventKey: 'wheel_spin',    goal: 100,  label: 'Spin 100 times',             emoji: '🎡', reward: { gems: 20 } },
  { id: 'l_upgrade_30',  period: 'lifetime', eventKey: 'card_upgrade',  goal: 30,   label: 'Upgrade 30 cards',           emoji: '⬆️', reward: { gems: 50 } },
  { id: 'l_study_1000',  period: 'lifetime', eventKey: 'study_correct', goal: 1000, label: 'Answer 1,000 questions',     emoji: '📚', reward: { gems: 100, coins: 100000 } },
  { id: 'l_auction_50',  period: 'lifetime', eventKey: 'auction_win',   goal: 50,   label: 'Win 50 auctions',            emoji: '🔨', reward: { gems: 30, coins: 50000 } },
  { id: 'l_copies_500',  period: 'lifetime', eventKey: 'card_copies',   goal: 500,  label: 'Collect 500 card copies',    emoji: '🎴', reward: { gems: 40 } },
];

/* ── State types ───────────────────────────────────────── */

export interface ChronoTasksStateDoc {
  progress: Record<string, number>;
  claimed: Record<string, number>;   // taskId -> timestamp (ms)
  dailyKey: string;                   // YYYY-MM-DD (UTC)
  weeklyKey: string;                  // YYYY-Www (ISO week, UTC)
  updatedAt: string;
}

const TASK_COL = 'chrono_tasks';
const TASK_DOC = 'state';

function nowIso(): string { return new Date().toISOString(); }

function utcDailyKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function utcWeeklyKey(d: Date = new Date()): string {
  // ISO week number, UTC
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function emptyState(): ChronoTasksStateDoc {
  return {
    progress: {},
    claimed: {},
    dailyKey: utcDailyKey(),
    weeklyKey: utcWeeklyKey(),
    updatedAt: nowIso(),
  };
}

/* ── Read + auto-reset ─────────────────────────────────── */

function applyResets(state: ChronoTasksStateDoc): { state: ChronoTasksStateDoc; changed: boolean } {
  const today = utcDailyKey();
  const thisWeek = utcWeeklyKey();
  let changed = false;
  let nextProgress = { ...state.progress };
  let nextClaimed = { ...state.claimed };

  if (state.dailyKey !== today) {
    for (const t of TASK_CATALOG) {
      if (t.period !== 'daily') continue;
      if (nextProgress[t.id] !== undefined) { delete nextProgress[t.id]; changed = true; }
      if (nextClaimed[t.id] !== undefined)  { delete nextClaimed[t.id]; changed = true; }
    }
  }

  if (state.weeklyKey !== thisWeek) {
    for (const t of TASK_CATALOG) {
      if (t.period !== 'weekly') continue;
      if (nextProgress[t.id] !== undefined) { delete nextProgress[t.id]; changed = true; }
      if (nextClaimed[t.id] !== undefined)  { delete nextClaimed[t.id]; changed = true; }
    }
  }

  if (!changed && state.dailyKey === today && state.weeklyKey === thisWeek) {
    return { state, changed: false };
  }

  return {
    state: {
      progress: nextProgress,
      claimed: nextClaimed,
      dailyKey: today,
      weeklyKey: thisWeek,
      updatedAt: nowIso(),
    },
    changed: true,
  };
}

export async function getTasksState(uid: string): Promise<ChronoTasksStateDoc> {
  const raw = await getUserDoc(uid, TASK_COL, TASK_DOC);
  if (!raw) {
    const init = emptyState();
    await setUserDoc(uid, TASK_COL, TASK_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoTasksStateDoc>;
  const state: ChronoTasksStateDoc = {
    progress: (d.progress && typeof d.progress === 'object') ? d.progress as Record<string, number> : {},
    claimed:  (d.claimed  && typeof d.claimed  === 'object') ? d.claimed  as Record<string, number> : {},
    dailyKey:  typeof d.dailyKey  === 'string' ? d.dailyKey  : utcDailyKey(),
    weeklyKey: typeof d.weeklyKey === 'string' ? d.weeklyKey : utcWeeklyKey(),
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
  const { state: nextState, changed } = applyResets(state);
  if (changed) {
    await setUserDoc(uid, TASK_COL, TASK_DOC, nextState as any);
  }
  return nextState;
}

/* ── Increment progress on an event ─────────────────────── */

export async function incrementTaskProgress(uid: string, eventKey: TaskEventKey, amount = 1): Promise<void> {
  if (!uid || amount <= 0) return;
  try {
    const state = await getTasksState(uid);
    const nextProgress = { ...state.progress };
    let touched = false;
    for (const t of TASK_CATALOG) {
      if (t.eventKey !== eventKey) continue;
      const cur = nextProgress[t.id] ?? 0;
      if (cur >= t.goal) continue; // cap at goal
      nextProgress[t.id] = Math.min(t.goal, cur + amount);
      touched = true;
    }
    if (!touched) return;
    await updateUserDoc(uid, TASK_COL, TASK_DOC, {
      progress: nextProgress,
      updatedAt: nowIso(),
    });
  } catch {
    // Best-effort: never throw from event hooks.
  }
}

/* ── Claim reward ──────────────────────────────────────── */

export type ClaimResult =
  | { ok: true; reward: TaskReward }
  | { ok: false; reason: string };

export async function claimTaskReward(uid: string, taskId: string): Promise<ClaimResult> {
  const def = TASK_CATALOG.find((t) => t.id === taskId);
  if (!def) return { ok: false, reason: 'Unknown task.' };

  const state = await getTasksState(uid);
  const progress = state.progress[taskId] ?? 0;
  if (progress < def.goal) return { ok: false, reason: 'Not completed yet.' };
  if (state.claimed[taskId]) return { ok: false, reason: 'Already claimed.' };

  // Apply reward via economy helpers (deferred imports to avoid cycles)
  try {
    if ((def.reward.coins ?? 0) > 0) {
      // Coins live in chrono_economy/global.gold
      const econRaw = await getUserDoc(uid, 'chrono_economy', 'global');
      const curGold = econRaw && typeof (econRaw as any).gold === 'number' ? (econRaw as any).gold as number : 0;
      const nextGold = curGold + (def.reward.coins ?? 0);
      if (econRaw) {
        await updateUserDoc(uid, 'chrono_economy', 'global', { gold: nextGold });
      } else {
        await setUserDoc(uid, 'chrono_economy', 'global', { gold: nextGold });
      }
    }
    if ((def.reward.energy ?? 0) > 0 || (def.reward.gems ?? 0) > 0) {
      const { updateEconomy } = await import('@/lib/userService');
      await updateEconomy(uid, {
        energy: def.reward.energy ?? 0,
        gems: def.reward.gems ?? 0,
      });
    }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Reward failed.' };
  }

  const nextClaimed = { ...state.claimed, [taskId]: Date.now() };
  await updateUserDoc(uid, TASK_COL, TASK_DOC, {
    claimed: nextClaimed,
    updatedAt: nowIso(),
  });
  return { ok: true, reward: def.reward };
}

/* ── Aggregate helpers for UI ─────────────────────────── */

export interface TaskViewModel {
  def: TaskDef;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export function buildTaskViewModels(state: ChronoTasksStateDoc, period: TaskPeriod): TaskViewModel[] {
  return TASK_CATALOG
    .filter((t) => t.period === period)
    .map((def) => {
      const progress = Math.min(def.goal, state.progress[def.id] ?? 0);
      const completed = progress >= def.goal;
      const claimed = !!state.claimed[def.id];
      return { def, progress, completed, claimed };
    });
}
