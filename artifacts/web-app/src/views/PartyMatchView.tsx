import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PartyMatchDoc, listenPartyMatch } from '@/lib/partyMatchService';
import PartyQuickMathGame from '@/games/party/PartyQuickMathGame';

export default function PartyMatchView() {
  const { user } = useAuth();
  const [match, setMatch] = useState<PartyMatchDoc | null>(null);

  useEffect(() => {
    const matchId = localStorage.getItem('ll:partyMatchId');
    if (!matchId) return;

    const unsub = listenPartyMatch(matchId, (doc) => {
      setMatch(doc);
    });

    return () => unsub();
  }, []);

  if (!match) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
        Loading party match...
      </div>
    );
  }

  // Collaborative game routing
  function renderGame() {
    if (!match || !user) return null;
    if (match.gameId === 'quickMath' || match.gameId === 'advQuickMath') {
      return <PartyQuickMathGame match={match} myUid={user.uid} onGameOver={(score) => {
        // Just leave match or go back to lobby for now
        window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'lobby' } }));
      }} />;
    }
    return (
      <div style={{ textAlign: 'center', color: '#64748b' }}>
        Collaborative {match.gameId} is not implemented yet. Wait for updates!
        <button className="ll-btn" style={{ marginTop: 20 }} onClick={() => window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'lobby' } }))}>
          Return to Lobby
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a' }}>
      <div style={{ padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid #334155' }}>
        <h1 style={{ color: '#f472b6', fontSize: 18, margin: 0 }}>Party Match</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          {match.players.map(p => (
            <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1e293b', padding: '4px 8px', borderRadius: 8 }}>
              <span style={{ fontSize: 16 }}>{p.emoji}</span>
              <span style={{ fontSize: 12, fontWeight: 'bold' }}>{p.username}</span>
              <span style={{ fontSize: 12, color: '#fbbf24', marginLeft: 4 }}>★ {p.score}</span>
            </div>
          ))}
        </div>
      </div>
      
      <div style={{ flex: 1, padding: 20, position: 'relative' }}>
        {renderGame()}
      </div>
    </div>
  );
}
