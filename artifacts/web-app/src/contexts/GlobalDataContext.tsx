import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { listMyPersonalPrograms, type PersonalProgramMeta } from '@/lib/personalProgramService';
import { listPersonalSubjects, type PersonalSubject } from '@/lib/personalSubjectService';
import { listLogicGameNodes, ensureLogicGamesProgress } from '@/lib/logicGamesService';
import type { LogicGameNode, LogicGamesProgressDoc } from '@/types/logicGames';
import { getLobbyDoc, createLobby, joinLobby, leaveLobby, listenLobby, DEFAULT_EMOJI_LIST, LOBBY_MAX_PLAYERS, getUserLobbyId, setUserLobby } from '@/lib/lobbyService';
import type { LobbyDoc } from '@/types/lobby';

import GlobalLoadingScreen from '@/components/layout/GlobalLoadingScreen';
import { getMyClasses, type StudentClass } from '@/lib/studentService';
import { ensureChronoEmpiresState, getChronoEmpiresState, type ChronoEmpiresStateDoc } from '@/lib/chronoEmpiresService';
import { syncIdleVault, type ChronoIdleVaultStatus } from '@/lib/chronoIdleVaultService';
import { getChronoRewardChestStatus, type ChronoRewardChestStatus } from '@/lib/chronoRewardChestService';
import { buildChronoPrestigeViewModel, type ChronoPrestigeViewModel } from '@/lib/chronoPrestigeService';
import { getInventory, ensureInventory, type ChronoInventoryDoc } from '@/lib/chronoInventoryService';

export interface GlobalChronoData {
  state: ChronoEmpiresStateDoc | null;
  idleVault: ChronoIdleVaultStatus | null;
  rewardChest: ChronoRewardChestStatus | null;
  prestige: ChronoPrestigeViewModel | null;
  inventory: ChronoInventoryDoc | null;
}

interface GlobalDataContextType {
  personalPrograms: PersonalProgramMeta[];
  setPersonalPrograms: React.Dispatch<React.SetStateAction<PersonalProgramMeta[]>>;
  subjects: PersonalSubject[];
  setSubjects: React.Dispatch<React.SetStateAction<PersonalSubject[]>>;
  iqNodes: LogicGameNode[];
  setIqNodes: React.Dispatch<React.SetStateAction<LogicGameNode[]>>;
  logicGamesProgress: LogicGamesProgressDoc | null;
  setLogicGamesProgress: React.Dispatch<React.SetStateAction<LogicGamesProgressDoc | null>>;
  globalDataLoaded: boolean;
  globalLobbyId: string | null;
  setGlobalLobbyId: React.Dispatch<React.SetStateAction<string | null>>;
  globalLobby: LobbyDoc | null;
  setGlobalLobby: React.Dispatch<React.SetStateAction<LobbyDoc | null>>;
  globalInitializingLobby: boolean;
  globalClasses: StudentClass[];
  setGlobalClasses: React.Dispatch<React.SetStateAction<StudentClass[]>>;
  globalChrono: GlobalChronoData | null;
  setGlobalChrono: React.Dispatch<React.SetStateAction<GlobalChronoData | null>>;
}

const GlobalDataContext = createContext<GlobalDataContextType | null>(null);

