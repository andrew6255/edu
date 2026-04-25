import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { requireSupabase, getAdminClient } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { 
  getAllUsers, 
  updateUserData, 
  deleteUserData, 
  createUserDataAdmin, 
  isUsernameTaken, 
  adminUpdateEconomy, 
  type EconomyDeltas, 
  UserData, 
  UserRole, 
  computeLevel, 
  getAdminTeacherAssignments, 
  addAdminTeacherAssignment, 
  removeAdminTeacherAssignment, 
  getParentStudentLinks, 
  AdminTeacherAssignment, 
  ParentStudentLink 
} from '@/lib/userService';
import { 
  convertNestedProgramToInternal, 
  parseNestedProgramJson 
} from '@/lib/programNestedImport';
import {
  BUILDER_DIVISION_LABELS,
  FIXED_FIRST_DIVISION_NODE_ID,
  type BuilderDivisionLabel,
  type BuilderNode,
  type BuilderQuestionTypeFile,
  type BuilderSpec,
  convertBuilderToInternal,
  ensureFixedFirstDivisionContainer,
  makeIdFromTitle,
  makeStableId,
  newBuilderSpec,
} from '@/lib/programBuilder';
import {
  type ProgramAtomicInteractionSpec,
  type ProgramPromptBlock,
  type ProgramStepSpec,
} from '@/lib/programQuestionBank';
import {
  deleteDraftLogicGameNode,
  deletePublishedLogicGameNode,
  getDraftLogicGameQuestions,
  listDraftLogicGameNodes,
  listPublishedLogicGameNodes,
  publishLogicGameNode,
  publishLogicGameQuestions,
  upsertDraftLogicGameNode,
  upsertDraftLogicGameQuestions,
} from '@/lib/logicGamesService';
import ProgramMapView from '@/views/ProgramMapView';
import { clearDraftProgram, setDraftProgram } from '@/lib/draftProgramStore';
import { deleteProgramQuestionAsset, uploadProgramQuestionAsset } from '@/lib/programAssetService';
import type { LogicGameNode, LogicGameQuestionsDoc } from '@/types/logicGames';
import {
  createProgramIngestionJob,
  runProgramIngestionStage,
  uploadProgramIngestionSource,
  getProgramIngestionJob,
} from '@/lib/programIngestionService';
import {
  deleteDraftProgramAdmin,
  getDraftProgramAdmin,
  listProgramsAdmin,
  publishProgramAdmin,
  saveDraftProgramAdmin,
  savePublishedProgramAdmin,
  softDeletePublishedProgramAdmin,
} from '@/lib/programAdminService';

type Tab = 'overview' | 'users' | 'programs' | 'logicGames';

const ROLE_ORDER: UserRole[] = ['student', 'superadmin', 'admin', 'teacher', 'teacher_assistant', 'parent'];
const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student', superadmin: 'Super Admin', admin: 'Admin',
  teacher: 'Teacher', teacher_assistant: 'TA', parent: 'Parent',
};
const ROLE_COLORS: Record<UserRole, string> = {
  student: '#3b82f6', superadmin: '#a855f7', admin: '#f59e0b',
  teacher: '#10b981', teacher_assistant: '#06b6d4', parent: '#ec4899',
};

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, stripUndefinedDeep(v)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function toPromptBlocks(value: unknown, fallbackText: string): ProgramPromptBlock[] {
  if (Array.isArray(value) && value.length > 0) {
    return value
      .map((block) => {
        const item = asRecord(block);
        if (!item || typeof item.type !== 'string') return null;
        if (item.type === 'text' || item.type === 'note') {
          return typeof item.text === 'string' ? { type: 'text', text: item.text } satisfies ProgramPromptBlock : null;
        }
        if (item.type === 'latex' || item.type === 'math') {
          return typeof item.text === 'string'
            ? { type: 'math', latex: item.text } satisfies ProgramPromptBlock
            : (typeof item.latex === 'string' ? { type: 'math', latex: item.latex } satisfies ProgramPromptBlock : null);
        }
        if (item.type === 'image' && typeof item.url === 'string') {
          return { type: 'image', url: item.url, alt: typeof item.alt === 'string' ? item.alt : undefined } satisfies ProgramPromptBlock;
        }
        if (item.type === 'table' && Array.isArray(item.rows)) {
          return {
            type: 'table',
            rows: item.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell)) : [])),
            headerRows: typeof item.headerRows === 'number' ? item.headerRows : undefined,
          } satisfies ProgramPromptBlock;
        }
        return null;
      })
      .filter(Boolean) as ProgramPromptBlock[];
  }
  return [{ type: 'text', text: fallbackText }];
}

function deterministicAnswerToInteraction(value: unknown): ProgramAtomicInteractionSpec | null {
  const answer = asRecord(value);
  if (!answer || typeof answer.type !== 'string') return null;
  if (answer.type === 'choice') {
    const choices = Array.isArray(answer.choices) ? answer.choices.map((choice) => String(choice)) : [];
    const correctChoiceIndex = Number(answer.correctChoiceIndex);
    if (choices.length >= 2 && Number.isInteger(correctChoiceIndex) && correctChoiceIndex >= 0 && correctChoiceIndex < choices.length) {
      return { type: 'mcq', choices, correctChoiceIndex };
    }
    return null;
  }
  if (answer.type === 'number') {
    const rawCorrect = Array.isArray(answer.correct) ? answer.correct : [answer.correct];
    const correct = rawCorrect
      .map((item) => (typeof item === 'number' ? item : Number(item)))
      .filter((item) => Number.isFinite(item));
    if (correct.length === 0) return null;
    return {
      type: 'numeric',
      correct: correct.length === 1 ? correct[0]! : correct,
      tolerance: typeof answer.tolerance === 'number' ? answer.tolerance : undefined,
    };
  }
  if (answer.type === 'text') {
    const accepted = Array.isArray(answer.accepted) ? answer.accepted.map((item) => String(item)).filter(Boolean) : [];
    if (accepted.length === 0) return null;
    return {
      type: 'text',
      accepted,
      caseSensitive: answer.caseSensitive === true,
      trim: answer.trim !== false,
    };
  }
  if (answer.type === 'line_equation') {
    const forms = Array.isArray(answer.forms) ? answer.forms.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];
    if (forms.length === 0) return null;
    return {
      type: 'line_equation',
      forms,
      variable: typeof answer.variable === 'string' && answer.variable.trim().length > 0 ? answer.variable : undefined,
      caseSensitive: answer.caseSensitive === true,
      trim: answer.trim !== false,
    };
  }
  if (answer.type === 'point_list') {
    const points = Array.isArray(answer.points)
      ? answer.points
          .map((point) => asRecord(point))
          .filter(Boolean)
          .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    if (points.length === 0) return null;
    return {
      type: 'point_list',
      points,
      minPoints: typeof answer.minPoints === 'number' ? answer.minPoints : undefined,
      maxPoints: typeof answer.maxPoints === 'number' ? answer.maxPoints : undefined,
      ordered: answer.ordered === true,
      allowEquivalentOrder: answer.allowEquivalentOrder !== false,
    };
  }
  if (answer.type === 'points_on_line') {
    const lineForms = Array.isArray(answer.lineForms) ? answer.lineForms.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];
    if (lineForms.length === 0) return null;
    const disallowGivenPoints = Array.isArray(answer.disallowGivenPoints)
      ? answer.disallowGivenPoints
          .map((point) => asRecord(point))
          .filter(Boolean)
          .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : undefined;
    return {
      type: 'points_on_line',
      lineForms,
      minPoints: typeof answer.minPoints === 'number' ? answer.minPoints : 1,
      maxPoints: typeof answer.maxPoints === 'number' ? answer.maxPoints : undefined,
      disallowGivenPoints,
      requireDistinct: answer.requireDistinct !== false,
    };
  }
  return null;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim().length > 0) : [];
}

