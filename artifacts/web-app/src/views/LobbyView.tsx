import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createLobby,
  joinLobby,
  leaveLobby,
  setPlayerReady,
  setPlayerEmoji,
  setLobbyGameMode,
  setLobbyPlayMode,
  startLobbyGame,
  sendLobbyChat,
  sendLobbyInvite,
  sendJoinRequest,
  listenLobby,
  getFriendsWithPresence,
  pingPresence,
  setUserLobby,
  getUserLobbyId,
  getLobbyDoc,
  DEFAULT_EMOJI_LIST,
  LOBBY_MAX_PLAYERS,
} from '@/lib/lobbyService';
import { listLogicGameNodes } from '@/lib/logicGamesService';
import type { LobbyDoc, LobbyGameMode, LobbyPlayMode } from '@/types/lobby';
import type { LogicGameNode } from '@/types/logicGames';

// ─── Warmup Games catalog ─────────────────────────────────────────────────────
const WARMUP_GAMES = [
  { id: 'quickMath',     label: 'Quick Math',          icon: '🧮' },
  { id: 'advQuickMath',  label: 'Advanced Math',       icon: '⚡' },
  { id: 'trueFalse',     label: 'True or False',       icon: '✅' },
  { id: 'compareExp',    label: 'Compare Expressions', icon: '⚖️' },
  { id: 'missingOp',     label: 'Missing Operator',    icon: '🔣' },
  { id: 'completeEq',    label: 'Complete Equation',   icon: '📝' },
  { id: 'sequence',      label: 'Sequence',            icon: '🔗' },
  { id: 'memoCells',     label: 'Memo Cells',          icon: '🧠' },
  { id: 'memoOrder',     label: 'Memo Order',          icon: '🔢' },
  { id: 'pyramid',       label: 'Number Pyramid',      icon: '△'  },
  { id: 'flipNodes',     label: 'Flip Nodes',          icon: '⬡'  },
  { id: 'blockPuzzle',   label: 'Block Blast',         icon: '🟦' },
  { id: 'fifteenPuzzle', label: '15 Puzzle',           icon: '🔀' },
  { id: 'neonGrid',      label: 'Neon Grid',           icon: '💡' },
  { id: 'flipCup',       label: 'Flip Cup',            icon: '🥤' },
  { id: 'ticTacToe',     label: 'Tic Tac Toe',         icon: '❌' },
  { id: 'chessMemory',   label: 'Chess Memory',        icon: '♟️' },
];

// ─── Countdown overlay ────────────────────────────────────────────────────────
function CountdownOverlay({ startedAt }: { startedAt: string }) {
  const [secs, setSecs] = useState(3);
  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
      setSecs(Math.max(0, 3 - Math.floor(elapsed)));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        fontSize: secs === 0 ? 72 : 120, fontWeight: 900, lineHeight: 1,
        color: secs === 0 ? '#34d399' : '#f472b6',
        textShadow: `0 0 60px ${secs === 0 ? '#34d399' : '#f472b6'}`,
        transition: 'all 0.3s',
      }}>
        {secs === 0 ? 'GO!' : secs}
      </div>
      <div style={{ color: '#94a3b8', fontSize: 18, marginTop: 16, fontWeight: 600 }}>
        Get ready…
      </div>
    </div>
  );
}

// ─── Emoji Picker ─────────────────────────────────────────────────────────────
function EmojiPicker({ current, onSelect, onClose }: {
  current: string; onSelect: (e: string) => void; onClose: () => void;
}) {
  return (
    <div style={{
      position: 'absolute', bottom: '110%', left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', border: '1px solid #334155', borderRadius: 16,
      padding: 12, zIndex: 100,
      display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4,
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    }}>
      {DEFAULT_EMOJI_LIST.map(e => (
        <button key={e} onClick={() => { onSelect(e); onClose(); }}
          style={{
            fontSize: 22, padding: 6, borderRadius: 8, border: 'none',
            background: e === current ? 'rgba(244,114,182,0.2)' : 'transparent',
            cursor: 'pointer', transition: 'transform 0.1s',
          }}
          onMouseEnter={ev => (ev.currentTarget.style.transform = 'scale(1.3)')}
          onMouseLeave={ev => (ev.currentTarget.style.transform = '')}
        >{e}</button>
      ))}
    </div>
  );
}

