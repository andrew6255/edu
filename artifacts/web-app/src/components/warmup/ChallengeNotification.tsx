import { useSession } from '@/contexts/SessionContext';
import { useAuth } from '@/contexts/AuthContext';
import { respondToChallenge } from '@/lib/gameSessionService';
import { Challenge, GameSession } from '@/types/warmup';

interface Props {
  onNavigateToWarmup: () => void;
}

export default function ChallengeNotification({ onNavigateToWarmup }: Props) {
  const { incomingChallenges, dismissChallenge, setPendingSession } = useSession();
  const { user, userData } = useAuth();

  if (incomingChallenges.length === 0) return null;

  const challenge = incomingChallenges[0];

  async function handleAccept(c: Challenge) {
    if (!user || !userData) return;
    const session = await respondToChallenge(c.id, true, user.uid, userData.username || 'Player');
    if (session) {
      dismissChallenge(c.id);
      setPendingSession({ session, gameId: c.gameId });
      onNavigateToWarmup();
    }
  }

  async function handleDecline(c: Challenge) {
    await respondToChallenge(c.id, false, user!.uid, '');
    dismissChallenge(c.id);
  }

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: 16, right: 16, zIndex: 300,
      background: '#1e293b', borderRadius: 16, padding: '16px 18px',
      border: '2px solid #3b82f6', boxShadow: '0 10px 40px rgba(59,130,246,0.25)',
      animation: 'slideUp 0.3s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontSize: 28, flexShrink: 0 }}>⚔️</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 'bold', color: 'white', fontSize: 14, marginBottom: 3 }}>
            Challenge from <span style={{ color: '#3b82f6' }}>@{challenge.fromUsername}</span>
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>
            {challenge.gameLabel} · Best of 5 rounds
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleDecline(challenge)}
              className="ll-btn"
              style={{ flex: 1, fontSize: 13, padding: '8px 12px' }}
            >
              Decline
            </button>
            <button
              onClick={() => handleAccept(challenge)}
              className="ll-btn ll-btn-primary"
              style={{ flex: 2, fontSize: 13, padding: '8px 12px' }}
            >
              Accept →
            </button>
          </div>
        </div>
        <button
          onClick={() => dismissChallenge(challenge.id)}
          style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}
        >×</button>
      </div>
      {incomingChallenges.length > 1 && (
        <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', marginTop: 10 }}>
          +{incomingChallenges.length - 1} more pending
        </div>
      )}
    </div>
  );
}
