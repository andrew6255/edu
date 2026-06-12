import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface DebugJobModalProps {
  jobId: string;
  onClose: () => void;
}

export default function DebugJobModal({ jobId, onClose }: DebugJobModalProps) {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'meta' | 'programData'>('meta');

  useEffect(() => {
    if (!user) return;
    async function load() {
      try {
        setLoading(true);
        const { getUserDoc } = await import('@/lib/supabaseDocStore');
        const state = await getUserDoc(user!.uid, 'personal_programs', jobId);
        setData(state);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [jobId, user]);

  const panelStyle: React.CSSProperties = {
    width: 'min(1000px, 94vw)',
    height: '86vh',
    background: 'var(--ll-surface-0)',
    borderRadius: 16,
    border: '1px solid var(--ll-border)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    background: active ? 'var(--ll-surface-2)' : 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
    color: active ? 'white' : 'var(--ll-text-muted)',
    fontSize: 13,
    fontWeight: 'bold',
    cursor: 'pointer',
  });

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        zIndex: 4000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ll-border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--ll-overlay)' }}>
          <div style={{ fontSize: 18 }}>🐛</div>
          <div style={{ color: 'var(--ll-text)', fontWeight: 900, fontSize: 14, flex: 1 }}>Debug Job: {jobId}</div>
          <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', borderBottom: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)' }}>
          <button style={btnStyle(activeTab === 'meta')} onClick={() => setActiveTab('meta')}>Metadata</button>
          <button style={btnStyle(activeTab === 'programData')} onClick={() => setActiveTab('programData')}>Program Data</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#1e1e1e' }}>
          {loading && <div style={{ color: 'white' }}>Loading debug data...</div>}
          {error && <div style={{ color: '#f87171' }}>Error: {error}</div>}
          {!loading && !error && data && (
            <pre style={{ margin: 0, color: '#d4d4d4', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(activeTab === 'meta' ? { ...data, programData: undefined } : data.programData, null, 2)}

            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
