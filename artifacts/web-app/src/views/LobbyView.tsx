import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createLobby,
  joinLobby,
  leaveLobby,
  setPlayerReady,
  setPlayerEmoji,
  setLobbyGameMode,
  setLobbyLeader,
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
  setLobbyState,
  kickPlayerFromLobby,
  DEFAULT_EMOJI_LIST,
  LOBBY_MAX_PLAYERS,
} from '@/lib/lobbyService';
import { createPartyMatch } from '@/lib/partyMatchService';
import { listLogicGameNodes } from '@/lib/logicGamesService';
import type { LobbyDoc, LobbyGameMode } from '@/types/lobby';
import type { LogicGameNode } from '@/types/logicGames';
import { listMyPersonalPrograms, type PersonalProgramMeta } from '@/lib/personalProgramService';

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

// ─── Inline Countdown ────────────────────────────────────────────────────────
function InlineCountdown({ startedAt }: { startedAt: string }) {
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
      textAlign: 'center', padding: '12px', background: 'rgba(0,0,0,0.3)',
      borderRadius: 12, border: `1px solid ${secs === 0 ? '#34d399' : '#f472b6'}`,
      marginTop: 8, transition: 'all 0.3s'
    }}>
      <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Starting in</div>
      <div style={{
        fontSize: secs === 0 ? 32 : 48, fontWeight: 900, lineHeight: 1,
        color: secs === 0 ? '#34d399' : '#f472b6',
        textShadow: `0 0 20px ${secs === 0 ? '#34d399' : '#f472b6'}`,
      }}>
        {secs === 0 ? 'GO!' : secs}
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

// ─── V-Shape slot positions (x offset, y offset from baseline) ──────────────
// The V opens upward — center slot (idx 2) is lowest, outer slots are higher.
const V_OFFSETS: { x: number; y: number }[] = [
  { x: -230, y: -90 },  // slot 0 — far left, highest
  { x: -120, y: -30 },  // slot 1 — mid left
  { x:    0, y:  30 },  // slot 2 — CENTER (owner) — lowest
  { x:  120, y: -30 },  // slot 3 — mid right
  { x:  230, y: -90 },  // slot 4 — far right, highest
];

