import { requireSupabase } from './supabase';
import { getGlobalDoc, setGlobalDoc } from './supabaseDocStore';
import { initializeEconomyWallet } from './economyApiService';
import { checkUsernameAvailable } from './authApiService';

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

export interface UserAppearanceSettings {
  appTheme: 'modern-dark' | 'minimal-focus' | 'ocean-breeze' | 'royal-ember';
}

export interface UserNotificationSettings {
  email: boolean;
  inApp: boolean;
  reminders: boolean;
}

export interface UserRolePreferenceSettings {
  dailyGoal?: number;
  defaultLandingTab?: string;
  parentDigestFrequency?: 'daily' | 'weekly';
  enableClassLeaderboard?: boolean;
}

export interface UserSettings {
  appearance: UserAppearanceSettings;
  notifications: UserNotificationSettings;
  rolePreferences: UserRolePreferenceSettings;
}

export interface UserData {
  firstName: string;
  lastName: string;
  username: string;
  friendCode?: string;
  email: string;
  role: UserRole;
  classId?: string;
  economy: { gold: number; global_xp: number; streak: number; energy?: number; rankedEnergyStreak?: number; gems?: number };
  curriculums: Record<string, { trophies: number }>;
  curriculumProfile?: CurriculumProfile;
  onboardingComplete?: boolean;
  birthDate?: string;
  countryCode?: string;
  createdAt?: string;
  guardianConsentStatus?: 'not_required' | 'pending' | 'granted' | 'revoked';
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
  settings?: UserSettings;
}

export interface AppNotification {
  id: string;
  fromUid: string;
  fromUsername: string;
  type: 'friendRequest' | 'challenge' | 'system' | 'lobbyInvite' | 'lobbyJoinRequest';
  message: string;
  createdAt: string;
  read: boolean;
  resolved?: boolean;
  resolvedAt?: string;
  challengeId?: string;
  gameId?: string;
  gameLabel?: string;
  /** Lobby ID - present for lobbyInvite and lobbyJoinRequest */
  lobbyId?: string;
  /** Emoji of the requester - present for lobbyJoinRequest */
  fromEmoji?: string;
}

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
    chessMemory: 0, nameSquare_10s: 0, nameSquare_60s: 0, findSquare_10s: 0, findSquare_60s: 0
  },
  settings: {
    appearance: {
      appTheme: 'modern-dark',
    },
    notifications: {
      email: true,
      inApp: true,
      reminders: true,
    },
    rolePreferences: {},
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
  const settingsBase = (b.settings ?? DEFAULT_USER.settings ?? {}) as UserSettings;
  const settingsPatch = (p.settings ?? {}) as Partial<UserSettings>;
  const appearanceBase = settingsBase.appearance ?? DEFAULT_USER.settings?.appearance ?? { appTheme: 'modern-dark' };
  const notificationBase = settingsBase.notifications ?? DEFAULT_USER.settings?.notifications ?? { email: true, inApp: true, reminders: true };
  const rolePreferencesBase = settingsBase.rolePreferences ?? {};
  return {
    ...(DEFAULT_USER as UserData),
    ...b,
    ...p,
    economy: {
      ...economyBase,
      ...economyPatch,
    },
    settings: {
      appearance: {
        ...appearanceBase,
        ...(settingsPatch.appearance ?? {}),
      },
      notifications: {
        ...notificationBase,
        ...(settingsPatch.notifications ?? {}),
      },
      rolePreferences: {
        ...rolePreferencesBase,
        ...(settingsPatch.rolePreferences ?? {}),
      },
    },
  } as UserData;
}

