import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';
import HexUniverseView from '@/views/HexUniverseView';
import CurriculumView from '@/views/CurriculumView';
import WarmupView from '@/views/WarmupView';
import ProfileView from '@/views/ProfileView';
import ArenaView from '@/views/ArenaView';
import LeaderboardView from '@/views/LeaderboardView';
import EmporiumView from '@/views/EmporiumView';
import LogicGamesView from '@/views/LogicGamesView';
import OnboardingPage from '@/pages/OnboardingPage';
import ProgramMapView from '@/views/ProgramMapView';
import StudySessionsView from '@/views/StudySessionsView';

export type View =
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

export default function AppPage() {
  const { user, userData, loading, refreshUserData } = useAuth();
  const [, setLocation] = useLocation();
  const [view, setView] = useState<View>('universe');
  const [selectedSubject, setSelectedSubject] = useState<string | undefined>();
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  useEffect(() => {
    function onSetView(e: Event) {
      const ce = e as CustomEvent<{ view?: View; programId?: string | null }>;
      const next = ce.detail?.view;
      if (!next) return;
      setView(next);
      if (next !== 'curriculum') setSelectedSubject(undefined);
      if (next !== 'programMap') setSelectedProgramId(null);
      if (next === 'programMap') setSelectedProgramId(ce.detail?.programId ?? null);
    }

    window.addEventListener('ll:setView', onSetView as EventListener);
    return () => window.removeEventListener('ll:setView', onSetView as EventListener);
  }, []);

  useEffect(() => {
    if (!loading && !user) setLocation('/');
    if (!loading && userData) {
      if (userData.role === 'superadmin') setLocation('/superadmin');
    }
  }, [user, userData, loading]);

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

  if (!userData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s ease', maxWidth: 420, padding: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚔️</div>
          <div style={{ color: '#94a3b8', fontSize: 16, marginBottom: 10 }}>Loading your realm...</div>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
            Your account is signed in, but your profile is still being prepared.
          </div>
          <button
            className="ll-btn"
            onClick={refreshUserData}
            style={{ padding: '10px 16px' }}
          >
            Retry profile load
          </button>
        </div>
      </div>
    );
  }

  // Show curriculum onboarding only for new students explicitly flagged (existing users w/ undefined field are skipped)
  if (userData.onboardingComplete === false && userData.role === 'student') {
    return <OnboardingPage onComplete={refreshUserData} />;
  }

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
      case 'programMap':
        return <ProgramMapView onBack={() => setView('universe')} programId={selectedProgramId} />;
      case 'studySessions':
        return <StudySessionsView onBack={() => setView('universe')} />;
      case 'warmup':
        return null;
      case 'emporium':
        return <EmporiumView />;
      case 'logic':
        return <LogicGamesView />;
      case 'profile':
        return <ProfileView />;
      default:
        return <HexUniverseView onSelectSubject={handleSelectSubject} />;
    }
  }

  return (
    <AppShell view={view} setView={v => { setView(v); if (v !== 'curriculum') setSelectedSubject(undefined); }}>
      <div style={{ height: '100%', overflow: 'hidden' }}>
        <div style={{ height: '100%', overflow: 'hidden', display: view === 'warmup' ? 'block' : 'none' }}>
          <WarmupView />
        </div>
        <div style={{ height: '100%', overflow: 'hidden', display: view === 'warmup' ? 'none' : 'block', animation: 'fadeIn 0.3s ease' }} key={view}>
          {renderView()}
        </div>
      </div>
    </AppShell>
  );
}
