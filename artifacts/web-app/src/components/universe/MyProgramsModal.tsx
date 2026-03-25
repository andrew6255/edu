import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  assignProgramToUser,
  listPublicPrograms,
  removeProgramFromUser,
  toggleActiveProgramForUser,
  type PublicProgram,
} from '@/lib/programMaps';
import { submitProgramMapRequest } from '@/lib/userService';

export default function MyProgramsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, userData, refreshUserData } = useAuth();
  const [tab, setTab] = useState<'current' | 'finished' | 'search'>('current');
  const [loading, setLoading] = useState(false);
  const [programs, setPrograms] = useState<PublicProgram[]>([]);
  const [query, setQuery] = useState('');
  const [requestTitle, setRequestTitle] = useState('');
  const [requesting, setRequesting] = useState(false);

  const assignedIds: string[] = userData?.assignedProgramIds ?? [];
  const activeIds: string[] = userData?.activeProgramIds ?? (userData?.activeProgramId ? [userData.activeProgramId] : []);
  const completedIds: string[] = userData?.completedProgramIds ?? [];

  useEffect(() => {
    if (!open) return;
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const items = await listPublicPrograms();
        if (!alive) return;
        setPrograms(items);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [open]);

  const programsById = useMemo(() => {
    const m = new Map<string, PublicProgram>();
    for (const p of programs) m.set(p.id, p);
    return m;
  }, [programs]);

  const myCurrent = useMemo(() => {
    return assignedIds
      .map((id) => programsById.get(id) ?? ({ id, title: id, toc: { program_id: id, toc_tree: [] } } as PublicProgram))
      .filter((p: PublicProgram) => !completedIds.includes(p.id));
  }, [assignedIds, completedIds, programsById]);

  const myFinished = useMemo(() => {
    return completedIds
      .map((id) => programsById.get(id) ?? ({ id, title: id, toc: { program_id: id, toc_tree: [] } } as PublicProgram));
  }, [completedIds, programsById]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return programs.filter((p) => p.title.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [programs, query]);

  if (!open) return null;

  if (!user || !userData) return null;

  const uid = user.uid;
  const username = userData.username;
  const curriculumProfile = userData.curriculumProfile;

  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  async function handleAssign(programId: string) {
    await assignProgramToUser(uid, programId);
    await refreshUserData();
  }

  async function handleToggleActive(programId: string) {
    await toggleActiveProgramForUser(uid, programId);
    await refreshUserData();
  }

  async function handleDelete(programId: string) {
    if (!window.confirm('Remove this program from your profile?')) return;
    await removeProgramFromUser(uid, programId);
    await refreshUserData();
  }

  async function handleRequest() {
    const title = requestTitle.trim();
    if (!title) return;
    setRequesting(true);
    try {
      await submitProgramMapRequest(uid, username, {
        system: curriculumProfile?.system || 'other',
        year: curriculumProfile?.year || 'Other',
        textbook: title,
      });
      setRequestTitle('');
      window.alert('Request submitted!');
    } finally {
      setRequesting(false);
    }
  }

  const panelStyle: React.CSSProperties = {
    width: 'min(920px, 94vw)',
    maxHeight: '86vh',
    overflow: 'hidden',
    background: '#0f172a',
    borderRadius: 18,
    border: '2px solid #334155',
    boxShadow: '0 30px 80px rgba(0,0,0,0.65)',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerBtn = (active: boolean): React.CSSProperties => ({
    padding: '8px 12px',
    borderRadius: 10,
    border: `1px solid ${active ? 'rgba(59,130,246,0.6)' : '#334155'}`,
    background: active ? 'rgba(59,130,246,0.18)' : 'transparent',
    color: active ? '#bfdbfe' : '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  const rowStyle: React.CSSProperties = {
    background: '#111c33',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '12px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  function ProgramRow({ p, showAssign }: { p: PublicProgram; showAssign: boolean }) {
    const assigned = assignedIds.includes(p.id);
    const isActive = activeIds.includes(p.id);
    const isCompleted = completedIds.includes(p.id);

    const status = isCompleted ? 'Completed' : isActive ? 'Active' : assigned ? 'Deactivated' : 'Not added';

    return (
      <div style={rowStyle}>
        <div style={{ width: 32, textAlign: 'center', fontSize: 18 }}>{p.coverEmoji || '📘'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'white', fontWeight: 800, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.title}
          </div>
          <div style={{ color: '#64748b', fontSize: 11 }}>
            {status}{p.grade_band ? ` • ${p.grade_band}` : ''}
          </div>
        </div>

        {showAssign && !assigned ? (
          <button className="ll-btn ll-btn-primary" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => handleAssign(p.id)}>
            Assign
          </button>
        ) : assigned ? (
          <>
            <button
              className={isActive ? 'll-btn' : 'll-btn ll-btn-primary'}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                ...(isActive ? {} : { background: '#10b981', borderColor: '#059669', color: 'white' }),
              }}
              onClick={() => handleToggleActive(p.id)}
              disabled={isCompleted}
              title={isCompleted ? 'Completed programs cannot be activated (for now)' : ''}
            >
              {isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 11, borderColor: 'rgba(239,68,68,0.5)', color: '#fca5a5' }} onClick={() => handleDelete(p.id)}>
              Delete
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={panelStyle} onClick={stop}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 18 }}>📚</div>
          <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>My Programs</div>
          <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2a44', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={headerBtn(tab === 'current')} onClick={() => setTab('current')}>Current</button>
          <button style={headerBtn(tab === 'finished')} onClick={() => setTab('finished')}>Finished</button>
          <button style={headerBtn(tab === 'search')} onClick={() => setTab('search')}>Search</button>
          <div style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12 }}>{loading ? 'Loading...' : `${programs.length} public programs`}</div>
        </div>

        <div style={{ padding: 16, overflowY: 'auto' }}>
          {tab === 'current' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {myCurrent.length === 0 ? (
                <div style={{ color: '#94a3b8' }}>
                  No programs yet. Go to Search and assign one.
                </div>
              ) : (
                myCurrent.map((p) => <ProgramRow key={p.id} p={p} showAssign={false} />)
              )}
            </div>
          )}

          {tab === 'finished' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {myFinished.length === 0 ? (
                <div style={{ color: '#94a3b8' }}>
                  No finished programs yet.
                </div>
              ) : (
                myFinished.map((p) => <ProgramRow key={p.id} p={p} showAssign={false} />)
              )}
            </div>
          )}

          {tab === 'search' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by book name..."
                  style={{
                    width: '100%',
                    padding: '12px 12px',
                    borderRadius: 12,
                    border: '1px solid #334155',
                    background: '#0b1220',
                    color: 'white',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>

              {query.trim() && searchResults.length === 0 && !loading && (
                <div style={{ color: '#94a3b8' }}>
                  No matches. You can request a custom program map below.
                </div>
              )}

              {query.trim() && searchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {searchResults.slice(0, 30).map((p) => (
                    <ProgramRow key={p.id} p={p} showAssign={true} />
                  ))}
                </div>
              )}

              <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid #1f2a44' }}>
                <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 8, fontWeight: 'bold' }}>Request a custom program map</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input
                    value={requestTitle}
                    onChange={(e) => setRequestTitle(e.target.value)}
                    placeholder="Type your book name..."
                    style={{
                      flex: 1,
                      minWidth: 220,
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid #334155',
                      background: '#0b1220',
                      color: 'white',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  <button
                    className="ll-btn ll-btn-primary"
                    style={{ padding: '10px 14px', fontSize: 12, background: '#a855f7', borderColor: '#7c3aed', color: 'white' }}
                    onClick={handleRequest}
                    disabled={!requestTitle.trim() || requesting}
                  >
                    {requesting ? 'Requesting...' : 'Request'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
