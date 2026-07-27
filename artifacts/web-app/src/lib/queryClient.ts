/**
 * queryClient.ts — Singleton QueryClient with offline-first configuration.
 *
 * Offline Persistence Strategy:
 * ─────────────────────────────
 * Uses localStorage as the persistence layer via the sync-storage persister.
 * The cache key is versioned so stale data from old code is automatically
 * evicted on app upgrades.
 *
 * Data is stored as compressed JSON under `TANSTACK_QUERY_CACHE_KEY`.
 *
 * What gets cached:
 *  - Queries with `staleTime > 0` automatically persist across page reloads.
 *  - Sensitive or real-time data (e.g. auth session) should set `gcTime: 0`
 *    or use a unique `queryKey` that is not prefixed with a persisted prefix.
 *
 * Mutation Retry:
 *  - Failed mutations are NOT persisted to storage by default (no mutation cache).
 *  - For offline-queued mutations, use the `useMutationQueue` pattern.
 */

import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

// ─── Cache version ─────────────────────────────────────────────────────────────
// Bump this when the shape of any cached query changes to force cache eviction.
export const QUERY_CACHE_BUSTER = 'v1';
const CACHE_KEY = 'LOGICL_QC';

// ─── QueryClient ───────────────────────────────────────────────────────────────
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered stale after 5 minutes
      staleTime: 5 * 60 * 1000,

      // Keep inactive queries in cache for 24 hours (allows offline access)
      gcTime: 24 * 60 * 60 * 1000,

      // Retry failed queries up to 3 times with exponential backoff
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),

      // Don't refetch in background tabs — important for mobile battery life
      refetchOnWindowFocus: false,

      // Reconnect-triggered refetch is fine (e.g. coming back online)
      refetchOnReconnect: true,

      // Don't throw on network errors — return stale data instead
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Mutations retry up to 3 times on network errors
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      networkMode: 'offlineFirst',
    },
  },
});

// Helper to determine if a query should be persisted to localStorage
export function shouldPersistQuery(query: { meta?: Record<string, unknown>; state: { status: string } }): boolean {
  const meta = query.meta;
  if (meta?.['persist'] === false) return false;
  return query.state.status === 'success';
}

// ─── Persistence ───────────────────────────────────────────────────────────────
// Only enable in browser environments (not SSR or test runners)
if (typeof window !== 'undefined') {
  const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: CACHE_KEY,
    // Throttle writes to localStorage to once every 1 second
    throttleTime: 1000,
    // Serialise/deserialise using JSON
    serialize: JSON.stringify,
    deserialize: JSON.parse,
  });

  persistQueryClient({
    queryClient,
    persister,
    // Evict cache if it was written by a different version
    buster: QUERY_CACHE_BUSTER,
    // Only persist for up to 24 hours
    maxAge: 24 * 60 * 60 * 1000,
    // Don't persist queries tagged as private (e.g. real-time subscriptions)
    dehydrateOptions: {
      shouldDehydrateQuery: shouldPersistQuery as any,
    },
  });
}
