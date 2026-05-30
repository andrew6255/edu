import { getGlobalDoc, setGlobalDoc, updateGlobalDoc } from '@/lib/supabaseDocStore';
import { LeaderboardEntry } from '@/types/warmup';

const TOP_N = 5;

export async function getLeaderboard(gameId: string): Promise<LeaderboardEntry[]> {
  const raw = await getGlobalDoc('leaderboards', gameId);
  if (!raw) return [];
  return (raw.scores as LeaderboardEntry[]) || [];
}

export async function submitScore(
  gameId: string,
  uid: string,
  username: string,
  score: number
): Promise<{ newBest: boolean; rank: number | null }> {
  const raw = await getGlobalDoc('leaderboards', gameId);
  let scores: LeaderboardEntry[] = raw ? (raw.scores as LeaderboardEntry[] || []) : [];

  const existing = scores.find(e => e.uid === uid);
  if (existing && existing.score >= score) {
    const rank = scores.findIndex(e => e.uid === uid) + 1;
    return { newBest: false, rank: rank <= TOP_N ? rank : null };
  }

  scores = scores.filter(e => e.uid !== uid);
  scores.push({ uid, username, score, achievedAt: new Date().toISOString() });
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, TOP_N);

  await setGlobalDoc('leaderboards', gameId, { scores }, true);

  const rank = scores.findIndex(e => e.uid === uid) + 1;
  return { newBest: true, rank: rank <= TOP_N ? rank : null };
}
