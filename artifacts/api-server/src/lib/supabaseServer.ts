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
  // A void-returning RPC (server_admin_record_action) answers 204 with an empty
  // body, and JSON.parse('') would throw "Unexpected end of JSON input" — failing
  // the whole request over a call that actually succeeded.
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : null) as T;
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

export async function upsertServiceRow<T>(table: string, row: Record<string, unknown>, onConflict: string): Promise<T> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$/.test(onConflict)) throw new Error('Invalid Supabase write target.');
  const response = await fetch(`${supabaseUrl()}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey(), 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error('Supabase privileged write failed: ' + await response.text());
  const rows = await response.json() as T[];
  if (!rows[0]) throw new Error('Supabase privileged write returned no row.');
  return rows[0];
}

export async function createServiceAuthUser(input: {
  email: string; password: string; metadata: Record<string, unknown>;
}): Promise<{ id: string; email?: string }> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  const response = await fetch(supabaseUrl() + '/auth/v1/admin/users', {
    method: 'POST',
    headers: { apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: input.email, password: input.password, email_confirm: true, user_metadata: input.metadata }),
  });
  if (!response.ok) throw new Error('Account creation failed: ' + await response.text());
  const user = await response.json() as Record<string, unknown>;
  if (typeof user.id !== 'string') throw new Error('Account creation returned no user.');
  return { id: user.id, email: typeof user.email === 'string' ? user.email : undefined };
}

export async function deleteServiceAuthUser(userId: string): Promise<void> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  if (!/^[A-Za-z0-9-]{8,100}$/.test(userId)) throw new Error('Invalid auth user ID.');
  const response = await fetch(supabaseUrl() + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'DELETE',
    headers: { apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey() },
  });
  if (!response.ok && response.status !== 404) throw new Error('Auth account deletion failed: ' + await response.text());
}

export async function updateServiceAuthUserPassword(userId: string, password: string): Promise<void> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  if (!/^[A-Za-z0-9-]{8,100}$/.test(userId)) throw new Error('Invalid auth user ID.');
  const response = await fetch(supabaseUrl() + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'PUT',
    headers: { apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw new Error('Superadmin credential synchronization failed.');
}

export async function updateServiceRows<T>(
  table: string,
  matchColumn: string,
  matchValue: string,
  changes: Record<string, unknown>,
): Promise<T[]> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*$/.test(matchColumn)) {
    throw new Error('Invalid Supabase update target.');
  }
  const url = new URL(supabaseUrl() + '/rest/v1/' + table);
  url.searchParams.set(matchColumn, 'eq.' + matchValue);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey(), 'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(changes),
  });
  if (!response.ok) throw new Error('Supabase privileged update failed.');
  return await response.json() as T[];
}

export async function generateServiceMagicLink(email: string): Promise<string> {
  if (!supabaseUrl() || !serviceKey()) throw new Error('Supabase server credentials are not configured.');
  const response = await fetch(supabaseUrl() + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: { apikey: serviceKey(), Authorization: 'Bearer ' + serviceKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!response.ok) throw new Error('Impersonation link generation failed: ' + await response.text());
  const result = await response.json() as Record<string, unknown>;
  const properties = result.properties && typeof result.properties === 'object' ? result.properties as Record<string, unknown> : null;
  const tokenHash = typeof result.hashed_token === 'string' ? result.hashed_token : typeof properties?.hashed_token === 'string' ? properties.hashed_token : null;
  if (!tokenHash) throw new Error('Impersonation link returned no verification token.');
  return tokenHash;
}

export async function signInWithPasswordServer(email: string, password: string): Promise<Record<string, unknown>> {
  if (!supabaseUrl() || !anonKey()) throw new Error('Supabase authentication is not configured.');
  const response = await fetch(supabaseUrl() + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: anonKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error('INVALID_LOGIN');
  return await response.json() as Record<string, unknown>;
}
