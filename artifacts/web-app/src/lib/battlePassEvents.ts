import {
  addBattlePassEnergy,
  ensureBattlePassSeason,
  ensureUserBattlePassMeta,
  ensureUserBattlePassProgress,
  getDefaultSeasonId,
  getUserActiveSeasonId,
} from '@/lib/battlePassService';
import { ensureUserInventory } from '@/lib/inventoryService';
import { applySolveEventToQuests } from '@/lib/battlePassQuestService';
import { applySolveToActiveExpedition } from '@/lib/expeditionService';
import { applySolveToActiveDuel } from '@/lib/duelService';

export type SolveEvent = {
  correct: boolean;
  kind: 'mcq' | 'numeric' | 'text' | 'step';
  difficulty?: number;
};

export async function emitSolveEvent(uid: string, e: SolveEvent): Promise<void> {
  const fallback = getDefaultSeasonId();
  await Promise.all([ensureUserBattlePassMeta(uid), ensureUserInventory(uid)]);
  const seasonId = await getUserActiveSeasonId(uid).catch(() => fallback);
  await Promise.all([ensureBattlePassSeason(seasonId), ensureUserBattlePassProgress(uid, seasonId)]);

  // Simple v1 scoring: correct answers give energy, wrong gives small energy.
  const d = typeof e.difficulty === 'number' && Number.isFinite(e.difficulty) ? Math.max(1, Math.min(5, Math.round(e.difficulty))) : 1;
  const base = e.correct ? 8 : 2;
  const mult = e.kind === 'numeric' ? 1.1 : e.kind === 'step' ? 1.25 : 1;
  const delta = Math.round(base * d * mult);
  await addBattlePassEnergy(uid, seasonId, delta);

  try {
    await applySolveEventToQuests(uid, seasonId, e);
  } catch {
    // ignore quest errors
  }

  try {
    await applySolveToActiveExpedition(uid, seasonId);
  } catch {
    // ignore expedition errors
  }

  try {
    await applySolveToActiveDuel(uid, seasonId);
  } catch {
    // ignore duel errors
  }
}
