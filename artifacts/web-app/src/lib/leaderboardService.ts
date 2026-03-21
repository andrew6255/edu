import { db } from './firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { LeaderboardEntry } from '@/types/warmup';

const TOP_N = 5;

export async function getLeaderboard(gameId: string): Promise<LeaderboardEntry[]> {
  const snap = await getDoc(doc(db, 'leaderboards', gameId));
  if (!snap.exists()) return [];
  return (snap.data().scores as LeaderboardEntry[]) || [];
}

export async function submitScore(
  gameId: string,
  uid: string,
  username: string,
  score: number
): Promise<{ newBest: boolean; rank: number | null }> {
  const ref = doc(db, 'leaderboards', gameId);
  const snap = await getDoc(ref);
  let scores: LeaderboardEntry[] = snap.exists() ? (snap.data().scores || []) : [];

  const existing = scores.find(e => e.uid === uid);
  if (existing && existing.score >= score) {
    const rank = scores.findIndex(e => e.uid === uid) + 1;
    return { newBest: false, rank: rank <= TOP_N ? rank : null };
  }

  scores = scores.filter(e => e.uid !== uid);
  scores.push({ uid, username, score, achievedAt: new Date().toISOString() });
  scores.sort((a, b) => b.score - a.score);
  scores = scores.slice(0, TOP_N);

  const data = { scores };
  if (snap.exists()) await updateDoc(ref, data);
  else await setDoc(ref, data);

  const rank = scores.findIndex(e => e.uid === uid) + 1;
  return { newBest: true, rank: rank <= TOP_N ? rank : null };
}
