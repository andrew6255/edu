import type { BattlePassReward } from '@/types/battlePass';

export type QuestType = 'daily' | 'weekly' | 'contract';

export type QuestRequirementKind = 'solve_total' | 'correct_total' | 'correct_numeric' | 'complete_step';

export type QuestRequirement = {
  kind: QuestRequirementKind;
  target: number;
};

export type UserQuest = {
  id: string;
  type: QuestType;
  title: string;
  description: string;
  requirement: QuestRequirement;
  progress: number;
  completedAt?: string;
  claimedAt?: string;
  reward: BattlePassReward;
};
