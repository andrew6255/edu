import { requireSupabase, getAdminClient } from './supabase';
import { getGlobalDoc, setGlobalDoc } from './supabaseDocStore';

export type UserRole = 'student' | 'superadmin' | 'admin' | 'teacher' | 'teacher_assistant' | 'parent';

const VALID_ROLES: UserRole[] = ['student', 'superadmin', 'admin', 'teacher', 'teacher_assistant', 'parent'];

export interface SubjectConfig {
  textbook: string;
  isVisible: boolean;
}

export interface CurriculumProfile {
  system: string;
  year: string;
  subjects?: {
    mathematics: SubjectConfig;
    physics: SubjectConfig;
    chemistry: SubjectConfig;
    biology: SubjectConfig;
  };
}

export interface ArenaStats {
  wins: number;
  losses: number;
  highestStreak: number;
}

export interface UserData {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: UserRole;
  classId?: string;
  economy: { gold: number; global_xp: number; streak: number; energy?: number; rankedEnergyStreak?: number };
  curriculums: Record<string, { trophies: number }>;
  curriculumProfile?: CurriculumProfile;
  onboardingComplete?: boolean;
  inventory: { stories: string[]; badges: string[]; banners: string[]; mapThemes: string[] };
  equipped: { mapTheme: string; banner: string; badges: string[] };
  high_scores: Record<string, number>;
  arenaStats?: ArenaStats;
  warmup_date?: string;
  played_categories?: string[];
  analytics?: Record<string, Record<string, { mastered?: boolean }>>;
  friends: string[];
  incomingRequests: string[];
  outgoingRequests: string[];
  rankedStats?: Record<string, { wins: number; losses: number; highestStreak: number; currentStreak?: number }>;
  progress?: Record<string, Record<string, Record<string, { mastered: boolean; xpAwarded: number; completedAt?: string }>>>;
  warmupVariantsMigrated?: boolean;
  last_active?: string;

  // Program maps (public books)
  assignedProgramIds?: string[];
  activeProgramIds?: string[];
  activeProgramId?: string | null;
  completedProgramIds?: string[];
}

export interface AppNotification {
  id: string;
  fromUid: string;
  fromUsername: string;
  type: 'friendRequest' | 'challenge' | 'system';
  message: string;
  createdAt: string;
  read: boolean;
  resolved?: boolean;
  resolvedAt?: string;
  challengeId?: string;
  gameId?: string;
  gameLabel?: string;
}

export const SUPER_ADMIN_UID = 'SUPERADMIN_0000';

const DEFAULT_USER: Partial<UserData> = {
  role: 'student',
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  economy: { gold: 200, global_xp: 0, streak: 0, energy: 0, rankedEnergyStreak: 0 },
  arenaStats: { wins: 0, losses: 0, highestStreak: 0 },
  curriculums: {},
  inventory: { stories: [], badges: ['badge_pioneer'], banners: ['default'], mapThemes: ['theme-standard', 'theme-hex'] },
  equipped: { mapTheme: 'theme-standard', banner: 'default', badges: ['badge_pioneer'] },
  high_scores: {
    quickMath_10s: 0, quickMath_60s: 0,
    advQuickMath_10s: 0, advQuickMath_60s: 0,
    trueFalse_10s: 0, trueFalse_60s: 0,
    compareExp_10s: 0, compareExp_60s: 0,
    missingOp_10s: 0, missingOp_60s: 0,
    completeEq_10s: 0, completeEq_60s: 0,
    sequence_10s: 0, sequence_60s: 0,
    numGrid: 0, blockPuzzle: 0, ticTacToe: 0,
    fifteenPuzzle: 0, memoOrder: 0, pyramid: 0, memoCells: 0,
    chessMemory: 0, nameSquare10: 0, nameSquare60: 0, findSquare10: 0, findSquare60: 0
  },
  warmup_date: '',
  played_categories: [],
  last_active: new Date().toISOString().split('T')[0]
};

