import { classToBoard, gemsToClass } from '@/lib/chronoCards';
import { getChronoEmpiresState } from '@/lib/chronoEmpiresService';
import { getUserDoc, setUserDoc, updateUserDoc } from '@/lib/supabaseDocStore';
import { getUserData, updateEconomy, type UserData } from '@/lib/userService';

export interface ChronoFriendLeaderboardEntry {
  uid: string;
  username: string;
  classLevel: number;
  gems: number;
  currentBoard: number;
  lastActive: string;
  isYou: boolean;
}

export interface ChronoFriendGiftStatus {
  uid: string;
  username: string;
  canSend: boolean;
  sentToday: boolean;
  lastSentAt?: string;
}

export interface ChronoFriendsSnapshot {
  leaderboard: ChronoFriendLeaderboardEntry[];
  gifts: ChronoFriendGiftStatus[];
}

export type SendChronoEnergyGiftResult =
  | { ok: true }
  | { ok: false; reason: string };

interface ChronoFriendGiftsStateDoc {
  sent: Record<string, string>;
  updatedAt: string;
}

const GIFTS_COL = 'chrono_friend_gifts';
const GIFTS_DOC = 'state';

function nowIso(): string {
  return new Date().toISOString();
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyGiftState(): ChronoFriendGiftsStateDoc {
  return {
    sent: {},
    updatedAt: nowIso(),
  };
}

async function getGiftState(uid: string): Promise<ChronoFriendGiftsStateDoc> {
  const raw = await getUserDoc(uid, GIFTS_COL, GIFTS_DOC);
  if (!raw) {
    const init = emptyGiftState();
    await setUserDoc(uid, GIFTS_COL, GIFTS_DOC, init as any);
    return init;
  }
  const d = raw as Partial<ChronoFriendGiftsStateDoc>;
  return {
    sent: d.sent && typeof d.sent === 'object' ? d.sent as Record<string, string> : {},
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : nowIso(),
  };
}

async function resolveFriendEntry(uid: string, selfUid: string): Promise<ChronoFriendLeaderboardEntry | null> {
  const data = await getUserData(uid);
  if (!data) return null;
  const gems = typeof data.economy?.gems === 'number' ? data.economy.gems : 0;
  const fallbackBoard = classToBoard(gemsToClass(gems));
  let currentBoard = fallbackBoard;
  try {
    const chrono = await getChronoEmpiresState(uid);
    currentBoard = chrono?.currentBoard ?? fallbackBoard;
  } catch {
  }
  return {
    uid,
    username: data.username || 'Unknown',
    classLevel: gemsToClass(gems),
    gems,
    currentBoard,
    lastActive: data.last_active || '',
    isYou: uid === selfUid,
  };
}

export async function getChronoFriendsSnapshot(uid: string, userData: UserData): Promise<ChronoFriendsSnapshot> {
  const friendUids = Array.isArray(userData.friends) ? userData.friends : [];
  const allUids = Array.from(new Set([uid, ...friendUids]));
  const [entries, giftState] = await Promise.all([
    Promise.all(allUids.map((id) => resolveFriendEntry(id, uid))),
    getGiftState(uid),
  ]);

  const leaderboard = entries
    .filter((entry): entry is ChronoFriendLeaderboardEntry => !!entry)
    .sort((a, b) => b.classLevel - a.classLevel || b.gems - a.gems || b.currentBoard - a.currentBoard || a.username.localeCompare(b.username));

  const today = todayKey();
  const gifts = leaderboard
    .filter((entry) => !entry.isYou)
    .map((entry) => {
      const lastSentAt = giftState.sent[entry.uid];
      const sentToday = lastSentAt === today;
      return {
        uid: entry.uid,
        username: entry.username,
        canSend: !sentToday,
        sentToday,
        lastSentAt,
      };
    });

  return { leaderboard, gifts };
}

export async function sendChronoEnergyGift(fromUid: string, toUid: string): Promise<SendChronoEnergyGiftResult> {
  if (!fromUid || !toUid) return { ok: false, reason: 'Missing user.' };
  if (fromUid === toUid) return { ok: false, reason: 'Cannot gift yourself.' };

  const [fromData, toData, giftState] = await Promise.all([
    getUserData(fromUid),
    getUserData(toUid),
    getGiftState(fromUid),
  ]);
  if (!fromData || !toData) return { ok: false, reason: 'Friend not found.' };

  const myFriends = Array.isArray(fromData.friends) ? fromData.friends : [];
  const theirFriends = Array.isArray(toData.friends) ? toData.friends : [];
  if (!myFriends.includes(toUid) || !theirFriends.includes(fromUid)) {
    return { ok: false, reason: 'You are no longer friends.' };
  }

  const today = todayKey();
  if (giftState.sent[toUid] === today) {
    return { ok: false, reason: 'Already sent today.' };
  }

  try {
    await updateEconomy(toUid, { energy: 1 });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Failed to send gift.' };
  }

  const nextSent = { ...giftState.sent, [toUid]: today };
  if (await getUserDoc(fromUid, GIFTS_COL, GIFTS_DOC)) {
    await updateUserDoc(fromUid, GIFTS_COL, GIFTS_DOC, {
      sent: nextSent,
      updatedAt: nowIso(),
    });
  } else {
    await setUserDoc(fromUid, GIFTS_COL, GIFTS_DOC, {
      sent: nextSent,
      updatedAt: nowIso(),
    } as any);
  }

  return { ok: true };
}
