import { getUserData } from './userService';

export interface ObjectiveProgress {
  mastered: boolean;
  xpAwarded: number;
  completedAt?: string;
}

export interface ChapterProgress {
  [objectiveId: string]: ObjectiveProgress;
}

export interface CurriculumProgress {
  [chapterId: string]: ChapterProgress;
}

export interface UserProgress {
  [curriculumId: string]: CurriculumProgress;
}

export async function getUserProgress(uid: string): Promise<UserProgress> {
  const data = await getUserData(uid);
  return (data?.progress as UserProgress) || {};
}

export async function completeObjective(
  uid: string,
  curriculumId: string,
  chapterId: string,
  objectiveId: string,
  xp: number
): Promise<void> {
  void uid;
  void xp;
  const { completeCurriculumObjective: complete } = await import('./economyApiService');
  await complete(curriculumId,chapterId,objectiveId);
}

export function countCompleted(
  progress: UserProgress,
  curriculumId: string,
  chapterId: string
): number {
  return Object.values(progress?.[curriculumId]?.[chapterId] || {})
    .filter(o => o.mastered).length;
}

export function isObjectiveDone(
  progress: UserProgress,
  curriculumId: string,
  chapterId: string,
  objectiveId: string
): boolean {
  return !!progress?.[curriculumId]?.[chapterId]?.[objectiveId]?.mastered;
}

export function getChapterCompletedCount(
  progress: UserProgress,
  curriculumId: string,
  chapterId: string,
  totalObjectives: number
): { completed: number; total: number; pct: number } {
  const completed = countCompleted(progress, curriculumId, chapterId);
  return { completed, total: totalObjectives, pct: totalObjectives > 0 ? Math.round((completed / totalObjectives) * 100) : 0 };
}

export function getCurriculumCompletedCount(
  progress: UserProgress,
  curriculumId: string,
  chapters: Array<{ id: string; objectives: Array<{ id: string }> }>
): { completed: number; total: number; pct: number } {
  let completed = 0;
  let total = 0;
  for (const ch of chapters) {
    total += ch.objectives.length;
    completed += countCompleted(progress, curriculumId, ch.id);
  }
  return { completed, total, pct: total > 0 ? Math.round((completed / total) * 100) : 0 };
}
