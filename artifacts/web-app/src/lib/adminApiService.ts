import { requireSupabase } from './supabase';
import type { UserData, UserRole } from './userService';

function apiUrl(): string {
  return (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim().replace(/\/$/, '') || '';
}

async function adminRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication required.');
  const response = await fetch(`${apiUrl()}/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || 'Admin operation failed.');
  return result;
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
