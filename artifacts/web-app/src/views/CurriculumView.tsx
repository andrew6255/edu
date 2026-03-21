import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCurriculaForSubject, getCurriculumById, getTotalXP, Curriculum, Chapter, Objective
} from '@/data/curriculum';
import {
  getUserProgress, completeObjective, isObjectiveDone,
  getChapterCompletedCount, getCurriculumCompletedCount, UserProgress
} from '@/lib/progressService';

interface Props { subject?: string; onBack?: () => void; }

export default function CurriculumView({ subject, onBack }: Props) {
  const { user, refreshUserData } = useAuth();
  const [progress, setProgress] = useState<UserProgress>({});
  const [loadingProgress, setLoadingProgress] = useState(true);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);

  const curricula = subject ? getCurriculaForSubject(subject) : [];
  const curriculum = selectedCurriculumId ? getCurriculumById(selectedCurriculumId) : null;
  const chapter = curriculum ? curriculum.chapters.find(c => c.id === selectedChapterId) : null;

  useEffect(() => {
    if (!user) return;
    getUserProgress(user.uid).then(p => { setProgress(p); setLoadingProgress(false); });
  }, [user]);

  async function handleComplete(curriculumId: string, chapterId: string, objectiveId: string, xp: number) {
    if (!user) return;
    await completeObjective(user.uid, curriculumId, chapterId, objectiveId, xp);
    const p = await getUserProgress(user.uid);
    setProgress(p);
    await refreshUserData();
  }

  if (chapter && curriculum) {
    return (
      <SkillTreeView
        curriculum={curriculum}
        chapter={chapter}
        progress={progress}
        onComplete={(objId, xp) => handleComplete(curriculum.id, chapter.id, objId, xp)}
        onBack={() => setSelectedChapterId(null)}
      />
    );
  }

  if (curriculum) {
    return (
      <ChapterMapView
        curriculum={curriculum}
        progress={progress}
        onSelectChapter={setSelectedChapterId}
        onBack={() => setSelectedCurriculumId(null)}
      />
    );
  }

  // Curriculum list
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 28px' }}>
      {onBack && (
        <button onClick={onBack} className="ll-btn" style={{ marginBottom: 16, fontSize: 13 }}>← Back</button>
      )}
      <h2 style={{ color: 'white', margin: '0 0 4px', fontSize: 22 }}>📚 Curriculum</h2>
      <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 13 }}>Select a course to begin your journey</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {curricula.map(curr => {
          const { completed, total, pct } = loadingProgress
            ? { completed: 0, total: 0, pct: 0 }
            : getCurriculumCompletedCount(progress, curr.id, curr.chapters);
          const totalXP = getTotalXP(curr);

          return (
            <div
              key={curr.id}
              onClick={() => curr.available && setSelectedCurriculumId(curr.id)}
              style={{
                background: '#1e293b', borderRadius: 14, padding: '18px 20px',
                border: `2px solid ${curr.available && pct > 0 ? '#3b82f6' : '#334155'}`,
                cursor: curr.available ? 'pointer' : 'not-allowed',
                opacity: curr.available ? 1 : 0.5,
                transition: '0.2s'
              }}
              onMouseEnter={e => { if (curr.available) (e.currentTarget as HTMLDivElement).style.borderColor = '#3b82f6'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = curr.available && pct > 0 ? '#3b82f6' : '#334155'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: curr.available ? 12 : 0 }}>
                <div style={{ fontSize: 38, flexShrink: 0 }}>{curr.available ? curr.icon : '🔒'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 'bold', color: 'white', fontSize: 15 }}>{curr.label}</div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>
                    {curr.available ? `${curr.chapters.length} chapters • ${total} objectives • ${totalXP} XP total` : 'Coming soon'}
                  </div>
                </div>
                {curr.available && <span style={{ color: '#3b82f6', fontSize: 22 }}>›</span>}
              </div>

              {curr.available && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 5 }}>
                    <span>{completed}/{total} objectives</span>
                    <span style={{ color: pct > 0 ? '#10b981' : '#64748b', fontWeight: 'bold' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 6, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: pct === 100 ? '#fbbf24' : 'linear-gradient(90deg, #3b82f6, #10b981)',
                      transition: '0.5s', borderRadius: 3
                    }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChapterMapView({ curriculum, progress, onSelectChapter, onBack }: {
  curriculum: Curriculum;
  progress: UserProgress;
  onSelectChapter: (id: string) => void;
  onBack: () => void;
}) {
  const { completed: totalDone, total, pct } = getCurriculumCompletedCount(progress, curriculum.id, curriculum.chapters);
  const earnedXP = curriculum.chapters.reduce((sum, ch) =>
    sum + ch.objectives.reduce((s, o) => s + (isObjectiveDone(progress, curriculum.id, ch.id, o.id) ? o.xp : 0), 0), 0);

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 28px' }}>
      <button onClick={onBack} className="ll-btn" style={{ marginBottom: 14, fontSize: 13 }}>← Back</button>
      <h2 style={{ color: 'white', margin: '0 0 3px', fontSize: 20 }}>{curriculum.label}</h2>

      {/* Summary bar */}
      <div style={{
        background: '#1e293b', borderRadius: 12, padding: '14px 18px', margin: '14px 0',
        border: '1px solid #334155', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10
      }}>
        {[
          { label: 'Completed', value: `${totalDone}/${total}`, color: '#10b981' },
          { label: 'XP Earned', value: `${earnedXP}`, color: '#fbbf24' },
          { label: 'Progress', value: `${pct}%`, color: '#3b82f6' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Chapter cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 12 }}>
        {curriculum.chapters.map((ch, i) => {
          const { completed, total: chTotal, pct: chPct } = getChapterCompletedCount(progress, curriculum.id, ch.id, ch.objectives.length);

          // Lock: requires previous chapter ≥ 50% (boss requires previous 100%)
          const prevCh = i > 0 ? curriculum.chapters[i - 1] : null;
          const prevPct = prevCh
            ? getChapterCompletedCount(progress, curriculum.id, prevCh.id, prevCh.objectives.length).pct
            : 100;
          const requiredPct = ch.boss ? 100 : 50;
          const isLocked = prevCh !== null && prevPct < requiredPct;
          const isDone = chPct === 100;

          return (
            <div
              key={ch.id}
              onClick={() => !isLocked && onSelectChapter(ch.id)}
              style={{
                background: ch.boss ? 'rgba(127,29,29,0.25)' : isLocked ? 'rgba(30,41,59,0.4)' : '#1e293b',
                borderRadius: 14, padding: '16px 12px', textAlign: 'center',
                border: `2px solid ${isDone ? '#fbbf24' : isLocked ? '#334155' : ch.boss ? '#ef4444' : ch.color + '55'}`,
                cursor: isLocked ? 'not-allowed' : 'pointer', opacity: isLocked ? 0.55 : 1,
                transition: '0.2s', position: 'relative', overflow: 'hidden',
                boxShadow: isDone ? `0 0 15px rgba(251,191,36,0.2)` : ch.boss && !isLocked ? '0 0 15px rgba(239,68,68,0.15)' : 'none'
              }}
              onMouseEnter={e => {
                if (!isLocked) {
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 20px ${ch.color}33`;
                }
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.transform = '';
                (e.currentTarget as HTMLDivElement).style.boxShadow = isDone ? '0 0 15px rgba(251,191,36,0.2)' : ch.boss && !isLocked ? '0 0 15px rgba(239,68,68,0.15)' : 'none';
              }}
            >
              {isDone && (
                <div style={{ position: 'absolute', top: 7, right: 7, color: '#fbbf24', fontSize: 16 }}>✓</div>
              )}
              <div style={{ fontSize: 30, marginBottom: 8 }}>
                {isLocked ? '🔒' : ch.icon}
              </div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: isLocked ? '#64748b' : 'white', lineHeight: 1.3, marginBottom: 8 }}>
                {ch.name}
              </div>
              {!isLocked && (
                <>
                  <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                    <div style={{
                      width: `${chPct}%`, height: '100%',
                      background: isDone ? '#fbbf24' : ch.boss ? '#ef4444' : ch.color,
                      transition: '0.5s'
                    }} />
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{completed}/{chTotal}</div>
                </>
              )}
              {isLocked && prevCh && (
                <div style={{ color: '#475569', fontSize: 10 }}>
                  Complete {requiredPct}% of<br />"{prevCh.name}"
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkillTreeView({ curriculum, chapter, progress, onComplete, onBack }: {
  curriculum: Curriculum;
  chapter: Chapter;
  progress: UserProgress;
  onComplete: (objectiveId: string, xp: number) => Promise<void>;
  onBack: () => void;
}) {
  const [completing, setCompleting] = useState<string | null>(null);
  const [selectedObj, setSelectedObj] = useState<Objective | null>(null);
  const [justCompleted, setJustCompleted] = useState<string | null>(null);

  async function handleComplete(obj: Objective) {
    setCompleting(obj.id);
    await onComplete(obj.id, obj.xp);
    setCompleting(null);
    setJustCompleted(obj.id);
    setSelectedObj(null);
    setTimeout(() => setJustCompleted(null), 2000);
  }

  const { completed, total: chTotal } = getChapterCompletedCount(progress, curriculum.id, chapter.id, chapter.objectives.length);
  const chapterXP = chapter.objectives.reduce((s, o) => s + (isObjectiveDone(progress, curriculum.id, chapter.id, o.id) ? o.xp : 0), 0);
  const totalChXP = chapter.objectives.reduce((s, o) => s + o.xp, 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={onBack} className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
          <span style={{ fontSize: 16 }}>{chapter.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', color: 'white', fontSize: 15 }}>{chapter.name}</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{curriculum.shortLabel}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ color: '#fbbf24', fontWeight: 'bold', fontSize: 14 }}>{chapterXP}/{totalChXP} XP</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{completed}/{chTotal} done</div>
          </div>
        </div>
        <div style={{ height: 5, background: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${chTotal > 0 ? (completed / chTotal) * 100 : 0}%`, height: '100%',
            background: chapter.boss ? '#ef4444' : `linear-gradient(90deg, ${chapter.color}, ${chapter.color}cc)`,
            transition: '0.5s'
          }} />
        </div>
      </div>

      {/* Skill tree scroll */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {chapter.objectives.map((obj, i) => {
          const isDone = isObjectiveDone(progress, curriculum.id, chapter.id, obj.id);
          const prevDone = i === 0 || isObjectiveDone(progress, curriculum.id, chapter.id, chapter.objectives[i - 1].id);
          const isUnlocked = isDone || prevDone;
          const isCurrent = !isDone && prevDone;
          const wasJustCompleted = justCompleted === obj.id;

          return (
            <div key={obj.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 380 }}>
              {/* Connector line */}
              {i > 0 && (
                <div style={{
                  width: 3, height: 30, flexShrink: 0,
                  background: isObjectiveDone(progress, curriculum.id, chapter.id, chapter.objectives[i - 1].id)
                    ? chapter.color : '#334155',
                  transition: '0.5s'
                }} />
              )}

              {/* Objective node */}
              <div
                onClick={() => isUnlocked && !isDone && setSelectedObj(obj)}
                style={{
                  width: '100%', borderRadius: 14, padding: '14px 16px',
                  background: isDone
                    ? `${chapter.color}18`
                    : isCurrent
                    ? '#1e293b'
                    : 'rgba(30,41,59,0.4)',
                  border: `2px solid ${
                    wasJustCompleted ? '#fbbf24'
                    : isDone ? chapter.color
                    : isCurrent ? chapter.color + '88'
                    : '#334155'
                  }`,
                  opacity: isUnlocked ? 1 : 0.45,
                  cursor: isUnlocked && !isDone ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', gap: 14, transition: '0.2s',
                  boxShadow: isCurrent ? `0 0 15px ${chapter.color}22` : isDone ? `0 0 10px ${chapter.color}22` : 'none',
                  animation: wasJustCompleted ? 'pulse 0.5s ease' : `fadeIn ${0.1 + i * 0.05}s ease`
                }}
                onMouseEnter={e => {
                  if (isUnlocked && !isDone) (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.01)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.transform = '';
                }}
              >
                {/* Node icon */}
                <div style={{
                  width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                  background: isDone ? chapter.color : isCurrent ? chapter.color + '22' : '#0f172a',
                  border: `2px solid ${isDone ? chapter.color : isCurrent ? chapter.color : '#334155'}`,
                  boxShadow: isCurrent ? `0 0 10px ${chapter.color}44` : 'none',
                  color: isDone ? 'white' : isCurrent ? chapter.color : '#475569'
                }}>
                  {isDone ? '✓' : !isUnlocked ? '🔒' : isCurrent ? `${i + 1}` : `${i + 1}`}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 'bold', fontSize: 14, color: isUnlocked ? 'white' : '#64748b', marginBottom: 3 }}>
                    {obj.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>{obj.desc}</div>
                </div>

                {/* XP badge */}
                <div style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 'bold',
                  background: isDone ? `${chapter.color}22` : 'rgba(0,0,0,0.3)',
                  border: `1px solid ${isDone ? chapter.color + '44' : '#334155'}`,
                  color: isDone ? chapter.color : '#64748b'
                }}>
                  {obj.xp} XP
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Objective detail modal */}
      {selectedObj && (
        <>
          <div
            onClick={() => setSelectedObj(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200 }}
          />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
            background: '#1e293b', borderRadius: '20px 20px 0 0', padding: '24px 24px 32px',
            border: `2px solid ${chapter.color}`,
            boxShadow: `0 -10px 40px rgba(0,0,0,0.6)`,
            animation: 'slideUp 0.25s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: chapter.color, fontSize: 11, fontWeight: 'bold', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {chapter.name}
                </div>
                <h3 style={{ margin: 0, color: 'white', fontSize: 20 }}>{selectedObj.title}</h3>
              </div>
              <button onClick={() => setSelectedObj(null)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 22, cursor: 'pointer', padding: '0 0 0 10px' }}>×</button>
            </div>

            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.6, margin: '0 0 20px' }}>{selectedObj.desc}</p>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{
                display: 'flex', gap: 12, fontSize: 14,
                background: 'rgba(0,0,0,0.3)', padding: '10px 14px', borderRadius: 10, border: '1px solid #334155'
              }}>
                <span style={{ color: '#10b981', fontWeight: 'bold' }}>+{selectedObj.xp} XP</span>
                <span style={{ color: '#fbbf24' }}>+{Math.floor(selectedObj.xp / 5)} 🪙</span>
              </div>
              <button
                className="ll-btn ll-btn-primary"
                disabled={completing === selectedObj.id}
                onClick={() => handleComplete(selectedObj)}
                style={{ padding: '12px 24px', fontSize: 15, flex: 1, maxWidth: 200 }}
              >
                {completing === selectedObj.id ? 'Completing...' : '✓ Mark Complete'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
