import { useState, useEffect, useRef } from 'react';
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
  type ProgramExplanationScene,
  type ProgramStepSpec,
} from '@/lib/programQuestionBank';
import {
  deleteLogicGameNode,
  getLogicGameQuestions,
  listLogicGameNodes,
  upsertLogicGameNode,
  upsertLogicGameQuestions,
} from '@/lib/logicGamesService';
import ProgramMapView from '@/views/ProgramMapView';
import { clearDraftProgram, setDraftProgram } from '@/lib/draftProgramStore';
import { deleteProgramQuestionAsset, uploadProgramQuestionAsset } from '@/lib/programAssetService';
import type { LogicGameNode, LogicGameQuestionsDoc, LogicGameQuestion } from '@/types/logicGames';
import { runPhase1Ocr } from '@/lib/localOcrPipeline';
import {
  createProgramIngestionJob,
  runProgramIngestionStage,
  uploadProgramIngestionSource,
  getProgramIngestionJob,
} from '@/lib/programIngestionService';
import {
  deleteDraftProgramAdmin,
  getDraftProgramAdmin,
  getPublishedProgramAdmin,
  listProgramsAdmin,
  publishProgramAdmin,
  saveDraftProgramAdmin,
  savePublishedProgramAdmin,
  softDeletePublishedProgramAdmin,
} from '@/lib/programAdminService';
import { parseAIProgramImport } from '@/lib/aiProgramImport';
import { convertNotebookExerciseToBuilderQuestions, validateNotebookExerciseImport, type NotebookValidationResult } from '@/lib/notebookProgramImport';
import TestingWhiteboard from '@/components/TestingWhiteboard';


type Tab = 'overview' | 'users' | 'programs' | 'logicGames' | 'testing';

const ROLE_ORDER: UserRole[] = ['student', 'superadmin', 'admin', 'teacher', 'teacher_assistant', 'parent'];
const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student', superadmin: 'Super Admin', admin: 'Admin',
  teacher: 'Teacher', teacher_assistant: 'TA', parent: 'Parent',
};
const ROLE_COLORS: Record<UserRole, string> = {
  student: '#3b82f6', superadmin: '#a855f7', admin: '#f59e0b',
  teacher: '#10b981', teacher_assistant: '#06b6d4', parent: '#ec4899',
};

/* TestingWhiteboard is imported from @/components/TestingWhiteboard */

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

