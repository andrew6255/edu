import { useState, useEffect, lazy, Suspense } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import AppShell from '@/components/layout/AppShell';
import HexUniverseView from '@/views/HexUniverseView';
import WarmupView from '@/views/WarmupView';
import ProfileView from '@/views/ProfileView';
import ArenaView from '@/views/ArenaView';
import LeaderboardView from '@/views/LeaderboardView';
import EmporiumView from '@/views/EmporiumView';
import LogicGamesView from '@/views/LogicGamesView';
import ProgramMapView from '@/views/ProgramMapView';
import StudySessionsView from '@/views/StudySessionsView';
import ClassesView from '@/views/ClassesView';

const PersonalProgramView = lazy(() => import('@/views/PersonalProgramView'));

export type View =
  | 'emporium'
  | 'warmup'
  | 'universe'
  | 'logic'
  | 'profile'
  | 'programMap'
  | 'personalProgram'
  | 'studySessions'
  | 'classes'
  | 'notifications'
  | 'friends';

export default function AppPage() {
  const { user, userData, loading, refreshUserData } = useAuth();
  const [, setLocation] = useLocation();
  const [view, setView] = useState<View>('universe');
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [selectedPersonalProgramId, setSelectedPersonalProgramId] = useState<string | null>(null);
  const [pendingContentId, setPendingContentId] = useState<string | null>(null);
  const [pendingContentType, setPendingContentType] = useState<string | null>(null);
  const [showRefresh, setShowRefresh] = useState(false);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    if (loading) {
      timeout = setTimeout(() => setShowRefresh(true), 5000);
    }
    return () => clearTimeout(timeout);
  }, [loading]);

  useEffect(() => {
    function onSetView(e: Event) {
      const ce = e as CustomEvent<{ view?: View; programId?: string | null; personalProgramId?: string | null }>;
      const next = ce.detail?.view;
      if (!next) return;
      setView(next);
      if (next !== 'programMap') setSelectedProgramId(null);
      if (next === 'programMap') setSelectedProgramId(ce.detail?.programId ?? null);
      if (next !== 'personalProgram') setSelectedPersonalProgramId(null);
      if (next === 'personalProgram') setSelectedPersonalProgramId(ce.detail?.personalProgramId ?? null);
    }

    function onOpenClassContent(e: Event) {
      const ce = e as CustomEvent<{ contentId: string; contentType: string }>;
      const { contentId, contentType } = ce.detail ?? {};
      if (!contentId) return;
      if (contentType === 'program') {
        setView('programMap');
        setSelectedProgramId(contentId);
      } else {
        // quiz or assignment — switch to classes view with pending item
        setPendingContentId(contentId);
        setPendingContentType(contentType);
        setView('classes');
      }
    }

    window.addEventListener('ll:setView', onSetView as EventListener);
    window.addEventListener('ll:openClassContent', onOpenClassContent as EventListener);
    return () => {
      window.removeEventListener('ll:setView', onSetView as EventListener);
      window.removeEventListener('ll:openClassContent', onOpenClassContent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!loading && !user) setLocation('/');
    if (!loading && userData) {
      switch (userData.role) {
        case 'superadmin': setLocation('/superadmin'); break;
        case 'admin': setLocation('/admin'); break;
        case 'teacher': setLocation('/teacher'); break;
        case 'teacher_assistant': setLocation('/ta'); break;
        case 'parent': setLocation('/parent'); break;
        // 'student' stays on /app
      }
    }
  }, [user, userData, loading]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f172a' }}>
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚔️</div>
          <div style={{ color: '#94a3b8', fontSize: 16 }}>Loading your realm...</div>
          {showRefresh && (
            <div style={{ marginTop: 24, animation: 'fadeIn 0.5s ease' }}>
              <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Taking too long?</div>
              <button className="ll-btn" onClick={() => window.location.reload()} style={{ padding: '8px 16px' }}>
                Refresh Page
              </button>
            </div>
          )}
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

  function renderView() {
    switch (view) {
      case 'universe':
        return <HexUniverseView />;
      case 'programMap':
        return <ProgramMapView onBack={() => setView('universe')} programId={selectedProgramId} />;
      case 'personalProgram':
        return (
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ll-text-muted)' }}>Loading...</div>}>
            <PersonalProgramView programId={selectedPersonalProgramId} onBack={() => setView('universe')} />
          </Suspense>
        );
      case 'studySessions':
        return <StudySessionsView onBack={() => setView('universe')} />;
      case 'warmup':
        return null;
      case 'emporium':
        return <EmporiumView />;
      case 'logic':
        return <LogicGamesView />;
      case 'classes':
        return <ClassesView pendingContentId={pendingContentId} pendingContentType={pendingContentType} onPendingHandled={() => { setPendingContentId(null); setPendingContentType(null); }} />;
      case 'profile':
        return <ProfileView />;
      default:
        return <HexUniverseView />;
    }
  }

  return (
    <AppShell view={view} setView={v => { setView(v); }}>
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
