import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';
import HexUniverseView from '@/views/HexUniverseView';
import CurriculumView from '@/views/CurriculumView';
import WarmupView from '@/views/WarmupView';
import ProfileView from '@/views/ProfileView';

type View = 'universe' | 'curriculum' | 'warmup' | 'profile';

export default function AppPage() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [view, setView] = useState<View>('universe');
  const [selectedSubject, setSelectedSubject] = useState<string | undefined>();

  useEffect(() => {
    if (!loading && !user) setLocation('/');
  }, [user, loading]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚔️</div>
          <div style={{ color: '#94a3b8', fontSize: 16 }}>Loading your realm...</div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  function handleSelectSubject(subject: string) {
    setSelectedSubject(subject);
    setView('curriculum');
  }

  function renderView() {
    switch (view) {
      case 'universe':
        return <HexUniverseView onSelectSubject={handleSelectSubject} />;
      case 'curriculum':
        return (
          <CurriculumView
            subject={selectedSubject}
            onBack={() => { setSelectedSubject(undefined); setView('universe'); }}
          />
        );
      case 'warmup':
        return <WarmupView />;
      case 'profile':
        return <ProfileView />;
      default:
        return <HexUniverseView onSelectSubject={handleSelectSubject} />;
    }
  }

  return (
    <AppShell view={view} setView={v => { setView(v); if (v !== 'curriculum') setSelectedSubject(undefined); }}>
      <div style={{ height: '100%', overflow: 'hidden', animation: 'fadeIn 0.3s ease' }} key={view}>
        {renderView()}
      </div>
    </AppShell>
  );
}