function mergeUserData(base: Partial<UserData> | null | undefined, patch: Partial<UserData> | null | undefined): UserData {
  const b = base ?? {};
  const p = patch ?? {};
  const economyBase = (b.economy ?? DEFAULT_USER.economy ?? {}) as UserData['economy'];
  const economyPatch = (p.economy ?? {}) as Partial<UserData['economy']>;
  return {
    ...(DEFAULT_USER as UserData),
    ...b,
    ...p,
    economy: {
      ...economyBase,
      ...economyPatch,
    },
  } as UserData;
}

function mapSupabaseUserRow(profile: Record<string, unknown>, economy: Record<string, unknown> | null): UserData {
  const state = (profile.user_state && typeof profile.user_state === 'object') ? (profile.user_state as Partial<UserData>) : {};
  return mergeUserData(state, {
    firstName: typeof profile.first_name === 'string' ? profile.first_name : '',
    lastName: typeof profile.last_name === 'string' ? profile.last_name : '',
    username: typeof profile.username === 'string' ? profile.username : '',
    email: typeof profile.email === 'string' ? profile.email : '',
    role: VALID_ROLES.includes(profile.role as UserRole) ? (profile.role as UserRole) : 'student',
    classId: typeof profile.class_id === 'string' ? profile.class_id : undefined,
    onboardingComplete: typeof profile.onboarding_complete === 'boolean' ? profile.onboarding_complete : undefined,
    curriculumProfile: (profile.curriculum_profile && typeof profile.curriculum_profile === 'object') ? (profile.curriculum_profile as CurriculumProfile) : undefined,
    arenaStats: (profile.arena_stats && typeof profile.arena_stats === 'object') ? (profile.arena_stats as ArenaStats) : undefined,
    economy: {
      gold: typeof economy?.gold === 'number' ? economy.gold : ((state.economy?.gold as number | undefined) ?? 0),
      global_xp: typeof economy?.global_xp === 'number' ? economy.global_xp : ((state.economy?.global_xp as number | undefined) ?? 0),
      streak: typeof economy?.streak === 'number' ? economy.streak : ((state.economy?.streak as number | undefined) ?? 0),
      energy: typeof economy?.energy === 'number' ? economy.energy : ((state.economy?.energy as number | undefined) ?? 0),
      rankedEnergyStreak: typeof economy?.ranked_energy_streak === 'number' ? economy.ranked_energy_streak : ((state.economy?.rankedEnergyStreak as number | undefined) ?? 0),
    },
  });
}

function toSupabaseProfile(uid: string, data: Partial<UserData>): Record<string, unknown> {
  return {
    id: uid,
    email: data.email,
    username: data.username,
    first_name: data.firstName,
    last_name: data.lastName,
    role: data.role,
    class_id: data.classId,
    onboarding_complete: data.onboardingComplete,
    curriculum_profile: data.curriculumProfile,
    arena_stats: data.arenaStats,
    user_state: data,
    updated_at: new Date().toISOString(),
  };
}

function toSupabaseEconomy(uid: string, data: Partial<UserData>): Record<string, unknown> | null {
  const econ = data.economy;
  if (!econ) return null;
  return {
    user_id: uid,
    gold: typeof econ.gold === 'number' ? econ.gold : 0,
    global_xp: typeof econ.global_xp === 'number' ? econ.global_xp : 0,
    streak: typeof econ.streak === 'number' ? econ.streak : 0,
    energy: typeof econ.energy === 'number' ? econ.energy : 0,
    ranked_energy_streak: typeof econ.rankedEnergyStreak === 'number' ? econ.rankedEnergyStreak : 0,
    updated_at: new Date().toISOString(),
  };
}

async function getSupabaseUserData(uid: string): Promise<UserData | null> {
  const supabase = requireSupabase();
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  if (!profile) return null;
  const { data: economy, error: economyError } = await supabase.from('user_economy').select('*').eq('user_id', uid).maybeSingle();
  if (economyError) throw economyError;
  return mapSupabaseUserRow(profile as Record<string, unknown>, (economy ?? null) as Record<string, unknown> | null);
}

export async function getUserData(uid: string): Promise<UserData | null> {
  return getSupabaseUserData(uid);
}

