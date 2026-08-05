import { requireSupabase } from '@/lib/supabase';

function apiUrl(): string {
  return (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
}

/**
 * Fetches a published program's builder spec with every answer field removed
 * server-side. Returns null when the program has no builder-authored content or
 * the user is not signed in, so callers can fall back to the older program map.
 */
export async function fetchPublicProgramBuilderSpec(programId: string): Promise<unknown | null> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const response = await fetch(apiUrl() + '/api/economy/program-builder-spec', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ programId }),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as { builderSpec?: unknown } | null;
  return payload?.builderSpec ?? null;
}
