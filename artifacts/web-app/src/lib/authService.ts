import { requireSupabase } from './supabase';

export interface RememberedAccount {
  uid: string;
  email: string;
  fullName: string;
  role: string;
  avatarUrl?: string;
  refreshToken: string;
  lastUsedAt: string;
}

export const REMEMBERED_ACCOUNTS_KEY = 'iq_remembered_accounts';

/**
 * Get all remembered accounts stored on this device, sorted by most recently used.
 */
export function getRememberedAccounts(): RememberedAccount[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = localStorage.getItem(REMEMBERED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''));
  } catch (e) {
    console.error('[authService] Error reading remembered accounts:', e);
    return [];
  }
}

/**
 * Save or update an account profile in the device vault.
 */
export function saveRememberedAccount(account: RememberedAccount): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (!account.uid || !account.refreshToken) return;

    const list = getRememberedAccounts();
    const index = list.findIndex(a => a.uid === account.uid || (a.email && a.email.toLowerCase() === account.email.toLowerCase()));
    
    if (index >= 0) {
      list[index] = {
        ...list[index],
        ...account,
        lastUsedAt: account.lastUsedAt || new Date().toISOString(),
      };
    } else {
      list.push({
        ...account,
        lastUsedAt: account.lastUsedAt || new Date().toISOString(),
      });
    }

    localStorage.setItem(REMEMBERED_ACCOUNTS_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('[authService] Error saving remembered account:', e);
  }
}

/**
 * Remove an account from the device vault (when user clicks trash icon).
 */
export function removeRememberedAccount(uid: string): RememberedAccount[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const list = getRememberedAccounts().filter(a => a.uid !== uid);
    localStorage.setItem(REMEMBERED_ACCOUNTS_KEY, JSON.stringify(list));
    return list;
  } catch (e) {
    console.error('[authService] Error removing remembered account:', e);
    return [];
  }
}

/**
 * Perform one-click login by exchanging the remembered refresh token for a fresh active session.
 */
export async function switchToRememberedAccount(account: RememberedAccount): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = requireSupabase();
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: account.refreshToken,
    });

    if (error) {
      console.warn('[authService] Could not refresh session for account:', account.email, error.message);
      return { success: false, error: error.message };
    }

    if (data.session && data.session.refresh_token) {
      // Update our stored refresh token with the newly issued one
      saveRememberedAccount({
        ...account,
        refreshToken: data.session.refresh_token,
        lastUsedAt: new Date().toISOString(),
      });
      return { success: true };
    }

    return { success: false, error: 'No active session returned.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error during account switch.';
    return { success: false, error: msg };
  }
}

/**
 * Standardized Sign-Out across all dashboards.
 * Uses scope: 'local' to clear active browser state without revoking the refresh token on the server,
 * preserving remembered accounts for one-click profile switching.
 */
export async function performSignOut(redirectUrl?: string): Promise<void> {
  const supabase = requireSupabase();
  const targetUrl = redirectUrl || (import.meta.env.BASE_URL + 'auth');

  // 1. Attempt to capture current active session into remembered vault before leaving
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user && session.refresh_token) {
      const meta = session.user.user_metadata || {};
      const existingAcc = getRememberedAccounts().find(a => a.uid === session.user.id);
      const fullName = existingAcc?.fullName || (typeof meta.full_name === 'string' ? meta.full_name : (typeof meta.name === 'string' ? meta.name : session.user.email?.split('@')[0] || 'User'));
      const role = existingAcc?.role || (typeof meta.role === 'string' ? meta.role : 'student');
      saveRememberedAccount({
        uid: session.user.id,
        email: session.user.email || '',
        fullName,
        role,
        avatarUrl: existingAcc?.avatarUrl || (typeof meta.avatar_url === 'string' ? meta.avatar_url : undefined),
        refreshToken: session.refresh_token,
        lastUsedAt: new Date().toISOString(),
      });
    }
  } catch (e) {
    console.warn('[authService] Could not capture current session before sign out:', e);
  }

  // 2. Preserve remembered accounts string from localStorage
  const remembered = typeof window !== 'undefined' && window.localStorage ? localStorage.getItem(REMEMBERED_ACCOUNTS_KEY) : null;

  // 3. Clear storage to log out locally in the browser WITHOUT calling supabase.auth.signOut(),
  // which would revoke the refresh token on the backend and break one-click login!
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.clear();
    sessionStorage.clear();
    if (remembered) {
      localStorage.setItem(REMEMBERED_ACCOUNTS_KEY, remembered);
    }
  }

  // 4. Redirect to authentication page
  if (typeof window !== 'undefined') {
    window.location.href = targetUrl;
  }
}
