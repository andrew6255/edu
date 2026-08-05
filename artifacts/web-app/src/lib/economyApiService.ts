import { requireSupabase } from './supabase';

export interface EconomyBalance { gold: number; xp: number; energy: number; gems: number; rankedEnergyStreak?: number }
export interface EconomyGrantResult { applied: boolean; balance: EconomyBalance }
export type ProgramAnswer = { kind: 'mcq'; choiceIndex: number } | { kind: 'numeric' | 'text'; valueText: string };
export interface ProgramAnswerReveal {
  solutionText: string | null;
  explanationScenes: Array<Record<string, unknown>>;
  stepExplanations: Array<{ id: string; title: string; explanation: string }>;
}
export interface ServerProgramGrade {
  correct: boolean;
  correctIndex: number;
  status: 'graded' | 'pending_review';
  method: 'deterministic' | 'fallback';
  feedbackText?: string | null;
  reveal?: ProgramAnswerReveal;
}
export type GradedEconomyResult = EconomyGrantResult & { grade: ServerProgramGrade };
export interface RoadmapRewardResult extends EconomyGrantResult { reward: { gold: number } }
export interface ChronoTaskRewardResult extends EconomyGrantResult {
  reward: { coins: number; energy: number; gems: number };
}

function apiUrl(): string {
  return (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
}

async function accessToken(): Promise<string> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication required.');
  return token;
}