function mapSupabaseUserRow(profile: Record<string, unknown>, economy: Record<string, unknown> | null): UserData {
  const state = (profile.user_state && typeof profile.user_state === 'object') ? (profile.user_state as Partial<UserData>) : {};
  return mergeUserData(state, {
    firstName: typeof profile.first_name === 'string' ? profile.first_name : '',
    lastName: typeof profile.last_name === 'string' ? profile.last_name : '',
    username: typeof profile.username === 'string' ? profile.username : '',
    friendCode: typeof state.friendCode === 'string' ? state.friendCode : undefined,
    email: typeof profile.email === 'string' ? profile.email : '',
    role: VALID_ROLES.includes(profile.role as UserRole) ? (profile.role as UserRole) : 'student',
    classId: typeof profile.class_id === 'string' ? profile.class_id : undefined,
    onboardingComplete: typeof profile.onboarding_complete === 'boolean' ? profile.onboarding_complete : undefined,
    birthDate: typeof profile.birth_date === 'string' ? profile.birth_date : undefined,
    countryCode: typeof profile.country_code === 'string' ? profile.country_code : undefined,
    createdAt: typeof profile.created_at === 'string' ? profile.created_at : undefined,
    guardianConsentStatus: profile.guardian_consent_status === 'pending' || profile.guardian_consent_status === 'granted' || profile.guardian_consent_status === 'revoked'
      ? profile.guardian_consent_status
      : 'not_required',
    curriculumProfile: (profile.curriculum_profile && typeof profile.curriculum_profile === 'object') ? (profile.curriculum_profile as CurriculumProfile) : undefined,
    arenaStats: (profile.arena_stats && typeof profile.arena_stats === 'object') ? (profile.arena_stats as ArenaStats) : undefined,
    economy: {
      gold: typeof economy?.gold === 'number' ? economy.gold : ((state.economy?.gold as number | undefined) ?? 0),
      global_xp: typeof economy?.global_xp === 'number' ? economy.global_xp : ((state.economy?.global_xp as number | undefined) ?? 0),
      streak: typeof economy?.streak === 'number' ? economy.streak : ((state.economy?.streak as number | undefined) ?? 0),
      energy: typeof economy?.energy === 'number' ? economy.energy : ((state.economy?.energy as number | undefined) ?? 0),
      rankedEnergyStreak: typeof economy?.ranked_energy_streak === 'number' ? economy.ranked_energy_streak : ((state.economy?.rankedEnergyStreak as number | undefined) ?? 0),
      gems: typeof economy?.gems === 'number' ? economy.gems : ((state.economy?.gems as number | undefined) ?? 0),
    },
  });
}

function toSupabaseProfile(uid: string, data: Partial<UserData>): Record<string, unknown> {
  const { economy: _economy, ...profileState } = data;
  const raw: Record<string, unknown> = {
    id: uid,
    email: data.email,
    username: data.username,
    first_name: data.firstName,
    last_name: data.lastName,
    role: data.role,
    class_id: data.classId,
    onboarding_complete: data.onboardingComplete,
    birth_date: data.birthDate,
    country_code: data.countryCode,
    guardian_consent_status: data.guardianConsentStatus,
    curriculum_profile: data.curriculumProfile,
    arena_stats: data.arenaStats,
    user_state: profileState,
    updated_at: new Date().toISOString(),
  };
  // Strip undefined values — Supabase returns 400 when they appear in PATCH/upsert
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
}

export async function requestGuardianConsent(studentId: string, guardianEmail: string): Promise<void> {
  const { error } = await requireSupabase().from('guardian_consents').insert({
    student_id: studentId,
    guardian_email: guardianEmail.trim().toLowerCase(),
    status: 'pending',
    policy_version: 'egypt-launch-v1',
    evidence: { source: 'student_registration' },
  });
  if (error) throw error;
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
  await initializeEconomyWallet();
}

export async function updateUserData(uid: string, updates: Partial<UserData>): Promise<void> {
  if (updates.economy) throw new Error('Direct economy updates are disabled; use an authenticated economy action.');
  const supabase = requireSupabase();
  const current = await getSupabaseUserData(uid);
  const merged = mergeUserData(current ?? DEFAULT_USER, updates);
  const { error } = await supabase.from('profiles').upsert(toSupabaseProfile(uid, merged));
  if (error) throw error;
}

