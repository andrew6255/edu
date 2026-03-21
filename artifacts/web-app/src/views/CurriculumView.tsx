import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  subject?: string;
  onBack?: () => void;
}

const CURRICULUMS = [
  { id: 'cambridge_y9', label: 'Cambridge IGCSE Year 9', subject: 'math', icon: '📐', trophies: 0, available: true },
  { id: 'cambridge_y10', label: 'Cambridge IGCSE Year 10', subject: 'math', icon: '📏', trophies: 0, available: false },
  { id: 'edexcel_y9', label: 'Edexcel IGCSE Year 9', subject: 'math', icon: '📊', trophies: 0, available: false },
  { id: 'physics_y9', label: 'Cambridge Physics Y9', subject: 'physics', icon: '⚛', trophies: 0, available: false },
];

const SAMPLE_CHAPTERS = [
  { id: 'ch1', name: 'Number Systems', icon: '🔢', objectives: 12, completed: 8, boss: false },
  { id: 'ch2', name: 'Algebra Foundations', icon: '✖', objectives: 15, completed: 15, boss: false },
  { id: 'ch3', name: 'Linear Equations', icon: '📈', objectives: 10, completed: 3, boss: false },
  { id: 'ch4', name: 'Geometry', icon: '📐', objectives: 18, completed: 0, boss: false },
  { id: 'ch5', name: '⚔️ BOSS: Algebra Master', icon: '👹', objectives: 5, completed: 0, boss: true },
  { id: 'ch6', name: 'Statistics', icon: '📊', objectives: 14, completed: 0, boss: false },
];

