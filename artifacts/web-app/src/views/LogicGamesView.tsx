import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { LogicGameNode, LogicGamePromptBlock, LogicGamesProgressDoc, LogicGameQuestion } from '@/types/logicGames';
import {
  ensureLogicGamesProgress,
  getPublishedLogicGameQuestions,
  listPublishedLogicGameNodes,
  setLogicGamesIq,
} from '@/lib/logicGamesService';
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

type Mode = 'solo' | 'ranked' | 'friend';
type Screen = 'map' | 'ranked' | 'friend_waiting' | 'friend_match';

export default function LogicGamesView() {
  const { user, userData } = useAuth();
  const uid = user?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [nodes, setNodes] = useState<LogicGameNode[]>([]);
  const [progress, setProgress] = useState<LogicGamesProgressDoc | null>(null);

  const [previewUnlockAll, setPreviewUnlockAll] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [openNode, setOpenNode] = useState<LogicGameNode | null>(null);
  const [mode, setMode] = useState<Mode>('ranked');

  const [screen, setScreen] = useState<Screen>('map');
  const [activeNode, setActiveNode] = useState<LogicGameNode | null>(null);
  const [rankedLoading, setRankedLoading] = useState(false);
  const [rankedError, setRankedError] = useState<string | null>(null);
  const [rankedQuestions, setRankedQuestions] = useState<LogicGameQuestion[]>([]);
  const [rankedCurrent, setRankedCurrent] = useState<LogicGameQuestion | null>(null);
  const [rankedAnswerText, setRankedAnswerText] = useState('');
  const [rankedChoiceIndex, setRankedChoiceIndex] = useState<number | null>(null);
  const [rankedFeedback, setRankedFeedback] = useState<null | { correct: boolean; timedOut?: boolean }>(null);
  const [rankedSecondsLeft, setRankedSecondsLeft] = useState<number>(0);
  const rankedTimerRef = useRef<number | null>(null);

  const [rankedApplyIq, setRankedApplyIq] = useState(true);

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
    let alive = true;
    if (!uid) return;
    setLoading(true);
    setErr(null);
    Promise.all([listPublishedLogicGameNodes(), ensureLogicGamesProgress(uid)])
      .then(([n, p]) => {
        if (!alive) return;
        setNodes(n);
        setProgress(p);
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg || 'Failed to load logic games');
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [uid]);

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
    const node = sorted.find((n) => n.id === pid) ?? null;
    if (node) {
      setOpenNode(node);
      setMode('ranked');
    }
  }, [sorted]);

  // Resume a match accepted via NotificationsView
  useEffect(() => {
    if (!uid) return;
    const mid = typeof window !== 'undefined' ? localStorage.getItem('ll:logicGameFriendMatchId') : null;
    const nid = typeof window !== 'undefined' ? localStorage.getItem('ll:logicGameNodeId') : null;
    if (!mid) return;
    localStorage.removeItem('ll:logicGameFriendMatchId');
    if (nid) localStorage.removeItem('ll:logicGameNodeId');

    const node = nid ? nodes.find((n) => n.id === nid) ?? null : null;
    setActiveNode(node);
    setFriendMatchId(mid);
    setScreen('friend_match');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, nodes.length]);

  const floorIq = progress?.floorIq ?? 80;
  const currentIq = progress?.iq ?? 80;
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

  const canOpen = (n: LogicGameNode) => {
    if (previewUnlockAll) return true;
    const iq = n.iq ?? 0;
    return iq <= floorIq;
  };

  function stopRankedTimer() {
    if (rankedTimerRef.current != null) {
      window.clearInterval(rankedTimerRef.current);
      rankedTimerRef.current = null;
    }
  }

  function startRankedTimer(seconds: number) {
    stopRankedTimer();
    const initial = Math.max(0, Math.floor(seconds));
    setRankedSecondsLeft(initial);
    rankedTimerRef.current = window.setInterval(() => {
      setRankedSecondsLeft((s) => {
        const next = Math.max(0, s - 1);
        return next;
      });
    }, 1000);
  }

  useEffect(() => {
    if (screen !== 'ranked') return;
    if (!rankedCurrent) return;
    if (rankedFeedback) return;
    if (rankedSecondsLeft > 0) return;
    // Timeout -> wrong
    void submitRankedTimeout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, rankedSecondsLeft, rankedCurrent, rankedFeedback]);

  useEffect(() => {
    return () => stopRankedTimer();
  }, []);

  function pickNextRankedQuestion(all: LogicGameQuestion[], prevId?: string | null) {
    if (all.length === 0) {
      setRankedCurrent(null);
      return;
    }
    const pool = prevId ? all.filter((q) => q.id !== prevId) : all;
    const list = pool.length > 0 ? pool : all;
    const next = list[Math.floor(Math.random() * list.length)];
    setRankedCurrent(next);
    setRankedFeedback(null);
    setRankedAnswerText('');
    setRankedChoiceIndex(null);
    startRankedTimer(next.timeLimitSec);
  }

  function computeNextFloorIq(nextIq: number) {
    // Floor can only increase to an unlocked node's IQ and never decrease.
    const candidates = sorted.map((n) => n.iq).filter((v) => typeof v === 'number');
    const reached = candidates.filter((v) => v <= nextIq);
    const best = reached.length > 0 ? Math.max(...reached) : 80;
    return Math.max(floorIq, best);
  }

  async function applyIqDelta(delta: number) {
    if (!uid) return;
    const cur = progress?.iq ?? 80;
    const raw = cur + delta;
    const nextFloor = computeNextFloorIq(raw);
    const nextIq = Math.max(nextFloor, raw);
    await setLogicGamesIq(uid, nextIq, nextFloor);
    setProgress((p) => {
      const now = new Date().toISOString();
      return { id: 'global', iq: nextIq, floorIq: nextFloor, updatedAt: now };
    });
  }

  async function submitRankedTimeout() {
    if (!rankedCurrent) return;
    if (rankedFeedback) return;
    stopRankedTimer();
    setRankedFeedback({ correct: false, timedOut: true });
    if (uid) {
      try {
        await emitSolveEvent(uid, { correct: false, kind: 'step', difficulty: 2 });
      } catch {
        // ignore battle pass errors
      }
    }
    if (rankedApplyIq) await applyIqDelta(rankedCurrent.iqDeltaWrong);
  }

  async function submitRankedAnswer() {
    if (!rankedCurrent) return;
    if (rankedFeedback) return;
    stopRankedTimer();

    const secondsLeft = rankedSecondsLeft;
    if (secondsLeft <= 0) {
      await submitRankedTimeout();
      return;
    }

    const interaction = rankedCurrent.interaction;
    const g = interaction.type === 'mcq'
      ? (rankedChoiceIndex == null ? { correct: false, correctIndex: 0 } : gradeInteraction(interaction, { kind: 'mcq', choiceIndex: rankedChoiceIndex }))
      : interaction.type === 'numeric'
        ? gradeInteraction(interaction, { kind: 'numeric', valueText: rankedAnswerText })
        : gradeInteraction(interaction, { kind: 'text', valueText: rankedAnswerText });

    setRankedFeedback({ correct: g.correct });
    if (uid) {
      try {
        const k = interaction.type === 'mcq' ? 'mcq' : interaction.type === 'numeric' ? 'numeric' : 'text';
        await emitSolveEvent(uid, { correct: g.correct, kind: k, difficulty: 2 });
      } catch {
        // ignore battle pass errors
      }
    }
    if (rankedApplyIq) await applyIqDelta(g.correct ? rankedCurrent.iqDeltaCorrect : rankedCurrent.iqDeltaWrong);
  }

  function continueRanked() {
    if (!rankedCurrent) return;
    pickNextRankedQuestion(rankedQuestions, rankedCurrent.id);
  }

  async function startRanked(node: LogicGameNode, opts: { applyIq: boolean }) {
    if (!uid) return;
    setRankedLoading(true);
    setRankedError(null);
    setRankedApplyIq(!!opts.applyIq);
    try {
      const qdoc = await getPublishedLogicGameQuestions(node.id);
      const qs = Array.isArray(qdoc?.questions) ? qdoc!.questions : [];
      if (qs.length === 0) throw new Error('No questions found for this node');
      setRankedQuestions(qs);
      setActiveNode(node);
      setScreen('ranked');
      pickNextRankedQuestion(qs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRankedError(msg || 'Failed to start ranked');
    } finally {
      setRankedLoading(false);
    }
  }

  function exitRanked() {
    stopRankedTimer();
    setScreen('map');
    setActiveNode(null);
    setRankedQuestions([]);
    setRankedCurrent(null);
    setRankedAnswerText('');
    setRankedChoiceIndex(null);
    setRankedFeedback(null);
    setRankedError(null);
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

  function handleStart() {
    if (!openNode) return;
    if (mode === 'solo') {
      setOpenNode(null);
      void startRanked(openNode, { applyIq: false });
      return;
    }
    if (mode === 'ranked') {
      setOpenNode(null);
      void startRanked(openNode, { applyIq: true });
      return;
    }
    if (mode === 'friend') {
      setActiveNode(openNode);
      setFriendErr(null);
      setFriendPickUid(null);
      setOpenNode(null);
      setScreen('friend_waiting');
      return;
    }
  }

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

  async function sendFriendInvite() {
    if (!uid || !userData || !activeNode) return;
    const pick = friends.find((f) => f.uid === friendPickUid) ?? null;
    if (!pick || !pick.username) {
      setFriendErr('Pick a friend');
      return;
    }

    setFriendBusy(true);
    setFriendErr(null);
    try {
      const res = await sendLogicGameFriendChallenge({
        fromUid: uid,
        fromUsername: userData.username || uid,
        toUsername: String(pick.username),
        nodeId: activeNode.id,
        nodeLabel: activeNode.label,
      });
      if (!res.success || !res.challengeId) {
        setFriendErr(res.error || 'Failed to send');
        return;
      }
      setFriendChallengeId(res.challengeId);
      friendChallengeUnsubRef.current?.();
      const unsub = listenChallengeState(res.challengeId, (c) => {
        if (c.state === 'accepted' && c.sessionId) {
          setFriendMatchId(c.sessionId);
          setScreen('friend_match');
          friendChallengeUnsubRef.current?.();
          friendChallengeUnsubRef.current = null;
        }
        if (c.state === 'declined') {
          setFriendErr('Friend declined the request.');
          setFriendChallengeId(null);
          friendChallengeUnsubRef.current?.();
          friendChallengeUnsubRef.current = null;
        }
        if (c.state === 'canceled') {
          setFriendErr('Request was canceled.');
          setFriendChallengeId(null);
          friendChallengeUnsubRef.current?.();
          friendChallengeUnsubRef.current = null;
        }
      });
      friendChallengeUnsubRef.current = unsub;
    } finally {
      setFriendBusy(false);
    }
  }

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

    const qdoc = await getPublishedLogicGameQuestions(activeNode.id);
    const qs = Array.isArray(qdoc?.questions) ? (qdoc!.questions as LogicGameQuestion[]) : [];
    const q = qs.find((x) => x.id === round.questionId) ?? null;
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
      getPublishedLogicGameQuestions(props.nodeId)
        .then((doc0) => {
          if (!alive) return;
          const qs = Array.isArray(doc0?.questions) ? (doc0!.questions as LogicGameQuestion[]) : [];
          const found = qs.find((x) => x.id === props.questionId) ?? null;
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
        <div style={{ color: 'var(--ll-text)', fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
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
                    textAlign: 'left',
                    padding: '10px 10px',
                    borderRadius: 12,
                    border: chosen ? '1px solid rgba(59,130,246,0.55)' : '1px solid var(--ll-border)',
                    background: chosen ? 'rgba(59,130,246,0.10)' : 'var(--ll-surface-2)',
                    color: 'var(--ll-text)',
                    opacity: props.disabled && !chosen ? 0.75 : 1,
                  }}
                >
                  {c}
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--ll-surface-0)', color: 'var(--ll-text)' }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--ll-border)', background: 'var(--ll-overlay)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ color: 'var(--ll-text)', fontWeight: 1000, fontSize: 16 }}>🧩 Logic Games</div>
          <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900 }}>
            IQ: <span style={{ color: '#fbbf24' }}>{currentIq.toFixed(2).replace(/\.00$/, '')}</span>
            <span style={{ color: 'var(--ll-text-muted)' }}> · Floor: </span>
            <span style={{ color: 'var(--ll-text)' }}>{floorIq}</span>
          </div>
        </div>
        {err && <div style={{ marginTop: 10, color: '#fca5a5', fontSize: 12 }}>{err}</div>}
      </div>

      {screen === 'ranked' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'var(--ll-text)', fontWeight: 1000, fontSize: 13 }}>
              Ranked · {activeNode?.label ?? '—'}
            </div>
            <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={exitRanked}>
              Exit
            </button>
          </div>

          {rankedError && (
            <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{rankedError}</div>
          )}

          {rankedLoading ? (
            <div style={{ color: 'var(--ll-text-soft)' }}>Loading questions…</div>
          ) : !rankedCurrent ? (
            <div style={{ color: 'var(--ll-text-soft)' }}>No question available.</div>
          ) : (
            <div style={{ border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)', borderRadius: 14, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900 }}>
                  Time: <span style={{ color: rankedSecondsLeft <= 5 ? '#fca5a5' : 'var(--ll-text)' }}>{rankedSecondsLeft}s</span>
                </div>
                <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900 }}>
                  IQ Δ: <span style={{ color: '#34d399' }}>+{rankedCurrent.iqDeltaCorrect}</span>{' '}
                  <span style={{ color: '#fca5a5' }}>{rankedCurrent.iqDeltaWrong}</span>
                </div>
              </div>

              <div style={{ color: 'var(--ll-text)', fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
                {renderPromptBlocks(rankedCurrent.promptBlocks, rankedCurrent.promptRawText ?? rankedCurrent.promptLatex ?? '—')}
              </div>

              {rankedCurrent.interaction.type === 'mcq' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rankedCurrent.interaction.choices.map((c, idx) => {
                    const chosen = rankedChoiceIndex === idx;
                    const disabled = !!rankedFeedback;
                    return (
                      <button
                        key={idx}
                        className="ll-btn"
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return;
                          setRankedChoiceIndex(idx);
                        }}
                        style={{
                          textAlign: 'left',
                          padding: '10px 10px',
                          borderRadius: 12,
                          border: chosen ? '1px solid rgba(59,130,246,0.55)' : '1px solid var(--ll-border)',
                          background: chosen ? 'rgba(59,130,246,0.10)' : 'var(--ll-surface-2)',
                          color: 'var(--ll-text)',
                          opacity: disabled && !chosen ? 0.75 : 1,
                        }}
                      >
                        {c}
                      </button>
                    );
                  })}
                  <button
                    className="ll-btn ll-btn-primary"
                    disabled={!!rankedFeedback || rankedChoiceIndex == null}
                    onClick={() => void submitRankedAnswer()}
                    style={{ padding: '10px 12px', fontSize: 13, width: '100%', marginTop: 8 }}
                  >
                    Submit
                  </button>
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
                  <button
                    className="ll-btn ll-btn-primary"
                    disabled={!!rankedFeedback || !rankedAnswerText.trim()}
                    onClick={() => void submitRankedAnswer()}
                    style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                  >
                    Submit
                  </button>
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
                      if (e.key === 'Enter') void submitRankedAnswer();
                    }}
                  />
                  <button
                    className="ll-btn ll-btn-primary"
                    disabled={!!rankedFeedback || !rankedAnswerText.trim()}
                    onClick={() => void submitRankedAnswer()}
                    style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                  >
                    Submit
                  </button>
                </div>
              )}

              {rankedFeedback && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: rankedFeedback.correct ? '#34d399' : '#fca5a5', fontWeight: 1000, marginBottom: 10 }}>
                    {rankedFeedback.correct ? 'Correct' : rankedFeedback.timedOut ? 'Time ran out' : 'Wrong'}
                  </div>
                  <button
                    className="ll-btn ll-btn-primary"
                    onClick={continueRanked}
                    style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : screen === 'friend_waiting' ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'var(--ll-text)', fontWeight: 1000, fontSize: 13 }}>
              Play a Friend · {activeNode?.label ?? '—'}
            </div>
            <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => { cleanupFriendListeners(); setScreen('map'); }}>
              Back
            </button>
          </div>

          {friendErr && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{friendErr}</div>}

          <div style={{ border: '1px solid var(--ll-border)', background: 'var(--ll-surface-1)', borderRadius: 14, padding: 12 }}>
            <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900, marginBottom: 10 }}>Choose a friend</div>

            {friends.length === 0 ? (
              <div style={{ color: 'var(--ll-text-muted)', fontSize: 12 }}>
                No friends yet. Add friends from the Friends tab.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {friends.slice(0, 12).map((f) => {
                  const active = friendPickUid === f.uid;
                  return (
                    <button
                      key={f.uid}
                      className="ll-btn"
                      onClick={() => setFriendPickUid(f.uid)}
                      style={{
                        textAlign: 'left',
                        padding: '10px 10px',
                        borderRadius: 12,
                        border: active ? '1px solid rgba(59,130,246,0.55)' : '1px solid var(--ll-border)',
                        background: active ? 'rgba(59,130,246,0.10)' : 'var(--ll-surface-2)',
                        color: 'var(--ll-text)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <div style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--ll-surface-1)', border: '1px solid var(--ll-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 1000 }}>
                        {(String(f.username || 'F').slice(0, 1) || '?').toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 1000, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(f.username || 'Unknown')}</div>
                        <div style={{ color: 'var(--ll-text-muted)', fontSize: 11 }}>Tap to select</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              className="ll-btn ll-btn-primary"
              disabled={friendBusy || !friendPickUid || !!friendChallengeId}
              onClick={() => void sendFriendInvite()}
              style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
            >
              {friendChallengeId ? 'Waiting for response…' : friendBusy ? 'Sending…' : 'Send request'}
            </button>
          </div>
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
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, position: 'relative' }}>
          {loading ? (
            <div style={{ color: 'var(--ll-text-soft)', padding: 10 }}>Loading…</div>
          ) : sorted.length === 0 ? (
            <div style={{ color: 'var(--ll-text-soft)', padding: 10 }}>No nodes published yet.</div>
          ) : (
            <div style={{ position: 'relative', padding: '10px 0 30px' }}>
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: 10,
                bottom: 10,
                width: 4,
                transform: 'translateX(-50%)',
                borderRadius: 999,
                background: 'linear-gradient(to bottom, rgba(59,130,246,0.0), rgba(59,130,246,0.30), rgba(59,130,246,0.0))',
                opacity: 0.9,
              }}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {sorted.map((n, i) => {
                const unlocked = canOpen(n);
                const isCurrent = i === currentUnlockedIdx;
                const sideLeft = i % 2 === 0;
                const baseBg = unlocked ? 'rgba(59,130,246,0.10)' : 'var(--ll-surface-2)';
                const border = unlocked ? '1px solid rgba(59,130,246,0.45)' : '1px solid var(--ll-border)';
                const glow = isCurrent ? '0 0 0 4px rgba(251,191,36,0.08), 0 14px 40px rgba(0,0,0,0.45)' : '0 12px 34px rgba(0,0,0,0.35)';

                return (
                  <div
                    key={n.id}
                    data-logic-node-index={i}
                    style={{ display: 'flex', justifyContent: sideLeft ? 'flex-start' : 'flex-end' }}
                  >
                    <button
                      className="ll-btn"
                      disabled={!unlocked}
                      onClick={() => setOpenNode(n)}
                      style={{
                        width: 'min(420px, 92vw)',
                        textAlign: 'center',
                        padding: '18px 12px',
                        borderRadius: 14,
                        border,
                        background: baseBg,
                        color: unlocked ? 'var(--ll-text)' : 'var(--ll-text-soft)',
                        fontWeight: 1000,
                        letterSpacing: 0.4,
                        boxShadow: glow,
                        position: 'relative',
                      }}
                      title={unlocked ? 'Open node' : 'Locked — reach the previous IQ milestone to unlock'}
                    >
                      <div style={{ fontSize: 18 }}>{n.label}</div>
                      {isCurrent && (
                        <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 999, background: 'rgba(251,191,36,0.14)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24', fontSize: 11, fontWeight: 1000 }}>
                          Current
                        </div>
                      )}
                      {!unlocked && (
                        <div style={{ marginTop: 8, color: 'var(--ll-text-muted)', fontSize: 11, fontWeight: 900 }}>Locked</div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            </div>
          )}
        </div>
      )}

      {openNode && (
        <>
          <div
            onClick={() => setOpenNode(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 2200 }}
          />
          <div
            style={{
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(520px, 94vw)',
              background: 'var(--ll-surface-0)',
              border: '1px solid var(--ll-border)',
              borderRadius: 16,
              zIndex: 2201,
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: 14, borderBottom: '1px solid var(--ll-border)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--ll-surface-1)' }}>
              <div style={{ color: 'var(--ll-text)', fontWeight: 1000, fontSize: 14, flex: 1 }}>{openNode.label}</div>
              <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setOpenNode(null)}>
                Close
              </button>
            </div>
            <div style={{ padding: 14 }}>
              <div style={{ color: 'var(--ll-text-soft)', fontSize: 12, fontWeight: 900, marginBottom: 10 }}>Choose a mode</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                {([
                  { id: 'solo' as const, label: 'Solo' },
                  { id: 'ranked' as const, label: 'Ranked' },
                  { id: 'friend' as const, label: 'Play a Friend' },
                ]).map((m) => {
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      className={active ? 'll-btn ll-btn-primary' : 'll-btn'}
                      onClick={() => setMode(m.id)}
                      style={{ padding: '10px 10px', fontSize: 12, fontWeight: 1000 }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              <button
                className="ll-btn ll-btn-primary"
                onClick={handleStart}
                disabled={!uid || !userData}
                style={{ padding: '10px 12px', fontSize: 13, width: '100%', fontWeight: 1000 }}
              >
                Start
              </button>
              {!uid && <div style={{ marginTop: 10, color: '#fca5a5', fontSize: 12 }}>Not logged in.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