export async function migrateWarmupVariantsIfNeeded(uid: string): Promise<boolean> {
  const data = await getUserData(uid);
  if (!data) return false;
  if (data.warmupVariantsMigrated) return false;

  const hs = data.high_scores ?? {};
  const rs = data.rankedStats ?? {};

  const newHighScores = { ...hs };
  const newRanked = { ...(rs as Record<string, any>) };

  const hi = (key: string) => (typeof (hs as any)[key] === 'number' ? ((hs as any)[key] as number) : 0);
  const rstat = (key: string) => ((rs as any)[key] as any) ?? null;

  function migrateScore(fromKey: string, toKey: string) {
    const from = hi(fromKey);
    const to = hi(toKey);
    if (from > to) (newHighScores as any)[toKey] = from;
  }

  function migrateRanked(fromKey: string, toKey: string) {
    const from = rstat(fromKey);
    const to = rstat(toKey);
    if (from && !to) newRanked[toKey] = from;
  }

  migrateScore('quickMath', 'quickMath_10s');
  migrateScore('timeLimit', 'quickMath_60s');
  migrateScore('advQuickMath', 'advQuickMath_10s');
  migrateScore('advQuickMath', 'advQuickMath_60s');
  migrateScore('trueFalse', 'trueFalse_10s');
  migrateScore('trueFalse', 'trueFalse_60s');
  migrateScore('compareExp', 'compareExp_10s');
  migrateScore('compareExp', 'compareExp_60s');
  migrateScore('missingOp', 'missingOp_10s');
  migrateScore('missingOp', 'missingOp_60s');
  migrateScore('completeEq', 'completeEq_10s');
  migrateScore('completeEq', 'completeEq_60s');
  migrateScore('sequence', 'sequence_10s');
  migrateScore('sequence', 'sequence_60s');

  migrateRanked('quickMath', 'quickMath_10s');
  migrateRanked('timeLimit', 'quickMath_60s');
  migrateRanked('advQuickMath', 'advQuickMath_10s');
  migrateRanked('advQuickMath', 'advQuickMath_60s');
  migrateRanked('trueFalse', 'trueFalse_10s');
  migrateRanked('trueFalse', 'trueFalse_60s');
  migrateRanked('compareExp', 'compareExp_10s');
  migrateRanked('compareExp', 'compareExp_60s');
  migrateRanked('missingOp', 'missingOp_10s');
  migrateRanked('missingOp', 'missingOp_60s');
  migrateRanked('completeEq', 'completeEq_10s');
  migrateRanked('completeEq', 'completeEq_60s');
  migrateRanked('sequence', 'sequence_10s');
  migrateRanked('sequence', 'sequence_60s');

  await updateUserData(uid, {
    warmupVariantsMigrated: true,
    high_scores: newHighScores,
    rankedStats: newRanked,
  } as Partial<UserData>);
  return true;
}

export async function createUserData(uid: string, data: Partial<UserData>): Promise<void> {
  const supabase = requireSupabase();
  const merged = mergeUserData(DEFAULT_USER, data);
  const { error } = await supabase.from('profiles').upsert(toSupabaseProfile(uid, {
    ...merged,
    last_active: new Date().toISOString().split('T')[0],
  }));
  if (error) throw error;
  const econ = toSupabaseEconomy(uid, merged);
  if (econ) {
    const { error: econError } = await supabase.from('user_economy').upsert(econ);
    if (econError) throw econError;
  }
}

export async function updateUserData(uid: string, updates: Partial<UserData>): Promise<void> {
  const supabase = requireSupabase();
  const current = await getSupabaseUserData(uid);
  const merged = mergeUserData(current ?? DEFAULT_USER, updates);
  const { error } = await supabase.from('profiles').upsert(toSupabaseProfile(uid, merged));
  if (error) throw error;
  const econ = toSupabaseEconomy(uid, merged);
  if (econ) {
    const { error: econError } = await supabase.from('user_economy').upsert(econ);
    if (econError) throw econError;
  }
}

