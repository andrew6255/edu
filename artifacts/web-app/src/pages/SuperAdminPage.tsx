import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { getGlobalDoc, setGlobalDoc, queryGlobalDocs, deleteGlobalDoc, resolveArrayUnion } from '@/lib/supabaseDocStore';
import {
  getTeacherClassesByTeacher,
  getClassMembers,
  adminAddStudentToClass,
  adminRemoveStudentFromClass,
  type TeacherClass,
  type ClassMember
} from '@/lib/classroomService';
import { useToast } from '@/hooks/use-toast';
import { useConfirm } from '@/contexts/ConfirmContext';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { performSignOut } from '@/lib/authService';
import SettingsLauncher from '@/components/settings/SettingsLauncher';
import { 
  getAllUsers, 
  updateUserData, 
  deleteUserData, 
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
import { createImpersonationToken, createManagedUserAccount, updateManagedUserRole } from '@/lib/adminApiService';
import ProgramsAdminComponent from '@/components/superadmin/ProgramsAdmin';
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
  loadLogicGameQuestionsWithProgress,
  listLogicGameNodes,
  upsertLogicGameNode,
  upsertLogicGameQuestions,
} from '@/lib/logicGamesService';
import ProgramMapView from '@/views/ProgramMapView';
import LatexMarkdown from '@/components/ui/LatexMarkdown';
import { clearDraftProgram, setDraftProgram } from '@/lib/draftProgramStore';
import { deleteProgramQuestionAsset, uploadProgramQuestionAsset } from '@/lib/programAssetService';
import {
  getEconomyReconciliationReport,
  type EconomyReconciliationReport,
} from '@/lib/economyApiService';
import type { LogicGameNode, LogicGameQuestionsDoc, LogicGameQuestion, CognitiveMetric } from '@/types/logicGames';
import { COGNITIVE_METRICS } from '@/types/logicGames';
import type { LogicGameSaveProgress } from '@/lib/logicGamesService';
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


