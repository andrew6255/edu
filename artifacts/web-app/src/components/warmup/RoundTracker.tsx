import { useEffect, useMemo, useRef, useState } from 'react';
import { GameSession } from '@/types/warmup';
import { sendQuickChat } from '@/lib/gameSessionService';

interface Props {
  session: GameSession;
  myUid: string;
}

export default function RoundTracker({ session, myUid }: Props) {
  const isP1 = session.player1.uid === myUid;
  const me = isP1 ? session.player1 : session.player2;
  const opp = isP1 ? session.player2 : session.player1;
  const ROUNDS_TO_WIN = 3;

  const quickChatEnabled = session.mode === 'friend' && !opp.isBot;

  const MESSAGES = useMemo(() => ([
    'Good luck!',
    'Nice!',
    'Wow 😮',
    'GG',
    'Rematch?',
    'Hurry up ⏳',
  ]), []);

  const EMOJIS = useMemo(() => ([
    '🔥', '💯', '😂', '😅', '😎', '😡', '👍', '👎', '🎉', '🤝', '💀', '🧠'
  ]), []);

  const [openPicker, setOpenPicker] = useState<'me' | 'opp' | null>(null);
  const [lastShownChatAt, setLastShownChatAt] = useState<string | null>(null);
  const [canSendAt, setCanSendAt] = useState(0);
  const hideTimerRef = useRef<number | null>(null);

  const quickChat = session.quickChat;

  useEffect(() => {
    if (!quickChat?.createdAt) return;
    if (quickChat.createdAt === lastShownChatAt) return;

    setLastShownChatAt(quickChat.createdAt);

    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setLastShownChatAt(null);
    }, 4500);

    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [quickChat?.createdAt]);

  async function handleSend(text: string) {
    if (!quickChatEnabled) return;
    const now = Date.now();
    if (now < canSendAt) return;
    setCanSendAt(now + 2500);
    setOpenPicker(null);
    await sendQuickChat(session.id, myUid, me.username, text);
  }

  return (
    <div style={{
      background: '#1e293b', borderBottom: '1px solid #334155',
      padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12
    }}>
      {/* Me */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>You</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ fontWeight: 'bold', color: 'white', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {me.username}
          </div>
          {quickChatEnabled && (
            <button
              onClick={() => setOpenPicker(openPicker === 'me' ? null : 'me')}
              className="ll-btn"
              style={{ padding: '4px 8px', fontSize: 12, lineHeight: 1, background: '#0f172a', border: '1px solid #334155' }}
            >
              💬
            </button>
          )}
        </div>
        {quickChatEnabled && quickChat && lastShownChatAt && quickChat.createdAt === lastShownChatAt && quickChat.fromUid === me.uid && (
          <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>💬</span>
            <span style={{ fontSize: 12, color: 'white', background: '#0f172a', border: '1px solid #334155', padding: '4px 8px', borderRadius: 10, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {quickChat.text}
            </span>
          </div>
        )}
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {quickChatEnabled && (
            <button
              onClick={() => setOpenPicker(openPicker === 'opp' ? null : 'opp')}
              className="ll-btn"
              style={{ padding: '4px 8px', fontSize: 12, lineHeight: 1, background: '#0f172a', border: '1px solid #334155' }}
            >
              💬
            </button>
          )}
          <div style={{ fontWeight: 'bold', color: opp.isBot ? '#f97316' : '#ef4444', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {opp.username}
          </div>
        </div>
        {quickChatEnabled && quickChat && lastShownChatAt && quickChat.createdAt === lastShownChatAt && quickChat.fromUid === opp.uid && (
          <div style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>💬</span>
            <span style={{ fontSize: 12, color: 'white', background: '#0f172a', border: '1px solid #334155', padding: '4px 8px', borderRadius: 10, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {quickChat.text}
            </span>
          </div>
        )}
      </div>

      {quickChatEnabled && openPicker && (
        <div
          onClick={() => setOpenPicker(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.35)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', left: 16, right: 16, top: 70, zIndex: 401,
              background: '#0b1220', border: '1px solid #334155', borderRadius: 14,
              padding: 12, boxShadow: '0 18px 60px rgba(0,0,0,0.55)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: 13 }}>
                Send a message
              </div>
              <button
                onClick={() => setOpenPicker(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              {MESSAGES.map(m => (
                <button
                  key={m}
                  onClick={() => handleSend(m)}
                  className="ll-btn"
                  style={{
                    padding: '10px 10px', fontSize: 13, textAlign: 'left',
                    background: '#0f172a', border: '1px solid #334155'
                  }}
                >
                  {m}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {EMOJIS.map(e => (
                <button
                  key={e}
                  onClick={() => handleSend(e)}
                  className="ll-btn"
                  style={{ padding: '10px 0', fontSize: 18, background: '#0f172a', border: '1px solid #334155' }}
                >
                  {e}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 10, color: '#64748b', fontSize: 11 }}>
              No typing — choose a quick message or emoji.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
