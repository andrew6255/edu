import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { listenIncomingChallenges } from '@/lib/gameSessionService';
import { Challenge, GameSession } from '@/types/warmup';

interface ActiveSession {
  sessionId: string;
  gameId: string;
  gameLabel: string;
  mode: 'ranked' | 'friend';
}

export interface OngoingWarmup {
  kind: 'solo' | 'multi';
  gameId: string;
  gameLabel: string;
}

export interface PendingSession {
  session: GameSession;
  gameId: string;
}

interface SessionContextType {
  activeSession: ActiveSession | null;
  setActiveSession: (s: ActiveSession | null) => void;
  pendingSession: PendingSession | null;
  setPendingSession: (s: PendingSession | null) => void;
  ongoingWarmup: OngoingWarmup | null;
  setOngoingWarmup: (g: OngoingWarmup | null) => void;
  incomingChallenges: Challenge[];
  dismissChallenge: (id: string) => void;
}

const SessionContext = createContext<SessionContextType>({
  activeSession: null,
  setActiveSession: () => {},
  pendingSession: null,
  setPendingSession: () => {},
  ongoingWarmup: null,
  setOngoingWarmup: () => {},
  incomingChallenges: [],
  dismissChallenge: () => {}
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null);
  const [ongoingWarmup, setOngoingWarmup] = useState<OngoingWarmup | null>(null);
  const [incomingChallenges, setIncomingChallenges] = useState<Challenge[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    function onSetPendingSession(e: Event) {
      const ce = e as CustomEvent<PendingSession | null>;
      if (ce.detail == null) {
        setPendingSession(null);
        return;
      }
      setPendingSession(ce.detail);
    }

    window.addEventListener('ll:setPendingSession', onSetPendingSession as EventListener);
    return () => window.removeEventListener('ll:setPendingSession', onSetPendingSession as EventListener);
  }, []);

  useEffect(() => {
    function onSetOngoingWarmup(e: Event) {
      const ce = e as CustomEvent<OngoingWarmup | null>;
      setOngoingWarmup(ce.detail ?? null);
    }

    window.addEventListener('ll:setOngoingWarmup', onSetOngoingWarmup as EventListener);
    return () => window.removeEventListener('ll:setOngoingWarmup', onSetOngoingWarmup as EventListener);
  }, []);

  useEffect(() => {
    if (!user) { setIncomingChallenges([]); return; }
    const unsub = listenIncomingChallenges(user.uid, challenges => {
      setIncomingChallenges(challenges.filter(c => !dismissed.has(c.id)));
    });
    return unsub;
  }, [user, dismissed]);

  function dismissChallenge(id: string) {
    setDismissed(prev => new Set([...prev, id]));
    setIncomingChallenges(prev => prev.filter(c => c.id !== id));
  }

  return (
    <SessionContext.Provider value={{
      activeSession, setActiveSession,
      pendingSession, setPendingSession,
      ongoingWarmup, setOngoingWarmup,
      incomingChallenges, dismissChallenge
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() { return useContext(SessionContext); }
