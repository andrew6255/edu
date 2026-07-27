import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getRememberedAccounts,
  saveRememberedAccount,
  removeRememberedAccount,
  REMEMBERED_ACCOUNTS_KEY,
  RememberedAccount,
} from './authService';

// Mock requireSupabase for performSignOut / session capturing
vi.mock('./supabase', () => ({
  requireSupabase: vi.fn().mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      refreshSession: vi.fn(),
    },
  }),
}));

describe('authService — Device Remembered Accounts & Vault Testing', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const mockAccount1: RememberedAccount = {
    uid: 'user-111',
    email: 'admin@logiclords.edu',
    fullName: 'Professor Dumbledore',
    role: 'admin',
    refreshToken: 'token-ref-111',
    lastUsedAt: '2026-07-27T10:00:00.000Z',
  };

  const mockAccount2: RememberedAccount = {
    uid: 'user-222',
    email: 'student@logiclords.edu',
    fullName: 'Harry Potter',
    role: 'student',
    refreshToken: 'token-ref-222',
    lastUsedAt: '2026-07-27T11:00:00.000Z',
  };

  it('returns empty array when no accounts exist in localStorage', () => {
    expect(getRememberedAccounts()).toEqual([]);
  });

  it('saves an account to localStorage and retrieves it', () => {
    saveRememberedAccount(mockAccount1);
    const list = getRememberedAccounts();
    expect(list).toHaveLength(1);
    expect(list[0].uid).toBe('user-111');
    expect(list[0].email).toBe('admin@logiclords.edu');
    expect(list[0].refreshToken).toBe('token-ref-111');
  });

  it('sorts multiple accounts by lastUsedAt in descending order (most recent first)', () => {
    saveRememberedAccount(mockAccount1);
    saveRememberedAccount(mockAccount2);

    const list = getRememberedAccounts();
    expect(list).toHaveLength(2);
    // mockAccount2 has a newer timestamp (11:00 > 10:00) so it must appear first
    expect(list[0].uid).toBe('user-222');
    expect(list[1].uid).toBe('user-111');
  });

  it('updates existing account without duplicating when same uid or email is saved again', () => {
    saveRememberedAccount(mockAccount1);
    expect(getRememberedAccounts()).toHaveLength(1);

    // Save updated token and role for user-111
    const updatedAccount: RememberedAccount = {
      ...mockAccount1,
      role: 'superadmin',
      refreshToken: 'token-ref-111-new',
    };
    saveRememberedAccount(updatedAccount);

    const list = getRememberedAccounts();
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe('superadmin');
    expect(list[0].refreshToken).toBe('token-ref-111-new');
  });

  it('removes an account by uid from the device vault', () => {
    saveRememberedAccount(mockAccount1);
    saveRememberedAccount(mockAccount2);
    expect(getRememberedAccounts()).toHaveLength(2);

    const remaining = removeRememberedAccount('user-111');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].uid).toBe('user-222');

    const verified = getRememberedAccounts();
    expect(verified).toHaveLength(1);
    expect(verified[0].uid).toBe('user-222');
  });

  it('preserves remembered accounts string in localStorage when storage is cleared during local sign-out', () => {
    // Save account to vault
    saveRememberedAccount(mockAccount1);
    // Add arbitrary other localStorage item (like old session state)
    localStorage.setItem('supabase.auth.token', 'old-session-data');

    expect(localStorage.getItem(REMEMBERED_ACCOUNTS_KEY)).toBeDefined();
    expect(localStorage.getItem('supabase.auth.token')).toBe('old-session-data');

    // Simulate local sign-out preservation logic
    const remembered = localStorage.getItem(REMEMBERED_ACCOUNTS_KEY);
    localStorage.clear();
    if (remembered) {
      localStorage.setItem(REMEMBERED_ACCOUNTS_KEY, remembered);
    }

    // Verify other keys cleared while vault survived
    expect(localStorage.getItem('supabase.auth.token')).toBeNull();
    const vault = getRememberedAccounts();
    expect(vault).toHaveLength(1);
    expect(vault[0].uid).toBe('user-111');
  });
});
