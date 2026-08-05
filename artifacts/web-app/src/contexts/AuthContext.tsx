import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from 'react';
import type { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { requireSupabase } from '@/lib/supabase';
import { createUserData, getUserData, UserData } from '@/lib/userService';
import { saveRememberedAccount, getRememberedAccounts } from '@/lib/authService';

type AuthUser = Pick<SupabaseUser, 'id' | 'email'> & { uid: string; displayName: string | null };

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
  const userDataRef = useRef<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  function updateUserDataState(data: UserData | null) {
    setUserData(data);
    userDataRef.current = data;
  }

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
    const role = 'student' as const;

    const baseName = (parts[0] || emailPrefix || 'Logic').replace(/[^a-zA-Z0-9]/g, '');
    const tag = Math.floor(1000 + Math.random() * 9000);

    return {
      firstName: parts[0] || 'Logic',
      lastName: parts.slice(1).join(' ') || 'Lord',
      username: baseName.toLowerCase(),
      friendCode: `#${tag}`,
      email,
      role,
      economy: { gold: 200, global_xp: 0, streak: 0, energy: 0, rankedEnergyStreak: 0 },
      curriculums: {},
      onboardingComplete: true,
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
        chessMemory: 0, nameSquare_10s: 0, nameSquare_60s: 0, findSquare_10s: 0, findSquare_60s: 0,
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
      updateUserDataState(data);
    }
  }, [user]);

  async function resolveAuthState(session: Session | null, active: boolean, existingUserId?: string) {
    const sessionUser = session?.user ?? null;
    try {
      const currentUser = mapAuthUser(sessionUser);
      if (!active) return;

      // Stabilise the user reference: if the same user is already set, keep
      // the existing object so downstream useEffect([user]) hooks don't re-fire.
      setUser(prev => {
        if (!currentUser) return null;
        if (prev?.id === currentUser.id) return prev;
        return currentUser;
      });

      if (sessionUser) {
        // Sync refresh token on EVERY auth event (including TOKEN_REFRESHED) before early return
        try {
          if (session?.refresh_token && sessionUser.email) {
            const existingAcc = getRememberedAccounts().find(a => a.uid === sessionUser.id);
            const fullName = existingAcc?.fullName || sessionUser.email.split('@')[0];
            const role = existingAcc?.role || 'student';
            saveRememberedAccount({
              uid: sessionUser.id,
              email: sessionUser.email,
              fullName,
              role,
              avatarUrl: existingAcc?.avatarUrl,
              refreshToken: session.refresh_token,
              lastUsedAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.warn('[AuthContext] Failed to sync token to remembered accounts:', e);
        }

        // Skip expensive DB round-trip when the event is a token refresh (existingUserId matches).
        // Querying the DB during TOKEN_REFRESHED causes PostgREST to call getSession(), which deadlocks on the auth mutex lock!
        if (existingUserId && existingUserId === sessionUser.id) {
          if (active) setLoading(false);
          return;
        }
        const profile = await ensureProfileForAuthUser(sessionUser);
        if (!active) return;
        updateUserDataState(profile);

        // Update vault with full profile details from database
        try {
          if (session?.refresh_token && sessionUser.email && profile) {
            const fullName = `${profile.firstName} ${profile.lastName}`.trim() || sessionUser.email.split('@')[0];
            saveRememberedAccount({
              uid: sessionUser.id,
              email: sessionUser.email,
              fullName,
              role: profile.role || 'student',
              avatarUrl: undefined,
              refreshToken: session.refresh_token,
              lastUsedAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.warn('[AuthContext] Failed to save remembered account:', e);
        }
      } else {
        updateUserDataState(null);
      }
    } catch (error) {
      console.error('Failed to resolve auth state:', error);
      if (!active) return;
      setUser(mapAuthUser(sessionUser));
      updateUserDataState(sessionUser ? buildFallbackUserData(sessionUser) : null);
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
      await resolveAuthState(data.session ?? null, active);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Pass the current user ID so resolveAuthState can skip the DB
      // round-trip if the event is just a token refresh.
      const isTokenRefresh = event === 'TOKEN_REFRESHED';
      await resolveAuthState(session ?? null, active, isTokenRefresh ? session?.user?.id : undefined);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const supabase = requireSupabase();
    const channelId = `auth_profile:${user.uid}:${Math.random().toString(36).slice(2)}`;
    const channel = supabase.channel(channelId)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.uid}`
      }, () => {
        refreshUserData();
      })
      .subscribe();
      
    return () => { supabase.removeChannel(channel); };
  }, [user, refreshUserData]);

  return (
    <AuthContext.Provider value={{ user, userData, loading, refreshUserData }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
