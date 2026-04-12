import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { requireSupabase } from '@/lib/supabase';
import { createUserData, getUserData, UserData } from '@/lib/userService';

type AuthUser = Pick<SupabaseUser, 'id' | 'email'> & { uid: string; displayName: string | null };
const SUPERADMIN_EMAIL = 'god.bypass@internal.app';

interface AuthContextType {
  user: AuthUser | null;
  userData: UserData | null;
  loading: boolean;
  refreshUserData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, userData: null, loading: true, refreshUserData: async () => {}
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  function mapAuthUser(user: SupabaseUser | null): AuthUser | null {
    if (!user) return null;
    const meta = user.user_metadata && typeof user.user_metadata === 'object'
      ? (user.user_metadata as Record<string, unknown>)
      : {};
    const displayName = typeof meta.full_name === 'string'
      ? meta.full_name
      : (typeof meta.name === 'string' ? meta.name : null);
    return {
      id: user.id,
      uid: user.id,
      email: user.email ?? '',
      displayName,
    };
  }

  function buildFallbackUserData(authUser: SupabaseUser): UserData {
    const meta = authUser.user_metadata && typeof authUser.user_metadata === 'object'
      ? (authUser.user_metadata as Record<string, unknown>)
      : {};
    const fullName = typeof meta.full_name === 'string'
      ? meta.full_name
      : (typeof meta.name === 'string' ? meta.name : 'Logic Lord');
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    const email = authUser.email ?? '';
    const emailPrefix = email.split('@')[0] || 'user';
    const role = email === SUPERADMIN_EMAIL ? 'superadmin' : 'student';

    return {
      firstName: parts[0] || 'Logic',
      lastName: parts.slice(1).join(' ') || 'Lord',
      username: role === 'superadmin' ? 'superadmin' : `${emailPrefix.replace(/[^a-zA-Z0-9_]/g, '_') || 'user'}_${authUser.id.slice(0, 6)}`,
      email,
      role,
      economy: { gold: 200, global_xp: 0, streak: 0, energy: 0, rankedEnergyStreak: 0 },
      curriculums: {},
      onboardingComplete: role === 'superadmin' ? true : false,
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
        chessMemory: 0, nameSquare10: 0, nameSquare60: 0, findSquare10: 0, findSquare60: 0,
      },
      warmup_date: '',
      played_categories: [],
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      arenaStats: { wins: 0, losses: 0, highestStreak: 0 },
      last_active: new Date().toISOString().split('T')[0],
    };
  }

  async function ensureProfileForAuthUser(authUser: SupabaseUser): Promise<UserData | null> {
    try {
      let profile = await getUserData(authUser.id);
      if (profile) return profile;

      const fallback = buildFallbackUserData(authUser);

      await createUserData(authUser.id, {
        firstName: fallback.firstName,
        lastName: fallback.lastName,
        username: fallback.username,
        email: fallback.email,
        role: fallback.role,
        onboardingComplete: fallback.onboardingComplete,
      });

      profile = await getUserData(authUser.id);
      return profile ?? fallback;
    } catch (error) {
      console.error('Failed to ensure Supabase profile row:', error);
      return buildFallbackUserData(authUser);
    }
  }

  const refreshUserData = useCallback(async () => {
    if (user) {
      const { data: authData } = await requireSupabase().auth.getUser();
      const authUser = authData.user;
      const data = authUser ? await ensureProfileForAuthUser(authUser) : await getUserData(user.uid);
      setUserData(data);
    }
  }, [user]);

  async function resolveAuthState(sessionUser: SupabaseUser | null, active: boolean) {
    try {
      const currentUser = mapAuthUser(sessionUser);
      if (!active) return;
      setUser(currentUser);

      if (sessionUser) {
        const profile = await ensureProfileForAuthUser(sessionUser);
        if (!active) return;
        setUserData(profile);
      } else {
        setUserData(null);
      }
    } catch (error) {
      console.error('Failed to resolve auth state:', error);
      if (!active) return;
      setUser(mapAuthUser(sessionUser));
      setUserData(sessionUser ? buildFallbackUserData(sessionUser) : null);
    } finally {
      if (active) setLoading(false);
    }
  }

  useEffect(() => {
    const supabase = requireSupabase();
    let active = true;

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) {
        console.error('Failed to get Supabase session:', error);
      }
      await resolveAuthState(data.session?.user ?? null, active);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await resolveAuthState(session?.user ?? null, active);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, userData, loading, refreshUserData }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
