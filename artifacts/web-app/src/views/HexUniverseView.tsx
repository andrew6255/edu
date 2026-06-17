import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getPublicProgram, purgeProgramFromUser } from '@/lib/programMaps';
import { getProgramProgress } from '@/lib/programProgress';
import { getAllMyContent, type StudentContentItem } from '@/lib/studentService';
import MyProgramsModal from '@/components/universe/MyProgramsModal';
import { listMyPersonalPrograms, refreshPersonalProgramStatus, deletePersonalProgram, type PersonalProgramMeta } from '@/lib/personalProgramService';
import ProcessingDetailsModal, { getProgressPercentage, useSmoothProgress, getStageLabel } from '@/components/universe/ProcessingDetailsModal';

function PersonalProgramCard({
  p,
  i,
  onOpenDetails,
}: {
  p: PersonalProgramMeta;
  i: number;
  onOpenDetails: (p: PersonalProgramMeta) => void;
}) {
  const isReady = p.status === 'ready' || p.status === 'published';
  const isFailed = p.status === 'failed';
  const targetPct = getProgressPercentage(p.status, p.processingStage);
  const pct = useSmoothProgress(targetPct, isFailed);
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

  // Personal Programs
  const [personalPrograms, setPersonalPrograms] = useState<PersonalProgramMeta[]>([]);
  const [selectedProcessingJobId, setSelectedProcessingJobId] = useState<string | null>(null);
  const selectedProcessingProgram = personalPrograms.find(p => p.jobId === selectedProcessingJobId) || null;

  // Class content filters
  const [classContent, setClassContent] = useState<(StudentContentItem & { class_name: string })[]>([]);
  const [classFilter, setClassFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'program' | 'assignment' | 'quiz'>('all');
  const [loadingClassContent, setLoadingClassContent] = useState(false);
  const [showClassContentRefresh, setShowClassContentRefresh] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (loadingClassContent) {
      timeout = setTimeout(() => setShowClassContentRefresh(true), 5000);
    } else {
      setShowClassContentRefresh(false);
    }
    return () => clearTimeout(timeout);
  }, [loadingClassContent]);

  useEffect(() => {
    if (!user) return;
    setLoadingClassContent(true);
    getAllMyContent().then(c => setClassContent(c)).catch(e => console.error(e)).finally(() => setLoadingClassContent(false));

    // Fetch personal programs
    let alive = true;
    listMyPersonalPrograms(user.uid).then(list => {
      if (alive) setPersonalPrograms(list);
    });

    // Listen for new ones created in modal
    const onCreated = (e: Event) => {
      const ce = e as CustomEvent<{ program: PersonalProgramMeta }>;
      setPersonalPrograms(prev => [ce.detail.program, ...prev.filter(p => p.programId !== ce.detail.program.programId)]);
    };
    
    // Listen for deleted ones
    const onDeleted = (e: Event) => {
      const ce = e as CustomEvent<{ jobId: string }>;
      setPersonalPrograms(prev => prev.filter(p => p.jobId !== ce.detail.jobId));
    };

    window.addEventListener('ll:personalProgramCreated', onCreated);
    window.addEventListener('ll:personalProgramDeleted', onDeleted);

    return () => { 
      alive = false; 
      window.removeEventListener('ll:personalProgramCreated', onCreated);
      window.removeEventListener('ll:personalProgramDeleted', onDeleted);
    };
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

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: 'radial-gradient(ellipse at center, var(--ll-surface-1) 0%, var(--ll-surface-0) 100%)',
      color: 'var(--ll-text)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      position: 'relative', padding: '40px 20px'
    }}>
      <div style={{ textAlign: 'center', marginBottom: 40, zIndex: 2 }}>
        <h1 style={{
          fontSize: 'clamp(28px, 6vw, 44px)', margin: '0 0 12px',
          color: '#c4b5fd', textShadow: '0 0 24px rgba(139,92,246,0.5)', letterSpacing: 2
        }}>
          YOUR UNIVERSE
        </h1>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <button
            onClick={() => setMyProgramsOpen(true)}
            className="ll-btn"
            style={{ padding: '10px 16px', fontSize: 12 }}
          >
            📚 My Programs
          </button>
        </div>
        <p style={{ color: 'var(--ll-text-muted)', fontSize: 14, margin: 0 }}>
          Open your programs or create new ones from your own worksheets
        </p>
      </div>

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

      {/* Custom Programs */}
      {personalPrograms.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 24,
          width: '100%',
          maxWidth: 800,
          zIndex: 2,
          marginBottom: 40,
        }}>
          {personalPrograms.map((p, i) => (
            <PersonalProgramCard
              key={p.jobId}
              p={p}
              i={i}
              onOpenDetails={(prog) => setSelectedProcessingJobId(prog.jobId)}
            />
          ))}
        </div>
      )}

      {/* Empty state when no programs */}
      {activePrograms.length === 0 && personalPrograms.length === 0 && !loadingClassContent && classContent.length === 0 && (
        <div style={{
          textAlign: 'center', zIndex: 2, marginBottom: 40, maxWidth: 420,
          background: 'var(--ll-surface-1)', borderRadius: 18, padding: '32px 24px',
          border: '1px solid var(--ll-border)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
          <div style={{ color: 'var(--ll-text)', fontWeight: 800, fontSize: 16, marginBottom: 8 }}>No Programs Yet</div>
          <div style={{ color: 'var(--ll-text-muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
            Click "My Programs" above to browse public programs, or create your own by uploading worksheets and PDFs.
          </div>
          <button
            onClick={() => setMyProgramsOpen(true)}
            className="ll-btn ll-btn-primary"
            style={{ padding: '10px 20px', fontSize: 13 }}
          >
            Get Started
          </button>
        </div>
      )}

      {/* Class Content with filters */}
      {classContent.length > 0 && (
        <div style={{ width: '100%', maxWidth: 800, zIndex: 2, marginBottom: 40 }}>
          <h2 style={{ color: '#c4b5fd', fontSize: 20, margin: '0 0 12px', textAlign: 'center' }}>Class Content</h2>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            {/* Class filter */}
            <select value={classFilter} onChange={e => setClassFilter(e.target.value)} style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit',
              background: 'var(--ll-surface-1)', border: '1px solid var(--ll-border)', color: 'var(--ll-text)', cursor: 'pointer', outline: 'none',
            }}>
              <option value="all">All Classes</option>
              {[...new Set(classContent.map(c => c.class_name))].map(cn => (
                <option key={cn} value={cn}>{cn}</option>
              ))}
            </select>
            {/* Type filter */}
            {(['all', 'program', 'assignment', 'quiz'] as const).map(t => {
              const label = t === 'all' ? 'All' : t === 'program' ? '📘 Programs' : t === 'assignment' ? '📝 Quests' : '📋 Quizzes';
              return (
                <button key={t} onClick={() => setTypeFilter(t)} style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 'bold', fontFamily: 'inherit',
                  background: typeFilter === t ? 'rgba(139,92,246,0.2)' : 'transparent',
                  border: `1px solid ${typeFilter === t ? 'rgba(139,92,246,0.5)' : 'var(--ll-border)'}`,
                  color: typeFilter === t ? '#c4b5fd' : 'var(--ll-text-muted)', cursor: 'pointer',
                }}>{label}</button>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            {classContent
              .filter(c => classFilter === 'all' || c.class_name === classFilter)
              .filter(c => typeFilter === 'all' || c.content_type === typeFilter)
              .map(item => {
                const typeColor = item.content_type === 'program' ? '#3b82f6' : item.content_type === 'assignment' ? '#f59e0b' : '#10b981';
                const typeIcon = item.content_type === 'program' ? '📘' : item.content_type === 'assignment' ? '📝' : '📋';
                const typeLabel = item.content_type === 'program' ? 'Program' : item.content_type === 'assignment' ? 'Quest' : 'Quiz';
                return (
                  <div key={item.id} onClick={() => {
                    window.dispatchEvent(new CustomEvent('ll:openClassContent', { detail: { contentId: item.id, contentType: item.content_type } }));
                  }} style={{
                    background: 'var(--ll-surface-0)', border: '1px solid var(--ll-border)',
                    borderRadius: 12, padding: 16, cursor: 'pointer', transition: '0.2s',
                  }} onMouseEnter={e => {
                    e.currentTarget.style.borderColor = typeColor;
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }} onMouseLeave={e => {
                    e.currentTarget.style.borderColor = 'var(--ll-border)';
                    e.currentTarget.style.transform = 'none';
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 20 }}>{typeIcon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', fontSize: 14 }}>{item.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--ll-text-muted)' }}>{item.class_name} • {typeLabel}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
          {classContent
            .filter(c => classFilter === 'all' || c.class_name === classFilter)
            .filter(c => typeFilter === 'all' || c.content_type === typeFilter).length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--ll-text-muted)', marginTop: 20, fontSize: 13 }}>No content matches the selected filters.</div>
          )}
        </div>
      )}
      {loadingClassContent && classContent.length === 0 && (
        <div style={{ color: 'var(--ll-text-muted)', fontSize: 13, zIndex: 2, marginBottom: 30, textAlign: 'center' }}>
          <div>Loading class content...</div>
          {showClassContentRefresh && (
            <div style={{ marginTop: 16, animation: 'fadeIn 0.5s ease' }}>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>Taking too long?</div>
              <button className="ll-btn" onClick={() => window.location.reload()} style={{ padding: '6px 12px', fontSize: 12 }}>
                Refresh Page
              </button>
            </div>
          )}
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
      <MyProgramsModal open={myProgramsOpen} onClose={() => setMyProgramsOpen(false)} />
      <ProcessingDetailsModal
        open={!!selectedProcessingJobId}
        onClose={() => setSelectedProcessingJobId(null)}
        program={selectedProcessingProgram}
        onCancel={handleCancelProcessing}
      />
    </div>
  );
}