export function GlobalDataProvider({ children }: { children: ReactNode }) {
  const { user, userData } = useAuth();
  
  const [personalPrograms, setPersonalPrograms] = useState<PersonalProgramMeta[]>([]);
  const [subjects, setSubjects] = useState<PersonalSubject[]>([]);
  const [iqNodes, setIqNodes] = useState<LogicGameNode[]>([]);
  const [logicGamesProgress, setLogicGamesProgress] = useState<LogicGamesProgressDoc | null>(null);
  const [globalDataLoaded, setGlobalDataLoaded] = useState(false);
  const [globalLobbyId, setGlobalLobbyId] = useState<string | null>(null);
  const [globalLobby, setGlobalLobby] = useState<LobbyDoc | null>(null);
  const [globalInitializingLobby, setGlobalInitializingLobby] = useState(true);
  const [fetchProgress, setFetchProgress] = useState(0);
  const [globalClasses, setGlobalClasses] = useState<StudentClass[]>([]);
  const [globalChrono, setGlobalChrono] = useState<GlobalChronoData | null>(null);

  useEffect(() => {
    if (!user) {
      setGlobalDataLoaded(false);
      return;
    }

    let alive = true;
    setGlobalDataLoaded(false);

    async function fetchAll() {
      try {
        let completed = 0;
        const total = 7; // 6 endpoints + lobby init
        const inc = () => {
          completed++;
          setFetchProgress(Math.floor((completed / total) * 100));
        };

        const fetchChrono = async () => {
          try {
            await ensureChronoEmpiresState(user!.uid);
            const s = await getChronoEmpiresState(user!.uid);
            const board = s?.currentBoard ?? 100;
            const vault = await syncIdleVault(user!.uid, board);
            const chest = await getChronoRewardChestStatus(user!.uid, board);
            const prestigeVm = await buildChronoPrestigeViewModel(user!.uid, board);
            await ensureInventory(user!.uid);
            const inv = await getInventory(user!.uid);
            inc();
            return {
              state: s,
              idleVault: vault,
              rewardChest: chest,
              prestige: prestigeVm,
              inventory: inv
            };
          } catch (e) {
            inc();
            return null;
          }
        };

        const [programsRes, subjectsRes, iqNodesRes, progressRes, classesRes, chronoRes] = await Promise.all([
          listMyPersonalPrograms(user!.uid).then(r => { inc(); return r; }).catch(() => { inc(); return []; }),
          listPersonalSubjects(user!.uid).then(r => { inc(); return r; }).catch(() => { inc(); return []; }),
          listLogicGameNodes().then(r => { inc(); return r; }).catch(() => { inc(); return []; }),
          ensureLogicGamesProgress(user!.uid).then(r => { inc(); return r; }).catch(() => { inc(); return null; }),
          getMyClasses().then(r => { inc(); return r; }).catch(() => { inc(); return []; }),
          fetchChrono()
        ]);

        if (alive) {
          setPersonalPrograms(programsRes);
          setSubjects(subjectsRes);
          // filter out unpublished iq nodes, similar to LobbyView
          setIqNodes(iqNodesRes.filter((n: LogicGameNode) => !!n.publishedAt));
          setLogicGamesProgress(progressRes);
          setGlobalClasses(classesRes);
          setGlobalChrono(chronoRes);
          setGlobalDataLoaded(true);
        }
      } catch (err) {
        console.error('Failed to load global data', err);
        if (alive) setGlobalDataLoaded(true); // Still allow app to load even if it failed
      }
    }

    fetchAll();

    async function initLobby() {
      if (!user) return;
      const myUid = user.uid;
      const myUsername = userData?.username ?? myUid;
      setGlobalInitializingLobby(true);

      const pendingLobbyId = localStorage.getItem('ll:pendingLobbyId');
      if (pendingLobbyId) {
        localStorage.removeItem('ll:pendingLobbyId');
        const doc = await getLobbyDoc(pendingLobbyId);
        if (doc && doc.state === 'waiting' && doc.players.length < LOBBY_MAX_PLAYERS) {
          const currentId = await getUserLobbyId(myUid);
          if (currentId && currentId !== pendingLobbyId) {
            await leaveLobby(currentId, myUid).catch(() => {});
          }
          const emoji = DEFAULT_EMOJI_LIST[Math.floor(Math.random() * DEFAULT_EMOJI_LIST.length)];
          const result = await joinLobby({ lobbyId: pendingLobbyId, uid: myUid, username: myUsername, emoji });
          if (result.success) {
            await setUserLobby(myUid, pendingLobbyId);
            setGlobalLobbyId(pendingLobbyId);
            setGlobalInitializingLobby(false);
            setFetchProgress(100);
            return;
          }
        }
      }

      const existingId = await getUserLobbyId(myUid);
      if (existingId) {
        const doc = await getLobbyDoc(existingId);
        if (doc && doc.players.some(p => p.uid === myUid)) {
          setGlobalLobbyId(existingId);
          setGlobalInitializingLobby(false);
          setFetchProgress(100);
          return;
        }
      }

      const emoji = DEFAULT_EMOJI_LIST[0];
      const doc = await createLobby({ uid: myUid, username: myUsername, emoji });
      await setUserLobby(myUid, doc.id);
      setGlobalLobbyId(doc.id);
      setGlobalInitializingLobby(false);
      setFetchProgress(100);
    }
    
    initLobby().catch(() => { if (alive) setGlobalInitializingLobby(false); });

    // Set up global event listeners that should keep the context updated
    const onProgramCreated = (e: Event) => {
      const ce = e as CustomEvent<{ program: PersonalProgramMeta }>;
      setPersonalPrograms(prev => [ce.detail.program, ...prev.filter(p => p.programId !== ce.detail.program.programId)]);
    };
    
    const onProgramDeleted = (e: Event) => {
      const ce = e as CustomEvent<{ jobId: string }>;
      setPersonalPrograms(prev => prev.filter(p => p.jobId !== ce.detail.jobId));
    };

    const onSubjectsUpdated = () => {
      listPersonalSubjects(user!.uid).then(list => {
        setSubjects(list);
      }).catch(console.error);
    };

    window.addEventListener('ll:personalProgramCreated', onProgramCreated);
    window.addEventListener('ll:personalProgramDeleted', onProgramDeleted);
    window.addEventListener('ll:subjectsUpdated', onSubjectsUpdated);

    return () => {
      alive = false;
      window.removeEventListener('ll:personalProgramCreated', onProgramCreated);
      window.removeEventListener('ll:personalProgramDeleted', onProgramDeleted);
      window.removeEventListener('ll:subjectsUpdated', onSubjectsUpdated);
    };
  }, [user]);

  useEffect(() => {
    if (!globalLobbyId) return;
    return listenLobby(globalLobbyId, (doc) => {
      setGlobalLobby(doc);
    });
  }, [globalLobbyId]);

  // Prevent app rendering until loaded
  if (user && (!globalDataLoaded || globalInitializingLobby)) {
    return <GlobalLoadingScreen progress={fetchProgress > 0 ? fetchProgress : undefined} />;
  }

  return (
    <GlobalDataContext.Provider
      value={{
        personalPrograms, setPersonalPrograms,
        subjects, setSubjects,
        iqNodes, setIqNodes,
        logicGamesProgress, setLogicGamesProgress,
        globalDataLoaded,
        globalLobbyId, setGlobalLobbyId,
        globalLobby, setGlobalLobby,
        globalInitializingLobby,
        globalClasses, setGlobalClasses,
        globalChrono, setGlobalChrono
      }}
    >
      {children}
    </GlobalDataContext.Provider>
  );
}

export function useGlobalData() {
  const context = useContext(GlobalDataContext);
  if (!context) {
    throw new Error('useGlobalData must be used within a GlobalDataProvider');
  }
  return context;
}