export async function deleteUserData(uid: string): Promise<void> {
  const supabase = requireSupabase();

  // Look up if this is a student or parent to cascade-delete the pair
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).limit(1).single();
  const role = profile?.role as string | undefined;

  let pairedUid: string | null = null;

  if (role === 'student' || role === 'parent') {
    // Find the paired account
    if (role === 'student') {
      const { data: link } = await supabase.from('parent_student_links').select('parent_id').eq('student_id', uid).limit(1);
      pairedUid = link?.[0]?.parent_id ?? null;
    } else {
      const { data: link } = await supabase.from('parent_student_links').select('student_id').eq('parent_id', uid).limit(1);
      pairedUid = link?.[0]?.student_id ?? null;
    }

    // Use cascade RPC for student (it deletes both student + parent app data)
    const studentUid = role === 'student' ? uid : pairedUid;
    if (studentUid) {
      const { error } = await supabase.rpc('admin_delete_student_and_parent', { target_student_uid: studentUid });
      if (error) throw error;
    } else {
      // No link found, just delete this user
      const { error } = await supabase.rpc('admin_delete_user', { target_uid: uid });
      if (error) throw error;
    }
  } else {
    // Non-student/parent: simple delete
    const { error } = await supabase.rpc('admin_delete_user', { target_uid: uid });
    if (error) throw error;
  }

  // Delete auth user(s) via Admin API
  try {
    const admin = getAdminClient();
    const { error: authError } = await admin.auth.admin.deleteUser(uid);
    if (authError) console.error('Failed to delete auth user:', authError);
    if (pairedUid) {
      const { error: pairedAuthError } = await admin.auth.admin.deleteUser(pairedUid);
      if (pairedAuthError) console.error('Failed to delete paired auth user:', pairedAuthError);
    }
  } catch (e) {
    console.error('Admin client error (is VITE_SUPABASE_SERVICE_ROLE_KEY set?):', e);
  }
}

export async function updateHighScore(uid: string, gameId: string, score: number): Promise<void> {
  const current = await getUserData(uid);
  if (!current) return;
  const next = { ...(current.high_scores ?? {}), [gameId]: score };
  await updateUserData(uid, { high_scores: next });
}

export interface EconomyDeltas {
  gold?: number;
  xp?: number;
  energy?: number;
  streak?: number;
}

export async function updateEconomy(uid: string, deltas: EconomyDeltas): Promise<void> {
  const current = await getUserData(uid);
  if (!current) return;
  const econ = current.economy ?? {};
  await updateUserData(uid, {
    economy: {
      ...econ,
      gold: Math.max(0, (econ.gold || 0) + (deltas.gold || 0)),
      global_xp: Math.max(0, (econ.global_xp || 0) + (deltas.xp || 0)),
      energy: Math.max(0, (econ.energy || 0) + (deltas.energy || 0)),
      streak: Math.max(0, (econ.streak || 0) + (deltas.streak || 0)),
    },
    last_active: new Date().toISOString().split('T')[0],
  });
}

export async function adminGetStudentEconomy(uid: string): Promise<{ gold: number; global_xp: number; energy: number; streak: number }> {
  const admin = getAdminClient();
  const { data } = await admin.from('user_economy').select('gold, global_xp, energy, streak').eq('user_id', uid).maybeSingle();
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    gold: typeof d.gold === 'number' ? d.gold : 0,
    global_xp: typeof d.global_xp === 'number' ? d.global_xp : 0,
    energy: typeof d.energy === 'number' ? d.energy : 0,
    streak: typeof d.streak === 'number' ? d.streak : 0,
  };
}

export async function adminUpdateEconomy(uid: string, deltas: EconomyDeltas): Promise<void> {
  const admin = getAdminClient();
  const { data: existing } = await admin.from('user_economy').select('gold, global_xp, energy, streak').eq('user_id', uid).maybeSingle();
  const e = (existing ?? {}) as Record<string, unknown>;
  const cur = {
    gold: typeof e.gold === 'number' ? e.gold : 0,
    global_xp: typeof e.global_xp === 'number' ? e.global_xp : 0,
    energy: typeof e.energy === 'number' ? e.energy : 0,
    streak: typeof e.streak === 'number' ? e.streak : 0,
  };
  const next = {
    user_id: uid,
    gold: Math.max(0, cur.gold + (deltas.gold || 0)),
    global_xp: Math.max(0, cur.global_xp + (deltas.xp || 0)),
    energy: Math.max(0, cur.energy + (deltas.energy || 0)),
    streak: Math.max(0, cur.streak + (deltas.streak || 0)),
    updated_at: new Date().toISOString(),
  };
  await (admin.from('user_economy') as unknown as { upsert: (v: Record<string, unknown>, o?: Record<string, unknown>) => Promise<unknown> }).upsert(next, { onConflict: 'user_id' });
}

