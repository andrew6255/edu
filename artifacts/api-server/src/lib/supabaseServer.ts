const supabaseUrl = (): string => (process.env['SUPABASE_URL'] ?? '').replace(/\/$/, '');
const anonKey = (): string => process.env['SUPABASE_ANON_KEY'] ?? '';
const serviceKey = (): string => process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

export interface AuthenticatedUser { id: string; email?: string }

export async function verifySupabaseToken(header: string | undefined): Promise<AuthenticatedUser | null> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !supabaseUrl() || !anonKey()) return null;
  const response = await fetch(supabaseUrl() + '/auth/v1/user', {
    headers: { apikey: anonKey(), Authorization: 'Bearer ' + token },
  });
  if (!response.ok) return null;
  const data = await response.json() as Record<string, unknown>;
  return typeof data.id === 'string' ? { id: data.id, email: typeof data.email === 'string' ? data.email : undefined } : null;
}

export async function callServiceRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  const response = await fetch(supabaseUrl() + '/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    headers: { apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Economy database operation failed: ' + await response.text());
  return await response.json() as T;
}

export async function fetchServiceRows<T>(table: string, query: Record<string, string>): Promise<T[]> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Invalid Supabase table name.');
  const url = new URL(supabaseUrl() + '/rest/v1/' + table);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey() },
  });
  if (!response.ok) throw new Error('Supabase read failed: ' + await response.text());
  return await response.json() as T[];
}