function getNormalizedSolutionSteps(value: unknown): ProgramStepSpec[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((step, idx) => {
      const item = asRecord(step);
      if (!item) return null;
      const interaction = deterministicAnswerToInteraction(item.answer);
      if (!interaction) return null;
      return {
        id: typeof item.id === 'string' ? item.id : `step_${idx + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : `Step ${idx + 1}`,
        prompt: toPromptBlocks(item.prompt, typeof item.title === 'string' ? item.title : `Step ${idx + 1}`),
        interaction,
        explanation: typeof item.explanation === 'string' ? item.explanation : null,
      } satisfies ProgramStepSpec;
    })
    .filter(Boolean) as ProgramStepSpec[];
}

export default function SuperAdminPage() {
  const { user, userData } = useAuth();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<Array<UserData & { uid: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // Relationship data
  const [ataLinks, setAtaLinks] = useState<AdminTeacherAssignment[]>([]);
  const [pslLinks, setPslLinks] = useState<ParentStudentLink[]>([]);

  // Teacher assignment modal (opened on admin rows)
  const [ataModal, setAtaModal] = useState<{ adminUid: string; adminName: string } | null>(null);
  const [ataSaving, setAtaSaving] = useState(false);

  // Economy modal
  const [econModal, setEconModal] = useState<{ uid: string; name: string; goldDelta: string; xpDelta: string; energyDelta: string; streakDelta: string } | null>(null);
  const [applyingEcon, setApplyingEcon] = useState(false);

  // Create account modal
  const [createModal, setCreateModal] = useState(false);
  const [createRole, setCreateRole] = useState<'teacher' | 'admin'>('teacher');
  const [createFname, setCreateFname] = useState('');
  const [createLname, setCreateLname] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPass, setCreatePass] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (userData && userData.role !== 'superadmin') setLocation('/');
    else loadData();
  }, [userData]);

  async function loadData() {
    setLoading(true);
    try {
      const [u, ata, psl] = await Promise.all([getAllUsers(), getAdminTeacherAssignments().catch(() => [] as AdminTeacherAssignment[]), getParentStudentLinks().catch(() => [] as ParentStudentLink[])]);
      setUsers(u);
      setAtaLinks(ata);
      setPslLinks(psl);
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteUser(uid: string) {
    const target = users.find(u => u.uid === uid);
    const isStudentOrParent = target?.role === 'student' || target?.role === 'parent';
    // Find paired account to remove from state
    let pairedUid: string | null = null;
    if (target?.role === 'student') {
      const link = pslLinks.find(l => l.student_id === uid);
      pairedUid = link?.parent_id ?? null;
    } else if (target?.role === 'parent') {
      const link = pslLinks.find(l => l.parent_id === uid);
      pairedUid = link?.student_id ?? null;
    }
    const msg = isStudentOrParent && pairedUid
      ? 'This will permanently delete BOTH the student and their linked parent account. Continue?'
      : 'Permanently delete this account? This cannot be undone.';
    if (!window.confirm(msg)) return;
    setDeletingUser(uid);
    await deleteUserData(uid);
    const removedIds = new Set([uid, ...(pairedUid ? [pairedUid] : [])]);
    setUsers(prev => prev.filter(u => !removedIds.has(u.uid)));
    setPslLinks(prev => prev.filter(l => !removedIds.has(l.student_id) && !removedIds.has(l.parent_id)));
    setDeletingUser(null);
  }

  async function handleEconApply() {
    if (!econModal) return;
    const gold = parseInt(econModal.goldDelta) || 0;
    const xp = parseInt(econModal.xpDelta) || 0;
    const energy = parseInt(econModal.energyDelta) || 0;
    const streak = parseInt(econModal.streakDelta) || 0;
    if (gold === 0 && xp === 0 && energy === 0 && streak === 0) { setEconModal(null); return; }
    setApplyingEcon(true);
    await adminUpdateEconomy(econModal.uid, { gold, xp, energy, streak });
    setUsers(prev => prev.map(u => u.uid === econModal.uid ? {
      ...u, economy: {
        ...u.economy,
        gold: Math.max(0, (u.economy?.gold || 0) + gold),
        global_xp: Math.max(0, (u.economy?.global_xp || 0) + xp),
        energy: Math.max(0, (u.economy?.energy || 0) + energy),
        streak: Math.max(0, (u.economy?.streak || 0) + streak),
      }
    } : u));
    setApplyingEcon(false);
    setEconModal(null);
  }

  async function handleCreateAccount() {
    if (!createFname || !createLname || !createUsername || !createEmail || !createPass) {
      setCreateError('Please fill in all fields.'); return;
    }
    if (createPass.length < 6) { setCreateError('Password must be at least 6 characters.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(createUsername)) { setCreateError('Username can only contain letters, numbers and underscores.'); return; }
    setCreating(true); setCreateError('');
    try {
      const taken = await isUsernameTaken(createUsername.toLowerCase());
      if (taken) { setCreateError('Username is already taken.'); return; }
      const admin = getAdminClient();
      const { data, error } = await admin.auth.admin.createUser({
        email: createEmail,
        password: createPass,
        email_confirm: true,
        user_metadata: { full_name: `${createFname} ${createLname}`.trim(), name: createUsername },
      });
      if (error) throw error;
      const authUser = data.user;
      if (!authUser) throw new Error('No user returned.');
      await createUserDataAdmin(authUser.id, {
        firstName: createFname, lastName: createLname, username: createUsername.toLowerCase(), email: createEmail,
        role: createRole, onboardingComplete: true,
      });
      setUsers(prev => [...prev, { uid: authUser.id, firstName: createFname, lastName: createLname, username: createUsername.toLowerCase(), email: createEmail, role: createRole, onboardingComplete: true } as UserData & { uid: string }]);
      setCreateModal(false);
      setCreateFname(''); setCreateLname(''); setCreateUsername(''); setCreateEmail(''); setCreatePass(''); setCreateError('');
    } catch (e: any) {
      setCreateError(e.message || 'Failed to create account.');
    } finally { setCreating(false); }
  }

  // Sort: parents above their linked students, then by role order, then alphabetically
  const sortedUsers = (() => {
    // Build parent→students map from pslLinks
    const parentStudents = new Map<string, string[]>();
    const studentParent = new Map<string, string>();
    for (const l of pslLinks) {
      if (!parentStudents.has(l.parent_id)) parentStudents.set(l.parent_id, []);
      parentStudents.get(l.parent_id)!.push(l.student_id);
      studentParent.set(l.student_id, l.parent_id);
    }
    // Group key: for linked parents/students, use the parent uid so they cluster together
    // Sort order within group: parent first (0), then students (1)
    type SortEntry = { user: typeof users[0]; groupKey: string; subOrder: number };
    const entries: SortEntry[] = users.map(u => {
      if (u.role === 'parent' && parentStudents.has(u.uid)) {
        return { user: u, groupKey: u.uid, subOrder: 0 };
      }
      if (u.role === 'student' && studentParent.has(u.uid)) {
        return { user: u, groupKey: studentParent.get(u.uid)!, subOrder: 1 };
      }
      return { user: u, groupKey: u.uid, subOrder: 0 };
    });
    entries.sort((a, b) => {
      if (a.groupKey !== b.groupKey) return a.groupKey < b.groupKey ? -1 : 1;
      return a.subOrder - b.subOrder;
    });
    return entries.map(e => e.user);
  })();

  const filtered = sortedUsers.filter(u => {
    const matchSearch = !search || [u.username, u.email, u.firstName, u.lastName].some(f => f?.toLowerCase().includes(search.toLowerCase()));
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const roleCounts = Object.fromEntries(ROLE_ORDER.map(r => [r, users.filter(u => u.role === r).length])) as Record<UserRole, number>;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👑</div>
          <div>Loading super admin panel...</div>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; icon: string; label: string; badge?: number }[] = [
    { id: 'overview', icon: '📊', label: 'Overview' },
    { id: 'users', icon: '👥', label: `Users (${users.length})` },
    { id: 'programs', icon: '📚', label: 'Programs' },
    { id: 'logicGames', icon: '🧩', label: 'Logic Games' },
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', background: '#1e293b', borderBottom: '2px solid #a855f744', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0, color: 'white', fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#a855f7' }}>👑</span> Super Admin Panel
              <span style={{ fontSize: 11, background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#d8b4fe', borderRadius: 6, padding: '2px 8px', fontWeight: 'normal' }}>
                GOD MODE
              </span>
            </h2>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>Full platform control · All accounts</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={loadData} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>
              ↺ Refresh
            </button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>
              Sign Out
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t.id ? 'rgba(168,85,247,0.2)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'rgba(168,85,247,0.5)' : 'transparent'}`,
              color: tab === t.id ? '#d8b4fe' : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6, position: 'relative'
            }}>
              {t.icon} {t.label}
              {t.badge != null && t.badge > 0 && (
                <span style={{
                  background: '#ef4444', color: 'white', borderRadius: '50%',
                  fontSize: 9, fontWeight: 'bold', minWidth: 16, height: 16,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 4px', lineHeight: 1
                }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10, marginBottom: 18 }}>
              {[
                { label: 'Total Users', value: users.length, icon: '👤', color: '#c084fc' },
                { label: 'Students', value: roleCounts.student, icon: '🧑‍🎓', color: ROLE_COLORS.student },
                { label: 'Admins', value: roleCounts.admin, icon: '🛡️', color: ROLE_COLORS.admin },
                { label: 'Teachers', value: roleCounts.teacher, icon: '�', color: ROLE_COLORS.teacher },
                { label: 'TAs', value: roleCounts.teacher_assistant, icon: '✏️', color: ROLE_COLORS.teacher_assistant },
                { label: 'Parents', value: roleCounts.parent, icon: '👨‍👩‍👧', color: ROLE_COLORS.parent },
                { label: 'Super Admins', value: roleCounts.superadmin, icon: '👑', color: ROLE_COLORS.superadmin },
              ].map(stat => (
                <div key={stat.label} style={{
                  background: '#1e293b', borderRadius: 10, padding: '14px 12px',
                  border: `1px solid ${stat.color}33`, textAlign: 'center'
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{stat.icon}</div>
                  <div style={{ fontSize: 20, fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                  <div style={{ color: '#64748b', fontSize: 10 }}>{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Top XP — students only */}
            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155', marginBottom: 14 }}>
              <h3 style={{ color: 'white', margin: '0 0 12px', fontSize: 14 }}>🏆 Top Student XP</h3>
              {[...users].filter(u => u.role === 'student').sort((a, b) => (b.economy?.global_xp || 0) - (a.economy?.global_xp || 0)).slice(0, 6).map((u, i) => {
                const { level, title } = computeLevel(u.economy?.global_xp || 0);
                const medals = ['🥇', '🥈', '🥉', '4', '5', '6'];
                return (
                  <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < 5 ? '1px solid #1e293b' : 'none' }}>
                    <span style={{ width: 22, fontSize: 14 }}>{medals[i]}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'white', fontSize: 12, fontWeight: 'bold' }}>{u.username || `${u.firstName} ${u.lastName}`}</div>
                      <div style={{ color: '#64748b', fontSize: 10 }}>Lv.{level} {title}</div>
                    </div>
                    <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 12 }}>{(u.economy?.global_xp || 0).toLocaleString()}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search name, username, email..."
                style={{ flex: 1, minWidth: 180, padding: '9px 13px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, outline: 'none' }}
              />
              <select
                value={roleFilter} onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
                style={{ padding: '9px 13px', borderRadius: 8, border: '1px solid #475569', background: '#1e293b', color: 'white', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', outline: 'none' }}
              >
                <option value="all">All Roles</option>
                {ROLE_ORDER.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}s ({roleCounts[r]})</option>)}
              </select>
              <button
                onClick={() => setCreateModal(true)}
                style={{ padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                + Create Account
              </button>
            </div>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>{filtered.length} users</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtered.map(u => {
                const isStudent = u.role === 'student';
                const { level, title } = isStudent ? computeLevel(u.economy?.global_xp || 0) : { level: 0, title: '' };
                const isExpanded = expandedUser === u.uid;
                const isSelf = u.uid === user?.uid;
                const roleColor = ROLE_COLORS[u.role as UserRole] || '#475569';
                const roleLabel = ROLE_LABELS[u.role as UserRole] || u.role;

                // Relationship info
                const managedTeachers = u.role === 'admin' ? ataLinks.filter(a => a.admin_id === u.uid).map(a => users.find(x => x.uid === a.teacher_id)).filter(Boolean) : [];
                const managingAdmins = u.role === 'teacher' ? ataLinks.filter(a => a.teacher_id === u.uid).map(a => users.find(x => x.uid === a.admin_id)).filter(Boolean) : [];
                const linkedParent = u.role === 'student' ? (() => { const link = pslLinks.find(l => l.student_id === u.uid); return link ? users.find(x => x.uid === link.parent_id) : null; })() : null;
                const linkedStudents = u.role === 'parent' ? pslLinks.filter(l => l.parent_id === u.uid).map(l => users.find(x => x.uid === l.student_id)).filter(Boolean) : [];

                return (
                  <div key={u.uid} style={{ background: '#1e293b', borderRadius: 10, border: `1px solid ${isExpanded ? '#a855f788' : '#334155'}`, overflow: 'hidden' }}>
                    <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                        style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                          background: `hsl(${(u.username?.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 'bold', color: 'white', fontSize: 14, border: 'none', cursor: 'pointer'
                        }}
                      >
                        {(u.username?.[0] || '?').toUpperCase()}
                      </button>
                      <div style={{ flex: 1, minWidth: 100 }}>
                        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13 }}>
                          {u.username || `${u.firstName} ${u.lastName}`}
                          {isSelf && <span style={{ marginLeft: 6, fontSize: 10, color: '#a855f7' }}>(you)</span>}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>
                          {u.email}{isStudent ? ` · Lv.${level} ${title}` : ''}
                          {/* Relationship hints */}
                          {u.role === 'admin' && managedTeachers.length > 0 && (
                            <span style={{ color: ROLE_COLORS.teacher }}> · {managedTeachers.length} teacher{managedTeachers.length !== 1 ? 's' : ''}</span>
                          )}
                          {u.role === 'teacher' && managingAdmins.length > 0 && (
                            <span style={{ color: ROLE_COLORS.admin }}> · admin: {managingAdmins.map(a => a!.username || a!.firstName).join(', ')}</span>
                          )}
                          {u.role === 'student' && linkedParent && (
                            <span style={{ color: ROLE_COLORS.parent }}> · parent: {linkedParent.username || linkedParent.firstName}</span>
                          )}
                          {u.role === 'parent' && linkedStudents.length > 0 && (
                            <span style={{ color: ROLE_COLORS.student }}> · {linkedStudents.length} student{linkedStudents.length !== 1 ? 's' : ''}: {linkedStudents.map(s => s!.username || s!.firstName).join(', ')}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5,
                          background: `${roleColor}22`, border: `1px solid ${roleColor}55`, color: roleColor
                        }}>{roleLabel}</span>
                        {!isSelf && (user?.email === 'god.bypass@internal.app' || u.role !== 'superadmin') && (
                          <>
                            {u.role === 'admin' && (
                              <button
                                onClick={() => setAtaModal({ adminUid: u.uid, adminName: u.username || u.firstName })}
                                style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                              >
                                👥 Teachers
                              </button>
                            )}
                            {isStudent && (
                              <button
                                onClick={() => setEconModal({ uid: u.uid, name: u.username || u.firstName, goldDelta: '', xpDelta: '', energyDelta: '', streakDelta: '' })}
                                style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                ✏️
                              </button>
                            )}
                            <button
                              disabled={deletingUser === u.uid}
                              onClick={() => handleDeleteUser(u.uid)}
                              style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '10px 14px 14px', borderTop: '1px solid #334155' }}>
                        {isStudent && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
                            {[
                              { label: 'XP', value: (u.economy?.global_xp || 0).toLocaleString(), color: '#10b981' },
                              { label: 'Gold', value: (u.economy?.gold || 0).toLocaleString(), color: '#fbbf24' },
                              { label: 'Energy', value: (u.economy?.energy || 0).toLocaleString(), color: '#06b6d4' },
                              { label: 'Streak', value: u.economy?.streak ?? 0, color: '#f97316' },
                              { label: 'Arena W', value: u.arenaStats?.wins ?? 0, color: '#3b82f6' },
                              { label: 'Arena L', value: u.arenaStats?.losses ?? 0, color: '#ef4444' },
                            ].map(s => (
                              <div key={s.label} style={{ background: '#0f172a', borderRadius: 8, padding: '8px 10px', textAlign: 'center', border: '1px solid #334155' }}>
                                <div style={{ fontSize: 14, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                                <div style={{ color: '#475569', fontSize: 10 }}>{s.label}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {!isStudent && (
                          <div style={{ color: '#64748b', fontSize: 12 }}>No game stats — only student accounts participate in games.</div>
                        )}
                        {/* Admin: list managed teachers */}
                        {u.role === 'admin' && managedTeachers.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Managed Teachers:</div>
                            {managedTeachers.map(t => (
                              <div key={t!.uid} style={{ display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 5, marginRight: 4, marginBottom: 4, background: `${ROLE_COLORS.teacher}22`, border: `1px solid ${ROLE_COLORS.teacher}44`, color: ROLE_COLORS.teacher }}>
                                {t!.username || t!.firstName}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Teacher: list managing admins */}
                        {u.role === 'teacher' && managingAdmins.length > 0 && (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold', marginBottom: 4 }}>Managed by Admins:</div>
                            {managingAdmins.map(a => (
                              <div key={a!.uid} style={{ display: 'inline-block', fontSize: 10, padding: '2px 8px', borderRadius: 5, marginRight: 4, marginBottom: 4, background: `${ROLE_COLORS.admin}22`, border: `1px solid ${ROLE_COLORS.admin}44`, color: ROLE_COLORS.admin }}>
                                {a!.username || a!.firstName}
                              </div>
                            ))}
                          </div>
                        )}
                        {u.curriculumProfile && (
                          <div style={{ marginTop: 8, fontSize: 11, color: '#64748b' }}>
                            Curriculum: {u.curriculumProfile.system} · {u.curriculumProfile.year}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Login as "${u.username || u.firstName}"? You will be signed out of your superadmin session.`)) return;
                              try {
                                const admin = getAdminClient();
                                const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
                                  type: 'magiclink',
                                  email: u.email,
                                });
                                if (linkError) throw linkError;
                                const token_hash = linkData?.properties?.hashed_token;
                                if (!token_hash) throw new Error('No token returned.');
                                const supabase = requireSupabase();
                                // Do NOT signOut first — it triggers onAuthStateChange which
                                // unmounts this component before verifyOtp can run.
                                // verifyOtp will replace the current session automatically.
                                const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash, type: 'magiclink' });
                                if (verifyErr) throw verifyErr;
                                localStorage.removeItem('ll:superadmin_session');
                                window.location.href = '/';
                              } catch (e: any) {
                                console.error('Impersonation error:', e);
                                window.alert('Impersonation failed: ' + (e.message || String(e)));
                              }
                            }}
                            style={{
                              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold',
                              fontFamily: 'inherit', cursor: 'pointer',
                              background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)',
                              color: '#c084fc',
                            }}
                          >
                            🔑 Login as {u.username || u.firstName}
                          </button>
                        </div>
                        <div style={{ color: '#475569', fontSize: 10, marginTop: 6 }}>UID: {u.uid}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PROGRAMS ── */}
        {tab === 'programs' && (
          <ProgramsAdmin />
        )}

        {/* ── LOGIC GAMES ── */}
        {tab === 'logicGames' && (
          <LogicGamesAdmin />
        )}
      </div>

      {/* Economy modal */}
      {econModal && (
        <>
          <div onClick={() => setEconModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(360px, 92vw)',
            border: '2px solid #fbbf24', zIndex: 1001, animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 14px', color: 'white', fontSize: 17 }}>✏️ Adjust Economy — {econModal.name}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 14 }}>
              <div>
                <label style={{ color: '#fbbf24', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>🪙 Gold Δ</label>
                <input type="number" placeholder="0" value={econModal.goldDelta}
                  onChange={e => setEconModal(p => p ? { ...p, goldDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#10b981', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>⭐ XP Δ</label>
                <input type="number" placeholder="0" value={econModal.xpDelta}
                  onChange={e => setEconModal(p => p ? { ...p, xpDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#06b6d4', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>⚡ Energy Δ</label>
                <input type="number" placeholder="0" value={econModal.energyDelta}
                  onChange={e => setEconModal(p => p ? { ...p, energyDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#f97316', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>🔥 Streak Δ</label>
                <input type="number" placeholder="0" value={econModal.streakDelta}
                  onChange={e => setEconModal(p => p ? { ...p, streakDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEconModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleEconApply} disabled={applyingEcon} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {applyingEcon ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Account modal */}
      {createModal && (
        <>
          <div onClick={() => setCreateModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 14, border: '2px solid #a855f7', padding: 24,
            zIndex: 1001, width: 'min(380px, 90vw)', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          }}>
            <h3 style={{ color: 'white', margin: '0 0 16px', fontSize: 16 }}>Create Teacher / Admin Account</h3>
            {createError && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>{createError}</div>}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['teacher', 'admin'] as const).map(r => (
                <button key={r} onClick={() => setCreateRole(r)} style={{
                  flex: 1, padding: '8px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', cursor: 'pointer',
                  background: createRole === r ? `${ROLE_COLORS[r]}22` : 'transparent',
                  border: `1px solid ${createRole === r ? `${ROLE_COLORS[r]}88` : '#334155'}`,
                  color: createRole === r ? ROLE_COLORS[r] : '#64748b',
                }}>{ROLE_LABELS[r]}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={createFname} onChange={e => setCreateFname(e.target.value)} placeholder="First Name" style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
              <input value={createLname} onChange={e => setCreateLname(e.target.value)} placeholder="Last Name" style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <input value={createUsername} onChange={e => setCreateUsername(e.target.value.toLowerCase().trim())} placeholder="Username" style={{ width: '100%', padding: '9px 12px', marginBottom: 8, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            <input value={createEmail} onChange={e => setCreateEmail(e.target.value.trim())} placeholder="Email" type="email" style={{ width: '100%', padding: '9px 12px', marginBottom: 8, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            <input value={createPass} onChange={e => setCreatePass(e.target.value)} placeholder="Password (min 6)" type="password" style={{ width: '100%', padding: '9px 12px', marginBottom: 14, borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCreateModal(false)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleCreateAccount} disabled={creating} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {creating ? 'Creating...' : `Create ${ROLE_LABELS[createRole]}`}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Admin ↔ Teacher assignment modal */}
      {ataModal && (() => {
        const allTeachers = users.filter(u => u.role === 'teacher');
        const assignedIds = new Set(ataLinks.filter(a => a.admin_id === ataModal.adminUid).map(a => a.teacher_id));

        async function toggleTeacher(teacherId: string) {
          setAtaSaving(true);
          try {
            if (assignedIds.has(teacherId)) {
              await removeAdminTeacherAssignment(ataModal!.adminUid, teacherId);
              setAtaLinks(prev => prev.filter(a => !(a.admin_id === ataModal!.adminUid && a.teacher_id === teacherId)));
            } else {
              await addAdminTeacherAssignment(ataModal!.adminUid, teacherId);
              setAtaLinks(prev => [...prev, { admin_id: ataModal!.adminUid, teacher_id: teacherId }]);
            }
          } catch (e) {
            console.error('Failed to update teacher assignment:', e);
            window.alert('Failed: ' + (e instanceof Error ? e.message : String(e)));
          } finally {
            setAtaSaving(false);
          }
        }

        return (
          <>
            <div onClick={() => setAtaModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(420px, 92vw)',
              maxHeight: '80vh', display: 'flex', flexDirection: 'column',
              border: `2px solid ${ROLE_COLORS.teacher}`, zIndex: 1001, animation: 'slideUp 0.2s ease'
            }}>
              <h2 style={{ margin: '0 0 6px', color: 'white', fontSize: 17 }}>
                👥 Manage Teachers — {ataModal.adminName}
              </h2>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 14 }}>
                Check/uncheck teachers this admin manages. {allTeachers.length === 0 && <span style={{ color: '#f59e0b' }}>No users with Teacher role found.</span>}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {allTeachers.map(t => {
                  const checked = assignedIds.has(t.uid);
                  return (
                    <label key={t.uid} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                      background: checked ? `${ROLE_COLORS.teacher}15` : 'transparent',
                      border: `1px solid ${checked ? `${ROLE_COLORS.teacher}55` : '#334155'}`,
                    }}>
                      <input
                        type="checkbox" checked={checked} disabled={ataSaving}
                        onChange={() => toggleTeacher(t.uid)}
                        style={{ accentColor: ROLE_COLORS.teacher, width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{t.username || `${t.firstName} ${t.lastName}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{t.email}</div>
                      </div>
                      {checked && <span style={{ color: ROLE_COLORS.teacher, fontSize: 11, fontWeight: 'bold' }}>✓ Assigned</span>}
                    </label>
                  );
                })}
              </div>
              <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setAtaModal(null)} className="ll-btn" style={{ padding: '10px 22px' }}>Done</button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}

function LogicGamesAdmin() {
  const { userData } = useAuth();
  const [, setLocation] = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [draftNodes, setDraftNodes] = useState<LogicGameNode[]>([]);
  const [selectedDraftNodeId, setSelectedDraftNodeId] = useState<string | null>(null);

  const [draftQuestionsJson, setDraftQuestionsJson] = useState('');
  const [draftQuestionsStatus, setDraftQuestionsStatus] = useState<string | null>(null);

  const [publishedNodes, setPublishedNodes] = useState<LogicGameNode[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const [draft, pub] = await Promise.all([listDraftLogicGameNodes(), listPublishedLogicGameNodes()]);
      setDraftNodes(draft);
      setPublishedNodes(pub);

      if (!selectedDraftNodeId && draft.length > 0) setSelectedDraftNodeId(draft[0].id);
      if (selectedDraftNodeId && draft.every((n) => n.id !== selectedDraftNodeId)) {
        setSelectedDraftNodeId(draft[0]?.id ?? null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to load logic game nodes');
    } finally {
      setLoading(false);
    }
  }

  async function renameDraftNode(nodeId: string) {
    const n = draftNodes.find((x) => x.id === nodeId);
    if (!n) return;
    const next = window.prompt('Enter node name', n.label ?? '') ?? '';
    const label = next.trim();

    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await upsertDraftLogicGameNode({ ...n, label });
      setDraftNodes((prev) => prev.map((x) => (x.id === nodeId ? { ...x, label } : x)));
      setStatus('✅ Renamed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to rename node');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadDraftQuestions() {
      if (!selectedDraftNodeId) return;
      setSaving(true);
      setErr(null);
      setDraftQuestionsStatus(null);
      try {
        const doc0 = await getDraftLogicGameQuestions(selectedDraftNodeId);
        const arr = Array.isArray(doc0?.questions) ? doc0!.questions : [];
        if (!alive) return;
        setDraftQuestionsJson(JSON.stringify(arr, null, 2));
        setDraftQuestionsStatus('Loaded draft JSON');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!alive) return;
        setErr(msg || 'Failed to load draft questions');
      } finally {
        if (alive) setSaving(false);
      }
    }
    void loadDraftQuestions();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDraftNodeId]);

  function validateQuestionsJson(arr: any[]): string | null {
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      if (!q || typeof q !== 'object') return `Question at index ${i} must be an object`;
      if (typeof q.id !== 'string' || !q.id.trim()) return `Question at index ${i} is missing a string 'id'`;
      if (!q.interaction || typeof q.interaction !== 'object') return `Question ${q.id} is missing 'interaction'`;
      if (typeof q.timeLimitSec !== 'number' || !Number.isFinite(q.timeLimitSec)) return `Question ${q.id} is missing numeric 'timeLimitSec'`;
      if (typeof q.iqDeltaCorrect !== 'number' || !Number.isFinite(q.iqDeltaCorrect)) return `Question ${q.id} is missing numeric 'iqDeltaCorrect'`;
      if (typeof q.iqDeltaWrong !== 'number' || !Number.isFinite(q.iqDeltaWrong)) return `Question ${q.id} is missing numeric 'iqDeltaWrong'`;
    }
    return null;
  }

  async function saveDraftQuestions() {
    if (!selectedDraftNodeId) return;
    setSaving(true);
    setErr(null);
    setDraftQuestionsStatus(null);
    try {
      const raw = draftQuestionsJson.trim() ? JSON.parse(draftQuestionsJson) : [];
      if (!Array.isArray(raw)) throw new Error('JSON must be an array of questions');
      const validationErr = validateQuestionsJson(raw);
      if (validationErr) throw new Error(validationErr);
      await upsertDraftLogicGameQuestions(selectedDraftNodeId, {
        questions: raw,
        updatedAt: new Date().toISOString(),
      } satisfies Omit<LogicGameQuestionsDoc, 'nodeId'>);
      setDraftQuestionsStatus('✅ Saved successfully');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to save draft JSON');
    } finally {
      setSaving(false);
    }
  }

  async function addDraftNode() {
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const nextOrder = draftNodes.length > 0 ? Math.max(...draftNodes.map((n) => n.order ?? 0)) + 1 : 0;
      const nextIq = draftNodes.length > 0 ? (draftNodes[draftNodes.length - 1].iq ?? 80) + 10 : 80;
      const id = `iq-${nextIq}`;
      const node: LogicGameNode = { id, iq: nextIq, order: nextOrder, label: '' };
      await upsertDraftLogicGameNode(node);
      await upsertDraftLogicGameQuestions(id, { questions: [], updatedAt: new Date().toISOString() });

      setDraftNodes((prev) => {
        const next = prev.some((n) => n.id === node.id) ? prev : [...prev, node];
        return next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      });
      setSelectedDraftNodeId(id);
      setStatus('✅ Node added');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to add node');
    } finally {
      setSaving(false);
    }
  }

  async function setDraftNodeIq(nodeId: string, nextIqRaw: string) {
    const nextIq = Number(nextIqRaw);
    if (!Number.isFinite(nextIq)) return;
    const n = draftNodes.find((x) => x.id === nodeId);
    if (!n) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await upsertDraftLogicGameNode({ ...n, iq: nextIq });

      setDraftNodes((prev) =>
        prev
          .map((x) => (x.id === nodeId ? { ...x, iq: nextIq } : x))
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
      setStatus('✅ Node IQ saved');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to save node IQ');
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraftNode(nodeId: string) {
    if (!window.confirm('Delete this draft node + its draft questions?')) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await deleteDraftLogicGameNode(nodeId);
      if (selectedDraftNodeId === nodeId) setSelectedDraftNodeId(null);
      setDraftQuestionsJson('');
      setDraftQuestionsStatus(null);
      await load();
      setStatus('✅ Draft node deleted');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to delete draft node');
    } finally {
      setSaving(false);
    }
  }

  function openPreviewAll() {
    localStorage.setItem('ll:logicGamePreviewUnlockAll', '1');
    setLocation('/logic-preview');
  }

  function openPreviewPublishedAll() {
    localStorage.setItem('ll:logicGamePreviewUnlockAll', '1');
    setLocation('/logic-preview');
  }

  async function publishSelectedDraftNode() {
    if (!selectedDraftNodeId) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      await publishLogicGameNode(selectedDraftNodeId);
      await publishLogicGameQuestions(selectedDraftNodeId);
      await load();
      setStatus('✅ Published');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to publish');
    } finally {
      setSaving(false);
    }
  }

  async function publishAllDraftNodes() {
    if (draftNodes.length === 0) return;
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      if (selectedDraftNodeId) {
        const raw = draftQuestionsJson.trim() ? JSON.parse(draftQuestionsJson) : [];
        if (!Array.isArray(raw)) throw new Error('JSON must be an array of questions');
        const validationErr = validateQuestionsJson(raw);
        if (validationErr) throw new Error(validationErr);
        await upsertDraftLogicGameQuestions(selectedDraftNodeId, {
          questions: raw,
          updatedAt: new Date().toISOString(),
        } satisfies Omit<LogicGameQuestionsDoc, 'nodeId'>);
        setDraftQuestionsStatus('✅ Saved successfully');
      }

      const sorted = draftNodes.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const n of sorted) {
        await publishLogicGameNode(n.id);
        try {
          await publishLogicGameQuestions(n.id);
        } catch (e) {
          const existing = await getDraftLogicGameQuestions(n.id);
          if (!existing) {
            await upsertDraftLogicGameQuestions(n.id, { questions: [], updatedAt: new Date().toISOString() });
            await publishLogicGameQuestions(n.id);
          } else {
            throw e;
          }
        }
      }

      const pub = await listPublishedLogicGameNodes();
      setPublishedNodes(pub);
      setStatus(`✅ Published ${sorted.length} nodes`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || 'Failed to publish draft nodes');
    } finally {
      setSaving(false);
    }
  }

  if (!userData || userData.role !== 'superadmin') return null;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>🧩 Logic Games</h3>
        <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>
          ↺ Refresh
        </button>
      </div>

      {err && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {status && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10 }}>{status}</div>}


      <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: 12, alignItems: 'start' }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Current Nodes (Draft)</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>{draftNodes.length}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={addDraftNode} disabled={saving} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12, fontWeight: 1000 }}>
                +
              </button>
              <button onClick={publishAllDraftNodes} disabled={saving || draftNodes.length === 0} className="ll-btn ll-btn-primary" style={{ padding: '7px 12px', fontSize: 12 }}>
                Publish
              </button>
            </div>
          </div>

          <div style={{ padding: 12 }}>
            {loading ? (
              <div style={{ color: '#94a3b8', fontSize: 12 }}>Loading…</div>
            ) : draftNodes.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No draft nodes yet. Click + to add one.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {draftNodes
                  .slice()
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                  .map((n, idx, arr) => {
                    const active = n.id === selectedDraftNodeId;
                    return (
                      <div key={n.id}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                          <button
                            onClick={() => setSelectedDraftNodeId(n.id)}
                            className="ll-btn"
                            style={{
                              flex: 1,
                              textAlign: 'left',
                              padding: '10px 10px',
                              borderRadius: 12,
                              background: active ? 'rgba(34,197,94,0.12)' : 'rgba(15,23,42,0.55)',
                              border: active ? '1px solid rgba(34,197,94,0.45)' : '1px solid #334155',
                              color: active ? '#bbf7d0' : 'white',
                              fontWeight: 900,
                            }}
                          >
                            {n.label}
                          </button>

                          <button
                            className="ll-btn"
                            title="Rename"
                            onClick={() => void renameDraftNode(n.id)}
                            style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000 }}
                          >
                            ✎
                          </button>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 900 }}>Start IQ</div>
                            <input
                              defaultValue={String(n.iq ?? 80)}
                              onBlur={(e) => void setDraftNodeIq(n.id, e.target.value)}
                              style={{ width: 90, padding: '9px 10px', borderRadius: 10, border: '1px solid #475569', background: '#0f172a', color: 'white', fontWeight: 900, outline: 'none' }}
                            />
                          </div>

                          <button
                            className="ll-btn"
                            title="Delete"
                            onClick={() => void deleteDraftNode(n.id)}
                            style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                          >
                            🗑
                          </button>
                        </div>

                        {idx < arr.length - 1 && (
                          <div style={{ paddingLeft: 12, paddingTop: 8, color: '#64748b', fontWeight: 900 }}>
                            →
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Selected Node JSON (Draft)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={openPreviewAll} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>Preview</button>
                <button onClick={saveDraftQuestions} disabled={!selectedDraftNodeId || saving} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>Save</button>
              </div>
            </div>

            {draftQuestionsStatus && <div style={{ color: '#34d399', fontSize: 12, marginBottom: 10 }}>{draftQuestionsStatus}</div>}

            {!selectedDraftNodeId ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>Select a draft node to edit its JSON.</div>
            ) : (
              <textarea
                value={draftQuestionsJson}
                onChange={(e) => setDraftQuestionsJson(e.target.value)}
                placeholder='Paste JSON array of questions here. Each question must include: id, interaction, timeLimitSec, iqDeltaCorrect, iqDeltaWrong.'
                spellCheck={false}
                style={{
                  width: '100%',
                  minHeight: 420,
                  padding: 12,
                  borderRadius: 12,
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: 'white',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>

          <div style={{ background: '#0b1220', border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: 12, borderBottom: '1px solid #1f2a44', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>Published Nodes</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#64748b', fontSize: 11 }}>{publishedNodes.length}</div>
                <button onClick={openPreviewPublishedAll} className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }}>
                  Preview
                </button>
              </div>
            </div>
            <div style={{ padding: 12 }}>
              {publishedNodes.length === 0 ? (
                <div style={{ color: '#64748b', fontSize: 12 }}>No published nodes yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {publishedNodes
                    .slice()
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                    .map((n) => (
                      <div key={n.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                        <div
                          style={{
                            flex: 1,
                            padding: '10px 10px',
                            borderRadius: 12,
                            background: 'rgba(15,23,42,0.55)',
                            border: '1px solid #334155',
                            color: 'white',
                            fontWeight: 900,
                          }}
                        >
                          {n.label}
                          <span style={{ color: '#64748b', fontWeight: 800, marginLeft: 8, fontSize: 11 }}>(order {n.order})</span>
                        </div>
                        <button
                          className="ll-btn"
                          title="Delete"
                          onClick={async () => {
                            if (!window.confirm('Delete this published node + its questions?')) return;
                            setSaving(true);
                            setErr(null);
                            setStatus(null);
                            try {
                              await deletePublishedLogicGameNode(n.id);
                              await load();
                              setStatus('✅ Published node deleted');
                            } catch (e) {
                              const msg = e instanceof Error ? e.message : String(e);
                              setErr(msg || 'Failed to delete node');
                            } finally {
                              setSaving(false);
                            }
                          }}
                          style={{ padding: '0 10px', borderRadius: 12, fontWeight: 1000, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgramsAdmin() {
  const { user, userData } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [draftItems, setDraftItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'list' | 'builder' | 'preview'>('list');
  const [previewReturnView, setPreviewReturnView] = useState<'list' | 'builder'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubject, setDraftSubject] = useState('mathematics');
  const [draftGradeBand, setDraftGradeBand] = useState('');
  const [draftEmoji, setDraftEmoji] = useState('📘');
  const [draftTocJson, setDraftTocJson] = useState('');
  const [draftQuestionBankJson, setDraftQuestionBankJson] = useState('');
  const [draftAnnotationsJson, setDraftAnnotationsJson] = useState('');
  const [draftProgramMetaJson, setDraftProgramMetaJson] = useState('');
  const [draftNestedJson, setDraftNestedJson] = useState('');
  const [nestedGenStatus, setNestedGenStatus] = useState<string>('');

  const [builder, setBuilder] = useState<BuilderSpec>(() => newBuilderSpec());
  const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);
  const [builderSelectedQuestionTypeId, setBuilderSelectedQuestionTypeId] = useState<string | null>(null);
  const [previewProgramId, setPreviewProgramId] = useState<string | null>(null);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadedImageErr, setUploadedImageErr] = useState<string>('');

  const [digitalizeFiles, setDigitalizeFiles] = useState<File[]>([]);
  const [digitalizeBusy, setDigitalizeBusy] = useState(false);
  const [digitalizeStatus, setDigitalizeStatus] = useState('');
  const [digitalizeError, setDigitalizeError] = useState('');
  const [digitalizePastedText, setDigitalizePastedText] = useState('');

  const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 13px',
    marginBottom: 12,
    borderRadius: 8,
    border: '1px solid #475569',
    background: 'rgba(0,0,0,0.4)',
    color: 'white',
    boxSizing: 'border-box',
    fontSize: 14,
    fontFamily: 'inherit',
    outline: 'none',
  };

  function cleanGeneratedTitle(raw: string | null | undefined, fallbackFileName?: string): string {
    const source = (raw ?? '').trim() || (fallbackFileName ?? '').replace(/\.[^.]+$/, '');
    const withoutPrefix = source.replace(/^[a-z0-9]{6,}(?:[-_\s]+|$)/i, '');
    const normalized = withoutPrefix
      .replace(/[_-]+/g, ' ')
      .replace(/\bEquation\s*20a\b/i, 'Equation')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized || /^[a-z0-9]{6,}$/i.test(normalized) || /^worksheet$/i.test(normalized)) return 'Imported Worksheet';
    return normalized;
  }

  function cleanFolderLabel(raw: string): string {
    const cleaned = raw
      .replace(/\.[^.]+$/, '')
      .replace(/^[a-z0-9]{6,}[-_]+/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'Topic 1';
  }

  function summarizeImportedTopic(text: string): string {
    const joined = text.toLowerCase();
    if (/equation of the line|line passes through|points .* line|y\s*=/.test(joined)) return 'Lines and Linear Equations';
    if (/graph|coordinate/.test(joined)) return 'Graphs and Coordinates';
    if (/fraction/.test(joined)) return 'Fractions';
    if (/algebra/.test(joined)) return 'Algebra Practice';
    return 'Worksheet Practice';
  }

  function chooseImportedQuestionTypeTitle(text: string): string {
    if (/equation of the line|line passes through|points .* line|y\s*=/.test(text.toLowerCase())) return 'Line Questions';
    return 'Practice Questions';
  }

  function isPlaceholderExtractionText(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.length === 0 || /no extractable text found/i.test(trimmed);
  }

  async function handleDigitalize() {
    if (!userData || (userData.role !== 'superadmin' && userData.role !== 'admin')) {
      setDigitalizeError('Only admins and superadmins can digitalize PDFs.');
      return;
    }
    const trimmedPastedText = digitalizePastedText.trim();
    const filesToProcess = digitalizeFiles.length > 0
      ? digitalizeFiles
      : (trimmedPastedText
          ? [new File([
              trimmedPastedText,
            ], `${makeIdFromTitle(builder.programTitle || 'worksheet') || 'worksheet'}.txt`, { type: 'text/plain' })]
          : []);
    if (filesToProcess.length === 0) {
      setDigitalizeError('Add at least one PDF file or paste worksheet text first.');
      return;
    }
    const adminUserId = user?.id;
    if (!adminUserId) {
      setDigitalizeError('Authenticated user id is missing. Please sign in again.');
      return;
    }

    setDigitalizeBusy(true);
    setDigitalizeError('');
    setDigitalizeStatus('Starting digitalization...');

    try {
      const allQuestions: Array<{
        id: string;
        rawText: string;
        page: number;
        kind: string;
        prompt: ProgramPromptBlock[];
        interaction: ProgramAtomicInteractionSpec | ({ type: 'composite'; final: ProgramAtomicInteractionSpec; steps: ProgramStepSpec[]; allowDirectFinalAnswer?: boolean; scoreStrategy?: 'final_only' | 'final_plus_steps' }) | null;
        difficulty: 'easy' | 'medium' | 'hard';
        hint: string[];
        solution: string | null;
        stepSolutions: ProgramStepSpec[];
      }> = [];
      let titleGuess = '';
      let structuredHierarchy: Array<{ id: string; type: string; title: string; children: Array<{ id: string; type: string; title: string; children: unknown[]; questionRefs?: string[]; questionTypeTitle?: string }>; questionRefs?: string[]; questionTypeTitle?: string }> = [];
      let structuredDivisions: BuilderDivisionLabel[] = ['Chapters', 'Topics'];

      for (let fi = 0; fi < filesToProcess.length; fi++) {
        const file = filesToProcess[fi]!;
        setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] Creating job for ${file.name}...`);

        const created = await createProgramIngestionJob({
          adminUserId,
          visibility: 'public',
          sourceFileName: file.name,
          title: builder.programTitle.trim() || undefined,
        });

        setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] Uploading ${file.name}...`);
        await uploadProgramIngestionSource(created.jobId, file);

        const stages = [
          { stage: 'extractDocument' as const, label: 'Extracting text...' },
          { stage: 'auditExtraction' as const, label: 'Auditing extraction...' },
          { stage: 'segmentQuestions' as const, label: 'Segmenting questions...' },
          { stage: 'normalizeQuestions' as const, label: 'Normalizing with AI...' },
          { stage: 'structureDraft' as const, label: 'Structuring draft with AI...' },
        ];

        for (const step of stages) {
          setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] ${step.label}`);
          await runProgramIngestionStage(created.jobId, step.stage);
        }

        setDigitalizeStatus(`[${fi + 1}/${filesToProcess.length}] Fetching results...`);
        const state = await getProgramIngestionJob(created.jobId);

        const extractedPages = ((state.draft as { extractedDocument?: { pages?: Array<{ fullText?: string | null }> } }).extractedDocument?.pages ?? []);
        const hasReadableExtraction = extractedPages.some((page: { fullText?: string | null }) => !isPlaceholderExtractionText(page.fullText ?? ''));
        if (!hasReadableExtraction) {
          throw new Error(
            `Could not extract readable text from ${file.name}. The PDF appears to be scanned/image-based and OCR did not return usable text. Try a text-based PDF, or we can next improve the OCR prompt/provider.`,
          );
        }

        if (!titleGuess && state.draft.extractionReport?.titleGuess) {
          titleGuess = cleanGeneratedTitle(state.draft.extractionReport.titleGuess, file.name);
        }

        if (Array.isArray(state.draft.hierarchy) && state.draft.hierarchy.length > 0) {
          structuredHierarchy = state.draft.hierarchy;
        }

        for (const q of state.questions) {
          const nq = q.normalizedQuestion as Record<string, unknown> | null;
          const prompt = toPromptBlocks(nq?.prompt, q.rawExtractedBlock.rawText);
          const promptText = prompt.map((b) => ('text' in b ? b.text : 'latex' in b ? b.latex : '')).join(' ').trim() || q.rawExtractedBlock.rawText;
          if (isPlaceholderExtractionText(promptText)) {
            continue;
          }
          const answerData = asRecord(nq?.answerData);
          const finalInteraction = deterministicAnswerToInteraction(answerData?.final);
          const stepSolutions = getNormalizedSolutionSteps(answerData?.steps);
          const scoreStrategy: 'final_only' | 'final_plus_steps' = (asRecord(nq?.grading)?.mode === 'step_based' || stepSolutions.length > 0)
            ? 'final_plus_steps'
            : 'final_only';
          const interaction = finalInteraction
            ? (stepSolutions.length > 0
              ? {
                  type: 'composite' as const,
                  final: finalInteraction,
                  steps: stepSolutions,
                  allowDirectFinalAnswer: answerData?.allowDirectFinalAnswer !== false,
                  scoreStrategy,
                }
              : finalInteraction)
            : { type: 'text' as const, accepted: [''], caseSensitive: false, trim: true };
          const difficulty = nq?.difficulty === 'easy' || nq?.difficulty === 'hard' ? nq.difficulty : 'medium';
          allQuestions.push({
            id: q.id,
            rawText: q.rawExtractedBlock.rawText,
            page: q.rawExtractedBlock.page,
            kind: (nq?.kind ?? 'open_response_ai') as string,
            prompt,
            interaction,
            difficulty,
            hint: getStringArray(nq?.hints),
            solution: typeof answerData?.solution === 'string'
              ? answerData.solution
              : (typeof nq?.explanation === 'string' ? nq.explanation : null),
            stepSolutions,
          });
        }
      }

      if (allQuestions.length === 0) {
        throw new Error('No usable questions were extracted from the selected PDF(s). The OCR/extraction output was empty or placeholder-only.');
      }

      setDigitalizeStatus('Populating builder...');

      const groupedById: Record<string, Record<string, unknown>> = {};
      const allQuestionText = allQuestions
        .map((q) => q.prompt.map((b) => ('text' in b ? b.text : 'latex' in b ? b.latex : '')).join('\n').trim() || q.rawText)
        .join('\n\n');
      const inferredTopicTitle = summarizeImportedTopic(allQuestionText);
      const inferredQuestionTypeTitle = chooseImportedQuestionTypeTitle(allQuestionText);
      const cleanedTitleGuess = cleanGeneratedTitle(titleGuess);
      const finalTitleGuess = cleanedTitleGuess !== 'Imported Worksheet'
        ? cleanedTitleGuess
        : cleanGeneratedTitle(inferredTopicTitle || 'Imported Worksheet');

      for (const q of allQuestions) {
        const questionText = q.prompt.map((b) => ('text' in b ? b.text : 'latex' in b ? b.latex : '')).join('\n').trim() || q.rawText;
        groupedById[q.id] = {
          id: q.id,
          question: questionText,
          promptBlocks: q.prompt,
          interaction: q.interaction,
          difficulty: q.difficulty,
          hint: q.hint,
          solution: q.solution,
          stepSolutions: q.stepSolutions,
        };
      }

      function buildQuestionTypeNode(title: string, questionIds: string[]): BuilderQuestionTypeFile {
        return {
          id: makeStableId('qt'),
          title,
          jsonText: JSON.stringify(questionIds.map((id) => groupedById[id]).filter(Boolean), null, 2),
        };
      }

      function buildTopicNode(topic: { id: string; title: string; questionRefs?: string[]; questionTypeTitle?: string }): BuilderNode {
        const refs = Array.isArray(topic.questionRefs) ? topic.questionRefs : [];
        return {
          id: topic.id || makeStableId('node'),
          title: cleanFolderLabel(topic.title || inferredTopicTitle || 'Imported Topic'),
          children: [],
          questionTypes: [buildQuestionTypeNode(topic.questionTypeTitle || inferredQuestionTypeTitle || 'Practice Questions', refs)],
        };
      }

      const chapters: BuilderNode[] = structuredHierarchy.length > 0
        ? structuredHierarchy.map((chapter) => ({
            id: chapter.id || makeStableId('node'),
            title: cleanGeneratedTitle(chapter.title || finalTitleGuess || 'Imported Chapter'),
            children: (chapter.children ?? []).map((topic) => buildTopicNode(topic)),
            questionTypes: [],
          }))
        : [
            {
              id: makeStableId('node'),
              title: finalTitleGuess,
              children: [
                {
                  id: makeStableId('node'),
                  title: cleanFolderLabel(inferredTopicTitle || finalTitleGuess || 'Imported Questions'),
                  children: [],
                  questionTypes: [buildQuestionTypeNode(inferredQuestionTypeTitle, Object.keys(groupedById))],
                },
              ],
              questionTypes: [],
            },
          ];

      setBuilder((prev) => {
        const spec = ensureFixedFirstDivisionContainer({ ...prev, divisions: structuredDivisions });
        const fixedIdx = spec.root.children.findIndex((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID);
        const fixed = fixedIdx >= 0 ? spec.root.children[fixedIdx]! : { id: FIXED_FIRST_DIVISION_NODE_ID, title: 'Chapters', children: [], questionTypes: [] };
        const updatedFixed = { ...fixed, title: structuredDivisions[0] ?? 'Chapters', children: [...fixed.children, ...chapters] };
        const nextChildren = [...spec.root.children];
        if (fixedIdx >= 0) {
          nextChildren[fixedIdx] = updatedFixed;
        } else {
          nextChildren.unshift(updatedFixed);
        }
        return ensureFixedFirstDivisionContainer({
          ...spec,
          programTitle: cleanGeneratedTitle(spec.programTitle || finalTitleGuess || chapters[0]?.title || 'Imported Worksheet'),
          root: {
            ...spec.root,
            title: spec.root.title === 'Enter program title' ? cleanGeneratedTitle(finalTitleGuess || chapters[0]?.title || 'Imported Worksheet') : spec.root.title,
            children: nextChildren,
          },
        });
      });

      setBuilderPathIds(['root', chapters[0]?.id ?? 'root', chapters[0]?.children?.[0]?.id ?? 'root']);
      setDigitalizeStatus(`✅ Imported ${allQuestions.length} question(s) from ${filesToProcess.length} source(s)`);
    } catch (error) {
      setDigitalizeError(error instanceof Error ? error.message : String(error));
    } finally {
      setDigitalizeBusy(false);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [next, dnext] = await Promise.all([
        listProgramsAdmin('published'),
        listProgramsAdmin('draft'),
      ]);
      setItems(next as typeof items);
      setDraftItems(dnext as typeof draftItems);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetDraft() {
    setEditingId(null);
    setEditingDraftId(null);
    setView('list');
    setDraftId('');
    setDraftTitle('');
    setDraftSubject('mathematics');
    setDraftGradeBand('');
    setDraftEmoji('📘');
    setDraftTocJson('');
    setDraftQuestionBankJson('');
    setDraftAnnotationsJson('');
    setDraftProgramMetaJson('');
    setDraftNestedJson('');
    setNestedGenStatus('');

    setBuilder(newBuilderSpec());
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);

    setDigitalizeFiles([]);
    setDigitalizeStatus('');
    setDigitalizeError('');
    setDigitalizePastedText('');
  }

  function startNewBuilder() {
    const b = newBuilderSpec();
    setEditingId(null);
    setEditingDraftId(null);
    setView('builder');
    setBuilder(b);
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);
  }

  function startEditBuilder(p: (typeof items)[number]) {
    setEditingId(p.id);
    setEditingDraftId(null);
    const spec = (p as any).builderSpec as BuilderSpec | undefined;
    const next = spec && typeof spec === 'object' && spec.version === '1.0'
      ? spec
      : (() => {
          const b = newBuilderSpec();
          b.programId = p.id;
          b.programTitle = (p.title as string) ?? p.id;
          b.subject = (p.subject as string) ?? 'mathematics';
          b.gradeBand = (p.grade_band as string) ?? '';
          b.coverEmoji = (p.coverEmoji as string) ?? '📘';
          b.root.title = (p.title as string) ?? p.id;
          return b;
        })();
    setBuilder(ensureFixedFirstDivisionContainer(next));
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);
    setView('builder');
  }

  async function startEditDraftBuilder(d: (typeof draftItems)[number]) {
    setEditingId(null);
    setEditingDraftId(d.id);
    try {
      const data = await getDraftProgramAdmin(d.id);
      if (!data) {
        window.alert('Draft not found');
        return;
      }
      const spec = data?.builderSpec as BuilderSpec | undefined;
      const next = spec && typeof spec === 'object' && spec.version === '1.0'
        ? spec
        : (() => {
            const b = newBuilderSpec();
            b.programId = d.id;
            b.programTitle = (data?.title as string) ?? d.id;
            b.subject = (data?.subject as string) ?? 'mathematics';
            b.gradeBand = (data?.grade_band as string) ?? '';
            b.coverEmoji = (data?.coverEmoji as string) ?? '📘';
            b.root.title = (data?.title as string) ?? d.id;
            return b;
          })();
      setBuilder(ensureFixedFirstDivisionContainer(next));
      setBuilderPathIds(['root']);
      setBuilderSelectedQuestionTypeId(null);
      setView('builder');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  }

  function setBuilderAtNode(nodeId: string, fn: (n: BuilderNode) => BuilderNode) {
    setBuilder((prev) => {
      function mapNode(n: BuilderNode): BuilderNode {
        if (n.id === nodeId) return fn(n);
        return { ...n, children: n.children.map(mapNode) };
      }
      return ensureFixedFirstDivisionContainer({ ...prev, root: mapNode(prev.root) });
    });
  }

  function findNodeByPath(b: BuilderSpec, pathIds: string[]): BuilderNode | null {
    const normalized = ensureFixedFirstDivisionContainer(b);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;

    let cur: BuilderNode = normalized.root;
    for (const id of pathIds.slice(1)) {
      const pool = cur.id === 'root' && fixed ? fixed.children : cur.children;
      const next = pool.find((c) => c.id === id);
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  function pathNodes(b: BuilderSpec, pathIds: string[]): BuilderNode[] {
    const normalized = ensureFixedFirstDivisionContainer(b);
    const fixed = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;

    const nodes: BuilderNode[] = [];
    let cur: BuilderNode = normalized.root;
    nodes.push(cur);

    for (const id of pathIds.slice(1)) {
      const pool = cur.id === 'root' && fixed ? fixed.children : cur.children;
      const next = pool.find((c) => c.id === id);
      if (!next) break;
      nodes.push(next);
      cur = next;
    }
    return nodes;
  }

  function computeProgramIdAndTitle(): { id: string; title: string } {
    const title = builder.programTitle.trim() || builder.root.title.trim();
    const idBase = builder.programId.trim() || makeIdFromTitle(title) || 'program';
    const id = String(editingId || editingDraftId || idBase).trim() || idBase;
    return { id, title: title || id };
  }

  function formatBuilderError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (error && typeof error === 'object') {
      const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
      const parts: string[] = [];
      if (typeof e.message === 'string' && e.message.trim()) parts.push(e.message.trim());
      if (typeof e.details === 'string' && e.details.trim()) parts.push(e.details.trim());
      if (typeof e.hint === 'string' && e.hint.trim()) parts.push(`Hint: ${e.hint.trim()}`);
      if (typeof e.code === 'string' && e.code.trim()) parts.push(`(${e.code.trim()})`);
      if (parts.length > 0) return parts.join('\n');
    }
    return String(error);
  }

  function getQuestionPromptLabel(question: any): string {
    if (typeof question?.question === 'string' && question.question.trim()) return question.question.trim().slice(0, 80);
    if (Array.isArray(question?.promptBlocks)) {
      const textBlock = question.promptBlocks.find((block: any) => block && typeof block.text === 'string' && block.text.trim());
      if (textBlock) return String(textBlock.text).trim().slice(0, 80);
    }
    return '—';
  }

  async function handleQuestionImageUpload(nodeId: string, questionTypeId: string, questionTypeJsonText: string, questionIndex: number, questionId: string, file: File): Promise<void> {
    if (!userData || userData.role !== 'superadmin') throw new Error('Only super admins can upload images.');
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error('Unsupported file type. Please upload PNG, JPG/JPEG, WEBP, or GIF.');
    if (typeof file.size === 'number' && file.size > MAX_IMAGE_BYTES) throw new Error('Image is too large. Max size is 5MB.');

    setUploadingImage(true);
    setUploadedImageErr('');
    try {
      const raw = questionTypeJsonText.trim() ? JSON.parse(questionTypeJsonText) : [];
      if (!Array.isArray(raw)) throw new Error('Question Type JSON must be a JSON array');

      const programId = (builder.programId || makeIdFromTitle(builder.programTitle) || 'program').trim() || 'program';
      const uploaded = await uploadProgramQuestionAsset(file, programId);
      const url = uploaded.url;

      const next = [...raw];
      const question = next[questionIndex] && typeof next[questionIndex] === 'object' ? { ...(next[questionIndex] as any) } : { id: questionId };
      const promptBlocks = Array.isArray((question as any).promptBlocks) ? ([...(question as any).promptBlocks] as any[]) : [];
      promptBlocks.push({ type: 'image', url, alt: 'diagram' });
      (question as any).promptBlocks = promptBlocks;
      next[questionIndex] = question;

      const nextText = JSON.stringify(next, null, 2);
      setBuilderAtNode(nodeId, (n) => ({
        ...n,
        questionTypes: n.questionTypes.map((x) => x.id === questionTypeId ? { ...x, jsonText: nextText } : x),
      }));
    } catch (err) {
      setUploadedImageErr(formatBuilderError(err));
      throw err;
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleQuestionImageDelete(nodeId: string, questionTypeId: string, questionTypeJsonText: string, questionIndex: number, imageIndex: number): Promise<void> {
    if (!userData || userData.role !== 'superadmin') {
      setUploadedImageErr('Only super admins can delete images.');
      return;
    }

    setUploadingImage(true);
    setUploadedImageErr('');
    try {
      const raw = questionTypeJsonText.trim() ? JSON.parse(questionTypeJsonText) : [];
      if (!Array.isArray(raw)) throw new Error('Question Type JSON must be a JSON array');

      const next = [...raw];
      const question = next[questionIndex] && typeof next[questionIndex] === 'object' ? { ...(next[questionIndex] as any) } : null;
      if (!question) throw new Error('Question not found.');

      const promptBlocks = Array.isArray((question as any).promptBlocks) ? ([...(question as any).promptBlocks] as any[]) : [];
      const imageBlocks = promptBlocks
        .map((block, idx) => ({ block, idx }))
        .filter(({ block }) => block && block.type === 'image' && typeof block.url === 'string' && block.url.trim());

      const target = imageBlocks[imageIndex];
      if (!target) throw new Error('Image not found.');

      await deleteProgramQuestionAsset(String(target.block.url));
      promptBlocks.splice(target.idx, 1);
      (question as any).promptBlocks = promptBlocks;
      next[questionIndex] = question;

      const nextText = JSON.stringify(next, null, 2);
      setBuilderAtNode(nodeId, (n) => ({
        ...n,
        questionTypes: n.questionTypes.map((x) => x.id === questionTypeId ? { ...x, jsonText: nextText } : x),
      }));
    } catch (err) {
      setUploadedImageErr(formatBuilderError(err));
    } finally {
      setUploadingImage(false);
    }
  }

  async function saveBuilderDraft() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) {
      window.alert('Missing program id');
      return;
    }
    setSaving(true);
    try {
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title,
        subject: builder.subject ?? 'mathematics',
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: { ...builder, programId, programTitle: title },
        updatedAt: new Date().toISOString(),
      });
      const gb = (builder.gradeBand ?? '').trim();
      if (gb) payload.grade_band = gb;

      await saveDraftProgramAdmin(programId, payload);
      setEditingDraftId(programId);
      await load();
      window.alert('Draft saved');
    } catch (e) {
      window.alert(formatBuilderError(e));
    } finally {
      setSaving(false);
    }
  }

  async function publishBuilder() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) {
      window.alert('Missing program id');
      return;
    }

    setSaving(true);
    try {
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });
      const payload: Record<string, unknown> = stripUndefinedDeep({
        title,
        subject: builder.subject ?? 'mathematics',
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        questionBanksByChapter: internal.questionBanksByChapter,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        builderSpec: { ...builder, programId, programTitle: title },
        updatedAt: new Date().toISOString(),
      });
      const gb = (builder.gradeBand ?? '').trim();
      if (gb) payload.grade_band = gb;

      await publishProgramAdmin(programId, payload, editingDraftId);
      if (editingDraftId) setEditingDraftId(null);
      await load();
      setView('list');
      setEditingId(programId);
      window.alert('Published');
    } catch (e) {
      window.alert(formatBuilderError(e));
    } finally {
      setSaving(false);
    }
  }

  function previewBuilder() {
    try {
      const { id: programId, title } = computeProgramIdAndTitle();
      const internal = convertBuilderToInternal({ ...builder, programId, programTitle: title });

      const key = `${Date.now()}`;
      setDraftProgram(key, {
        id: programId,
        title,
        subject: builder.subject ?? 'mathematics',
        grade_band: (builder.gradeBand ?? '').trim() || undefined,
        coverEmoji: builder.coverEmoji ?? '📘',
        toc: internal.toc,
        questionBanksByChapter: internal.questionBanksByChapter,
        annotations: internal.annotations,
        programMeta: internal.programMeta,
        rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
      });

      const pid = `ll-draft:${key}`;
      setPreviewProgramId(pid);
      setPreviewReturnView('builder');
      setView('preview');
    } catch (e) {
      window.alert(formatBuilderError(e));
    }
  }

  async function previewSavedDraft(programId: string) {
    setPreviewProgramId(`ll-draftdb:${programId}`);
    setPreviewReturnView('list');
    setView('preview');
  }

  async function removeDraft(programId: string) {
    if (!window.confirm('Delete this draft?')) return;
    await deleteDraftProgramAdmin(programId);
    await load();
    if (editingDraftId === programId) resetDraft();
  }

  function generateFromNested() {
    const nested = parseNestedProgramJson(draftNestedJson);
    const converted = convertNestedProgramToInternal(nested);
    setDraftId(nested.program_id);
    setDraftTitle(nested.book_name);
    setDraftTocJson(JSON.stringify(converted.toc, null, 2));
    const firstChapterId = Object.keys(converted.questionBanksByChapter)[0] ?? null;
    if (firstChapterId) {
      setDraftQuestionBankJson(JSON.stringify(converted.questionBanksByChapter[firstChapterId], null, 2));
    }
    setDraftAnnotationsJson(JSON.stringify(converted.annotations, null, 2));
    setDraftProgramMetaJson(JSON.stringify(converted.programMeta, null, 2));
  }

  async function save() {
    const id = draftId.trim();
    if (!id) return;
    setSaving(true);
    try {
      let toc: unknown = undefined;
      if (draftTocJson.trim()) {
        toc = JSON.parse(draftTocJson);
      }

      let questionBank: unknown = undefined;
      if (draftQuestionBankJson.trim()) {
        questionBank = JSON.parse(draftQuestionBankJson);
      }

      let annotations: unknown = undefined;
      if (draftAnnotationsJson.trim()) {
        annotations = JSON.parse(draftAnnotationsJson);
      }

      let programMeta: unknown = undefined;
      if (draftProgramMetaJson.trim()) {
        programMeta = JSON.parse(draftProgramMetaJson);
      }

      const payload: Record<string, unknown> = {
        title: draftTitle.trim() || id,
        subject: draftSubject.trim() || 'mathematics',
        coverEmoji: draftEmoji.trim() || '📘',
        toc,
        questionBank,
        annotations,
        programMeta,
        updatedAt: new Date().toISOString(),
      };

      const gb = draftGradeBand.trim();
      if (gb) payload.grade_band = gb;

      if (draftNestedJson.trim()) {
        const nested = parseNestedProgramJson(draftNestedJson);
        const converted = convertNestedProgramToInternal(nested);
        payload.questionBanksByChapter = converted.questionBanksByChapter;

        let total = 0;
        for (const ch of Object.values(converted.questionBanksByChapter)) {
          const nodes = Array.isArray((ch as any)?.nodes) ? ((ch as any).nodes as any[]) : [];
          for (const n of nodes) {
            const qs = Array.isArray(n?.questions) ? (n.questions as any[]) : [];
            total += qs.length;
          }
        }
        payload.rankedTotalQuestionCount = total;
      }

      await savePublishedProgramAdmin(id, payload);

      await load();
      resetDraft();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('are you sure you want to delete this?')) return;
    await softDeletePublishedProgramAdmin(id);
    await load();
    if (editingId === id) resetDraft();
  }

  function previewProgram(programId: string) {
    setPreviewProgramId(programId);
    setPreviewReturnView('list');
    setView('preview');
  }

  if (loading) return <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>Loading programs...</div>;

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {view === 'preview' ? (
        <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderBottom: '1px solid #1f2a44', background: '#1e293b' }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>👁️ Preview</div>
            <button
              className="ll-btn"
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={() => {
                if (previewProgramId && previewProgramId.startsWith('ll-draft:')) {
                  const key = previewProgramId.slice('ll-draft:'.length);
                  clearDraftProgram(key);
                }
                setView(previewReturnView);
              }}
            >
              ← {previewReturnView === 'builder' ? 'Back to Builder' : 'Back'}
            </button>
          </div>
          <div style={{ height: 'calc(100vh - 260px)', minHeight: 560 }}>
            {previewProgramId ? (
              <ProgramMapView onBack={() => setView(previewReturnView)} programId={previewProgramId} />
            ) : (
              <div style={{ padding: 18, color: '#64748b' }}>No preview loaded.</div>
            )}
          </div>
        </div>
      ) : view === 'builder' ? (
        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>🧱 Program Builder</div>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setView('list')}>← Back</button>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={previewBuilder}>
              Preview
            </button>
            <button
              className="ll-btn"
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={saveBuilderDraft}
              disabled={saving}
              title="Save draft (not published)"
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              className="ll-btn ll-btn-primary"
              style={{ padding: '7px 12px', fontSize: 12, background: '#10b981', borderColor: '#059669', color: 'white' }}
              onClick={publishBuilder}
              disabled={saving}
            >
              {saving ? 'Publishing...' : 'Publish'}
            </button>
          </div>

          {/* ── AI DIGITALIZE SECTION ── */}
          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>📄 Upload PDFs to Digitalize</label>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Upload worksheet PDF(s), or paste worksheet text below, then click Digitalize to auto-populate the builder.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <input
                type="file"
                accept=".pdf,.txt"
                multiple
                onChange={(e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  if (chosen.length > 0) {
                    setDigitalizeFiles((prev) => [...prev, ...chosen]);
                  }
                }}
                style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: 12 }}
              />
              <button
                onClick={() => void handleDigitalize()}
                className="ll-btn ll-btn-primary"
                disabled={digitalizeBusy || (digitalizeFiles.length === 0 && digitalizePastedText.trim().length === 0)}
                style={{ padding: '7px 14px', fontSize: 12, background: '#8b5cf6', borderColor: '#7c3aed', color: 'white' }}
              >
                {digitalizeBusy ? 'Digitalizing...' : `Digitalize (${digitalizeFiles.length > 0 ? `${digitalizeFiles.length} file${digitalizeFiles.length !== 1 ? 's' : ''}` : digitalizePastedText.trim().length > 0 ? 'pasted text' : '0 sources'})`}
              </button>
            </div>
            <textarea
              value={digitalizePastedText}
              onChange={(e) => setDigitalizePastedText(e.target.value)}
              placeholder="Or paste worksheet content here to bypass OCR entirely. Example: 1. Find the equation of the line..."
              style={{
                width: '100%',
                minHeight: 160,
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0b1220',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 8,
                fontFamily: 'inherit',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Tip: if OCR fails, paste the sheet text here and Digitalize will send it through the AI structuring pipeline as plain text.
            </div>
            {digitalizeFiles.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {digitalizeFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
                    <span style={{ color: '#c4b5fd', fontSize: 11 }}>{f.name}</span>
                    <button
                      onClick={() => setDigitalizeFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 12, padding: '0 2px', lineHeight: 1 }}
                      title="Remove file"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {digitalizeStatus && <div style={{ color: '#93c5fd', fontSize: 11 }}>{digitalizeStatus}</div>}
            {digitalizeError && <div style={{ color: '#fca5a5', fontSize: 11 }}>{digitalizeError}</div>}
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>Division Path (ends with Question Types)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {builder.divisions.map((d, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    value={d}
                    onChange={(e) => {
                      const v = e.target.value as BuilderDivisionLabel;
                      setBuilder((p) => {
                        const next = [...p.divisions];
                        next[idx] = v;
                        return ensureFixedFirstDivisionContainer({ ...p, divisions: next });
                      });
                    }}
                    style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #334155', background: '#0b1220', color: 'white', outline: 'none', fontSize: 12, fontWeight: 900 }}
                  >
                    {BUILDER_DIVISION_LABELS.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                  <button
                    className="ll-btn"
                    style={{ padding: '6px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                    onClick={() => {
                      setBuilder((p) => ensureFixedFirstDivisionContainer({ ...p, divisions: p.divisions.filter((_, i) => i !== idx) }));
                      setBuilderPathIds(['root']);
                      setBuilderSelectedQuestionTypeId(null);
                    }}
                    disabled={builder.divisions.length <= 1}
                    title={builder.divisions.length <= 1 ? 'At least one division is required' : 'Remove division'}
                  >
                    −
                  </button>
                  <div style={{ color: '#64748b', fontSize: 12 }}>→</div>
                </div>
              ))}
              <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 900 }}>Question Types</div>
              <button
                className="ll-btn"
                style={{ padding: '6px 10px', fontSize: 11 }}
                onClick={() => {
                  setBuilder((p) => (p.divisions.length >= 5 ? p : ensureFixedFirstDivisionContainer({ ...p, divisions: [...p.divisions, 'Lessons'] })));
                }}
                disabled={builder.divisions.length >= 5}
                title={builder.divisions.length >= 5 ? 'Max depth is 5' : 'Add a division'}
              >
                +
              </button>
            </div>
          </div>

          {(() => {
            const normalized = ensureFixedFirstDivisionContainer(builder);
            const fixedContainer = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
            const path = pathNodes(normalized, builderPathIds);
            const cur = findNodeByPath(normalized, builderPathIds) ?? normalized.root;
            const depth = builderPathIds.length - 1;
            const isLeaf = depth === normalized.divisions.length;

            function selectAtDivision(divisionIndex: number, nodeId: string) {
              const next = ['root', ...builderPathIds.slice(1, divisionIndex + 1), nodeId];
              setBuilderPathIds(next);
              setBuilderSelectedQuestionTypeId(null);
            }

            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', color: '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>
                    Program Folder
                  </div>
                  <div style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid #334155', background: '#0b1220', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16 }}>
                        {(builder.coverEmoji ?? '📘').slice(0, 2)}
                      </div>
                      <input
                        value={builder.root.title}
                        onChange={(e) => {
                          const v = e.target.value;
                          setBuilder((p) => ({ ...p, programTitle: v, root: { ...p.root, title: v } }));
                        }}
                        style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#0b1220', color: 'white', outline: 'none', fontWeight: 900 }}
                      />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {normalized.divisions.map((divisionLabel, divisionIndex) => {
                        const containerNode = divisionIndex === 0
                          ? fixedContainer
                          : findNodeByPath(normalized, ['root', ...builderPathIds.slice(1, divisionIndex + 1)]);

                        if (!containerNode) return null;

                        const selectedId = builderPathIds[divisionIndex + 1] ?? null;
                        const canAdd = divisionIndex < normalized.divisions.length;
                        const children = containerNode.children;

                        return (
                          <div key={divisionLabel + ':' + divisionIndex} style={{ border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
                            <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 900, flex: 1 }}>{divisionLabel}</div>
                              {canAdd && (
                                <button
                                  className="ll-btn"
                                  style={{ padding: '5px 9px', fontSize: 11 }}
                                  onClick={() => {
                                    const title = window.prompt(`New ${divisionLabel} name`);
                                    if (!title) return;
                                    const id = makeStableId('node');
                                    setBuilderAtNode(containerNode.id, (n) => ({
                                      ...n,
                                      children: [...n.children, { id, title, children: [], questionTypes: [] }],
                                    }));
                                    selectAtDivision(divisionIndex, id);
                                  }}
                                >
                                  + Folder
                                </button>
                              )}
                            </div>
                            <div style={{ padding: 10 }}>
                              {children.length === 0 ? (
                                <div style={{ color: '#64748b', fontSize: 12 }}>No folders.</div>
                              ) : (
                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                  {children.map((child) => {
                                    const active = selectedId === child.id;
                                    return (
                                      <div
                                        key={child.id}
                                        style={{
                                          padding: '10px 10px',
                                          borderRadius: 12,
                                          border: `${active ? 2 : 1}px solid ${active ? 'rgba(59,130,246,0.85)' : '#334155'}`,
                                          background: active ? 'rgba(59,130,246,0.22)' : '#0b1220',
                                          boxShadow: active ? '0 0 0 3px rgba(59,130,246,0.18)' : undefined,
                                          minWidth: 180,
                                          cursor: 'pointer',
                                        }}
                                        onClick={() => selectAtDivision(divisionIndex, child.id)}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                          <div style={{ color: 'white', fontWeight: 900, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.title}</div>
                                          {active && (
                                            <div style={{ color: '#93c5fd', fontSize: 11, fontWeight: 900 }}>Selected</div>
                                          )}
                                          <button
                                            className="ll-btn"
                                            style={{ padding: '4px 8px', fontSize: 11 }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const nextTitle = window.prompt('Rename folder', child.title);
                                              if (!nextTitle) return;
                                              setBuilderAtNode(child.id, (n) => ({ ...n, title: nextTitle }));
                                            }}
                                          >
                                            Rename
                                          </button>
                                          <button
                                            className="ll-btn"
                                            style={{ padding: '4px 8px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (!window.confirm('Delete this folder?')) return;
                                              setBuilderAtNode(containerNode.id, (n) => ({ ...n, children: n.children.filter((c) => c.id !== child.id) }));
                                              if (builderPathIds.includes(child.id)) {
                                                setBuilderPathIds(['root', ...builderPathIds.slice(1, divisionIndex + 1)]);
                                                setBuilderSelectedQuestionTypeId(null);
                                              }
                                            }}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      <div style={{ border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 900, flex: 1 }}>Question Types</div>
                          {isLeaf && (
                            <button
                              className="ll-btn"
                              style={{ padding: '5px 9px', fontSize: 11 }}
                              onClick={() => {
                                const title = window.prompt('Question Type name (free-form)');
                                if (!title) return;
                                const id = makeStableId('qt');
                                const qt: BuilderQuestionTypeFile = { id, title, jsonText: '[]' };
                                setBuilderAtNode(cur.id, (n) => ({ ...n, questionTypes: [...n.questionTypes, qt] }));
                                setBuilderSelectedQuestionTypeId(id);
                              }}
                            >
                              + Add
                            </button>
                          )}
                        </div>
                        <div style={{ padding: 10 }}>
                          {!isLeaf ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>
                              Open folders until the last division to manage Question Types.
                              <div style={{ marginTop: 6, color: '#cbd5e1' }}>{path.map((x: BuilderNode) => x.title).join(' / ')}</div>
                            </div>
                          ) : cur.questionTypes.length === 0 ? (
                            <div style={{ color: '#64748b', fontSize: 12 }}>No question types yet.</div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {cur.questionTypes.map((qt) => {
                                const active = builderSelectedQuestionTypeId === qt.id;
                                return (
                                  <div
                                    key={qt.id}
                                    style={{
                                      padding: '10px 10px',
                                      borderRadius: 12,
                                      border: `1px solid ${active ? 'rgba(168,85,247,0.65)' : '#334155'}`,
                                      background: active ? 'rgba(168,85,247,0.12)' : '#0b1220',
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => setBuilderSelectedQuestionTypeId(qt.id)}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <div style={{ color: 'white', fontWeight: 900, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qt.title}</div>
                                      {active && <div style={{ color: '#d8b4fe', fontSize: 11, fontWeight: 900 }}>Selected</div>}
                                    </div>
                                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <button
                                        className="ll-btn"
                                        style={{ padding: '5px 10px', fontSize: 11 }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const nextTitle = window.prompt('Rename question type', qt.title);
                                          if (!nextTitle) return;
                                          setBuilderAtNode(cur.id, (n) => ({
                                            ...n,
                                            questionTypes: n.questionTypes.map((x) => x.id === qt.id ? { ...x, title: nextTitle } : x),
                                          }));
                                        }}
                                      >
                                        Rename
                                      </button>
                                      <button
                                        className="ll-btn"
                                        style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!window.confirm('Delete this question type file?')) return;
                                          setBuilderAtNode(cur.id, (n) => ({
                                            ...n,
                                            questionTypes: n.questionTypes.filter((x) => x.id !== qt.id),
                                          }));
                                          if (builderSelectedQuestionTypeId === qt.id) setBuilderSelectedQuestionTypeId(null);
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {isLeaf && (
                  <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', color: '#94a3b8', fontSize: 12, fontWeight: 'bold' }}>
                      Question Type JSON
                    </div>
                    <div style={{ padding: 12 }}>
                      {(() => {
                        const qt = cur.questionTypes.find((x) => x.id === builderSelectedQuestionTypeId) ?? null;
                        if (!qt) {
                          return <div style={{ color: '#64748b', fontSize: 12 }}>Select a question type above to edit its JSON.</div>;
                        }
                        return (
                          <div>
                            <div style={{ color: 'white', fontWeight: 900, fontSize: 13, marginBottom: 8 }}>{qt.title} JSON</div>
                            <textarea
                              value={qt.jsonText}
                              onChange={(e) => {
                                const v = e.target.value;
                                setBuilderAtNode(cur.id, (n) => ({
                                  ...n,
                                  questionTypes: n.questionTypes.map((x) => x.id === qt.id ? { ...x, jsonText: v } : x),
                                }));
                              }}
                              rows={16}
                              style={{ width: '100%', padding: '10px 10px', borderRadius: 12, border: '1px solid #334155', background: '#0b1220', color: 'white', fontFamily: 'monospace', fontSize: 12, outline: 'none', resize: 'vertical' }}
                            />

                            <div style={{ height: 1, background: '#1f2a44', margin: '14px 0' }} />

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                              <div style={{ color: '#cbd5e1', fontWeight: 900, fontSize: 12 }}>Upload image (Supabase Storage)</div>
                              <div style={{ color: '#64748b', fontSize: 11 }}>
                                Public read
                              </div>
                            </div>

                            {uploadedImageErr && (
                              <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8 }}>{uploadedImageErr}</div>
                            )}

                            {(() => {
                              let parsed: any[] | null = null;
                              try {
                                const raw = qt.jsonText.trim() ? JSON.parse(qt.jsonText) : [];
                                parsed = Array.isArray(raw) ? raw : null;
                              } catch {
                                parsed = null;
                              }

                              if (!parsed) {
                                return (
                                  <div style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>
                                    Fix the Question Type JSON so it is a valid JSON array before managing question images.
                                  </div>
                                );
                              }

                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                                  {parsed.length === 0 ? (
                                    <div style={{ color: '#64748b', fontSize: 12 }}>Add at least one question in the JSON array to attach images to a specific question.</div>
                                  ) : (
                                    parsed.slice(0, 50).map((q: any, idx: number) => {
                                      const qid = typeof q?.id === 'string' ? q.id : `q_${idx + 1}`;
                                      const label = getQuestionPromptLabel(q);
                                      const imageBlocks = Array.isArray(q?.promptBlocks)
                                        ? q.promptBlocks.filter((block: any) => block && block.type === 'image' && typeof block.url === 'string' && block.url.trim())
                                        : [];

                                      return (
                                        <div key={`${qid}_${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', border: '1px solid #1f2a44', borderRadius: 12, background: 'rgba(2,6,23,0.25)' }}>
                                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                              <div style={{ color: 'white', fontWeight: 900, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qid}</div>
                                              <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'normal', wordBreak: 'break-word', marginTop: 4 }}>{label}</div>
                                            </div>
                                            <input
                                              type="file"
                                              accept="image/png,image/jpeg,image/webp,image/gif"
                                              disabled={uploadingImage}
                                              onChange={async (e) => {
                                                const f = e.target.files?.[0] ?? null;
                                                if (!f) return;
                                                try {
                                                  await handleQuestionImageUpload(cur.id, qt.id, qt.jsonText, idx, qid, f);
                                                } catch {}
                                                finally {
                                                  e.target.value = '';
                                                }
                                              }}
                                              style={{
                                                width: 220,
                                                padding: '8px 10px',
                                                borderRadius: 12,
                                                border: '1px solid #334155',
                                                background: '#0b1220',
                                                color: 'white',
                                                outline: 'none',
                                                fontSize: 12,
                                              }}
                                            />
                                          </div>

                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                            {imageBlocks.length === 0 ? (
                                              <div style={{ color: '#64748b', fontSize: 12 }}>No uploaded images for this question.</div>
                                            ) : (
                                              imageBlocks.map((block: any, imageIdx: number) => (
                                                <div key={`${qid}_img_${imageIdx}`} style={{ border: '1px solid #1f2a44', borderRadius: 12, padding: 10, background: 'rgba(15,23,42,0.45)' }}>
                                                  <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 8 }}>Image {imageIdx + 1}</div>
                                                  <img
                                                    src={String(block.url)}
                                                    alt={typeof block.alt === 'string' && block.alt.trim() ? block.alt : 'diagram'}
                                                    style={{ display: 'block', maxWidth: '100%', maxHeight: 240, borderRadius: 10, marginBottom: 10, objectFit: 'contain', background: '#020617' }}
                                                  />
                                                  <div style={{ color: '#93c5fd', fontSize: 11, wordBreak: 'break-all', marginBottom: 10 }}>{String(block.url)}</div>
                                                  <button
                                                    type="button"
                                                    className="ll-btn"
                                                    disabled={uploadingImage}
                                                    onClick={() => void handleQuestionImageDelete(cur.id, qt.id, qt.jsonText, idx, imageIdx)}
                                                    style={{ padding: '7px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}
                                                  >
                                                    Delete image
                                                  </button>
                                                </div>
                                              ))
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
      <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <h3 style={{ color: 'white', margin: 0, fontSize: 16 }}>📚 Programs ({items.length})</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} className="ll-btn" style={{ padding: '7px 14px', fontSize: 12 }}>↺ Refresh</button>
          <button onClick={startNewBuilder} className="ll-btn ll-btn-primary" style={{ padding: '7px 14px', fontSize: 12, background: '#a855f7', borderColor: '#7c3aed', color: 'white' }}>+ New</button>
        </div>
      </div>

      <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #1f2a44', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>📝 Drafts ({draftItems.length})</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>Only visible to superadmins</div>
        </div>
        <div style={{ padding: 12 }}>
          {draftItems.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 12 }}>No drafts yet. Use “Save Draft” inside the builder.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {draftItems.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.25)' }}>
                  <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{(d.coverEmoji as string) ?? '📝'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(d.title as string) ?? d.id}</div>
                    <div style={{ color: '#64748b', fontSize: 11 }}>{(d.subject as string) ?? 'subject'}{d.grade_band ? ` • ${d.grade_band}` : ''}</div>
                  </div>
                  <button onClick={() => previewSavedDraft(d.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
                  <button onClick={() => startEditDraftBuilder(d)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
                  <button onClick={() => removeDraft(d.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: 18, color: '#64748b' }}>No public programs yet.</div>
        ) : (
          items.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid #0f172a' }}>
              <div style={{ width: 26, textAlign: 'center', fontSize: 18 }}>{(p.coverEmoji as string) ?? '📘'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(p.title as string) ?? p.id}
                </div>
                <div style={{ color: '#64748b', fontSize: 11 }}>{(p.subject as string) ?? 'subject'}{p.grade_band ? ` • ${p.grade_band}` : ''}</div>
              </div>
              <button onClick={() => previewProgram(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Preview</button>
              <button onClick={() => startEditBuilder(p)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11 }}>Edit</button>
              <button onClick={() => remove(p.id)} className="ll-btn" style={{ padding: '5px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.55)', color: '#fca5a5' }}>Delete</button>
            </div>
          ))
        )}
      </div>
      </>
      )}
    </div>
  );
}
