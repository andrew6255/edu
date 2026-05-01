import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { requireSupabase, getAdminClient } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMyTeachers,
  listClassesForTeacher,
  createClass,
  updateClass,
  deleteClass,
  listClassMembers,
  addClassMember,
  removeClassMember,
  getProfilesByRole,
  listClassContent,
  createClassContent,
  updateClassContent,
  toggleClassContentStatus,
  softDeleteClassContent,
  listAllUsersForTeacher,
  removeUserFromAllTeacherClasses,
  type ClassRow,
  type ClassMemberRow,
  type TeacherInfo,
  type ClassContentRow,
  type ContentType,
  type TeacherUserRow,
} from '@/lib/adminService';
import { getClassLeaderboard, type ClassLeaderboardEntry } from '@/lib/statsService';
import { adminUpdateEconomy, adminGetStudentEconomy, createUserDataAdmin, isUsernameTaken, type EconomyDeltas } from '@/lib/userService';
import { listFreeformReviewsForUsers, type FreeformReviewRow } from '@/lib/freeformReviewService';

type Tab = 'users' | 'classes';

const COLOR = '#f59e0b';
const COLOR_DIM = '#f59e0b55';

function makeClassId() {
  return 'cls_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

const cardStyle: React.CSSProperties = {
  background: '#1e293b', borderRadius: 10, border: '1px solid #334155', overflow: 'hidden',
};
const headerBtnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
  background: 'transparent', border: '1px solid #334155', color: '#94a3b8', cursor: 'pointer',
};
const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 5, fontSize: 10, fontWeight: 'bold',
  background: active ? `${COLOR}22` : 'transparent',
  border: `1px solid ${active ? COLOR_DIM : '#33415555'}`,
  color: active ? COLOR : '#64748b',
});
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 13px', marginBottom: 12, borderRadius: 8,
  border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white',
  boxSizing: 'border-box' as const, fontSize: 14, fontFamily: 'inherit', outline: 'none',
};

