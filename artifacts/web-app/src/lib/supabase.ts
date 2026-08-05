import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseEnv
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storageKey: 'sb-auth-token',
        flowType: 'implicit',
        // Bypass navigator.locks to prevent 5s timeout hangs
        lock: <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn(),
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

/** @deprecated Browser code must use authenticated server endpoints for privileged work. */
export function getAdminClient(): ReturnType<typeof createClient> {
  throw new Error('Privileged operations must use the authenticated API; service-role credentials are never available in the browser.');
}