// Dialog stacking. The floating settings launcher sits at 1500 and the settings
// modals at 1600/1700, so admin dialogs must clear 1700 or the settings gear
// renders on top of them — and stays clickable through the overlay.
const Z_DIALOG_BACKDROP = 1800;
const Z_DIALOG_PANEL = 1801;
/** Nested dialogs opened from within another dialog (e.g. question details). */
const Z_NESTED_DIALOG_BACKDROP = 1900;
const Z_NESTED_DIALOG_PANEL = 1901;

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
  const { toast } = useToast();
  const { confirm } = useConfirm();
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

  // Role change modal
  const [roleModal, setRoleModal] = useState<{ uid: string; name: string; currentRole: UserRole; newRole: Exclude<UserRole, 'superadmin'> } | null>(null);
  const [applyingRole, setApplyingRole] = useState(false);

  // Economy modal
  const [econModal, setEconModal] = useState<{ uid: string; name: string; goldDelta: string; xpDelta: string; energyDelta: string; streakDelta: string; reason:string } | null>(null);
  const [applyingEcon, setApplyingEcon] = useState(false);
  const [economyAudit, setEconomyAudit] = useState<EconomyReconciliationReport | null>(null);
  const [auditingEconomy, setAuditingEconomy] = useState(false);
  const [economyAuditError, setEconomyAuditError] = useState<string | null>(null);

  // Class Members Modal (opened on teacher rows)
  const [classMemberModal, setClassMemberModal] = useState<{ teacherUid: string; teacherName: string } | null>(null);
  const [teacherClasses, setTeacherClasses] = useState<TeacherClass[]>([]);
  const [classMembers, setClassMembers] = useState<Record<string, ClassMember[]>>({});
  const [loadingClassMembers, setLoadingClassMembers] = useState(false);
  const [classStudentSearch, setClassStudentSearch] = useState<Record<string, string>>({});

  // Create account modal
  const [createModal, setCreateModal] = useState(false);
  const [createFname, setCreateFname] = useState('');
  const [createLname, setCreateLname] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPass, setCreatePass] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Impersonate modal
  const [impersonateTarget, setImpersonateTarget] = useState<(UserData & { uid: string }) | null>(null);
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateError, setImpersonateError] = useState('');

  async function doImpersonate() {
    if (!impersonateTarget) return;
    setImpersonating(true);
    setImpersonateError('');
    try {
      const token_hash = await createImpersonationToken(impersonateTarget.uid);
      const rawSession = localStorage.getItem('sb-auth-token');
      if (rawSession) {
        localStorage.setItem('ll:superadmin_session', rawSession);
      }

      const { error: verifyErr } = await requireSupabase().auth.verifyOtp({ token_hash, type: 'magiclink' });
      if (verifyErr) throw verifyErr;
      localStorage.setItem('ll:impersonating', 'true');
      localStorage.setItem('ll:last_impersonated_uid', impersonateTarget.uid);
      window.location.href = import.meta.env.BASE_URL;
    } catch (e: any) {
      console.error('Impersonation error:', e);
      setImpersonateError(e.message || String(e));
      setImpersonating(false);
    }
  }

  // Which uid this page has already loaded for. Returning from another browser
  // tab re-emits an auth event; without this the effect would re-run loadData,
  // flip the full-page loading gate, and unmount the question editor along with
  // any unsaved work in it.
  const loadedForUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (user === null) {
      setLocation('/auth');
      return;
    }
    if (!user || !userData) return;
    if (userData.role !== 'superadmin') {
      setLocation('/');
      return;
    }
    if (loadedForUidRef.current === user.uid) return;
    loadedForUidRef.current = user.uid;
    void loadData({ initial: true });
  }, [user?.uid, userData?.role, setLocation]);

  async function loadData(options?: { initial?: boolean }) {
    // Only the first load may blank the page. A later refresh updates the lists
    // in place so it cannot destroy in-progress editing.
    if (options?.initial) setLoading(true);
    try {
      const [u, ata, psl] = await Promise.all([getAllUsers(), getAdminTeacherAssignments().catch(() => [] as AdminTeacherAssignment[]), getParentStudentLinks().catch(() => [] as ParentStudentLink[])]);
      setUsers(u);
      setAtaLinks(ata);
      setPslLinks(psl);

      const lastImpUid = localStorage.getItem('ll:last_impersonated_uid');
      if (lastImpUid) {
        setTab('users');
        setExpandedUser(lastImpUid);
        localStorage.removeItem('ll:last_impersonated_uid');
      }
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      if (options?.initial) setLoading(false);
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
    if (!(await confirm(msg))) return;
    setDeletingUser(uid);
    try {
      await deleteUserData(uid);
      const removedIds = new Set([uid, ...(pairedUid ? [pairedUid] : [])]);
      setUsers(prev => prev.filter(u => !removedIds.has(u.uid)));
      setPslLinks(prev => prev.filter(l => !removedIds.has(l.student_id) && !removedIds.has(l.parent_id)));
    } catch (error) {
      toast({ variant: 'destructive', description: error instanceof Error ? error.message : 'Account deletion failed.' });
    } finally {
      setDeletingUser(null);
    }
  }

  async function handleRoleApply() {
    if (!roleModal) return;
    setApplyingRole(true);
    try {
      await updateManagedUserRole(roleModal.uid, roleModal.newRole);
      setUsers(prev => prev.map(u => u.uid === roleModal.uid ? { ...u, role: roleModal.newRole } : u));
      toast({ description: `${roleModal.name} is now ${ROLE_LABELS[roleModal.newRole]}.` });
      setRoleModal(null);
    } catch (error) {
      toast({ variant: 'destructive', description: error instanceof Error ? error.message : 'Role change failed.' });
    } finally {
      setApplyingRole(false);
    }
  }

  async function handleEconApply() {
    if (!econModal) return;
    const gold = parseInt(econModal.goldDelta) || 0;
    const xp = parseInt(econModal.xpDelta) || 0;
    const energy = parseInt(econModal.energyDelta) || 0;
    const streak = parseInt(econModal.streakDelta) || 0;
    if (gold === 0 && xp === 0 && energy === 0 && streak === 0) { setEconModal(null); return; }
    const reason=econModal.reason.trim();
    if(reason.length<3){toast({variant:'destructive',description:'Enter a reason of at least 3 characters.'});return;}
    setApplyingEcon(true);
    try {
      await adminUpdateEconomy(econModal.uid, { gold, xp, energy, streak },reason);
      setUsers(prev => prev.map(u => u.uid === econModal.uid ? {
        ...u, economy: {
          ...u.economy,
          gold: Math.max(0, (u.economy?.gold || 0) + gold),
          global_xp: Math.max(0, (u.economy?.global_xp || 0) + xp),
          energy: Math.max(0, (u.economy?.energy || 0) + energy),
          streak: Math.max(0, (u.economy?.streak || 0) + streak),
        }
      } : u));
      setEconModal(null);
    } catch (error) {
      toast({variant:'destructive',description:error instanceof Error?error.message:'Economy adjustment failed.'});
    } finally {
      setApplyingEcon(false);
    }
  }

  async function handleEconomyAudit() {
    setAuditingEconomy(true);
    setEconomyAuditError(null);
    try {
      setEconomyAudit(await getEconomyReconciliationReport());
    } catch (error) {
      setEconomyAuditError(error instanceof Error ? error.message : 'Economy reconciliation failed.');
    } finally {
      setAuditingEconomy(false);
    }
  }

  async function handleCreateAccount() {
    if (!createFname || !createLname || !createUsername || !createEmail || !createPass) {
      setCreateError('Please fill in all fields.'); return;
    }
    if (createPass.length < 8) { setCreateError('Password must be at least 8 characters.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(createUsername)) { setCreateError('Username can only contain letters, numbers and underscores.'); return; }
    setCreating(true); setCreateError('');
    try {
      const taken = await isUsernameTaken(createUsername.toLowerCase());
      if (taken) { setCreateError('Username is already taken.'); return; }
      const created = await createManagedUserAccount({
        firstName: createFname, lastName: createLname, username: createUsername.toLowerCase(),
        email: createEmail, password: createPass, role: 'admin',
      });
      setUsers(prev => [...prev, created]);
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

  async function handleOpenClassMemberModal(teacher: UserData & { uid: string }) {
    setClassMemberModal({ teacherUid: teacher.uid, teacherName: teacher.username || teacher.firstName });
    setTeacherClasses([]);
    setClassMembers({});
    try {
      const classes = await getTeacherClassesByTeacher(teacher.uid);
      setTeacherClasses(classes);
      
      const membersMap: Record<string, ClassMember[]> = {};
      for (const cls of classes) {
        membersMap[cls.id] = await getClassMembers(cls.id);
      }
      setClassMembers(membersMap);
    } catch (e) {
      console.error('Failed to load teacher classes', e);
      toast({ variant: 'destructive', description: 'Failed to load teacher classes' });
    }
  }

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
  ];

  return (
    <div className="app-viewport" style={{ display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden', paddingBottom: 'calc(66px + env(safe-area-inset-bottom))', boxSizing: 'border-box' }}>
      {/* Header */}
      <div className="app-safe-header" style={{ paddingBottom: 10, background: '#1e293b', borderBottom: '2px solid #a855f744', flexShrink: 0 }}>
        <div className="phone-wrap" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
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
            <button onClick={() => void loadData()} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer' }}>
              ↺ Refresh
            </button>
            <SettingsLauncher compact inline />
            <button onClick={async () => { await performSignOut(); }} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}>
              Sign Out
            </button>
          </div>
        </div>
        <nav aria-label="Super admin sections" className="app-safe-nav" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, display: 'flex', justifyContent: 'space-around', gap: 4, background: 'rgba(15,23,42,.98)', borderTop: '1px solid #334155', paddingTop: 7 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '5px 4px', borderRadius: 8, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t.id ? 'rgba(168,85,247,0.2)' : 'transparent',
              border: `1px solid ${tab === t.id ? 'rgba(168,85,247,0.5)' : 'transparent'}`,
              color: tab === t.id ? '#d8b4fe' : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative'
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
        </nav>
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
                { label: 'Teachers', value: roleCounts.teacher, icon: '', color: ROLE_COLORS.teacher },
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

            <div style={{ background: '#1e293b', borderRadius: 12, padding: 16, border: '1px solid #334155', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ color: 'white', margin: '0 0 4px', fontSize: 14 }}>Economy Integrity</h3>
                  <div style={{ color: '#94a3b8', fontSize: 11 }}>
                    Compare every wallet with its latest immutable ledger balance.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleEconomyAudit}
                  disabled={auditingEconomy}
                  style={{
                    padding: '8px 13px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.45)',
                    background: 'rgba(168,85,247,0.15)', color: '#d8b4fe', fontFamily: 'inherit',
                    fontWeight: 'bold', fontSize: 11, cursor: auditingEconomy ? 'wait' : 'pointer',
                    opacity: auditingEconomy ? 0.65 : 1,
                  }}
                >
                  {auditingEconomy ? 'Checking…' : economyAudit ? 'Run again' : 'Run reconciliation'}
                </button>
              </div>

              {economyAuditError && (
                <div style={{ marginTop: 12, color: '#fca5a5', fontSize: 11 }}>{economyAuditError}</div>
              )}

              {economyAudit && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 9 }}>
                    <div style={{ padding: 11, borderRadius: 9, background: '#0f172a', border: `1px solid ${economyAudit.mismatchCount === 0 ? '#10b98155' : '#ef444466'}` }}>
                      <div style={{ color: economyAudit.mismatchCount === 0 ? '#34d399' : '#f87171', fontSize: 20, fontWeight: 'bold' }}>{economyAudit.mismatchCount}</div>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>Balance mismatches</div>
                    </div>
                    <div style={{ padding: 11, borderRadius: 9, background: '#0f172a', border: '1px solid #334155' }}>
                      <div style={{ color: '#fbbf24', fontSize: 20, fontWeight: 'bold' }}>{economyAudit.untrackedWalletCount}</div>
                      <div style={{ color: '#94a3b8', fontSize: 10 }}>Wallets without ledger entries</div>
                    </div>
                  </div>
                  <div style={{ color: '#64748b', fontSize: 10, marginTop: 9 }}>
                    Checked {new Date(economyAudit.checkedAt).toLocaleString()}. A wallet without ledger entries can simply be a new account with no economy activity yet.
                  </div>
                  {economyAudit.mismatchCount > 0 && (
                    <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fecaca', fontSize: 11, overflowWrap: 'anywhere' }}>
                      Review required for: {economyAudit.mismatches.slice(0, 5).map(item => String(item.userId ?? 'unknown user')).join(', ')}
                      {economyAudit.mismatches.length > 5 ? ` and ${economyAudit.mismatches.length - 5} more` : ''}.
                    </div>
                  )}
                </div>
              )}
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
                + Create Admin Account
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
                        {!isSelf && (
                          <button
                            onClick={() => setRoleModal({ uid: u.uid, name: u.username || u.firstName, currentRole: u.role as UserRole, newRole: (u.role === 'superadmin' ? 'student' : u.role) as Exclude<UserRole, 'superadmin'> })}
                            style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                          >
                            Role: {roleLabel}
                          </button>
                        )}
                        {!isSelf && u.role !== 'superadmin' && (
                          <>
                            {u.role === 'admin' && (
                              <button
                                onClick={() => setAtaModal({ adminUid: u.uid, adminName: u.username || u.firstName })}
                                style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                              >
                                👥 Teachers
                              </button>
                            )}
                            {u.role === 'teacher' && (
                              <button
                                onClick={() => handleOpenClassMemberModal(u)}
                                style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                              >
                                👨‍🎓 Classrooms
                              </button>
                            )}
                            {isStudent && (
                              <button
                                onClick={() => setEconModal({ uid: u.uid, name: u.username || u.firstName, goldDelta: '', xpDelta: '', energyDelta: '', streakDelta: '',reason:'' })}
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
                        <div style={{ color: '#64748b', fontSize: 11, marginBottom: 10 }}>
                          Created: {u.createdAt ? new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
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
                            onClick={e => { e.stopPropagation(); setImpersonateTarget(u); }}
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
          <ProgramsAdminComponent />
        </div>

        {/* ── LOGIC GAMES ── */}
        {tab === 'logicGames' && (
          <LogicGamesAdmin />
        )}

      </div>

      {/* Role change modal */}
      {roleModal && (
        <>
          <div onClick={() => setRoleModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z_DIALOG_BACKDROP }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(360px, 92vw)',
            border: '2px solid #a855f7', zIndex: Z_DIALOG_PANEL, animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 14px', color: 'white', fontSize: 17 }}>🔁 Change Role — {roleModal.name}</h2>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 14px' }}>
              Currently <strong style={{ color: ROLE_COLORS[roleModal.currentRole] }}>{ROLE_LABELS[roleModal.currentRole]}</strong>. Progress, economy, and existing data are preserved across the change.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {ROLE_ORDER.filter(r => r !== 'superadmin').map(r => (
                <button
                  key={r}
                  onClick={() => setRoleModal(p => p ? { ...p, newRole: r } : null)}
                  style={{
                    padding: '9px 12px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', textAlign: 'left',
                    cursor: 'pointer', fontFamily: 'inherit',
                    background: roleModal.newRole === r ? `${ROLE_COLORS[r]}22` : 'transparent',
                    border: `1px solid ${roleModal.newRole === r ? `${ROLE_COLORS[r]}88` : '#334155'}`,
                    color: roleModal.newRole === r ? ROLE_COLORS[r] : '#94a3b8',
                  }}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setRoleModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button
                onClick={handleRoleApply}
                disabled={applyingRole || roleModal.newRole === roleModal.currentRole}
                className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}
              >
                {applyingRole ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Economy modal */}
      {econModal && (
        <>
          <div onClick={() => setEconModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z_DIALOG_BACKDROP }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(360px, 92vw)',
            border: '2px solid #fbbf24', zIndex: Z_DIALOG_PANEL, animation: 'slideUp 0.2s ease'
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
            <input value={econModal.reason} onChange={e=>setEconModal(p=>p?{...p,reason:e.target.value}:null)} placeholder="Required adjustment reason" style={{width:'100%',padding:'9px 12px',borderRadius:8,border:'1px solid #475569',background:'rgba(0,0,0,0.4)',color:'white',boxSizing:'border-box',marginBottom:14}} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEconModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleEconApply} disabled={applyingEcon||econModal.reason.trim().length<3} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {applyingEcon ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Create Account modal */}
      {createModal && (
        <>
          <div onClick={() => setCreateModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z_DIALOG_BACKDROP }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 14, border: '2px solid #a855f7', padding: 24,
            zIndex: Z_DIALOG_PANEL, width: 'min(380px, 90vw)', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          }}>
            <h3 style={{ color: 'white', margin: '0 0 16px', fontSize: 16 }}>Create Admin Account</h3>
            {createError && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>{createError}</div>}
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
                {creating ? 'Creating...' : 'Create Admin'}
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
            toast({ variant: 'destructive', description: 'Failed: ' + (e instanceof Error ? e.message : String(e)) });
          } finally {
            setAtaSaving(false);
          }
        }

        return (
          <>
            <div onClick={() => setAtaModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z_DIALOG_BACKDROP }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(420px, 92vw)',
              maxHeight: '80vh', display: 'flex', flexDirection: 'column',
              border: `2px solid ${ROLE_COLORS.teacher}`, zIndex: Z_DIALOG_PANEL, animation: 'slideUp 0.2s ease'
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
      
      {/* ── Class Member Modal ─────────────────────────────────────────────── */}
      {classMemberModal && (
        <>
          <div onClick={() => setClassMemberModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: Z_DIALOG_BACKDROP }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', border: '1px solid #475569', borderRadius: 14,
            padding: 24, width: '90%', maxWidth: 500, zIndex: Z_DIALOG_PANEL,
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
            maxHeight: '80vh'
          }}>
            <h2 style={{ margin: '0 0 4px', color: 'white', fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              👨‍🎓 Manage Classrooms — {classMemberModal.teacherName}
            </h2>
            <div style={{ color: '#64748b', fontSize: 12, marginBottom: 14 }}>
              Add or remove students from {classMemberModal.teacherName}'s classrooms.
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {teacherClasses.length === 0 ? (
                <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>This teacher has no classes.</div>
              ) : (
                teacherClasses.map(cls => (
                  <div key={cls.id} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14, marginBottom: 8 }}>{cls.name}</div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {(classMembers[cls.id] || []).filter(m => !m.kickedAt).length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: 12, fontStyle: 'italic' }}>No active students.</div>
                      ) : (
                        (classMembers[cls.id] || []).filter(m => !m.kickedAt).map(m => (
                          <div key={m.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', padding: '6px 10px', borderRadius: 6, fontSize: 12 }}>
                            <div>
                              <span style={{ color: 'white', fontWeight: 'bold' }}>{m.fullName || m.username}</span>
                              <span style={{ color: '#64748b', marginLeft: 6 }}>@{m.username}</span>
                            </div>
                            <button onClick={async () => {
                              await adminRemoveStudentFromClass(cls.id, m.userId);
                              setClassMembers(prev => ({ ...prev, [cls.id]: prev[cls.id].filter(x => x.userId !== m.userId) }));
                            }} style={{ background: 'transparent', border: '1px solid #ef444455', color: '#ef4444', padding: '2px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Remove</button>
                          </div>
                        ))
                      )}
                    </div>
                    
                    <div style={{ position: 'relative' }}>
                      <input
                        placeholder="Search student to add..."
                        value={classStudentSearch[cls.id] || ''}
                        onChange={e => setClassStudentSearch(prev => ({ ...prev, [cls.id]: e.target.value }))}
                        style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: 'white', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                      />
                      {(() => {
                        const term = (classStudentSearch[cls.id] || '').toLowerCase().trim();
                        if (!term) return null;
                        const memberIds = new Set((classMembers[cls.id] || []).filter(m => !m.kickedAt).map(m => m.userId));
                        const matches = users.filter(u =>
                          u.role === 'student' && !memberIds.has(u.uid) &&
                          (u.username?.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) || u.firstName?.toLowerCase().includes(term) || u.lastName?.toLowerCase().includes(term))
                        ).slice(0, 6);
                        if (matches.length === 0) {
                          return <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 10px', color: '#64748b', fontSize: 12, zIndex: 5 }}>No matching students.</div>;
                        }
                        return (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, overflow: 'hidden', zIndex: 5 }}>
                            {matches.map(student => (
                              <button
                                key={student.uid}
                                onClick={async () => {
                                  const fullName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || student.username || 'Student';
                                  await adminAddStudentToClass(cls.id, student.uid, student.username || fullName, fullName);
                                  const updated = await getClassMembers(cls.id);
                                  setClassMembers(prev => ({ ...prev, [cls.id]: updated }));
                                  setClassStudentSearch(prev => ({ ...prev, [cls.id]: '' }));
                                  toast({ description: `Added ${student.username || student.firstName} to ${cls.name}` });
                                }}
                                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'transparent', border: 'none', borderBottom: '1px solid #1e293b', color: 'white', fontSize: 12, cursor: 'pointer' }}
                              >
                                <span style={{ fontWeight: 'bold' }}>{student.username || student.firstName}</span>
                                <span style={{ color: '#64748b', marginLeft: 6 }}>{student.email}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setClassMemberModal(null)} className="ll-btn" style={{ padding: '10px 22px' }}>Done</button>
            </div>
          </div>
        </>
      )}

      {/* ── Impersonate Confirmation Modal ───────────────────────────── */}
      {impersonateTarget && (
        <ImpersonateModal
          target={impersonateTarget}
          impersonating={impersonating}
          error={impersonateError}
          onConfirm={doImpersonate}
          onCancel={() => { setImpersonateTarget(null); setImpersonateError(''); }}
        />
      )}
    </div>
  );
}

// LogicGamesAdmin unmounts whenever the admin switches tabs, so anything held in
// component state is thrown away and refetched on return. These caches live at
// module scope so coming back to the tab is instant.
const bucketQuestionsCache = new Map<string, LogicGameQuestion[]>();
let cachedBuckets: LogicGameNode[] | null = null;

function LogicGamesAdmin() {
  const { toast } = useToast();
  const { confirm } = useConfirm();
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

  // Auto-fill details (explanation/cognitive metrics/per-option explanations)
  // for freshly extracted questions before they're reviewed and added to the
  // bucket, so nothing sits with blank details after being added. Matches
  // extracted questions by their client-generated id, not array index, so it
  // stays correct even if the admin edits/reorders/deletes while it runs.
  const [extractedDetailsFilling, setExtractedDetailsFilling] = useState(false);
  const [extractedDetailsProgress, setExtractedDetailsProgress] = useState<{ completed: number; total: number } | null>(null);
  const extractedDetailsCancelRef = useRef(false);

  async function autoFillExtractedQuestionsDetails(freshlyExtracted: LogicGameQuestion[]) {
    const targets = freshlyExtracted.filter((q) => !q.primaryMetric);
    if (targets.length === 0) return;
    setExtractedDetailsFilling(true);
    extractedDetailsCancelRef.current = false;
    setExtractedDetailsProgress({ completed: 0, total: targets.length });
    const apiUrl = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim() || 'http://localhost:3001';
    const seedDifficulty = nodes.find(n => n.id === selectedNodeId)?.seedDifficulty ?? 100;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (extractedDetailsCancelRef.current) break;
      const dq = targets[i];
      try {
        const promptText = dq.promptRawText || (dq.promptBlocks?.[0] as any)?.text || '';
        if (promptText.trim()) {
          const choicesArr = dq.interaction.type === 'mcq' ? dq.interaction.choices : [];
          const correctIdx = dq.interaction.type === 'mcq' ? dq.interaction.correctChoiceIndex : -1;
          const res = await fetch(`${apiUrl}/api/program-ingestion/iq-question-details`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ promptText, choices: choicesArr, correctChoiceIndex: correctIdx, nodeIq: seedDifficulty }),
          });
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
          const data = await res.json();
          setExtractedQuestions((prev) => (prev ?? []).map((q) => {
            if (q.id !== dq.id) return q;
            const updated: LogicGameQuestion = { ...q };
            if (data.explanation) updated.explanation = data.explanation;
            if (data.primaryMetric) updated.primaryMetric = data.primaryMetric;
            if (Array.isArray(data.secondaryMetrics)) updated.secondaryMetrics = data.secondaryMetrics;
            if (updated.interaction.type === 'mcq' && Array.isArray(data.choiceExplanations) && data.choiceExplanations.length > 0) {
              updated.interaction = { ...updated.interaction, choiceExplanations: data.choiceExplanations };
            }
            return updated;
          }));
        }
      } catch (e) {
        console.error(`[autoFillExtractedQuestionsDetails] question ${dq.id} failed:`, e instanceof Error ? e.message : String(e));
        failed++;
      }
      setExtractedDetailsProgress({ completed: i + 1, total: targets.length });
    }
    setExtractedDetailsFilling(false);
    setExtractedDetailsProgress(null);
    if (failed > 0) {
      toast({
        variant: 'destructive',
        description: `${failed} of ${targets.length} question${targets.length === 1 ? '' : 's'} couldn't get auto-filled details — after adding them to the bucket, open each one's Details panel and use the 🤖 button to retry.`,
      });
    }
  }

  // PDF Upload Flow
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [answersFile, setAnswersFile] = useState<File | null>(null);
  const [pdfExtracting, setPdfExtracting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfProgress, setPdfProgress] = useState('');
  const [pdfSteps, setPdfSteps] = useState<Array<{ icon: string; message: string; detail: string; done: boolean }>>([]);
  const [extractedQuestionsState, setExtractedQuestionsState] = useState<LogicGameQuestion[] | null>(() => {
    try {
      const saved = localStorage.getItem('ll_extracted_questions_draft');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const extractedQuestions = extractedQuestionsState;
  const setExtractedQuestions = (val: LogicGameQuestion[] | null | ((prev: LogicGameQuestion[] | null) => LogicGameQuestion[] | null)) => {
    setExtractedQuestionsState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        if (next && next.length > 0) {
          localStorage.setItem('ll_extracted_questions_draft', JSON.stringify(next));
        } else {
          localStorage.removeItem('ll_extracted_questions_draft');
        }
      } catch (e) {
        console.warn('Failed to save draft to localStorage', e);
      }
      return next;
    });
  };
  const [pdfStats, setPdfStats] = useState<{ totalPages: number; currentPage: number; totalQuestions: number; elapsedSeconds: number }>({
    totalPages: 0,
    currentPage: 0,
    totalQuestions: 0,
    elapsedSeconds: 0,
  });

  useEffect(() => {
    let timer: any = null;
    if (pdfExtracting) {
      timer = setInterval(() => {
        setPdfStats(prev => ({ ...prev, elapsedSeconds: prev.elapsedSeconds + 1 }));
      }, 1000);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [pdfExtracting]);

  async function load() {
    setLoading(true);
    setErr(null);
    setStatus(null);
    try {
      const pub = await listLogicGameNodes();
      
      // Auto-create a starter bucket if empty
      if (pub.length === 0) {
         const id = `bucket-medium`;
         const initialNode: LogicGameNode = { id, seedDifficulty: 100, order: 0, label: `Medium` };
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
    let cancelled = false;

    async function run() {
      // Show the buckets we already have while revalidating, so returning to this
      // tab is not a blank wait.
      if (cachedBuckets) {
        setNodes(cachedBuckets);
        setLoading(false);
      } else {
        setLoading(true);
      }
      setErr(null);
      setStatus(null);
      try {
        const pub = await listLogicGameNodes();
        if (cancelled) return;
        cachedBuckets = pub;

        if (pub.length === 0) {
          const id = `bucket-medium`;
          const initialNode: LogicGameNode = { id, seedDifficulty: 100, order: 0, label: `Medium` };
          await upsertLogicGameNode(initialNode);
          if (cancelled) return;
          setNodes([initialNode]);
        } else {
          setNodes(pub);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!selectedNodeId) {
        setQuestions([]);
        return;
      }
      // Straight from cache when we have already loaded this bucket — no spinner.
      const cached = bucketQuestionsCache.get(selectedNodeId);
      if (cached) {
        setQuestions(cached);
        setQuestionsLoading(false);
        setQuestionsProgress(null);
        return;
      }
      setQuestionsLoading(true);
      setQuestionsProgress({ completed: 0, total: 0 });
      try {
        const loaded = await loadLogicGameQuestionsWithProgress(selectedNodeId, (progress) => {
          if (!cancelled) setQuestionsProgress(progress);
        });
        if (cancelled) return;
        bucketQuestionsCache.set(selectedNodeId, loaded);
        setQuestions(loaded);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setQuestionsLoading(false);
          setQuestionsProgress(null);
        }
      }
    }

    run();
    return () => { cancelled = true; };
  }, [selectedNodeId]);

  
  const [questionsProgress, setQuestionsProgress] = useState<{ completed: number; total: number } | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editNodeLabel, setEditNodeLabel] = useState("");
  const [editNodeIq, setEditNodeIq] = useState("");

  async function saveNodeEdits(nodeId: string) {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return;
    
    const label = editNodeLabel.trim();
    const seedDifficulty = Number(editNodeIq.trim());
    if (!label || !Number.isFinite(seedDifficulty)) {
       setEditingNodeId(null);
       return;
    }

    setSaving(true);
    try {
      await upsertLogicGameNode({ ...n, label, seedDifficulty });
      setNodes((prev) =>
        prev
          .map((x) => (x.id === nodeId ? { ...x, label, seedDifficulty } : x))
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
      setStatus('✅ Bucket updated');
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
      const nextSeed = nodes.length > 0 ? (nodes[nodes.length - 1].seedDifficulty ?? 100) + 15 : 100;
      const id = `bucket-${Date.now().toString(36)}`;
      const node: LogicGameNode = { id, seedDifficulty: nextSeed, order: nextOrder, label: `Bucket ${nodes.length + 1}` };
      await upsertLogicGameNode(node);

      setNodes((prev) => {
        const next = prev.some((n) => n.id === node.id) ? prev : [...prev, node];
        return next.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      });
      setStatus('✅ Bucket added');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  

  

  async function deleteNode(nodeId: string) {
    if (!(await confirm('Delete this bucket and all its questions? This cannot be undone.'))) return;
    setSaving(true);
    try {
      await deleteLogicGameNode(nodeId);
      bucketQuestionsCache.delete(nodeId);
      cachedBuckets = null;
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      await load();
      setStatus('✅ Bucket deleted');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Live save progress, so a long "add all" is not a blank wait. Each question is
  // one request, so these counts are the real state of the save, not an estimate.
  const [saveProgress, setSaveProgress] = useState<LogicGameSaveProgress | null>(null);

  async function saveQuestionsList(newQuestions: LogicGameQuestion[], options?: { trackProgress?: boolean }): Promise<boolean> {
    if (!selectedNodeId) return false;
    setSaving(true);
    if (options?.trackProgress) setSaveProgress({ phase: 'preparing', completed: 0, total: newQuestions.length });
    try {
      await upsertLogicGameQuestions(selectedNodeId, {
        questions: newQuestions,
        updatedAt: new Date().toISOString()
      }, options?.trackProgress ? setSaveProgress : undefined);
      if (selectedNodeId) bucketQuestionsCache.set(selectedNodeId, newQuestions);
      setQuestions(newQuestions);
      setStatus('✅ Auto-saved');
      return true;
    } catch(e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
      if (options?.trackProgress) setSaveProgress(null);
    }
  }

  // The server already supports cancelling a run; it just had no way to be told
  // which one, because the job id was generated server-side and never sent back.
  // Minting it here means the client can address the job it started.
  const extractionJobIdRef = useRef<string | null>(null);
  const extractionAbortRef = useRef<AbortController | null>(null);
  const [cancellingExtraction, setCancellingExtraction] = useState(false);

  async function cancelExtraction() {
    const jobId = extractionJobIdRef.current;
    setCancellingExtraction(true);
    try {
      if (jobId) {
        const apiUrl = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim() || 'http://localhost:5000';
        // Tell the server first so it aborts the in-flight AI request, then stop
        // reading locally. Doing it the other way round would leave the run going.
        await fetch(`${apiUrl}/api/program-ingestion/extract-iq-pdf/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: 'POST',
        }).catch(() => { /* still abort locally below */ });
      }
    } finally {
      extractionAbortRef.current?.abort();
      setCancellingExtraction(false);
    }
  }

  async function handleExtractFromPdf() {
    if (!pdfFile) return;
    setPdfExtracting(true);
    setPdfError(null);
    setPdfProgress('📤 Uploading document & initializing AI engine…');
    setPdfStats({ totalPages: 0, currentPage: 0, totalQuestions: 0, elapsedSeconds: 0 });
    setPdfSteps([
      { icon: '📤', message: 'Uploading document & initializing AI engine…', detail: 'Sending PDF & answer key to server', done: false }
    ]);
    try {
      const apiUrl = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim() || 'http://localhost:5000';
      const jobId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? `iq-extract-${crypto.randomUUID()}`
        : `iq-extract-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      extractionJobIdRef.current = jobId;
      const abortController = new AbortController();
      extractionAbortRef.current = abortController;

      const formData = new FormData();
      formData.append('file', pdfFile);
      formData.append('jobId', jobId);
      if (answersFile) {
        formData.append('answersFile', answersFile);
      }

      const aiRes = await fetch(`${apiUrl}/api/program-ingestion/extract-iq-pdf`, {
        method: 'POST',
        body: formData,
        signal: abortController.signal,
      });

      if (!aiRes.ok || !aiRes.body) {
        const errText = await aiRes.text();
        throw new Error(`AI Extraction failed: ${errText}`);
      }

      // ── Read NDJSON stream line by line ──
      const reader = aiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resultData: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on newlines, keep last partial chunk in buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.progress) {
              const step = parsed.progress as { icon: string; message: string; detail: string; stats?: any };
              setPdfProgress(`${step.icon} ${step.message}`);
              if (step.stats) {
                setPdfStats(prev => ({
                  ...prev,
                  totalPages: step.stats.totalPages || prev.totalPages,
                  currentPage: step.stats.currentPage !== undefined ? step.stats.currentPage : prev.currentPage,
                  totalQuestions: step.stats.totalQuestions !== undefined ? step.stats.totalQuestions : prev.totalQuestions,
                }));
              }
              setPdfSteps(prev => [
                ...prev.map(s => ({ ...s, done: true })),          // mark all previous as done
                { icon: step.icon, message: step.message, detail: step.detail, done: false }, // new active step
              ]);
            } else if (parsed.result) {
              resultData = parsed.result;
            } else if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch (parseErr) {
            // If the entire line itself was thrown, re-throw; otherwise skip malformed lines
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected token') throw parseErr;
          }
        }
      }

      if (!resultData || !resultData.questions || resultData.questions.length === 0) {
        throw new Error('No questions could be found in this PDF.');
      }

      const formatted = resultData.questions.map((q: any, i: number) => {
        const blocks: any[] = q.promptBlocks || [];
        if (blocks.length === 0 && q.promptRawText) blocks.push({ type: 'text', text: q.promptRawText });

        return {
          id: `q_${Date.now()}_${i}`,
          promptBlocks: blocks,
          promptRawText: q.promptRawText || '',
          interaction: {
            type: 'mcq' as const,
            choices: q.interaction?.choices || [],
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
      void autoFillExtractedQuestionsDetails(formatted);
      setPdfError(null);
      setPdfProgress('');
      setPdfSteps([]);
      const answeredCount = formatted.filter((q: any) => q.interaction.correctChoiceIndex >= 0).length;
      if (answersFile && answeredCount > 0) {
        toast({ title: `✅ Extracted ${formatted.length} questions with ${answeredCount} answers pre-filled from answer key` });
      } else {
        toast({ title: `✅ Extracted ${formatted.length} questions` });
      }
    } catch (e) {
      // A cancel aborts the stream, which surfaces here as an AbortError. That is
      // an intentional stop, not a failure, so report it as such.
      const aborted = (e instanceof DOMException && e.name === 'AbortError')
        || (e instanceof Error && /abort/i.test(e.message));
      if (aborted) {
        setPdfError(null);
        setPdfProgress('');
        setPdfSteps([]);
        toast({ title: '🛑 Extraction cancelled' });
      } else {
        setPdfError(e instanceof Error ? e.message : String(e));
        setPdfProgress('');
        setPdfSteps(prev => prev.map(s => ({ ...s, done: true })));
      }
    } finally {
      setPdfExtracting(false);
      setCancellingExtraction(false);
      extractionAbortRef.current = null;
      extractionJobIdRef.current = null;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'center', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px' }}>
        {!selectedNodeId ? (
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }}>
            <h1 style={{ textAlign: 'center', color: 'white', margin: '0 0 20px 0', fontSize: 32, fontWeight: 900 }}>Question buckets</h1>
            {loading ? (
              // ── Loading skeleton: shows while Supabase data is still fetching ──
              <>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{
                    background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                    opacity: 1 - i * 0.25,
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ width: 140, height: 18, borderRadius: 6, background: 'rgba(255,255,255,0.08)' }} />
                      <div style={{ width: 100, height: 13, borderRadius: 6, background: 'rgba(255,255,255,0.05)' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ width: 64, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.05)' }} />
                      <div style={{ width: 64, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.05)' }} />
                    </div>
                  </div>
                ))}
                <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 4 }}>Loading buckets…</div>
              </>
            ) : (
              nodes.map((n) => (
              <div key={n.id} 
                   onClick={() => { if (editingNodeId !== n.id) setSelectedNodeId(n.id); }}
                   style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', cursor: editingNodeId === n.id ? 'default' : 'pointer', transition: 'all 0.2s' }}
                   onMouseEnter={(e) => { if (editingNodeId !== n.id) e.currentTarget.style.borderColor = '#a855f7'; }}
                   onMouseLeave={(e) => { if (editingNodeId !== n.id) e.currentTarget.style.borderColor = '#334155'; }}
              >
                {editingNodeId === n.id ? (
                  <div style={{ display: 'flex', gap: 16, flex: 1, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                       <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 'bold' }}>Bucket Name</label>
                       <input value={editNodeLabel} onChange={e => setEditNodeLabel(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 150 }}>
                       <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 'bold' }} title="Starting difficulty for new questions filed here. Each question then self-calibrates from how players actually do on it.">Starting difficulty</label>
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
                         Starting difficulty: <span style={{ color: '#d8b4fe', fontWeight: 'bold' }}>{n.seedDifficulty}</span>
                       </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="ll-btn" title="Edit Bucket" onClick={(e) => { e.stopPropagation(); setEditNodeLabel(n.label || ''); setEditNodeIq(String(n.seedDifficulty ?? 100)); setEditingNodeId(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.05)', color: 'white' }}>✎ Edit</button>
                      <button className="ll-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}>🗑 Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))
            )}
            
            <button
              onClick={addNode}
              disabled={saving || loading}
              className="ll-btn ll-btn-primary"
              style={{
                padding: '16px', fontSize: 15, fontWeight: 'bold', alignSelf: 'center',
                marginTop: 10, borderRadius: 12,
                opacity: loading ? 0.4 : 1,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.2s',
              }}
              title={loading ? 'Please wait while buckets are loading…' : undefined}
            >
              {loading ? '⏳ Loading buckets…' : '+ Add New Bucket'}
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
                <div style={{ color: '#94a3b8', textAlign: 'center', maxWidth: 420, margin: '0 auto' }} aria-live="polite">
                  {(() => {
                    const total = questionsProgress?.total ?? 0;
                    const completed = questionsProgress?.completed ?? 0;
                    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                    return (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 13 }}>
                          <span>{total > 0 ? `Loading question ${Math.min(completed + 1, total)} of ${total}…` : 'Counting questions…'}</span>
                          <span style={{ color: '#c4b5fd', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                        </div>
                        <div style={{ height: 8, background: '#0f172a', borderRadius: 999, overflow: 'hidden', border: '1px solid #334155' }}>
                          <div style={{
                            width: total > 0 ? `${pct}%` : '35%',
                            height: '100%', borderRadius: 999,
                            background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                            transition: 'width 0.25s ease-out',
                            animation: total > 0 ? 'none' : 'shimmer 1.2s infinite linear',
                          }} />
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
                          Questions with images take longer · this bucket is cached once loaded
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : questions.length === 0 ? (
                <div style={{ color: '#64748b', textAlign: 'center', marginTop: 40 }}>No questions in this bucket yet.</div>
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
                            onClick={async (e) => {
                              e.stopPropagation();
                              if(await confirm('Delete question?')) {
                                saveQuestionsList(questions.filter(x => x.id !== q.id));
                              }
                            }}
                            className="ll-btn" style={{ padding: '6px 10px', fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}
                          >
                            🗑 Delete
                          </button>
                        </div>
                      </div>
                      
                      {/* Rendered Math Preview */}
                      {(q.promptRawText || (q.promptBlocks?.[0] as any)?.text) && (
                        <div style={{ marginBottom: 16, padding: 14, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', fontSize: 15 }}>
                          <LatexMarkdown content={q.promptRawText || (q.promptBlocks?.[0] as any)?.text || ''} />
                        </div>
                      )}

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
                      {(q.promptBlocks?.filter(b => b.type === 'image').length || 0) > 0 && (
                         <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
                           {q.promptBlocks?.filter(b => b.type === 'image').map((imgBlock: any, imgIdx: number) => (
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
        const seedDifficulty = nodes.find(n => n.id === selectedNodeId)?.seedDifficulty ?? 100;
        const inputStyle: React.CSSProperties = { padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none', width: '100%', fontSize: 13 };
        const labelStyle: React.CSSProperties = { fontSize: 11, color: '#94a3b8', fontWeight: 'bold', marginBottom: 4 };
        const updateField = (field: string, value: any) => {
          const newQ = [...questions];
          (newQ[detailsQIndex] as any)[field] = value;
          setQuestions(newQ);
        };
        const updateChoiceExplanation = (choiceIndex: number, value: string) => {
          const newQ = [...questions];
          const target = newQ[detailsQIndex];
          if (target.interaction.type !== 'mcq') return;
          const nextExplanations = [...(target.interaction.choiceExplanations ?? target.interaction.choices.map(() => ''))];
          nextExplanations[choiceIndex] = value;
          target.interaction = { ...target.interaction, choiceExplanations: nextExplanations };
          setQuestions(newQ);
        };
        const toggleSecondaryMetric = (metric: CognitiveMetric) => {
          const current = dq.secondaryMetrics ?? [];
          if (current.includes(metric)) {
            updateField('secondaryMetrics', current.filter(m => m !== metric));
          } else if (current.length < 2) {
            updateField('secondaryMetrics', [...current, metric]);
          }
        };
        const saveAndClose = () => { saveQuestionsList(questions); setDetailsQIndex(null); };

        const askGroq = async () => {
          setDetailsGroqLoading(true);
          try {
            const apiUrl = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim() || 'http://localhost:3001';
            const promptText = dq.promptRawText || (dq.promptBlocks?.[0] as any)?.text || '';
            const choices = dq.interaction.type === 'mcq' ? dq.interaction.choices : [];
            const correctIdx = dq.interaction.type === 'mcq' ? dq.interaction.correctChoiceIndex : -1;
            const res = await fetch(`${apiUrl}/api/program-ingestion/iq-question-details`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ promptText, choices, correctChoiceIndex: correctIdx, nodeIq: seedDifficulty }),
            });
            if (!res.ok) throw new Error(`Failed: ${await res.text()}`);
            const data = await res.json();
            const newQ = [...questions];
            const target = newQ[detailsQIndex];
            // Difficulty and point values are no longer authored: a question seeds from
            // its bucket and then self-calibrates from how players actually do on it.
            if (data.explanation) target.explanation = data.explanation;
            if (data.primaryMetric) target.primaryMetric = data.primaryMetric;
            if (Array.isArray(data.secondaryMetrics)) target.secondaryMetrics = data.secondaryMetrics;
            if (target.interaction.type === 'mcq' && Array.isArray(data.choiceExplanations) && data.choiceExplanations.length > 0) {
              target.interaction = { ...target.interaction, choiceExplanations: data.choiceExplanations };
            }
            setQuestions(newQ);
            setStatus('✅ Explanation and cognitive metrics applied');
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
          } finally {
            setDetailsGroqLoading(false);
          }
        };

        return (
          <>
            <div onClick={() => saveAndClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: Z_NESTED_DIALOG_BACKDROP }} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: '#1e293b', borderRadius: 16, border: '1px solid #475569',
              zIndex: Z_NESTED_DIALOG_PANEL, width: 'min(600px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ color: 'white', margin: 0, fontSize: 16 }}>📊 Question {detailsQIndex + 1} — Details</h2>
                <button onClick={() => saveAndClose()} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24 }}>×</button>
              </div>
              <div style={{ padding: 20, overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Explanation */}
                <div>
                  <div style={labelStyle}>💡 Explanation (shown in chill mode)</div>
                  {dq.explanation && (
                    <div style={{ marginBottom: 12, padding: 14, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', fontSize: 14 }}>
                      <LatexMarkdown content={dq.explanation} />
                    </div>
                  )}
                  <textarea
                    value={dq.explanation || ''}
                    onChange={e => updateField('explanation', e.target.value)}
                    placeholder="Concise explanation of why the correct answer is correct..."
                    style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                  />
                </div>

                {/* Primary metric */}
                <div>
                  <div style={labelStyle}>🧠 Primary Metric (10pts)</div>
                  <select
                    value={dq.primaryMetric || ''}
                    onChange={e => updateField('primaryMetric', e.target.value || undefined)}
                    style={{ ...inputStyle, padding: '10px 14px' }}
                  >
                    <option value="">— None —</option>
                    {COGNITIVE_METRICS.map(m => (
                      <option key={m.slug} value={m.slug}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* Secondary metrics */}
                <div>
                  <div style={labelStyle}>🧠 Secondary Metrics (5pts each, up to 2)</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {COGNITIVE_METRICS.filter(m => m.slug !== dq.primaryMetric).map(m => {
                      const selected = (dq.secondaryMetrics ?? []).includes(m.slug);
                      return (
                        <button
                          key={m.slug}
                          onClick={() => toggleSecondaryMetric(m.slug)}
                          style={{
                            padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', cursor: 'pointer', fontFamily: 'inherit',
                            background: selected ? 'rgba(168,85,247,0.2)' : 'transparent',
                            border: `1px solid ${selected ? 'rgba(168,85,247,0.6)' : '#475569'}`,
                            color: selected ? '#c084fc' : '#94a3b8',
                          }}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Per-option explanations (MCQ only) */}
                {dq.interaction.type === 'mcq' && (
                  <div>
                    <div style={labelStyle}>💬 Per-option explanations</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dq.interaction.choices.map((choice, cIndex) => (
                        <div key={cIndex}>
                          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>
                            {String.fromCharCode(65 + cIndex)}{dq.interaction.type === 'mcq' && dq.interaction.correctChoiceIndex === cIndex ? ' (correct)' : ''}: {choice.slice(0, 60)}
                          </div>
                          <textarea
                            value={(dq.interaction.type === 'mcq' ? dq.interaction.choiceExplanations?.[cIndex] : '') || ''}
                            onChange={e => updateChoiceExplanation(cIndex, e.target.value)}
                            placeholder={`Why ${String.fromCharCode(65 + cIndex)} is right or wrong...`}
                            style={{ ...inputStyle, minHeight: 44, resize: 'vertical', fontSize: 12 }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
          <div onClick={() => !pdfExtracting && setAddModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: Z_DIALOG_BACKDROP }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 16, border: '1px solid #475569',
            zIndex: Z_DIALOG_PANEL, width: 'min(800px, 95vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: 'white', margin: 0, fontSize: 18 }}>Extract MCQs with AI Vision (Any Format)</h2>
              <button onClick={() => !pdfExtracting && setAddModalOpen(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 24 }}>×</button>
            </div>
            
            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              {/* File Uploads Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                {/* Questions File */}
                <div style={{ background: '#0f172a', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
                  <label style={{ display: 'block', color: '#a78bfa', fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>📄 Questions File (Any Format) *</label>
                  {!pdfFile ? (
                    <>
                      <input 
                        type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt,.text,.rtf,.ppt,.pptx,.csv,.epub,.xps,*/*" 
                        onChange={e => setPdfFile(e.target.files?.[0] || null)}
                        style={{ width: '100%', padding: 10, background: '#1e293b', borderRadius: 8, border: '1px solid #475569', color: 'white', fontSize: 13 }}
                      />
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>Upload your questions in any file format — PDF, Word (.docx), Images (.png/.jpg), or Text.</div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: '10px 16px', borderRadius: 8, border: '1px solid #475569' }}>
                      <div style={{ color: '#34d399', fontSize: 13, fontWeight: '500' }}>✓ {pdfFile.name} ({(pdfFile.size / 1024 / 1024).toFixed(1)} MB)</div>
                      <button onClick={() => setPdfFile(null)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>✕ Remove</button>
                    </div>
                  )}
                </div>

                {/* Answers File (Optional) */}
                <div style={{ background: '#0f172a', borderRadius: 12, padding: 16, border: '1px solid #334155' }}>
                  <label style={{ display: 'block', color: '#f59e0b', fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>📝 Answers File (Optional)</label>
                  {!answersFile ? (
                    <>
                      <input 
                        type="file" accept=".pdf,.txt,.text,.doc,.docx,.png,.jpg,.jpeg" 
                        onChange={e => setAnswersFile(e.target.files?.[0] || null)}
                        style={{ width: '100%', padding: 10, background: '#1e293b', borderRadius: 8, border: '1px solid #475569', color: 'white', fontSize: 13 }}
                      />
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>Upload an answer key file (any format — PDF, text, image). The AI will parse it automatically.</div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: '10px 16px', borderRadius: 8, border: '1px solid #475569' }}>
                      <div style={{ color: '#34d399', fontSize: 13, fontWeight: '500' }}>✓ {answersFile.name}</div>
                      <button onClick={() => setAnswersFile(null)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>✕ Remove</button>
                    </div>
                  )}
                </div>

                {/* Extract Button */}
                <button 
                  onClick={handleExtractFromPdf} 
                  disabled={!pdfFile || pdfExtracting}
                  className="ll-btn ll-btn-primary" 
                  style={{ padding: '14px 24px', fontWeight: 'bold', fontSize: 15, borderRadius: 10, width: '100%' }}
                >
                  {pdfExtracting ? '🔄 Extracting...' : '🚀 Extract MCQs with AI Vision'}
                </button>
              </div>

              {/* Premium Live AI Vision Extraction Dashboard */}
              {pdfExtracting && (
                <div style={{
                  padding: '22px',
                  background: 'linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(59,130,246,0.12) 100%)',
                  border: '1px solid rgba(168,85,247,0.35)',
                  borderRadius: 16,
                  marginBottom: 24,
                  boxShadow: '0 8px 32px rgba(168,85,247,0.15)',
                }}>
                  {/* Header & Elapsed Timer */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 20 }}>⚡</span>
                      <span style={{ color: '#f8fafc', fontWeight: 800, fontSize: 16, letterSpacing: '0.3px', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
                        AI Vision Processing Center
                      </span>
                      <button
                        onClick={() => void cancelExtraction()}
                        disabled={cancellingExtraction}
                        title="Stop this extraction. Nothing is saved."
                        style={{
                          marginLeft: 8, padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 800,
                          fontFamily: 'inherit',
                          background: 'rgba(239,68,68,0.15)', color: '#fca5a5',
                          border: '1px solid rgba(239,68,68,0.45)',
                          cursor: cancellingExtraction ? 'progress' : 'pointer',
                          opacity: cancellingExtraction ? 0.6 : 1,
                        }}
                      >
                        {cancellingExtraction ? 'Cancelling…' : '🛑 Cancel'}
                      </button>
                    </div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(0,0,0,0.4)',
                      padding: '6px 12px',
                      borderRadius: 20,
                      border: '1px solid rgba(255,255,255,0.15)',
                    }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', background: '#4ade80',
                        boxShadow: '0 0 8px #4ade80',
                        animation: 'pulse 1s infinite'
                      }} />
                      <span style={{ color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace', fontWeight: 'bold' }}>
                        {String(Math.floor(pdfStats.elapsedSeconds / 60)).padStart(2, '0')}:{String(pdfStats.elapsedSeconds % 60).padStart(2, '0')}s elapsed
                      </span>
                    </div>
                  </div>

                  {/* 3 Stats Boxes */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
                    <div style={{ background: 'rgba(0,0,0,0.35)', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>Pages Processed</div>
                      <div style={{ color: '#c4b5fd', fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                        {pdfStats.totalPages > 0 ? `${pdfStats.currentPage} / ${pdfStats.totalPages}` : 'Analyzing...'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.35)', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>MCQs Discovered</div>
                      <div style={{ color: '#38bdf8', fontSize: 18, fontWeight: 800, marginTop: 4 }}>
                        {pdfStats.totalQuestions} {pdfStats.totalQuestions === 1 ? 'Question' : 'Questions'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(0,0,0,0.35)', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                      <div style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>Current Phase</div>
                      <div style={{ color: '#4ade80', fontSize: 13, fontWeight: 800, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {pdfStats.totalPages > 0 && pdfStats.currentPage < pdfStats.totalPages ? `AI Vision (Pg ${pdfStats.currentPage || 1})` : pdfStats.totalPages > 0 ? 'Final Assembly' : 'Rasterizing PDF'}
                      </div>
                    </div>
                  </div>

                  {/* Animated Progress Bar */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#e2e8f0', fontWeight: 600, marginBottom: 8 }}>
                      <span>Pipeline Progress</span>
                      <span style={{ fontWeight: 800, color: '#c4b5fd' }}>
                        {pdfStats.totalPages === 0 ? Math.min(25, 5 + pdfStats.elapsedSeconds * 2) : Math.min(95, Math.round(25 + (pdfStats.currentPage / pdfStats.totalPages) * 65))}%
                      </span>
                    </div>
                    <div style={{ width: '100%', height: 10, background: 'rgba(0,0,0,0.5)', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <div style={{
                        height: '100%',
                        width: `${pdfStats.totalPages === 0 ? Math.min(25, 5 + pdfStats.elapsedSeconds * 2) : Math.min(95, Math.round(25 + (pdfStats.currentPage / pdfStats.totalPages) * 65))}%`,
                        background: 'linear-gradient(90deg, #a855f7, #3b82f6, #38bdf8)',
                        borderRadius: 10,
                        transition: 'width 0.5s ease-out',
                        boxShadow: '0 0 12px rgba(168,85,247,0.6)'
                      }} />
                    </div>
                  </div>

                  {/* Live Step Timeline */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    background: 'rgba(0,0,0,0.25)',
                    padding: '16px 18px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.06)',
                    maxHeight: '240px',
                    overflowY: 'auto'
                  }}>
                    {/* Newest first. The index is captured before reversing so React
                        keys stay stable as steps are appended. */}
                    {pdfSteps.map((step, i) => ({ step, i })).reverse().map(({ step, i }) => (
                      <div key={i} style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        opacity: step.done ? 0.6 : 1,
                        transition: 'opacity 0.3s',
                      }}>
                        {/* Status icon */}
                        <div style={{ width: 22, height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                          {step.done ? (
                            <span style={{ color: '#4ade80', fontSize: 15, fontWeight: 'bold' }}>✓</span>
                          ) : (
                            <span style={{
                              display: 'inline-block',
                              width: 16, height: 16,
                              border: '2.5px solid #38bdf8',
                              borderTopColor: 'transparent',
                              borderRadius: '50%',
                              animation: 'spin 0.7s linear infinite',
                            }} />
                          )}
                        </div>
                        {/* Step content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 14,
                            fontWeight: step.done ? 500 : 700,
                            color: step.done ? '#94a3b8' : '#f8fafc',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                          }}>
                            <span>{step.icon}</span>
                            <span>{step.message}</span>
                            {!step.done && (
                              <span style={{
                                fontSize: 10,
                                background: 'rgba(56,189,248,0.15)',
                                color: '#38bdf8',
                                padding: '2px 8px',
                                borderRadius: 10,
                                border: '1px solid rgba(56,189,248,0.4)',
                                marginLeft: 'auto',
                                fontWeight: 800,
                                letterSpacing: '0.5px'
                              }}>ACTIVE</span>
                            )}
                          </div>
                          {step.detail && (
                            <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{step.detail}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ textAlign: 'center', margin: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                 <div style={{ color: '#94a3b8', fontSize: 12 }}>— OR —</div>
                 <div style={{ display: 'flex', gap: 12 }}>
                   <button onClick={() => {
                      const newQ: any = {
                         id: `manual_${Date.now()}`,
                         promptRawText: '',
                         promptBlocks: [{ type: 'text', text: '' }],
                         interaction: { type: 'mcq', choices: ['', '', '', '', ''], correctChoiceIndex: 0 },
                         timeLimitSec: 0, iqDeltaCorrect: 0, iqDeltaWrong: 0
                      };
                      setExtractedQuestions([...(extractedQuestions || []), newQ]);
                   }} className="ll-btn" style={{ background: '#334155', color: 'white', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold' }}>
                      + Add Question Manually
                   </button>
                   
                   <label className="ll-btn" style={{ background: '#334155', color: 'white', padding: '10px 20px', borderRadius: 8, fontWeight: 'bold', cursor: 'pointer', display: 'inline-block' }}>
                     JSON Import
                     <input 
                       type="file" 
                       accept=".json" 
                       style={{ display: 'none' }}
                       onChange={(e) => {
                         const file = e.target.files?.[0];
                         if (file) {
                           const reader = new FileReader();
                           reader.onload = (ev) => {
                             try {
                               const content = ev.target?.result as string;
                               const parsed = JSON.parse(content);
                               if (Array.isArray(parsed)) {
                                 setExtractedQuestions([...(extractedQuestions || []), ...parsed]);
                               } else {
                                 alert("JSON must be an array of questions.");
                               }
                             } catch (err) {
                               alert("Failed to parse JSON file.");
                             }
                           };
                           reader.readAsText(file);
                         }
                         e.target.value = ''; // Reset input
                       }}
                     />
                   </label>
                 </div>
              </div>

              {pdfError && (
                 <div style={{ padding: 16, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', borderRadius: 8, marginBottom: 20, border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                    {pdfError}
                 </div>
              )}

              {extractedQuestions && extractedQuestions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0' }}>
                    <div>
                      <h3 style={{ color: 'white', margin: 0 }}>Review Questions ({extractedQuestions.length})</h3>
                      <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 4 }}>
                        ⚠️ Please review all questions and select the correct answer for each by clicking the letter circle.
                      </div>
                      {extractedDetailsFilling && (
                        <div style={{ color: '#c084fc', fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          🤖 Auto-filling explanations & cognitive metrics — {extractedDetailsProgress?.completed ?? 0}/{extractedDetailsProgress?.total ?? 0}…
                          <button
                            onClick={() => { extractedDetailsCancelRef.current = true; }}
                            className="ll-btn"
                            style={{ padding: '2px 8px', fontSize: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={async () => {
                        if (await confirm('Are you sure you want to delete ALL extracted questions?')) {
                          setExtractedQuestions(null);
                        }
                      }}
                      className="ll-btn"
                      style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 'bold', fontSize: 13, flexShrink: 0 }}
                    >
                      🗑 Delete All ({extractedQuestions.length})
                    </button>
                  </div>
                  
                   {extractedQuestions.map((q, qIndex) => (
                     <div key={qIndex} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: 16, position: 'relative' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                         <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                           <div style={{ fontWeight: 'bold', color: '#f1f5f9', fontSize: 16 }}>
                             Q{q.questionNumber || qIndex + 1}
                           </div>
                           {(q as any).reviewStatus === 'FLAGGED_FOR_REVIEW' ? (
                             <span style={{ background: 'rgba(245,158,11,0.15)', color: '#fcd34d', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 'bold', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                               ⚠️ AI Flagged
                             </span>
                           ) : (
                             <span style={{ background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', padding: '4px 8px', borderRadius: 4, fontSize: 12, fontWeight: 'bold', border: '1px solid rgba(16,185,129,0.3)' }}>
                               ✓ AI Verified
                             </span>
                           )}
                           {((q as any).flags || []).map((flag: string, fi: number) => (
                             <span key={fi} style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', padding: '4px 8px', borderRadius: 4, fontSize: 11, border: '1px solid rgba(239,68,68,0.2)' }}>
                               {flag.replace(/_/g, ' ')}
                             </span>
                           ))}
                         </div>
                         <button 
                            onClick={async () => {
                              if(await confirm('Delete question?')) {
                                setExtractedQuestions((extractedQuestions || []).filter((_, i) => i !== qIndex));
                              }
                            }}
                            style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 'bold', flexShrink: 0 }}
                         >🗑 Delete</button>
                       </div>
                       
                       {/* Rendered Math Preview */}
                       {(q.promptRawText || (q.promptBlocks?.[0] as any)?.text) && (
                         <div style={{ marginBottom: 12, padding: 14, borderRadius: 8, background: '#1e293b', border: '1px solid #334155', color: '#f8fafc', fontSize: 14, marginTop: 24 }}>
                           <LatexMarkdown content={q.promptRawText || (q.promptBlocks?.[0] as any)?.text || ''} />
                         </div>
                       )}

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
                         {(q as any).imageUrl && (
                           <div style={{ position: 'relative' }}>
                             <img src={(q as any).imageUrl} style={{ maxWidth: 300, maxHeight: 200, borderRadius: 8, border: '1px solid #475569' }} />
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
                  <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                    <button
                      onClick={async () => {
                        if (await confirm('Are you sure you want to delete ALL extracted questions?')) {
                          setExtractedQuestions(null);
                        }
                      }}
                      className="ll-btn"
                      style={{ padding: '14px 20px', fontSize: 15, fontWeight: 'bold', background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 8, cursor: 'pointer' }}
                    >
                      🗑 Delete All ({extractedQuestions.length})
                    </button>
                    <button 
                      onClick={async () => {
                        // Check if any question is missing a correct answer
                        const missingAns = extractedQuestions.some(q => q.interaction.type === 'mcq' && q.interaction.correctChoiceIndex < 0);
                        if (missingAns) {
                           if (!(await confirm("Some questions do not have a correct answer selected. Add them anyway?"))) return;
                        }

                        const success = await saveQuestionsList([...questions, ...extractedQuestions], { trackProgress: true });
                        if (success) {
                          setAddModalOpen(false);
                          setExtractedQuestions(null);
                          setPdfFile(null);
                          setAnswersFile(null);
                          setPdfProgress('');
                        }
                      }} 
                      className="ll-btn ll-btn-primary"
                      disabled={saving || extractedDetailsFilling}
                      style={{ padding: '14px', fontSize: 15, fontWeight: 'bold', flex: 1, opacity: (saving || extractedDetailsFilling) ? 0.7 : 1, cursor: (saving || extractedDetailsFilling) ? 'progress' : 'pointer' }}
                    >
                      {saving && saveProgress ? 'Saving…' : extractedDetailsFilling ? 'Filling details before adding…' : `Add All ${extractedQuestions.length} Questions to Bucket`}
                    </button>
                  </div>

                  {/* Real save progress. Each question is one request, so this bar
                      tracks actual completed writes rather than a timed animation. */}
                  {saveProgress && (() => {
                    const total = Math.max(1, saveProgress.total);
                    const pct = saveProgress.phase === 'done'
                      ? 100
                      : Math.round((saveProgress.completed / total) * 100);
                    const label =
                      saveProgress.phase === 'preparing' ? 'Checking which questions already exist…'
                      : saveProgress.phase === 'saving' ? `Saving question ${Math.min(saveProgress.completed + 1, saveProgress.total)} of ${saveProgress.total}`
                      : saveProgress.phase === 'removing' ? 'Removing questions you deleted…'
                      : 'Finishing up…';
                    return (
                      <div style={{ marginTop: 14 }} aria-live="polite">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                          <span style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700 }}>{label}</span>
                          <span style={{ color: '#c4b5fd', fontSize: 12, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                        </div>
                        <div style={{ height: 8, background: '#0f172a', borderRadius: 999, overflow: 'hidden', border: '1px solid #334155' }}>
                          <div style={{
                            width: `${pct}%`, height: '100%', borderRadius: 999,
                            background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                            transition: 'width 0.25s ease-out',
                          }} />
                        </div>
                        {saveProgress.phase === 'saving' && saveProgress.total > 0 && (
                          <div style={{ color: '#64748b', fontSize: 11, marginTop: 6 }}>
                            {saveProgress.total - saveProgress.completed} left · questions with images upload more slowly
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── ImpersonateModal ───────────────────────────────────────────────────────
function ImpersonateModal({
  target, impersonating, error, onConfirm, onCancel,
}: {
  target: UserData & { uid: string };
  impersonating: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const displayName = [target.firstName, target.lastName].filter(Boolean).join(' ') || target.username || target.email;
  const roleColor = ROLE_COLORS[target.role as UserRole] ?? '#94a3b8';
  const roleLabel = ROLE_LABELS[target.role as UserRole] ?? target.role;
  const roleIcon = target.role === 'student' ? '🎓' : target.role === 'teacher' ? '🧑‍🏫' : target.role === 'admin' ? '🛡️' : target.role === 'parent' ? '👨‍👩‍👧' : '👤';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        padding: 16,
      }}
      onClick={() => { if (!impersonating) onCancel(); }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(460px, 94vw)',
          background: 'linear-gradient(145deg, #0f172a, #1e1b4b)',
          border: '1px solid rgba(168,85,247,0.35)',
          borderRadius: 20,
          boxShadow: '0 40px 100px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(168,85,247,0.2)',
          background: 'rgba(168,85,247,0.08)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>
            👑
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#f1f5f9' }}>Login as User</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Super Admin Impersonation</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* User card */}
          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14, padding: '16px 18px',
            display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18,
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12, flexShrink: 0,
              background: `linear-gradient(135deg, ${roleColor}33, ${roleColor}11)`,
              border: `1px solid ${roleColor}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}>
              {roleIcon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {target.email}
              </div>
            </div>
            <div style={{
              padding: '4px 10px', borderRadius: 20,
              background: `${roleColor}22`, border: `1px solid ${roleColor}55`,
              color: roleColor, fontSize: 11, fontWeight: 700, flexShrink: 0,
            }}>
              {roleLabel}
            </div>
          </div>

          {/* Warning */}
          <div style={{
            background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)',
            borderRadius: 10, padding: '12px 14px',
            display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 22,
          }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <span style={{ fontSize: 12, color: '#fbbf24', lineHeight: 1.5 }}>
              You will be temporarily logged into <strong>{target.username || displayName}</strong>'s account.
              A <strong>"Back to Super Admin"</strong> button will appear in the sidebar to return.
            </span>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 16,
              color: '#fca5a5', fontSize: 12,
            }}>
              ❌ {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onCancel}
              disabled={impersonating}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)',
                color: '#94a3b8', fontFamily: 'inherit',
                fontWeight: 600, fontSize: 13, cursor: impersonating ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={impersonating}
              style={{
                flex: 2, padding: '12px 0', borderRadius: 10,
                border: '1px solid rgba(168,85,247,0.5)',
                background: impersonating ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.25)',
                color: '#c084fc', fontFamily: 'inherit',
                fontWeight: 700, fontSize: 13, cursor: impersonating ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {impersonating ? '⏳ Logging in…' : `🔑 Login as ${target.username || target.firstName}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ProgramsAdmin has been moved to @/components/superadmin/ProgramsAdmin.tsx
// It is imported above as ProgramsAdminComponent.
