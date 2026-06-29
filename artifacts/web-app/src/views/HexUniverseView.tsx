import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getProgramProgress } from '@/lib/programProgress';
import { useGlobalData } from '@/contexts/GlobalDataContext';
import MyProgramsModal from '@/components/universe/MyProgramsModal';
import { listMyPersonalPrograms, refreshPersonalProgramStatus, deletePersonalProgram, type PersonalProgramMeta } from '@/lib/personalProgramService';
import { type PersonalSubject, listPersonalSubjects } from '@/lib/personalSubjectService';
import ProcessingDetailsModal, { getProgressPercentage, useSmoothProgress, getStageLabel } from '@/components/universe/ProcessingDetailsModal';
import ManageSubjectsModal from '@/components/universe/ManageSubjectsModal';

function PersonalProgramCard({
  p,
  i,
  onOpenDetails,
}: {
  p: PersonalProgramMeta;
  i: number;
  onOpenDetails: (p: PersonalProgramMeta) => void;
}) {
  const isReady = p.status === 'ready' || (p.status as string) === 'published';
  const isFailed = p.status === 'failed';
  const targetPct = getProgressPercentage(p.status, p.processingStage);
  const pct = useSmoothProgress(targetPct, isFailed, p.stageUpdatedAt);
  const stageLabel = getStageLabel(p.status, p.processingStage);

  return (
    <div
      onClick={() => {
        if (isReady) {
          window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'personalProgram', personalProgramId: p.programId } }));
        } else if (!isFailed) {
          onOpenDetails(p);
        }
      }}
      style={{
        background: isReady ? 'rgba(96,165,250,0.10)' : 'rgba(148,163,184,0.05)',
        border: isReady ? '2px solid rgba(96,165,250,0.45)' : '2px dashed rgba(148,163,184,0.3)',
        borderRadius: 20,
        padding: '30px 20px',
        textAlign: 'center',
        cursor: isFailed ? 'default' : 'pointer',
        transition: 'all 0.3s',
        boxShadow: isReady ? '0 0 20px rgba(96,165,250,0.20)' : 'none',
        animation: `fadeIn ${0.3 + i * 0.08}s ease`,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: isReady ? 1 : 0.6,
      }}
      onMouseEnter={(e) => {
        if (!isReady) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = 'scale(1.03) translateY(-6px)';
        el.style.boxShadow = '0 15px 40px rgba(96,165,250,0.35)';
      }}
      onMouseLeave={(e) => {
        if (!isReady) return;
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = '';
        el.style.boxShadow = '0 0 20px rgba(96,165,250,0.20)';
      }}
    >
      <div style={{ fontSize: 48, marginBottom: 12, color: isReady ? '#60a5fa' : '#94a3b8', textShadow: 'none' }}>
        {p.coverEmoji || '📄'}
      </div>
      <div style={{ fontWeight: 'bold', fontSize: 20, color: isReady ? 'var(--ll-text)' : 'var(--ll-text-muted)', marginBottom: 6 }}>
        {p.title}
      </div>
      <div style={{ fontSize: 13, color: 'var(--ll-text-soft)', marginBottom: 16 }}>
        Custom Program
      </div>
      <div style={{ width: '100%', marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {!isReady && !isFailed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Circular Loading Indicator */}
            <svg width="24" height="24" viewBox="0 0 36 36" style={{ animation: 'spin 2s linear infinite' }}>
              <path
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="rgba(148,163,184,0.2)"
                strokeWidth="3"
              />
              <path
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="#60a5fa"
                strokeWidth="3"
                strokeDasharray={`${pct}, 100`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.8s ease-out' }}
              />
            </svg>
            <div style={{ fontSize: 13, color: '#60a5fa', fontWeight: 'bold' }}>
              {pct}% Loading...
            </div>
            <div style={{ fontSize: 11, color: 'var(--ll-text-muted)', marginTop: 2, textAlign: 'center', lineHeight: 1.1 }}>
              {stageLabel}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: isFailed ? '#ef4444' : '#34d399', fontWeight: 'bold' }}>
            {isFailed ? 'Failed' : 'Ready'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HexUniverseView() {
  const { user, userData } = useAuth();
  const [activeProgramTitle, setActiveProgramTitle] = useState<string | null>(null);
  const [activePrograms, setActivePrograms] = useState<Array<{ id: string; title: string; coverEmoji?: string }>>([]);
  const [programPctById, setProgramPctById] = useState<Record<string, number>>({});
  const [myProgramsOpen, setMyProgramsOpen] = useState(false);

  const { personalPrograms, setPersonalPrograms, subjects, setSubjects } = useGlobalData();
  
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [manageSubjectsOpen, setManageSubjectsOpen] = useState(false);
  
  const [selectedProcessingJobId, setSelectedProcessingJobId] = useState<string | null>(null);
  const selectedProcessingProgram = personalPrograms.find(p => p.jobId === selectedProcessingJobId) || null;

  // Re-open My Programs modal when navigating back from a personal program
  useEffect(() => {
    const handler = () => setMyProgramsOpen(true);
    window.addEventListener('ll:openMyPrograms', handler);
    return () => window.removeEventListener('ll:openMyPrograms', handler);
  }, []);

  // Migrate uncategorized programs
  useEffect(() => {
    if (!user || subjects.length === 0 || personalPrograms.length === 0) return;
    const uncatProgs = personalPrograms.filter(p => !p.subjectId);
    if (uncatProgs.length === 0) return;
    
    let cancelled = false;
    import('@/lib/personalSubjectService').then(({ createPersonalSubject }) => {
      let mathSubject = subjects.find(s => s.name.toLowerCase().includes('math'));
      (async () => {
        let newSubs = [...subjects];
        if (!mathSubject) {
          mathSubject = await createPersonalSubject(user.uid, 'Mathematics', '📐');
          newSubs.push(mathSubject);
          if (!cancelled) setSubjects(newSubs);
        }
        const { updateProgramSubject } = await import('@/lib/personalProgramService');
        await Promise.all(uncatProgs.map(p => updateProgramSubject(user.uid, p.jobId, mathSubject!.id)));
        const { listMyPersonalPrograms } = await import('@/lib/personalProgramService');
        const newProgs = await listMyPersonalPrograms(user.uid);
        if (!cancelled) setPersonalPrograms(newProgs);
      })();
    });
    return () => { cancelled = true; };
  }, [user]);

  // Poll processing personal programs
  useEffect(() => {
    if (!user) return;
    const isProcessing = (status: string) => status !== 'ready' && status !== 'published' && status !== 'failed';
    const processing = personalPrograms.filter(p => isProcessing(p.status));
    if (processing.length === 0) return;

    let alive = true;
    const interval = setInterval(async () => {
      const updatedList = await Promise.all(
        personalPrograms.map(async p => {
          if (!isProcessing(p.status)) return p;
          try {
            return await refreshPersonalProgramStatus(user.uid, p.jobId);
          } catch {
            return p;
          }
        })
      );
      if (alive) setPersonalPrograms(updatedList);
    }, 5000);

    return () => { alive = false; clearInterval(interval); };
  }, [user, personalPrograms]);

  const handleCancelProcessing = async () => {
    if (!selectedProcessingProgram || !user) return;
    if (!confirm('Cancel and delete this program?')) return;
    const jobId = selectedProcessingProgram.jobId;
    setSelectedProcessingJobId(null);
    try {
      await deletePersonalProgram(user.uid, jobId);
      setPersonalPrograms(prev => prev.filter(p => p.jobId !== jobId));
      window.dispatchEvent(new CustomEvent('ll:personalProgramDeleted', { detail: { jobId } }));
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ids = (userData?.activeProgramIds && Array.isArray(userData.activeProgramIds))
        ? userData.activeProgramIds
        : (userData?.activeProgramId ? [userData.activeProgramId] : []);

      if (ids.length === 0) {
        setActiveProgramTitle(null);
        setActivePrograms([]);
        return;
      }
      const { getPublicProgram, purgeProgramFromUser } = await import('@/lib/programMaps');
      const progs = await Promise.all(ids.map((pid) => getPublicProgram(pid).then((p) => ({ pid, p }))));
      if (cancelled) return;

      // Lazy cleanup: if a program is deleted, remove it from this user's profile and skip rendering it.
      if (user) {
        const missing = progs.filter(({ p }) => !p).map(({ pid }) => pid);
        if (missing.length > 0) {
          await Promise.all(missing.map((pid) => purgeProgramFromUser(user.uid, pid)));
        }
      }

      const visibleProgs = progs.filter(({ p }) => !!p);

      const items = visibleProgs
        .map(({ pid, p }) => ({ id: pid, title: p?.title ?? pid, coverEmoji: p?.coverEmoji }))
        .filter((x) => !!x.id);

      setActiveProgramTitle(items[0]?.title ?? 'My Book');
      setActivePrograms(items);

      if (user) {
        const pctEntries = await Promise.all(
          visibleProgs.map(async ({ pid, p }) => {
            const pp = await getProgramProgress(user.uid, pid);
            const solved = pp?.rankedSolvedQuestionIds?.length ?? 0;
            const total = typeof (p as any)?.rankedTotalQuestionCount === 'number' ? ((p as any).rankedTotalQuestionCount as number) : 0;

            let pct = 0;
            if (total > 0) {
              pct = Math.round((solved / total) * 100);
            } else {
              // Fallback to unit-based completion if question total isn't available.
              const unitIds: string[] = (p?.toc?.toc_tree ?? []).map((it: any, idx: number) => String(it?.id || idx));
              const completedUnitIds = pp?.completedUnitIds ?? [];
              const completedCount = unitIds.filter((id) => completedUnitIds.includes(id)).length;
              pct = unitIds.length > 0 ? Math.round((completedCount / unitIds.length) * 100) : 0;
            }
            return [pid, pct] as const;
          })
        );
        if (!cancelled) {
          const next: Record<string, number> = {};
          for (const [pid, pct] of pctEntries) next[pid] = pct;
          setProgramPctById(next);
        }
      } else {
        setProgramPctById({});
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [userData?.activeProgramId, userData?.activeProgramIds]);

  const filteredPersonalPrograms = selectedSubjectId
    ? personalPrograms.filter(p => p.subjectId === selectedSubjectId)
    : [];

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: 'radial-gradient(ellipse at center, var(--ll-surface-1) 0%, var(--ll-surface-0) 100%)',
      color: 'var(--ll-text)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      position: 'relative', padding: '40px 20px'
    }}>
      {!selectedSubjectId && (
        <div style={{ textAlign: 'center', marginBottom: 40, zIndex: 2 }}>
          <h1 style={{
            fontSize: 'clamp(28px, 6vw, 44px)', margin: '0 0 12px',
            color: '#c4b5fd', textShadow: '0 0 24px rgba(139,92,246,0.5)', letterSpacing: 2
          }}>
            YOUR UNIVERSE
          </h1>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, gap: 12 }}>
            <button
              onClick={() => setManageSubjectsOpen(true)}
              className="ll-btn"
              style={{ padding: '10px 16px', fontSize: 12 }}
            >
              ⚙️ My Subjects
            </button>
          </div>
        </div>
      )}

      {/* Active Programs (portal-style cards) */}
      {activePrograms.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 24,
          width: '100%',
          maxWidth: 800,
          zIndex: 2,
          marginBottom: 40,
        }}>
          {activePrograms.map((p, i) => (
            <div
              key={p.id}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'programMap', programId: p.id } }));
              }}
              style={{
                background: 'rgba(59,130,246,0.10)',
                border: '2px solid rgba(59,130,246,0.45)',
                borderRadius: 20,
                padding: '30px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.3s',
                boxShadow: '0 0 20px rgba(59,130,246,0.20)',
                animation: `fadeIn ${0.3 + i * 0.08}s ease`,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = 'scale(1.03) translateY(-6px)';
                el.style.boxShadow = '0 15px 40px rgba(59,130,246,0.35)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = '';
                el.style.boxShadow = '0 0 20px rgba(59,130,246,0.20)';
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12, color: '#60a5fa', textShadow: '0 0 20px rgba(96,165,250,0.55)' }}>
                {p.coverEmoji || '📘'}
              </div>
              <div style={{ fontWeight: 'bold', fontSize: 20, color: 'var(--ll-text)', marginBottom: 6 }}>
                {p.title}
              </div>
              <div style={{ fontSize: 13, color: 'var(--ll-text-soft)', marginBottom: 16 }}>
                Program Map
              </div>
              <div style={{ width: '100%', marginTop: 'auto' }}>
                <div style={{ height: 4, background: 'var(--ll-surface-3)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ width: `${programPctById[p.id] ?? 0}%`, height: '100%', background: (programPctById[p.id] ?? 0) >= 100 ? '#fbbf24' : '#60a5fa', transition: '0.5s' }} />
                </div>
                <div style={{ fontSize: 12, color: (programPctById[p.id] ?? 0) >= 100 ? '#fbbf24' : '#60a5fa', fontWeight: 'bold' }}>
                  {(programPctById[p.id] ?? 0) >= 100 ? 'Completed' : `${programPctById[p.id] ?? 0}% In Progress`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Custom Subjects / Worksheets View */}
      {selectedSubjectId ? (
        <div style={{ width: '100%', maxWidth: 800, zIndex: 2, marginBottom: 40 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}>
            <button className="ll-btn" onClick={() => setSelectedSubjectId(null)} style={{ padding: '6px 12px', fontSize: 12, position: 'absolute', left: 0 }}>
              ← Back
            </button>
            <h2 style={{ color: '#c4b5fd', fontSize: 'clamp(36px, 6vw, 56px)', margin: 0, textShadow: '0 0 32px rgba(139,92,246,0.6)', textAlign: 'center' }}>
              {`${subjects.find(s => s.id === selectedSubjectId)?.emoji || '📘'} ${subjects.find(s => s.id === selectedSubjectId)?.name || 'Worksheets'}`}
            </h2>
            <button
              onClick={() => setMyProgramsOpen(true)}
              className="ll-btn"
              style={{ padding: '10px 16px', fontSize: 12, position: 'absolute', right: 0 }}
            >
              📚 My Programs
            </button>
          </div>
          
          {filteredPersonalPrograms.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 24,
            }}>
              {filteredPersonalPrograms.map((p, i) => (
                <PersonalProgramCard
                  key={p.jobId}
                  p={p}
                  i={i}
                  onOpenDetails={(prog) => setSelectedProcessingJobId(prog.jobId)}
                />
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--ll-text-muted)', textAlign: 'center', padding: 40 }}>
              No worksheets in this subject yet.
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Subjects Grid */}
          {(subjects.length > 0 || personalPrograms.filter(p => !p.subjectId).length > 0) && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 20,
              width: '100%',
              maxWidth: 800,
              zIndex: 2,
              marginBottom: 40,
            }}>
              {subjects.map((s, i) => {
                const count = personalPrograms.filter(p => p.subjectId === s.id).length;
                const palette = [
                  '139,92,246', // Purple
                  '236,72,153', // Pink
                  '59,130,246', // Blue
                  '16,185,129', // Green
                  '249,115,22', // Orange
                  '6,182,212',  // Cyan
                  '234,179,8'   // Yellow
                ];
                const c = palette[i % palette.length];
                return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedSubjectId(s.id)}
                      style={{
                        background: `linear-gradient(135deg, rgba(${c},0.15) 0%, rgba(${c},0.05) 100%)`,
                        border: `1px solid rgba(${c},0.3)`,
                        borderRadius: 24,
                        padding: '16px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        animation: `fadeIn ${0.2 + i * 0.05}s ease`,
                        width: 220,
                        height: 220,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
                        backdropFilter: 'blur(8px)',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.transform = 'translateY(-6px) scale(1.02)';
                        e.currentTarget.style.borderColor = `rgba(${c},0.8)`;
                        e.currentTarget.style.boxShadow = `0 15px 40px rgba(${c},0.25)`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.transform = 'none';
                        e.currentTarget.style.borderColor = `rgba(${c},0.3)`;
                        e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)';
                      }}
                    >
                      <div style={{ 
                        fontSize: 64, 
                        marginBottom: 16,
                        filter: `drop-shadow(0 8px 16px rgba(${c},0.4))`
                      }}>
                        {s.emoji}
                      </div>
                      <div style={{ 
                        fontWeight: 800, 
                        fontSize: 20, 
                        color: 'var(--ll-text)',
                        letterSpacing: '0.5px'
                      }}>
                        {s.name}
                      </div>
                    </div>
                );
              })}
            </div>
          )}
        </>
      )}


      {/* Empty state when no programs */}
      {activePrograms.length === 0 && personalPrograms.length === 0 && subjects.length === 0 && (
        <div style={{
          textAlign: 'center', zIndex: 2, marginBottom: 40, maxWidth: 420,
          background: 'var(--ll-surface-1)', borderRadius: 18, padding: '32px 24px',
          border: '1px solid var(--ll-border)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
          <div style={{ color: 'var(--ll-text)', fontWeight: 800, fontSize: 16, marginBottom: 8 }}>No Subjects Yet</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
            Click "My Subjects" above to create subjects and upload worksheets.
          </div>
        </div>
      )}



      {/* Decorative orbs */}
      <div style={{
        position: 'absolute', width: '50vw', height: '50vw', maxWidth: 500, maxHeight: 500, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(139,92,246,0.06) 0%, transparent 60%)',
        top: '5%', left: '0%', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', width: '40vw', height: '40vw', maxWidth: 400, maxHeight: 400, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(14,165,233,0.05) 0%, transparent 60%)',
        bottom: '10%', right: '5%', pointerEvents: 'none'
      }} />
      <MyProgramsModal open={myProgramsOpen} onClose={() => setMyProgramsOpen(false)} subjectId={selectedSubjectId} />
      <ManageSubjectsModal open={manageSubjectsOpen} onClose={() => setManageSubjectsOpen(false)} />
      <ProcessingDetailsModal
        open={!!selectedProcessingJobId}
        onClose={() => setSelectedProcessingJobId(null)}
        program={selectedProcessingProgram}
        onCancel={handleCancelProcessing}
      />
    </div>
  );
}
