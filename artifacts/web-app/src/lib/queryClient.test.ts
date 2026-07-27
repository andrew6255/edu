import { describe, it, expect } from 'vitest';
import { queryClient, QUERY_CACHE_BUSTER, shouldPersistQuery } from './queryClient';

describe('TanStack React Query Offline Persistence Configuration', () => {
  it('exports a versioned cache buster string to enable automatic cache eviction on schema changes', () => {
    expect(QUERY_CACHE_BUSTER).toBe('v1');
  });

  it('configures default query options with 5-minute staleTime and 24-hour gcTime for offline access', () => {
    const defaultQueries = queryClient.getDefaultOptions().queries;
    expect(defaultQueries?.staleTime).toBe(5 * 60 * 1000);
    expect(defaultQueries?.gcTime).toBe(24 * 60 * 60 * 1000);
    expect(defaultQueries?.networkMode).toBe('offlineFirst');
  });

  it('configures mutation retry logic and offlineFirst network mode', () => {
    const defaultMutations = queryClient.getDefaultOptions().mutations;
    expect(defaultMutations?.retry).toBe(3);
    expect(defaultMutations?.networkMode).toBe('offlineFirst');
  });

  describe('shouldPersistQuery Filter Rules', () => {
    it('returns true for successful queries by default', () => {
      const result = shouldPersistQuery({
        state: { status: 'success' },
      });
      expect(result).toBe(true);
    });

    it('returns false for queries that have not succeeded (error or pending)', () => {
      expect(shouldPersistQuery({ state: { status: 'error' } })).toBe(false);
      expect(shouldPersistQuery({ state: { status: 'pending' } })).toBe(false);
    });

    it('returns false when query metadata explicitly opts out with { persist: false }', () => {
      const result = shouldPersistQuery({
        meta: { persist: false },
        state: { status: 'success' },
      });
      expect(result).toBe(false);
    });

    it('returns true when query metadata explicitly allows persistence or has unrelated meta', () => {
      expect(shouldPersistQuery({ meta: { persist: true }, state: { status: 'success' } })).toBe(true);
      expect(shouldPersistQuery({ meta: { tag: 'curriculum' }, state: { status: 'success' } })).toBe(true);
    });
  });
});