async function economyRequest(path: string, body?: Record<string, unknown>): Promise<EconomyGrantResult> {
  const token = await accessToken();
  const response = await fetch(apiUrl() + '/api/economy/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json() as EconomyGrantResult & { error?: string };
  if (!response.ok) throw new Error(result.error || 'Economy operation failed.');
  return result;
}

export async function claimDailyEnergy(): Promise<EconomyGrantResult> {
  return economyRequest('daily-energy');
}

export async function recordStudyAnswer(sourceId: string, answer: ProgramAnswer): Promise<GradedEconomyResult> {
  return economyRequest('study-answer', { sourceId, answer }) as Promise<GradedEconomyResult>;
}

export interface RankedProgramAnswerResult {
  trophies: number;
  correctIds: string[];
  incorrectIds: string[];
  economy: EconomyGrantResult;
  grade: ServerProgramGrade;
}

export async function recordRankedProgramAnswer(programId: string, questionId: string, answer: ProgramAnswer): Promise<RankedProgramAnswerResult> {
  return economyRequest('ranked-program-answer', { programId, questionId, answer }) as unknown as Promise<RankedProgramAnswerResult>;
}

export async function gradePublishedProgramAnswer(programId: string, questionId: string, answer: ProgramAnswer): Promise<ServerProgramGrade> {
  const result = await economyRequest('program-grade', { programId, questionId, answer }) as unknown as { grade: ServerProgramGrade };
  return result.grade;
}

export async function claimRoadmapEconomyReward(programId: string, milestone: number): Promise<RoadmapRewardResult> {
  return economyRequest('roadmap-reward', { programId, milestone }) as Promise<RoadmapRewardResult>;
}

export async function claimChronoTaskEconomyReward(taskId: string): Promise<ChronoTaskRewardResult> {
  return economyRequest('chrono-task', { taskId }) as Promise<ChronoTaskRewardResult>;
}

export async function purchaseChronoCardUpgrade(cardId: string): Promise<EconomyGrantResult & { card: { copies: number; level: number }; cost: number }> {
  return economyRequest('chrono/card-upgrade', { cardId }) as Promise<EconomyGrantResult & { card: { copies: number; level: number }; cost: number }>;
}

export async function purchaseChronoToken(tokenId: string): Promise<EconomyGrantResult & { tokenId: string; cost: number }> {
  return economyRequest('chrono/token-purchase', { tokenId }) as Promise<EconomyGrantResult & { tokenId: string; cost: number }>;
}

export async function spinChronoWheel(spinId: string): Promise<EconomyGrantResult & { result: { segmentId: string; cardId?: string; transportId?: string } }> {
  return economyRequest('chrono/wheel-spin', { spinId }) as Promise<EconomyGrantResult & { result: { segmentId: string; cardId?: string; transportId?: string } }>;
}

export async function purchaseChronoPack(packId: string, purchaseId: string): Promise<EconomyGrantResult & { result: { packId: string; cardIds: string[]; transportId?: string } }> {
  return economyRequest('chrono/pack-purchase', { packId, purchaseId }) as Promise<EconomyGrantResult & { result: { packId: string; cardIds: string[]; transportId?: string } }>;
}

export async function sendChronoEnergyGift(toUserId: string): Promise<EconomyGrantResult> {
  return economyRequest('chrono/energy-gift', { toUserId });
}

export async function claimChronoIdleVault(): Promise<EconomyGrantResult & { coins: number }> {
  return economyRequest('chrono/idle-vault-claim') as Promise<EconomyGrantResult & { coins: number }>;
}

export async function claimChronoRewardChestEconomy(): Promise<EconomyGrantResult & { reward: { coins: number; gems: number; energy: number; cardId?: string } }> {
  return economyRequest('chrono/reward-chest-claim') as Promise<EconomyGrantResult & { reward: { coins: number; gems: number; energy: number; cardId?: string } }>;
}

export async function claimChronoCollectionSet(setId: string): Promise<EconomyGrantResult & { reward: { coins: number; gems: number; energy: number } }> {
  return economyRequest('chrono/collection-set-claim', { setId }) as Promise<EconomyGrantResult & { reward: { coins: number; gems: number; energy: number } }>;
}

export async function claimChronoGemMilestone(milestoneId: string): Promise<EconomyGrantResult & { reward: { gems: number } }> {
  return economyRequest('chrono/gem-milestone-claim', { milestoneId }) as Promise<EconomyGrantResult & { reward: { gems: number } }>;
}

export async function claimChronoBattlePassTier(tier: number): Promise<EconomyGrantResult & { reward: { coins: number; gems: number; energy: number }; xp: number }> {
  return economyRequest('chrono/battle-pass-claim', { tier }) as Promise<EconomyGrantResult & { reward: { coins: number; gems: number; energy: number }; xp: number }>;
}

export async function claimMultiplayerReward(sessionId: string): Promise<EconomyGrantResult & { reward: { gold: number; xp: number }; result: 'win' | 'draw' | 'loss' }> {
  return economyRequest('multiplayer-reward', { sessionId }) as Promise<EconomyGrantResult & { reward: { gold: number; xp: number }; result: 'win' | 'draw' | 'loss' }>;
}

export async function startRankedMatchmaking(gameId: string, attemptId: string): Promise<EconomyGrantResult & { matched: boolean; entryId: string; session?: unknown }> {
  return economyRequest('matchmaking/start', { gameId, attemptId }) as Promise<EconomyGrantResult & { matched: boolean; entryId: string; session?: unknown }>;
}

export async function cancelRankedMatchmaking(gameId: string, attemptId: string): Promise<EconomyGrantResult> {
  return economyRequest('matchmaking/cancel', { gameId, attemptId });
}

export async function startRankedBotMatch(gameId: string, attemptId: string): Promise<{ matched: true; entryId: string; session: unknown }> {
  return economyRequest('matchmaking/bot', { gameId, attemptId }) as unknown as Promise<{ matched: true; entryId: string; session: unknown }>;
}

export async function acceptMultiplayerChallenge(challengeId: string): Promise<Record<string, unknown>> {
  return economyRequest('multiplayer/challenge/accept', { challengeId }) as unknown as Promise<Record<string, unknown>>;
}

export async function sendMultiplayerChallenge(toUsername: string, gameId: string, gameLabel: string): Promise<{ success: true; challengeId: string }> {
  return economyRequest('multiplayer/challenge/send', { toUsername, gameId, gameLabel }) as unknown as Promise<{ success: true; challengeId: string }>;
}

export async function cancelMultiplayerChallenge(challengeId: string): Promise<Record<string, unknown>> {
  return economyRequest('multiplayer/challenge/cancel', { challengeId }) as unknown as Promise<Record<string, unknown>>;
}

export async function declineMultiplayerChallenge(challengeId: string): Promise<Record<string, unknown>> {
  return economyRequest('multiplayer/challenge/decline', { challengeId }) as unknown as Promise<Record<string, unknown>>;
}

export async function submitMultiplayerScore(sessionId: string, round: number, score: number): Promise<Record<string, unknown>> {
  return economyRequest('multiplayer/score', { sessionId, round, score }) as unknown as Promise<Record<string, unknown>>;
}

export async function resolveMultiplayerRound(sessionId: string, round: number): Promise<Record<string, unknown>> {
  return economyRequest('multiplayer/resolve', { sessionId, round }) as unknown as Promise<Record<string, unknown>>;
}

export async function forfeitMultiplayerSession(sessionId: string): Promise<Record<string, unknown>> {
  return economyRequest('multiplayer/forfeit', { sessionId }) as unknown as Promise<Record<string, unknown>>;
}

export async function sendMultiplayerQuickChat(sessionId: string, text: string): Promise<Record<string, unknown>> {
  return economyRequest('multiplayer/quick-chat', { sessionId, text }) as unknown as Promise<Record<string, unknown>>;
}

export async function rollChronoBoard(boardId: number, payBail: boolean, turnId: string): Promise<EconomyGrantResult & { progress: Record<string, unknown>; gold: number }> {
  return economyRequest('chrono/board-roll',{boardId,payBail,turnId}) as Promise<EconomyGrantResult & {progress:Record<string,unknown>;gold:number}>;
}

export async function completeCurriculumObjective(curriculumId:string,chapterId:string,objectiveId:string):Promise<EconomyGrantResult>{
  return economyRequest('curriculum-objective',{curriculumId,chapterId,objectiveId});
}

export async function startArenaBattle(enemyId:string):Promise<{sessionId:string;enemyId:string;startedAt:string}>{
  return economyRequest('arena/start',{enemyId}) as unknown as Promise<{sessionId:string;enemyId:string;startedAt:string}>;
}

export async function completeArenaBattle(sessionId:string,won:boolean,stats:Record<string,number>):Promise<EconomyGrantResult&{reward:{gold:number;xp:number};won:boolean}>{
  return economyRequest('arena/complete',{sessionId,won,stats}) as Promise<EconomyGrantResult&{reward:{gold:number;xp:number};won:boolean}>;
}

export async function applyAdminEconomyAdjustment(userId:string,deltas:{gold:number;xp:number;energy:number;streak:number},reason:string):Promise<EconomyGrantResult>{
  return economyRequest('admin-adjust',{userId,deltas,reason});
}

export interface EconomyReconciliationReport{checkedAt:string;mismatchCount:number;mismatches:Array<Record<string,unknown>>;untrackedWalletCount:number;untrackedWallets:Array<Record<string,unknown>>}
export async function getEconomyReconciliationReport():Promise<EconomyReconciliationReport>{
  return economyRequest('admin-reconciliation') as unknown as Promise<EconomyReconciliationReport>;
}
