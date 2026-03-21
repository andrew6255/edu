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

export interface PendingSession {
  session: GameSession;
  gameId: string;
}

interface SessionContextType {
  activeSession: ActiveSession | null;
  setActiveSession: (s: ActiveSession | null) => void;
  pendingSession: PendingSession | null;
  setPendingSession: (s: PendingSession | null) => void;
  incomingChallenges: Challenge[];
  dismissChallenge: (id: string) => void;
}

const SessionContext = createContext<SessionContextType>({
  activeSession: null,
  setActiveSession: () => {},
  pendingSession: null,
  setPendingSession: () => {},
  incomingChallenges: [],
  dismissChallenge: () => {}
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [pendingSession, setPendingSession] = useState<PendingSession | null>(null);
  const [incomingChallenges, setIncomingChallenges] = useState<Challenge[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

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
      incomingChallenges, dismissChallenge
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() { return useContext(SessionContext); }
