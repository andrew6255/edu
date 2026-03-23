import { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { useLocation } from 'wouter';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { computeLevel } from '@/lib/userService';
import { joinClassByCode } from '@/lib/classService';
import NotificationsView from '@/views/NotificationsView';
import FriendsView from '@/views/FriendsView';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useSession } from '@/contexts/SessionContext';
import { forfeitSession } from '@/lib/gameSessionService';
import type { AppNotification } from '@/lib/userService';

type View = 'emporium' | 'warmup' | 'universe' | 'logic' | 'profile' | 'curriculum' | 'notifications' | 'friends';

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
  const [joinCodeOpen, setJoinCodeOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [joining, setJoining] = useState(false);

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
      const count = items.reduce((acc, n) => {
        if (n.type === 'friendRequest' || n.type === 'challenge') return acc + 1;
        return acc + (n.read ? 0 : 1);
      }, 0);
      setNotifBadgeCount(count);
    });
    return unsub;
  }, [user]);

  const gold = userData?.economy?.gold ?? 0;
  const xp = userData?.economy?.global_xp ?? 0;
  const streak = userData?.economy?.streak ?? 0;
  const username = userData?.username ?? 'Student';
  const role = userData?.role ?? 'student';
  const { level, title } = computeLevel(xp);

  const ongoingBadge = ongoingWarmup && view !== 'warmup' ? 1 : 0;
  const hudBadgeCount = notifBadgeCount + ongoingBadge;

  const maxXP = level * 1000;
  const prevXP = (level - 1) * 1000;
  const xpPct = Math.min(100, ((xp - prevXP) / (maxXP - prevXP)) * 100);

  async function handleLogout() {
    await signOut(auth);
    localStorage.clear();
    setLocation('/');
  }

  async function handleJoinClass() {
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinMsg('');
    const { auth: firebaseAuth } = await import('@/lib/firebase');
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) { setJoinMsg('Not logged in.'); setJoining(false); return; }
    const cls = await joinClassByCode(uid, joinCode.trim());
    if (cls) {
      setJoinMsg(`✅ Joined "${cls.name}" successfully!`);
      await refreshUserData();
      setTimeout(() => { setJoinCodeOpen(false); setJoinCode(''); setJoinMsg(''); }, 2000);
    } else {
      setJoinMsg('❌ Invalid code. Please check with your teacher.');
    }
    setJoining(false);
  }

  const navTabs = [
    { id: 'emporium', icon: '🏪', label: 'Emporium' },
    { id: 'warmup', icon: '⚡', label: 'Warmup' },
    { id: 'universe', icon: '🌌', label: 'Universe' },
    { id: 'logic', icon: '🧩', label: 'Logic Games' },
    { id: 'profile', icon: '👤', label: 'Profile' },
  ] as const;

  const isDashboardRole = role === 'teacher' || role === 'admin';

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
          <span style={{ color: '#f97316', fontWeight: 'bold', whiteSpace: 'nowrap' }}>🔥 {streak}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <div style={{ width: 80, height: 7, background: '#1e293b', borderRadius: 3, overflow: 'hidden', border: '1px solid #334155', flexShrink: 0 }}>
              <div style={{ width: `${xpPct}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #10b981)', transition: '0.5s' }} />
            </div>
            <span style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap', display: window.innerWidth > 500 ? 'block' : 'none' }}>
              Lv.{level} {title}
            </span>
          </div>
        </div>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: isDashboardRole ? 'rgba(16,185,129,0.2)' : '#1e293b',
            border: isDashboardRole ? '2px solid #10b981' : '2px solid #475569',
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

      {/* Dashboard role badge */}
      {isDashboardRole && (
        <button
          onClick={() => setLocation('/dashboard')}
          style={{
            margin: '0', padding: '6px 0', width: '100%', flexShrink: 0,
            background: role === 'admin' ? 'rgba(249,115,22,0.15)' : 'rgba(16,185,129,0.15)',
            border: 'none', borderBottom: `1px solid ${role === 'admin' ? 'rgba(249,115,22,0.3)' : 'rgba(16,185,129,0.3)'}`,
            color: role === 'admin' ? '#fb923c' : '#34d399',
            cursor: 'pointer', fontWeight: 'bold', fontSize: 13, fontFamily: 'inherit',
            letterSpacing: 0.5
          }}
        >
          {role === 'admin' ? '⚙️' : '📚'} Open {role === 'admin' ? 'Admin' : 'Teacher'} Dashboard →
        </button>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
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
                  background: isDashboardRole ? 'rgba(16,185,129,0.2)' : 'rgba(59,130,246,0.2)',
                  border: isDashboardRole ? '2px solid #10b981' : '2px solid #3b82f6',
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
              <div style={{ display: 'flex', gap: 10, fontSize: 13 }}>
                <span style={{ color: '#fbbf24' }}>🪙 {gold.toLocaleString()}</span>
                <span style={{ color: '#f97316' }}>🔥 {streak}d</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, padding: '2px 9px', borderRadius: 6, fontWeight: 'bold',
                  background: role === 'admin' ? 'rgba(249,115,22,0.15)' : role === 'teacher' ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)',
                  border: `1px solid ${role === 'admin' ? 'rgba(249,115,22,0.4)' : role === 'teacher' ? 'rgba(16,185,129,0.4)' : 'rgba(59,130,246,0.4)'}`,
                  color: role === 'admin' ? '#fb923c' : role === 'teacher' ? '#34d399' : '#93c5fd'
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

              {isDashboardRole && (
                <button
                  onClick={() => { setMenuOpen(false); setLocation('/dashboard'); }}
                  style={{
                    textAlign: 'left', width: '100%', padding: '11px 14px', fontSize: 14,
                    background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
                    borderRadius: 10, color: '#34d399', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold'
                  }}
                >
                  {role === 'admin' ? '⚙️ Admin Dashboard' : '📊 Teacher Dashboard'}
                </button>
              )}

              {role === 'student' && !userData?.classId && (
                <button
                  onClick={() => { setMenuOpen(false); setJoinCodeOpen(true); }}
                  style={{
                    textAlign: 'left', width: '100%', padding: '11px 14px', fontSize: 14,
                    background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                    borderRadius: 10, color: '#fbbf24', cursor: 'pointer', fontFamily: 'inherit'
                  }}
                >
                  🔑 Join a Class
                </button>
              )}
              {role === 'student' && userData?.classId && (
                <div style={{ padding: '11px 14px', fontSize: 13, background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, color: '#94a3b8' }}>
                  ✅ Enrolled in a class
                </div>
              )}
            </div>

            <button onClick={handleLogout} className="ll-btn ll-btn-danger" style={{ width: '100%', padding: '12px', marginTop: 15 }}>
              🚪 Log Out
            </button>
          </div>
        </>
      )}

      {/* Join class modal */}
      {joinCodeOpen && (
        <>
          <div onClick={() => setJoinCodeOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1010 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: '#1e293b', borderRadius: 16, padding: 28, width: 'min(380px, 90vw)',
            border: '2px solid #fbbf24', zIndex: 1011, boxShadow: '0 20px 50px rgba(0,0,0,0.7)',
            animation: 'slideUp 0.2s ease', textAlign: 'center'
          }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🔑</div>
            <h3 style={{ color: 'white', margin: '0 0 8px', fontSize: 20 }}>Join a Class</h3>
            <p style={{ color: '#94a3b8', margin: '0 0 20px', fontSize: 14 }}>Enter the 6-character code your teacher gave you</p>
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="e.g. XK7A2B"
              maxLength={6}
              style={{
                width: '100%', padding: '14px', textAlign: 'center', fontSize: 24, letterSpacing: 5,
                fontWeight: 'bold', borderRadius: 10, border: '2px solid #fbbf24',
                background: '#0f172a', color: '#fbbf24', fontFamily: 'inherit',
                boxSizing: 'border-box', marginBottom: 15, outline: 'none'
              }}
            />
            {joinMsg && (
              <div style={{
                padding: '10px', marginBottom: 12, borderRadius: 8, fontSize: 14,
                background: joinMsg.startsWith('✅') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                border: joinMsg.startsWith('✅') ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(239,68,68,0.3)',
                color: joinMsg.startsWith('✅') ? '#10b981' : '#ef4444'
              }}>
                {joinMsg}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setJoinCodeOpen(false)} className="ll-btn" style={{ flex: 1, padding: '12px' }}>Cancel</button>
              <button onClick={handleJoinClass} disabled={joining || joinCode.length < 6} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '12px' }}>
                {joining ? 'Joining...' : 'Join Class'}
              </button>
            </div>
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
