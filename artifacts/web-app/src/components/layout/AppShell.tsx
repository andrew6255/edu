import { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { useLocation } from 'wouter';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { computeLevel } from '@/lib/userService';
import NotificationsView from '@/views/NotificationsView';
import FriendsView from '@/views/FriendsView';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useSession } from '@/contexts/SessionContext';
import { forfeitSession } from '@/lib/gameSessionService';
import type { AppNotification } from '@/lib/userService';

type View =
  | 'emporium'
  | 'warmup'
  | 'universe'
  | 'logic'
  | 'profile'
  | 'curriculum'
  | 'programMap'
  | 'studySessions'
  | 'notifications'
  | 'friends';

interface AppShellProps {
  view: View;
  setView: (v: View) => void;
  children: React.ReactNode;
}

export default function AppShell({ view, setView, children }: AppShellProps) {
  const { user, userData, refreshUserData } = useAuth();
  const { ongoingWarmup, activeSession, setActiveSession, setOngoingWarmup } = useSession();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [notifBadgeCount, setNotifBadgeCount] = useState(0);

  const abandonTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (abandonTimerRef.current) {
      window.clearTimeout(abandonTimerRef.current);
      abandonTimerRef.current = null;
    }

    if (!user) return;
    if (!activeSession) return;
    if (view === 'warmup') return;

    abandonTimerRef.current = window.setTimeout(async () => {
      try {
        await forfeitSession(activeSession.sessionId, user.uid);
      } finally {
        setActiveSession(null);
        setOngoingWarmup(null);
      }
    }, 30000);

    return () => {
      if (abandonTimerRef.current) {
        window.clearTimeout(abandonTimerRef.current);
        abandonTimerRef.current = null;
      }
    };
  }, [user, view, activeSession]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const q = query(collection(db, `users/${uid}/notifications`));
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs.map(d => d.data() as AppNotification);
      const count = items.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);
      setNotifBadgeCount(count);
    });
    return unsub;
  }, [user]);

  const gold = userData?.economy?.gold ?? 0;
  const xp = userData?.economy?.global_xp ?? 0;
  const streak = userData?.economy?.streak ?? 0;
  const energy = userData?.economy?.energy ?? 0;
  const rankedEnergyStreak = userData?.economy?.rankedEnergyStreak ?? 0;
  const username = userData?.username ?? 'Student';
  const role = userData?.role ?? 'student';
  const { level, title } = computeLevel(xp);

  const studyOngoingSessionId = typeof window !== 'undefined' ? localStorage.getItem('ll:ongoingStudySessionId') : null;
  const studyOngoingProgramId = typeof window !== 'undefined' ? localStorage.getItem('ll:ongoingStudyProgramId') : null;

  const ongoingBadge = ongoingWarmup && view !== 'warmup' ? 1 : 0;
  const hudBadgeCount = notifBadgeCount + ongoingBadge;

  const maxXP = level * 1000;
  const prevXP = (level - 1) * 1000;
  const xpPct = Math.min(100, ((xp - prevXP) / (maxXP - prevXP)) * 100);

  const battery = Math.max(0, Math.min(3, Math.floor(rankedEnergyStreak)));

  async function handleLogout() {
    await signOut(auth);
    localStorage.clear();
    setLocation('/');
  }


  const navTabs = [
    { id: 'emporium', icon: '🕰️', label: 'Chrono Empires' },
    { id: 'warmup', icon: '⚡', label: 'Warmup' },
    { id: 'universe', icon: '🌌', label: 'Universe' },
    { id: 'logic', icon: '🧩', label: 'Logic Games' },
    { id: 'profile', icon: '👤', label: 'Profile' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', overflow: 'hidden' }}>
      {/* Top HUD */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', background: 'rgba(0,0,0,0.85)',
        borderBottom: '1px solid #334155', zIndex: 10, flexShrink: 0,
        backdropFilter: 'blur(10px)', gap: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 18, fontWeight: 'bold', letterSpacing: 1 }}>⚔️ LOGIC LORDS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, overflow: 'hidden' }}>
          <span style={{ color: '#fbbf24', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🪙 {gold.toLocaleString()}</span>
          <span style={{ color: '#a78bfa', fontWeight: 'bold', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
            ⚡ {Math.max(0, Math.floor(energy)).toLocaleString()}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <span style={{ width: 14, height: 8, borderRadius: 2, border: '1px solid rgba(148,163,184,0.7)', background: 'rgba(30,41,59,0.85)', overflow: 'hidden', display: 'inline-flex' }}>
                <span style={{ width: 4, height: '100%', background: battery >= 1 ? '#a78bfa' : 'rgba(100,116,139,0.35)' }} />
                <span style={{ width: 4, height: '100%', background: battery >= 2 ? '#a78bfa' : 'rgba(100,116,139,0.35)' }} />
                <span style={{ width: 4, height: '100%', background: battery >= 3 ? '#a78bfa' : 'rgba(100,116,139,0.35)' }} />
              </span>
              <span style={{ width: 2, height: 5, borderRadius: 1, background: 'rgba(148,163,184,0.7)' }} />
            </span>
          </span>
          <span style={{ color: '#f97316', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🔥 {streak}</span>
        </div>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: '#1e293b',
            border: '2px solid #475569',
            color: 'white', cursor: 'pointer', fontSize: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative'
          }}
        >
          {username[0]?.toUpperCase() || '?'}
          {hudBadgeCount > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 999, background: '#ef4444',
              color: 'white', fontSize: 10, fontWeight: 'bold',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid rgba(0,0,0,0.85)'
            }}>
              {hudBadgeCount > 99 ? '99+' : hudBadgeCount}
            </span>
          )}

        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, height: '100%', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>

      {/* Bottom nav */}
      <div style={{
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        background: 'rgba(15,23,42,0.98)', borderTop: '1px solid #334155',
        paddingTop: 8, paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
        zIndex: 10, flexShrink: 0
      }}>
        {navTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              flex: 1, background: 'none', border: 'none',
              color: view === tab.id ? '#3b82f6' : '#64748b',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              cursor: 'pointer', transition: '0.2s', fontFamily: 'inherit', padding: '4px 0',
              outline: 'none'
            }}
          >
            <span style={{
              fontSize: 22, transition: 'transform 0.2s',
              transform: view === tab.id ? 'translateY(-3px) scale(1.1)' : 'none',
              filter: view === tab.id ? 'none' : 'grayscale(1) opacity(0.6)'
            }}>
              {tab.icon}
            </span>
            <span style={{ fontSize: 10, fontWeight: 'bold' }}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Side menu overlay */}
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001 }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 280, height: '100vh',
            background: '#1e293b', borderLeft: '2px solid #334155',
            zIndex: 1002, padding: 20, display: 'flex', flexDirection: 'column',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.8)', animation: 'slideUp 0.2s ease',
            overflowY: 'auto'
          }}>
            {/* Profile header */}
            <div style={{ marginBottom: 20, paddingBottom: 18, borderBottom: '1px solid #334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: 'rgba(59,130,246,0.2)',
                  border: '2px solid #3b82f6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 'bold', color: 'white'
                }}>
                  {username[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 'bold', color: 'white' }}>{username}</div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>Level {level} • {title}</div>
                </div>
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 140, height: 8, background: '#0b1220', borderRadius: 999, overflow: 'hidden', border: '1px solid #334155', flexShrink: 0 }}>
                  <div style={{ width: `${xpPct}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #10b981)', transition: '0.5s' }} />
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 'bold' }}>
                  {Math.max(0, Math.floor(xp)).toLocaleString()} XP
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                <span style={{ color: '#fbbf24' }}>🪙 {gold.toLocaleString()}</span>
                <span style={{ color: '#a78bfa' }}>⚡ {Math.max(0, Math.floor(energy)).toLocaleString()}</span>
                <span style={{ color: '#f97316' }}>🔥 {streak}d</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, padding: '2px 9px', borderRadius: 6, fontWeight: 'bold',
                  background: 'rgba(59,130,246,0.15)',
                  border: '1px solid rgba(59,130,246,0.4)',
                  color: '#93c5fd'
                }}>
                  {role}
                </span>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[{
                icon: '🔔', label: 'Notifications', target: 'notifications' as View },
                { icon: '👥', label: 'Friends List', target: 'friends' as View },
                { icon: '👤', label: 'My Profile', target: 'profile' as View },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={() => {
                    if (item.target === 'notifications') {
                      setNotificationsOpen(true);
                      setMenuOpen(false);
                      return;
                    }
                    if (item.target === 'friends') {
                      setFriendsOpen(true);
                      setMenuOpen(false);
                      return;
                    }
                    setView(item.target);
                    setMenuOpen(false);
                  }}
                  style={{
                    textAlign: 'left', width: '100%', padding: '11px 14px', fontSize: 14,
                    background: view === item.target ? 'rgba(59,130,246,0.15)' : 'transparent',
                    border: `1px solid ${view === item.target ? 'rgba(59,130,246,0.4)' : 'transparent'}`,
                    borderRadius: 10, color: 'white', cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{item.icon} {item.label}</span>
                    {item.target === 'notifications' && notifBadgeCount > 0 && (
                      <span style={{
                        marginLeft: 'auto',
                        minWidth: 18, height: 18, padding: '0 6px',
                        borderRadius: 999, background: '#ef4444',
                        color: 'white', fontSize: 11, fontWeight: 'bold',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {notifBadgeCount > 99 ? '99+' : notifBadgeCount}
                      </span>
                    )}
                  </span>
                </button>
              ))}

              <button
                onClick={() => {
                  setView('studySessions');
                  setMenuOpen(false);
                }}
                style={{
                  textAlign: 'left', width: '100%', padding: '11px 14px', fontSize: 14,
                  background: 'rgba(16,185,129,0.08)',
                  border: '1px solid rgba(16,185,129,0.25)',
                  borderRadius: 10, color: 'white', cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>👨‍👩‍👧‍👦 Study Sessions</span>
                  <span style={{ marginLeft: 'auto', color: '#34d399', fontWeight: 'bold' }}>→</span>
                </span>
              </button>

              {studyOngoingSessionId && studyOngoingProgramId && (
                <button
                  onClick={() => {
                    localStorage.setItem('ll:studyResumeSessionId', studyOngoingSessionId);
                    window.dispatchEvent(new CustomEvent('ll:setView', { detail: { view: 'programMap', programId: studyOngoingProgramId } }));
                    setMenuOpen(false);
                  }}
                  style={{
                    textAlign: 'left', width: '100%', padding: '11px 14px', fontSize: 14,
                    background: 'rgba(59,130,246,0.10)',
                    border: '1px solid rgba(59,130,246,0.25)',
                    borderRadius: 10, color: 'white', cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>� Ongoing Study Session</span>
                    <span style={{ marginLeft: 'auto', color: '#93c5fd', fontWeight: 'bold' }}>→</span>
                  </span>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    Code: {studyOngoingSessionId}
                  </div>
                </button>
              )}

              {ongoingWarmup && view !== 'warmup' && (
                <button
                  onClick={() => { setView('warmup'); setMenuOpen(false); }}
                  style={{
                    textAlign: 'left', width: '100%', padding: '11px 14px', fontSize: 14,
                    background: 'rgba(249,115,22,0.12)',
                    border: '1px solid rgba(249,115,22,0.35)',
                    borderRadius: 10, color: 'white', cursor: 'pointer', fontFamily: 'inherit', transition: '0.15s'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>🎮 Ongoing Game</span>
                    <span style={{
                      marginLeft: 'auto',
                      minWidth: 18, height: 18, padding: '0 6px',
                      borderRadius: 999, background: '#f97316',
                      color: 'white', fontSize: 11, fontWeight: 'bold',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {ongoingBadge}
                    </span>
                  </span>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 4 }}>
                    {ongoingWarmup.gameLabel}
                  </div>
                </button>
              )}

            </div>

            <button onClick={handleLogout} className="ll-btn ll-btn-danger" style={{ width: '100%', padding: '12px', marginTop: 15 }}>
              🚪 Log Out
            </button>
          </div>
        </>
      )}

      {notificationsOpen && (
        <>
          <div onClick={() => setNotificationsOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1200 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 'min(520px, 92vw)', height: 'min(720px, 88vh)',
            background: '#0f172a', borderRadius: 16, border: '2px solid #334155',
            zIndex: 1201, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.7)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 10, background: 'rgba(0,0,0,0.55)', borderBottom: '1px solid #334155' }}>
              <button onClick={() => setNotificationsOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ height: 'calc(100% - 41px)', overflow: 'hidden' }}>
              <NotificationsView onClose={() => setNotificationsOpen(false)} />
            </div>
          </div>
        </>
      )}

      {friendsOpen && (
        <>
          <div onClick={() => setFriendsOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1200 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 'min(520px, 92vw)', height: 'min(720px, 88vh)',
            background: '#0f172a', borderRadius: 16, border: '2px solid #334155',
            zIndex: 1201, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.7)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 10, background: 'rgba(0,0,0,0.55)', borderBottom: '1px solid #334155' }}>
              <button onClick={() => setFriendsOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ height: 'calc(100% - 41px)', overflow: 'hidden' }}>
              <FriendsView />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
