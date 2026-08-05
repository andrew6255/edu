import { Router, type IRouter, type Request, type Response } from 'express';
import {
  callServiceRpc,
  createServiceAuthUser,
  deleteServiceAuthUser,
  fetchServiceRows,
  generateServiceMagicLink,
  upsertServiceRow,
  verifySupabaseToken,
} from '../../lib/supabaseServer';

const router: IRouter = Router();
type ManagedRole = 'teacher' | 'admin' | 'teacher_assistant';

async function authenticatedManager(req: Request): Promise<{ id: string; role: 'admin' | 'superadmin' } | null> {
  const user = await verifySupabaseToken(req.header('authorization'));
  if (!user) return null;
  const rows = await fetchServiceRows<{ role?: string }>('profiles', { select: 'role', id: `eq.${user.id}`, limit: '1' });
  const role = rows[0]?.role;
  return role === 'admin' || role === 'superadmin' ? { id: user.id, role } : null;
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

async function canReadManagedUser(manager: { id: string; role: 'admin' | 'superadmin' }, targetUserId: string): Promise<boolean> {
  if (manager.role === 'superadmin') return true;
  const assignments = await fetchServiceRows<{ teacher_id?: string }>('admin_teacher_assignments', {
    select: 'teacher_id', admin_id: `eq.${manager.id}`,
  });
  const teacherIds = assignments.map((row) => row.teacher_id).filter((id): id is string => !!id);
  if (teacherIds.length === 0) return false;
  const classes = await fetchServiceRows<{ data?: Record<string, unknown> }>('global_docs', {
    select: 'data', collection: 'eq.teacher_classes',
  });
  const classIds = classes
    .map((row) => row.data)
    .filter((data): data is Record<string, unknown> => !!data && teacherIds.includes(String(data.teacherId ?? '')))
    .map((data) => String(data.id ?? ''))
    .filter(Boolean);
  if (classIds.length === 0) return false;
  const memberships = await fetchServiceRows<{ data?: Record<string, unknown> }>('global_docs', {
    select: 'data', collection: 'eq.teacher_class_members',
  });
  return memberships.some((row) => {
    const data = row.data;
    return !!data && classIds.includes(String(data.classId ?? ''))
      && String(data.userId ?? '') === targetUserId && !data.kickedAt;
  });
}

router.post('/admin/users/create', async (req: Request, res: Response) => {
  let createdUserId: string | null = null;
  try {
    const manager = await authenticatedManager(req);
    if (!manager) { res.status(403).json({ error: 'Admin access required.' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const firstName = requiredText(body.firstName, 80);
    const lastName = requiredText(body.lastName, 80);
    const username = requiredText(body.username, 40)?.toLowerCase() ?? null;
    const email = requiredText(body.email, 254)?.toLowerCase() ?? null;
    const password = requiredText(body.password, 200);
    const role = body.role as ManagedRole;
    const allowed = manager.role === 'superadmin' ? role === 'teacher' || role === 'admin' : role === 'teacher_assistant';
    if (!firstName || !lastName || !username || !email || !password || !allowed
        || !/^[a-z0-9_]+$/.test(username) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      res.status(400).json({ error: 'Valid account details and a password of at least 8 characters are required.' }); return;
    }
    const existing = await fetchServiceRows<{ id: string }>('profiles', { select: 'id', username: `eq.${username}`, limit: '1' });
    if (existing.length > 0) { res.status(409).json({ error: 'Username is already taken.' }); return; }

    const authUser = await createServiceAuthUser({
      email, password, metadata: { full_name: `${firstName} ${lastName}`.trim(), name: username },
    });
    createdUserId = authUser.id;
    await upsertServiceRow('profiles', {
      id: authUser.id,
      email,
      username,
      first_name: firstName,
      last_name: lastName,
      role,
      onboarding_complete: true,
      user_state: { last_active: new Date().toISOString().slice(0, 10) },
      updated_at: new Date().toISOString(),
    }, 'id');
    await callServiceRpc('economy_bootstrap_wallet', { p_user_id: authUser.id });
    res.status(201).json({ user: { uid: authUser.id, firstName, lastName, username, email, role, onboardingComplete: true } });
  } catch (error) {
    if (createdUserId) {
      try { await callServiceRpc('server_admin_delete_user', { p_target_uid: createdUserId, p_delete_linked: false }); } catch { /* best effort */ }
      try { await deleteServiceAuthUser(createdUserId); } catch { /* best effort */ }
    }
    const message = error instanceof Error ? error.message : 'Account creation failed.';
    res.status(/already|duplicate|registered/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/admin/users/delete', async (req: Request, res: Response) => {
  try {
    const manager = await authenticatedManager(req);
    if (!manager || manager.role !== 'superadmin') { res.status(403).json({ error: 'Superadmin access required.' }); return; }
    const targetUserId = requiredText((req.body as Record<string, unknown> | null)?.userId, 100);
    if (!targetUserId || targetUserId === manager.id) { res.status(400).json({ error: 'A different valid user is required.' }); return; }
    const targets = await fetchServiceRows<{ role?: string }>('profiles', { select: 'role', id: `eq.${targetUserId}`, limit: '1' });
    if (!targets[0]) { res.status(404).json({ error: 'User not found.' }); return; }
    if (targets[0].role === 'superadmin') { res.status(403).json({ error: 'Superadmin accounts cannot be deleted here.' }); return; }
    const result = await callServiceRpc<{ deletedUserIds?: unknown }>('server_admin_delete_user', {
      p_target_uid: targetUserId, p_delete_linked: true,
    });
    const deletedUserIds = Array.isArray(result.deletedUserIds) ? result.deletedUserIds.filter((id): id is string => typeof id === 'string') : [targetUserId];
    for (const userId of deletedUserIds) await deleteServiceAuthUser(userId);
    res.json({ deletedUserIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account deletion failed.';
    res.status(/not found/i.test(message) ? 404 : 500).json({ error: message });
  }
});

router.post('/admin/users/economy', async (req: Request, res: Response) => {
  try {
    const manager = await authenticatedManager(req);
    if (!manager) { res.status(403).json({ error: 'Admin access required.' }); return; }
    const targetUserId = requiredText((req.body as Record<string, unknown> | null)?.userId, 100);
    if (!targetUserId || !(await canReadManagedUser(manager, targetUserId))) {
      res.status(403).json({ error: 'This user is outside your assigned classrooms.' }); return;
    }
    const rows = await fetchServiceRows<{ gold?: number; global_xp?: number; energy?: number; streak?: number }>('user_economy', {
      select: 'gold,global_xp,energy,streak', user_id: `eq.${targetUserId}`, limit: '1',
    });
    const economy = rows[0] ?? {};
    res.json({
      gold: Number(economy.gold ?? 0), global_xp: Number(economy.global_xp ?? 0),
      energy: Number(economy.energy ?? 0), streak: Number(economy.streak ?? 0),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Economy lookup failed.' });
  }
});

router.post('/account/create-linked-parent', async (req: Request, res: Response) => {
  let createdUserId: string | null = null;
  try {
    const user = await verifySupabaseToken(req.header('authorization'));
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const profiles = await fetchServiceRows<{ role?: string }>('profiles', { select: 'role', id: `eq.${user.id}`, limit: '1' });
    if (profiles[0]?.role !== 'student') { res.status(403).json({ error: 'Only a student can create a linked parent account.' }); return; }
    const links = await fetchServiceRows<{ parent_id?: string }>('parent_student_links', { select: 'parent_id', student_id: `eq.${user.id}`, limit: '1' });
    if (links.length > 0) { res.status(409).json({ error: 'A parent account is already linked.' }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const firstName = requiredText(body.firstName, 80) ?? 'Parent';
    const lastName = requiredText(body.lastName, 80) ?? '';
    const username = requiredText(body.username, 40)?.toLowerCase() ?? null;
    const email = requiredText(body.email, 254)?.toLowerCase() ?? null;
    const password = requiredText(body.password, 200);
    if (!username || !email || !password || !/^[a-z0-9_]+$/.test(username) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
      res.status(400).json({ error: 'Valid parent details and a password of at least 8 characters are required.' }); return;
    }
    const existing = await fetchServiceRows<{ id: string }>('profiles', { select: 'id', username: `eq.${username}`, limit: '1' });
    if (existing.length > 0) { res.status(409).json({ error: 'Username is already taken.' }); return; }

    const authUser = await createServiceAuthUser({
      email, password, metadata: { full_name: `${firstName} ${lastName}`.trim(), name: username },
    });
    createdUserId = authUser.id;
    await upsertServiceRow('profiles', {
      id: authUser.id, email, username, first_name: firstName, last_name: lastName,
      role: 'parent', onboarding_complete: true, updated_at: new Date().toISOString(),
    }, 'id');
    await callServiceRpc('economy_bootstrap_wallet', { p_user_id: authUser.id });
    await upsertServiceRow('parent_student_links', {
      parent_id: authUser.id, student_id: user.id, created_at: new Date().toISOString(),
    }, 'parent_id,student_id');
    res.status(201).json({ parentUserId: authUser.id });
  } catch (error) {
    if (createdUserId) {
      try { await callServiceRpc('server_admin_delete_user', { p_target_uid: createdUserId, p_delete_linked: false }); } catch { /* best effort */ }
      try { await deleteServiceAuthUser(createdUserId); } catch { /* best effort */ }
    }
    const message = error instanceof Error ? error.message : 'Parent account creation failed.';
    res.status(/already|duplicate|registered/i.test(message) ? 409 : 500).json({ error: message });
  }
});

router.post('/admin/users/impersonation-token', async (req: Request, res: Response) => {
  try {
    const manager = await authenticatedManager(req);
    if (!manager || manager.role !== 'superadmin') { res.status(403).json({ error: 'Superadmin access required.' }); return; }
    const targetUserId = requiredText((req.body as Record<string, unknown> | null)?.userId, 100);
    if (!targetUserId || targetUserId === manager.id) { res.status(400).json({ error: 'A different valid user is required.' }); return; }
    const profiles = await fetchServiceRows<{ email?: string; role?: string }>('profiles', { select: 'email,role', id: `eq.${targetUserId}`, limit: '1' });
    const email = profiles[0]?.email;
    if (!email) { res.status(404).json({ error: 'Target account email was not found.' }); return; }
    if (profiles[0]?.role === 'superadmin') { res.status(403).json({ error: 'Superadmin accounts cannot be impersonated.' }); return; }
    const tokenHash = await generateServiceMagicLink(email);
    await callServiceRpc('server_admin_record_action', {
      p_actor_user_id: manager.id, p_target_user_id: targetUserId,
      p_action: 'user_impersonation_started', p_metadata: { email },
    });
    res.json({ tokenHash });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Impersonation failed.' });
  }
});

export default router;
