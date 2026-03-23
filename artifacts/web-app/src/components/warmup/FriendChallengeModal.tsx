import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sendChallenge, listenChallengeState, cancelChallenge } from '@/lib/gameSessionService';
import { Challenge, GameSession } from '@/types/warmup';
import { getSession } from '@/lib/gameSessionService';
import { getUserData } from '@/lib/userService';

interface Props {
  gameId: string;
  gameLabel: string;
  onSessionReady: (session: GameSession) => void;
  onCancel: () => void;
}

export default function FriendChallengeModal({ gameId, gameLabel, onSessionReady, onCancel }: Props) {
  const { user, userData } = useAuth();
  const [username, setUsername] = useState('');
  const [phase, setPhase] = useState<'input' | 'waiting' | 'declined'>('input');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [unsubRef, setUnsubRef] = useState<(() => void) | null>(null);
  const [sentChallengeId, setSentChallengeId] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [friends, setFriends] = useState<any[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!userData?.friends || userData.friends.length === 0) {
        if (alive) setFriends([]);
        return;
      }
      const fData = await Promise.all(
        userData.friends.map(uid => getUserData(uid).then(d => ({ uid, ...d })))
      );
      const today = new Date().toISOString().split('T')[0];
      fData.sort((a, b) => {
        const aOnline = a.last_active === today ? 1 : 0;
        const bOnline = b.last_active === today ? 1 : 0;
        return bOnline - aOnline;
      });
      if (alive) setFriends(fData);
    }
    load();
    return () => { alive = false; };
  }, [userData?.friends]);

  async function handleSend() {
    if (!user || !userData || !username.trim()) return;
    setSending(true);
    setError('');
    try {
      const { success, challengeId, error: err } = await sendChallenge(
        user.uid, userData.username || 'Player',
        username.trim(), gameId, gameLabel
      );
      if (!success || !challengeId) {
        setError(err || 'Failed to send');
        return;
      }

      setSentChallengeId(challengeId);

      setPhase('waiting');
      const unsub = listenChallengeState(challengeId, async (challenge: Challenge) => {
        if (challenge.state === 'accepted' && challenge.sessionId) {
          unsub();
          const session = await getSession(challenge.sessionId);
          if (session) onSessionReady(session);
        } else if (challenge.state === 'declined') {
          unsub();
          setPhase('declined');
        } else if (challenge.state === 'canceled') {
          unsub();
          onCancel();
        }
      });
      setUnsubRef(() => unsub);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  async function handleCancel() {
    unsubRef?.();
    if (sentChallengeId && user) {
      try {
        await cancelChallenge(sentChallengeId, user.uid);
      } catch {
        // ignore
      }
    }
    onCancel();
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 24, padding: 30
    }}>
      {phase === 'input' && (
        <>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 52, marginBottom: 10 }}>👥</div>
            <h2 style={{ margin: '0 0 6px', color: 'white', fontSize: 20 }}>Challenge a Friend</h2>
            <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>{gameLabel} · Best of 5 Rounds</p>
          </div>

          <div style={{ width: '100%', maxWidth: 320 }}>
            <label style={{ color: '#94a3b8', fontSize: 13, display: 'block', marginBottom: 8 }}>
              Friend's username
            </label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="e.g. player123"
              style={{
                width: '100%', padding: '12px 16px', borderRadius: 10, fontSize: 16,
                background: '#1e293b', border: '2px solid #334155', color: 'white',
                outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
                transition: '0.2s'
              }}
              onFocus={e => (e.target.style.borderColor = '#3b82f6')}
              onBlur={e => (e.target.style.borderColor = '#334155')}
              autoFocus
            />
            {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{error}</div>}
          </div>

          {friends.length > 0 && (
            <div style={{ width: '100%', maxWidth: 320 }}>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8, fontWeight: 'bold' }}>Or choose from friends</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                {friends.map(f => {
                  const today = new Date().toISOString().split('T')[0];
                  const isOnline = f.last_active === today;
                  return (
                    <button
                      key={f.uid}
                      onClick={() => setUsername(f.username || '')}
                      className="ll-btn"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', textAlign: 'left', justifyContent: 'flex-start'
                      }}
                    >
                      <span style={{
                        width: 10, height: 10, borderRadius: 999,
                        background: isOnline ? '#10b981' : '#0b1220',
                        border: `2px solid ${isOnline ? 'rgba(16,185,129,0.4)' : '#334155'}`
                      }} />
                      <span style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{f.username}</span>
                      <span style={{ marginLeft: 'auto', color: isOnline ? '#10b981' : '#64748b', fontSize: 11 }}>
                        {isOnline ? 'Online' : 'Offline'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 320 }}>
            <button onClick={handleCancel} className="ll-btn" style={{ flex: 1 }}>Cancel</button>
            <button
              onClick={handleSend}
              disabled={sending || !username.trim()}
              className="ll-btn ll-btn-primary"
              style={{ flex: 2 }}
            >
              {sending ? 'Sending...' : 'Send Challenge →'}
            </button>
          </div>
        </>
      )}

      {phase === 'waiting' && (
        <>
          <div style={{ fontSize: 56, animation: 'pulse 2s infinite' }}>📨</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 6 }}>
              Challenge Sent!
            </div>
            <div style={{ color: '#64748b', fontSize: 14, marginBottom: 4 }}>
              Waiting for <span style={{ color: '#3b82f6', fontWeight: 'bold' }}>@{username}</span> to accept...
            </div>
            <div style={{ color: '#475569', fontSize: 12 }}>
              They'll receive a notification
            </div>
          </div>
          <button onClick={handleCancel} className="ll-btn" style={{ fontSize: 13 }}>
            Cancel Challenge
          </button>
        </>
      )}

      {phase === 'declined' && (
        <>
          <div style={{ fontSize: 56 }}>😔</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#ef4444', fontSize: 20, fontWeight: 'bold', marginBottom: 6 }}>
              Challenge Declined
            </div>
            <div style={{ color: '#64748b', fontSize: 14 }}>
              @{username} is not available right now
            </div>
          </div>
          <button onClick={onCancel} className="ll-btn ll-btn-primary">Try Another Friend</button>
        </>
      )}
    </div>
  );
}
