import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getCurriculaForSubject } from '@/data/curriculum';
import { getUserProgress, getCurriculumCompletedCount, UserProgress } from '@/lib/progressService';
import { getPublicProgram } from '@/lib/programMaps';
import { getProgramProgress } from '@/lib/programProgress';
import MyProgramsModal from '@/components/universe/MyProgramsModal';

interface HexUniverseViewProps {
  onSelectSubject: (subject: string) => void;
}

const PORTALS = [
  { id: 'math',      label: 'Mathematics', icon: '∑',  color: '#0ea5e9', desc: 'Numbers & Logic', profileKey: 'mathematics' },
  { id: 'physics',   label: 'Physics',     icon: '⚛',  color: '#7e22ce', desc: 'Forces & Motion', profileKey: 'physics' },
  { id: 'chemistry', label: 'Chemistry',   icon: '⚗',  color: '#be185d', desc: 'Matter & Reactions', profileKey: 'chemistry' },
  { id: 'biology',   label: 'Biology',     icon: '🧬', color: '#15803d', desc: 'Life Sciences', profileKey: 'biology' },
];

function getSubjectProgress(
  subjectId: string,
  progress: UserProgress
): { pct: number; hasContent: boolean } {
  const curricula = getCurriculaForSubject(subjectId).filter(c => c.available);
  if (curricula.length === 0) return { pct: 0, hasContent: false };
  let total = 0, completed = 0;
  for (const c of curricula) {
    const { completed: comp, total: tot } = getCurriculumCompletedCount(progress, c.id, c.chapters);
    completed += comp;
    total += tot;
  }
  return { pct: total > 0 ? Math.round((completed / total) * 100) : 0, hasContent: true };
}

