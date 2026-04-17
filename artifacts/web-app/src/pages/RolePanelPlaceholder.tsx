import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { requireSupabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { UserRole } from '@/lib/userService';

interface Props {
  role: UserRole;
  label: string;
  icon: string;
  color: string;
}

export default function RolePanelPlaceholder({ role, label, icon, color }: Props) {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !user) setLocation('/auth');
    if (!loading && userData && userData.role !== role) setLocation('/auth');
  }, [user, userData, loading]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
          <div>Loading {label} panel...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a', padding: 20 }}>
      <div style={{ fontSize: 60, marginBottom: 16 }}>{icon}</div>
      <h1 style={{ color: 'white', margin: '0 0 8px', fontSize: 26 }}>{label} Panel</h1>
      <div style={{
        display: 'inline-block', fontSize: 12, fontWeight: 'bold', padding: '4px 12px', borderRadius: 6, marginBottom: 20,
        background: `${color}22`, border: `1px solid ${color}55`, color,
      }}>
        {userData?.username || userData?.firstName || role}
      </div>
      <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', maxWidth: 400, lineHeight: 1.6 }}>
        This panel is under construction. It will be available in a future update.
      </p>
      <button
        onClick={async () => { await requireSupabase().auth.signOut(); localStorage.clear(); setLocation('/auth'); }}
        style={{ marginTop: 20, padding: '10px 24px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: 'transparent', border: '1px solid #ef4444', color: '#f87171', cursor: 'pointer' }}
      >
        Sign Out
      </button>
    </div>
  );
}
