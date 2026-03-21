import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ALL_CURRICULA, getCurriculaForSubject, getTotalObjectives, Curriculum } from '@/data/curriculum';
import { getUserProgress, getCurriculumCompletedCount, UserProgress } from '@/lib/progressService';

interface HexUniverseViewProps {
  onSelectSubject: (subject: string) => void;
}

const SUBJECTS = [
  { id: 'math',      label: 'Mathematics', icon: '∑',  color: '#0ea5e9', desc: 'Numbers & Logic',     locked: false },
  { id: 'physics',   label: 'Physics',     icon: '⚛',  color: '#7e22ce', desc: 'Forces & Motion',    locked: false },
  { id: 'chemistry', label: 'Chemistry',   icon: '⚗',  color: '#be185d', desc: 'Matter & Reactions', locked: false },
  { id: 'biology',   label: 'Biology',     icon: '🧬', color: '#15803d', desc: 'Life Sciences',      locked: false },
  { id: 'compsci',   label: 'Comp. Sci.',  icon: '💻', color: '#b45309', desc: 'Algorithms & Code',  locked: true },
  { id: 'history',   label: 'History',     icon: '📜', color: '#ca8a04', desc: 'Past & Present',     locked: true },
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
  const { user } = useAuth();
  const [progress, setProgress] = useState<UserProgress>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    getUserProgress(user.uid).then(p => { setProgress(p); setLoaded(true); });
  }, [user]);

  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: 'radial-gradient(ellipse at center, #1e293b 0%, #020617 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', position: 'relative', padding: '20px 16px'
    }}>
      <div style={{ textAlign: 'center', marginBottom: 28, zIndex: 2 }}>
        <h1 style={{
          fontSize: 'clamp(22px, 5vw, 38px)', margin: '0 0 8px',
          color: '#c4b5fd', textShadow: '0 0 20px rgba(139,92,246,0.4)', letterSpacing: 2
        }}>
          KNOWLEDGE UNIVERSE
        </h1>
        <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>Choose your domain to begin your journey</p>
      </div>

      {/* Hex grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px 10px',
        maxWidth: 480,
        width: '100%',
        padding: '0 10px',
        zIndex: 2
      }}>
        {SUBJECTS.map((subj, i) => {
          const { pct, hasContent } = loaded ? getSubjectProgress(subj.id, progress) : { pct: 0, hasContent: false };
          const isDone = pct === 100 && hasContent;

          return (
            <div
              key={subj.id}
              onClick={() => !subj.locked && onSelectSubject(subj.id)}
              style={{
                background: subj.locked ? 'rgba(71,85,105,0.3)' : `${subj.color}18`,
                border: `2px solid ${subj.locked ? '#475569' : pct > 0 ? subj.color : subj.color + '55'}`,
                borderRadius: 16,
                padding: '18px 10px 14px',
                textAlign: 'center',
                cursor: subj.locked ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s',
                opacity: subj.locked ? 0.5 : 1,
                filter: subj.locked ? 'grayscale(1)' : 'none',
                boxShadow: subj.locked ? 'none' : pct > 0 ? `0 0 20px ${subj.color}44` : `0 0 12px ${subj.color}22`,
                animation: `fadeIn ${0.2 + i * 0.08}s ease`,
                position: 'relative'
              }}
              onMouseEnter={e => {
                if (!subj.locked) {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.transform = 'scale(1.05) translateY(-4px)';
                  el.style.boxShadow = `0 10px 30px ${subj.color}55`;
                }
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.transform = '';
                el.style.boxShadow = subj.locked ? 'none' : pct > 0 ? `0 0 20px ${subj.color}44` : `0 0 12px ${subj.color}22`;
              }}
            >
              {isDone && (
                <div style={{
                  position: 'absolute', top: 6, right: 6,
                  background: '#fbbf24', borderRadius: '50%', width: 18, height: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#0f172a'
                }}>✓</div>
              )}

              <div style={{ fontSize: 34, marginBottom: 6, color: subj.locked ? '#475569' : subj.color }}>
                {subj.locked ? '🔒' : subj.icon}
              </div>
              <div style={{ fontWeight: 'bold', fontSize: 12, color: subj.locked ? '#64748b' : 'white', marginBottom: 3 }}>
                {subj.label}
              </div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: hasContent && !subj.locked ? 8 : 0 }}>
                {subj.desc}
              </div>

              {/* Progress bar for subjects with available curricula */}
              {hasContent && !subj.locked && loaded && (
                <div>
                  <div style={{ height: 3, background: '#0f172a', borderRadius: 2, overflow: 'hidden', marginBottom: 3 }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: isDone ? '#fbbf24' : subj.color,
                      transition: '0.5s'
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: pct > 0 ? subj.color : '#475569', fontWeight: 'bold' }}>
                    {pct}%
                  </div>
                </div>
              )}

              {!hasContent && !subj.locked && (
                <div style={{ fontSize: 9, color: '#475569', marginTop: 4 }}>Content coming soon</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Decorative orbs */}
      <div style={{
        position: 'absolute', width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(139,92,246,0.08) 0%, transparent 70%)',
        top: '10%', left: '5%', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', width: 200, height: 200, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(59,130,246,0.08) 0%, transparent 70%)',
        bottom: '15%', right: '10%', pointerEvents: 'none'
      }} />
    </div>
  );
}