export async function deleteUserData(uid: string): Promise<void> {
  const { deleteManagedUserAccount } = await import('./adminApiService');
  await deleteManagedUserAccount(uid);
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
  gems?: number;
}

export async function updateEconomy(uid: string, deltas: EconomyDeltas): Promise<void> {
  void uid; void deltas;
  throw new Error('Direct economy updates are disabled; use an authenticated economy action.');
}

export async function adminGetStudentEconomy(uid: string): Promise<{ gold: number; global_xp: number; energy: number; streak: number }> {
  const { getManagedUserEconomy } = await import('./adminApiService');
  return getManagedUserEconomy(uid);
}

export async function adminUpdateEconomy(uid: string, deltas: EconomyDeltas, reason: string): Promise<void> {
  const { applyAdminEconomyAdjustment } = await import('@/lib/economyApiService');
  await applyAdminEconomyAdjustment(uid,{gold:deltas.gold??0,xp:deltas.xp??0,energy:deltas.energy??0,streak:deltas.streak??0},reason);
}

export async function recordStudyActivity(uid: string): Promise<void> {
  try {
    const { incrementTaskProgress } = await import('@/lib/chronoTasksService');
    await incrementTaskProgress(uid, 'study_correct', 1);
  } catch {
    // Quest tracking is best-effort until its state is moved server-side.
  }
  try {
    const { recordIdleVaultStudyCorrect } = await import('@/lib/chronoIdleVaultService');
    await recordIdleVaultStudyCorrect(uid);
  } catch {
    // Vault tracking is best-effort until its state is moved server-side.
  }
}

export async function isUsernameTaken(username: string): Promise<boolean> {
  return !(await checkUsernameAvailable(username));
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
  const parts = trimmed.split('#');
  const baseName = parts[0].trim().toLowerCase();
  const searchTag = parts.length > 1 ? `#${parts[1].trim()}` : null;

  try {
    const supabase = requireSupabase();
    const query = supabase.from('profile_directory').select('id, friend_tag').eq('username', baseName);
    const { data: rows } = await query;
    
    if (!rows || rows.length === 0) return false;

    let targetRow = rows[0];
    if (searchTag && rows.length > 1) {
      const match = rows.find(r => r.friend_tag === searchTag);
      if (match) targetRow = match;
    } else if (searchTag) {
      if (targetRow.friend_tag !== searchTag) return false;
    }

    const toUid = String(targetRow.id);
    if (toUid === fromUid) return false;

    // The RPC validates both profiles and updates both request lists atomically.
    const { error: rpcError } = await supabase.rpc('send_friend_request_rpc', { target_uid: toUid });
    if (rpcError) throw rpcError;

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
  if (!myData) return;

  const supabase = requireSupabase();

  if (accept) {
    const { error: rpcError } = await supabase.rpc('accept_friend_request_rpc', { target_uid: peerUid });
    if (rpcError) console.error('Error accepting friend request RPC:', rpcError);

    const notifId = `friendAccepted_${uid}`;
    await setGlobalDoc(`notifications:${peerUid}`, notifId, {
      id: notifId,
      fromUid: uid,
      fromUsername: myData.username,
      type: 'system',
      message: `${myData.username} accepted your friend request!`,
      createdAt: new Date().toISOString(),
      read: false,
      resolved: false
    } as any, true);
  } else {
    const { error: rpcError } = await supabase.rpc('decline_friend_request_rpc', { target_uid: peerUid });
    if (rpcError) console.error('Error declining friend request RPC:', rpcError);
  }
}

export async function removeFriend(uid: string, peerUid: string): Promise<void> {
  const myData = await getUserData(uid);
  if (!myData) return;
  const supabase = requireSupabase();
  const { error } = await supabase.rpc('remove_friend_rpc', { target_uid: peerUid });
  if (error) throw error;
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
  const supabase = requireSupabase();
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
  const supabase = requireSupabase();
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
