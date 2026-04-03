import { useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import LogicGamesView from '@/views/LogicGamesView';

function getQueryParam(search: string, key: string): string | null {
  const s = search.startsWith('?') ? search.slice(1) : search;
  const parts = s.split('&').filter(Boolean);
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (decodeURIComponent(k || '') === key) return decodeURIComponent(v || '');
  }
  return null;
}

export default function LogicGamesPreviewPage() {
  const { user, userData, loading } = useAuth();
  const [, setLocation] = useLocation();

  const nodeId = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return getQueryParam(window.location.search || '', 'nodeId');
  }, []);

  useEffect(() => {
    if (!loading && !user) setLocation('/');
  }, [loading, user]);

  useEffect(() => {
    if (!loading && userData && userData.role !== 'superadmin') setLocation('/');
  }, [loading, userData]);

  useEffect(() => {
    if (!nodeId) {
      localStorage.removeItem('ll:logicGamePreviewNodeId');
      return;
    }
    localStorage.setItem('ll:logicGamePreviewNodeId', nodeId);
  }, [nodeId]);

  if (loading) return null;
  if (!user || !userData) return null;

  return (
    <div style={{ height: '100vh', background: '#0b1220', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 10 }}>
        <a href="/superadmin" style={{ color: '#93c5fd', fontWeight: 900, textDecoration: 'none' }}>← Back to Super Admin</a>
        <div style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12, fontWeight: 900 }}>
          Preview as: {userData.username}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <LogicGamesView />
      </div>
    </div>
  );
}