export default function CurriculumView({ subject, onBack }: Props) {
  const { userData } = useAuth();
  const [selectedCurriculum, setSelectedCurriculum] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);

  const filtered = subject ? CURRICULUMS.filter(c => c.subject === subject) : CURRICULUMS;

  if (selectedChapter) {
    const chapter = SAMPLE_CHAPTERS.find(c => c.id === selectedChapter)!;
    return <SkillTreeView chapter={chapter} onBack={() => setSelectedChapter(null)} />;
  }

  if (selectedCurriculum) {
    return (
      <div style={{ height: '100%', overflowY: 'auto', padding: 20, paddingBottom: 30 }}>
        <button onClick={() => setSelectedCurriculum(null)} className="ll-btn" style={{ marginBottom: 20, fontSize: 13 }}>
          ← Back
        </button>
        <h2 style={{ color: 'white', margin: '0 0 20px', fontSize: 22 }}>
          {CURRICULUMS.find(c => c.id === selectedCurriculum)?.label}
        </h2>

        {/* Trophy bar */}
        <div style={{
          background: '#1e293b', borderRadius: 12, padding: '15px 20px', marginBottom: 20,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          border: '1px solid #334155'
        }}>
          <div>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 2 }}>Chapter Progress</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#fbbf24' }}>
              🏆 {SAMPLE_CHAPTERS.filter(c => c.completed === c.objectives).length} / {SAMPLE_CHAPTERS.length}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 2 }}>Total XP</div>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: '#10b981' }}>
              {SAMPLE_CHAPTERS.reduce((a, c) => a + c.completed * 50, 0)} XP
            </div>
          </div>
        </div>

        {/* Chapter grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 15 }}>
          {SAMPLE_CHAPTERS.map((ch, i) => {
            const pct = ch.objectives ? Math.round((ch.completed / ch.objectives) * 100) : 0;
            const isLocked = i > 0 && SAMPLE_CHAPTERS[i-1].completed < SAMPLE_CHAPTERS[i-1].objectives * 0.5;
            const isDone = ch.completed === ch.objectives;
            return (
              <div
                key={ch.id}
                onClick={() => !isLocked && setSelectedChapter(ch.id)}
                className={`chapter-node${isLocked ? ' locked' : ''}`}
                style={{
                  border: `2px solid ${isDone ? '#10b981' : isLocked ? '#475569' : ch.boss ? '#ef4444' : '#334155'}`,
                  background: ch.boss ? 'rgba(127,29,29,0.3)' : isLocked ? 'rgba(30,41,59,0.3)' : '#1e293b'
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 6 }}>{isLocked ? '🔒' : ch.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 'bold', color: isLocked ? '#64748b' : 'white', textAlign: 'center', lineHeight: 1.3 }}>
                  {ch.name}
                </div>
                {!isLocked && !ch.boss && (
                  <div style={{ marginTop: 8, width: '90%' }}>
                    <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: isDone ? '#10b981' : '#3b82f6', transition: '0.5s' }} />
                    </div>
                    <div style={{ color: '#64748b', fontSize: 11, marginTop: 3, textAlign: 'center' }}>
                      {ch.completed}/{ch.objectives}
                    </div>
                  </div>
                )}
                {isDone && <div style={{ color: '#10b981', fontSize: 20, position: 'absolute', top: 8, right: 8 }}>✓</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, paddingBottom: 30 }}>
      {onBack && (
        <button onClick={onBack} className="ll-btn" style={{ marginBottom: 20, fontSize: 13 }}>
          ← Back
        </button>
      )}
      <h2 style={{ color: 'white', margin: '0 0 5px', fontSize: 24 }}>📚 Curriculum</h2>
      <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 14 }}>Choose a curriculum to begin</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map(curr => (
          <div
            key={curr.id}
            onClick={() => curr.available && setSelectedCurriculum(curr.id)}
            style={{
              background: '#1e293b', borderRadius: 12, padding: '18px 20px',
              border: `2px solid ${curr.available ? '#334155' : '#1e293b'}`,
              cursor: curr.available ? 'pointer' : 'not-allowed',
              opacity: curr.available ? 1 : 0.5,
              display: 'flex', alignItems: 'center', gap: 15, transition: '0.2s'
            }}
            onMouseEnter={e => {
              if (curr.available) (e.currentTarget as HTMLDivElement).style.borderColor = '#3b82f6';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.borderColor = curr.available ? '#334155' : '#1e293b';
            }}
          >
            <div style={{ fontSize: 36 }}>{curr.available ? curr.icon : '🔒'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 'bold', color: 'white', fontSize: 16 }}>{curr.label}</div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 3 }}>
                {curr.available ? '🏆 0 trophies earned' : 'Coming soon'}
              </div>
            </div>
            {curr.available && <span style={{ color: '#3b82f6', fontSize: 20 }}>›</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillTreeView({ chapter, onBack }: { chapter: typeof SAMPLE_CHAPTERS[0], onBack: () => void }) {
  const OBJECTIVES = Array.from({ length: chapter.objectives }, (_, i) => ({
    id: i,
    label: `Objective ${i + 1}`,
    completed: i < chapter.completed,
    unlocked: i <= chapter.completed
  }));

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, paddingBottom: 30 }}>
      <button onClick={onBack} className="ll-btn" style={{ marginBottom: 20, fontSize: 13 }}>← Back</button>
      <h2 style={{ color: 'white', margin: '0 0 5px', fontSize: 22 }}>{chapter.icon} {chapter.name}</h2>
      <p style={{ color: '#64748b', margin: '0 0 25px', fontSize: 14 }}>
        {chapter.completed}/{chapter.objectives} objectives completed
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
        {OBJECTIVES.map((obj, i) => (
          <div key={obj.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div
              className={`skill-node ${obj.completed ? 'completed' : obj.unlocked ? 'unlocked' : ''}`}
              onClick={() => obj.unlocked && !obj.completed && alert(`Practice: ${obj.label}`)}
            >
              {obj.completed ? '✓' : obj.unlocked ? (i + 1) : '🔒'}
            </div>
            {i < OBJECTIVES.length - 1 && (
              <div className={`path-line ${obj.completed ? 'active' : ''}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