// ─── Player Slot ──────────────────────────────────────────────────────────────
function PlayerSlot({ player, isMe, amILeader, onEmojiClick, onPlayerClick, isEmpty }: {
  player?: { uid: string; username: string; emoji: string; ready: boolean; isLeader: boolean };
  isMe: boolean; amILeader: boolean; onEmojiClick?: () => void; onPlayerClick?: (e: React.MouseEvent) => void; isEmpty?: boolean;
}) {
  if (isEmpty || !player) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, opacity: 0.25 }}>
        <div style={{
          width: 110, height: 110, borderRadius: '50%', border: '2px dashed #334155',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, color: '#475569',
        }}>+</div>
        <div style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>Empty Slot</div>
      </div>
    );
  }

  return (
    <div 
      style={{ 
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        cursor: isMe || (amILeader && !player.isLeader) ? 'pointer' : 'default',
      }}
      onClick={e => isMe ? onEmojiClick?.() : onPlayerClick?.(e)}
      title={isMe ? 'Click to change emoji' : amILeader && !player.isLeader ? 'Click to manage player' : undefined}
    >
      <div style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {player.isLeader && <span style={{ fontSize: 20 }}>👑</span>}
      </div>
      <div
        style={{
          width: 110, height: 110, borderRadius: '50%', fontSize: 52,
          background: player.ready
            ? 'radial-gradient(circle, rgba(52,211,153,0.3), rgba(52,211,153,0.06))'
            : 'radial-gradient(circle, rgba(99,102,241,0.3), rgba(99,102,241,0.06))',
          border: `3px solid ${player.ready ? '#34d399' : isMe ? '#a78bfa' : '#475569'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.3s',
          boxShadow: player.ready
            ? '0 0 28px rgba(52,211,153,0.5)'
            : isMe ? '0 0 28px rgba(167,139,250,0.4)' : 'none',
          position: 'relative',
        }}
      >
        {player.emoji}
        {player.ready && (
          <div style={{
            position: 'absolute', top: -5, right: -5, background: '#34d399',
            borderRadius: '50%', width: 28, height: 28,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, border: '2px solid #0f172a',
          }}>✅</div>
        )}
        {isMe && !player.ready && (
          <div style={{
            position: 'absolute', bottom: -2, right: -2, background: '#a78bfa',
            borderRadius: '50%', width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, border: '2px solid #0f172a',
          }}>✏️</div>
        )}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 700,
        color: isMe ? '#a78bfa' : 'var(--ll-text)',
        maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center',
      }}>
        {player.username}{isMe ? ' (you)' : ''}
      </div>
      <div style={{
        fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
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
  const [personalPrograms, setPersonalPrograms] = useState<PersonalProgramMeta[]>([]);

  const [friends, setFriends] = useState<(
    { uid: string; username: string; isOnline: boolean; lobbyId: string | null; lastActive: string }
  )[]>([]);
  const [inviteStatus, setInviteStatus] = useState<Record<string, string>>({});
  const [joinReqStatus, setJoinReqStatus] = useState<Record<string, string>>({});

  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [playerMenuTarget, setPlayerMenuTarget] = useState<{ uid: string; username: string; isLeader: boolean } | null>(null);
  const [launchHandled, setLaunchHandled] = useState(false);

  const [rightTab, setRightTab] = useState<'friends' | 'invite'>('friends');
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteTag, setInviteTag] = useState('');
  const [manualInviteStatus, setManualInviteStatus] = useState<{ type: 'sending' | 'sent' | 'error', msg?: string } | null>(null);

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
          // Leave current solo lobby first
          const currentId = await getUserLobbyId(myUid);
          if (currentId && currentId !== pendingLobbyId) {
            await leaveLobby(currentId, myUid).catch(() => {});
          }
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

  // ── Load game modes ────────────────────────────────────────────────────────
  useEffect(() => {
    listLogicGameNodes().then(nodes => setIqNodes(nodes.filter(n => !!n.publishedAt))).catch(() => {});
    if (myUid) {
      listMyPersonalPrograms(myUid).then(setPersonalPrograms).catch(() => {});
    }
  }, [myUid]);

  // ── Auto-kick offline players (leader only) ────────────────────────────────
  useEffect(() => {
    if (!lobbyId || !isLeader || lobby?.state !== 'waiting') return;
    
    const id = setInterval(async () => {
      if (!lobby) return;
      const otherUids = lobby.players.map(p => p.uid).filter(u => u !== myUid);
      if (otherUids.length === 0) return;
      
      try {
        // Use a short 35-second threshold for auto-kick in the lobby
        const presences = await getFriendsWithPresence(otherUids, 35_000);
        for (const p of presences) {
          if (!p.isOnline) {
            await leaveLobby(lobbyId, p.uid);
          }
        }
      } catch {
        // ignore errors
      }
    }, 10_000);
    
    return () => clearInterval(id);
  }, [lobbyId, isLeader, lobby?.state, lobby, myUid]);

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
      if (isLeader) {
        setLobbyState(lobbyId, 'inGame').catch(() => {});
        if (lobby.gameMode?.kind === 'warmup' && lobby.players.length > 1) {
          createPartyMatch({
            lobbyId,
            gameId: lobby.gameMode.id,
            hostUid: myUid,
            players: lobby.players.map(p => ({ uid: p.uid, username: p.username, emoji: p.emoji, score: 0 }))
          }).catch(() => {});
        }
      }
      launchGame();
    }, delay);
    return () => clearInterval(timer);
  }, [lobby?.state, lobby?.countdownStartedAt, launchHandled, isLeader, lobbyId]);

  function launchGame() {
    if (!lobby?.gameMode) return;
    const { kind, id } = lobby.gameMode;
    if (kind === 'warmup') {
      if (lobby.players.length > 1) {
        localStorage.setItem('ll:partyMatchId', lobbyId);
        window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'partyMatch' } }));
      } else {
        localStorage.setItem('ll:warmupGameId', id);
        window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'warmup' } }));
      }
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
    setLobby(prev => prev ? { ...prev, gameMode: mode, players: prev.players.map(p => ({ ...p, ready: false })) } : prev);
    await setLobbyGameMode(lobbyId, myUid, mode);
  }

  function handlePlayerClick(player: { uid: string; username: string; isLeader: boolean }, e?: React.MouseEvent) {
    if (!lobbyId || !myUid) return;
    if (isLeader && !player.isLeader) {
      if (e) {
        e.stopPropagation();
      }
      setPlayerMenuTarget(player);
    }
  }

  function handlePromotePlayer() {
    if (!lobbyId || !myUid || !playerMenuTarget) return;
    setLobbyLeader(lobbyId, myUid, playerMenuTarget.uid).catch(e => alert(e.message ?? 'Failed to promote'));
    setPlayerMenuTarget(null);
  }

  function handleKickPlayer() {
    if (!lobbyId || !myUid || !playerMenuTarget) return;
    kickPlayerFromLobby(lobbyId, myUid, playerMenuTarget.uid).catch(e => alert(e.message ?? 'Failed to kick'));
    setPlayerMenuTarget(null);
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

  async function handleManualInvite() {
    if (!lobbyId || !myUid || !inviteUsername.trim() || !inviteTag.trim()) return;
    setManualInviteStatus({ type: 'sending' });
    const result = await sendLobbyInvite({
      fromUid: myUid, fromUsername: myUsername,
      toUsername: inviteUsername, toTag: inviteTag.trim(), lobbyId,
    });
    setManualInviteStatus({ type: result.success ? 'sent' : 'error', msg: result.error });
    if (result.success) {
      setInviteUsername('');
      setInviteTag('');
    }
    setTimeout(() => setManualInviteStatus(null), 3000);
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


  const sortedFriends = [...friends].sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;
    return a.username.localeCompare(b.username);
  });

  // ── Build V-shape slot array: owner always at center (index 2) ────────────
  // Slot layout: [other] [other] [ME] [other] [other]
  const vSlots: (any | undefined)[] = Array(LOBBY_MAX_PLAYERS).fill(undefined);
  const me = lobby?.players.find(p => p.uid === myUid);
  const others = lobby?.players.filter(p => p.uid !== myUid) ?? [];
  // Place me at slot 2 (center)
  vSlots[2] = me;
  // Fill remaining slots: 1, 3, 0, 4 (close to center first)
  const fillOrder = [1, 3, 0, 4];
  others.forEach((p, idx) => {
    if (fillOrder[idx] !== undefined) vSlots[fillOrder[idx]] = p;
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

  // ─── In Game state ────────────────────────────────────────────────────────
  if (lobby.state === 'inGame') {
    return (
      <div style={{ padding: 24, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <div style={{ fontSize: 48, animation: 'll-pulse 1.5s infinite' }}>🎮</div>
        <h2 style={{ color: 'var(--ll-text)', marginBottom: 12, marginTop: 16 }}>Match in Progress</h2>
        <div style={{ color: 'var(--ll-text-muted)', marginBottom: 32 }}>Your party is currently playing <strong>{lobby.gameMode?.label}</strong>.</div>
        
        <button onClick={launchGame} className="ll-btn ll-btn-primary" style={{ padding: '14px 28px', fontSize: 16, fontWeight: 900, marginBottom: 16, width: '100%', maxWidth: 300 }}>
          Rejoin Game
        </button>
        
        {isLeader && (
          <button onClick={() => setLobbyState(lobbyId, 'waiting')} className="ll-btn" style={{ borderColor: '#ef4444', color: '#ef4444', padding: '10px 20px', fontSize: 14, width: '100%', maxWidth: 300 }}>
            End Game for Party
          </button>
        )}
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

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0,
        background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(8px)',
        position: 'relative'
      }}>
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 14, fontWeight: 800, color: '#f472b6', letterSpacing: 1 }}>
          🏛️ THE LOBBY
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
                {modeKind === 'program' && personalPrograms.map(p => (
                  <button key={p.programId} disabled={!isLeader}
                    onClick={() => handleSetGameMode({ kind: 'program', id: p.programId, label: p.title })}
                    style={{
                      padding: '8px 10px', borderRadius: 8, fontSize: 12, textAlign: 'left',
                      border: `1px solid ${lobby.gameMode?.id === p.programId ? '#6366f1' : '#334155'}`,
                      background: lobby.gameMode?.id === p.programId ? 'rgba(99,102,241,0.2)' : 'transparent',
                      color: lobby.gameMode?.id === p.programId ? '#a5b4fc' : 'var(--ll-text)',
                      cursor: isLeader ? 'pointer' : 'not-allowed',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{p.coverEmoji || '📄'}</span>
                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
                  </button>
                ))}
                {modeKind === 'program' && personalPrograms.length === 0 && (
                  <div style={{ color: '#64748b', fontSize: 12, padding: 8 }}>No programs available. Import some PDFs first!</div>
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

            {/* Ready / Start button */}
            {(() => {
              const cannotReady = !myPlayer?.ready && (!lobby.gameMode || lobby.players.length < 2);
              return (
                <button
                  onClick={handleReady}
                  disabled={cannotReady}
                  className={`ll-btn ${myPlayer?.ready ? '' : 'll-btn-primary'}`}
                  style={{
                    width: '100%', padding: '14px', fontSize: 15, fontWeight: 900,
                    borderRadius: 12, marginBottom: 12,
                    background: myPlayer?.ready ? 'rgba(52,211,153,0.2)' : undefined,
                    borderColor: myPlayer?.ready ? '#34d399' : undefined,
                    color: myPlayer?.ready ? '#34d399' : undefined,
                    boxShadow: myPlayer?.ready ? '0 0 20px rgba(52,211,153,0.3)' : '0 0 20px rgba(99,102,241,0.3)',
                    opacity: cannotReady ? 0.5 : 1,
                    cursor: cannotReady ? 'not-allowed' : 'pointer',
                    transition: 'all 0.3s',
                  }}
                >{myPlayer?.ready ? '✅ READY!' : '⬜ READY UP'}</button>
              );
            })()}

            {lobby.state === 'countdown' && lobby.countdownStartedAt && (
              <InlineCountdown startedAt={lobby.countdownStartedAt} />
            )}

            {!lobby.gameMode ? (
              <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center', lineHeight: 1.4, marginBottom: 8 }}>
                {isLeader ? 'Select a game mode above' : 'Waiting for leader to select game mode'}
              </div>
            ) : null}

            {/* Leave Party Button */}
            <button
              onClick={handleLeaveLobby}
              className="ll-btn"
              style={{
                width: '100%', padding: '10px', fontSize: 13, fontWeight: 700,
                borderRadius: 10, marginTop: 4,
                borderColor: '#ef4444', color: '#ef4444',
                background: 'rgba(239,68,68,0.05)',
              }}
            >
              ← Leave Party
            </button>
          </div>

          {/* Chat */}
          <div style={{ borderTop: '1px solid #1e293b', flexShrink: 0 }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800, letterSpacing: 2, padding: '8px 16px 4px', textTransform: 'uppercase' }}>
              💬 Party Chat
            </div>
            <div style={{ height: 140, overflowY: 'auto', padding: '0 12px 6px' }}>
              {lobby.players.length <= 1 ? (
                <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', paddingTop: 20 }}>
                  Waiting for players to join your party...
                </div>
              ) : (
                <>
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
                </>
              )}
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
              </div>
            )}
          </div>

          {/* V-shape player slots — absolute positioned around center */}
          <div style={{
            position: 'relative',
            width: 600,
            height: 280,
            flexShrink: 0,
          }}>
            {vSlots.map((player, i) => {
              const off = V_OFFSETS[i];
              const isMe = player?.uid === myUid;
              // Translate: center of container is (300, 140)
              const left = 300 + off.x - 55; // 55 = half of slot width (110/2)
              const top  = 140 + off.y;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left,
                    top,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >
                  <PlayerSlot
                    player={player}
                    isMe={isMe}
                    amILeader={isLeader}
                    isEmpty={!player}
                    onEmojiClick={() => isMe && setShowEmojiPicker(v => !v)}
                    onPlayerClick={(e) => player && handlePlayerClick(player, e as unknown as React.MouseEvent)}
                  />
                  {isMe && showEmojiPicker && (
                    <EmojiPicker
                      current={myEmoji}
                      onSelect={handleEmojiSelect}
                      onClose={() => setShowEmojiPicker(false)}
                    />
                  )}
                  {playerMenuTarget && player && playerMenuTarget.uid === player.uid && (
                    <div style={{
                      position: 'absolute', top: 110, left: '50%', transform: 'translateX(-50%)',
                      background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
                      padding: 4, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 4,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.5)', width: 160
                    }}>
                      <button onClick={(e) => { e.stopPropagation(); handlePromotePlayer(); }} className="ll-btn" style={{ padding: '8px', fontSize: 11, width: '100%' }}>
                        Promote to Party Leader
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleKickPlayer(); }} className="ll-btn" style={{ padding: '8px', fontSize: 11, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', width: '100%' }}>
                        Remove from Party
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(showEmojiPicker || playerMenuTarget) && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => { setShowEmojiPicker(false); setPlayerMenuTarget(null); }} />
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
          <div style={{ display: 'flex', borderBottom: '1px solid #1e293b' }}>
            <button
              onClick={() => setRightTab('friends')}
              style={{
                flex: 1, padding: '12px 0', fontSize: 11, fontWeight: 800, letterSpacing: 1,
                textTransform: 'uppercase', background: 'transparent', border: 'none', cursor: 'pointer',
                color: rightTab === 'friends' ? '#a78bfa' : '#64748b',
                borderBottom: `2px solid ${rightTab === 'friends' ? '#a78bfa' : 'transparent'}`,
              }}
            >
              👥 Friends
            </button>
            <button
              onClick={() => setRightTab('invite')}
              style={{
                flex: 1, padding: '12px 0', fontSize: 11, fontWeight: 800, letterSpacing: 1,
                textTransform: 'uppercase', background: 'transparent', border: 'none', cursor: 'pointer',
                color: rightTab === 'invite' ? '#34d399' : '#64748b',
                borderBottom: `2px solid ${rightTab === 'invite' ? '#34d399' : 'transparent'}`,
              }}
            >
              ✉️ Invite
            </button>
          </div>

          <div style={{ padding: '16px 14px 8px' }}>
            {rightTab === 'friends' ? (
              <>
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
                      ) : (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {inOtherLobby && (
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
                              {reqStatus === 'sending' ? '…' : reqStatus === 'sent' ? '✓ Sent' : reqStatus === 'error' ? 'Error' : '🚪 Request to Join'}
                            </button>
                          )}
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Username</label>
                  <input
                    type="text"
                    value={inviteUsername}
                    onChange={e => setInviteUsername(e.target.value)}
                    placeholder="Enter username"
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: 8,
                      background: '#1e293b', border: '1px solid #334155',
                      color: 'white', fontSize: 13, outline: 'none',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: '#64748b', marginBottom: 4, textTransform: 'uppercase' }}>Tag</label>
                  <div style={{ display: 'flex', alignItems: 'center', background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}>
                    <span style={{ padding: '8px 4px 8px 12px', color: '#64748b', fontSize: 13 }}>#</span>
                    <input
                      type="text"
                      value={inviteTag}
                      onChange={e => setInviteTag(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="1234"
                      style={{
                        flex: 1, padding: '8px 12px 8px 4px', background: 'transparent',
                        border: 'none', color: 'white', fontSize: 13, outline: 'none',
                      }}
                    />
                  </div>
                </div>

                {manualInviteStatus && (
                  <div style={{
                    fontSize: 12, fontWeight: 600, marginTop: 4,
                    color: manualInviteStatus.type === 'error' ? '#ef4444' : manualInviteStatus.type === 'sent' ? '#22c55e' : '#f472b6',
                  }}>
                    {manualInviteStatus.type === 'sending' ? 'Sending...' : manualInviteStatus.type === 'sent' ? 'Invite sent successfully!' : `Error: ${manualInviteStatus.msg}`}
                  </div>
                )}

                <button
                  onClick={handleManualInvite}
                  disabled={!inviteUsername.trim() || !inviteTag.trim() || manualInviteStatus?.type === 'sending'}
                  className="ll-btn ll-btn-primary"
                  style={{
                    width: '100%', padding: '10px', fontSize: 13, fontWeight: 700,
                    borderRadius: 8, marginTop: 8,
                    opacity: !inviteUsername.trim() || !inviteTag.trim() || manualInviteStatus?.type === 'sending' ? 0.5 : 1,
                  }}
                >
                  Send Invite
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