export default function HexUniverseView({ onSelectSubject }: HexUniverseViewProps) {
  const { user, userData } = useAuth();
  const [progress, setProgress] = useState<UserProgress>({});
  const [loaded, setLoaded] = useState(false);
  const [activeProgramTitle, setActiveProgramTitle] = useState<string | null>(null);
  const [activePrograms, setActivePrograms] = useState<Array<{ id: string; title: string; coverEmoji?: string }>>([]);
  const [programPctById, setProgramPctById] = useState<Record<string, number>>({});
  const [programsOpen, setProgramsOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    getUserProgress(user.uid).then(p => { setProgress(p); setLoaded(true); });
  }, [user]);

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

      const items = progs
        .map(({ pid, p }) => ({ id: pid, title: p?.title ?? pid, coverEmoji: p?.coverEmoji }))
        .filter((x) => !!x.id);

      setActiveProgramTitle(items[0]?.title ?? 'My Book');
      setActivePrograms(items);

      if (user) {
        const pctEntries = await Promise.all(
          progs.map(async ({ pid, p }) => {
            const unitIds: string[] = (p?.toc?.toc_tree ?? []).map((it: any, idx: number) => String(it?.id || idx));
            const pp = await getProgramProgress(user.uid, pid);
            const completedUnitIds = pp?.completedUnitIds ?? [];
            const completedCount = unitIds.filter((id) => completedUnitIds.includes(id)).length;
            const pct = unitIds.length > 0 ? Math.round((completedCount / unitIds.length) * 100) : 0;
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

  const profile = userData?.curriculumProfile;
  const isNoSystem = !profile || profile.system === 'No System';

  const subjects = profile?.subjects;
  const subjectKeyByPortalId: Record<string, keyof NonNullable<typeof subjects>> = {
    math: 'mathematics',
    physics: 'physics',
    chemistry: 'chemistry',
    biology: 'biology',
  };

  // Filter which portals to show based on curriculum profile
  const activePortals = PORTALS.filter(p => {
    if (isNoSystem) return false;
    const k = subjectKeyByPortalId[p.id];
    const subj = k ? subjects?.[k] : undefined;
    return !!subj?.isVisible;
  });

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: 'radial-gradient(ellipse at center, #1e293b 0%, #020617 100%)',
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
        {isNoSystem ? (
          <p style={{ color: '#64748b', fontSize: 15, margin: 0, maxWidth: 400 }}>
            You haven't assigned an education system yet. Set up your curriculum from the Profile tab to unlock portals!
          </p>
        ) : (
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
            Enter a portal to continue your mastery
          </p>
        )}
      </div>

      {/* Portals grid */}
      {!isNoSystem && activePortals.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 24, width: '100%', maxWidth: 800, zIndex: 2, marginBottom: 40
        }}>
          {activePortals.map((subj, i) => {
            const { pct, hasContent } = loaded ? getSubjectProgress(subj.id, progress) : { pct: 0, hasContent: false };
            const isDone = pct === 100 && hasContent;

            return (
              <div
                key={subj.id}
                onClick={() => onSelectSubject(subj.id)}
                style={{
                  background: `${subj.color}15`,
                  border: `2px solid ${pct > 0 ? subj.color : subj.color + '55'}`,
                  borderRadius: 20, padding: '30px 20px', textAlign: 'center',
                  cursor: 'pointer', transition: 'all 0.3s',
                  boxShadow: pct > 0 ? `0 0 30px ${subj.color}33` : `0 0 15px ${subj.color}15`,
                  animation: `fadeIn ${0.3 + i * 0.1}s ease`,
                  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center'
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.transform = 'scale(1.03) translateY(-6px)';
                  el.style.boxShadow = `0 15px 40px ${subj.color}55`;
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.transform = '';
                  el.style.boxShadow = pct > 0 ? `0 0 30px ${subj.color}33` : `0 0 15px ${subj.color}15`;
                }}
              >
                {isDone && (
                  <div style={{
                    position: 'absolute', top: 12, right: 12,
                    background: '#fbbf24', borderRadius: '50%', width: 24, height: 24,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#0f172a', fontWeight: 'bold'
                  }}>✓</div>
                )}

                <div style={{ fontSize: 48, marginBottom: 12, color: subj.color, textShadow: `0 0 20px ${subj.color}88` }}>
                  {subj.icon}
                </div>
                <div style={{ fontWeight: 'bold', fontSize: 20, color: 'white', marginBottom: 6 }}>
                  {subj.label}
                </div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: hasContent ? 16 : 0 }}>
                  {subj.desc}
                </div>

                {hasContent && loaded && (
                  <div style={{ width: '100%', marginTop: 'auto' }}>
                    <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
                      <div style={{
                        width: `${pct}%`, height: '100%',
                        background: isDone ? '#fbbf24' : subj.color, transition: '0.5s'
                      }} />
                    </div>
                    <div style={{ fontSize: 12, color: pct > 0 ? subj.color : '#64748b', fontWeight: 'bold' }}>
                      {pct}% Mastery
                    </div>
                  </div>
                )}
                {!hasContent && (
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 'auto' }}>Content compiling...</div>
                )}
              </div>
            );
          })}
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
              <div style={{ fontWeight: 'bold', fontSize: 20, color: 'white', marginBottom: 6 }}>
                {p.title}
              </div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
                Program Map
              </div>
              <div style={{ width: '100%', marginTop: 'auto' }}>
                <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
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

      <div style={{ zIndex: 2, marginTop: isNoSystem ? 0 : 'auto', animation: 'fadeIn 0.5s ease', width: '100%', maxWidth: 420 }}>
        <button
          onClick={() => setProgramsOpen(true)}
          style={{
            background: 'linear-gradient(90deg, rgba(168,85,247,0.20), rgba(59,130,246,0.18))',
            border: '1px solid rgba(168,85,247,0.5)',
            borderRadius: 12,
            padding: '16px 32px',
            color: 'white',
            fontSize: 15,
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            justifyContent: 'center',
          }}
        >
          📚 My Programs
          {activeProgramTitle ? (
            <span style={{ color: '#cbd5e1', fontWeight: 600, fontSize: 12 }}>
              ({activePrograms.length} active)
            </span>
          ) : null}
        </button>
      </div>

      <MyProgramsModal open={programsOpen} onClose={() => setProgramsOpen(false)} />

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
    </div>
  );
}