export async function applyRankedEnergyProgress(uid: string, correct: boolean): Promise<{ energy: number; rankedEnergyStreak: number } | null> {
  const current = await getUserData(uid);
  if (!current) return null;
  const econ = current.economy ?? { gold: 0, global_xp: 0, streak: 0, energy: 0, rankedEnergyStreak: 0 };
  const curEnergy = typeof econ.energy === 'number' ? Math.max(0, Math.floor(econ.energy)) : 0;
  const curStreak = typeof econ.rankedEnergyStreak === 'number' ? Math.max(0, Math.min(3, Math.floor(econ.rankedEnergyStreak))) : 0;
  let nextEnergy = curEnergy;
  let nextStreak = correct ? curStreak + 1 : 0;
  if (nextStreak >= 3) {
    nextEnergy += 1;
    nextStreak = 0;
  }
  await updateUserData(uid, {
    economy: {
      ...econ,
      energy: nextEnergy,
      rankedEnergyStreak: nextStreak,
    },
    last_active: new Date().toISOString().split('T')[0],
  });
  return { energy: nextEnergy, rankedEnergyStreak: nextStreak };
}

export async function findUserByUsername(username: string): Promise<{ email: string } | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('profiles').select('email').eq('username', username).limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return { email: String(data[0].email ?? '') };
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('profiles').select('id').eq('username', username).limit(1);
  if (error) throw error;
  return !!data && data.length > 0;
}

export async function getAllUsers(): Promise<Array<UserData & { uid: string }>> {
  const supabase = requireSupabase();
  const { data: profiles, error } = await supabase.from('profiles').select('*');
  if (error) throw error;
  const { data: economies, error: econError } = await supabase.from('user_economy').select('*');
  if (econError) throw econError;
  const econMap = new Map<string, Record<string, unknown>>(((economies ?? []) as Record<string, unknown>[]).map((row) => [String(row.user_id ?? ''), row]));
  return ((profiles ?? []) as Record<string, unknown>[]).map((profile) => ({
    uid: String(profile.id ?? ''),
    ...mapSupabaseUserRow(profile, econMap.get(String(profile.id ?? '')) ?? null),
  }));
}

export async function getUsersByClassId(classId: string): Promise<Array<UserData & { uid: string }>> {
  const supabase = requireSupabase();
  const { data: profiles, error } = await supabase.from('profiles').select('*').eq('class_id', classId);
  if (error) throw error;
  const { data: economies, error: econError } = await supabase.from('user_economy').select('*');
  if (econError) throw econError;
  const econMap = new Map<string, Record<string, unknown>>(((economies ?? []) as Record<string, unknown>[]).map((row) => [String(row.user_id ?? ''), row]));
  return ((profiles ?? []) as Record<string, unknown>[]).map((profile) => ({
    uid: String(profile.id ?? ''),
    ...mapSupabaseUserRow(profile, econMap.get(String(profile.id ?? '')) ?? null),
  }));
}

export async function updateArenaStats(uid: string, won: boolean, sessionHighestStreak: number): Promise<void> {
  const current = await getUserData(uid);
  if (!current) return;
  const arena = current.arenaStats ?? { wins: 0, losses: 0, highestStreak: 0 };
  await updateUserData(uid, {
    arenaStats: {
      wins: arena.wins + (won ? 1 : 0),
      losses: arena.losses + (won ? 0 : 1),
      highestStreak: Math.max(arena.highestStreak, sessionHighestStreak),
    },
    last_active: new Date().toISOString().split('T')[0],
  });
}

