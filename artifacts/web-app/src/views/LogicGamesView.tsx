import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { LogicGameNode, LogicGamePromptBlock, LogicGamesProgressDoc, LogicGameQuestion, LogicGameServedQuestion, LogicGameNodeQueue } from '@/types/logicGames';
import {
  ensureLogicGamesProgress,
  fetchNextLogicGameQuestion,
  getLogicGameQuestionById,
  listLogicGameNodes,
  submitLogicGameAnswer,
} from '@/lib/logicGamesService';
import { useImmersiveMode } from '@/contexts/ImmersiveContext';
import { emitSolveEvent } from '@/lib/battlePassEvents';
import katex from 'katex';
import { gradeInteraction } from '@/lib/interactionGrader';
import { getUserData } from '@/lib/userService';
import {
  listenLogicGameFriendMatch,
  sendLogicGameFriendChallenge,
  submitLogicGameFriendAttempt,
} from '@/lib/logicGameFriendService';
import type { LogicGameFriendMatch } from '@/types/logicGameFriend';
import { listenChallengeState } from '@/lib/gameSessionService';
import { useGlobalData } from '@/contexts/GlobalDataContext';

type GamePlayMode = 'chill' | 'iq';
type Screen = 'map' | 'playing' | 'friend_waiting' | 'friend_match';

// Scoring lives on the server now (logic_game_submit_answer). The browser sends
// what the student chose and is told what it cost — it no longer computes, and
// cannot assert, its own rating change.

/** Questions per session. The summary screen shows the rating swing across one. */
const SESSION_LENGTH = 10;

