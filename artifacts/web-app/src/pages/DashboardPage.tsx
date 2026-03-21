import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { computeLevel } from '@/lib/userService';
import TeacherDashboard from '@/views/dashboard/TeacherDashboard';
import AdminDashboard from '@/views/dashboard/AdminDashboard';

export default function DashboardPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation('/');
    if (!loading && userData) {
      if (userData.role === 'student') setLocation('/app');
      if (userData.role === 'superadmin') setLocation('/superadmin');
    }
  }, [user, userData, loading]);

  if (loading || !userData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚙️</div>
          <div style={{ color: '#94a3b8' }}>Loading dashboard...</div>
        </div>
      </div>
    );
  }

  const { level, title } = computeLevel(userData.economy?.global_xp || 0);
  const isAdmin = userData.role === 'admin';
  const isTeacher = userData.role === 'teacher';

  if (!isAdmin && !isTeacher) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 20px', background: 'rgba(0,0,0,0.85)',
        borderBottom: '1px solid #334155', flexShrink: 0, backdropFilter: 'blur(10px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <button
            onClick={() => setLocation('/app')}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 22, padding: '2px 6px' }}
          >
            ←
          </button>
          <span style={{ fontSize: 20, fontWeight: 'bold', letterSpacing: 1, color: 'white' }}>
            {isAdmin ? '⚙️ Admin' : '📚 Teacher'} Dashboard
          </span>
          <span style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 'bold', textTransform: 'uppercase',
            background: isAdmin ? 'rgba(249,115,22,0.15)' : 'rgba(16,185,129,0.15)',
            border: isAdmin ? '1px solid rgba(249,115,22,0.4)' : '1px solid rgba(16,185,129,0.4)',
            color: isAdmin ? '#fb923c' : '#34d399'
          }}>
            {userData.role}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ textAlign: 'right', display: 'none' }}>
            <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{userData.username}</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>Lv.{level} {title}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setLocation('/app')}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
                background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
                color: '#93c5fd', cursor: 'pointer'
              }}
            >
              🎮 Student View
            </button>
            <button
              onClick={async () => { await signOut(auth); localStorage.clear(); setLocation('/'); }}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', fontFamily: 'inherit',
                background: 'transparent', border: '1px solid #475569',
                color: '#94a3b8', cursor: 'pointer'
              }}
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      {/* Dashboard content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isAdmin ? <AdminDashboard /> : <TeacherDashboard />}
      </div>
    </div>
  );
}
