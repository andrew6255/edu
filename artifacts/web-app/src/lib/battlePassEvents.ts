import { ensureBattlePassSeason, ensureUserBattlePassProgress, getDefaultSeasonId, addBattlePassEnergy } from '@/lib/battlePassService';
import { ensureUserInventory } from '@/lib/inventoryService';
import { applySolveEventToQuests } from '@/lib/battlePassQuestService';
import { applySolveToActiveExpedition } from '@/lib/expeditionService';

export type SolveEvent = {
  correct: boolean;
  kind: 'mcq' | 'numeric' | 'text' | 'step';
  difficulty?: number;
};

export async function emitSolveEvent(uid: string, e: SolveEvent): Promise<void> {
  const seasonId = getDefaultSeasonId();
  await Promise.all([ensureBattlePassSeason(seasonId), ensureUserInventory(uid), ensureUserBattlePassProgress(uid, seasonId)]);

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
}