// ─── Player Slot ──────────────────────────────────────────────────────────────
function PlayerSlot({ player, isMe, onEmojiClick, isEmpty }: {
  player?: { uid: string; username: string; emoji: string; ready: boolean; isLeader: boolean };
  isMe: boolean; onEmojiClick?: () => void; isEmpty?: boolean;
}) {
  if (isEmpty || !player) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: 0.35 }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%', border: '2px dashed #334155',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#475569',
        }}>+</div>
        <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>Empty Slot</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {player.isLeader && <span style={{ fontSize: 16 }}>👑</span>}
      </div>
      <div
        style={{
          width: 80, height: 80, borderRadius: '50%', fontSize: 38,
          background: player.ready
            ? 'radial-gradient(circle, rgba(52,211,153,0.25), rgba(52,211,153,0.05))'
            : 'radial-gradient(circle, rgba(99,102,241,0.25), rgba(99,102,241,0.05))',
          border: `3px solid ${player.ready ? '#34d399' : isMe ? '#a78bfa' : '#475569'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: isMe ? 'pointer' : 'default', transition: 'all 0.3s',
          boxShadow: player.ready ? '0 0 20px rgba(52,211,153,0.4)' : isMe ? '0 0 20px rgba(167,139,250,0.3)' : 'none',
          position: 'relative',
        }}
        onClick={isMe ? onEmojiClick : undefined}
        title={isMe ? 'Click to change emoji' : undefined}
      >
        {player.emoji}
        {isMe && (
          <div style={{
            position: 'absolute', bottom: -2, right: -2, background: '#a78bfa',
            borderRadius: '50%', width: 20, height: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, border: '2px solid #0f172a',
          }}>✏️</div>
        )}
      </div>
      <div style={{
        fontSize: 12, fontWeight: 700,
        color: isMe ? '#a78bfa' : 'var(--ll-text)',
        maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center',
      }}>
        {player.username}{isMe ? ' (you)' : ''}
      </div>
      <div style={{
        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
        background: player.ready ? 'rgba(52,211,153,0.15)' : 'rgba(71,85,105,0.3)',
        color: player.ready ? '#34d399' : '#64748b',
        border: `1px solid ${player.ready ? '#34d399' : '#334155'}`,
      }}>
        {player.isLeader ? '👑 LEADER' : player.ready ? '✅ READY' : 'NOT READY'}
      </div>
    </div>
  );
}

// ─── Main LobbyView ───────────────────────────────────────────────────────────
export default function LobbyView() {
  const { user, userData } = useAuth();

  const [lobby, setLobby] = useState<LobbyDoc | null>(null);
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  const [modeKind, setModeKind] = useState<'warmup' | 'iqGame' | 'program'>('warmup');
  const [iqNodes, setIqNodes] = useState<LogicGameNode[]>([]);

  const [friends, setFriends] = useState<(
    { uid: string; username: string; isOnline: boolean; lobbyId: string | null; lastActive: string }
  )[]>([]);
  const [inviteStatus, setInviteStatus] = useState<Record<string, string>>({});
  const [joinReqStatus, setJoinReqStatus] = useState<Record<string, string>>({});

  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [launchHandled, setLaunchHandled] = useState(false);

  const myUid = user?.uid ?? '';
  const myUsername = userData?.username ?? myUid;
  const myEmoji = lobby?.players.find(p => p.uid === myUid)?.emoji ?? DEFAULT_EMOJI_LIST[0];
  const isLeader = lobby?.leaderUid === myUid;
  const myPlayer = lobby?.players.find(p => p.uid === myUid);

  // ── On mount: restore or create lobby ────────────────────────────────────
  useEffect(() => {
    if (!myUid) return;

    async function init() {
      setInitializing(true);

      // 1. Check for a pending join from a notification
      const pendingLobbyId = localStorage.getItem('ll:pendingLobbyId');
      if (pendingLobbyId) {
        localStorage.removeItem('ll:pendingLobbyId');
        const doc = await getLobbyDoc(pendingLobbyId);
        if (doc && doc.state === 'waiting' && doc.players.length < LOBBY_MAX_PLAYERS) {
          const emoji = DEFAULT_EMOJI_LIST[Math.floor(Math.random() * DEFAULT_EMOJI_LIST.length)];
          const result = await joinLobby({ lobbyId: pendingLobbyId, uid: myUid, username: myUsername, emoji });
          if (result.success) {
            await setUserLobby(myUid, pendingLobbyId);
            setLobbyId(pendingLobbyId);
            setLaunchHandled(false);
            setInitializing(false);
            return;
          }
        }
      }

      // 2. Check if user is already in a lobby (from userPresence)
      const existingId = await getUserLobbyId(myUid);
      if (existingId) {
        const doc = await getLobbyDoc(existingId);
        if (doc && doc.players.some(p => p.uid === myUid)) {
          setLobbyId(existingId);
          setLaunchHandled(false);
          setInitializing(false);
          return;
        }
      }

      // 3. Create a fresh personal lobby
      const emoji = DEFAULT_EMOJI_LIST[0];
      const doc = await createLobby({ uid: myUid, username: myUsername, emoji });
      await setUserLobby(myUid, doc.id);
      setLobbyId(doc.id);
      setLaunchHandled(false);
      setInitializing(false);
    }

    init().catch(() => setInitializing(false));
  }, [myUid]);

  // ── Load IQ nodes ──────────────────────────────────────────────────────────
  useEffect(() => {
    listLogicGameNodes().then(nodes => setIqNodes(nodes.filter(n => !!n.publishedAt))).catch(() => {});
  }, []);

  // ── Presence ping ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!myUid) return;
    pingPresence(myUid).catch(() => {});
    const id = setInterval(() => pingPresence(myUid).catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [myUid]);

  // ── Load friends with their lobby presence ─────────────────────────────────
  useEffect(() => {
    if (!userData?.friends?.length) return;
    getFriendsWithPresence(userData.friends).then(setFriends).catch(() => {});
    const id = setInterval(() => {
      getFriendsWithPresence(userData!.friends).then(setFriends).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [userData?.friends]);

  // ── Listen to lobby changes ────────────────────────────────────────────────
  useEffect(() => {
    if (!lobbyId) return;
    const unsub = listenLobby(lobbyId, setLobby);
    return unsub;
  }, [lobbyId]);

  // ── Auto-scroll chat ───────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lobby?.chat]);

  // ── Handle game launch countdown ──────────────────────────────────────────
  useEffect(() => {
    if (!lobby || lobby.state !== 'countdown' || launchHandled) return;
    if (!lobby.countdownStartedAt) return;
    const elapsed = Date.now() - new Date(lobby.countdownStartedAt).getTime();
    const delay = Math.max(0, 3000 - elapsed);
    const timer = setTimeout(() => {
      setLaunchHandled(true);
      launchGame();
    }, delay);
    return () => clearTimeout(timer);
  }, [lobby?.state, lobby?.countdownStartedAt, launchHandled]);

  function launchGame() {
    if (!lobby?.gameMode) return;
    const { kind, id } = lobby.gameMode;
    if (kind === 'warmup') {
      window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'warmup' } }));
    } else if (kind === 'iqGame') {
      localStorage.setItem('ll:logicGameNodeId', id);
      window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'logic' } }));
    } else if (kind === 'program') {
      localStorage.setItem('ll:selectedProgramId', id);
      window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'programMap' } }));
    }
  }

  // ── Leave lobby: removes from party, creates a new solo lobby ─────────────
  const handleLeaveLobby = useCallback(async () => {
    if (!lobbyId || !myUid) return;
    await leaveLobby(lobbyId, myUid);
    // Create a fresh solo lobby for yourself
    const emoji = myEmoji || DEFAULT_EMOJI_LIST[0];
    const doc = await createLobby({ uid: myUid, username: myUsername, emoji });
    await setUserLobby(myUid, doc.id);
    setLobby(null);
    setLobbyId(doc.id);
    setLaunchHandled(false);
  }, [lobbyId, myUid, myUsername, myEmoji]);

  async function handleReady() {
    if (!lobbyId || !myUid) return;
    await setPlayerReady(lobbyId, myUid, !myPlayer?.ready);
  }

  async function handleEmojiSelect(emoji: string) {
    if (!lobbyId || !myUid) return;
    await setPlayerEmoji(lobbyId, myUid, emoji);
  }

  async function handleSetGameMode(mode: LobbyGameMode | null) {
    if (!lobbyId || !myUid) return;
    await setLobbyGameMode(lobbyId, myUid, mode);
  }

  async function handleSetPlayMode(pm: LobbyPlayMode) {
    if (!lobbyId || !myUid) return;
    await setLobbyPlayMode(lobbyId, myUid, pm);
  }

  async function handleStartGame() {
    if (!lobbyId || !myUid) return;
    const result = await startLobbyGame(lobbyId, myUid);
    if (!result.success) alert(result.error ?? 'Cannot start game');
  }

  async function handleSendChat() {
    if (!lobbyId || !myUid || !chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    await sendLobbyChat({ lobbyId, uid: myUid, username: myUsername, text });
  }

  async function handleInvite(friendUid: string, friendUsername: string) {
    if (!lobbyId || !myUid) return;
    setInviteStatus(s => ({ ...s, [friendUid]: 'sending' }));
    const result = await sendLobbyInvite({
      fromUid: myUid, fromUsername: myUsername,
      toUsername: friendUsername, lobbyId,
    });
    setInviteStatus(s => ({ ...s, [friendUid]: result.success ? 'sent' : 'error' }));
    setTimeout(() => setInviteStatus(s => { const n = { ...s }; delete n[friendUid]; return n; }), 3000);
  }

  async function handleJoinRequest(friend: { uid: string; username: string; lobbyId: string | null }) {
    if (!myUid || !friend.lobbyId) return;

    // First we need the leader's uid — we get it from the lobby doc
    const friendLobby = await getLobbyDoc(friend.lobbyId);
    if (!friendLobby) return;

    setJoinReqStatus(s => ({ ...s, [friend.uid]: 'sending' }));
    const result = await sendJoinRequest({
      fromUid: myUid,
      fromUsername: myUsername,
      fromEmoji: myEmoji,
      leaderUid: friendLobby.leaderUid,
      lobbyId: friend.lobbyId,
    });
    setJoinReqStatus(s => ({ ...s, [friend.uid]: result.success ? 'sent' : 'error' }));
    setTimeout(() => setJoinReqStatus(s => { const n = { ...s }; delete n[friend.uid]; return n; }), 3000);
  }

  // ── Ready state ──────────────────────────────────────────────────────────
  const nonLeaderPlayers = lobby?.players.filter(p => !p.isLeader) ?? [];
  const allNonLeadersReady = nonLeaderPlayers.length > 0 && nonLeaderPlayers.every(p => p.ready);
  const canStart = isLeader && !!lobby?.gameMode && (lobby?.players.length ?? 0) >= 2 && allNonLeadersReady;

  const sortedFriends = [...friends].sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return a.username.localeCompare(b.username);
  });

  // ─── Loading state ────────────────────────────────────────────────────────
  if (initializing || !lobby) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a', color: '#64748b', fontSize: 16, flexDirection: 'column', gap: 12,
      }}>
        <div style={{ fontSize: 48, animation: 'll-pulse 1.5s infinite' }}>🏛️</div>
        <div>Setting up your party…</div>
      </div>
    );
  }

  // ─── Lobby Screen ─────────────────────────────────────────────────────────
  const slots = Array.from({ length: LOBBY_MAX_PLAYERS });
  const inOwnLobby = isLeader || lobby.players.length <= 1;

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 60%), #0f172a',
      color: 'var(--ll-text)', overflow: 'hidden', position: 'relative',
    }}>
      {lobby.state === 'countdown' && lobby.countdownStartedAt && (
        <CountdownOverlay startedAt={lobby.countdownStartedAt} />
      )}

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0,
        background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(8px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Only show "Leave Party" if you are in someone else's party */}
          {!inOwnLobby && (
            <button
              onClick={handleLeaveLobby}
              className="ll-btn"
              style={{ padding: '6px 14px', fontSize: 12, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
            >
              ← Leave Party
            </button>
          )}
          <div style={{ fontSize: 14, fontWeight: 800, color: '#f472b6', letterSpacing: 1 }}>
            🏛️ THE LOBBY
          </div>
        </div>
        <div style={{
          fontSize: 11, color: '#64748b', background: '#1e293b',
          padding: '4px 10px', borderRadius: 8, border: '1px solid #334155',
          fontFamily: 'monospace', letterSpacing: 1, cursor: 'pointer',
          userSelect: 'all',
        }}
          title="Click to copy code"
          onClick={() => navigator.clipboard?.writeText(lobby.id).catch(() => {})}
        >
          📋 CODE: {lobby.id.toUpperCase()}
        </div>
      </div>

      {/* Main 3-col layout */}
      <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>

        {/* ── LEFT PANEL ───────────────────────────────────────────────────── */}
        <div style={{
          width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column',
          borderRight: '1px solid #1e293b', background: 'rgba(15,23,42,0.5)', overflowY: 'auto',
        }}>
          <div style={{ padding: '16px 16px 12px', flex: 1 }}>
            {/* Game mode selector */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>
                🎮 Game Mode
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {(['warmup', 'iqGame', 'program'] as const).map(k => (
                  <button key={k}
                    onClick={() => isLeader && setModeKind(k)}
                    style={{
                      flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                      border: `1px solid ${modeKind === k ? '#6366f1' : '#334155'}`,
                      background: modeKind === k ? 'rgba(99,102,241,0.2)' : 'transparent',
                      color: modeKind === k ? '#a5b4fc' : '#64748b',
                      cursor: isLeader ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {k === 'warmup' ? '⚡ Warmup' : k === 'iqGame' ? '🧠 IQ' : '📖 Program'}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {modeKind === 'warmup' && WARMUP_GAMES.map(g => (
                  <button key={g.id} disabled={!isLeader}
                    onClick={() => handleSetGameMode({ kind: 'warmup', id: g.id, label: g.label })}
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 12, textAlign: 'left',
                      border: `1px solid ${lobby.gameMode?.id === g.id ? '#6366f1' : '#334155'}`,
                      background: lobby.gameMode?.id === g.id ? 'rgba(99,102,241,0.2)' : 'transparent',
                      color: lobby.gameMode?.id === g.id ? '#a5b4fc' : 'var(--ll-text)',
                      cursor: isLeader ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  ><span>{g.icon}</span> {g.label}</button>
                ))}
                {modeKind === 'iqGame' && iqNodes.map(n => (
                  <button key={n.id} disabled={!isLeader}
                    onClick={() => handleSetGameMode({ kind: 'iqGame', id: n.id, label: n.label, subtitle: `IQ ${n.iq}+` })}
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 12, textAlign: 'left',
                      border: `1px solid ${lobby.gameMode?.id === n.id ? '#6366f1' : '#334155'}`,
                      background: lobby.gameMode?.id === n.id ? 'rgba(99,102,241,0.2)' : 'transparent',
                      color: lobby.gameMode?.id === n.id ? '#a5b4fc' : 'var(--ll-text)',
                      cursor: isLeader ? 'pointer' : 'not-allowed',
                    }}
                  >🧠 {n.label} <span style={{ color: '#64748b', fontSize: 10 }}>IQ {n.iq}+</span></button>
                ))}
                {modeKind === 'iqGame' && iqNodes.length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>No IQ levels available</div>
                )}
                {modeKind === 'program' && (
                  <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>Program mode coming soon!</div>
                )}
              </div>

              {lobby.gameMode && (
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 10,
                  background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                  fontSize: 12, color: '#a5b4fc', fontWeight: 700,
                }}>
                  ✅ {lobby.gameMode.label}
                  {lobby.gameMode.subtitle && <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 4 }}>({lobby.gameMode.subtitle})</span>}
                </div>
              )}
            </div>

            {/* Play mode toggle */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, letterSpacing: 2, marginBottom: 8, textTransform: 'uppercase' }}>
                🔀 Play Mode
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['freePace', 'live'] as LobbyPlayMode[]).map(pm => (
                  <button key={pm} onClick={() => isLeader && handleSetPlayMode(pm)}
                    style={{
                      flex: 1, padding: '8px 6px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      border: `1px solid ${lobby.playMode === pm ? '#f472b6' : '#334155'}`,
                      background: lobby.playMode === pm ? 'rgba(244,114,182,0.15)' : 'transparent',
                      color: lobby.playMode === pm ? '#f9a8d4' : '#64748b',
                      cursor: isLeader ? 'pointer' : 'not-allowed',
                    }}
                  >{pm === 'freePace' ? '🏃 Free Pace' : '⚡ Live Sync'}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 6, lineHeight: 1.4 }}>
                {lobby.playMode === 'live'
                  ? '⚡ All players see the same question simultaneously.'
                  : '🏃 Each player plays at their own pace. Best score wins!'}
              </div>
            </div>

            {/* Ready / Start button */}
            {isLeader ? (
              <button
                onClick={handleStartGame} disabled={!canStart}
                className="ll-btn ll-btn-primary"
                style={{
                  width: '100%', padding: '14px', fontSize: 15, fontWeight: 900,
                  borderRadius: 12, marginBottom: 12, opacity: canStart ? 1 : 0.4,
                  boxShadow: canStart ? '0 0 24px rgba(99,102,241,0.5)' : 'none', transition: 'all 0.3s',
                }}
              >🚀 START GAME</button>
            ) : (
              <button
                onClick={handleReady}
                className={`ll-btn ${myPlayer?.ready ? '' : 'll-btn-primary'}`}
                style={{
                  width: '100%', padding: '14px', fontSize: 15, fontWeight: 900,
                  borderRadius: 12, marginBottom: 12,
                  background: myPlayer?.ready ? 'rgba(52,211,153,0.2)' : undefined,
                  borderColor: myPlayer?.ready ? '#34d399' : undefined,
                  color: myPlayer?.ready ? '#34d399' : undefined,
                  boxShadow: myPlayer?.ready ? '0 0 20px rgba(52,211,153,0.3)' : '0 0 20px rgba(99,102,241,0.3)',
                  transition: 'all 0.3s',
                }}
              >{myPlayer?.ready ? '✅ READY!' : '⬜ READY UP'}</button>
            )}

            {isLeader && !canStart && (
              <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center', lineHeight: 1.4 }}>
                {!lobby.gameMode ? 'Select a game mode above'
                  : lobby.players.length < 2 ? 'Need at least 2 players'
                  : 'Waiting for all players to ready up'}
              </div>
            )}
          </div>

          {/* Chat */}
          <div style={{ borderTop: '1px solid #1e293b', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, letterSpacing: 2, padding: '8px 16px 4px', textTransform: 'uppercase' }}>
              💬 Party Chat
            </div>
            <div style={{ height: 140, overflowY: 'auto', padding: '0 12px 6px' }}>
              {(lobby.chat ?? []).length === 0 && (
                <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', paddingTop: 20 }}>Say hi to your party! 👋</div>
              )}
              {(lobby.chat ?? []).map((msg, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: msg.uid === myUid ? '#a78bfa' : '#94a3b8', fontWeight: 700, fontSize: 11 }}>{msg.username}: </span>
                  <span style={{ color: '#cbd5e1', fontSize: 12 }}>{msg.text}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '6px 12px 10px' }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSendChat(); }}
                placeholder="Message…" maxLength={200}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 8,
                  background: '#1e293b', border: '1px solid #334155',
                  color: 'var(--ll-text)', fontSize: 12, fontFamily: 'inherit',
                }}
              />
              <button
                onClick={handleSendChat} disabled={!chatInput.trim()}
                style={{
                  padding: '7px 12px', borderRadius: 8, border: 'none',
                  background: chatInput.trim() ? '#6366f1' : '#1e293b',
                  color: 'white', fontSize: 14, cursor: 'pointer',
                }}
              >➤</button>
            </div>
          </div>
        </div>

        {/* ── CENTER PANEL ─────────────────────────────────────────────────── */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '24px 16px', position: 'relative',
        }}>
          <div style={{ marginBottom: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
              {lobby.players.length} / {LOBBY_MAX_PLAYERS} Players
            </div>
            {lobby.gameMode && (
              <div style={{ fontSize: 14, fontWeight: 700, color: '#a5b4fc' }}>
                {lobby.gameMode.kind === 'iqGame' ? '🧠' : lobby.gameMode.kind === 'warmup' ? '⚡' : '📖'}{' '}
                {lobby.gameMode.label}
                <span style={{
                  marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 10,
                  background: lobby.playMode === 'live' ? 'rgba(244,114,182,0.15)' : 'rgba(52,211,153,0.1)',
                  color: lobby.playMode === 'live' ? '#f9a8d4' : '#86efac',
                  border: `1px solid ${lobby.playMode === 'live' ? 'rgba(244,114,182,0.3)' : 'rgba(52,211,153,0.2)'}`,
                }}>
                  {lobby.playMode === 'live' ? '⚡ Live Sync' : '🏃 Free Pace'}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap' }}>
            {slots.map((_, i) => {
              const player = lobby.players[i];
              const isMe = player?.uid === myUid;
              return (
                <div key={i} style={{ position: 'relative' }}>
                  <PlayerSlot player={player} isMe={isMe} isEmpty={!player}
                    onEmojiClick={() => isMe && setShowEmojiPicker(v => !v)} />
                  {isMe && showEmojiPicker && (
                    <EmojiPicker current={myEmoji} onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
                  )}
                </div>
              );
            })}
          </div>

          {showEmojiPicker && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowEmojiPicker(false)} />
          )}

          <div style={{
            position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
            width: '80%', height: 100,
            background: 'radial-gradient(ellipse at center bottom, rgba(99,102,241,0.12) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
        </div>

        {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}
        <div style={{
          width: 240, flexShrink: 0, borderLeft: '1px solid #1e293b',
          background: 'rgba(15,23,42,0.5)', display: 'flex', flexDirection: 'column', overflowY: 'auto',
        }}>
          <div style={{ padding: '16px 14px 8px' }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, letterSpacing: 2, marginBottom: 12, textTransform: 'uppercase' }}>
              👥 Friends
            </div>

            {sortedFriends.length === 0 && (
              <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', paddingTop: 20 }}>
                No friends yet.<br />Add friends to invite them!
              </div>
            )}

            {sortedFriends.map(friend => {
              const alreadyInParty = lobby.players.some(p => p.uid === friend.uid);
              const inOtherLobby = !alreadyInParty && !!friend.lobbyId && friend.lobbyId !== lobbyId;
              const invStatus = inviteStatus[friend.uid];
              const reqStatus = joinReqStatus[friend.uid];

              return (
                <div key={friend.uid} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 6px', borderRadius: 8,
                  background: alreadyInParty ? 'rgba(99,102,241,0.08)' : 'transparent',
                  marginBottom: 4,
                }}>
                  {/* Online dot */}
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: friend.isOnline ? '#22c55e' : '#475569',
                    boxShadow: friend.isOnline ? '0 0 6px #22c55e' : 'none',
                  }} />

                  {/* Name */}
                  <div style={{
                    flex: 1, fontSize: 12, fontWeight: 600,
                    color: alreadyInParty ? '#a5b4fc' : friend.isOnline ? 'var(--ll-text)' : '#64748b',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {friend.username}
                    {inOtherLobby && (
                      <div style={{ fontSize: 9, color: '#f472b6', fontWeight: 700 }}>In a party</div>
                    )}
                  </div>

                  {/* Action button */}
                  {alreadyInParty ? (
                    <span style={{ fontSize: 9, color: '#6366f1', fontWeight: 700, whiteSpace: 'nowrap' }}>IN PARTY</span>
                  ) : inOtherLobby ? (
                    // Request to join their party
                    <button
                      onClick={() => handleJoinRequest(friend)}
                      disabled={!!reqStatus}
                      style={{
                        padding: '4px 7px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                        border: `1px solid ${reqStatus === 'sent' ? '#22c55e' : reqStatus === 'error' ? '#ef4444' : '#f472b6'}`,
                        background: reqStatus === 'sent' ? 'rgba(34,197,94,0.1)' : reqStatus === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(244,114,182,0.1)',
                        color: reqStatus === 'sent' ? '#22c55e' : reqStatus === 'error' ? '#ef4444' : '#f9a8d4',
                        cursor: reqStatus ? 'default' : 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {reqStatus === 'sending' ? '…' : reqStatus === 'sent' ? '✓ Sent' : reqStatus === 'error' ? 'Error' : '🚪 Join'}
                    </button>
                  ) : (
                    // Invite to your party
                    <button
                      onClick={() => handleInvite(friend.uid, friend.username)}
                      disabled={!!invStatus}
                      style={{
                        padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                        border: `1px solid ${invStatus === 'sent' ? '#22c55e' : invStatus === 'error' ? '#ef4444' : '#334155'}`,
                        background: invStatus === 'sent' ? 'rgba(34,197,94,0.1)' : invStatus === 'error' ? 'rgba(239,68,68,0.1)' : 'transparent',
                        color: invStatus === 'sent' ? '#22c55e' : invStatus === 'error' ? '#ef4444' : '#94a3b8',
                        cursor: invStatus ? 'default' : 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      {invStatus === 'sending' ? '…' : invStatus === 'sent' ? '✓ Sent' : invStatus === 'error' ? 'Error' : 'Invite'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