export default function AdminPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();

  const [teachers, setTeachers] = useState<TeacherInfo[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('classes');

  // users for selected teacher
  const [teacherUsers, setTeacherUsers] = useState<TeacherUserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // classes for selected teacher
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);

  // class detail
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [members, setMembers] = useState<ClassMemberRow[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Map<string, TeacherInfo>>(new Map());
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [creating, setCreating] = useState(false);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberRole, setAddMemberRole] = useState<'student' | 'teacher_assistant'>('student');
  const [candidateProfiles, setCandidateProfiles] = useState<TeacherInfo[]>([]);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  // which class to add to (from users tab)
  const [addToClassId, setAddToClassId] = useState<string | null>(null);

  const [classDetailTab, setClassDetailTab] = useState<'members' | 'content' | 'programs' | 'stats' | 'freeformReview'>('members');

  const [leaderboard, setLeaderboard] = useState<ClassLeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);

  const [freeformReviews, setFreeformReviews] = useState<FreeformReviewRow[]>([]);
  const [loadingFreeformReviews, setLoadingFreeformReviews] = useState(false);

  const [contentItems, setContentItems] = useState<ClassContentRow[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentFilter, setContentFilter] = useState<ContentType | 'all'>('all');

  const [showCreateContent, setShowCreateContent] = useState(false);
  const [newContentType, setNewContentType] = useState<ContentType>('assignment');
  const [newContentTitle, setNewContentTitle] = useState('');
  const [newContentSubject, setNewContentSubject] = useState('mathematics');
  const [newContentTimeLimit, setNewContentTimeLimit] = useState('');
  const [creatingContent, setCreatingContent] = useState(false);

  const [editingContent, setEditingContent] = useState<ClassContentRow | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editQuestions, setEditQuestions] = useState('');
  const [editTimeLimit, setEditTimeLimit] = useState('');
  const [savingContent, setSavingContent] = useState(false);

  // Economy modal
  const [econModal, setEconModal] = useState<{ uid: string; name: string; goldDelta: string; xpDelta: string; energyDelta: string; streakDelta: string; current: { gold: number; global_xp: number; energy: number; streak: number } | null } | null>(null);
  const [applyingEcon, setApplyingEcon] = useState(false);

  // Assign TA to class modal
  const [assignTaModal, setAssignTaModal] = useState<{ userId: string; userName: string; initialClassIds: string[] } | null>(null);
  const [assignTaSelected, setAssignTaSelected] = useState<Set<string>>(new Set());
  const [assigningTa, setAssigningTa] = useState(false);

  // Create TA modal
  const [createTaModal, setCreateTaModal] = useState(false);
  const [taFname, setTaFname] = useState('');
  const [taLname, setTaLname] = useState('');
  const [taUsername, setTaUsername] = useState('');
  const [taEmail, setTaEmail] = useState('');
  const [taPass, setTaPass] = useState('');
  const [taError, setTaError] = useState('');
  const [creatingTa, setCreatingTa] = useState(false);

  // redirect guard
  useEffect(() => {
    if (!loading && !user) setLocation('/auth');
    if (!loading && userData && userData.role !== 'admin') setLocation('/auth');
  }, [user, userData, loading]);

  useEffect(() => {
    if (!loading && user && userData?.role === 'admin') loadTeachers();
  }, [loading, user, userData]);

  async function loadTeachers() {
    setLoadingData(true);
    setLoadError(null);
    try {
      const t = await getMyTeachers();
      setTeachers(t);
      if (t.length > 0 && !selectedTeacherId) setSelectedTeacherId(t[0].id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Admin load failed:', e);
      setLoadError(msg);
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => {
    if (selectedTeacherId) loadTeacherData(selectedTeacherId);
  }, [selectedTeacherId]);

  async function loadTeacherData(teacherId: string) {
    setLoadingClasses(true);
    setLoadingUsers(true);
    setSelectedClassId(null);
    try {
      const [c, u, allTAs] = await Promise.all([
        listClassesForTeacher(teacherId),
        listAllUsersForTeacher(teacherId),
        getProfilesByRole('teacher_assistant'),
      ]);
      // Merge unassigned TAs into the user list
      const assignedIds = new Set(u.map(x => x.user_id));
      const unassignedTAs: typeof u = allTAs
        .filter(ta => !assignedIds.has(ta.id))
        .map(ta => ({
          user_id: ta.id,
          username: ta.username,
          first_name: ta.first_name,
          last_name: ta.last_name,
          email: ta.email,
          role: 'teacher_assistant' as const,
          class_ids: [],
          class_names: [],
        }));
      setClasses(c);
      setTeacherUsers([...u, ...unassignedTAs]);
    } catch (e) { console.error('Failed to load teacher data:', e); }
    finally { setLoadingClasses(false); setLoadingUsers(false); }
  }

  async function refreshTeacherData() {
    if (selectedTeacherId) await loadTeacherData(selectedTeacherId);
  }

  async function openClass(classId: string) {
    setSelectedClassId(classId);
    setClassDetailTab('members');
    setLoadingMembers(true);
    setLoadingContent(true);
    setLeaderboard([]);
    setFreeformReviews([]);
    try {
      const [m, cc] = await Promise.all([listClassMembers(classId), listClassContent(classId)]);
      setMembers(m);
      setContentItems(cc);
      if (m.length > 0) {
        const supabase = requireSupabase();
        const ids = m.map(r => r.user_id);
        const { data } = await supabase.from('profiles').select('id, username, first_name, last_name, email').in('id', ids);
        const map = new Map<string, TeacherInfo>();
        (data ?? []).forEach((p: Record<string, unknown>) => {
          map.set(String(p.id), { id: String(p.id), username: String(p.username ?? ''), first_name: String(p.first_name ?? ''), last_name: String(p.last_name ?? ''), email: String(p.email ?? '') });
        });
        setMemberProfiles(map);
      } else { setMemberProfiles(new Map()); }
    } catch (e) { console.error('Failed to load class:', e); }
    finally { setLoadingMembers(false); setLoadingContent(false); }
  }

  async function refreshContent() {
    if (!selectedClassId) return;
    setLoadingContent(true);
    try { setContentItems(await listClassContent(selectedClassId)); } catch (e) { console.error(e); }
    finally { setLoadingContent(false); }
  }

  async function handleCreateContent() {
    if (!selectedClassId || !newContentTitle.trim()) return;
    setCreatingContent(true);
    try {
      const id = 'cc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      await createClassContent({ id, class_id: selectedClassId, content_type: newContentType, title: newContentTitle.trim(), subject: newContentSubject, time_limit_minutes: newContentType === 'quiz' && newContentTimeLimit ? parseInt(newContentTimeLimit, 10) : null, created_by: user?.uid });
      setShowCreateContent(false); setNewContentTitle(''); setNewContentTimeLimit('');
      await refreshContent();
    } catch (e) { window.alert('Failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setCreatingContent(false); }
  }

  function openContentEditor(item: ClassContentRow) {
    setEditingContent(item); setEditTitle(item.title); setEditSubject(item.subject);
    setEditTimeLimit(item.time_limit_minutes != null ? String(item.time_limit_minutes) : '');
    try { setEditQuestions(item.questions ? JSON.stringify(item.questions, null, 2) : '[\n  \n]'); } catch { setEditQuestions('[]'); }
  }

  async function handleSaveContent() {
    if (!editingContent) return;
    setSavingContent(true);
    try {
      let parsedQ: unknown = null;
      if (editingContent.content_type !== 'program') {
        try { parsedQ = JSON.parse(editQuestions); } catch { window.alert('Invalid JSON.'); setSavingContent(false); return; }
      }
      await updateClassContent(editingContent.id, {
        title: editTitle.trim() || editingContent.title, subject: editSubject || editingContent.subject,
        ...(editingContent.content_type !== 'program' ? { questions: parsedQ } : {}),
        ...(editingContent.content_type === 'quiz' ? { time_limit_minutes: editTimeLimit ? parseInt(editTimeLimit, 10) : null } : {}),
      });
      setEditingContent(null); await refreshContent();
    } catch (e) { window.alert('Save failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setSavingContent(false); }
  }

  async function handleTogglePublish(item: ClassContentRow) {
    const next = item.status === 'draft' ? 'published' : 'draft';
    if (next === 'published' && !window.confirm(`Publish "${item.title}"?`)) return;
    try { await toggleClassContentStatus(item.id, next); setContentItems(prev => prev.map(c => c.id === item.id ? { ...c, status: next } : c)); }
    catch (e) { window.alert('Failed: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function handleDeleteContent(item: ClassContentRow) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    try { await softDeleteClassContent(item.id); setContentItems(prev => prev.filter(c => c.id !== item.id)); }
    catch (e) { window.alert('Failed: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function handleCreateClass() {
    if (!newClassName.trim() || !selectedTeacherId) return;
    setCreating(true);
    try {
      await createClass(makeClassId(), newClassName.trim(), selectedTeacherId);
      setShowCreate(false); setNewClassName(''); await refreshTeacherData();
    } catch (e) { window.alert('Failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setCreating(false); }
  }

  async function handleRename(classId: string) {
    if (!renameValue.trim()) return;
    try { await updateClass(classId, renameValue.trim()); setClasses(prev => prev.map(c => c.id === classId ? { ...c, name: renameValue.trim() } : c)); setRenaming(null); }
    catch (e) { window.alert('Rename failed: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function handleDeleteClass(classId: string) {
    if (!window.confirm('Delete this class and all its content?')) return;
    try { await deleteClass(classId); if (selectedClassId === classId) setSelectedClassId(null); await refreshTeacherData(); }
    catch (e) { window.alert('Delete failed: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function openAddMember(classId?: string) {
    setShowAddMember(true); setAddMemberSearch(''); setAddMemberRole('student');
    setAddToClassId(classId || selectedClassId || (classes.length > 0 ? classes[0].id : null));
    try {
      const [students, tas] = await Promise.all([getProfilesByRole('student'), getProfilesByRole('teacher_assistant')]);
      setCandidateProfiles([...students, ...tas]);
    } catch (e) { console.error('Failed to load candidates:', e); }
  }

  async function handleAddMember(userId: string) {
    const targetClassId = addToClassId || selectedClassId;
    if (!targetClassId) return;
    setAddingMember(true);
    try {
      await addClassMember(targetClassId, userId, addMemberRole);
      if (selectedClassId) await openClass(selectedClassId);
      await refreshTeacherData();
    } catch (e) { window.alert('Failed: ' + (e instanceof Error ? e.message : String(e))); }
    finally { setAddingMember(false); }
  }

  async function handleRemoveMember(userId: string) {
    if (!selectedClassId || !window.confirm('Remove this member?')) return;
    try { await removeClassMember(selectedClassId, userId); setMembers(prev => prev.filter(m => m.user_id !== userId)); await refreshTeacherData(); }
    catch (e) { window.alert('Remove failed: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function handleRemoveUserFromTeacher(u: TeacherUserRow) {
    if (!selectedTeacherId || !window.confirm(`Remove ${u.username} from all classes?`)) return;
    try { await removeUserFromAllTeacherClasses(selectedTeacherId, u.user_id); await refreshTeacherData(); }
    catch (e) { window.alert('Failed: ' + (e instanceof Error ? e.message : String(e))); }
  }

  async function handleCreateTa() {
    if (!taFname || !taLname || !taUsername || !taEmail || !taPass) { setTaError('Please fill in all fields.'); return; }
    if (taPass.length < 6) { setTaError('Password must be at least 6 characters.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(taUsername)) { setTaError('Username can only contain letters, numbers and underscores.'); return; }
    setCreatingTa(true); setTaError('');
    try {
      const taken = await isUsernameTaken(taUsername.toLowerCase());
      if (taken) { setTaError('Username is already taken.'); return; }
      const admin = getAdminClient();
      const { data, error } = await admin.auth.admin.createUser({
        email: taEmail, password: taPass, email_confirm: true,
        user_metadata: { full_name: `${taFname} ${taLname}`.trim(), name: taUsername },
      });
      if (error) throw error;
      const authUser = data.user;
      if (!authUser) throw new Error('No user returned.');
      await createUserDataAdmin(authUser.id, {
        firstName: taFname, lastName: taLname, username: taUsername.toLowerCase(), email: taEmail,
        role: 'teacher_assistant', onboardingComplete: true,
      });
      setCreateTaModal(false);
      setTaFname(''); setTaLname(''); setTaUsername(''); setTaEmail(''); setTaPass(''); setTaError('');
      await refreshTeacherData();
    } catch (e: any) {
      setTaError(e.message || 'Failed to create TA account.');
    } finally { setCreatingTa(false); }
  }

  const selectedClass = classes.find(c => c.id === selectedClassId);
  const selectedTeacher = teachers.find(t => t.id === selectedTeacherId);
  const filteredUsers = teacherUsers.filter(u => {
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.first_name.toLowerCase().includes(q);
  });

  if (loading || loadingData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}><div style={{ fontSize: 40, marginBottom: 12 }}>🛡️</div><div>Loading admin panel...</div></div>
      </div>
    );
  }

  if (teachers.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#64748b', maxWidth: 400, padding: 20 }}>
          {loadError && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 12, textAlign: 'left' }}>{loadError}</div>}
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛡️</div>
          <h2 style={{ color: 'white', margin: '0 0 8px' }}>No Teachers Assigned</h2>
          <p style={{ fontSize: 13 }}>Ask the Super Admin to assign teachers to your account.</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button onClick={loadTeachers} style={headerBtnStyle}>↺ Refresh</button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }} style={{ ...headerBtnStyle, border: '1px solid #ef4444', color: '#f87171' }}>Sign Out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '13px 18px', background: '#1e293b', borderBottom: `2px solid ${COLOR_DIM}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, color: 'white', fontSize: 19, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: COLOR }}>🛡️</span> Admin
              <span style={{ fontSize: 11, background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, borderRadius: 6, padding: '2px 8px', fontWeight: 'normal' }}>{userData?.username || 'admin'}</span>
            </h2>
            <select value={selectedTeacherId || ''} onChange={e => setSelectedTeacherId(e.target.value)}
              style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${COLOR_DIM}`, background: '#0f172a', color: '#10b981', fontFamily: 'inherit', fontSize: 12, fontWeight: 'bold', cursor: 'pointer', outline: 'none' }}>
              {teachers.map(t => <option key={t.id} value={t.id}>📖 {t.username || `${t.first_name} ${t.last_name}`}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={refreshTeacherData} style={headerBtnStyle}>↺ Refresh</button>
            <button onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
              style={{ ...headerBtnStyle, border: '1px solid #ef4444', color: '#f87171' }}>Sign Out</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([{ id: 'users' as Tab, icon: '👥', label: `Users (${teacherUsers.length})` }, { id: 'classes' as Tab, icon: '🏫', label: `Classes (${classes.length})` }]).map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setSelectedClassId(null); }} style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit',
              background: tab === t.id ? `${COLOR}33` : 'transparent', border: `1px solid ${tab === t.id ? COLOR_DIM : 'transparent'}`,
              color: tab === t.id ? COLOR : '#64748b', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {loadError && <div style={{ padding: '10px 14px', marginBottom: 12, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 12 }}>{loadError}</div>}

        {/* ── USERS TAB ── */}
        {tab === 'users' && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search users..." style={{ ...inputStyle, marginBottom: 0, flex: 1 }} />
              <button onClick={() => openAddMember()} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Add User</button>
              <button onClick={() => setCreateTaModal(true)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.4)', color: '#06b6d4', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Create TA</button>
            </div>
            {loadingUsers ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading users...</div> :
            filteredUsers.length === 0 ? <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}><div style={{ fontSize: 30, marginBottom: 8 }}>👥</div><div>No students or TAs for this teacher yet.</div></div> :
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filteredUsers.map(u => {
                const rp = u.role === 'teacher_assistant' ? { label: 'TA', color: '#06b6d4' } : { label: 'Student', color: '#3b82f6' };
                return (
                  <div key={u.user_id} style={{ ...cardStyle, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: `hsl(${(u.username.charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: 13 }}>
                        {(u.username[0] || '?').toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{u.username || `${u.first_name} ${u.last_name}`}</div>
                        <div style={{ color: '#64748b', fontSize: 11, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {u.email} <span style={{ color: '#475569' }}>·</span>
                          {u.class_names.map((cn, i) => <span key={i} style={{ background: '#0f172a', padding: '0 5px', borderRadius: 3, fontSize: 10 }}>{cn}</span>)}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5, background: `${rp.color}22`, border: `1px solid ${rp.color}55`, color: rp.color }}>{rp.label}</span>
                      {u.role === 'teacher_assistant' && (
                        <button onClick={() => { setAssignTaModal({ userId: u.user_id, userName: u.username || u.first_name, initialClassIds: u.class_ids }); setAssignTaSelected(new Set(u.class_ids)); }}
                          style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)', color: '#06b6d4', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                          + Class
                        </button>
                      )}
                      {u.role === 'student' && (
                        <button onClick={async () => {
                          const cur = await adminGetStudentEconomy(u.user_id);
                          setEconModal({ uid: u.user_id, name: u.username || u.first_name, goldDelta: '', xpDelta: '', energyDelta: '', streakDelta: '', current: cur });
                        }} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', cursor: 'pointer', fontFamily: 'inherit' }}>
                          ✏️
                        </button>
                      )}
                      <button onClick={() => handleRemoveUserFromTeacher(u)} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}>✗</button>
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>
        )}

        {/* ── CLASSES LIST ── */}
        {tab === 'classes' && !selectedClassId && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ color: '#94a3b8', fontSize: 13 }}>{classes.length} classes for {selectedTeacher?.username || 'teacher'}</div>
              <button onClick={() => setShowCreate(true)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, cursor: 'pointer' }}>+ New Class</button>
            </div>
            {loadingClasses ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading...</div> :
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {classes.map(c => {
                const isR = renaming === c.id;
                return (
                  <div key={c.id} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 22, flexShrink: 0 }}>🏫</div>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      {isR ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRename(c.id)} autoFocus
                            style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid #475569', background: '#0f172a', color: 'white', fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
                          <button onClick={() => handleRename(c.id)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11, color: '#10b981', border: '1px solid #10b98155' }}>✓</button>
                          <button onClick={() => setRenaming(null)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11 }}>✗</button>
                        </div>
                      ) : (<>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{c.name}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>Created {new Date(c.created_at).toLocaleDateString()}</div>
                      </>)}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => openClass(c.id)} style={{ ...headerBtnStyle, padding: '5px 12px', fontSize: 11, color: COLOR, border: `1px solid ${COLOR_DIM}` }}>Open</button>
                      <button onClick={() => { setRenaming(c.id); setRenameValue(c.name); }} style={{ ...headerBtnStyle, padding: '5px 10px', fontSize: 11 }}>✏️</button>
                      <button onClick={() => handleDeleteClass(c.id)} style={{ ...headerBtnStyle, padding: '5px 10px', fontSize: 11, color: '#f87171', border: '1px solid #ef444455' }}>🗑️</button>
                    </div>
                  </div>
                );
              })}
            </div>}
          </div>
        )}

        {/* ── CLASS DETAIL ── */}
        {tab === 'classes' && selectedClassId && selectedClass && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <button onClick={() => setSelectedClassId(null)} style={{ ...headerBtnStyle, marginBottom: 12 }}>← Back</button>
            <div style={{ ...cardStyle, padding: '16px 20px', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0, color: 'white', fontSize: 18 }}>🏫 {selectedClass.name}</h3>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{members.length} members · {contentItems.length} content</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {classDetailTab === 'members' && <button onClick={() => openAddMember(selectedClassId)} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, cursor: 'pointer' }}>+ Add</button>}
                  {classDetailTab === 'content' && <button onClick={() => { setNewContentType('assignment'); setShowCreateContent(true); }} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, cursor: 'pointer' }}>+ Content</button>}
                  {classDetailTab === 'programs' && <button onClick={() => { setNewContentType('program'); setShowCreateContent(true); }} style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, cursor: 'pointer' }}>+ Program</button>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
                {([
                  { id: 'members' as const, icon: '👥', label: `Members (${members.length})` },
                  { id: 'content' as const, icon: '📚', label: `Content (${contentItems.filter(c => c.content_type !== 'program').length})` },
                  { id: 'programs' as const, icon: '📘', label: `Programs (${contentItems.filter(c => c.content_type === 'program').length})` },
                  { id: 'stats' as const, icon: '📊', label: 'Performance' },
                  { id: 'freeformReview' as const, icon: '📝', label: `Freeform Review (${freeformReviews.length})` }
                ]).map(st => (
                  <button key={st.id} onClick={() => {
                    setClassDetailTab(st.id);
                    if (st.id === 'stats' && leaderboard.length === 0 && selectedClassId) { setLoadingLeaderboard(true); getClassLeaderboard(selectedClassId).then(lb => { setLeaderboard(lb); setLoadingLeaderboard(false); }).catch(() => setLoadingLeaderboard(false)); }
                    if (st.id === 'freeformReview' && freeformReviews.length === 0) {
                      setLoadingFreeformReviews(true);
                      const userIds = members.filter((member) => member.role === 'student').map((member) => member.user_id);
                      listFreeformReviewsForUsers(userIds)
                        .then((rows) => setFreeformReviews(rows))
                        .catch(() => setFreeformReviews([]))
                        .finally(() => setLoadingFreeformReviews(false));
                    }
                  }} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: classDetailTab === st.id ? `${COLOR}33` : 'transparent', border: `1px solid ${classDetailTab === st.id ? COLOR_DIM : 'transparent'}`, color: classDetailTab === st.id ? COLOR : '#64748b', cursor: 'pointer' }}>
                    {st.icon} {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Members */}
            {classDetailTab === 'members' && (loadingMembers ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading...</div> :
              members.length === 0 ? <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}><div style={{ fontSize: 30, marginBottom: 8 }}>👥</div><div>No members yet.</div></div> :
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {members.map(m => {
                  const p = memberProfiles.get(m.user_id);
                  const rp = m.role === 'teacher_assistant' ? { l: 'TA', c: '#06b6d4' } : { l: 'Student', c: '#3b82f6' };
                  return (
                    <div key={m.user_id} style={{ ...cardStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: `hsl(${((p?.username || '?').charCodeAt(0) || 65) * 37 % 360}, 55%, 35%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: 12 }}>{(p?.username?.[0] || '?').toUpperCase()}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{p?.username || m.user_id}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{p?.email}</div>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5, background: `${rp.c}22`, border: `1px solid ${rp.c}55`, color: rp.c }}>{rp.l}</span>
                      <button onClick={() => handleRemoveMember(m.user_id)} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit' }}>✗</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Performance */}
            {classDetailTab === 'stats' && (loadingLeaderboard ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading...</div> :
              leaderboard.length === 0 ? <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}><div style={{ fontSize: 30, marginBottom: 8 }}>📊</div><div>No student data yet.</div></div> :
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', padding: '6px 14px', gap: 10, color: '#64748b', fontSize: 10, fontWeight: 'bold' }}>
                  <div style={{ width: 28 }}>#</div><div style={{ flex: 1 }}>Student</div>
                  <div style={{ width: 70, textAlign: 'center' }}>Avg Score</div><div style={{ width: 70, textAlign: 'center' }}>Quizzes</div><div style={{ width: 70, textAlign: 'center' }}>Qs Solved</div>
                </div>
                {leaderboard.map((e, i) => (
                  <div key={e.student_id} style={{ ...cardStyle, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, color: i < 3 ? '#fbbf24' : '#64748b', fontWeight: 'bold', fontSize: 13 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}</div>
                    <div style={{ flex: 1, color: 'white', fontWeight: 'bold', fontSize: 13 }}>{e.username}</div>
                    <div style={{ width: 70, textAlign: 'center', color: '#10b981', fontWeight: 'bold', fontSize: 13 }}>{e.quizzes_graded > 0 ? e.avg_score : '—'}</div>
                    <div style={{ width: 70, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{e.quizzes_taken}</div>
                    <div style={{ width: 70, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{e.questions_solved}</div>
                  </div>
                ))}
              </div>
            )}

            {classDetailTab === 'freeformReview' && (loadingFreeformReviews ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading...</div> :
              freeformReviews.length === 0 ? <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}><div style={{ fontSize: 30, marginBottom: 8 }}>📝</div><div>No freeform submissions yet.</div></div> :
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {freeformReviews.map((review) => (
                  <div key={review.id} style={{ ...cardStyle, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                      <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>{review.questionText || 'Untitled freeform response'}</div>
                      <div style={{ color: review.status === 'pending_review' ? '#93c5fd' : (review.correct ? '#34d399' : '#fca5a5'), fontSize: 11, fontWeight: 'bold' }}>
                        {review.status === 'pending_review' ? 'Pending review' : (review.correct ? 'Accepted' : 'Rejected')}
                      </div>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 8 }}>
                      {new Date(review.createdAt).toLocaleString()} · mode: {review.gradingMode} · provider: {review.provider ?? '—'}
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{review.answerText}</div>
                    {review.feedbackText ? <div style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'pre-wrap' }}>{review.feedbackText}</div> : null}
                  </div>
                ))}
              </div>
            )}

            {/* Content */}
            {classDetailTab === 'content' && (<>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {(['all', 'assignment', 'quiz'] as const).map(f => {
                  const cnt = f === 'all' ? contentItems.filter(c => c.content_type !== 'program').length : contentItems.filter(c => c.content_type === f).length;
                  return <button key={f} onClick={() => setContentFilter(f)} style={pillStyle(contentFilter === f)}>
                    {f === 'all' ? 'All' : f === 'assignment' ? '📝 Quests' : '📋 Quizzes'} ({cnt})
                  </button>;
                })}
              </div>
              {loadingContent ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading...</div> : (() => {
                const nonProgramItems = contentItems.filter(c => c.content_type !== 'program');
                const fl = contentFilter === 'all' ? nonProgramItems : nonProgramItems.filter(c => c.content_type === contentFilter);
                return fl.length === 0 ? <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}><div style={{ fontSize: 30, marginBottom: 8 }}>📚</div><div>No content yet.</div></div> :
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {fl.map(item => {
                    const ti = item.content_type === 'program' ? '📘' : item.content_type === 'assignment' ? '📝' : '📋';
                    const tl = item.content_type === 'program' ? 'Program' : item.content_type === 'assignment' ? 'Quest' : 'Quiz';
                    const sc = item.status === 'published' ? '#10b981' : '#f59e0b';
                    const qc = Array.isArray(item.questions) ? item.questions.length : 0;
                    return (
                      <div key={item.id} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 22, flexShrink: 0 }}>{item.cover_emoji || ti}</div>
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{item.title}</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>{tl} · {item.subject}{item.content_type !== 'program' && ` · ${qc}q`}{item.content_type === 'quiz' && item.time_limit_minutes && ` · ${item.time_limit_minutes}min`}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5, background: `${sc}22`, border: `1px solid ${sc}55`, color: sc }}>{item.status}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => handleTogglePublish(item)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11, color: item.status === 'draft' ? '#10b981' : '#f59e0b', border: `1px solid ${item.status === 'draft' ? '#10b98155' : '#f59e0b55'}` }}>{item.status === 'draft' ? '▶ Publish' : '⏸ Draft'}</button>
                          <button onClick={() => openContentEditor(item)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11 }}>✏️</button>
                          <button onClick={() => handleDeleteContent(item)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11, color: '#f87171', border: '1px solid #ef444455' }}>🗑️</button>
                        </div>
                      </div>
                    );
                  })}
                </div>;
              })()}
            </>)}

            {/* Programs */}
            {classDetailTab === 'programs' && (<>
              <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                Private programs belong to this class only. Students in this class can access them, but they do not appear in public search.
              </div>
              {loadingContent ? <div style={{ color: '#64748b', textAlign: 'center', marginTop: 20 }}>Loading...</div> : (() => {
                const fl = contentItems.filter(c => c.content_type === 'program');
                return fl.length === 0 ? <div style={{ textAlign: 'center', color: '#64748b', marginTop: 30 }}><div style={{ fontSize: 30, marginBottom: 8 }}>📘</div><div>No programs yet.</div></div> :
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {fl.map(item => {
                    const sc = item.status === 'published' ? '#10b981' : '#f59e0b';
                    return (
                      <div key={item.id} style={{ ...cardStyle, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 22, flexShrink: 0 }}>{item.cover_emoji || '📘'}</div>
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{item.title}</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>Program · {item.subject}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 5, background: `${sc}22`, border: `1px solid ${sc}55`, color: sc }}>{item.status}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => handleTogglePublish(item)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11, color: item.status === 'draft' ? '#10b981' : '#f59e0b', border: `1px solid ${item.status === 'draft' ? '#10b98155' : '#f59e0b55'}` }}>{item.status === 'draft' ? '▶ Publish' : '⏸ Draft'}</button>
                          <button onClick={() => openContentEditor(item)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11 }}>✏️</button>
                          <button onClick={() => handleDeleteContent(item)} style={{ ...headerBtnStyle, padding: '4px 10px', fontSize: 11, color: '#f87171', border: '1px solid #ef444455' }}>🗑️</button>
                        </div>
                      </div>
                    );
                  })}
                </div>;
              })()}
            </>)}
          </div>
        )}
      </div>

      {/* Create class modal */}
      {showCreate && (
        <>
          <div onClick={() => setShowCreate(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(400px, 92vw)', border: `2px solid ${COLOR}`, zIndex: 1001 }}>
            <h2 style={{ margin: '0 0 14px', color: 'white', fontSize: 17 }}>🏫 Create Class for {selectedTeacher?.username}</h2>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Class Name</label>
            <input value={newClassName} onChange={e => setNewClassName(e.target.value)} placeholder="e.g. Math 101" autoFocus style={inputStyle} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCreate(false)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleCreateClass} disabled={creating || !newClassName.trim()} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>{creating ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </>
      )}

      {/* Add member modal */}
      {showAddMember && (
        <>
          <div onClick={() => setShowAddMember(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(440px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', border: `2px solid ${COLOR}`, zIndex: 1001 }}>
            <h2 style={{ margin: '0 0 6px', color: 'white', fontSize: 17 }}>👥 Add Member</h2>
            {/* class selector */}
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>To Class</label>
            <select value={addToClassId || ''} onChange={e => setAddToClassId(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', marginBottom: 10, borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: 'white', fontFamily: 'inherit', fontSize: 12, outline: 'none', cursor: 'pointer', boxSizing: 'border-box' }}>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(['student', 'teacher_assistant'] as const).map(r => <button key={r} onClick={() => setAddMemberRole(r)} style={pillStyle(addMemberRole === r)}>{r === 'student' ? 'Student' : 'TA'}</button>)}
            </div>
            <input value={addMemberSearch} onChange={e => setAddMemberSearch(e.target.value)} placeholder="🔍 Search..." style={{ ...inputStyle, marginBottom: 10 }} />
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {candidateProfiles
                .filter(p => { const q = addMemberSearch.toLowerCase(); return !q || p.username.toLowerCase().includes(q) || p.email.toLowerCase().includes(q) || p.first_name.toLowerCase().includes(q); })
                .filter(p => !members.some(m => m.user_id === p.id))
                .slice(0, 50)
                .map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid #334155' }}>
                    <div style={{ flex: 1 }}><div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{p.username || `${p.first_name} ${p.last_name}`}</div><div style={{ color: '#64748b', fontSize: 11 }}>{p.email}</div></div>
                    <button disabled={addingMember} onClick={() => handleAddMember(p.id)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit', background: `${COLOR}22`, border: `1px solid ${COLOR_DIM}`, color: COLOR, cursor: 'pointer' }}>+ Add</button>
                  </div>
                ))}
            </div>
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddMember(false)} className="ll-btn" style={{ padding: '10px 22px' }}>Done</button>
            </div>
          </div>
        </>
      )}

      {/* Create content modal */}
      {showCreateContent && (
        <>
          <div onClick={() => setShowCreateContent(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(420px, 92vw)', border: `2px solid ${COLOR}`, zIndex: 1001 }}>
            <h2 style={{ margin: '0 0 14px', color: 'white', fontSize: 17 }}>📚 Create Content</h2>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {([{ type: 'assignment' as ContentType, icon: '📝', label: 'Quest' }, { type: 'quiz' as ContentType, icon: '📋', label: 'Quiz' }, { type: 'program' as ContentType, icon: '📘', label: 'Program' }]).map(ct => (
                <button key={ct.type} onClick={() => setNewContentType(ct.type)} style={{ flex: 1, padding: '10px 8px', borderRadius: 8, fontSize: 12, fontWeight: 'bold', fontFamily: 'inherit', background: newContentType === ct.type ? `${COLOR}33` : 'transparent', border: `1px solid ${newContentType === ct.type ? COLOR_DIM : '#334155'}`, color: newContentType === ct.type ? COLOR : '#64748b', cursor: 'pointer', textAlign: 'center' }}>{ct.icon} {ct.label}</button>
              ))}
            </div>
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Title</label>
            <input value={newContentTitle} onChange={e => setNewContentTitle(e.target.value)} placeholder="Title..." autoFocus style={inputStyle} />
            <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Subject</label>
            <select value={newContentSubject} onChange={e => setNewContentSubject(e.target.value)} style={{ ...inputStyle, background: '#0f172a', cursor: 'pointer', fontSize: 13 }}>
              <option value="mathematics">Mathematics</option><option value="science">Science</option><option value="english">English</option><option value="arabic">Arabic</option><option value="social_studies">Social Studies</option><option value="other">Other</option>
            </select>
            {newContentType === 'quiz' && (<><label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Time Limit (min)</label><input type="number" min="1" value={newContentTimeLimit} onChange={e => setNewContentTimeLimit(e.target.value)} placeholder="30" style={inputStyle} /></>)}
            {newContentType === 'program' && <div style={{ color: '#64748b', fontSize: 11, marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>Programs can be edited with the builder after creation.</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowCreateContent(false)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleCreateContent} disabled={creatingContent || !newContentTitle.trim()} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>{creatingContent ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </>
      )}

      {/* Edit content modal */}
      {editingContent && (
        <>
          <div onClick={() => setEditingContent(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(560px, 94vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: `2px solid ${COLOR}`, zIndex: 1001 }}>
            <h2 style={{ margin: '0 0 4px', color: 'white', fontSize: 17 }}>✏️ Edit {editingContent.content_type === 'program' ? 'Program' : editingContent.content_type === 'assignment' ? 'Quest' : 'Quiz'}</h2>
            <div style={{ color: '#64748b', fontSize: 11, marginBottom: 14 }}>ID: {editingContent.id}</div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Title</label>
              <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={inputStyle} />
              <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Subject</label>
              <select value={editSubject} onChange={e => setEditSubject(e.target.value)} style={{ ...inputStyle, background: '#0f172a', cursor: 'pointer', fontSize: 13 }}>
                <option value="mathematics">Mathematics</option><option value="science">Science</option><option value="english">English</option><option value="arabic">Arabic</option><option value="social_studies">Social Studies</option><option value="other">Other</option>
              </select>
              {editingContent.content_type === 'quiz' && (<><label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Time Limit (min)</label><input type="number" min="1" value={editTimeLimit} onChange={e => setEditTimeLimit(e.target.value)} style={inputStyle} /></>)}
              {editingContent.content_type !== 'program' && (<>
                <label style={{ color: '#94a3b8', fontSize: 12, display: 'block', marginBottom: 4 }}>Questions (JSON)</label>
                <textarea value={editQuestions} onChange={e => setEditQuestions(e.target.value)} rows={12} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', resize: 'vertical' as const }} />
              </>)}
              {editingContent.content_type === 'program' && <div style={{ color: '#64748b', fontSize: 12, padding: 12, borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', marginBottom: 10 }}>Program builder available through Super Admin panel.</div>}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => setEditingContent(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleSaveContent} disabled={savingContent} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>{savingContent ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </>
      )}
      {/* Economy modal */}
      {econModal && (
        <>
          <div onClick={() => setEconModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: '#1e293b', borderRadius: 16, padding: 26, width: 'min(380px, 92vw)',
            border: `2px solid ${COLOR}`, zIndex: 1001, animation: 'slideUp 0.2s ease'
          }}>
            <h2 style={{ margin: '0 0 10px', color: 'white', fontSize: 17 }}>✏️ Adjust Economy — {econModal.name}</h2>
            {econModal.current && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
                {[
                  { label: 'Gold', value: econModal.current.gold, color: '#fbbf24' },
                  { label: 'XP', value: econModal.current.global_xp, color: '#10b981' },
                  { label: 'Energy', value: econModal.current.energy, color: '#06b6d4' },
                  { label: 'Streak', value: econModal.current.streak, color: '#f97316' },
                ].map(s => (
                  <div key={s.label} style={{ background: '#0f172a', borderRadius: 8, padding: '6px 8px', textAlign: 'center', border: '1px solid #334155' }}>
                    <div style={{ fontSize: 14, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                    <div style={{ color: '#475569', fontSize: 9 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 14 }}>
              <div>
                <label style={{ color: '#fbbf24', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>🪙 Gold Δ</label>
                <input type="number" placeholder="0" value={econModal.goldDelta}
                  onChange={e => setEconModal(p => p ? { ...p, goldDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box' as const, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#10b981', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>⭐ XP Δ</label>
                <input type="number" placeholder="0" value={econModal.xpDelta}
                  onChange={e => setEconModal(p => p ? { ...p, xpDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box' as const, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#06b6d4', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>⚡ Energy Δ</label>
                <input type="number" placeholder="0" value={econModal.energyDelta}
                  onChange={e => setEconModal(p => p ? { ...p, energyDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box' as const, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: '#f97316', fontSize: 11, fontWeight: 'bold', display: 'block', marginBottom: 3 }}>🔥 Streak Δ</label>
                <input type="number" placeholder="0" value={econModal.streakDelta}
                  onChange={e => setEconModal(p => p ? { ...p, streakDelta: e.target.value } : null)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #475569', background: 'rgba(0,0,0,0.4)', color: 'white', boxSizing: 'border-box' as const, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setEconModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={async () => {
                if (!econModal) return;
                const gold = parseInt(econModal.goldDelta) || 0;
                const xp = parseInt(econModal.xpDelta) || 0;
                const energy = parseInt(econModal.energyDelta) || 0;
                const streak = parseInt(econModal.streakDelta) || 0;
                if (gold === 0 && xp === 0 && energy === 0 && streak === 0) { setEconModal(null); return; }
                setApplyingEcon(true);
                try {
                  await adminUpdateEconomy(econModal.uid, { gold, xp, energy, streak });
                } catch (err) { console.error('Economy update failed:', err); }
                setApplyingEcon(false);
                setEconModal(null);
              }} disabled={applyingEcon} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {applyingEcon ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </>
      )}
      {/* Create TA modal */}
      {createTaModal && (
        <>
          <div onClick={() => setCreateTaModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 14, border: '2px solid #06b6d4', padding: 24,
            zIndex: 1001, width: 'min(380px, 90vw)', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          }}>
            <h3 style={{ color: 'white', margin: '0 0 4px', fontSize: 16 }}>Create Teaching Assistant</h3>
            <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 14px' }}>
              For teacher: <strong style={{ color: '#10b981' }}>{selectedTeacher?.username || selectedTeacher?.first_name || '—'}</strong>
            </p>
            {taError && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>{taError}</div>}
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input value={taFname} onChange={e => setTaFname(e.target.value)} placeholder="First Name" style={inputStyle} />
              <input value={taLname} onChange={e => setTaLname(e.target.value)} placeholder="Last Name" style={inputStyle} />
            </div>
            <input value={taUsername} onChange={e => setTaUsername(e.target.value.toLowerCase().trim())} placeholder="Username" style={inputStyle} />
            <input value={taEmail} onChange={e => setTaEmail(e.target.value.trim())} placeholder="Email" type="email" style={inputStyle} />
            <input value={taPass} onChange={e => setTaPass(e.target.value)} placeholder="Password (min 6)" type="password" style={inputStyle} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCreateTaModal(false)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
              <button onClick={handleCreateTa} disabled={creatingTa} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                {creatingTa ? 'Creating...' : 'Create TA'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Assign TA to Class modal */}
      {assignTaModal && (
        <>
          <div onClick={() => setAssignTaModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 14, border: '2px solid #06b6d4', padding: 24,
            zIndex: 1001, width: 'min(350px, 90vw)', boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
          }}>
            <h3 style={{ color: 'white', margin: '0 0 4px', fontSize: 16 }}>Assign to Class</h3>
            <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 14px' }}>
              TA: <strong style={{ color: '#06b6d4' }}>{assignTaModal.userName}</strong>
            </p>
            {classes.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 16 }}>No classes available. Create a class first.</div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14, maxHeight: 240, overflowY: 'auto' }}>
                  {classes.map(c => {
                    const checked = assignTaSelected.has(c.id);
                    return (
                      <label key={c.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        borderRadius: 8, cursor: 'pointer',
                        background: checked ? 'rgba(6,182,212,0.1)' : 'rgba(0,0,0,0.2)',
                        border: `1px solid ${checked ? 'rgba(6,182,212,0.4)' : '#334155'}`,
                      }}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          setAssignTaSelected(prev => {
                            const next = new Set(prev);
                            if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                            return next;
                          });
                        }} style={{ accentColor: '#06b6d4', width: 16, height: 16, cursor: 'pointer' }} />
                        <span style={{ color: checked ? '#06b6d4' : '#94a3b8', fontSize: 13, fontWeight: checked ? 'bold' : 'normal' }}>{c.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setAssignTaModal(null)} className="ll-btn" style={{ flex: 1, padding: '11px' }}>Cancel</button>
                  <button
                    disabled={assigningTa}
                    onClick={async () => {
                      if (!assignTaModal) return;
                      setAssigningTa(true);
                      try {
                        const initial = new Set(assignTaModal.initialClassIds);
                        const toAdd = [...assignTaSelected].filter(id => !initial.has(id));
                        const toRemove = [...initial].filter(id => !assignTaSelected.has(id));
                        for (const cid of toAdd) await addClassMember(cid, assignTaModal.userId, 'teacher_assistant');
                        for (const cid of toRemove) await removeClassMember(cid, assignTaModal.userId);
                        setAssignTaModal(null);
                        await refreshTeacherData();
                      } catch (e: any) {
                        window.alert('Failed: ' + (e.message || String(e)));
                      } finally { setAssigningTa(false); }
                    }}
                    className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '11px' }}>
                    {assigningTa ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
