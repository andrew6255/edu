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

// Admin client using service role key – only for superadmin operations (e.g. deleting auth users).
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

let _adminClient: ReturnType<typeof createClient> | null = null;

export function getAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Service role key is not configured. Set VITE_SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!_adminClient) {
    _adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _adminClient;
}
