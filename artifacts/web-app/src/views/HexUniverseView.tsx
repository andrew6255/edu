import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getCurriculaForSubject } from '@/data/curriculum';
import { getUserProgress, getCurriculumCompletedCount, UserProgress } from '@/lib/progressService';

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

  useEffect(() => {
    if (!user) return;
    getUserProgress(user.uid).then(p => { setProgress(p); setLoaded(true); });
  }, [user]);

  const profile = userData?.curriculumProfile;
  const isNoSystem = !profile || profile.system === 'No System';

  // Filter which portals to show based on curriculum profile
  const activePortals = PORTALS.filter(p => {
    if (isNoSystem) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subj = profile?.subjects?.[p.profileKey as keyof any] as { isVisible: boolean } | undefined;
    return subj && subj.isVisible;
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

      {/* Add Program Button */}
      <div style={{ zIndex: 2, marginTop: isNoSystem ? 0 : 'auto', animation: 'fadeIn 0.5s ease' }}>
        <button
          onClick={() => alert("Custom Program Marketplace coming soon!")}
          style={{
            background: 'transparent', border: '2px dashed #475569', borderRadius: 12,
            padding: '16px 32px', color: '#94a3b8', fontSize: 15, fontWeight: 'bold', cursor: 'pointer',
            transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 10
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = '#64748b';
            e.currentTarget.style.color = '#cbd5e1';
            e.currentTarget.style.backgroundColor = 'rgba(71,85,105,0.1)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = '#475569';
            e.currentTarget.style.color = '#94a3b8';
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          <span style={{ fontSize: 20 }}>+</span> Add Program
        </button>
      </div>

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
