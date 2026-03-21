import { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { useLocation } from 'wouter';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { computeLevel } from '@/lib/userService';

type View = 'universe' | 'curriculum' | 'warmup' | 'profile';

interface AppShellProps {
  view: View;
  setView: (v: View) => void;
  children: React.ReactNode;
}

export default function AppShell({ view, setView, children }: AppShellProps) {
  const { userData, refreshUserData } = useAuth();
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const gold = userData?.economy?.gold ?? 0;
  const xp = userData?.economy?.global_xp ?? 0;
  const streak = userData?.economy?.streak ?? 0;
  const username = userData?.username ?? 'Student';
  const { level, title } = computeLevel(xp);

  const maxXP = level * 1000;
  const prevXP = (level - 1) * 1000;
  const xpPct = Math.min(100, ((xp - prevXP) / (maxXP - prevXP)) * 100);

  async function handleLogout() {
    await signOut(auth);
    localStorage.clear();
    setLocation('/');
  }

  const navTabs = [
    { id: 'universe', icon: '🌌', label: 'Universe' },
    { id: 'curriculum', icon: '📚', label: 'Learn' },
    { id: 'warmup', icon: '⚡', label: 'Warmup' },
    { id: 'profile', icon: '👤', label: 'Profile' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', overflow: 'hidden' }}>
      {/* Top HUD */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 20px', background: 'rgba(0,0,0,0.85)',
        borderBottom: '1px solid #334155', zIndex: 10, flexShrink: 0,
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 'bold', letterSpacing: 1 }}>⚔️ LOGIC LORDS</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15, fontSize: 15 }}>
          <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>🪙 {gold.toLocaleString()}</span>
          <span style={{ color: '#f97316', fontWeight: 'bold' }}>🔥 {streak}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 100, height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden', border: '1px solid #334155' }}>
              <div style={{ width: `${xpPct}%`, height: '100%', background: 'linear-gradient(90deg, #3b82f6, #10b981)', transition: '0.5s' }} />
            </div>
            <span style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>Lv.{level} {title}</span>
          </div>
        </div>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            width: 38, height: 38, borderRadius: '50%',
            background: '#1e293b', border: '2px solid #475569',
            color: 'white', cursor: 'pointer', fontSize: 18,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: '0.2s'
          }}
        >
          {username[0]?.toUpperCase() || '?'}
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>

      {/* Bottom nav */}
      <div style={{
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        background: 'rgba(15,23,42,0.95)', borderTop: '1px solid #334155',
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
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              cursor: 'pointer', transition: '0.2s', fontFamily: 'inherit', padding: '4px 0',
              outline: 'none'
            }}
          >
            <span style={{
              fontSize: 24, transition: 'transform 0.2s',
              transform: view === tab.id ? 'translateY(-3px) scale(1.1)' : 'none',
              filter: view === tab.id ? 'none' : 'grayscale(1) opacity(0.7)'
            }}>
              {tab.icon}
            </span>
            <span style={{ fontSize: 11, fontWeight: 'bold' }}>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Side menu overlay */}
      {menuOpen && (
        <>
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001 }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 280, height: '100vh',
            background: '#1e293b', borderLeft: '2px solid #3b82f6',
            zIndex: 1002, padding: 25, display: 'flex', flexDirection: 'column',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.8)', animation: 'slideUp 0.2s ease'
          }}>
            <div style={{ marginBottom: 25, paddingBottom: 20, borderBottom: '1px solid #334155' }}>
              <div style={{ fontSize: 32, marginBottom: 5 }}>👤</div>
              <div style={{ fontSize: 22, fontWeight: 'bold', color: 'white' }}>{username}</div>
              <div style={{ color: '#94a3b8', fontSize: 14 }}>Level {level} • {title}</div>
              <div style={{ color: '#fbbf24', fontSize: 14, marginTop: 5 }}>🪙 {gold.toLocaleString()} Gold</div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { icon: '🌌', label: 'Universe', target: 'universe' as View },
                { icon: '📚', label: 'Curriculum', target: 'curriculum' as View },
                { icon: '⚡', label: 'Warmup Games', target: 'warmup' as View },
                { icon: '👤', label: 'My Profile', target: 'profile' as View },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={() => { setView(item.target); setMenuOpen(false); }}
                  className="ll-btn"
                  style={{ textAlign: 'left', width: '100%', padding: '12px 15px', fontSize: 15 }}
                >
                  {item.icon} {item.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleLogout}
              className="ll-btn ll-btn-danger"
              style={{ width: '100%', padding: '12px', marginTop: 15 }}
            >
              🚪 Log Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
