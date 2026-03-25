import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateUserData } from '@/lib/userService';
import { getPublicProgram } from '@/lib/programMaps';

const defaultSubjects = {
  mathematics: { textbook: '', isVisible: true },
  physics: { textbook: '', isVisible: true },
  chemistry: { textbook: '', isVisible: true },
  biology: { textbook: '', isVisible: true }
};

export default function CurriculumEditor() {
  const { user, userData, refreshUserData } = useAuth();
  const [editingCurr, setEditingCurr] = useState(false);
  const [currDraft, setCurrDraft] = useState<any>(null);
  const [savingCurr, setSavingCurr] = useState(false);
  const [activePrograms, setActivePrograms] = useState<Array<{ id: string; title: string; coverEmoji?: string }>>([]);

  if (!user || !userData) return null;

  const activeProgramId = userData.activeProgramId;
  const activeProgramIds = userData.activeProgramIds;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ids = (activeProgramIds && Array.isArray(activeProgramIds))
        ? activeProgramIds
        : (activeProgramId ? [activeProgramId] : []);

      if (ids.length === 0) {
        setActivePrograms([]);
        return;
      }

      const progs = await Promise.all(ids.map((pid) => getPublicProgram(pid).then((p) => ({ pid, p }))));
      if (cancelled) return;

      setActivePrograms(
        progs.map(({ pid, p }) => ({ id: pid, title: p?.title ?? pid, coverEmoji: p?.coverEmoji }))
      );
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [activeProgramId, activeProgramIds]);

  return (
    <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: '1px solid #334155' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
          📚 My Curriculum
        </div>
        {!editingCurr ? (
          <button 
            onClick={() => {
              const s = userData.curriculumProfile?.subjects || defaultSubjects;
              setCurrDraft({
                system: userData.curriculumProfile?.system || 'No System',
                year: userData.curriculumProfile?.year || '',
                subjects: s
              });
              setEditingCurr(true);
            }}
            className="ll-btn ll-btn-primary" style={{ padding: '4px 12px', fontSize: 11 }}
          >
            Edit
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEditingCurr(false)} className="ll-btn" style={{ padding: '4px 12px', fontSize: 11 }}>Cancel</button>
            <button 
              onClick={async () => {
                setSavingCurr(true);
                await updateUserData(user.uid, { curriculumProfile: currDraft, onboardingComplete: true });
                await refreshUserData();
                setSavingCurr(false);
                setEditingCurr(false);
              }} 
              className="ll-btn ll-btn-primary" style={{ padding: '4px 12px', fontSize: 11, background: '#10b981', borderColor: '#059669', color: 'white' }}
            >
              {savingCurr ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {!editingCurr ? (
        // View Mode
        userData.curriculumProfile && userData.curriculumProfile.system !== 'No System' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', border: '1px solid #334155' }}>
                <div style={{ color: '#64748b', fontSize: 10, marginBottom: 3 }}>SYSTEM</div>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{userData.curriculumProfile.system}</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', border: '1px solid #334155' }}>
                <div style={{ color: '#64748b', fontSize: 10, marginBottom: 3 }}>YEAR</div>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{userData.curriculumProfile.year}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
              {['mathematics', 'physics', 'chemistry', 'biology'].map(sub => {
                const sbj = userData.curriculumProfile?.subjects?.[sub as keyof typeof userData.curriculumProfile.subjects];
                if (!sbj || !sbj.isVisible) return null;
                return (
                  <div key={sub} style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', border: '1px solid #334155' }}>
                    <div style={{ color: '#64748b', fontSize: 10, marginBottom: 3, textTransform: 'uppercase' }}>{sub}</div>
                    <div style={{ color: '#93c5fd', fontWeight: 'bold', fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={sbj.textbook}>
                      📖 {sbj.textbook || 'Custom / None'}
                    </div>
                  </div>
                );
              })}
            </div>

            {activePrograms.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ color: '#64748b', fontSize: 10, marginBottom: 6, textTransform: 'uppercase', fontWeight: 'bold', letterSpacing: 1 }}>
                  Active Programs
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {activePrograms.map(p => (
                    <div key={p.id} style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', border: '1px solid rgba(59,130,246,0.35)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ fontSize: 16, width: 22, textAlign: 'center' }}>{p.coverEmoji || '📘'}</div>
                      <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 13, padding: '10px 0', textAlign: 'center' }}>
            You are currently playing with No System assigned. Click Edit to select your subjects.
          </div>
        )
      ) : (
        // Edit Mode
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ color: '#64748b', fontSize: 10, marginBottom: 4 }}>SYSTEM</div>
              <select 
                value={currDraft.system} 
                onChange={e => setCurrDraft({ ...currDraft, system: e.target.value })}
                style={{ width: '100%', padding: 8, borderRadius: 8, background: '#0f172a', border: '1px solid #334155', color: 'white', outline: 'none' }}
              >
                <option value="No System">No System</option>
                <option value="IGCSE">IGCSE</option>
                <option value="American">American</option>
                <option value="IB">IB</option>
                <option value="French BAC">French BAC</option>
                <option value="Other">Other</option>
              </select>
            </div>
            {currDraft.system !== 'No System' && (
              <div>
                <div style={{ color: '#64748b', fontSize: 10, marginBottom: 4 }}>YEAR/GRADE</div>
                <input 
                  value={currDraft.year} 
                  onChange={e => setCurrDraft({ ...currDraft, year: e.target.value })}
                  placeholder="e.g. Year 10"
                  style={{ width: '100%', padding: 8, borderRadius: 8, background: '#0f172a', border: '1px solid #334155', color: 'white', outline: 'none' }}
                />
              </div>
            )}
          </div>
          
          {currDraft.system !== 'No System' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>Assigned Textbooks (Toggle visibility in Universe)</div>
              {['mathematics', 'physics', 'chemistry', 'biology'].map(sub => {
                const sbj = currDraft.subjects[sub as keyof typeof currDraft.subjects];
                return (
                  <div key={sub} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0f172a', padding: 10, borderRadius: 8, border: '1px solid #334155' }}>
                    <div style={{ flexShrink: 0, width: 84, color: 'white', fontSize: 12, textTransform: 'capitalize' }}>{sub}</div>
                    <button 
                      onClick={() => setCurrDraft({
                        ...currDraft, 
                        subjects: { ...currDraft.subjects, [sub]: { ...sbj, isVisible: !sbj.isVisible } }
                      })}
                      style={{
                        width: 32, height: 18, borderRadius: 10, background: sbj.isVisible ? '#10b981' : '#475569',
                        position: 'relative', border: 'none', cursor: 'pointer', flexShrink: 0, transition: '0.2s'
                      }}
                    >
                      <div style={{ position: 'absolute', top: 2, left: sbj.isVisible ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: 'white', transition: 'left 0.2s' }} />
                    </button>
                    <input
                      placeholder="Textbook Name..."
                      value={sbj.textbook}
                      onChange={e => setCurrDraft({
                        ...currDraft, 
                        subjects: { ...currDraft.subjects, [sub]: { ...sbj, textbook: e.target.value } }
                      })}
                      disabled={!sbj.isVisible}
                      style={{ flex: 1, padding: '8px 10px', borderRadius: 6, background: '#1e293b', border: '1px solid #334155', color: 'white', outline: 'none', opacity: sbj.isVisible ? 1 : 0.5, fontSize: 13 }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