export default function LogicGamesView() {
  const { user, userData } = useAuth();
  const uid = user?.uid ?? null;

  const { iqNodes: nodes, logicGamesProgress: progress, setLogicGamesProgress: setProgress } = useGlobalData();
  const [err, setErr] = useState<string | null>(null);

  const [previewUnlockAll, setPreviewUnlockAll] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Chill / IQ mode toggle
  const [gamePlayMode, setGamePlayMode] = useState<GamePlayMode>('iq');

  const [screen, setScreen] = useState<Screen>('map');
  const [activeNode, setActiveNode] = useState<LogicGameNode | null>(null);
  const [rankedLoading, setRankedLoading] = useState(false);
  const [rankedError, setRankedError] = useState<string | null>(null);
  // The server picks each question, one at a time, matched to the player's rating
  // and guaranteed never to have been served to them before. Nothing is preloaded,
  // so entering a session costs one round trip regardless of how much content exists.
  const [rankedCurrent, setRankedCurrent] = useState<LogicGameServedQuestion | null>(null);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionStartIq, setSessionStartIq] = useState(80);
  const [sessionSummary, setSessionSummary] = useState<null | { correct: number; total: number; startIq: number; endIq: number }>(null);
  const [exhausted, setExhausted] = useState(false);
  const questionStartedAtRef = useRef<number>(0);
  const [rankedAnswerText, setRankedAnswerText] = useState('');
  const [rankedChoiceIndex, setRankedChoiceIndex] = useState<number | null>(null);
  const [rankedFeedback, setRankedFeedback] = useState<null | { correct: boolean; timedOut?: boolean; explanation?: string }>(null);
  // The IQ change for the question just answered, animated next to the IQ chip.
  const [iqDeltaFx, setIqDeltaFx] = useState<{ delta: number; key: number } | null>(null);

  // IQ mode: upward timer (stopwatch)
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef<number | null>(null);

  // Friend match state (kept for friend match acceptance from notifications)
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendErr, setFriendErr] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [friends, setFriends] = useState<any[]>([]);
  const [friendPickUid, setFriendPickUid] = useState<string | null>(null);
  const [friendChallengeId, setFriendChallengeId] = useState<string | null>(null);
  const friendChallengeUnsubRef = useRef<(() => void) | null>(null);

  const [friendMatchId, setFriendMatchId] = useState<string | null>(null);
  const [friendMatch, setFriendMatch] = useState<LogicGameFriendMatch | null>(null);
  const friendMatchRef = useRef<LogicGameFriendMatch | null>(null);
  const friendAutoTimeoutKeyRef = useRef<string | null>(null);
  const friendMatchUnsubRef = useRef<(() => void) | null>(null);
  const friendTickRef = useRef<number | null>(null);
  const [friendSecondsLeft, setFriendSecondsLeft] = useState(0);

  const [friendAnswerText, setFriendAnswerText] = useState('');
  const [friendChoiceIndex, setFriendChoiceIndex] = useState<number | null>(null);
  const [friendLocalFeedback, setFriendLocalFeedback] = useState<null | { status: 'correct' | 'wrong' | 'timeout' }>(null);



  useEffect(() => {
    if (typeof window === 'undefined') return;
    const flag = localStorage.getItem('ll:logicGamePreviewUnlockAll');
    if (flag === '1') {
      localStorage.removeItem('ll:logicGamePreviewUnlockAll');
      setPreviewUnlockAll(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadFriends() {
      if (!uid || !userData?.friends || userData.friends.length === 0) {
        if (alive) setFriends([]);
        return;
      }
      const fData = await Promise.all(
        userData.friends.map(async (fuid) => {
          try {
            const d = await getUserData(fuid);
            return { uid: fuid, ...(d ?? { username: 'Unknown', last_active: '' }) };
          } catch {
            return { uid: fuid, username: 'Unknown', last_active: '' };
          }
        })
      );
      const today = new Date().toISOString().split('T')[0];
      fData.sort((a, b) => {
        const aOnline = a.last_active === today ? 1 : 0;
        const bOnline = b.last_active === today ? 1 : 0;
        return bOnline - aOnline;
      });
      if (alive) setFriends(fData);
    }
    loadFriends();
    return () => {
      alive = false;
    };
  }, [uid, userData?.friends]);

  const sorted = useMemo(() => {
    const out = [...nodes];
    out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return out;
  }, [nodes]);

  // Superadmin preview: open a node modal automatically if requested.
  useEffect(() => {
    if (sorted.length === 0) return;
    const pid = typeof window !== 'undefined' ? localStorage.getItem('ll:logicGamePreviewNodeId') : null;
    if (!pid) return;
    localStorage.removeItem('ll:logicGamePreviewNodeId');
    // Buckets are not student-facing, so a preview just drops into a session.
    if (sorted.some((n) => n.id === pid)) {
      void startSession();
    }
  }, [sorted]);

  // Resume a match accepted via NotificationsView or Lobby launch
  useEffect(() => {
    if (!uid || nodes.length === 0) return;
    const mid = typeof window !== 'undefined' ? localStorage.getItem('ll:logicGameFriendMatchId') : null;
    const nid = typeof window !== 'undefined' ? localStorage.getItem('ll:logicGameNodeId') : null;
    if (!mid && !nid) return;
    
    if (mid) localStorage.removeItem('ll:logicGameFriendMatchId');
    if (nid) localStorage.removeItem('ll:logicGameNodeId');

    if (mid) {
      const node = nid ? nodes.find((n) => n.id === nid) ?? null : null;
      setActiveNode(node);
      setFriendMatchId(mid);
      setScreen('friend_match');
    } else if (nid) {
      void startSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, nodes.length]);

  const floorIq = progress?.floorIq ?? 80;
  const currentIq = progress?.iq ?? 80;
  const peakIq = progress?.peakIq ?? currentIq;

  // Hide the app HUD and bottom nav while a question is on screen. This also
  // removes the play-mode switch from reach, so the mode can only change on the map.
  useImmersiveMode(screen === 'playing');

  const canSubmitAnswer = !!rankedCurrent && (
    rankedCurrent.interaction.type === 'mcq'
      ? rankedChoiceIndex != null
      : rankedAnswerText.trim().length > 0
  );
  const currentUnlockedIdx = useMemo(() => {
    if (sorted.length === 0) return 0;
    let idx = 0;
    for (let i = 0; i < sorted.length; i++) {
      if ((sorted[i].iq ?? 0) <= floorIq) idx = i;
    }
    return idx;
  }, [sorted, floorIq]);

  // Auto-scroll: center the current unlocked node.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (sorted.length === 0) return;
    window.setTimeout(() => {
      const target = el.querySelector(`[data-logic-node-index="${currentUnlockedIdx}"]`) as HTMLElement | null;
      if (!target) return;
      const top = target.offsetTop;
      const height = target.offsetHeight;
      const viewport = el.clientHeight;
      const next = Math.max(0, top - viewport / 2 + height / 2);
      el.scrollTo({ top: next, behavior: 'smooth' });
    }, 50);
  }, [sorted.length, currentUnlockedIdx]);

  // No unlock gate any more: buckets are not student-facing and there are no
  // levels to reach. The server decides which question comes next.

  // ── Upward Timer (Stopwatch for IQ mode) ──────────────────────────────────

  function startElapsedTimer() {
    stopElapsedTimer();
    setElapsedSeconds(0);
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }

  useEffect(() => {
    return () => stopElapsedTimer();
  }, []);

  // The old per-node repeat queue lived in localStorage and deliberately re-served
  // questions a student got wrong. Never-repeat replaces it, and the server now owns
  // which question comes next, so it has been removed entirely.

  /** Loads the next server-matched question, or ends the session if none are left. */
  async function loadNextQuestion(): Promise<boolean> {
    const served = await fetchNextLogicGameQuestion(gamePlayMode);
    if (!served) {
      setExhausted(true);
      setRankedCurrent(null);
      return false;
    }
    setRankedCurrent(served);
    setRankedFeedback(null);
    setRankedAnswerText('');
    setRankedChoiceIndex(null);
    setIqDeltaFx(null);
    questionStartedAtRef.current = Date.now();
    if (gamePlayMode === 'iq') startElapsedTimer();
    return true;
  }

  async function submitAnswer() {
    if (!rankedCurrent || rankedFeedback) return;
    stopElapsedTimer();

    const interaction = rankedCurrent.interaction;
    const answer =
      interaction.type === 'mcq'
        ? { kind: 'mcq' as const, choiceIndex: rankedChoiceIndex ?? -1 }
        : interaction.type === 'numeric'
          ? { kind: 'numeric' as const, valueText: rankedAnswerText }
          : { kind: 'text' as const, valueText: rankedAnswerText };

    const timeMs = questionStartedAtRef.current ? Date.now() - questionStartedAtRef.current : undefined;

    try {
      // The server grades and rates. Whatever it returns is the truth the UI shows.
      const result = await submitLogicGameAnswer({
        nodeId: rankedCurrent.nodeId,
        questionId: rankedCurrent.questionId,
        answer,
        timeMs,
        mode: gamePlayMode,
      });

      setRankedFeedback({ correct: result.correct });
      setSessionCorrect((n) => n + (result.correct ? 1 : 0));

      if (gamePlayMode === 'iq') {
        setIqDeltaFx({ delta: result.delta, key: Date.now() });
        setProgress((prev) => ({
          id: 'global',
          iq: result.iqAfter,
          peakIq: result.peakIq ?? Math.max(prev?.peakIq ?? 80, result.iqAfter),
          updatedAt: new Date().toISOString(),
        }));
      }

      if (uid) {
        try {
          const k = interaction.type === 'mcq' ? 'mcq' : interaction.type === 'numeric' ? 'numeric' : 'text';
          await emitSolveEvent(uid, { correct: result.correct, kind: k, difficulty: 2 });
        } catch {
          // battle pass errors must not block play
        }
      }
    } catch (e) {
      setRankedError(e instanceof Error ? e.message : 'Could not submit that answer');
    }
  }

  /** Advances within the session, or shows the summary once it is complete. */
  async function continueGame() {
    if (!rankedCurrent) return;
    const nextIndex = sessionIndex + 1;

    if (nextIndex >= SESSION_LENGTH) {
      setSessionSummary({
        correct: sessionCorrect,
        total: SESSION_LENGTH,
        startIq: sessionStartIq,
        endIq: currentIq,
      });
      stopElapsedTimer();
      setRankedCurrent(null);
      return;
    }

    setSessionIndex(nextIndex);
    setRankedLoading(true);
    try {
      await loadNextQuestion();
    } catch (e) {
      setRankedError(e instanceof Error ? e.message : 'Could not load the next question');
    } finally {
      setRankedLoading(false);
    }
  }

  async function startSession() {
    if (!uid) return;
    setRankedLoading(true);
    setRankedError(null);
    setExhausted(false);
    setSessionSummary(null);
    setSessionIndex(0);
    setSessionCorrect(0);
    setSessionStartIq(currentIq);
    setScreen('playing');
    try {
      await loadNextQuestion();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRankedError(msg || 'Failed to start');
    } finally {
      setRankedLoading(false);
    }
  }

  function exitPlaying() {
    stopElapsedTimer();
    setScreen('map');
    setActiveNode(null);
    setIqDeltaFx(null);
    setRankedCurrent(null);
    setRankedAnswerText('');
    setRankedChoiceIndex(null);
    setRankedFeedback(null);
    setRankedError(null);
    setSessionSummary(null);
    setExhausted(false);
  }

  function renderPromptBlocks(blocks: LogicGamePromptBlock[] | undefined, fallbackText?: string) {
    const items = Array.isArray(blocks) ? blocks : [];
    if (items.length === 0) return <div style={{ whiteSpace: 'pre-wrap' }}>{fallbackText ?? '—'}</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((b, idx) => {
          if (b.type === 'text') return <div key={idx} style={{ whiteSpace: 'pre-wrap' }}>{b.text}</div>;
          if (b.type === 'math') {
            try {
              const html = katex.renderToString(b.latex, { throwOnError: false, displayMode: true });
              return <div key={idx} dangerouslySetInnerHTML={{ __html: html }} />;
            } catch {
              return <div key={idx} style={{ color: 'var(--ll-text-soft)', fontSize: 12, whiteSpace: 'pre-wrap' }}>{b.latex}</div>;
            }
          }
          if (b.type === 'image') {
            return (
              <div key={idx} style={{ display: 'flex', justifyContent: 'center' }}>
                <img src={b.url} alt={b.alt ?? ''} style={{ maxWidth: '100%', borderRadius: 12, border: '1px solid var(--ll-border)' }} />
              </div>
            );
          }
          if (b.type === 'table') {
            const headerRows = typeof b.headerRows === 'number' ? b.headerRows : 1;
            return (
              <div key={idx} style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', border: '1px solid var(--ll-border)', borderRadius: 12 }}>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, ci) => {
                          const isHeader = ri < headerRows;
                          const Cell: any = isHeader ? 'th' : 'td';
                          return (
                            <Cell
                              key={ci}
                              style={{
                                background: isHeader ? 'var(--ll-surface-1)' : 'var(--ll-surface-2)',
                                borderBottom: '1px solid var(--ll-border)',
                                borderRight: '1px solid var(--ll-border)',
                                padding: '8px 10px',
                                fontSize: 12,
                                color: 'var(--ll-text)',
                                fontWeight: isHeader ? 900 : 600,
                                textAlign: 'left',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {c}
                            </Cell>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return <div key={idx} style={{ color: 'var(--ll-text-soft)', fontSize: 12 }}>[unsupported block]</div>;
        })}
      </div>
    );
  }

  // ── Friend match logic (kept for notification-based match acceptance) ────

  function cleanupFriendListeners() {
    friendChallengeUnsubRef.current?.();
    friendChallengeUnsubRef.current = null;
    friendMatchUnsubRef.current?.();
    friendMatchUnsubRef.current = null;
    if (friendTickRef.current != null) {
      window.clearInterval(friendTickRef.current);
      friendTickRef.current = null;
    }
  }

  function computeFriendSecondsLeft(deadlineAt: string) {
    const t = Date.parse(deadlineAt);
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, Math.ceil((t - Date.now()) / 1000));
  }

  useEffect(() => {
    if (screen !== 'friend_match') return;
    setFriendAnswerText('');
    setFriendChoiceIndex(null);
    setFriendLocalFeedback(null);
    friendAutoTimeoutKeyRef.current = null;
  }, [screen, friendMatch?.currentRound?.questionId]);

  useEffect(() => {
    if (screen !== 'friend_match') return;
    if (!friendMatchId) return;

    cleanupFriendListeners();
    const unsub = listenLogicGameFriendMatch(friendMatchId, (m) => {
      friendMatchRef.current = m;
      setFriendMatch(m);
      const dl = m.currentRound?.deadlineAt;
      if (dl) setFriendSecondsLeft(computeFriendSecondsLeft(dl));
    });
    friendMatchUnsubRef.current = unsub;

    friendTickRef.current = window.setInterval(() => {
      const dl = friendMatchRef.current?.currentRound?.deadlineAt;
      if (!dl) return;
      const sec = computeFriendSecondsLeft(dl);
      setFriendSecondsLeft(sec);

      const m = friendMatchRef.current;
      if (!m || !uid) return;
      if (m.state !== 'playing') return;
      const round = m.currentRound;
      const already = !!round?.attempts?.[uid];
      if (already) return;

      if (sec <= 0) {
        const key = `${m.id}:${round.roundIndex}:${round.questionId}:${uid}`;
        if (friendAutoTimeoutKeyRef.current === key) return;
        friendAutoTimeoutKeyRef.current = key;
        void submitLogicGameFriendAttempt({ matchId: m.id, uid, status: 'timeout' });
      }
    }, 250);

    return () => {
      cleanupFriendListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, friendMatchId]);

  async function submitFriendAnswer(kind: 'mcq' | 'numeric' | 'text') {
    if (!uid || !friendMatch || !activeNode) return;
    if (friendMatch.state !== 'playing') return;
    if (friendLocalFeedback) return;
    const round = friendMatch.currentRound;
    const already = round?.attempts?.[uid];
    if (already) return;

    const secondsLeft = computeFriendSecondsLeft(round.deadlineAt);
    if (secondsLeft <= 0) {
      setFriendLocalFeedback({ status: 'timeout' });
      await submitLogicGameFriendAttempt({ matchId: friendMatch.id, uid, status: 'timeout' });
      return;
    }

    const q = await getLogicGameQuestionById(activeNode.id, round.questionId);
    if (!q) return;

    const g = q.interaction.type === 'mcq'
      ? (friendChoiceIndex == null ? { correct: false, correctIndex: 0 } : gradeInteraction(q.interaction, { kind: 'mcq', choiceIndex: friendChoiceIndex }))
      : q.interaction.type === 'numeric'
        ? gradeInteraction(q.interaction, { kind: 'numeric', valueText: friendAnswerText })
        : gradeInteraction(q.interaction, { kind: 'text', valueText: friendAnswerText });

    const status: 'correct' | 'wrong' = g.correct ? 'correct' : 'wrong';
    setFriendLocalFeedback({ status });
    await submitLogicGameFriendAttempt({ matchId: friendMatch.id, uid, status });
  }

  function FriendQuestion(props: {
    nodeId: string;
    questionId: string;
    renderPromptBlocks: (blocks: LogicGamePromptBlock[] | undefined, fallbackText?: string) => React.ReactNode;
    answerText: string;
    setAnswerText: (v: string) => void;
    choiceIndex: number | null;
    setChoiceIndex: (v: number | null) => void;
    disabled: boolean;
    onSubmit: () => void;
    onSubmitFreeform: (k: 'numeric' | 'text') => void;
  }) {
    const [q, setQ] = useState<LogicGameQuestion | null>(null);
    const [qErr, setQErr] = useState<string | null>(null);

    useEffect(() => {
      let alive = true;
      setQ(null);
      setQErr(null);
      getLogicGameQuestionById(props.nodeId, props.questionId)
        .then((found) => {
          if (!alive) return;
          setQ(found);
        })
        .catch((e) => {
          if (!alive) return;
          const msg = e instanceof Error ? e.message : String(e);
          setQErr(msg || 'Failed to load question');
        });
      return () => {
        alive = false;
      };
    }, [props.nodeId, props.questionId]);

    if (qErr) return <div style={{ color: '#fca5a5', fontSize: 12 }}>{qErr}</div>;
    if (!q) return <div style={{ color: 'var(--ll-text-soft)', fontSize: 12 }}>Loading question…</div>;

    return (
      <div>
        <div style={{ color: 'var(--ll-text)', fontSize: 18, lineHeight: 1.35, marginBottom: 12 }}>
          {props.renderPromptBlocks(q.promptBlocks, q.promptRawText ?? q.promptLatex ?? '—')}
        </div>

        {q.interaction.type === 'mcq' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {q.interaction.choices.map((c, idx) => {
              const chosen = props.choiceIndex === idx;
              return (
                <button
                  key={idx}
                  className="ll-btn"
                  disabled={props.disabled}
                  onClick={() => {
                    if (props.disabled) return;
                    props.setChoiceIndex(idx);
                  }}
                  style={{
                    fontSize: 16,
                    textAlign: 'left',
                    padding: '10px 10px',
                    borderRadius: 12,
                    border: chosen ? '1px solid rgba(59,130,246,0.55)' : '1px solid var(--ll-border)',
                    background: chosen ? 'rgba(59,130,246,0.10)' : 'var(--ll-surface-2)',
                    color: 'var(--ll-text)',
                    opacity: props.disabled && !chosen ? 0.75 : 1,
                  }}
                >
                  {c.toLowerCase().startsWith('data:image/') || c.toLowerCase().startsWith('http') ? (
                    <img src={c} alt="choice" style={{ maxWidth: '100%', maxHeight: 150, borderRadius: 4 }} />
                  ) : (
                    <>{c}</>
                  )}
                </button>
              );
            })}
            <button
              className="ll-btn ll-btn-primary"
              disabled={props.disabled || props.choiceIndex == null}
              onClick={props.onSubmit}
              style={{ padding: '10px 12px', fontSize: 13, width: '100%', marginTop: 8 }}
            >
              Submit
            </button>
          </div>
        ) : q.interaction.type === 'numeric' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={props.answerText}
              disabled={props.disabled}
              onChange={(e) => props.setAnswerText(e.target.value)}
              placeholder="Enter number"
              style={{
                width: '100%',
                padding: '12px 12px',
                borderRadius: 12,
                border: '1px solid var(--ll-border)',
                background: 'var(--ll-surface-2)',
                color: 'var(--ll-text)',
                outline: 'none',
                fontSize: 14,
                fontWeight: 900,
              }}
            />
            <button
              className="ll-btn ll-btn-primary"
              disabled={props.disabled || !props.answerText.trim()}
              onClick={() => props.onSubmitFreeform('numeric')}
              style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
            >
              Submit
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={props.answerText}
              disabled={props.disabled}
              onChange={(e) => props.setAnswerText(e.target.value)}
              placeholder="Type your answer"
              style={{
                width: '100%',
                padding: '12px 12px',
                borderRadius: 12,
                border: '1px solid var(--ll-border)',
                background: 'var(--ll-surface-2)',
                color: 'var(--ll-text)',
                outline: 'none',
                fontSize: 14,
                fontWeight: 900,
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') props.onSubmitFreeform('text');
              }}
            />
            <button
              className="ll-btn ll-btn-primary"
              disabled={props.disabled || !props.answerText.trim()}
              onClick={() => props.onSubmitFreeform('text')}
              style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
            >
              Submit
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Format elapsed time as mm:ss ──────────────────────────────────────────
  function formatTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ll-surface-0)', color: 'var(--ll-text)' }}>
      {/* ── Header: Left=IQ Games, Center=IQ, Right=Chill/IQ toggle ── */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ll-border)', background: 'var(--ll-overlay)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* Left: Title */}
          <div style={{ color: 'var(--ll-text)', fontWeight: 1000, fontSize: 16, minWidth: 120 }}>🧠 IQ Games</div>

          {/* Center: IQ display */}
          <div style={{ color: 'var(--ll-text-soft)', fontSize: 13, fontWeight: 900, textAlign: 'center' }}>
            IQ: <span style={{ color: '#fbbf24', fontSize: 15 }}>{currentIq.toFixed(1)}</span>
          </div>

          {/* Right: Chill/IQ mode toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120, justifyContent: 'flex-end' }}>
            <span style={{
              fontSize: 11, fontWeight: 800,
              color: gamePlayMode === 'chill' ? '#34d399' : 'var(--ll-text-muted)',
              transition: 'color 0.2s',
            }}>Chill</span>
            <button
              onClick={() => setGamePlayMode(gamePlayMode === 'chill' ? 'iq' : 'chill')}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: gamePlayMode === 'iq'
                  ? 'linear-gradient(135deg, #6366f1, #a78bfa)'
                  : 'linear-gradient(135deg, #059669, #34d399)',
                position: 'relative', transition: 'background 0.3s',
                boxShadow: gamePlayMode === 'iq'
                  ? '0 0 12px rgba(99,102,241,0.4)'
                  : '0 0 12px rgba(52,211,153,0.4)',
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: '50%', background: 'white',
                position: 'absolute', top: 3,
                left: gamePlayMode === 'iq' ? 23 : 3,
                transition: 'left 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
            <span style={{
              fontSize: 11, fontWeight: 800,
              color: gamePlayMode === 'iq' ? '#a78bfa' : 'var(--ll-text-muted)',
              transition: 'color 0.2s',
            }}>IQ</span>
          </div>
        </div>
        {err && <div style={{ marginTop: 10, color: '#fca5a5', fontSize: 12 }}>{err}</div>}
      </div>

      {/* ── Playing Screen ── */}
      {screen === 'playing' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Slim play header: Exit on the left, live IQ on the right. Replaces the
              app HUD and the IQ Games bar, both hidden while solving. */}
          <div className="app-safe-header" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '10px 14px', flexShrink: 0,
            borderBottom: '1px solid var(--ll-border)', background: 'var(--ll-overlay)',
          }}>
            <button className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={exitPlaying}>
              ← Exit
            </button>
            <div style={{
              color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 800,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {activeNode?.label ?? '—'}
            </div>
            {gamePlayMode === 'iq' ? (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{
                  fontSize: 13, fontWeight: 1000, padding: '4px 10px', borderRadius: 999,
                  background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
                  color: '#a78bfa', fontVariantNumeric: 'tabular-nums',
                }}>
                  🧠 {currentIq.toFixed(1)}
                </span>
                {iqDeltaFx && (
                  <span
                    key={iqDeltaFx.key}
                    aria-live="polite"
                    style={{
                      position: 'absolute', right: 0, top: '100%', marginTop: 2,
                      fontSize: 13, fontWeight: 1000, whiteSpace: 'nowrap', pointerEvents: 'none',
                      color: iqDeltaFx.delta >= 0 ? '#34d399' : '#fca5a5',
                      animation: 'llIqFloat 1.1s ease-out forwards',
                    }}
                  >
                    {iqDeltaFx.delta >= 0 ? '+' : ''}{iqDeltaFx.delta.toFixed(1)}
                  </span>
                )}
              </div>
            ) : (
              <span style={{
                fontSize: 12, fontWeight: 800, padding: '4px 10px', borderRadius: 999,
                background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)',
                color: '#34d399', flexShrink: 0,
              }}>😌 Chill</span>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>

          {rankedError && (
            <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{rankedError}</div>
          )}

          {rankedLoading ? (
            <div style={{ color: 'var(--ll-text-soft)' }}>Loading questions…</div>
          ) : !rankedCurrent ? (
            <div style={{ color: 'var(--ll-text-soft)' }}>No question available.</div>
          ) : (
            <div style={{ border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)', borderRadius: 14, padding: 12 }}>
              {/* Timer. The mode badge moved to the play header. */}
              {gamePlayMode === 'iq' && (
                <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  ⏱️ <span style={{ color: 'var(--ll-text)', fontFamily: 'monospace', fontSize: 14 }}>{formatTime(elapsedSeconds)}</span>
                </div>
              )}

              {/* Question prompt */}
              <div style={{ color: 'var(--ll-text)', fontSize: 18, lineHeight: 1.35, marginBottom: 12 }}>
                {renderPromptBlocks(rankedCurrent.promptBlocks, rankedCurrent.promptRawText ?? rankedCurrent.promptLatex ?? '—')}
              </div>

              {/* Answer choices */}
              {rankedCurrent.interaction.type === 'mcq' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rankedCurrent.interaction.choices.map((c, idx) => {
                    const chosen = rankedChoiceIndex === idx;
                    const disabled = !!rankedFeedback;
                    const isCorrect = rankedFeedback && rankedCurrent!.interaction.type === 'mcq' && (rankedCurrent!.interaction as any).correctChoiceIndex === idx;
                    const isWrong = rankedFeedback && chosen && !rankedFeedback.correct;
                    return (
                      <button
                        key={idx}
                        className="ll-btn"
                        disabled={disabled}
                        aria-pressed={chosen}
                        onClick={() => {
                          if (disabled) return;
                          setRankedChoiceIndex(idx);
                        }}
                        style={{
                          fontSize: 16,
                          textAlign: 'left',
                          padding: '14px 14px',
                          minHeight: 52,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          borderRadius: 12,
                          transition: 'border-color 0.15s, background 0.15s, transform 0.1s',
                          transform: chosen && !rankedFeedback ? 'scale(1.01)' : 'none',
                          border: rankedFeedback
                            ? isCorrect
                              ? '2px solid #34d399'
                              : isWrong
                                ? '2px solid #ef4444'
                                : chosen
                                  ? '2px solid rgba(59,130,246,0.55)'
                                  : '1px solid var(--ll-border)'
                            : chosen ? '2px solid rgba(59,130,246,0.8)' : '1px solid var(--ll-border)',
                          background: rankedFeedback
                            ? isCorrect
                              ? 'rgba(52,211,153,0.1)'
                              : isWrong
                                ? 'rgba(239,68,68,0.1)'
                                : chosen
                                  ? 'rgba(59,130,246,0.10)'
                                  : 'var(--ll-surface-2)'
                            : chosen ? 'rgba(59,130,246,0.10)' : 'var(--ll-surface-2)',
                          color: 'var(--ll-text)',
                          opacity: disabled && !chosen && !isCorrect ? 0.75 : 1,
                        }}
                      >
                        {/* A, B, C… marker keeps options scannable and gives the
                            result state somewhere to show without shifting layout. */}
                        <span style={{
                          flexShrink: 0, width: 26, height: 26, borderRadius: 8,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 1000,
                          background: isCorrect ? '#34d399' : isWrong ? '#ef4444' : chosen ? 'rgba(59,130,246,0.8)' : 'var(--ll-surface-3)',
                          color: isCorrect || isWrong || chosen ? '#0b1020' : 'var(--ll-text-soft)',
                        }}>
                          {isCorrect ? '✓' : isWrong ? '✕' : String.fromCharCode(65 + idx)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {c.toLowerCase().startsWith('data:image/') || c.toLowerCase().startsWith('http') ? (
                            <img src={c} alt="choice" style={{ maxWidth: '100%', maxHeight: 150, borderRadius: 4, display: 'block' }} />
                          ) : (
                            <>{c}</>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : rankedCurrent.interaction.type === 'numeric' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    value={rankedAnswerText}
                    disabled={!!rankedFeedback}
                    onChange={(e) => setRankedAnswerText(e.target.value)}
                    placeholder="Enter number"
                    style={{
                      width: '100%',
                      padding: '12px 12px',
                      borderRadius: 12,
                      border: '1px solid var(--ll-border)',
                      background: 'var(--ll-surface-2)',
                      color: 'var(--ll-text)',
                      outline: 'none',
                      fontSize: 14,
                      fontWeight: 900,
                    }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    value={rankedAnswerText}
                    disabled={!!rankedFeedback}
                    onChange={(e) => setRankedAnswerText(e.target.value)}
                    placeholder="Type your answer"
                    style={{
                      width: '100%',
                      padding: '12px 12px',
                      borderRadius: 12,
                      border: '1px solid var(--ll-border)',
                      background: 'var(--ll-surface-2)',
                      color: 'var(--ll-text)',
                      outline: 'none',
                      fontSize: 14,
                      fontWeight: 900,
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && canSubmitAnswer) void submitAnswer();
                    }}
                  />
                </div>
              )}

              {/* Feedback + Explanation */}
              {rankedFeedback && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: rankedFeedback.correct ? '#34d399' : '#fca5a5', fontWeight: 1000, marginBottom: 6 }}>
                    {rankedFeedback.correct ? '✅ Correct!' : '❌ Incorrect'}
                  </div>

                  {/* IQ mode: the signed delta also animates next to the IQ chip above. */}
                  {gamePlayMode === 'iq' && iqDeltaFx && (
                    <div style={{ fontSize: 12, color: 'var(--ll-text-soft)', marginBottom: 8 }}>
                      <span style={{ color: iqDeltaFx.delta >= 0 ? '#34d399' : '#fca5a5' }}>
                        {iqDeltaFx.delta >= 0 ? '+' : ''}{iqDeltaFx.delta.toFixed(1)} IQ
                      </span>
                      {rankedFeedback.correct ? ` (solved in ${formatTime(elapsedSeconds)})` : ''}
                    </div>
                  )}

                  {/* Chill mode OR always: show explanation if available */}
                  {rankedFeedback.explanation && (
                    <div style={{
                      padding: '10px 14px', borderRadius: 10, marginBottom: 10,
                      background: rankedFeedback.correct ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)',
                      border: `1px solid ${rankedFeedback.correct ? 'rgba(52,211,153,0.2)' : 'rgba(239,68,68,0.2)'}`,
                      color: 'var(--ll-text)', fontSize: 13, lineHeight: 1.5,
                    }}>
                      <div style={{ fontWeight: 800, fontSize: 11, color: 'var(--ll-text-soft)', marginBottom: 4 }}>💡 Explanation</div>
                      {rankedFeedback.explanation}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}
          </div>

          {/* Sticky action bar: one button that never moves, so Submit -> Next
              needs no scrolling. Width-capped rather than full-bleed. */}
          {!rankedLoading && rankedCurrent && (
            <div style={{
              flexShrink: 0, borderTop: '1px solid var(--ll-border)',
              background: 'var(--ll-overlay)', backdropFilter: 'blur(10px)',
              padding: '10px 14px',
              paddingBottom: 'max(10px, env(safe-area-inset-bottom, 10px))',
              display: 'flex', justifyContent: 'center',
            }}>
              <button
                className="ll-btn ll-btn-primary"
                disabled={rankedFeedback ? false : !canSubmitAnswer}
                onClick={() => { if (rankedFeedback) continueGame(); else void submitAnswer(); }}
                style={{ padding: '12px 16px', fontSize: 15, fontWeight: 900, width: '100%', maxWidth: 340, borderRadius: 12 }}
              >
                {rankedFeedback ? 'Next →' : 'Submit'}
              </button>
            </div>
          )}
        </div>
      ) : screen === 'friend_match' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'var(--ll-text)', fontWeight: 1000, fontSize: 13 }}>
              Match · {activeNode?.label ?? '—'}
            </div>
            <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => { cleanupFriendListeners(); setFriendMatch(null); setFriendMatchId(null); setScreen('map'); }}>
              Exit
            </button>
          </div>

          {!friendMatch ? (
            <div style={{ color: 'var(--ll-text-soft)' }}>Loading match…</div>
          ) : (
            <div style={{ border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)', borderRadius: 14, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <div style={{ color: 'var(--ll-text)', fontSize: 12, fontWeight: 1000 }}>
                  {friendMatch.hostUsername}: <span style={{ color: '#fbbf24' }}>{friendMatch.hostWins}</span>
                  <span style={{ color: 'var(--ll-text-muted)' }}> vs </span>
                  <span style={{ color: '#fbbf24' }}>{friendMatch.guestWins}</span> :{friendMatch.guestUsername}
                </div>
                <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900 }}>
                  Time: <span style={{ color: friendSecondsLeft <= 5 ? '#fca5a5' : 'var(--ll-text)' }}>{friendSecondsLeft}s</span>
                </div>
              </div>

              {friendMatch.state === 'complete' ? (
                <div style={{ color: 'var(--ll-text)' }}>
                  <div style={{ fontWeight: 1000, marginBottom: 10 }}>Match complete</div>
                  <button className="ll-btn ll-btn-primary" onClick={() => { cleanupFriendListeners(); setFriendMatch(null); setFriendMatchId(null); setScreen('map'); }} style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}>
                    Back
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900, marginBottom: 8 }}>
                    Round {Math.max(1, (friendMatch.currentRound.roundIndex ?? 0) + 1)} · First to 3
                  </div>

                  {/* Render the current question by loading the questions doc. */}
                  <FriendQuestion
                    nodeId={activeNode?.id ?? friendMatch.nodeId}
                    questionId={friendMatch.currentRound.questionId}
                    renderPromptBlocks={renderPromptBlocks}
                    answerText={friendAnswerText}
                    setAnswerText={setFriendAnswerText}
                    choiceIndex={friendChoiceIndex}
                    setChoiceIndex={setFriendChoiceIndex}
                    disabled={!!friendMatch.currentRound.attempts?.[uid ?? '']}
                    onSubmit={() => void submitFriendAnswer('mcq')}
                    onSubmitFreeform={(k) => void submitFriendAnswer(k)}
                  />

                  <div style={{ marginTop: 10, color: 'var(--ll-text-soft)', fontSize: 12 }}>
                    {(() => {
                      const a = friendMatch.currentRound.attempts ?? {};
                      const host = a[friendMatch.hostUid];
                      const guest = a[friendMatch.guestUid];
                      const fmt = (x: any) => x ? (x.status === 'correct' ? '✓' : x.status === 'timeout' ? '⏱' : '✗') : '…';
                      return `${friendMatch.hostUsername}: ${fmt(host)} | ${friendMatch.guestUsername}: ${fmt(guest)}`;
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ── Home Screen ── */
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}>
          <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {sessionSummary ? (
              <div style={{
                border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)',
                borderRadius: 18, padding: 24, textAlign: 'center',
              }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>
                  {sessionSummary.correct >= sessionSummary.total * 0.7 ? '🎉' : '💪'}
                </div>
                <div style={{ fontWeight: 1000, fontSize: 20, marginBottom: 4 }}>Session complete</div>
                <div style={{ color: 'var(--ll-text-soft)', fontSize: 14, marginBottom: 16 }}>
                  {sessionSummary.correct} of {sessionSummary.total} correct
                </div>
                {gamePlayMode === 'iq' && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 18 }}>
                    <span style={{ fontSize: 18, color: 'var(--ll-text-soft)', fontVariantNumeric: 'tabular-nums' }}>
                      {sessionSummary.startIq.toFixed(1)}
                    </span>
                    <span style={{ color: 'var(--ll-text-muted)' }}>→</span>
                    <span style={{
                      fontSize: 26, fontWeight: 1000, fontVariantNumeric: 'tabular-nums',
                      color: sessionSummary.endIq >= sessionSummary.startIq ? '#34d399' : '#fca5a5',
                    }}>
                      {sessionSummary.endIq.toFixed(1)}
                    </span>
                  </div>
                )}
                <button className="ll-btn ll-btn-primary" onClick={() => void startSession()}
                  style={{ padding: '12px 18px', fontSize: 15, fontWeight: 900, borderRadius: 12, width: '100%' }}>
                  Play again
                </button>
              </div>
            ) : (
              <>
                {/* Rating card */}
                <div style={{
                  border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)',
                  borderRadius: 18, padding: 24, textAlign: 'center',
                }}>
                  <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900, letterSpacing: 1 }}>YOUR IQ</div>
                  <div style={{ fontSize: 52, fontWeight: 1000, color: '#a78bfa', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                    {currentIq.toFixed(1)}
                  </div>
                  <div style={{ color: 'var(--ll-text-muted)', fontSize: 12, marginTop: 6 }}>
                    🏆 Highest reached <strong style={{ color: 'var(--ll-text-soft)' }}>{peakIq.toFixed(1)}</strong>
                  </div>
                </div>

                {exhausted && (
                  <div style={{
                    border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.10)',
                    borderRadius: 14, padding: 16, color: '#fbbf24', fontSize: 13, textAlign: 'center',
                  }}>
                    You have answered every question available. New ones appear here as they are added.
                  </div>
                )}

                <button
                  className="ll-btn ll-btn-primary"
                  disabled={rankedLoading}
                  onClick={() => void startSession()}
                  style={{ padding: '16px 18px', fontSize: 17, fontWeight: 1000, borderRadius: 14 }}
                >
                  {rankedLoading ? 'Loading…' : `▶ Play ${SESSION_LENGTH} questions`}
                </button>

                <div style={{ color: 'var(--ll-text-muted)', fontSize: 12, textAlign: 'center', lineHeight: 1.6 }}>
                  Questions are matched to your rating, and you will never be shown the
                  same one twice.
                  {gamePlayMode === 'chill' && <><br />Chill mode is on — your IQ will not change.</>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