export async function updateRankedStats(uid: string, gameId: string, result: 'win' | 'loss' | 'draw'): Promise<void> {
  const currentUser = await getUserData(uid);
  if (!currentUser || result === 'draw') return;
  const current = currentUser.rankedStats?.[gameId] ?? { wins: 0, losses: 0, highestStreak: 0, currentStreak: 0 };
  const won = result === 'win';
  const newCurrentStreak = won ? (current.currentStreak || 0) + 1 : 0;
  const newHighestStreak = Math.max(current.highestStreak || 0, newCurrentStreak);
  await updateUserData(uid, {
    rankedStats: {
      ...(currentUser.rankedStats ?? {}),
      [gameId]: {
        wins: current.wins + (won ? 1 : 0),
        losses: current.losses + (won ? 0 : 1),
        highestStreak: newHighestStreak,
        currentStreak: newCurrentStreak,
      },
    },
    last_active: new Date().toISOString().split('T')[0],
  });
}

export async function sendFriendRequest(fromUid: string, fromUsername: string, toUsername: string): Promise<boolean> {
  const trimmed = toUsername.trim();
  const normalized = trimmed.toLowerCase();

  try {
    const supabase = requireSupabase();
    let { data: rows } = await supabase.from('profiles').select('id').eq('username', normalized).limit(1);
    if ((!rows || rows.length === 0) && trimmed !== normalized) {
      const res = await supabase.from('profiles').select('id').eq('username', trimmed).limit(1);
      rows = res.data;
    }
    if (!rows || rows.length === 0) return false;

    const toUid = String(rows[0].id);
    if (toUid === fromUid) return false;

    const toData = await getUserData(toUid);
    const fromData = await getUserData(fromUid);
    if (toData) {
      const friends = Array.isArray(toData.friends) ? toData.friends : [];
      const incoming = Array.isArray(toData.incomingRequests) ? toData.incomingRequests : [];
      const myFriends = fromData ? (Array.isArray(fromData.friends) ? fromData.friends : []) : [];

      const mutualFriends = friends.includes(fromUid) && myFriends.includes(toUid);
      if (mutualFriends) throw new Error('You are already friends');

      // If friendship is stale / one-sided, clean it up before proceeding.
      if (friends.includes(fromUid) && !myFriends.includes(toUid)) {
        await updateUserData(toUid, { friends: friends.filter(x => x !== fromUid) });
      }
      if (myFriends.includes(toUid) && !friends.includes(fromUid)) {
        await updateUserData(fromUid, { friends: myFriends.filter(x => x !== toUid) });
      }

      if (incoming.includes(fromUid)) {
        // Request already pending; we'll just bump the existing notification below.
      }
    }

    // Add to incoming/outgoing arrays
    const toDataFresh = await getUserData(toUid);
    const fromDataFresh = await getUserData(fromUid);
    const toIncoming = Array.from(new Set([...(toDataFresh?.incomingRequests ?? []), fromUid]));
    const fromOutgoing = Array.from(new Set([...(fromDataFresh?.outgoingRequests ?? []), toUid]));
    await updateUserData(toUid, { incomingRequests: toIncoming });
    await updateUserData(fromUid, { outgoingRequests: fromOutgoing });

    // Deduplicate: one friendRequest notification per sender->receiver.
    const notifId = `friendRequest_${fromUid}`;
    await setGlobalDoc(`notifications:${toUid}`, notifId, {
      id: notifId,
      fromUid,
      fromUsername,
      type: 'friendRequest',
      message: `${fromUsername} sent you a friend request.`,
      createdAt: new Date().toISOString(),
      read: false,
      resolved: false
    } as any, true);

    return true;
  } catch (e) {
    const err = e as { message?: string; code?: string };
    const msg = err?.message || 'Error sending request';
    const code = err?.code ? ` (${err.code})` : '';
    throw new Error(`${msg}${code}`);
  }
}

