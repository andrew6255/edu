import { requireSupabase } from './supabase';
import type { UserData, UserRole } from './userService';

function apiUrl(): string {
  return (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
}

async function adminRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication required.');

  // Without a configured base URL these POSTs go to the web origin, where the
  // dev server or static host answers with an empty 404 — which used to surface
  // as an unexplained JSON parse error.
  const base = apiUrl();
  if (!base) {
    throw new Error('VITE_API_SERVER_URL is not set in this build, so admin actions have no API server to call.');
  }

  const endpoint = `${base}/api/${path}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Could not reach the API server at ${base}. Check that it is running and that this origin is allowed by CORS_ALLOWED_ORIGINS.`);
  }

  // Read as text first: error responses are frequently empty or HTML, and
  // parsing them as JSON hides the status code that explains the failure.
  const raw = await response.text();
  let parsed: (T & { error?: string }) | null = null;
  if (raw) {
    try { parsed = JSON.parse(raw) as T & { error?: string }; } catch { /* handled below */ }
  }

  if (!response.ok) {
    if (parsed?.error) throw new Error(parsed.error);
    const detail = raw ? `: ${raw.slice(0, 200)}` : ' with an empty body.';
    throw new Error(`API server returned ${response.status} ${response.statusText} for /api/${path}${detail}`);
  }

  if (!parsed) {
    throw new Error(`API server returned a non-JSON response (${response.status}) for /api/${path}.`);
  }

  return parsed;
}

export async function createManagedUserAccount(input: {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  password: string;
  role: Extract<UserRole, 'teacher' | 'admin' | 'teacher_assistant'>;
}): Promise<UserData & { uid: string }> {
  const result = await adminRequest<{ user: UserData & { uid: string } }>('admin/users/create', input);
  return result.user;
}

export async function deleteManagedUserAccount(userId: string): Promise<string[]> {
  const result = await adminRequest<{ deletedUserIds: string[] }>('admin/users/delete', { userId });
  return result.deletedUserIds;
}

export async function getManagedUserEconomy(userId: string): Promise<{ gold: number; global_xp: number; energy: number; streak: number }> {
  return adminRequest('admin/users/economy', { userId });
}

export async function createLinkedParentAccount(input: {
  firstName: string; lastName: string; username: string; email: string; password: string;
}): Promise<string> {
  const result = await adminRequest<{ parentUserId: string }>('account/create-linked-parent', input);
  return result.parentUserId;
}

export async function createImpersonationToken(userId: string): Promise<string> {
  const result = await adminRequest<{ tokenHash: string }>('admin/users/impersonation-token', { userId });
  return result.tokenHash;
}

export async function updateManagedUserRole(userId: string, role: Exclude<UserRole, 'superadmin'>): Promise<void> {
  await adminRequest('admin/users/update-role', { userId, role });
}