function getNormalizedExplanationScenes(value: unknown): ProgramExplanationScene[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((scene, idx) => {
      const item = asRecord(scene);
      if (!item) return null;
      return {
        id: typeof item.id === 'string' ? item.id : `scene_${idx + 1}`,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : `Step ${idx + 1}`,
        narration: typeof item.narration === 'string' ? item.narration : null,
        beforeText: typeof item.beforeText === 'string' ? item.beforeText : null,
        afterText: typeof item.afterText === 'string' ? item.afterText : null,
        emphasis: Array.isArray(item.emphasis) ? item.emphasis.map((entry) => String(entry)).filter(Boolean) : undefined,
        action: item.action === 'highlight' || item.action === 'transform' || item.action === 'note' || item.action === 'reveal'
          ? item.action
          : undefined,
      } satisfies ProgramExplanationScene;
    })
    .filter(Boolean) as ProgramExplanationScene[];
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
    { id: 'logicGames', icon: '🧠', label: 'IQ Games' },
    { id: 'testing', icon: '🧪', label: 'Testing' },
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
        <div style={{ display: tab === 'programs' ? 'block' : 'none' }}>
          <ProgramsAdmin />
        </div>

        {/* ── LOGIC GAMES ── */}
        {tab === 'logicGames' && (
          <LogicGamesAdmin />
        )}

        {/* ── TESTING (MyScript) ── */}
        {tab === 'testing' && (
          <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 420 }}>
                        <TestingWhiteboard />
          </div>
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

  const [nodes, setNodes] = useState<LogicGameNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [questions, setQuestions] = useState<LogicGameQuestion[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);

  // Add Question Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  
  // Details popup state
  const [detailsQIndex, setDetailsQIndex] = useState<number | null>(null);
  const [detailsGroqLoading, setDetailsGroqLoading] = useState(false);

  // PDF Upload Flow
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [extractedQuestions, setExtractedQuestions] = useState<LogicGameQuestion[] | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const pub = await listLogicGameNodes();
      
      // Auto-create level 1 if empty
      if (pub.length === 0) {
         const id = `iq-80`;
         const initialNode: LogicGameNode = { id, iq: 80, order: 0, label: `Level 1` };
         await upsertLogicGameNode(initialNode);
         setNodes([initialNode]);
      } else {
         setNodes(pub);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadQuestions() {
    if (!selectedNodeId) {
      setQuestions([]);
      return;
    }
    setQuestionsLoading(true);
    try {
      const doc = await getLogicGameQuestions(selectedNodeId);
      setQuestions(doc ? doc.questions : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setQuestionsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadQuestions();
  }, [selectedNodeId]);

  
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editNodeLabel, setEditNodeLabel] = useState("");
  const [editNodeIq, setEditNodeIq] = useState("");

  async function saveNodeEdits(nodeId: string) {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return;
    
    const label = editNodeLabel.trim();
    const iq = Number(editNodeIq.trim());
    if (!label || !Number.isFinite(iq)) {
       setEditingNodeId(null);
       return;
    }

    setSaving(true);
    try {
      await upsertLogicGameNode({ ...n, label, iq });
      setNodes((prev) =>
        prev
          .map((x) => (x.id === nodeId ? { ...x, label, iq } : x))
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
      setStatus('✅ Level updated');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setEditingNodeId(null);
    }
  }

  const handlePasteImage = async (e: React.ClipboardEvent, onBase64: (b64: string) => void) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.indexOf("image") !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result) onBase64(ev.target.result as string);
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  };


  async function addNode() {
    setSaving(true);
    setErr(null);
    setStatus(null);
    try {
      const nextOrder = nodes.length > 0 ? Math.max(...nodes.map((n) => n.order ?? 0)) + 1 : 0;
      const nextIq = nodes.length > 0 ? (nodes[nodes.length - 1].iq ?? 80) + 10 : 80;
      const id = `iq-${nextIq}`;
      const node: LogicGameNode = { id, iq: nextIq, order: nextOrder, label: `Level ${nodes.length + 1}` };
      await upsertLogicGameNode(node);

      setNodes((prev) => {
        const next = prev.some((n) => n.id === node.id) ? prev : [...prev, node];
        return next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      });
      setStatus('✅ Level added');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  

  

  async function deleteNode(nodeId: string) {
    if (!window.confirm('Delete this level and all its questions? This cannot be undone.')) return;
    setSaving(true);
    try {
      await deleteLogicGameNode(nodeId);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      await load();
      setStatus('✅ Level deleted');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveQuestionsList(newQuestions: LogicGameQuestion[]) {
    if (!selectedNodeId) return;
    setSaving(true);
    try {
      await upsertLogicGameQuestions(selectedNodeId, {
        questions: newQuestions,
        updatedAt: new Date().toISOString()
      });
      setQuestions(newQuestions);
      setStatus('✅ Auto-saved');
    } catch(e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleExtractFromPdf() {
    if (!pdfFile) return;
    setPdfExtracting(true);
    setPdfError(null);
    try {
      setPdfError('Uploading PDF for extraction...');

      const apiUrl = import.meta.env.VITE_API_SERVER_URL || '';
      const formData = new FormData();
      formData.append('file', pdfFile);

      const aiRes = await fetch(`${apiUrl}/api/program-ingestion/extract-iq-pdf`, {
        method: 'POST',
        body: formData,
      });

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        throw new Error(`AI Extraction failed: ${errText}`);
      }

      const data = await aiRes.json();
      if (!data.questions || data.questions.length === 0) {
        throw new Error("No questions could be found in this PDF.");
      }

      const formatted = data.questions.map((q: any, i: number) => {
        const blocks: any[] = [];
        if (q.promptRawText) blocks.push({ type: 'text', text: q.promptRawText });
        if (q.imageUrl) blocks.push({ type: 'image', url: q.imageUrl });

        return {
          id: `q_${Date.now()}_${i}`,
          promptBlocks: blocks,
          promptRawText: q.promptRawText,
          interaction: {
            type: 'mcq',
            choices: q.interaction?.choices || [],
            // Default to no answer selected if -1 or missing
            correctChoiceIndex: typeof q.interaction?.correctChoiceIndex === 'number' && q.interaction.correctChoiceIndex >= 0 
                ? q.interaction.correctChoiceIndex 
                : -1
          },
          timeLimitSec: 60,
          iqDeltaCorrect: 5,
          iqDeltaWrong: -3
        };
      });

      setExtractedQuestions(formatted);
      setPdfError(null);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfExtracting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'center', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px' }}>
        {!selectedNodeId ? (
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }}>
            <h1 style={{ textAlign: 'center', color: 'white', margin: '0 0 20px 0', fontSize: 32, fontWeight: 900 }}>IQ levels</h1>
            {nodes.map((n) => (
              <div key={n.id} 
                   onClick={() => { if (editingNodeId !== n.id) setSelectedNodeId(n.id); }}
                   style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', cursor: editingNodeId === n.id ? 'default' : 'pointer', transition: 'all 0.2s' }}
                   onMouseEnter={(e) => { if (editingNodeId !== n.id) e.currentTarget.style.borderColor = '#a855f7'; }}
                   onMouseLeave={(e) => { if (editingNodeId !== n.id) e.currentTarget.style.borderColor = '#334155'; }}
              >
                {editingNodeId === n.id ? (
                  <div style={{ display: 'flex', gap: 16, flex: 1, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                       <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 'bold' }}>Level Name</label>
                       <input value={editNodeLabel} onChange={e => setEditNodeLabel(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 120 }}>
                       <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 'bold' }}>IQ Threshold</label>
                       <input type="number" value={editNodeIq} onChange={e => setEditNodeIq(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                       <button onClick={() => saveNodeEdits(n.id)} className="ll-btn ll-btn-primary" style={{ padding: '8px 16px', fontWeight: 'bold' }}>Save</button>
                       <button onClick={() => setEditingNodeId(null)} className="ll-btn" style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.1)' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                       <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>{n.label}</div>
                       <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
                         IQ Threshold: <span style={{ color: '#d8b4fe', fontWeight: 'bold' }}>{n.iq}</span>
                       </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="ll-btn" title="Edit Level" onClick={(e) => { e.stopPropagation(); setEditNodeLabel(n.label || ''); setEditNodeIq(n.iq?.toString() || '80'); setEditingNodeId(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.05)', color: 'white' }}>✎ Edit</button>
                      <button className="ll-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}>🗑 Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
            
            <button onClick={addNode} disabled={saving} className="ll-btn ll-btn-primary" style={{ padding: '16px', fontSize: 15, fontWeight: 'bold', alignSelf: 'center', marginTop: 10, borderRadius: 12 }}>
                + Add New Level
            </button>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', margin: '0 auto', paddingBottom: 40 }}>
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 24, padding: '10px 0' }}>
              <button onClick={() => setSelectedNodeId(null)} className="ll-btn" style={{ position: 'absolute', left: 0, padding: '8px 14px', fontSize: 14, background: 'rgba(255,255,255,0.1)' }}>
                ← Back to Levels
              </button>
              
              <div style={{ textAlign: 'center' }}>
                <h1 style={{ color: 'white', fontWeight: 900, fontSize: 28, margin: 0 }}>
                  {nodes.find(n => n.id === selectedNodeId)?.label}
                </h1>
                <div style={{ color: '#a855f7', fontSize: 14, fontWeight: 'bold', marginTop: 4 }}>{questions.length} questions</div>
              </div>

              <button onClick={() => setAddModalOpen(true)} className="ll-btn ll-btn-primary" style={{ position: 'absolute', right: 0, padding: '10px 20px', fontSize: 14, fontWeight: 'bold' }}>
                + Add Questions
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {questionsLoading ? (
                <div style={{ color: '#94a3b8', textAlign: 'center' }}>Loading questions...</div>
              ) : questions.length === 0 ? (
                <div style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>No questions in this level yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  {questions.map((q, qIndex) => (
                    <div key={q.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ color: '#94a3b8', fontWeight: 'bold', fontSize: 14 }}>Question {qIndex + 1}</div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button 
                            onClick={() => setDetailsQIndex(qIndex)}
                            className="ll-btn" style={{ padding: '6px 10px', fontSize: 13, color: '#a78bfa', background: 'rgba(167,139,250,0.1)' }}
                          >
                            📊 Details
                          </button>
                          <button 
                            onClick={() => {
                              if(window.confirm('Delete question?')) {
                                saveQuestionsList(questions.filter(x => x.id !== q.id));
                              }
                            }}
                            className="ll-btn" style={{ padding: '6px 10px', fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}
                          >
                            🗑 Delete
                          </button>
                        </div>
                      </div>
                      
                      <textarea
                        value={q.promptRawText || (q.promptBlocks?.[0] as any)?.text || ''}
                        onChange={(e) => {
                          const newQ = [...questions];
                          const newText = e.target.value;
                          const existingImages = (q.promptBlocks || []).filter(b => b.type === 'image');
                          newQ[qIndex] = { ...q, promptRawText: newText, promptBlocks: [{ type: 'text', text: newText }, ...existingImages] as any };
                          setQuestions(newQ);
                        }}
                        onBlur={() => saveQuestionsList(questions)}
                        onPaste={(e) => handlePasteImage(e, (b64) => {
                          const newQ = [...questions];
                          const blocks = newQ[qIndex].promptBlocks || [{ type: 'text', text: newQ[qIndex].promptRawText || '' }];
                          blocks.push({ type: 'image', url: b64 } as any);
                          newQ[qIndex] = { ...q, promptBlocks: blocks as any };
                          setQuestions(newQ);
                          saveQuestionsList(newQ);
                        })}
                        placeholder="Question Prompt... (Paste image to attach)"
                        style={{ width: '100%', minHeight: 80, padding: 14, borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', marginBottom: 16, outline: 'none', fontSize: 15 }}
                      />

                      {/* Display images */}
                      {q.promptBlocks?.filter(b => b.type === 'image').length > 0 && (
                         <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                           {q.promptBlocks.filter(b => b.type === 'image').map((imgBlock: any, imgIdx: number) => (
                              <div key={imgIdx} style={{ position: 'relative' }}>
                                <img src={imgBlock.url} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: '1px solid #475569' }} />
                                <button 
                                  onClick={() => {
                                    const newQ = [...questions];
                                    const blocks = (newQ[qIndex].promptBlocks || []).filter(b => b !== imgBlock);
                                    newQ[qIndex] = { ...q, promptBlocks: blocks as any };
                                    setQuestions(newQ);
                                    saveQuestionsList(newQ);
                                  }}
                                  style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                                >✕</button>
                              </div>
                           ))}
                         </div>
                      )}
                      
                      {q.interaction.type === 'mcq' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {q.interaction.choices.map((choice, cIndex) => {
                            const isImage = choice.startsWith('data:image/') || choice.startsWith('http');
                            return (
                              <div key={cIndex} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <button
                                  onClick={() => {
                                    const newQ = [...questions];
                                    if (newQ[qIndex].interaction.type === 'mcq') {
                                      (newQ[qIndex].interaction as any).correctChoiceIndex = cIndex;
                                      saveQuestionsList(newQ);
                                    }
                                  }}
                                  title="Click to mark as correct answer"
                                  style={{
                                    width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0,
                                    background: q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex === cIndex ? '#22c55e' : '#334155',
                                    color: 'white', fontWeight: 'bold', cursor: 'pointer', fontSize: 14,
                                    transition: 'background 0.2s'
                                  }}
                                >
                                  {String.fromCharCode(65 + cIndex)}
                                </button>
                                
                                {isImage ? (
                                  <div style={{ position: 'relative', flex: 1, padding: 8, borderRadius: 8, background: '#0f172a', border: '1px solid #475569' }}>
                                    <img src={choice} style={{ maxWidth: 200, maxHeight: 100, borderRadius: 4 }} />
                                    <button 
                                      onClick={() => {
                                         const newQ = [...questions];
                                         if (newQ[qIndex].interaction.type === 'mcq') {
                                           (newQ[qIndex].interaction as any).choices[cIndex] = '';
                                           setQuestions(newQ);
                                           saveQuestionsList(newQ);
                                         }
                                      }}
                                      style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                                    >✕</button>
                                  </div>
                                ) : (
                                  <input
                                    value={choice}
                                    onChange={(e) => {
                                       const newQ = [...questions];
                                       if (newQ[qIndex].interaction.type === 'mcq') {
                                         (newQ[qIndex].interaction as any).choices[cIndex] = e.target.value;
                                         setQuestions(newQ);
                                       }
                                    }}
                                    onBlur={() => saveQuestionsList(questions)}
                                    onPaste={(e) => handlePasteImage(e, (b64) => {
                                       const newQ = [...questions];
                                       if (newQ[qIndex].interaction.type === 'mcq') {
                                         (newQ[qIndex].interaction as any).choices[cIndex] = b64;
                                         setQuestions(newQ);
                                         saveQuestionsList(newQ);
                                       }
                                    })}
                                    placeholder={`Option ${String.fromCharCode(65 + cIndex)} (Paste image here)`}
                                    style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 14 }}
                                  />
                                )}
                                <button 
                                  onClick={() => {
                                     const newQ = [...questions];
                                     if (newQ[qIndex].interaction.type === 'mcq') {
                                        const arr = (newQ[qIndex].interaction as any).choices;
                                        if (arr.length > 2) {
                                          arr.splice(cIndex, 1);
                                          if ((newQ[qIndex].interaction as any).correctChoiceIndex === cIndex) {
                                             (newQ[qIndex].interaction as any).correctChoiceIndex = -1;
                                          } else if ((newQ[qIndex].interaction as any).correctChoiceIndex > cIndex) {
                                             (newQ[qIndex].interaction as any).correctChoiceIndex--;
                                          }
                                          saveQuestionsList(newQ);
                                        }
                                     }
                                  }}
                                  style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}
                                  title="Remove Option"
                                >×</button>
                              </div>
                            );
                          })}
                          <button 
                             onClick={() => {
                                const newQ = [...questions];
                                if (newQ[qIndex].interaction.type === 'mcq') {
                                   (newQ[qIndex].interaction as any).choices.push('');
                                   setQuestions(newQ);
                                }
                             }}
                             style={{ background: 'transparent', border: '1px dashed #475569', color: '#94a3b8', padding: '8px', borderRadius: 8, cursor: 'pointer', marginTop: 4, width: 'fit-content' }}
                          >
                            + Add Option
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Question Details Popup */}
      {detailsQIndex !== null && detailsQIndex < questions.length && (() => {
        const dq = questions[detailsQIndex];
        const nodeIq = nodes.find(n => n.id === selectedNodeId)?.iq ?? 80;
        const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', width: '100%', fontSize: 13 };
        const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', fontWeight: 'bold', marginBottom: 4 };
        const updateField = (field: string, value: any) => {
          const newQ = [...questions];
          (newQ[detailsQIndex] as any)[field] = value;
          setQuestions(newQ);
        };
        const saveAndClose = () => { saveQuestionsList(questions); setDetailsQIndex(null); };

        const askGroq = async () => {
          setDetailsGroqLoading(true);
          try {
            const apiUrl = import.meta.env.VITE_API_SERVER_URL || '';
            const promptText = dq.promptRawText || (dq.promptBlocks?.[0] as any)?.text || '';
            const choices = dq.interaction.type === 'mcq' ? dq.interaction.choices : [];
            const correctIdx = dq.interaction.type === 'mcq' ? dq.interaction.correctChoiceIndex : -1;
            const res = await fetch(`${apiUrl}/api/program-ingestion/iq-question-details`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ promptText, choices, correctChoiceIndex: correctIdx, nodeIq }),
            });
            if (!res.ok) throw new Error(`Failed: ${await res.text()}`);
            const data = await res.json();
            const newQ = [...questions];
            if (data.questionIq != null) (newQ[detailsQIndex] as any).questionIq = data.questionIq;
            if (data.maxIqGain != null) (newQ[detailsQIndex] as any).maxIqGain = data.maxIqGain;
            if (data.iqGainDecayRate != null) (newQ[detailsQIndex] as any).iqGainDecayRate = data.iqGainDecayRate;
            if (data.iqGainDecayIntervalSec != null) (newQ[detailsQIndex] as any).iqGainDecayIntervalSec = data.iqGainDecayIntervalSec;
            if (data.iqLossBase != null) (newQ[detailsQIndex] as any).iqLossBase = data.iqLossBase;
            if (data.iqLossScaleFactor != null) (newQ[detailsQIndex] as any).iqLossScaleFactor = data.iqLossScaleFactor;
            if (data.explanation) (newQ[detailsQIndex] as any).explanation = data.explanation;
            setQuestions(newQ);
            setStatus('✅ Groq values applied');
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setDetailsGroqLoading(false);
          }
        };

        return (
          <>
            <div onClick={() => saveAndClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1100 }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: '#1e293b', borderRadius: 16, border: '1px solid #475569',
              zIndex: 1101, width: 'min(600px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ color: 'white', margin: 0, fontSize: 16 }}>📊 Question {detailsQIndex + 1} — Details</h2>
                <button onClick={() => saveAndClose()} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24 }}>×</button>
              </div>
              <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Question IQ Level */}
                <div>
                  <div style={labelStyle}>Question IQ Level</div>
                  <input type="number" value={dq.questionIq ?? nodeIq} onChange={e => updateField('questionIq', Number(e.target.value))} style={inputStyle} />
                </div>

                {/* IQ Gain Settings */}
                <div style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#34d399', marginBottom: 10 }}>📈 IQ Gain (Correct Answer)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={labelStyle}>Max IQ Gain</div>
                      <input type="number" step="0.1" value={dq.maxIqGain ?? 2} onChange={e => updateField('maxIqGain', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <div style={labelStyle}>Decay Rate (per interval)</div>
                      <input type="number" step="0.01" value={dq.iqGainDecayRate ?? 0.1} onChange={e => updateField('iqGainDecayRate', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <div style={labelStyle}>Decay Interval (seconds)</div>
                      <input type="number" value={dq.iqGainDecayIntervalSec ?? 10} onChange={e => updateField('iqGainDecayIntervalSec', Number(e.target.value))} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                    Example: Max gain {dq.maxIqGain ?? 2}, decay {dq.iqGainDecayRate ?? 0.1}/interval ({dq.iqGainDecayIntervalSec ?? 10}s).
                    Solve in 0-{dq.iqGainDecayIntervalSec ?? 10}s → +{dq.maxIqGain ?? 2},
                    in {dq.iqGainDecayIntervalSec ?? 10}-{(dq.iqGainDecayIntervalSec ?? 10) * 2}s → +{Math.max(0, (dq.maxIqGain ?? 2) - (dq.iqGainDecayRate ?? 0.1)).toFixed(2)}, etc.
                  </div>
                </div>

                {/* IQ Loss Settings */}
                <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5', marginBottom: 10 }}>📉 IQ Loss (Incorrect Answer)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div style={labelStyle}>Base IQ Loss</div>
                      <input type="number" step="0.1" value={dq.iqLossBase ?? 3} onChange={e => updateField('iqLossBase', Number(e.target.value))} style={inputStyle} />
                    </div>
                    <div>
                      <div style={labelStyle}>Scale Factor (per IQ diff)</div>
                      <input type="number" step="0.01" value={dq.iqLossScaleFactor ?? 0.05} onChange={e => updateField('iqLossScaleFactor', Number(e.target.value))} style={inputStyle} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                    Loss = base × (1 + max(0, studentIQ - questionIQ) × scale).
                    E.g. student IQ 100, question IQ {dq.questionIq ?? nodeIq}: loss = {((dq.iqLossBase ?? 3) * (1 + Math.max(0, 100 - (dq.questionIq ?? nodeIq)) * (dq.iqLossScaleFactor ?? 0.05))).toFixed(2)}
                  </div>
                </div>

                {/* Explanation */}
                <div>
                  <div style={labelStyle}>💡 Explanation (shown in chill mode)</div>
                  <textarea
                    value={dq.explanation || ''}
                    onChange={e => updateField('explanation', e.target.value)}
                    placeholder="Concise explanation of why the correct answer is correct..."
                    style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                  />
                </div>

                {/* Ask Groq Button */}
                <button
                  onClick={() => void askGroq()}
                  disabled={detailsGroqLoading}
                  className="ll-btn"
                  style={{
                    padding: '12px 16px', fontSize: 14, fontWeight: 'bold', width: '100%',
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.2), rgba(59,130,246,0.2))',
                    border: '1px solid rgba(168,85,247,0.4)', color: '#c084fc', borderRadius: 10,
                  }}
                >
                  {detailsGroqLoading ? '🔄 Asking Groq...' : '🤖 Ask Groq to Auto-Fill All Values'}
                </button>

                {/* Save & Close */}
                <button
                  onClick={() => saveAndClose()}
                  className="ll-btn ll-btn-primary"
                  style={{ padding: '12px', fontSize: 14, fontWeight: 'bold', width: '100%', borderRadius: 10 }}
                >
                  Save & Close
                </button>
              </div>
            </div>
          </>
        );
      })()}

      {/* Add Questions Modal */}
      {addModalOpen && (
        <>
          <div onClick={() => !pdfExtracting && setAddModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 16, border: '1px solid #475569',
            zIndex: 1001, width: 'min(800px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: 'white', margin: 0, fontSize: 18 }}>Extract PDF Questions</h2>
              <button onClick={() => !pdfExtracting && setAddModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24 }}>×</button>
            </div>
            
            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center' }}>
                <input 
                  type="file" accept=".pdf" 
                  onChange={e => setPdfFile(e.target.files?.[0] || null)}
                  style={{ flex: 1, padding: 12, background: '#0f172a', borderRadius: 8, border: '1px solid #334155', color: 'white' }}
                />
                <button 
                  onClick={handleExtractFromPdf} 
                  disabled={!pdfFile || pdfExtracting}
                  className="ll-btn ll-btn-primary" 
                  style={{ padding: '14px 24px', fontWeight: 'bold' }}
                >
                  {pdfExtracting ? 'Extracting...' : 'Extract MCQs'}
                </button>
              </div>

              <div style={{ textAlign: 'center', margin: '20px 0' }}>
                 <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>— OR —</div>
                 <button onClick={() => {
                    const newQ: any = {
                       id: `manual_${Date.now()}`,
                       promptRawText: '',
                       promptBlocks: [{ type: 'text', text: '' }],
                       interaction: { type: 'mcq', choices: ['', '', '', ''], correctChoiceIndex: 0 },
                       timeLimitSec: 0, iqDeltaCorrect: 0, iqDeltaWrong: 0
                    };
                    setExtractedQuestions([...(extractedQuestions || []), newQ]);
                 }} className="ll-btn" style={{ background: '#334155', color: 'white', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold' }}>
                    + Add Question Manually
                 </button>
              </div>

              {pdfError && (
                 <div style={{ padding: 16, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', borderRadius: 8, marginBottom: 20, border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                    {pdfError}
                 </div>
              )}

              {extractedQuestions && extractedQuestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <h3 style={{ color: 'white', margin: '10px 0' }}>Review Questions</h3>
                  <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 10 }}>
                     ⚠️ Please review all questions and select the correct answer for each by clicking the letter circle.
                  </div>
                  
                  {extractedQuestions.map((q, qIndex) => (
                     <div key={qIndex} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 16, position: 'relative' }}>
                       <button 
                          onClick={() => {
                            if(window.confirm('Delete question?')) {
                              setExtractedQuestions((extractedQuestions || []).filter((_, i) => i !== qIndex));
                            }
                          }}
                          style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                       >🗑 Delete</button>
                       <textarea
                         value={q.promptRawText || (q.promptBlocks?.[0] as any)?.text || ''}
                         onChange={(e) => {
                            const nq = [...extractedQuestions];
                            const newText = e.target.value;
                            const existingImages = (q.promptBlocks || []).filter((b: any) => b.type === 'image');
                            nq[qIndex].promptRawText = newText;
                            nq[qIndex].promptBlocks = [{ type: 'text', text: newText }, ...existingImages] as any;
                            setExtractedQuestions(nq);
                         }}
                         onPaste={(e) => handlePasteImage(e, (b64) => {
                            const nq = [...extractedQuestions];
                            const blocks = nq[qIndex].promptBlocks || [{ type: 'text', text: nq[qIndex].promptRawText || '' }];
                            blocks.push({ type: 'image', url: b64 } as any);
                            nq[qIndex].promptBlocks = blocks as any;
                            setExtractedQuestions(nq);
                         })}
                         placeholder="Question Prompt... (Paste image to attach)"
                         style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', marginBottom: 12, outline: 'none' }}
                       />

                       <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                         {q.imageUrl && (
                           <div style={{ position: 'relative' }}>
                             <img src={q.imageUrl} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: '1px solid #475569' }} />
                           </div>
                         )}
                         {q.promptBlocks?.filter((b: any) => b.type === 'image').map((imgBlock: any, imgIdx: number) => (
                           <div key={imgIdx} style={{ position: 'relative' }}>
                             <img src={imgBlock.url} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: '1px solid #475569' }} />
                             <button 
                               onClick={() => {
                                 const nq = [...extractedQuestions];
                                 const blocks = (nq[qIndex].promptBlocks || []).filter((b: any) => b !== imgBlock);
                                 nq[qIndex].promptBlocks = blocks as any;
                                 setExtractedQuestions(nq);
                               }}
                               style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                             >✕</button>
                           </div>
                         ))}
                       </div>

                       {q.interaction.type === 'mcq' && (
                         <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                           {q.interaction.choices.map((choice, cIndex) => {
                             const isImage = choice.startsWith('data:image/') || choice.startsWith('http');
                             return (
                               <div key={cIndex} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                 <button
                                   onClick={() => {
                                     const nq = [...extractedQuestions];
                                     if (nq[qIndex].interaction.type === 'mcq') {
                                       (nq[qIndex].interaction as any).correctChoiceIndex = cIndex;
                                       setExtractedQuestions(nq);
                                     }
                                   }}
                                   style={{
                                     width: 32, height: 32, borderRadius: '50%', border: 'none', flexShrink: 0,
                                     background: q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex === cIndex ? '#22c55e' : '#334155',
                                     color: 'white', fontWeight: 'bold', cursor: 'pointer'
                                   }}
                                 >
                                   {String.fromCharCode(65 + cIndex)}
                                 </button>
                                 {isImage ? (
                                   <div style={{ position: 'relative', flex: 1, padding: 8, borderRadius: 8, background: '#1e293b', border: '1px solid #475569' }}>
                                     <img src={choice} style={{ maxWidth: 200, maxHeight: 100, borderRadius: 4 }} />
                                     <button 
                                       onClick={() => {
                                          const nq = [...extractedQuestions];
                                          if (nq[qIndex].interaction.type === 'mcq') {
                                            (nq[qIndex].interaction as any).choices[cIndex] = '';
                                            setExtractedQuestions(nq);
                                          }
                                       }}
                                       style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                                     >✕</button>
                                   </div>
                                 ) : (
                                   <input
                                     value={choice}
                                     onChange={(e) => {
                                        const nq = [...extractedQuestions];
                                        if (nq[qIndex].interaction.type === 'mcq') {
                                          (nq[qIndex].interaction as any).choices[cIndex] = e.target.value;
                                          setExtractedQuestions(nq);
                                        }
                                     }}
                                     onPaste={(e) => handlePasteImage(e, (b64) => {
                                        const nq = [...extractedQuestions];
                                        if (nq[qIndex].interaction.type === 'mcq') {
                                          (nq[qIndex].interaction as any).choices[cIndex] = b64;
                                          setExtractedQuestions(nq);
                                        }
                                     })}
                                     placeholder={`Option ${String.fromCharCode(65 + cIndex)} (Paste image here)`}
                                     style={{ flex: 1, padding: '8px 12px', borderRadius: 8, background: '#1e293b', border: '1px solid #475569', color: 'white', outline: 'none', fontSize: 13 }}
                                   />
                                 )}
                                 <button 
                                   onClick={() => {
                                      const nq = [...extractedQuestions];
                                      if (nq[qIndex].interaction.type === 'mcq') {
                                         const arr = (nq[qIndex].interaction as any).choices;
                                         if (arr.length > 2) {
                                           arr.splice(cIndex, 1);
                                           if ((nq[qIndex].interaction as any).correctChoiceIndex === cIndex) {
                                              (nq[qIndex].interaction as any).correctChoiceIndex = -1;
                                           } else if ((nq[qIndex].interaction as any).correctChoiceIndex > cIndex) {
                                              (nq[qIndex].interaction as any).correctChoiceIndex--;
                                           }
                                           setExtractedQuestions(nq);
                                         }
                                      }
                                   }}
                                   style={{ background: 'transparent', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}
                                   title="Remove Option"
                                 >×</button>
                               </div>
                             );
                           })}
                           <button 
                              onClick={() => {
                                 const nq = [...extractedQuestions];
                                 if (nq[qIndex].interaction.type === 'mcq') {
                                    (nq[qIndex].interaction as any).choices.push('');
                                    setExtractedQuestions(nq);
                                 }
                              }}
                              style={{ background: 'transparent', border: '1px dashed #475569', color: '#94a3b8', padding: '8px', borderRadius: 8, cursor: 'pointer', marginTop: 4, width: 'fit-content', fontSize: 13 }}
                           >
                             + Add Option
                           </button>
                         </div>
                       )}
                     </div>
                  ))}
                  <button 
                    onClick={async () => {
                      // Check if any question is missing a correct answer
                      const missingAns = extractedQuestions.some(q => q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex < 0);
                      if (missingAns) {
                         if (!window.confirm("Some questions do not have a correct answer selected. Add them anyway?")) return;
                      }

                      await saveQuestionsList([...questions, ...extractedQuestions]);
                      setAddModalOpen(false);
                      setExtractedQuestions(null);
                      setPdfFile(null);
                    }} 
                    className="ll-btn ll-btn-primary" 
                    style={{ padding: '14px', fontSize: 15, fontWeight: 'bold', marginTop: 20 }}
                  >
                    Add All {extractedQuestions.length} Questions to Level
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ProgramsAdmin() {
  const { user, userData } = useAuth();
  const [items, setItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [draftItems, setDraftItems] = useState<Array<{ id: string; title?: string; subject?: string; grade_band?: string; coverEmoji?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const [aiImportJson, setAiImportJson] = useState('');
  const [aiImportStatus, setAiImportStatus] = useState('');
  const [aiImportError, setAiImportError] = useState('');
  const [notebookImportJson, setNotebookImportJson] = useState('');
  const [notebookValidation, setNotebookValidation] = useState<NotebookValidationResult | null>(null);

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

  function normalizeOrganizationLabel(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function extractQuestionPromptText(question: Record<string, unknown>): string {
    const promptBlocks = Array.isArray(question.promptBlocks) ? question.promptBlocks as Array<Record<string, unknown>> : [];
    return promptBlocks
      .map((block) => (typeof block?.text === 'string' ? block.text : (typeof block?.latex === 'string' ? block.latex : '')))
      .join('\n')
      .trim() || (typeof question.question === 'string' ? question.question : '');
  }

  function buildImportedQuestionSignature(question: Record<string, unknown>): string {
    const promptText = normalizeOrganizationLabel(extractQuestionPromptText(question));
    const interaction = question.interaction as { type?: string; final?: { type?: string } } | null | undefined;
    const interactionType = typeof interaction?.type === 'string'
      ? (interaction.type === 'composite' ? `composite:${interaction.final?.type ?? 'unknown'}` : interaction.type)
      : 'unknown';
    return `${interactionType}::${promptText}`;
  }

  function classifyImportedQuestionType(
    interaction: ProgramAtomicInteractionSpec | ({ type: 'composite'; final: ProgramAtomicInteractionSpec; steps: ProgramStepSpec[]; allowDirectFinalAnswer?: boolean; scoreStrategy?: 'final_only' | 'final_plus_steps' }) | null,
    questionText: string,
  ): string {
    const lower = questionText.toLowerCase();
    if (interaction?.type === 'composite') {
      if (interaction.steps.some((step) => step.interaction.type === 'points_on_line')) return 'Find Equation and Other Points';
      return 'Multi-Step Questions';
    }
    if (interaction?.type === 'point_list') return 'Generate Points from Equation';
    if (interaction?.type === 'points_on_line') return 'Find Other Points on the Line';
    if (interaction?.type === 'line_equation') return 'Find Equation from Two Points';
    if (/find\s+3\s+other\s+points|other\s+points\s+.*line/.test(lower)) return 'Find Equation and Other Points';
    if (/list\s+10\s+points|generate\s+10\s+points|points\s+that\s+(?:lie|satisfy)/.test(lower)) return 'Generate Points from Equation';
    if (/equation of the line|passing through the points|passes through/.test(lower)) return 'Find Equation from Two Points';
    return chooseImportedQuestionTypeTitle(questionText);
  }

  function collectBuilderQuestions(node: BuilderNode): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    for (const qt of node.questionTypes) {
      try {
        const parsed = JSON.parse(qt.jsonText);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
              out.push(item as Record<string, unknown>);
            }
          }
        }
      } catch {
        // ignore malformed builder question JSON during auto-organization
      }
    }
    for (const child of node.children) {
      out.push(...collectBuilderQuestions(child));
    }
    return out;
  }

  function collectExistingOrganizationTitles(chapters: BuilderNode[]): {
    chapterTitlesByKey: Map<string, string>;
    questionTypeTitlesByKey: Map<string, string>;
  } {
    const chapterTitlesByKey = new Map<string, string>();
    const questionTypeTitlesByKey = new Map<string, string>();
    for (const chapter of chapters) {
      const chapterKey = normalizeOrganizationLabel(chapter.title);
      if (chapterKey && !chapterTitlesByKey.has(chapterKey)) {
        chapterTitlesByKey.set(chapterKey, chapter.title);
      }
      for (const qt of chapter.questionTypes) {
        const qtKey = normalizeOrganizationLabel(qt.title);
        if (qtKey && !questionTypeTitlesByKey.has(qtKey)) {
          questionTypeTitlesByKey.set(qtKey, qt.title);
        }
      }
    }
    return { chapterTitlesByKey, questionTypeTitlesByKey };
  }

  function rebuildImportedOrganization(
    prev: BuilderSpec,
    importedQuestions: Array<Record<string, unknown>>,
    fallbackChapterTitle: string,
    fallbackProgramTitle: string,
  ): { builder: BuilderSpec; selectedPathIds: string[]; selectedQuestionTypeId: string | null } {
    const spec = ensureFixedFirstDivisionContainer({ ...prev, divisions: ['Chapters'] });
    const fixedIdx = spec.root.children.findIndex((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID);
    const fixed = fixedIdx >= 0 ? spec.root.children[fixedIdx]! : { id: FIXED_FIRST_DIVISION_NODE_ID, title: 'Chapters', children: [], questionTypes: [] };
    const { chapterTitlesByKey, questionTypeTitlesByKey } = collectExistingOrganizationTitles(fixed.children);
    const existingQuestions = fixed.children.flatMap((chapter) => collectBuilderQuestions(chapter));
    const dedupedQuestions: Array<Record<string, unknown>> = [];
    const seenQuestionSignatures = new Set<string>();
    for (const question of [...existingQuestions, ...importedQuestions]) {
      const signature = buildImportedQuestionSignature(question);
      if (!signature || seenQuestionSignatures.has(signature)) continue;
      seenQuestionSignatures.add(signature);
      dedupedQuestions.push(question);
    }
    const chapterMap = new Map<string, { title: string; questionTypes: Map<string, Array<Record<string, unknown>>> }>();

    for (const question of dedupedQuestions) {
      const promptText = extractQuestionPromptText(question);
      const classifiedChapterTitle = summarizeImportedTopic(promptText) || fallbackChapterTitle || 'Worksheet Practice';
      const classifiedChapterKey = normalizeOrganizationLabel(classifiedChapterTitle);
      const chapterTitle = chapterTitlesByKey.get(classifiedChapterKey) ?? classifiedChapterTitle;
      const chapterKey = normalizeOrganizationLabel(chapterTitle);
      const interaction = (question.interaction ?? null) as ProgramAtomicInteractionSpec | ({ type: 'composite'; final: ProgramAtomicInteractionSpec; steps: ProgramStepSpec[]; allowDirectFinalAnswer?: boolean; scoreStrategy?: 'final_only' | 'final_plus_steps' }) | null;
      const classifiedQuestionTypeTitle = classifyImportedQuestionType(interaction, promptText);
      const questionTypeTitle = questionTypeTitlesByKey.get(normalizeOrganizationLabel(classifiedQuestionTypeTitle)) ?? classifiedQuestionTypeTitle;
      const questionTypeKey = normalizeOrganizationLabel(questionTypeTitle);
      const existingChapter = chapterMap.get(chapterKey) ?? { title: chapterTitle, questionTypes: new Map<string, Array<Record<string, unknown>>>() };
      const existingQuestionsForType = existingChapter.questionTypes.get(questionTypeKey) ?? [];
      existingQuestionsForType.push(question);
      existingChapter.questionTypes.set(questionTypeKey, existingQuestionsForType);
      chapterMap.set(chapterKey, existingChapter);
    }

    const rebuiltChapters: BuilderNode[] = Array.from(chapterMap.values())
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((chapter) => ({
        id: makeStableId('node'),
        title: cleanGeneratedTitle(chapter.title || fallbackChapterTitle || 'Imported Chapter'),
        children: [],
        questionTypes: Array.from(chapter.questionTypes.values())
          .sort((a, b) => {
            const aTitle = classifyImportedQuestionType((a[0]?.interaction ?? null) as any, typeof a[0]?.question === 'string' ? a[0]!.question as string : '');
            const bTitle = classifyImportedQuestionType((b[0]?.interaction ?? null) as any, typeof b[0]?.question === 'string' ? b[0]!.question as string : '');
            return aTitle.localeCompare(bTitle);
          })
          .map((questionsForType) => ({
            id: makeStableId('qt'),
            title: classifyImportedQuestionType((questionsForType[0]?.interaction ?? null) as any, typeof questionsForType[0]?.question === 'string' ? questionsForType[0]!.question as string : ''),
            jsonText: JSON.stringify(questionsForType, null, 2),
          })),
      }));

    const nextChildren = [...spec.root.children];
    const updatedFixed = { ...fixed, title: 'Chapters', children: rebuiltChapters };
    if (fixedIdx >= 0) {
      nextChildren[fixedIdx] = updatedFixed;
    } else {
      nextChildren.unshift(updatedFixed);
    }

    const selectedChapter = rebuiltChapters.find((chapter) => {
      const key = normalizeOrganizationLabel(chapter.title);
      return key === normalizeOrganizationLabel(fallbackChapterTitle);
    }) ?? rebuiltChapters[0] ?? null;
    const selectedQuestionType = selectedChapter?.questionTypes[0] ?? null;

    return {
      builder: ensureFixedFirstDivisionContainer({
        ...spec,
        divisions: ['Chapters'],
        programTitle: cleanGeneratedTitle(spec.programTitle || fallbackProgramTitle || selectedChapter?.title || 'Imported Worksheet'),
        root: {
          ...spec.root,
          title: spec.root.title === 'Enter program title' ? cleanGeneratedTitle(fallbackProgramTitle || selectedChapter?.title || 'Imported Worksheet') : spec.root.title,
          children: nextChildren,
        },
      }),
      selectedPathIds: ['root', selectedChapter?.id ?? 'root'],
      selectedQuestionTypeId: selectedQuestionType?.id ?? null,
    };
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
        explanationScenes: ProgramExplanationScene[];
        stepSolutions: ProgramStepSpec[];
      }> = [];
      let titleGuess = '';
      let structuredHierarchy: Array<{ id: string; type: string; title: string; children: Array<{ id: string; type: string; title: string; children: unknown[]; questionRefs?: string[]; questionTypeTitle?: string }>; questionRefs?: string[]; questionTypeTitle?: string }> = [];

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
          const explanationScenes = getNormalizedExplanationScenes(answerData?.explanationScenes);
          const scoreStrategy: 'final_only' | 'final_plus_steps' = (asRecord(nq?.grading)?.mode === 'step_based' || stepSolutions.length > 0)
            ? 'final_plus_steps'
            : 'final_only';
          const fallbackGrading: 'ai' | 'manual' = asRecord(nq?.grading)?.mode === 'ai_rubric' ? 'ai' : 'manual';
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
            : { type: 'freeform' as const, grading: fallbackGrading, placeholder: 'Type your answer', rubricSummary: typeof nq?.explanation === 'string' ? nq.explanation : null, acceptSteps: true };
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
            explanationScenes,
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

      const importedQuestionDocs = Object.keys(groupedById).map((id) => groupedById[id]).filter(Boolean);
      const reorganized = rebuildImportedOrganization(builder, importedQuestionDocs, inferredTopicTitle || finalTitleGuess, finalTitleGuess);
      setBuilder(reorganized.builder);
      setBuilderPathIds(reorganized.selectedPathIds);
      setBuilderSelectedQuestionTypeId(reorganized.selectedQuestionTypeId);
      setDigitalizeStatus(`✅ Imported ${allQuestions.length} question(s) from ${filesToProcess.length} source(s)`);
    } catch (error) {
      setDigitalizeError(error instanceof Error ? error.message : String(error));
    } finally {
      setDigitalizeBusy(false);
    }
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [next, dnext] = await Promise.all([
        listProgramsAdmin('published'),
        listProgramsAdmin('draft'),
      ]);
      setItems(next as typeof items);
      setDraftItems(dnext as typeof draftItems);
    } catch (error) {
      console.error('Failed to load programs:', error);
      setLoadError(error instanceof Error ? error.message : 'Failed to load programs.');
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

  async function startEditBuilder(p: (typeof items)[number]) {
    setEditingId(p.id);
    setEditingDraftId(null);
    try {
      const data = await getPublishedProgramAdmin(p.id);
      if (!data) {
        window.alert('Published program not found');
        return;
      }
      const spec = data.builderSpec as BuilderSpec | undefined;
      const next = spec && typeof spec === 'object' && (spec as BuilderSpec).version === '1.0'
        ? spec
        : (() => {
            const b = newBuilderSpec();
            b.programId = p.id;
            b.programTitle = (data.title as string) ?? p.id;
            b.subject = (data.subject as string) ?? 'mathematics';
            b.gradeBand = (data.grade_band as string) ?? '';
            b.coverEmoji = (data.coverEmoji as string) ?? '📘';
            b.root.title = (data.title as string) ?? p.id;
            return b;
          })();
      setBuilder(ensureFixedFirstDivisionContainer(next));
      setBuilderPathIds(['root']);
      setBuilderSelectedQuestionTypeId(null);
      setView('builder');
    } catch (e) {
      window.alert(formatBuilderError(e));
    }
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

  function assertBuilderHasContent(spec: BuilderSpec): void {
    const normalized = ensureFixedFirstDivisionContainer(spec);
    const fixedContainer = normalized.root.children.find((c) => c.id === FIXED_FIRST_DIVISION_NODE_ID) ?? null;
    const topFolders = fixedContainer ? fixedContainer.children : normalized.root.children;
    const hasAnyQuestions = topFolders.some((chapter) => {
      const stack: BuilderNode[] = [chapter];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (node.questionTypes.some((qt) => qt.jsonText.trim().length > 0)) return true;
        stack.push(...node.children);
      }
      return false;
    });

    if (!hasAnyQuestions) {
      throw new Error('This program has no question content yet. Add at least one chapter/question type with questions before saving or publishing.');
    }
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

  function handleImportAiJson() {
    setAiImportError('');
    setAiImportStatus('');
    try {
      const imported = parseAIProgramImport(aiImportJson);
      setBuilder(imported);
      setBuilderPathIds(['root']);
      setBuilderSelectedQuestionTypeId(null);
      setAiImportStatus('✅ AI JSON imported into the builder. Preview and save/publish when ready.');
    } catch (error) {
      setAiImportError(formatBuilderError(error));
    }
  }

  function handleValidateNotebookJson() {
    setNotebookValidation(validateNotebookExerciseImport(notebookImportJson));
  }

  function handleAddNotebookExerciseToBuilder() {
    const validation = notebookValidation ?? validateNotebookExerciseImport(notebookImportJson);
    setNotebookValidation(validation);
    if (!validation.payload || !validation.summary) return;
    if (validation.errorCount > 0) {
      window.alert('Fix validation errors before adding this exercise to the builder.');
      return;
    }
    const convertedQuestions = convertNotebookExerciseToBuilderQuestions(validation.payload);
    const title = validation.summary.sourceExercise || 'NotebookLM Exercise';
    const jsonText = JSON.stringify(convertedQuestions, null, 2);
    let selectedQuestionTypeId: string | null = null;
    let targetPathIds: string[] = ['root'];
    setBuilder((prev) => {
      const base = ensureFixedFirstDivisionContainer({
        ...prev,
        divisions: prev.divisions.length >= 2 ? prev.divisions : ['Chapters', 'Topics'],
      });
      const fixed = base.root.children.find((child) => child.id === FIXED_FIRST_DIVISION_NODE_ID);
      if (!fixed) return base;

      const chapterTitle = validation.payload?.chapterTitle || validation.payload?.chapterId || 'Imported Chapter';
      const exerciseTitle = validation.payload?.sourceExercise || 'Imported Exercise';
      let chapterNode = fixed.children.find((child) => child.title === chapterTitle);
      if (!chapterNode) {
        chapterNode = { id: makeStableId('node'), title: chapterTitle, children: [], questionTypes: [] };
        fixed.children = [...fixed.children, chapterNode];
      }

      let targetNode = chapterNode;
      if (base.divisions.length >= 2) {
        let exerciseNode = chapterNode.children.find((child) => child.title === exerciseTitle);
        if (!exerciseNode) {
          exerciseNode = { id: makeStableId('node'), title: exerciseTitle, children: [], questionTypes: [] };
          chapterNode.children = [...chapterNode.children, exerciseNode];
        }
        targetNode = exerciseNode;
        targetPathIds = ['root', chapterNode.id, exerciseNode.id];
      } else {
        targetPathIds = ['root', chapterNode.id];
      }

      const existing = targetNode.questionTypes.find((qt) => qt.title === title);
      const questionTypeId = existing?.id ?? makeStableId('qt');
      selectedQuestionTypeId = questionTypeId;
      targetNode.questionTypes = existing
        ? targetNode.questionTypes.map((qt) => (qt.id === existing.id ? { ...qt, jsonText } : qt))
        : [...targetNode.questionTypes, { id: questionTypeId, title, jsonText }];

      return ensureFixedFirstDivisionContainer(base);
    });
    setBuilderPathIds(targetPathIds);
    setBuilderSelectedQuestionTypeId(selectedQuestionTypeId);
    window.alert(`Added ${convertedQuestions.length} builder questions from ${title}. Folders were created automatically when needed.`);
  }

  async function saveBuilderDraft() {
    const { id: programId, title } = computeProgramIdAndTitle();
    if (!programId) {
      window.alert('Missing program id');
      return;
    }
    setSaving(true);
    try {
      assertBuilderHasContent({ ...builder, programId, programTitle: title });
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
      assertBuilderHasContent({ ...builder, programId, programTitle: title });
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

  async function previewProgram(programId: string) {
    try {
      const data = await getPublishedProgramAdmin(programId);
      const spec = data?.builderSpec as BuilderSpec | undefined;
      if (spec && spec.version === '1.0') {
        const normalized = ensureFixedFirstDivisionContainer(spec);
        const title = normalized.programTitle || normalized.root.title || data?.title || programId;
        const internal = convertBuilderToInternal({ ...normalized, programId, programTitle: title });
        const key = `published-preview:${programId}`;
        setDraftProgram(key, {
          id: programId,
          title,
          subject: normalized.subject ?? data?.subject ?? 'mathematics',
          grade_band: normalized.gradeBand ?? data?.grade_band,
          coverEmoji: normalized.coverEmoji ?? data?.coverEmoji ?? '📘',
          toc: internal.toc,
          questionBanksByChapter: internal.questionBanksByChapter,
          annotations: internal.annotations,
          programMeta: internal.programMeta,
          rankedTotalQuestionCount: internal.rankedTotalQuestionCount,
        });
        setPreviewProgramId(`ll-draft:${key}`);
      } else {
        setPreviewProgramId(programId);
      }
      setPreviewReturnView('list');
      setView('preview');
    } catch (e) {
      window.alert(formatBuilderError(e));
    }
  }

  if (loading) return <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>Loading programs...</div>;

  if (loadError) {
    return (
      <div style={{ animation: 'fadeIn 0.3s ease' }}>
        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #7f1d1d', padding: 16, color: '#fecaca' }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Failed to load programs</div>
          <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{loadError}</div>
          <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

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

          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>🤖 Paste AI JSON Import</label>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Paste output from your external AI using the fixed `ai_program_import_v1` template. This replaces the current builder content with validated chapters, question types, and questions.
            </div>
            <textarea
              value={aiImportJson}
              onChange={(e) => setAiImportJson(e.target.value)}
              placeholder="Paste AI JSON here..."
              style={{
                width: '100%',
                minHeight: 180,
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0b1220',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 8,
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handleImportAiJson}
                className="ll-btn ll-btn-primary"
                disabled={aiImportJson.trim().length === 0}
                style={{ padding: '7px 14px', fontSize: 12, background: '#2563eb', borderColor: '#1d4ed8', color: 'white' }}
              >
                Import AI JSON
              </button>
              <button
                onClick={() => {
                  setAiImportJson('');
                  setAiImportStatus('');
                  setAiImportError('');
                }}
                className="ll-btn"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                Clear
              </button>
            </div>
            {aiImportStatus && <div style={{ color: '#93c5fd', fontSize: 11, marginTop: 8 }}>{aiImportStatus}</div>}
            {aiImportError && <div style={{ color: '#fca5a5', fontSize: 11, marginTop: 8, whiteSpace: 'pre-wrap' }}>{aiImportError}</div>}
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 8, fontWeight: 900 }}>📚 NotebookLM Exercise Import Sandbox</label>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 8 }}>
              Paste one complete exercise extraction from NotebookLM. This validates schema, formats, answers, manual-review flags, and source-asset warnings before we convert it into program content.
            </div>
            <textarea
              value={notebookImportJson}
              onChange={(e) => setNotebookImportJson(e.target.value)}
              placeholder="Paste NotebookLM exercise JSON here..."
              style={{
                width: '100%',
                minHeight: 180,
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0b1220',
                color: 'white',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: 8,
                fontFamily: 'monospace',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <button
                onClick={handleValidateNotebookJson}
                className="ll-btn ll-btn-primary"
                disabled={notebookImportJson.trim().length === 0}
                style={{ padding: '7px 14px', fontSize: 12, background: '#0d9488', borderColor: '#0f766e', color: 'white' }}
              >
                Validate NotebookLM JSON
              </button>
              <button
                onClick={handleAddNotebookExerciseToBuilder}
                className="ll-btn ll-btn-primary"
                disabled={!notebookValidation?.payload || notebookValidation.errorCount > 0}
                style={{ padding: '7px 14px', fontSize: 12, background: '#16a34a', borderColor: '#15803d', color: 'white' }}
                title="Adds this exercise as a question type file inside the currently selected final folder."
              >
                Add to Builder
              </button>
              <button
                onClick={() => {
                  setNotebookImportJson('');
                  setNotebookValidation(null);
                }}
                className="ll-btn"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                Clear
              </button>
            </div>
            {notebookValidation?.summary ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 10 }}>
                {[
                  ['Exercise', notebookValidation.summary.sourceExercise || 'Unknown'],
                  ['Questions', String(notebookValidation.summary.questionCount)],
                  ['Parts', String(notebookValidation.summary.partCount)],
                  ['Manual review', String(notebookValidation.summary.manualReviewCount)],
                  ['Source assets', String(notebookValidation.summary.sourceAssetCount)],
                  ['Errors / warnings', `${notebookValidation.errorCount} / ${notebookValidation.warningCount}`],
                ].map(([label, value]) => (
                  <div key={label} style={{ border: '1px solid #1f2a44', borderRadius: 10, background: '#0b1220', padding: 10 }}>
                    <div style={{ color: '#64748b', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.7 }}>{label}</div>
                    <div style={{ color: 'white', fontSize: 14, fontWeight: 900, marginTop: 3 }}>{value}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {notebookValidation?.summary ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {Object.entries(notebookValidation.summary.formatCounts).map(([format, count]) => (
                  <span key={format} style={{ padding: '4px 8px', borderRadius: 999, background: 'rgba(20,184,166,0.14)', color: '#5eead4', fontSize: 11, fontWeight: 900 }}>{format}: {count}</span>
                ))}
              </div>
            ) : null}
            {notebookValidation?.issues.length ? (
              <div style={{ border: '1px solid #1f2a44', borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
                {notebookValidation.issues.slice(0, 12).map((issue, index) => (
                  <div key={`${issue.path}:${index}`} style={{ padding: '7px 9px', borderBottom: index === Math.min(notebookValidation.issues.length, 12) - 1 ? 'none' : '1px solid #1f2a44', background: issue.severity === 'error' ? 'rgba(127,29,29,0.25)' : issue.severity === 'warning' ? 'rgba(146,64,14,0.20)' : 'rgba(30,64,175,0.16)' }}>
                    <div style={{ color: issue.severity === 'error' ? '#fca5a5' : issue.severity === 'warning' ? '#fdba74' : '#93c5fd', fontSize: 11, fontWeight: 900 }}>{issue.severity.toUpperCase()} · {issue.path}</div>
                    <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>{issue.message}</div>
                  </div>
                ))}
              </div>
            ) : notebookValidation ? (
              <div style={{ color: '#86efac', fontSize: 12, fontWeight: 900, marginBottom: 10 }}>✅ No validation issues found.</div>
            ) : null}
            {notebookValidation?.payload ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {notebookValidation.payload.questions.slice(0, 6).map((question) => (
                  <div key={question.questionId} style={{ border: '1px solid #1f2a44', borderRadius: 10, background: '#0b1220', padding: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ color: 'white', fontSize: 12, fontWeight: 900 }}>{question.questionId}</span>
                      <span style={{ color: '#5eead4', fontSize: 11, fontWeight: 900 }}>{question.questionFormat}</span>
                      <span style={{ color: '#c4b5fd', fontSize: 11, fontWeight: 900 }}>{question.difficulty}</span>
                      {question.needsManualReview ? <span style={{ color: '#fdba74', fontSize: 11, fontWeight: 900 }}>manual review</span> : null}
                      {question.requiresDiagram ? <span style={{ color: '#fca5a5', fontSize: 11, fontWeight: 900 }}>source asset</span> : null}
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.4 }}>{question.questionText}</div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 5 }}>{question.parts.length} part{question.parts.length === 1 ? '' : 's'} · first answer: {question.parts[0]?.answer || '—'}</div>
                  </div>
                ))}
              </div>
            ) : null}
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