export async function respondToFriendRequest(uid: string, peerUid: string, accept: boolean): Promise<void> {
  const myData = await getUserData(uid);
  const peerData = await getUserData(peerUid);
  if (!myData || !peerData) return;

  const myIncoming = Array.isArray(myData.incomingRequests) ? myData.incomingRequests : [];
  const myFriends = Array.isArray(myData.friends) ? myData.friends : [];
  const peerOutgoing = Array.isArray(peerData.outgoingRequests) ? peerData.outgoingRequests : [];
  const peerFriends = Array.isArray(peerData.friends) ? peerData.friends : [];

  const nextMyIncoming = myIncoming.filter(x => x !== peerUid);
  const nextPeerOutgoing = peerOutgoing.filter(x => x !== uid);

  const nextMyFriends = accept
    ? Array.from(new Set([...myFriends, peerUid]))
    : myFriends;

  const nextPeerFriends = accept
    ? Array.from(new Set([...peerFriends, uid]))
    : peerFriends;

  await updateUserData(uid, {
    incomingRequests: nextMyIncoming,
    ...(accept ? { friends: nextMyFriends } : {}),
  });

  await updateUserData(peerUid, {
    outgoingRequests: nextPeerOutgoing,
    ...(accept ? { friends: nextPeerFriends } : {}),
  });
}

export async function removeFriend(uid: string, peerUid: string): Promise<void> {
  const myData = await getUserData(uid);
  const peerData = await getUserData(peerUid);
  if (!myData || !peerData) return;

  const myFriends = Array.isArray(myData.friends) ? myData.friends : [];
  const peerFriends = Array.isArray(peerData.friends) ? peerData.friends : [];

  const myHadPeer = myFriends.includes(peerUid);
  const peerHadMe = peerFriends.includes(uid);

  if (!myHadPeer && !peerHadMe) return;

  if (myHadPeer) {
    await updateUserData(uid, { friends: myFriends.filter(x => x !== peerUid) });
  }

  if (peerHadMe) {
    await updateUserData(peerUid, { friends: peerFriends.filter(x => x !== uid) });
  }
}

export async function submitCurriculumRequest(uid: string, username: string, profile: {
  system: string; year: string; textbook: string;
}): Promise<void> {
  await setGlobalDoc('curriculumRequests', `${uid}_${Date.now()}`, {
    uid, username, ...profile, requestedAt: new Date().toISOString(), status: 'pending'
  } as any);
}

export async function submitProgramMapRequest(uid: string, username: string, profile: {
  system: string; year: string; textbook: string;
}): Promise<void> {
  return submitCurriculumRequest(uid, username, profile);
}

// ─── Admin ↔ Teacher assignments ───────────────────────────────────────────

export interface AdminTeacherAssignment {
  admin_id: string;
  teacher_id: string;
}

export async function getAdminTeacherAssignments(): Promise<AdminTeacherAssignment[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase.from('admin_teacher_assignments').select('admin_id, teacher_id');
  if (error) throw error;
  return (data ?? []) as AdminTeacherAssignment[];
}

export async function addAdminTeacherAssignment(adminId: string, teacherId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('admin_teacher_assignments').upsert(
    { admin_id: adminId, teacher_id: teacherId, created_at: new Date().toISOString() },
    { onConflict: 'admin_id,teacher_id' }
  );
  if (error) throw error;
}

export async function removeAdminTeacherAssignment(adminId: string, teacherId: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('admin_teacher_assignments').delete().eq('admin_id', adminId).eq('teacher_id', teacherId);
  if (error) throw error;
}

// ─── Parent ↔ Student links ───────────────────────────────────────────────

export interface ParentStudentLink {
  parent_id: string;
  student_id: string;
}

export async function getParentStudentLinks(): Promise<ParentStudentLink[]> {
  const supabase = getAdminClient();
  const { data, error } = await supabase.from('parent_student_links').select('parent_id, student_id');
  if (error) throw error;
  return (data ?? []) as ParentStudentLink[];
}

export function computeLevel(xp: number): { level: number; title: string } {
  const levels = [
    { min: 0, title: 'Initiate' }, { min: 500, title: 'Apprentice' }, { min: 1500, title: 'Seeker' },
    { min: 3000, title: 'Scholar' }, { min: 6000, title: 'Adept' }, { min: 10000, title: 'Expert' },
    { min: 15000, title: 'Master' }, { min: 25000, title: 'Grandmaster' }, { min: 50000, title: 'Logic Lord' }
  ];
  let level = 1; let title = 'Initiate';
  for (let i = levels.length - 1; i >= 0; i--) {
    if (xp >= levels[i].min) { level = i + 1; title = levels[i].title; break; }
  }
  return { level, title };
}
