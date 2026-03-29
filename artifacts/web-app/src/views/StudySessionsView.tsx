import { useMemo, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';

export default function StudySessionsView({ onBack }: { onBack: () => void }) {
  const { userData } = useAuth();
  const [step, setStep] = useState<'home' | 'create' | 'join'>('home');
  const [joinCode, setJoinCode] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [joining, setJoining] = useState(false);

  const activeProgramIds = useMemo(() => {
    const ids = (userData?.activeProgramIds && Array.isArray(userData.activeProgramIds))
      ? (userData.activeProgramIds as string[])
      : (userData?.activeProgramId ? [userData.activeProgramId] : []);
    return ids;
  }, [userData?.activeProgramIds, userData?.activeProgramId]);

  async function joinStudyByCode(codeRaw: string) {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    setJoinMsg('');
    try {
      const snap = await getDoc(doc(db, 'programStudySessions', code));
      if (!snap.exists()) {
        setJoinMsg('❌ Invalid code.');
        return;
      }
      const data = snap.data() as { programId?: unknown; state?: unknown };
      const pid = typeof data.programId === 'string' ? (data.programId as string) : null;
      const state = typeof data.state === 'string' ? (data.state as string) : null;
      if (!pid || state === 'complete') {
        setJoinMsg('❌ Session ended.');
        return;
      }

      localStorage.setItem('ll:studyResumeSessionId', code);
      window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'programMap', programId: pid } }));
    } catch {
      setJoinMsg('❌ Failed to join.');
    } finally {
      setJoining(false);
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', borderBottom: '1px solid #1f2a44',
        background: 'rgba(0,0,0,0.5)'
      }}>
        <button onClick={onBack} className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
        <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>Study Sessions</div>
      </div>

      <div style={{ padding: 16, maxWidth: 820, margin: '0 auto', width: '100%' }}>
        {step === 'home' && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              className="ll-btn ll-btn-primary"
              style={{ padding: '12px 14px', minWidth: 220 }}
              onClick={() => setStep('create')}
            >
              Create new session
            </button>
            <button
              className="ll-btn"
              style={{ padding: '12px 14px', minWidth: 220 }}
              onClick={() => setStep('join')}
            >
              Join with code
            </button>
          </div>
        )}

        {step === 'create' && (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 12 }}>
              Pick a program, then choose chapter → subsection → question type.
            </div>

            {activeProgramIds.length === 0 ? (
              <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>
                No active programs found. Activate a program first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {activeProgramIds.map((pid) => (
                  <button
                    key={pid}
                    className="ll-btn"
                    style={{ padding: '10px 12px', textAlign: 'left' }}
                    onClick={() => {
                      localStorage.setItem('ll:studyCreateProgramId', pid);
                      window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'programMap', programId: pid } }));
                    }}
                  >
                    {pid}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="ll-btn" style={{ padding: '10px 12px' }} onClick={() => setStep('home')}>Back</button>
            </div>
          </div>
        )}

        {step === 'join' && (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>
              Enter the 5-digit code.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, maxWidth: 420 }}>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABCDE"
                maxLength={5}
                style={{
                  flex: 1,
                  padding: '12px 12px',
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: 'rgba(2,6,23,0.45)',
                  color: 'white',
                  fontFamily: 'inherit',
                  fontWeight: 900,
                  letterSpacing: 3,
                  outline: 'none',
                  textAlign: 'center',
                }}
              />
              <button
                className="ll-btn ll-btn-primary"
                disabled={joining || joinCode.trim().length < 5}
                onClick={() => void joinStudyByCode(joinCode)}
                style={{ padding: '12px 12px' }}
              >
                {joining ? 'Joining...' : 'Join'}
              </button>
            </div>
            {joinMsg && (
              <div style={{ color: joinMsg.startsWith('❌') ? '#fca5a5' : '#86efac', fontSize: 12, marginBottom: 10 }}>
                {joinMsg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="ll-btn" style={{ padding: '10px 12px' }} onClick={() => setStep('home')}>Back</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
