import { GameSession } from '@/types/warmup';

interface Props {
  session: GameSession;
  myUid: string;
}

export default function RoundTracker({ session, myUid }: Props) {
  const isP1 = session.player1.uid === myUid;
  const me = isP1 ? session.player1 : session.player2;
  const opp = isP1 ? session.player2 : session.player1;
  const ROUNDS_TO_WIN = 3;

  return (
    <div style={{
      background: '#1e293b', borderBottom: '1px solid #334155',
      padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12
    }}>
      {/* Me */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>You</div>
        <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {me.username}
        </div>
      </div>

      {/* Round dots */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {Array.from({ length: ROUNDS_TO_WIN }).map((_, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: '50%',
              background: i < me.roundWins ? '#10b981' : '#334155',
              border: `2px solid ${i < me.roundWins ? '#10b981' : '#475569'}`,
              transition: '0.3s'
            }} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 'bold' }}>
          Round {Math.min(session.currentRound, 5)}/5
        </div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {Array.from({ length: ROUNDS_TO_WIN }).map((_, i) => (
            <div key={i} style={{
              width: 14, height: 14, borderRadius: '50%',
              background: i < opp.roundWins ? '#ef4444' : '#334155',
              border: `2px solid ${i < opp.roundWins ? '#ef4444' : '#475569'}`,
              transition: '0.3s'
            }} />
          ))}
        </div>
      </div>

      {/* Opponent */}
      <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Opponent</div>
        <div style={{ fontWeight: 'bold', color: opp.isBot ? '#f97316' : '#ef4444', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {opp.username}
        </div>
      </div>
    </div>
  );
}
