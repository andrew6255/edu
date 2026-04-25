import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocation } from 'wouter';
import katex from 'katex';
import { useAuth } from '@/contexts/AuthContext';
import { getPublicProgramOrDraft, setProgramCompletedForUser, type TocItem } from '@/lib/programMaps';
import { applyRankedAnswer, claimRoadmapReward, getProgramProgress, markQuestionSolved, toggleUnitComplete } from '@/lib/programProgress';
import { applyRankedEnergyProgress, getUserData, updateEconomy } from '@/lib/userService';
import {
  createProgramFriendSession,
  joinProgramFriendSessionByCode,
  listenProgramFriendSession,
  submitProgramFriendAnswer,
  leaveProgramFriendSession,
  tryExpireWaitingProgramFriendSession,
  tryCompleteInactiveProgramFriendSession,
} from '@/lib/programFriendService';
import type { ProgramFriendSession } from '@/types/programFriend';
import {
  createProgramStudySession,
  heartbeatProgramStudySession,
  hostGoToIndex,
  hostSetReveal,
  hostStartProgramStudySession,
  joinProgramStudySessionByCode,
  listenProgramStudyMessages,
  listenProgramStudySession,
  leaveProgramStudySession,
  sendProgramStudyMessage,
  submitProgramStudyAnswer,
  tryCleanupInactiveProgramStudySession,
} from '@/lib/programStudySessionService';
import type { ProgramStudyMessage, ProgramStudySession } from '@/types/programStudySession';
import {
  fetchProgramAnnotationsFromPublic,
  fetchProgramChapterFromPublic,
  flattenProgramChapter,
  isProgramAnnotationsFile,
  isProgramChapter,
  type FlatProgramQuestion,
  type ProgramAtomicInteractionSpec,
  type ProgramAnnotationsFile,
  type ProgramPromptBlock,
  type ProgramStepSpec,
} from '@/lib/programQuestionBank';
import { gradeInteraction } from '@/lib/interactionGrader';

type Selected = { id: string; title: string; ref?: string | null } | null;

type Screen = 'chapters' | 'subsections' | 'types' | 'practice';

type PracticeMode = 'solo' | 'ranked' | 'friend' | 'study';

type HeaderMode = 'solo' | 'ranked' | 'friend';

type CompositeInteraction = {
  type: 'composite';
  final: ProgramAtomicInteractionSpec;
  steps: ProgramStepSpec[];
  allowDirectFinalAnswer?: boolean;
  scoreStrategy?: 'final_only' | 'final_plus_steps';
};

function isCompositeInteraction(interaction: FlatProgramQuestion['interaction'] | null): interaction is CompositeInteraction {
  return !!interaction && interaction.type === 'composite';
}

function getFinalInteraction(question: FlatProgramQuestion | null): ProgramAtomicInteractionSpec | null {
  const interaction = question?.interaction ?? null;
  if (!interaction) return null;
  return interaction.type === 'composite' ? interaction.final : interaction;
}

function getCompositeInteraction(question: FlatProgramQuestion | null): CompositeInteraction | null {
  const interaction = question?.interaction ?? null;
  return isCompositeInteraction(interaction) ? interaction : null;
}

function compactStepValues(values: Record<string, string>): Record<string, string> | undefined {
  const entries = Object.entries(values).filter(([, value]) => String(value ?? '').trim().length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isNumericInteraction(interaction: ProgramAtomicInteractionSpec | null): interaction is Extract<ProgramAtomicInteractionSpec, { type: 'numeric' }> {
  return !!interaction && interaction.type === 'numeric';
}

function isTextSubmittedInteraction(interaction: ProgramAtomicInteractionSpec | null): interaction is Extract<ProgramAtomicInteractionSpec, { type: 'text' | 'line_equation' | 'point_list' | 'points_on_line' }> {
  return !!interaction && (interaction.type === 'text' || interaction.type === 'line_equation' || interaction.type === 'point_list' || interaction.type === 'points_on_line');
}

function parsePointListDraft(valueText: string): Array<{ x: string; y: string }> {
  const matches = Array.from(String(valueText ?? '').matchAll(/\(?\s*(-?\d*(?:\.\d+)?)\s*,\s*(-?\d*(?:\.\d+)?)\s*\)?/g));
  return matches.map((match) => ({ x: String(match[1] ?? ''), y: String(match[2] ?? '') }));
}

function serializePointListDraft(rows: Array<{ x: string; y: string }>): string {
  return rows
    .map((row) => ({ x: String(row.x ?? '').trim(), y: String(row.y ?? '').trim() }))
    .filter((row) => row.x.length > 0 || row.y.length > 0)
    .map((row) => `(${row.x}, ${row.y})`)
    .join('\n');
}

type RoadmapFriendMarker = {
  uid: string;
  username: string;
  trophies: number;
};

function ConfettiBurst({ fire }: { fire: number }) {
  const pieces = useMemo(() => {
    const rand = (seed: number) => {
      const x = Math.sin(seed) * 10000;
      return x - Math.floor(x);
    };
    const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb7185'];
    const out = [] as Array<{
      left: number;
      delay: number;
      dur: number;
      rot: number;
      drift: number;
      color: string;
    }>;
    for (let i = 0; i < 26; i++) {
      const s = fire * 97 + i * 13;
      out.push({
        left: Math.round(rand(s + 1) * 1000) / 10,
        delay: Math.round(rand(s + 2) * 120) / 100,
        dur: 0.9 + rand(s + 3) * 0.8,
        rot: Math.round(rand(s + 4) * 720),
        drift: (rand(s + 5) - 0.5) * 320,
        color: colors[Math.floor(rand(s + 6) * colors.length)],
      });
    }
    return out;
  }, [fire]);

  if (!fire) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 50 }}>
      <style>
        {`@keyframes ll-confetti-fall {0%{transform:translate3d(var(--dx),-16px,0) rotate(var(--r));opacity:0}10%{opacity:1}100%{transform:translate3d(calc(var(--dx) * 1.15),110vh,0) rotate(calc(var(--r) + 520deg));opacity:0}}
@keyframes ll-confetti-pop {0%{opacity:0}15%{opacity:1}100%{opacity:0}}
        `}
      </style>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 50% 40%, rgba(59,130,246,0.16), rgba(0,0,0,0))',
          animation: 'll-confetti-pop 900ms ease forwards',
        }}
      />
      {pieces.map((p, idx) => (
        <div
          key={idx}
          style={{
            position: 'absolute',
            top: 0,
            left: `${p.left}%`,
            width: 8,
            height: 10,
            borderRadius: 2,
            background: p.color,
            boxShadow: `0 0 12px ${p.color}33`,
            opacity: 0,
            ['--dx' as any]: `${p.drift}px`,
            ['--r' as any]: `${p.rot}deg`,
            animation: `ll-confetti-fall ${p.dur.toFixed(2)}s ease-out ${p.delay.toFixed(2)}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

function flattenChildren(items: TocItem[] | undefined): TocItem[] {
  if (!Array.isArray(items)) return [];
  const out: TocItem[] = [];
  for (const it of items) {
    out.push(it);
    if (Array.isArray(it.children) && it.children.length > 0) {
      out.push(...flattenChildren(it.children));
    }
  }
  return out;
}

export default function ProgramMapView({ onBack, programId: programIdProp }: { onBack: () => void; programId?: string | null }) {
  const { user, userData } = useAuth();
  const uid = user?.uid ?? null;
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState<string>('Program Map');
  const [screen, setScreen] = useState<Screen>('chapters');
  const [practiceMode, setPracticeMode] = useState<PracticeMode | null>(null);
  const [headerMode, setHeaderMode] = useState<HeaderMode>('solo');
  const [studyPickMode, setStudyPickMode] = useState(false);
  const [tocTree, setTocTree] = useState<TocItem[]>([]);
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [completedUnitIds, setCompletedUnitIds] = useState<string[]>([]);
  const [solvedQuestionIds, setSolvedQuestionIds] = useState<string[]>([]);
  const [rankedTrophies, setRankedTrophies] = useState<number>(0);
  const [rankedSolvedQuestionIds, setRankedSolvedQuestionIds] = useState<string[]>([]);
  const [rankedIncorrectQuestionIds, setRankedIncorrectQuestionIds] = useState<string[]>([]);
  const [claimedRewardIds, setClaimedRewardIds] = useState<string[]>([]);
  const [showRankRoadmap, setShowRankRoadmap] = useState(false);
  const [roadmapFriends, setRoadmapFriends] = useState<RoadmapFriendMarker[]>([]);
  const [claimingRewardId, setClaimingRewardId] = useState<string | null>(null);
  const [chestOverlay, setChestOverlay] = useState<null | {
    rewardId: string;
    gold: number;
    stage: 'opening' | 'revealed';
  }>(null);
  const [isNarrow, setIsNarrow] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth < 760 : false));
  const [qbLoading, setQbLoading] = useState<boolean>(false);
  const [qbError, setQbError] = useState<string | null>(null);
  const [qbChapterId, setQbChapterId] = useState<string | null>(null);
  const [qbAnnotations, setQbAnnotations] = useState<ProgramAnnotationsFile | null>(null);
  const [qbQuestions, setQbQuestions] = useState<FlatProgramQuestion[]>([]);
  const [qbRegions, setQbRegions] = useState<Array<{ regionId: string; title: string; label: string | null; theme: string | null }>>([]);
  const [qbQuestionTypes, setQbQuestionTypes] = useState<Array<{ id: string; title: string; treeOrder: number }>>([]);
  const [divisionLabels, setDivisionLabels] = useState<string[]>(['Chapters', 'Topics']);

  const [mapRegionId, setMapRegionId] = useState<string | null>(null);

  const [soloActive, setSoloActive] = useState(false);
  const [soloRegionId, setSoloRegionId] = useState<string | null>(null);
  const [soloQuestionTypeId, setSoloQuestionTypeId] = useState<string | null>(null);
  const [soloQuestionId, setSoloQuestionId] = useState<string | null>(null);
  const [soloSeenIds, setSoloSeenIds] = useState<string[]>([]);
  const [soloFeedback, setSoloFeedback] = useState<{ correct: boolean; correctIndex: number } | null>(null);
  const [soloAwarding, setSoloAwarding] = useState(false);
  const [soloTextAnswer, setSoloTextAnswer] = useState('');
  const [soloStepAnswers, setSoloStepAnswers] = useState<Record<string, string>>({});

  const [friendCode, setFriendCode] = useState('');
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [friendSessionId, setFriendSessionId] = useState<string | null>(null);
  const [friendSession, setFriendSession] = useState<ProgramFriendSession | null>(null);
  const [friendCopied, setFriendCopied] = useState(false);
  const [friendStatus, setFriendStatus] = useState<string | null>(null);

  const [studyCode, setStudyCode] = useState('');
  const [studyBusy, setStudyBusy] = useState(false);
  const [studyError, setStudyError] = useState<string | null>(null);
  const [studySessionId, setStudySessionId] = useState<string | null>(null);
  const [studySession, setStudySession] = useState<ProgramStudySession | null>(null);
  const [studyMessages, setStudyMessages] = useState<ProgramStudyMessage[]>([]);
  const [studyChatText, setStudyChatText] = useState('');
  const [studyCopied, setStudyCopied] = useState(false);

  const [rankedActive, setRankedActive] = useState(false);
  const [rankedRegionId, setRankedRegionId] = useState<string | null>(null);
  const [rankedQuestionTypeId, setRankedQuestionTypeId] = useState<string | null>(null);
  const [rankedQuestionId, setRankedQuestionId] = useState<string | null>(null);
  const [rankedFeedback, setRankedFeedback] = useState<{ correct: boolean; correctIndex: number } | null>(null);
  const [rankedSaving, setRankedSaving] = useState(false);
  const [rankedTextAnswer, setRankedTextAnswer] = useState('');
  const [rankedStepAnswers, setRankedStepAnswers] = useState<Record<string, string>>({});

  const lastRankedCompleteRef = useRef<Record<string, boolean>>({});
  const lastRegionCompleteRef = useRef<Record<string, boolean>>({});
  const lastChapterCompleteRef = useRef<Record<string, boolean>>({});
  const [celebrateFire, setCelebrateFire] = useState(0);

  function difficultyRank(d: string | null): number {
    if (d === 'easy') return 1;
    if (d === 'medium') return 2;
    if (d === 'hard') return 3;
    return 9;
  }

  const rankNames = [
    'Bronze I', 'Bronze II', 'Bronze III',
    'Silver I', 'Silver II', 'Silver III',
    'Gold I', 'Gold II', 'Gold III',
    'Platinum I', 'Platinum II', 'Platinum III',
    'Diamond I', 'Diamond II', 'Diamond III',
    'Scholar', 'Master', 'Genius',
  ];

  function computeRankInfo(args: { trophies: number; totalQuestions: number }): { name: string; tier: number; tierSize: number } {
    const total = Math.max(0, args.totalQuestions);
    const totalTrophies = total * 15;
    const tierSize = Math.max(1, Math.floor(totalTrophies / 18));
    const tier = Math.max(0, Math.min(17, Math.floor(Math.max(0, args.trophies) / tierSize)));
    return { name: rankNames[tier] ?? 'Bronze I', tier, tierSize };
  }

  function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n));
  }

  function renderPromptText(q: FlatProgramQuestion | null): string {
    if (!q) return '—';
    if (Array.isArray(q.promptBlocks) && q.promptBlocks.length > 0) {
      const lines: string[] = [];
      for (const b of q.promptBlocks) {
        if (!b || typeof b !== 'object') continue;
        if ((b as any).type === 'text') lines.push(String((b as any).text ?? ''));
        else if ((b as any).type === 'math') lines.push(String((b as any).latex ?? ''));
        else if ((b as any).type === 'image') lines.push(String((b as any).caption ?? (b as any).url ?? ''));
        else if ((b as any).type === 'table') lines.push('[table]');
      }
      const t = lines.map((x) => String(x || '').trim()).filter(Boolean).join('\n');
      if (t) return t;
    }
    return q.promptRawText ?? q.promptLatex ?? '—';
  }

  function renderBlocks(blocks: ProgramPromptBlock[] | null | undefined, fallback?: string | null) {
    if (!blocks || blocks.length === 0) {
      return <div style={{ whiteSpace: 'pre-wrap' }}>{fallback ?? '—'}</div>;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {blocks.map((b: any, idx: number) => {
          if (!b || typeof b !== 'object') return null;
          if (b.type === 'text') {
            return <div key={idx} style={{ whiteSpace: 'pre-wrap' }}>{String(b.text ?? '')}</div>;
          }
          if (b.type === 'math') {
            const latex = String(b.latex ?? '');
            let html = '';
            try {
              html = latex ? katex.renderToString(latex, { throwOnError: false, displayMode: true }) : '';
            } catch {
              html = '';
            }
            return html ? (
              <div
                key={idx}
                style={{ overflowX: 'auto' }}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <div key={idx} style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{latex}</div>
            );
          }
          if (b.type === 'image') {
            const url = String(b.url ?? '');
            const alt = String(b.alt ?? b.caption ?? 'image');
            return (
              <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {url ? (
                  <img
                    src={url}
                    alt={alt}
                    style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 12, border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.35)' }}
                  />
                ) : (
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>[missing image url]</div>
                )}
                {(b.caption || b.alt) && (
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>{String(b.caption ?? b.alt ?? '')}</div>
                )}
              </div>
            );
          }
          if (b.type === 'table') {
            const rows: string[][] = Array.isArray(b.rows) ? b.rows.map((r: any) => (Array.isArray(r) ? r.map((c: any) => String(c ?? '')) : [])) : [];
            const headerRows = typeof b.headerRows === 'number' ? Math.max(0, Math.min(3, b.headerRows)) : 0;
            return (
              <div key={idx} style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #1f2a44' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420, background: 'rgba(2,6,23,0.35)' }}>
                  <tbody>
                    {rows.map((r, ri) => (
                      <tr key={ri}>
                        {r.map((c, ci) => {
                          const isHeader = ri < headerRows;
                          const Tag = isHeader ? 'th' : 'td';
                          return (
                            <Tag
                              key={ci}
                              style={{
                                borderBottom: '1px solid #1f2a44',
                                borderRight: '1px solid #1f2a44',
                                padding: '8px 10px',
                                textAlign: 'left',
                                color: 'white',
                                background: isHeader ? 'rgba(30,41,59,0.85)' : 'transparent',
                              }}
                            >
                              {c}
                            </Tag>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  function renderTextSubmittedEditor(
    interaction: Extract<ProgramAtomicInteractionSpec, { type: 'text' | 'line_equation' | 'point_list' | 'points_on_line' }>,
    value: string,
    setValue: Dispatch<SetStateAction<string>>,
    disabled: boolean,
    onSubmit: () => void,
  ) {
    if (interaction.type === 'point_list' || interaction.type === 'points_on_line') {
      const desiredRows = Math.max(
        interaction.maxPoints ?? 0,
        interaction.minPoints ?? 0,
        interaction.type === 'point_list' ? interaction.points.length : 0,
        parsePointListDraft(value).length,
        1,
      );
      const rows = Array.from({ length: desiredRows }, (_, idx) => parsePointListDraft(value)[idx] ?? { x: '', y: '' });
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Enter {interaction.minPoints ?? (interaction.type === 'point_list' ? interaction.points.length : 1)} point{(interaction.minPoints ?? (interaction.type === 'point_list' ? interaction.points.length : 1)) === 1 ? '' : 's'} as coordinate pairs.
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #1f2a44' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 280, background: 'rgba(15,23,42,0.45)' }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', color: '#cbd5e1', textAlign: 'left' }}>#</th>
                  <th style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', color: '#cbd5e1', textAlign: 'left' }}>x</th>
                  <th style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', color: '#cbd5e1', textAlign: 'left' }}>y</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44', color: '#94a3b8' }}>{idx + 1}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44' }}>
                      <input
                        value={row.x}
                        disabled={disabled}
                        inputMode="decimal"
                        onChange={(e) => {
                          const next = rows.map((item, itemIdx) => (itemIdx === idx ? { ...item, x: e.target.value } : item));
                          setValue(serializePointListDraft(next));
                        }}
                        placeholder="x"
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.55)', color: 'white', outline: 'none' }}
                      />
                    </td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid #1f2a44' }}>
                      <input
                        value={row.y}
                        disabled={disabled}
                        inputMode="decimal"
                        onChange={(e) => {
                          const next = rows.map((item, itemIdx) => (itemIdx === idx ? { ...item, y: e.target.value } : item));
                          setValue(serializePointListDraft(next));
                        }}
                        placeholder="y"
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.55)', color: 'white', outline: 'none' }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="ll-btn ll-btn-primary"
            disabled={disabled || !value.trim()}
            onClick={onSubmit}
            style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
          >
            Submit
          </button>
        </div>
      );
    }

    const placeholder = interaction.type === 'line_equation'
      ? `Enter equation${interaction.variable ? ` in ${interaction.variable}` : ''}`
      : 'Type your answer';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {interaction.type === 'line_equation' && (
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Equivalent equation forms are accepted when provided by the imported answer key.
          </div>
        )}
        <input
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '12px 12px',
            borderRadius: 12,
            border: '1px solid #1f2a44',
            background: 'rgba(15,23,42,0.6)',
            color: 'white',
            outline: 'none',
            fontSize: 14,
            fontWeight: 900,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit();
          }}
        />
        <button
          className="ll-btn ll-btn-primary"
          disabled={disabled || !value.trim()}
          onClick={onSubmit}
          style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
        >
          Submit
        </button>
      </div>
    );
  }

  function renderPromptBlocks(q: FlatProgramQuestion | null) {
    if (!q) return <div>—</div>;
    return renderBlocks(Array.isArray(q.promptBlocks) ? q.promptBlocks : null, q.promptRawText ?? q.promptLatex ?? '—');
  }

  function renderCompositeStepCards(
    q: FlatProgramQuestion | null,
    stepAnswers: Record<string, string>,
    setStepAnswers: Dispatch<SetStateAction<Record<string, string>>>,
    disabled: boolean,
  ) {
    const composite = getCompositeInteraction(q);
    if (!composite || composite.steps.length === 0) return null;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1 }}>
          Optional Working Steps
        </div>
        {composite.steps.map((step, idx) => {
          const value = stepAnswers[step.id] ?? '';
          const placeholder = step.interaction.type === 'numeric'
            ? 'Enter step result'
            : step.interaction.type === 'mcq'
              ? 'Write the choice or reasoning'
              : 'Type this step';
          return (
            <div
              key={step.id}
              style={{
                border: '1px solid #1f2a44',
                borderRadius: 12,
                padding: 10,
                background: 'rgba(15,23,42,0.45)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ color: 'white', fontWeight: 900, fontSize: 13 }}>{step.title || `Step ${idx + 1}`}</div>
              {renderBlocks(step.prompt, null)}
              <input
                value={value}
                disabled={disabled}
                onChange={(e) => setStepAnswers((prev) => ({ ...prev, [step.id]: e.target.value }))}
                placeholder={placeholder}
                style={{
                  width: '100%',
                  padding: '10px 10px',
                  borderRadius: 10,
                  border: '1px solid #1f2a44',
                  background: 'rgba(2,6,23,0.5)',
                  color: 'white',
                  outline: 'none',
                  fontSize: 13,
                }}
              />
              {step.explanation && (
                <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.35 }}>{step.explanation}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const rankedCandidates = useMemo(() => {
    if (!rankedActive || !rankedRegionId || !rankedQuestionTypeId) return [];
    return qbQuestions
      .filter((q) => q.regionId === rankedRegionId && q.questionTypeId === rankedQuestionTypeId && !!q.interaction)
      .sort((a, b) => {
        const da = difficultyRank(a.difficulty);
        const db = difficultyRank(b.difficulty);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });
  }, [qbQuestions, rankedActive, rankedRegionId, rankedQuestionTypeId]);

  const rankedCurrent = useMemo(() => {
    if (!rankedActive || !rankedQuestionId) return null;
    return qbQuestions.find((q) => q.id === rankedQuestionId) ?? null;
  }, [qbQuestions, rankedActive, rankedQuestionId]);

  function startRanked(regionId: string, questionTypeId: string) {
    setPracticeMode('ranked');
    setScreen('practice');
    setRankedActive(true);
    setRankedRegionId(regionId);
    setRankedQuestionTypeId(questionTypeId);
    setRankedFeedback(null);
    setRankedTextAnswer('');
    setRankedStepAnswers({});
    setRankedQuestionId(null);
    pickNextRankedQuestion({ regionId, questionTypeId });
  }

  function exitRanked() {
    setRankedActive(false);
    setRankedRegionId(null);
    setRankedQuestionTypeId(null);
    setRankedQuestionId(null);
    setRankedFeedback(null);
    setRankedSaving(false);
    setRankedTextAnswer('');
    setRankedStepAnswers({});

    setPracticeMode(null);
    setScreen('types');

    setFriendCode('');
    setFriendBusy(false);
    setFriendError(null);
    setFriendSessionId(null);
    setFriendSession(null);
    setFriendCopied(false);
    setFriendStatus(null);
  }

  function pickNextRankedQuestion(args?: { regionId?: string; questionTypeId?: string }) {
    const regionId = args?.regionId ?? rankedRegionId;
    const questionTypeId = args?.questionTypeId ?? rankedQuestionTypeId;
    if (!regionId || !questionTypeId) return;

    const all = qbQuestions
      .filter((q) => q.regionId === regionId && q.questionTypeId === questionTypeId && !!q.interaction)
      .sort((a, b) => {
        const da = difficultyRank(a.difficulty);
        const db = difficultyRank(b.difficulty);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });

    const correctSet = new Set(rankedSolvedQuestionIds);
    const incorrectSet = new Set(rankedIncorrectQuestionIds);

    const stageIds = (rank: number) => all.filter((q) => difficultyRank(q.difficulty) === rank).map((q) => q.id);
    const stageOrder = [1, 2, 3, 9];
    const stageRank =
      stageOrder.find((r) => {
        const ids = stageIds(r);
        if (ids.length === 0) return false;
        return ids.some((id) => !correctSet.has(id));
      }) ?? stageOrder.find((r) => stageIds(r).length > 0) ?? 1;

    const candidates = all.filter((q) => difficultyRank(q.difficulty) === stageRank);
    const unsolved = candidates.filter((q) => !correctSet.has(q.id) && !incorrectSet.has(q.id));
    const incorrect = candidates.filter((q) => !correctSet.has(q.id) && incorrectSet.has(q.id));

    const pickFrom = (pool: typeof candidates) => pool[Math.floor(Math.random() * pool.length)] ?? null;

    const next = unsolved.length > 0 ? pickFrom(unsolved) : (incorrect.length > 0 ? pickFrom(incorrect) : null);
    setRankedQuestionId(next?.id ?? null);
  }

  async function answerRankedMcq(idx: number) {
    const current = rankedCurrent;
    const finalInteraction = getFinalInteraction(current);
    if (!current || !finalInteraction || finalInteraction.type !== 'mcq' || rankedFeedback || !uid || !programId) return;
    const g = gradeInteraction(current.interaction, { kind: 'mcq', choiceIndex: idx });
    setRankedFeedback(g);

    try {
      setRankedSaving(true);
      const r = await applyRankedAnswer(uid, programId, current.id, g.correct);
      await applyRankedEnergyProgress(uid, g.correct);
      setRankedTrophies(r.trophies);
      setRankedSolvedQuestionIds(r.correctIds);
      setRankedIncorrectQuestionIds(r.incorrectIds);
    } catch {
      // ignore
    } finally {
      setRankedSaving(false);
    }
  }

  async function answerRankedFreeform(kind: 'numeric' | 'text') {
    const current = rankedCurrent;
    const finalInteraction = getFinalInteraction(current);
    if (!current || !current.interaction || !finalInteraction || rankedFeedback || !uid || !programId) return;
    if (kind === 'numeric' && !isNumericInteraction(finalInteraction)) return;
    if (kind === 'text' && !isTextSubmittedInteraction(finalInteraction)) return;

    const g = gradeInteraction(current.interaction, { kind, valueText: rankedTextAnswer });
    setRankedFeedback(g);

    try {
      setRankedSaving(true);
      const r = await applyRankedAnswer(uid, programId, current.id, g.correct);
      await applyRankedEnergyProgress(uid, g.correct);
      setRankedTrophies(r.trophies);
      setRankedSolvedQuestionIds(r.correctIds);
      setRankedIncorrectQuestionIds(r.incorrectIds);
    } catch {
      // ignore
    } finally {
      setRankedSaving(false);
    }
  }

  function continueRanked() {
    setRankedFeedback(null);
    setRankedTextAnswer('');
    setRankedStepAnswers({});
    pickNextRankedQuestion();
  }

  const activeProgramId = userData?.activeProgramId ?? null;

  const programId = programIdProp ?? activeProgramId;
  const isDraftPreviewProgram = !!programId && (programId.startsWith('ll-draft:') || programId.startsWith('ll-draftdb:'));

  function resetPracticeState() {
    setSoloActive(false);
    setRankedActive(false);
    setPracticeMode(null);
    setSoloRegionId(null);
    setSoloQuestionTypeId(null);
    setSoloQuestionId(null);
    setSoloSeenIds([]);
    setSoloFeedback(null);
    setSoloAwarding(false);
    setSoloTextAnswer('');
    setSoloStepAnswers({});
    setRankedRegionId(null);
    setRankedQuestionTypeId(null);
    setRankedQuestionId(null);
    setRankedFeedback(null);
    setRankedSaving(false);
    setFriendCode('');
    setFriendBusy(false);
    setFriendError(null);
    setFriendSessionId(null);
    setFriendSession(null);
    setFriendCopied(false);
    setFriendStatus(null);
    setStudyCode('');
    setStudyBusy(false);
    setStudyError(null);
    setStudySessionId(null);
    setStudySession(null);
    setStudyMessages([]);
    setStudyChatText('');
    setStudyCopied(false);
  }

  function handleBack() {
    if (screen === 'practice') {
      resetPracticeState();
      setScreen('types');
      return;
    }
    if (screen === 'types') {
      setScreen('subsections');
      resetPracticeState();
      return;
    }
    if (screen === 'subsections') {
      setScreen('chapters');
      setMapRegionId(null);
      setSelected(null);
      return;
    }
    onBack();
  }

  useEffect(() => {
    let cancelled = false;

    async function loadQuestionBank() {
      if (!programId) {
        setQbLoading(false);
        setQbError(null);
        setQbChapterId(null);
        setQbAnnotations(null);
        setQbQuestions([]);
        setQbRegions([]);
        setQbQuestionTypes([]);
        return;
      }

      setQbLoading(true);
      setQbError(null);

      try {
        const baseUrl = import.meta.env.BASE_URL || '/';
        const p = (rel: string) => `${baseUrl.replace(/\/+$/, '/')}${rel.replace(/^\/+/, '')}`;

        const prog = await getPublicProgramOrDraft(programId);

        let chapter: unknown;
        let annotations: unknown;

        // Prefer per-chapter question banks if present.
        if (prog?.questionBanksByChapter && typeof prog.questionBanksByChapter === 'object') {
          const banks = prog.questionBanksByChapter as Record<string, unknown>;
          const chapterId = activeUnitId && banks[activeUnitId] ? activeUnitId : Object.keys(banks)[0] ?? null;
          if (chapterId) {
            chapter = banks[chapterId];
            annotations = prog.annotations;
          }
        }

        // Fallback: single embedded question bank.
        if (!chapter && prog?.questionBank) {
          chapter = prog.questionBank;
          annotations = prog.annotations;
        }

        // Fallback: load from public paths.
        if (!chapter) {
          const rawChapterPath = prog?.questionBankPath || 'questionBanks/program.sample.v3.json';
          const rawAnnPath = prog?.annotationsPath || 'questionBanks/program.annotations.sample.v3.json';

          const chapterPath = rawChapterPath.startsWith('http')
            ? rawChapterPath
            : rawChapterPath.startsWith('/')
              ? p(rawChapterPath)
              : p(rawChapterPath);
          const annPath = rawAnnPath.startsWith('http') ? rawAnnPath : rawAnnPath.startsWith('/') ? p(rawAnnPath) : p(rawAnnPath);

          const r = await Promise.all([
            fetchProgramChapterFromPublic(chapterPath),
            fetchProgramAnnotationsFromPublic(annPath),
          ]);
          chapter = r[0];
          annotations = r[1];
        }

        if (!isProgramChapter(chapter)) {
          throw new Error('Invalid program question bank');
        }
        if (annotations && !isProgramAnnotationsFile(annotations)) {
          throw new Error('Invalid program annotations');
        }

        if (cancelled) return;

        const flat = flattenProgramChapter(chapter, (annotations as ProgramAnnotationsFile | null) ?? null);

        const existingHasMcq = new Set<string>();
        for (const q of flat.questions) {
          if (!q.mcq) continue;
          if (!q.regionId || !q.questionTypeId) continue;
          existingHasMcq.add(`${q.regionId}::${q.questionTypeId}`);
        }

        const dummyQuestions: FlatProgramQuestion[] = [];
        for (const r of flat.regions) {
          for (const t of flat.questionTypes) {
            const key = `${r.regionId}::${t.id}`;
            if (existingHasMcq.has(key)) continue;
            for (let i = 0; i < 3; i++) {
              const id = `DUMMY::${r.regionId}::${t.id}::${i + 1}`;
              dummyQuestions.push({
                id,
                chapterId: flat.chapterId,
                regionId: r.regionId,
                nodeId: 'DUMMY_NODE',
                nodeType: 'exercise',
                questionId: `DUMMY_Q${i + 1}`,
                partId: null,
                stemRawText: null,
                stemLatex: null,
                partRawText: null,
                partLatex: null,
                promptRawText: `Dummy question (${t.title})`,
                promptLatex: null,
                promptBlocks: null,
                annotationKey: id,
                questionTypeId: t.id,
                difficulty: 'easy',
                mcq: {
                  choices: ['Choice A', 'Choice B', 'Choice C', 'Choice D'],
                  correctChoiceIndex: 0,
                },
                interaction: { type: 'mcq', choices: ['Choice A', 'Choice B', 'Choice C', 'Choice D'], correctChoiceIndex: 0 },
                solutionText: null,
                hints: [],
                stepSolutions: [],
              });
            }
          }
        }

        setQbChapterId(flat.chapterId);
        setQbAnnotations((annotations as ProgramAnnotationsFile | null) ?? null);
        setQbQuestions([...flat.questions, ...dummyQuestions]);
        setQbRegions(flat.regions);
        setQbQuestionTypes(flat.questionTypes);
        setQbLoading(false);
      } catch (e) {
        if (cancelled) return;
        setQbError(e instanceof Error ? e.message : 'Failed to load question bank');
        setQbLoading(false);
      }
    }

    loadQuestionBank();
    return () => {
      cancelled = true;
    };
  }, [programId, activeUnitId]);

  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 760);
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const createProgramId = localStorage.getItem('ll:studyCreateProgramId');
    if (createProgramId && programId && createProgramId === programId) {
      setStudyPickMode(true);
      localStorage.removeItem('ll:studyCreateProgramId');
    }

    const resumeId = localStorage.getItem('ll:studyResumeSessionId');
    if (resumeId) {
      localStorage.removeItem('ll:studyResumeSessionId');
      if (uid) {
        const username = userData?.username || uid;
        setStudyBusy(true);
        setStudyError(null);
        joinProgramStudySessionByCode({ code: resumeId, participant: { uid, username } })
          .then((s) => {
            if (!s) {
              localStorage.removeItem('ll:ongoingStudySessionId');
              localStorage.removeItem('ll:ongoingStudyProgramId');
              return;
            }
            setPracticeMode('study');
            setScreen('practice');
            setStudySessionId(s.id);
            setStudySession(s);
          })
          .catch(() => {
            localStorage.removeItem('ll:ongoingStudySessionId');
            localStorage.removeItem('ll:ongoingStudyProgramId');
          })
          .finally(() => setStudyBusy(false));
      }
    }
  }, [programId, uid, userData?.username]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!programId) {
        setTitle('Program Map');
        setScreen('chapters');
        setTocTree([]);
        setActiveUnitId(null);
        setSelected(null);
        setCompletedUnitIds([]);
        setSolvedQuestionIds([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [prog, pp] = await Promise.all([
          getPublicProgramOrDraft(programId),
          uid && !isDraftPreviewProgram ? getProgramProgress(uid, programId) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        const completedIds = uid ? (pp?.completedUnitIds ?? []) : [];
        setCompletedUnitIds(completedIds);

        const solvedIds = uid ? ((pp as any)?.solvedQuestionIds ?? []) : [];
        setSolvedQuestionIds(Array.isArray(solvedIds) ? (solvedIds as string[]) : []);

        const rt = uid ? ((pp as any)?.rankedTrophies ?? 0) : 0;
        setRankedTrophies(typeof rt === 'number' ? (rt as number) : 0);

        const cr = uid ? ((pp as any)?.claimedRewardIds ?? []) : [];
        setClaimedRewardIds(Array.isArray(cr) ? (cr as string[]) : []);

        const rsolved = uid ? ((pp as any)?.rankedSolvedQuestionIds ?? []) : [];
        setRankedSolvedQuestionIds(Array.isArray(rsolved) ? (rsolved as string[]) : []);

        const rinc = uid ? ((pp as any)?.rankedIncorrectQuestionIds ?? []) : [];
        setRankedIncorrectQuestionIds(Array.isArray(rinc) ? (rinc as string[]) : []);

        if (!prog) {
          setTitle('Program Map');
          setScreen('chapters');
          setTocTree([]);
          setActiveUnitId(null);
          setSelected(null);
          setDivisionLabels(['Chapters', 'Topics']);
          setLoading(false);
          return;
        }

        setTitle(prog.title);
        const metaDivisions = Array.isArray((prog.programMeta as { divisions?: unknown } | null | undefined)?.divisions)
          ? ((prog.programMeta as { divisions?: unknown[] }).divisions ?? []).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          : [];
        setDivisionLabels(metaDivisions.length > 0 ? metaDivisions : ['Chapters', 'Topics']);
        setScreen('chapters');
        const nextToc = Array.isArray(prog.toc?.toc_tree) ? (prog.toc.toc_tree as TocItem[]) : [];
        setTocTree(nextToc);
        setActiveUnitId((prev) => {
          if (prev && nextToc.some((u) => u.id === prev)) return prev;
          const first = nextToc.find((u) => Array.isArray(u.children) && u.children.length > 0) ?? nextToc[0] ?? null;
          return first?.id ?? null;
        });
        setSelected(null);
        setMapRegionId(null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to load program map:', e);
        setTitle('Program Map');
        setScreen('chapters');
        setTocTree([]);
        setActiveUnitId(null);
        setSelected(null);
        setDivisionLabels(['Chapters', 'Topics']);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [programId, uid]);

  useEffect(() => {
    let alive = true;
    async function loadFriends() {
      if (!showRankRoadmap) return;
      if (!programId) return;
      if (!userData?.friends || userData.friends.length === 0) {
        if (alive) setRoadmapFriends([]);
        return;
      }

      const out = await Promise.all(
        userData.friends.map(async (fid) => {
          const [d, pp] = await Promise.all([
            getUserData(fid),
            getProgramProgress(fid, programId),
          ]);
          const username = (d as any)?.username ? String((d as any).username) : 'Friend';
          const trophies = typeof (pp as any)?.rankedTrophies === 'number' ? ((pp as any).rankedTrophies as number) : 0;
          return { uid: fid, username, trophies } satisfies RoadmapFriendMarker;
        })
      );

      out.sort((a, b) => b.trophies - a.trophies);
      if (alive) setRoadmapFriends(out);
    }

    loadFriends();
    return () => {
      alive = false;
    };
  }, [showRankRoadmap, userData?.friends, programId]);

  function normalizeText(s: string | null | undefined): string {
    return String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizedTokens(s: string | null | undefined): string[] {
    const t = normalizeText(s);
    if (!t) return [];
    return t.split(' ').filter(Boolean);
  }

  function scoreRegionMatch(args: {
    tocLabel: string | null;
    tocTitleBody: string;
    regionLabel: string | null;
    regionTitle: string;
  }): number {
    const tocLabel = args.tocLabel;
    const regionLabel = args.regionLabel;

    if (tocLabel && regionLabel && tocLabel === regionLabel) return 1000;

    const tocTitle = normalizeText(args.tocTitleBody);
    const regTitle = normalizeText(args.regionTitle);
    if (!tocTitle || !regTitle) return 0;

    if (tocTitle === regTitle) return 900;
    if (tocTitle.includes(regTitle) || regTitle.includes(tocTitle)) return 750;

    const tocIsReview = tocTitle.includes('review');
    const regIsReview = regTitle.includes('review');
    if (tocIsReview && regIsReview) return 700;

    const tocTokens = new Set(normalizedTokens(tocTitle));
    const regTokens = new Set(normalizedTokens(regTitle));
    if (tocTokens.size === 0 || regTokens.size === 0) return 0;

    let overlap = 0;
    for (const tok of tocTokens) if (regTokens.has(tok)) overlap++;
    const denom = Math.max(tocTokens.size, regTokens.size);
    const ratio = denom > 0 ? overlap / denom : 0;
    return Math.round(ratio * 650);
  }

  function parseTocSectionTitle(t: string): { label: string | null; titleBody: string } {
    const raw = String(t ?? '').trim();
    const m = raw.match(/^([0-9]+(?:\.[0-9]+)*)\s+(.*)$/);
    if (!m) return { label: null, titleBody: raw };
    return { label: m[1], titleBody: (m[2] ?? '').trim() };
  }

  const tocUnits = useMemo(() => {
    return Array.isArray(tocTree) ? tocTree : [];
  }, [tocTree]);

  const activeUnit = useMemo(() => {
    if (!activeUnitId) return null;
    return tocUnits.find((u) => u.id === activeUnitId) ?? null;
  }, [activeUnitId, tocUnits]);

  const tocSubsections = useMemo(() => {
    const children = activeUnit?.children;
    return Array.isArray(children) ? children : [];
  }, [activeUnit]);

  const tocSubsectionsWithRegions = useMemo(() => {
    return tocSubsections.map((s) => {
      const parsed = parseTocSectionTitle(s.title);
      const label = parsed.label;
      const titleBody = parsed.titleBody;

      let region: (typeof qbRegions)[number] | null = null;
      if (label) {
        region = qbRegions.find((r) => r.label === label) ?? null;
      }
      if (!region) {
        let best: (typeof qbRegions)[number] | null = null;
        let bestScore = 0;
        for (const r of qbRegions) {
          const score = scoreRegionMatch({
            tocLabel: label,
            tocTitleBody: titleBody,
            regionLabel: r.label,
            regionTitle: r.title,
          });
          if (score > bestScore) {
            bestScore = score;
            best = r;
          }
        }
        region = bestScore >= 500 ? best : null;
      }

      if (!region && qbRegions.length > 0) {
        region = qbRegions[0] ?? null;
      }
      return {
        toc: s,
        label,
        titleBody,
        regionId: region?.regionId ?? null,
        regionTitle: region?.title ?? null,
        regionTheme: region?.theme ?? null,
      };
    });
  }, [tocSubsections, qbRegions]);

  const qbCounts = useMemo(() => {
    const byRegion: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byRegionAndType: Record<string, Record<string, number>> = {};

    for (const q of qbQuestions) {
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegion[rid] = (byRegion[rid] ?? 0) + 1;
      byType[tid] = (byType[tid] ?? 0) + 1;
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }

    return { byRegion, byType, byRegionAndType };
  }, [qbQuestions]);

  const qbMcqCounts = useMemo(() => {
    const byRegion: Record<string, number> = {};
    const byRegionAndType: Record<string, Record<string, number>> = {};
    for (const q of qbQuestions) {
      if (!q.mcq) continue;
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegion[rid] = (byRegion[rid] ?? 0) + 1;
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }
    return { byRegion, byRegionAndType };
  }, [qbQuestions]);

  const qbSolvedCounts = useMemo(() => {
    const solvedSet = new Set(solvedQuestionIds);
    const byRegion: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byRegionAndType: Record<string, Record<string, number>> = {};

    for (const q of qbQuestions) {
      if (!solvedSet.has(q.id)) continue;
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegion[rid] = (byRegion[rid] ?? 0) + 1;
      byType[tid] = (byType[tid] ?? 0) + 1;
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }

    return { byRegion, byType, byRegionAndType };
  }, [qbQuestions, solvedQuestionIds]);

  const qbRankedSolvedCounts = useMemo(() => {
    const solvedSet = new Set(rankedSolvedQuestionIds);
    const byRegion: Record<string, number> = {};
    const byRegionAndType: Record<string, Record<string, number>> = {};
    for (const q of qbQuestions) {
      if (!solvedSet.has(q.id)) continue;
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegion[rid] = (byRegion[rid] ?? 0) + 1;
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }
    return { byRegion, byRegionAndType };
  }, [qbQuestions, rankedSolvedQuestionIds]);

  const qbMcqRankedSolvedCounts = useMemo(() => {
    const solvedSet = new Set(rankedSolvedQuestionIds);
    const byRegion: Record<string, number> = {};
    const byRegionAndType: Record<string, Record<string, number>> = {};
    for (const q of qbQuestions) {
      if (!q.mcq) continue;
      if (!solvedSet.has(q.id)) continue;
      const rid = q.regionId ?? 'unassigned';
      const tid = q.questionTypeId ?? 'untyped';
      byRegion[rid] = (byRegion[rid] ?? 0) + 1;
      byRegionAndType[rid] = byRegionAndType[rid] ?? {};
      byRegionAndType[rid][tid] = (byRegionAndType[rid][tid] ?? 0) + 1;
    }
    return { byRegion, byRegionAndType };
  }, [qbQuestions, rankedSolvedQuestionIds]);

  useEffect(() => {
    if (!rankedRegionId || !rankedQuestionTypeId) return;
    const total = qbMcqCounts.byRegionAndType[rankedRegionId]?.[rankedQuestionTypeId] ?? 0;
    const solved = qbMcqRankedSolvedCounts.byRegionAndType[rankedRegionId]?.[rankedQuestionTypeId] ?? 0;
    const key = `${rankedRegionId}::${rankedQuestionTypeId}`;
    const complete = total > 0 && solved >= total;
    const was = !!lastRankedCompleteRef.current[key];
    if (!was && complete) {
      setCelebrateFire((n) => n + 1);
    }
    lastRankedCompleteRef.current[key] = complete;
  }, [rankedRegionId, rankedQuestionTypeId, qbMcqCounts.byRegionAndType, qbMcqRankedSolvedCounts.byRegionAndType]);

  useEffect(() => {
    if (!mapRegionId) return;
    const total = qbMcqCounts.byRegion[mapRegionId] ?? 0;
    const solved = qbMcqRankedSolvedCounts.byRegion[mapRegionId] ?? 0;
    const complete = total > 0 && solved >= total;
    const was = !!lastRegionCompleteRef.current[mapRegionId];
    if (!was && complete) {
      setCelebrateFire((n) => n + 1);
    }
    lastRegionCompleteRef.current[mapRegionId] = complete;
  }, [mapRegionId, qbMcqCounts.byRegion, qbMcqRankedSolvedCounts.byRegion]);

  const chapterCompletion = useMemo(() => {
    const completeByUnitId: Record<string, boolean> = {};
    for (const unit of tocUnits) {
      const subs = Array.isArray(unit.children) ? unit.children : [];
      let total = 0;
      let solved = 0;
      for (const s of subs) {
        const parsed = parseTocSectionTitle(s.title);
        const label = parsed.label;
        const titleBody = parsed.titleBody;

        let region: (typeof qbRegions)[number] | null = null;
        if (label) region = qbRegions.find((r) => r.label === label) ?? null;
        if (!region) {
          let best: (typeof qbRegions)[number] | null = null;
          let bestScore = 0;
          for (const r of qbRegions) {
            const score = scoreRegionMatch({
              tocLabel: label,
              tocTitleBody: titleBody,
              regionLabel: r.label,
              regionTitle: r.title,
            });
            if (score > bestScore) {
              bestScore = score;
              best = r;
            }
          }
          region = bestScore >= 500 ? best : null;
        }

        const rid = region?.regionId ?? null;
        if (!rid) continue;
        total += qbMcqCounts.byRegion[rid] ?? 0;
        solved += qbMcqRankedSolvedCounts.byRegion[rid] ?? 0;
      }

      completeByUnitId[unit.id] = total > 0 && solved >= total;
    }
    return completeByUnitId;
  }, [tocUnits, qbRegions, qbMcqCounts.byRegion, qbMcqRankedSolvedCounts.byRegion]);

  useEffect(() => {
    if (!activeUnitId) return;
    const complete = !!chapterCompletion[activeUnitId];
    const was = !!lastChapterCompleteRef.current[activeUnitId];
    if (!was && complete) setCelebrateFire((n) => n + 1);
    lastChapterCompleteRef.current[activeUnitId] = complete;
  }, [activeUnitId, chapterCompletion]);

  const overallMcqRankedSolved = useMemo(() => {
    return Object.values(qbMcqRankedSolvedCounts.byRegion).reduce((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
  }, [qbMcqRankedSolvedCounts.byRegion]);

  const overallSolved = solvedQuestionIds.length;
  const overallTotal = qbQuestions.length;

  const playableOverallTotal = useMemo(() => qbQuestions.filter((q) => !!q.mcq).length, [qbQuestions]);

  const rankRoadmapScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showRankRoadmap) return;
    const el = rankRoadmapScrollRef.current;
    if (!el) return;

    const totalQuestions = playableOverallTotal;
    const totalTrophies = Math.max(0, totalQuestions * 15);
    const pxPerTrophy = clamp(0.07, 0.05, 0.11);
    const trackHeight = Math.max(900, totalTrophies * pxPerTrophy + 240);
    const playerProgressPct = totalTrophies > 0 ? clamp(rankedTrophies / totalTrophies, 0, 1) : 0;
    const playerY = playerProgressPct * (trackHeight - 120) + 50;

    // Center the player position in the scroll viewport.
    window.setTimeout(() => {
      const viewport = el.clientHeight || 0;
      const next = Math.max(0, playerY - viewport * 0.5);
      el.scrollTo({ top: next, behavior: 'smooth' });
    }, 50);
  }, [showRankRoadmap, rankedTrophies, playableOverallTotal]);

  const mapRegion = useMemo(() => {
    if (!mapRegionId) return null;
    return qbRegions.find((r) => r.regionId === mapRegionId) ?? null;
  }, [mapRegionId, qbRegions]);

  const regionTypeCounts = useMemo(() => {
    if (!mapRegionId) return [] as Array<{ tid: string; count: number }>;
    return Object.entries(qbMcqCounts.byRegionAndType[mapRegionId] ?? {})
      .map(([tid, count]) => ({ tid, count }))
      .sort((a, b) => (qbQuestionTypes.find((t) => t.id === a.tid)?.treeOrder ?? 999) - (qbQuestionTypes.find((t) => t.id === b.tid)?.treeOrder ?? 999));
  }, [mapRegionId, qbMcqCounts.byRegionAndType, qbQuestionTypes]);

  const chaptersPathFill = useMemo(() => {
    const total = playableOverallTotal;
    if (total <= 0) return 0;
    const solved = overallMcqRankedSolved;
    return Math.max(0, Math.min(1, solved / total));
  }, [playableOverallTotal, overallMcqRankedSolved]);

  const subsectionsPathFill = useMemo(() => {
    if (!activeUnitId) return 0;
    if (!Array.isArray(tocSubsectionsWithRegions) || tocSubsectionsWithRegions.length === 0) return 0;
    let total = 0;
    let solved = 0;
    for (const s of tocSubsectionsWithRegions) {
      const rid = s.regionId;
      if (!rid) continue;
      total += qbMcqCounts.byRegion[rid] ?? 0;
      solved += qbMcqRankedSolvedCounts.byRegion[rid] ?? 0;
    }
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, solved / total));
  }, [activeUnitId, tocSubsectionsWithRegions, qbMcqCounts.byRegion, qbMcqRankedSolvedCounts.byRegion]);

  function findBestRegionForTocSubsection(tocTitle: string): (typeof qbRegions)[number] | null {
    const parsed = parseTocSectionTitle(tocTitle);
    const label = parsed.label;
    const titleBody = parsed.titleBody;

    if (label) {
      const byLabel = qbRegions.find((r) => r.label === label) ?? null;
      if (byLabel) return byLabel;
    }

    let best: (typeof qbRegions)[number] | null = null;
    let bestScore = 0;
    for (const r of qbRegions) {
      const score = scoreRegionMatch({
        tocLabel: label,
        tocTitleBody: titleBody,
        regionLabel: r.label,
        regionTitle: r.title,
      });
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return bestScore >= 500 ? best : null;
  }

  const unitRankedProgress = useMemo(() => {
    const out: Record<string, { solved: number; total: number }> = {};

    for (const u of tocUnits) {
      const subs = Array.isArray(u.children) ? u.children : [];
      let total = 0;
      let solved = 0;

      for (const s of subs) {
        const region = findBestRegionForTocSubsection(s.title);
        if (!region) continue;
        total += qbMcqCounts.byRegion[region.regionId] ?? 0;
        solved += qbMcqRankedSolvedCounts.byRegion[region.regionId] ?? 0;
      }

      out[u.id] = { solved, total };
    }

    return out;
  }, [tocUnits, qbRegions, qbMcqCounts.byRegion, qbMcqRankedSolvedCounts.byRegion]);

  const tocUnitsWithQuestions = useMemo(() => {
    return tocUnits.filter((u) => (unitRankedProgress[u.id]?.total ?? 0) > 0);
  }, [tocUnits, unitRankedProgress]);

  useEffect(() => {
    if (!activeUnitId) return;
    if (tocUnitsWithQuestions.some((u) => u.id === activeUnitId)) return;
    setActiveUnitId(null);
    setSelected(null);
    setMapRegionId(null);
    setScreen('chapters');
  }, [activeUnitId, tocUnitsWithQuestions]);

  const soloCandidates = useMemo(() => {
    if (!soloActive || !soloRegionId || !soloQuestionTypeId) return [];
    return qbQuestions.filter((q) => q.regionId === soloRegionId && q.questionTypeId === soloQuestionTypeId && !!q.interaction);
  }, [qbQuestions, soloActive, soloRegionId, soloQuestionTypeId]);

  const soloCurrent = useMemo(() => {
    if (!soloActive || !soloQuestionId) return null;
    return qbQuestions.find((q) => q.id === soloQuestionId) ?? null;
  }, [qbQuestions, soloActive, soloQuestionId]);

  function pickNextSoloQuestion(args: { regionId: string; questionTypeId: string; seen: string[] }) {
    const candidates = qbQuestions.filter((q) => q.regionId === args.regionId && q.questionTypeId === args.questionTypeId && !!q.interaction);
    const unseen = candidates.filter((q) => !args.seen.includes(q.id));
    const unsolvedUnseen = unseen.filter((q) => !solvedQuestionIds.includes(q.id));
    const unsolvedAny = candidates.filter((q) => !solvedQuestionIds.includes(q.id));
    const pool = unsolvedUnseen.length > 0 ? unsolvedUnseen : (unsolvedAny.length > 0 ? unsolvedAny : (unseen.length > 0 ? unseen : candidates));
    if (pool.length === 0) {
      setSoloQuestionId(null);
      return;
    }
    const next = pool[Math.floor(Math.random() * pool.length)];
    setSoloQuestionId(next.id);
  }

  function startSolo(regionId: string, questionTypeId: string) {
    setPracticeMode('solo');
    setScreen('practice');
    setSoloActive(true);
    setSoloRegionId(regionId);
    setSoloQuestionTypeId(questionTypeId);
    setSoloSeenIds([]);
    setSoloFeedback(null);
    setSoloTextAnswer('');
    setSoloStepAnswers({});
    setSoloQuestionId(null);
    pickNextSoloQuestion({ regionId, questionTypeId, seen: [] });
  }

  function exitSolo() {
    setSoloActive(false);
    setSoloRegionId(null);
    setSoloQuestionTypeId(null);
    setSoloQuestionId(null);
    setSoloSeenIds([]);
    setSoloFeedback(null);
    setSoloAwarding(false);
    setPracticeMode(null);
    setScreen('types');
  }

  async function rematchFriend() {
    setFriendError(null);
    setFriendSessionId(null);
    setFriendSession(null);
    setFriendCopied(false);
    await createFriendSession();
  }

  function startFriend(regionId: string, questionTypeId: string) {
    setPracticeMode('friend');
    setScreen('practice');
    setSoloActive(false);
    setRankedActive(false);
    setSoloRegionId(regionId);
    setSoloQuestionTypeId(questionTypeId);
    setRankedRegionId(regionId);
    setRankedQuestionTypeId(questionTypeId);

    setFriendError(null);
    setFriendSessionId(null);
    setFriendSession(null);
    setFriendCode('');
    setFriendCopied(false);
    setFriendStatus(null);
  }

  function startStudy(regionId: string, questionTypeId: string) {
    setPracticeMode('study');
    setScreen('practice');
    setSoloActive(false);
    setRankedActive(false);
    setSoloRegionId(regionId);
    setSoloQuestionTypeId(questionTypeId);
    setRankedRegionId(regionId);
    setRankedQuestionTypeId(questionTypeId);

    setStudyError(null);
    setStudySessionId(null);
    setStudySession(null);
    setStudyMessages([]);
    setStudyCode('');
    setStudyCopied(false);
  }

  useEffect(() => {
    if (practiceMode !== 'study') return;
    if (!studySessionId || !programId) return;
    localStorage.setItem('ll:ongoingStudySessionId', studySessionId);
    localStorage.setItem('ll:ongoingStudyProgramId', programId);
  }, [practiceMode, studySessionId, programId]);

  async function copyFriendCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setFriendCopied(true);
      setTimeout(() => setFriendCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (practiceMode !== 'friend') return;
    if (!friendSessionId) return;
    const unsub = listenProgramFriendSession(friendSessionId, (s) => setFriendSession(s));
    return () => unsub();
  }, [practiceMode, friendSessionId]);

  useEffect(() => {
    if (practiceMode !== 'study') return;
    if (!studySessionId) return;
    const unsub = listenProgramStudySession(studySessionId, (s) => setStudySession(s));
    return () => unsub();
  }, [practiceMode, studySessionId]);

  useEffect(() => {
    if (practiceMode !== 'study') return;
    if (!studySessionId) return;
    const unsub = listenProgramStudyMessages(studySessionId, (m) => setStudyMessages(m));
    return () => unsub();
  }, [practiceMode, studySessionId]);

  useEffect(() => {
    if (practiceMode !== 'study') return;
    if (!studySessionId) return;
    if (!uid) return;

    let alive = true;
    const tick = async () => {
      try {
        await heartbeatProgramStudySession(studySessionId, uid);
      } catch {
        // ignore
      }
      try {
        await tryCleanupInactiveProgramStudySession(studySessionId);
      } catch {
        // ignore
      }
      if (!alive) return;
      window.setTimeout(tick, 10_000);
    };

    const id = window.setTimeout(tick, 2_000);
    return () => {
      alive = false;
      window.clearTimeout(id);
    };
  }, [practiceMode, studySessionId, uid]);

  useEffect(() => {
    if (practiceMode !== 'friend') return;
    if (!friendSessionId) return;
    if (!friendSession) return;

    setFriendStatus(null);

    let timer: number | null = null;

    // Waiting room: auto-expire if nobody joins.
    if (friendSession.state === 'waiting' && !friendSession.guest) {
      const startedAt = Date.parse(friendSession.createdAt);
      if (!Number.isFinite(startedAt)) return;
      const msRemaining = Math.max(0, 3 * 60 * 1000 - (Date.now() - startedAt));
      timer = window.setTimeout(async () => {
        try {
          await tryExpireWaitingProgramFriendSession(friendSessionId);
          setFriendStatus('This match expired because nobody joined in time.');
        } catch {
          // ignore
        }
      }, msRemaining);
    }

    // Playing: auto-complete after inactivity (based on updatedAt).
    if (friendSession.state === 'playing') {
      const updatedAt = Date.parse(friendSession.updatedAt);
      if (!Number.isFinite(updatedAt)) return;
      const msRemaining = Math.max(0, 5 * 60 * 1000 - (Date.now() - updatedAt));
      timer = window.setTimeout(async () => {
        try {
          await tryCompleteInactiveProgramFriendSession(friendSessionId);
          setFriendStatus('Match ended due to inactivity.');
        } catch {
          // ignore
        }
      }, msRemaining);
    }

    return () => {
      if (timer != null) window.clearTimeout(timer);
    };
  }, [practiceMode, friendSessionId, friendSession]);

  const friendCandidates = useMemo(() => {
    const rid = soloRegionId;
    const tid = soloQuestionTypeId;
    if (!rid || !tid) return [] as FlatProgramQuestion[];
    return qbQuestions
      .filter((q) => q.regionId === rid && q.questionTypeId === tid && !!q.interaction)
      .sort((a, b) => {
        const da = difficultyRank(a.difficulty);
        const db = difficultyRank(b.difficulty);
        if (da !== db) return da - db;
        return a.id.localeCompare(b.id);
      });
  }, [qbQuestions, soloRegionId, soloQuestionTypeId]);

  const friendCurrent = useMemo(() => {
    if (practiceMode !== 'friend') return null;
    const qid = friendSession?.questionIds?.[friendSession.currentIndex] ?? null;
    if (!qid) return null;
    return qbQuestions.find((q) => q.id === qid) ?? null;
  }, [practiceMode, friendSession, qbQuestions]);

  const studyCurrent = useMemo(() => {
    if (practiceMode !== 'study') return null;
    const qid = studySession?.questionIds?.[studySession.currentIndex] ?? null;
    if (!qid) return null;
    return qbQuestions.find((q) => q.id === qid) ?? null;
  }, [practiceMode, studySession, qbQuestions]);

  const studyIsHost = useMemo(() => {
    if (practiceMode !== 'study') return false;
    if (!uid || !studySession) return false;
    return studySession.hostUid === uid;
  }, [practiceMode, uid, studySession]);

  const friendMyUid = uid;
  const friendOppUid = useMemo(() => {
    if (!friendSession || !friendMyUid) return null;
    const h = friendSession.host.uid;
    const g = friendSession.guest?.uid ?? null;
    if (h && h !== friendMyUid) return h;
    if (g && g !== friendMyUid) return g;
    return null;
  }, [friendSession, friendMyUid]);

  async function createFriendSession() {
    if (!uid || !programId) return;
    if (!soloRegionId || !soloQuestionTypeId) return;
    setFriendBusy(true);
    setFriendError(null);
    try {
      const username = userData?.username || uid;
      const ids = friendCandidates.slice(0, 12).map((q) => q.id);
      if (ids.length === 0) {
        setFriendError('No questions available for this question type yet.');
        return;
      }
      const session = await createProgramFriendSession({
        host: { uid, username },
        programId,
        regionId: soloRegionId,
        questionTypeId: soloQuestionTypeId,
        questionIds: ids,
      });
      setFriendSessionId(session.id);
      setFriendSession(session);
      setFriendCopied(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFriendError(msg || 'Failed to create session');
    } finally {
      setFriendBusy(false);
    }
  }

  async function joinFriendSession() {
    if (!uid) return;
    const code = friendCode.trim().toUpperCase();
    if (!code) return;
    setFriendBusy(true);
    setFriendError(null);
    try {
      const username = userData?.username || uid;
      const session = await joinProgramFriendSessionByCode({ code, guest: { uid, username } });
      if (!session) {
        setFriendError('Invalid code, or session is no longer joinable.');
        return;
      }
      setFriendSessionId(session.id);
      setFriendSession(session);
      setFriendCopied(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFriendError(msg || 'Failed to join session');
    } finally {
      setFriendBusy(false);
    }
  }

  async function answerFriend(idx: number) {
    if (practiceMode !== 'friend') return;
    if (!friendMyUid || !friendSession || !friendCurrent?.interaction || friendCurrent.interaction.type !== 'mcq') return;
    const qid = friendSession.questionIds?.[friendSession.currentIndex] ?? null;
    if (!qid) return;
    const already = friendSession.answers?.[qid]?.[friendMyUid];
    if (already) return;

    const g = gradeInteraction(friendCurrent.interaction, { kind: 'mcq', choiceIndex: idx });
    await submitProgramFriendAnswer({
      sessionId: friendSession.id,
      uid: friendMyUid,
      questionId: qid,
      answer: {
        kind: 'mcq',
        choiceIndex: idx,
        stepValues: compactStepValues(soloStepAnswers),
        correct: g.correct,
        answeredAt: new Date().toISOString(),
      },
    });
  }

  async function answerFriendFreeform(kind: 'numeric' | 'text') {
    if (practiceMode !== 'friend') return;
    const finalInteraction = getFinalInteraction(friendCurrent);
    if (!friendMyUid || !friendSession || !friendCurrent?.interaction || !finalInteraction) return;
    if (kind === 'numeric' && !isNumericInteraction(finalInteraction)) return;
    if (kind === 'text' && !isTextSubmittedInteraction(finalInteraction)) return;
    const qid = friendSession.questionIds?.[friendSession.currentIndex] ?? null;
    if (!qid) return;
    const already = friendSession.answers?.[qid]?.[friendMyUid];
    if (already) return;

    const g = gradeInteraction(friendCurrent.interaction, { kind, valueText: soloTextAnswer });
    await submitProgramFriendAnswer({
      sessionId: friendSession.id,
      uid: friendMyUid,
      questionId: qid,
      answer: {
        kind,
        valueText: soloTextAnswer,
        stepValues: compactStepValues(soloStepAnswers),
        correct: g.correct,
        answeredAt: new Date().toISOString(),
      },
    });
  }

  async function exitFriend() {
    if (friendSessionId) {
      try {
        await leaveProgramFriendSession(friendSessionId);
      } catch {
        // ignore
      }
    }
    resetPracticeState();
    setScreen('types');
  }

  async function exitStudy() {
    if (studySessionId && uid) {
      try {
        await leaveProgramStudySession(studySessionId, uid);
      } catch {
        // ignore
      }
    }
    resetPracticeState();
    setScreen('types');
  }

  async function createStudySession() {
    if (!uid || !programId) return;
    if (!soloRegionId || !soloQuestionTypeId) return;
    setStudyBusy(true);
    setStudyError(null);
    try {
      const username = userData?.username || uid;
      const ids = friendCandidates.slice(0, 16).map((q) => q.id);
      if (ids.length === 0) {
        setStudyError('No questions available for this question type yet.');
        return;
      }
      const session = await createProgramStudySession({
        host: { uid, username },
        programId,
        regionId: soloRegionId,
        questionTypeId: soloQuestionTypeId,
        questionIds: ids,
      });
      setStudySessionId(session.id);
      setStudySession(session);
      setStudyCopied(false);
      setStudyPickMode(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStudyError(msg || 'Failed to create session');
    } finally {
      setStudyBusy(false);
    }
  }

  async function joinStudySession() {
    if (!uid) return;
    const code = studyCode.trim().toUpperCase();
    if (!code) return;
    setStudyBusy(true);
    setStudyError(null);
    try {
      const username = userData?.username || uid;
      const session = await joinProgramStudySessionByCode({ code, participant: { uid, username } });
      if (!session) {
        setStudyError('Invalid code, or session is full/ended.');
        return;
      }
      setStudySessionId(session.id);
      setStudySession(session);
      setStudyCopied(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStudyError(msg || 'Failed to join session');
    } finally {
      setStudyBusy(false);
    }
  }

  async function startStudySessionNow() {
    if (!studySessionId || !uid) return;
    await hostStartProgramStudySession(studySessionId, uid);
  }

  async function toggleStudyReveal() {
    if (!studySessionId || !uid || !studySession) return;
    await hostSetReveal(studySessionId, uid, !studySession.reveal);
  }

  async function studyPrev() {
    if (!studySessionId || !uid || !studySession) return;
    await hostGoToIndex(studySessionId, uid, Math.max(0, (studySession.currentIndex ?? 0) - 1));
  }

  async function studyNext() {
    if (!studySessionId || !uid || !studySession) return;
    await hostGoToIndex(
      studySessionId,
      uid,
      Math.min((studySession.currentIndex ?? 0) + 1, Math.max(0, (studySession.questionIds?.length ?? 1) - 1))
    );
  }

  async function answerStudy(idx: number) {
    if (practiceMode !== 'study') return;
    const finalInteraction = getFinalInteraction(studyCurrent);
    if (!uid || !studySession || !studyCurrent?.interaction || !finalInteraction || finalInteraction.type !== 'mcq') return;
    const qid = studySession.questionIds?.[studySession.currentIndex] ?? null;
    if (!qid) return;
    const already = studySession.answers?.[qid]?.[uid];
    if (already) return;
    await submitProgramStudyAnswer({
      sessionId: studySession.id,
      uid,
      questionId: qid,
      answer: {
        kind: 'mcq',
        choiceIndex: idx,
        stepValues: compactStepValues(soloStepAnswers),
        answeredAt: new Date().toISOString(),
      },
    });
  }

  async function answerStudyFreeform(kind: 'numeric' | 'text') {
    if (practiceMode !== 'study') return;
    const finalInteraction = getFinalInteraction(studyCurrent);
    if (!uid || !studySession || !studyCurrent?.interaction || !finalInteraction) return;
    if (kind === 'numeric' && !isNumericInteraction(finalInteraction)) return;
    if (kind === 'text' && !isTextSubmittedInteraction(finalInteraction)) return;
    const qid = studySession.questionIds?.[studySession.currentIndex] ?? null;
    if (!qid) return;
    const already = studySession.answers?.[qid]?.[uid];
    if (already) return;

    await submitProgramStudyAnswer({
      sessionId: studySession.id,
      uid,
      questionId: qid,
      answer: {
        kind,
        valueText: soloTextAnswer,
        stepValues: compactStepValues(soloStepAnswers),
        answeredAt: new Date().toISOString(),
      },
    });
  }

  async function sendStudyChat() {
    if (!studySessionId || !uid) return;
    const username = userData?.username || uid;
    const text = studyChatText.trim();
    if (!text) return;
    setStudyChatText('');
    try {
      await sendProgramStudyMessage({ sessionId: studySessionId, fromUid: uid, fromUsername: username, text });
    } catch {
      // ignore
    }
  }

  async function copyStudyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setStudyCopied(true);
      window.setTimeout(() => setStudyCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  async function answerSoloMcq(idx: number) {
    const finalInteraction = getFinalInteraction(soloCurrent);
    if (!soloCurrent?.interaction || !finalInteraction || finalInteraction.type !== 'mcq' || soloFeedback) return;
    const g = gradeInteraction(soloCurrent.interaction, { kind: 'mcq', choiceIndex: idx });
    setSoloFeedback(g);

    if (g.correct && uid) {
      try {
        setSoloAwarding(true);
        if (programId) {
          await markQuestionSolved(uid, programId, soloCurrent.id);
          setSolvedQuestionIds((prev) => (prev.includes(soloCurrent.id) ? prev : [...prev, soloCurrent.id]));
        }
        await updateEconomy(uid, { gold: 1, xp: 5 });
      } catch {
        // ignore
      } finally {
        setSoloAwarding(false);
      }
    }
  }

  async function answerSoloFreeform(kind: 'numeric' | 'text') {
    const finalInteraction = getFinalInteraction(soloCurrent);
    if (!soloCurrent?.interaction || !finalInteraction || soloFeedback) return;
    if (kind === 'numeric' && !isNumericInteraction(finalInteraction)) return;
    if (kind === 'text' && !isTextSubmittedInteraction(finalInteraction)) return;

    const g = gradeInteraction(soloCurrent.interaction, { kind, valueText: soloTextAnswer });
    setSoloFeedback(g);

    if (g.correct && uid) {
      try {
        setSoloAwarding(true);
        if (programId) {
          await markQuestionSolved(uid, programId, soloCurrent.id);
          setSolvedQuestionIds((prev) => (prev.includes(soloCurrent.id) ? prev : [...prev, soloCurrent.id]));
        }
        await updateEconomy(uid, { gold: 1, xp: 5 });
      } catch {
        // ignore
      } finally {
        setSoloAwarding(false);
      }
    }
  }

  function nextSolo() {
    if (!soloCurrent) return;
    const nextSeen = soloSeenIds.includes(soloCurrent.id) ? soloSeenIds : [...soloSeenIds, soloCurrent.id];
    setSoloSeenIds(nextSeen);
    setSoloFeedback(null);
    setSoloTextAnswer('');
    setSoloStepAnswers({});
    if (!soloRegionId || !soloQuestionTypeId) return;
    pickNextSoloQuestion({ regionId: soloRegionId, questionTypeId: soloQuestionTypeId, seen: nextSeen });
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0b1220' }}>
      {chestOverlay && (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2600,
              background: 'rgba(0,0,0,0.82)',
              backdropFilter: 'blur(6px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 18,
            }}
          >
            <style>
              {`@keyframes ll-chest-bob {0%{transform:translateY(0)}50%{transform:translateY(-10px)}100%{transform:translateY(0)}}
@keyframes ll-chest-pop {0%{transform:scale(0.92);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes ll-rays-spin {0%{transform:translate(-50%,-50%) rotate(0deg)}100%{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes ll-glow-pulse {0%{opacity:0.35}50%{opacity:0.85}100%{opacity:0.35}}`}
            </style>

            <div
              style={{
                width: 'min(720px, 96vw)',
                borderRadius: 20,
                border: '1px solid rgba(148,163,184,0.25)',
                background: 'radial-gradient(circle at 50% 30%, rgba(59,130,246,0.22), rgba(15,23,42,0.95))',
                boxShadow: '0 30px 100px rgba(0,0,0,0.7)',
                overflow: 'hidden',
                animation: 'll-chest-pop 250ms ease forwards',
              }}
            >
              <div style={{ padding: 16, borderBottom: '1px solid rgba(148,163,184,0.18)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>🎁 Chest</div>
                {chestOverlay.stage === 'revealed' && (
                  <button
                    className="ll-btn"
                    style={{ padding: '7px 12px', fontSize: 12, background: 'rgba(251,191,36,0.95)', borderColor: 'rgba(251,191,36,0.95)', color: '#0b1220', fontWeight: 900 }}
                    onClick={() => setChestOverlay(null)}
                  >
                    Collect
                  </button>
                )}
              </div>

              <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr', gap: 16, placeItems: 'center' }}>
                <div style={{ position: 'relative', width: 260, height: 260, display: 'grid', placeItems: 'center' }}>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 999,
                      background: 'radial-gradient(circle at 50% 50%, rgba(251,191,36,0.22), rgba(251,191,36,0))',
                      opacity: chestOverlay.stage === 'revealed' ? 1 : 0.35,
                      animation: 'll-glow-pulse 1.4s ease-in-out infinite',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: 260,
                      height: 260,
                      borderRadius: 999,
                      background: 'conic-gradient(from 90deg, rgba(251,191,36,0.0), rgba(251,191,36,0.35), rgba(59,130,246,0.0))',
                      opacity: chestOverlay.stage === 'revealed' ? 1 : 0,
                      animation: chestOverlay.stage === 'revealed' ? 'll-rays-spin 6s linear infinite' : undefined,
                      transform: 'translate(-50%,-50%)',
                    }}
                  />

                  <button
                    className="ll-btn"
                    style={{
                      width: 180,
                      height: 180,
                      borderRadius: 28,
                      border: '2px solid rgba(251,191,36,0.65)',
                      background: 'linear-gradient(180deg, rgba(251,191,36,0.95), rgba(217,119,6,0.95))',
                      boxShadow: '0 25px 60px rgba(0,0,0,0.55)',
                      display: 'grid',
                      placeItems: 'center',
                      cursor: chestOverlay.stage === 'opening' ? 'pointer' : 'default',
                      animation: chestOverlay.stage === 'opening' ? 'll-chest-bob 1.15s ease-in-out infinite' : undefined,
                    }}
                    onClick={() => {
                      if (chestOverlay.stage !== 'opening') return;
                      setChestOverlay((p) => (p ? { ...p, stage: 'revealed' } : p));
                    }}
                  >
                    <div style={{ textAlign: 'center', padding: 10 }}>
                      <div style={{ fontSize: 52, marginBottom: 6 }}>🧰</div>
                      <div style={{ color: '#0b1220', fontWeight: 1000, fontSize: 13, letterSpacing: 0.6 }}>
                        {chestOverlay.stage === 'opening' ? 'TAP TO OPEN' : 'OPENED'}
                      </div>
                    </div>
                  </button>
                </div>

                {chestOverlay.stage === 'opening' ? (
                  <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', maxWidth: 520 }}>
                    You reached a reward milestone. Tap the chest to reveal your loot.
                  </div>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#fbbf24', fontWeight: 1000, fontSize: 34, letterSpacing: 0.4 }}>
                      +{chestOverlay.gold}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>Gold added to your account.</div>
                  </div>
                )}

                {chestOverlay.stage === 'opening' && (
                  <button
                    className="ll-btn"
                    style={{ padding: '10px 14px', fontSize: 13, background: 'rgba(59,130,246,0.18)', borderColor: 'rgba(59,130,246,0.35)', color: '#93c5fd', fontWeight: 900 }}
                    onClick={() => setChestOverlay((p) => (p ? { ...p, stage: 'revealed' } : p))}
                  >
                    Open
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {showRankRoadmap && (
        <>
          <div
            onClick={() => setShowRankRoadmap(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 2000 }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%,-50%)',
              width: 'min(860px, 96vw)',
              maxHeight: 'min(760px, 88vh)',
              overflow: 'auto',
              background: '#0f172a',
              borderRadius: 16,
              border: '1px solid #334155',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
              zIndex: 2001,
            }}
          >
            <style>
              {`@keyframes ll-road-pulse {0%{transform:scale(1)}50%{transform:scale(1.05)}100%{transform:scale(1)}}
@keyframes ll-road-float {0%{transform:translateY(-50%) translateX(0)}50%{transform:translateY(-50%) translateX(3px)}100%{transform:translateY(-50%) translateX(0)}}
.ll-road-reward{transition:transform 140ms ease,filter 140ms ease;}
.ll-road-reward:hover{transform:translateY(-50%) scale(1.03);filter:brightness(1.05);} 
.ll-road-friend{transition:transform 140ms ease,filter 140ms ease;}
.ll-road-friend:hover{transform:translateY(-50%) scale(1.03);filter:brightness(1.06);} 
`}
            </style>
            <div style={{ padding: 14, borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 10, background: '#111c33' }}>
              <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>🏁 Ranked Roadmap</div>
              <button className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setShowRankRoadmap(false)}>
                Close
              </button>
            </div>
            {(() => {
              const totalQuestions = playableOverallTotal;
              const totalTrophies = Math.max(0, totalQuestions * 15);
              const r = computeRankInfo({ trophies: rankedTrophies, totalQuestions });
              const tierSize = r.tierSize;
              const pxPerTrophy = clamp(0.07, 0.05, 0.11);
              const trackHeight = Math.max(900, totalTrophies * pxPerTrophy + 240);

              const playerProgressPct = totalTrophies > 0 ? clamp(rankedTrophies / totalTrophies, 0, 1) : 0;
              const playerY = playerProgressPct * (trackHeight - 120) + 50;

              const rewardEvery = 100;
              const rewardMilestones = Array.from({ length: Math.floor(totalTrophies / rewardEvery) + 1 })
                .map((_, i) => i * rewardEvery)
                .filter((t) => t > 0);

              const rewardGold = (t: number) => {
                if (t >= 9000) return 600;
                if (t >= 5000) return 300;
                if (t >= 2000) return 150;
                return 75;
              };

              const gateMilestones = rankNames.map((name, idx) => ({
                id: `gate_${idx}`,
                name,
                floor: idx * tierSize,
              }));

              const arenaColors = [
                'rgba(148,163,184,0.06)',
                'rgba(59,130,246,0.07)',
                'rgba(16,185,129,0.07)',
                'rgba(251,191,36,0.07)',
                'rgba(168,85,247,0.07)',
                'rgba(244,63,94,0.06)',
              ];

              function yForTrophy(t: number) {
                if (totalTrophies <= 0) return 60;
                const pct = clamp(t / totalTrophies, 0, 1);
                return pct * (trackHeight - 120) + 50;
              }

              async function handleClaim(t: number) {
                if (!uid || !programId) return;
                const rewardId = `reward_${t}`;
                if (claimingRewardId) return;
                setClaimingRewardId(rewardId);
                try {
                  const res = await claimRoadmapReward(uid, programId, rewardId);
                  if (!res.claimed) return;
                  const gold = rewardGold(t);
                  await updateEconomy(uid, { gold });
                  setClaimedRewardIds((prev) => (prev.includes(rewardId) ? prev : [...prev, rewardId]));
                  setChestOverlay({ rewardId, gold, stage: 'opening' });
                } finally {
                  setClaimingRewardId(null);
                }
              }

              return (
                <div style={{ padding: 14 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>
                      Your trophies: <span style={{ color: '#fbbf24', fontWeight: 900 }}>{rankedTrophies}</span>
                      <span style={{ color: '#64748b' }}> · Current rank: </span>
                      <span style={{ color: 'white', fontWeight: 900 }}>{r.name}</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, alignItems: 'start' }}>
                    <div style={{ border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.35)', borderRadius: 14, padding: 12 }}>
                      <div style={{ color: 'white', fontWeight: 900, fontSize: 13, marginBottom: 10 }}>Friends</div>
                      {roadmapFriends.length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: 12 }}>No friends to show.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {roadmapFriends.slice(0, 10).map((f) => (
                            <div key={f.uid} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{ width: 30, height: 30, borderRadius: 999, background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 900, fontSize: 12, border: '1px solid #475569' }}>
                                {(f.username || 'F').slice(0, 1).toUpperCase()}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: '#e2e8f0', fontWeight: 900, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.username}</div>
                                <div style={{ color: '#64748b', fontSize: 11 }}>🏆 {f.trophies}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ border: '1px solid #1f2a44', background: 'rgba(2,6,23,0.35)', borderRadius: 14, overflow: 'hidden' }}>
                      <div style={{ padding: 12, borderBottom: '1px solid #1f2a44', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ color: 'white', fontWeight: 900, fontSize: 13, flex: 1 }}>Road</div>
                        <div style={{ color: '#94a3b8', fontSize: 11 }}>Scroll</div>
                      </div>

                      <div ref={rankRoadmapScrollRef} style={{ height: 'min(560px, 70vh)', overflowY: 'auto', position: 'relative' }}>
                        <div style={{ position: 'relative', height: trackHeight, padding: '40px 0' }}>
                          {rankNames.map((name, idx) => {
                            const floor = idx * tierSize;
                            const nextFloor = (idx + 1) * tierSize;
                            const top = yForTrophy(nextFloor);
                            const bottom = yForTrophy(floor);
                            const height = Math.max(80, top - bottom);
                            const color = arenaColors[idx % arenaColors.length];
                            return (
                              <div
                                key={name}
                                style={{
                                  position: 'absolute',
                                  left: 0,
                                  right: 0,
                                  bottom,
                                  height,
                                  background: `linear-gradient(180deg, ${color}, rgba(0,0,0,0))`,
                                }}
                              />
                            );
                          })}

                          {/* Track base */}
                          <div
                            style={{
                              position: 'absolute',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              bottom: 50,
                              top: 50,
                              width: 14,
                              borderRadius: 999,
                              background: 'linear-gradient(180deg, rgba(148,163,184,0.10), rgba(148,163,184,0.22), rgba(148,163,184,0.10))',
                              border: '1px solid rgba(148,163,184,0.16)',
                              boxShadow: '0 0 0 6px rgba(59,130,246,0.04), 0 0 22px rgba(59,130,246,0.10)',
                            }}
                          />

                          {/* Track ticks */}
                          {Array.from({ length: Math.min(90, Math.max(10, Math.floor(totalTrophies / 100))) }).map((_, i) => {
                            const t = Math.round(((i + 1) / (Math.min(90, Math.max(10, Math.floor(totalTrophies / 100))) + 1)) * totalTrophies);
                            const y = yForTrophy(t);
                            return (
                              <div
                                key={`tick_${i}`}
                                style={{
                                  position: 'absolute',
                                  left: '50%',
                                  bottom: y,
                                  transform: 'translate(-50%, -50%)',
                                  width: i % 5 === 0 ? 26 : 18,
                                  height: 2,
                                  borderRadius: 999,
                                  background: i % 5 === 0 ? 'rgba(148,163,184,0.40)' : 'rgba(148,163,184,0.22)',
                                  opacity: 0.85,
                                }}
                              />
                            );
                          })}

                          {/* Filled progress */}
                          <div
                            style={{
                              position: 'absolute',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              bottom: 50,
                              height: playerY - 50,
                              width: 14,
                              borderRadius: 999,
                              background: 'linear-gradient(180deg, rgba(59,130,246,0.0), rgba(59,130,246,0.95), rgba(96,165,250,0.55))',
                              boxShadow: '0 0 28px rgba(59,130,246,0.35)',
                              transition: 'height 650ms cubic-bezier(.2,.8,.2,1)',
                            }}
                          />

                          <div
                            style={{
                              position: 'absolute',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              bottom: playerY,
                              width: 20,
                              height: 20,
                              borderRadius: 999,
                              background: 'radial-gradient(circle at 40% 35%, rgba(255,255,255,0.9), rgba(96,165,250,0.95))',
                              border: '2px solid rgba(255,255,255,0.75)',
                              boxShadow: '0 0 24px rgba(59,130,246,0.65), 0 0 0 6px rgba(59,130,246,0.12)',
                            }}
                          />

                          {gateMilestones.map((g, idx) => {
                            const y = yForTrophy(g.floor);
                            const isCurrentGate = idx === r.tier;
                            return (
                              <div
                                key={g.id}
                                style={{
                                  position: 'absolute',
                                  left: 14,
                                  right: 14,
                                  bottom: y,
                                  transform: 'translateY(-50%)',
                                  height: 44,
                                  borderRadius: 14,
                                  background: isCurrentGate ? 'rgba(251,191,36,0.18)' : 'rgba(30,41,59,0.65)',
                                  border: `1px solid ${isCurrentGate ? 'rgba(251,191,36,0.55)' : 'rgba(71,85,105,0.55)'}`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '0 12px',
                                  gap: 10,
                                }}
                              >
                                <div style={{ color: isCurrentGate ? '#fbbf24' : '#94a3b8', fontWeight: 900, fontSize: 12 }}>Arena Gate</div>
                                <div style={{ color: 'white', fontWeight: 900, fontSize: 12, flex: 1 }}>{g.name}</div>
                                <div style={{ color: '#94a3b8', fontSize: 11 }}>🏆 {g.floor}</div>
                              </div>
                            );
                          })}

                          {rewardMilestones.map((t) => {
                            const y = yForTrophy(t);
                            const id = `reward_${t}`;
                            const reached = rankedTrophies >= t;
                            const claimed = claimedRewardIds.includes(id);
                            const claimable = reached && !claimed;
                            const locked = !reached;
                            const gold = rewardGold(t);
                            return (
                              <div key={id}>
                                {/* connector: track dot */}
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: '50%',
                                    bottom: y,
                                    transform: 'translate(-50%, -50%)',
                                    width: 10,
                                    height: 10,
                                    borderRadius: 999,
                                    background: claimable
                                      ? 'rgba(251,191,36,0.95)'
                                      : claimed
                                        ? 'rgba(16,185,129,0.75)'
                                        : 'rgba(148,163,184,0.35)',
                                    boxShadow: claimable
                                      ? '0 0 18px rgba(251,191,36,0.45)'
                                      : claimed
                                        ? '0 0 16px rgba(16,185,129,0.35)'
                                        : undefined,
                                    border: '1px solid rgba(255,255,255,0.25)',
                                  }}
                                />

                                {/* connector: line to reward */}
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: '50%',
                                    right: 18 + 160,
                                    bottom: y,
                                    transform: 'translateY(-50%)',
                                    height: 2,
                                    borderRadius: 999,
                                    background: claimable
                                      ? 'linear-gradient(90deg, rgba(251,191,36,0.0), rgba(251,191,36,0.55), rgba(251,191,36,0.0))'
                                      : claimed
                                        ? 'linear-gradient(90deg, rgba(16,185,129,0.0), rgba(16,185,129,0.35), rgba(16,185,129,0.0))'
                                        : 'linear-gradient(90deg, rgba(148,163,184,0.0), rgba(148,163,184,0.18), rgba(148,163,184,0.0))',
                                    opacity: locked ? 0.55 : 0.9,
                                  }}
                                />

                                <div
                                  style={{
                                    position: 'absolute',
                                    right: 18,
                                    bottom: y,
                                    transform: 'translateY(-50%)',
                                    width: 160,
                                  }}
                                >
                                  <button
                                    className="ll-btn ll-road-reward"
                                    disabled={!claimable || !!claimingRewardId}
                                    onClick={() => handleClaim(t)}
                                    style={{
                                      width: '100%',
                                      padding: '10px 12px',
                                      borderRadius: 18,
                                      background: claimable
                                        ? 'linear-gradient(180deg, rgba(251,191,36,0.98), rgba(217,119,6,0.92))'
                                        : claimed
                                          ? 'rgba(16,185,129,0.14)'
                                          : 'rgba(30,41,59,0.65)',
                                      border: `1px solid ${claimable
                                        ? 'rgba(251,191,36,0.95)'
                                        : claimed
                                          ? 'rgba(16,185,129,0.40)'
                                          : 'rgba(71,85,105,0.55)'}`,
                                      color: claimable ? '#0b1220' : claimed ? '#34d399' : '#94a3b8',
                                      fontWeight: 900,
                                      fontSize: 12,
                                      boxShadow: claimable
                                        ? '0 0 0 4px rgba(251,191,36,0.10), 0 14px 34px rgba(0,0,0,0.48)'
                                        : claimed
                                          ? '0 10px 26px rgba(0,0,0,0.28)'
                                          : undefined,
                                      animation: claimable ? 'll-road-pulse 1.2s ease-in-out infinite' : undefined,
                                      opacity: locked ? 0.7 : 1,
                                    }}
                                    title={claimable ? 'Claim reward' : claimed ? 'Already claimed' : 'Reach this milestone to claim'}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        <div style={{ fontSize: 16 }}>
                                          {claimed ? '✅' : claimable ? '🎁' : '🔒'}
                                        </div>
                                        <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {claimed ? 'Claimed' : claimable ? `Claim +${gold} gold` : `Reward @ ${t}`}
                                        </div>
                                      </div>
                                      <div style={{ color: claimable ? 'rgba(15,23,42,0.7)' : '#64748b', fontSize: 11, fontWeight: 1000, flexShrink: 0 }}>
                                        🏆 {t}
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              </div>
                            );
                          })}

                          {roadmapFriends.slice(0, 8).map((f, i) => {
                            const y = yForTrophy(f.trophies);
                            const stack = i % 3;
                            const x = 16 + stack * 18;
                            return (
                              <div
                                key={f.uid}
                                className="ll-road-friend"
                                style={{
                                  position: 'absolute',
                                  left: x,
                                  bottom: y,
                                  transform: 'translateY(-50%)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  opacity: 0.95,
                                  animation: i < 4 ? `ll-road-float ${1.8 + (i % 3) * 0.35}s ease-in-out infinite` : undefined,
                                }}
                              >
                                <div
                                  style={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 999,
                                    background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.35), hsl(${(i * 53) % 360} 60% 42%))`,
                                    border: '2px solid rgba(255,255,255,0.28)',
                                    boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontWeight: 1000,
                                    fontSize: 12,
                                    position: 'relative',
                                  }}
                                >
                                  {(f.username || 'F').slice(0, 1).toUpperCase()}
                                  <div
                                    style={{
                                      position: 'absolute',
                                      right: -6,
                                      bottom: -6,
                                      padding: '2px 6px',
                                      borderRadius: 999,
                                      background: 'rgba(15,23,42,0.92)',
                                      border: '1px solid rgba(148,163,184,0.25)',
                                      color: '#fbbf24',
                                      fontSize: 10,
                                      fontWeight: 1000,
                                      boxShadow: '0 8px 18px rgba(0,0,0,0.35)',
                                    }}
                                  >
                                    🏆
                                  </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
                                  <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 1000, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.username}</div>
                                  <div style={{ color: '#64748b', fontSize: 10, fontWeight: 900 }}>🏆 {f.trophies}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </>
      )}
      <ConfettiBurst fire={celebrateFire} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', borderBottom: '1px solid #1f2a44',
        background: 'rgba(0,0,0,0.5)'
      }}>
        <button onClick={handleBack} className="ll-btn" style={{ padding: '6px 12px', fontSize: 12 }}>← Back</button>
        <div style={{ color: 'white', fontWeight: 800, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1 }}>
          {(['solo', 'ranked', 'friend'] as const).map((m) => {
            const active = headerMode === m;
            const label = m === 'solo' ? 'Solo Practice' : m === 'ranked' ? 'Ranked' : 'Play a Friend';
            const modeLocked = screen === 'practice' && !studyPickMode;
            return (
              <button
                key={m}
                onClick={() => {
                  if (modeLocked) return;
                  setHeaderMode(m);
                }}
                className={active ? 'll-btn ll-btn-primary' : 'll-btn'}
                disabled={modeLocked}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  opacity: modeLocked ? 0.6 : 1,
                  background: active
                    ? (m === 'solo' ? '#10b981' : m === 'ranked' ? 'rgba(251,191,36,0.95)' : undefined)
                    : undefined,
                  borderColor: active
                    ? (m === 'solo' ? '#059669' : m === 'ranked' ? 'rgba(217,119,6,1)' : undefined)
                    : undefined,
                  color: active && m === 'ranked' ? '#0b1220' : undefined,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <button
            className="ll-btn"
            style={{ padding: '6px 10px', fontSize: 12, fontWeight: 900, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.35)' }}
            onClick={() => setShowRankRoadmap(true)}
            disabled={playableOverallTotal <= 0}
            title={playableOverallTotal <= 0 ? 'No ranked progress available yet' : 'View ranks roadmap'}
          >
            {(() => {
              if (playableOverallTotal <= 0) return '🏆 —';
              const r = computeRankInfo({ trophies: rankedTrophies, totalQuestions: playableOverallTotal });
              return `🏆 ${rankedTrophies} • ${r.name}`;
            })()}
          </button>
        </div>
      </div>

      {!programId ? (
        <div style={{ color: '#94a3b8', padding: 18 }}>
          No active program selected. Choose a book from Profile → 📚 My Curriculum.
        </div>
      ) : loading ? (
        <div style={{ color: '#94a3b8', padding: 18 }}>Loading map...</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
            <div style={{
              border: '1px solid #1f2a44',
              borderRadius: 14,
              background: 'rgba(2,6,23,0.5)',
              padding: 14,
            }}>
              <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 10 }}>
                {screen === 'chapters'
                  ? (divisionLabels[0] ?? 'Chapters')
                  : screen === 'subsections'
                    ? (divisionLabels[1] ?? 'Subsections')
                    : screen === 'types'
                      ? 'Question Types'
                      : 'Practice'}
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 14, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {screen === 'chapters' ? `Select a ${(divisionLabels[0] ?? 'chapter').replace(/s$/i, '').toLowerCase()}` : (activeUnit?.title ?? '—')}
                    {(screen === 'types' || screen === 'practice') && mapRegion ? (
                      <span style={{ color: '#94a3b8', fontWeight: 800 }}>
                        {' '}› {selected?.title ?? mapRegion.title}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Question Bank: {qbChapterId ?? '—'}
                  </div>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12 }}>
                  {playableOverallTotal > 0 ? `${rankedSolvedQuestionIds.length}/${playableOverallTotal} ranked solved` : 'No playable questions'}
                </div>
              </div>

              {qbLoading ? (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading questions...</div>
              ) : qbError ? (
                <div style={{ color: '#fca5a5', fontSize: 12 }}>{qbError}</div>
              ) : tocUnitsWithQuestions.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>No TOC found for this program.</div>
              ) : screen === 'chapters' ? (
                <div style={{ position: 'relative', padding: '6px 0 0' }}>
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 10,
                    bottom: 10,
                    width: 3,
                    transform: 'translateX(-50%)',
                    background: 'linear-gradient(to bottom, rgba(59,130,246,0.0), rgba(59,130,246,0.35), rgba(59,130,246,0.0))',
                    borderRadius: 999,
                  }} />
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 10,
                      width: 6,
                      transform: 'translateX(-50%)',
                      height: `calc(${(chaptersPathFill * 100).toFixed(2)}% - 20px)`,
                      maxHeight: 'calc(100% - 20px)',
                      background: 'linear-gradient(to bottom, rgba(96,165,250,0.0), rgba(96,165,250,0.95), rgba(96,165,250,0.0))',
                      borderRadius: 999,
                      boxShadow: '0 0 18px rgba(59,130,246,0.35)',
                      transition: 'height 500ms ease',
                      pointerEvents: 'none',
                      opacity: 0.9,
                    }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {tocUnitsWithQuestions.map((u, i) => {
                      const prog = unitRankedProgress[u.id] ?? { solved: 0, total: 0 };
                      const isComplete = !!chapterCompletion[u.id];
                      const sideLeft = i % 2 === 0;
                      return (
                        <div key={u.id} style={{ display: 'flex', justifyContent: sideLeft ? 'flex-start' : 'flex-end' }}>
                          <button
                            className="ll-btn"
                            onClick={() => {
                              setActiveUnitId(u.id);
                              setSelected({ id: u.id, title: u.title, ref: u.ref ?? null });
                              setMapRegionId(null);
                              setScreen('subsections');
                            }}
                            style={{
                              width: isNarrow ? '100%' : 420,
                              textAlign: 'left',
                              padding: '12px 12px',
                              borderRadius: 16,
                              border: '1px solid rgba(59,130,246,0.4)',
                              background: 'rgba(59,130,246,0.10)',
                              color: 'white',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                              <div style={{ fontWeight: 900, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {u.title}
                              </div>
                              <div style={{ color: '#fbbf24', fontWeight: 900, fontSize: 12, flexShrink: 0 }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  {isComplete ? (
                                    <span style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      padding: '2px 8px',
                                      borderRadius: 999,
                                      background: 'rgba(251,191,36,0.14)',
                                      border: '1px solid rgba(251,191,36,0.35)',
                                      color: '#fbbf24',
                                      fontWeight: 900,
                                      fontSize: 11,
                                    }}>
                                      Complete
                                    </span>
                                  ) : null}
                                  <span>{prog.total > 0 ? `${prog.solved}/${prog.total}` : '—'}</span>
                                </span>
                              </div>
                            </div>
                            <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                              Tap to open subsections
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : screen === 'subsections' ? (
                <div style={{ position: 'relative', padding: '6px 0 0' }}>
                  <div style={{
                    position: 'absolute',
                    left: '50%',
                    top: 10,
                    bottom: 10,
                    width: 3,
                    transform: 'translateX(-50%)',
                    background: 'linear-gradient(to bottom, rgba(16,185,129,0.0), rgba(16,185,129,0.30), rgba(16,185,129,0.0))',
                    borderRadius: 999,
                  }} />
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 10,
                      width: 6,
                      transform: 'translateX(-50%)',
                      height: `calc(${(subsectionsPathFill * 100).toFixed(2)}% - 20px)`,
                      maxHeight: 'calc(100% - 20px)',
                      background: 'linear-gradient(to bottom, rgba(52,211,153,0.0), rgba(52,211,153,0.95), rgba(52,211,153,0.0))',
                      borderRadius: 999,
                      boxShadow: '0 0 18px rgba(16,185,129,0.30)',
                      transition: 'height 500ms ease',
                      pointerEvents: 'none',
                      opacity: 0.9,
                    }}
                  />
                  {tocSubsectionsWithRegions.length === 0 ? (
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>
                      No subsections in this chapter.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {(() => {
                        const rankedLockEnabled = headerMode === 'ranked' && !studyPickMode;
                        let lock = false;
                        return tocSubsectionsWithRegions.map((s, i) => {
                          const sideLeft = i % 2 === 0;
                          const rid = s.regionId;
                          const total = rid ? (qbMcqCounts.byRegion[rid] ?? 0) : 0;
                          const solved = rid ? (qbMcqRankedSolvedCounts.byRegion[rid] ?? 0) : 0;
                          const complete = rid ? (total > 0 && solved >= total) : false;
                          const locked = rankedLockEnabled ? lock : false;
                          if (rankedLockEnabled && !complete) lock = true;
                          return (
                            <div key={s.toc.id} style={{ display: 'flex', justifyContent: sideLeft ? 'flex-start' : 'flex-end' }}>
                              <button
                                className="ll-btn"
                                disabled={locked}
                                onClick={() => {
                                  if (locked) return;
                                  setSelected({ id: rid ?? s.toc.id, title: s.toc.title, ref: s.toc.ref ?? null });
                                  setMapRegionId(rid);
                                  setScreen('types');
                                }}
                                style={{
                                  width: isNarrow ? '100%' : 420,
                                  textAlign: 'left',
                                  padding: '12px 12px',
                                  borderRadius: 16,
                                  border: locked
                                    ? '1px solid rgba(148,163,184,0.25)'
                                    : (rid ? '1px solid rgba(16,185,129,0.45)' : '1px solid rgba(148,163,184,0.25)'),
                                  background: locked
                                    ? 'rgba(15,23,42,0.20)'
                                    : (rid ? 'rgba(16,185,129,0.10)' : 'rgba(15,23,42,0.35)'),
                                  color: 'white',
                                  opacity: locked ? 0.55 : 1,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                  <div style={{ fontWeight: 900, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {s.toc.title}
                                  </div>
                                  <div style={{ color: rid ? '#fbbf24' : '#64748b', fontWeight: 900, fontSize: 12, flexShrink: 0 }}>
                                    {rid ? `${solved}/${total}` : '—'}
                                  </div>
                                </div>
                                <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                                  Tap to view question types
                                </div>
                            </button>
                          </div>
                        );
                        });
                      })()}
                    </div>
                  )}
                </div>
              ) : screen === 'types' ? (
                <div>
                  {!mapRegionId || !mapRegion ? (
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>
                      No questions for this subsection yet.
                    </div>
                  ) : regionTypeCounts.length === 0 ? (
                    <div style={{ color: '#94a3b8', fontSize: 13 }}>
                      No question types labeled yet for this subsection.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {studyPickMode && (
                        <div style={{
                          border: '1px solid rgba(16,185,129,0.35)',
                          background: 'rgba(16,185,129,0.10)',
                          borderRadius: 14,
                          padding: 12,
                          color: 'white',
                          fontSize: 13,
                          fontWeight: 900,
                        }}>
                          Select a question type to create a Study Session
                        </div>
                      )}
                      {(() => {
                        let lock = false;
                        return regionTypeCounts.map(({ tid, count }) => {
                          const tdef = qbQuestionTypes.find((t) => t.id === tid);
                          const ttitle = tdef?.title ?? tid;
                          const canPlay = qbQuestions.some((q) => q.regionId === mapRegionId && q.questionTypeId === tid && !!q.mcq);
                          const solved = qbSolvedCounts.byRegionAndType[mapRegionId]?.[tid] ?? 0;
                          const rankedSolved = qbMcqRankedSolvedCounts.byRegionAndType[mapRegionId]?.[tid] ?? 0;
                          const complete = count > 0 && rankedSolved >= count;
                          const rankedLocked = lock;
                          if (!complete) lock = true;
                          const locked = headerMode === 'ranked' && !studyPickMode ? rankedLocked : false;

                          return (
                            <div
                              key={tid}
                              style={{
                                border: locked ? '1px solid rgba(148,163,184,0.25)' : '1px solid #1f2a44',
                                borderRadius: 12,
                                padding: 10,
                                background: locked ? 'rgba(15,23,42,0.25)' : 'rgba(15,23,42,0.45)',
                                opacity: locked ? 0.7 : 1,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ color: 'white', fontWeight: 900, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {ttitle}
                                  </div>
                                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                                    Ranked {rankedSolved}/{count} | Solo {solved}/{count}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                  <button
                                    className={canPlay && !locked ? 'll-btn ll-btn-primary' : 'll-btn'}
                                    disabled={!canPlay || locked}
                                    onClick={() => {
                                      if (studyPickMode) {
                                        startStudy(mapRegionId, tid);
                                        void createStudySession();
                                        return;
                                      }
                                      if (headerMode === 'solo') startSolo(mapRegionId, tid);
                                      else if (headerMode === 'ranked') startRanked(mapRegionId, tid);
                                      else startFriend(mapRegionId, tid);
                                    }}
                                    style={{
                                      padding: '6px 10px',
                                      fontSize: 11,
                                      opacity: canPlay && !locked ? 1 : 0.55,
                                      background: canPlay && !locked
                                        ? (studyPickMode
                                          ? 'rgba(16,185,129,0.14)'
                                          : headerMode === 'solo'
                                            ? '#10b981'
                                            : headerMode === 'ranked'
                                              ? 'rgba(251,191,36,0.95)'
                                              : undefined)
                                        : undefined,
                                      borderColor: canPlay && !locked
                                        ? (studyPickMode
                                          ? 'rgba(16,185,129,0.35)'
                                          : headerMode === 'solo'
                                            ? '#059669'
                                            : headerMode === 'ranked'
                                              ? 'rgba(217,119,6,1)'
                                              : undefined)
                                        : undefined,
                                      color: canPlay && !locked && headerMode === 'ranked' ? '#0b1220' : undefined,
                                    }}
                                  >
                                    {studyPickMode ? 'Select' : 'Play'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  border: '1px solid #1f2a44',
                  borderRadius: 14,
                  padding: 14,
                  background: 'rgba(15,23,42,0.45)',
                }}>
                  {(() => {
                    if (practiceMode === 'friend') {
                      return (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13 }}>Play a Friend</div>
                        <button onClick={exitFriend} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>Exit</button>
                      </div>

                      {friendError && (
                        <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{friendError}</div>
                      )}

                      {friendStatus && (
                        <div style={{
                          color: '#fbbf24',
                          fontSize: 12,
                          marginBottom: 10,
                          border: '1px solid rgba(251,191,36,0.25)',
                          background: 'rgba(251,191,36,0.08)',
                          padding: '8px 10px',
                          borderRadius: 10,
                        }}>
                          {friendStatus}
                        </div>
                      )}

                      {!friendSession ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{
                            border: '1px solid #1f2a44',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(2,6,23,0.35)',
                          }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Create a match</div>
                            <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.35, marginBottom: 10 }}>
                              Generates a join code. Your friend enters it to start.
                            </div>
                            <button
                              onClick={createFriendSession}
                              disabled={friendBusy}
                              className="ll-btn ll-btn-primary"
                              style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                            >
                              {friendBusy ? 'Creating...' : 'Create match'}
                            </button>
                          </div>

                          <div style={{
                            border: '1px solid #1f2a44',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(2,6,23,0.35)',
                          }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Join a match</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                value={friendCode}
                                onChange={(e) => setFriendCode(e.target.value.toUpperCase())}
                                placeholder="Enter code"
                                style={{
                                  flex: 1,
                                  padding: '10px 10px',
                                  borderRadius: 10,
                                  border: '1px solid #1f2a44',
                                  background: 'rgba(15,23,42,0.6)',
                                  color: 'white',
                                  outline: 'none',
                                  fontWeight: 800,
                                  letterSpacing: 1,
                                }}
                              />
                              <button
                                onClick={joinFriendSession}
                                disabled={friendBusy || !friendCode.trim()}
                                className="ll-btn ll-btn-primary"
                                style={{ padding: '10px 12px', fontSize: 13 }}
                              >
                                {friendBusy ? 'Joining...' : 'Join'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            gap: 10,
                            marginBottom: 10,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <div style={{ color: '#94a3b8', fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                Code:{' '}
                                <span style={{ color: '#93c5fd', fontWeight: 900, letterSpacing: 1 }}>{friendSession.code}</span>
                              </div>
                              <button
                                onClick={() => copyFriendCode(friendSession.code)}
                                className="ll-btn"
                                style={{ padding: '5px 10px', fontSize: 12 }}
                              >
                                {friendCopied ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>
                              Score:{' '}
                              <span style={{ color: '#34d399', fontWeight: 900 }}>{friendMyUid ? (friendSession.scores?.[friendMyUid] ?? 0) : 0}</span>
                              {' '}—{' '}
                              <span style={{ color: '#fbbf24', fontWeight: 900 }}>{friendOppUid ? (friendSession.scores?.[friendOppUid] ?? 0) : 0}</span>
                            </div>
                          </div>

                          <div style={{
                            border: '1px solid #1f2a44',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(2,6,23,0.35)',
                            marginBottom: 12,
                          }}>
                            <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 6 }}>
                              Players
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                              <div style={{ color: 'white', fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {friendSession.host.username}
                              </div>
                              <div style={{ color: friendSession.guest ? 'white' : '#94a3b8', fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {friendSession.guest ? friendSession.guest.username : 'Waiting for friend…'}
                              </div>
                            </div>
                          </div>

                          {friendSession.state === 'waiting' || !friendSession.guest ? (
                            <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.35 }}>
                              Share the code above. This match starts once your friend joins.
                            </div>
                          ) : friendSession.state === 'complete' ? (
                            <div style={{
                              border: '1px solid #1f2a44',
                              borderRadius: 12,
                              padding: 12,
                              background: 'rgba(15,23,42,0.55)',
                            }}>
                              <div style={{ fontWeight: 900, marginBottom: 6 }}>Match complete</div>
                              <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
                                Final score: {friendMyUid ? (friendSession.scores?.[friendMyUid] ?? 0) : 0} — {friendOppUid ? (friendSession.scores?.[friendOppUid] ?? 0) : 0}
                              </div>
                              <div style={{ display: 'flex', gap: 10 }}>
                                <button
                                  onClick={rematchFriend}
                                  className="ll-btn"
                                  style={{ padding: '10px 12px', fontSize: 13, flex: 1 }}
                                >
                                  Rematch
                                </button>
                                <button
                                  onClick={exitFriend}
                                  className="ll-btn ll-btn-primary"
                                  style={{ padding: '10px 12px', fontSize: 13, flex: 1 }}
                                >
                                  Back
                                </button>
                              </div>
                            </div>
                          ) : !friendCurrent ? (
                            <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading question…</div>
                          ) : (
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                                <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                  Question {Math.min(friendSession.currentIndex + 1, friendSession.questionIds.length)} / {friendSession.questionIds.length}
                                </div>
                                <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                  {(() => {
                                    const qid = friendSession.questionIds?.[friendSession.currentIndex] ?? '';
                                    const mine = friendMyUid ? friendSession.answers?.[qid]?.[friendMyUid] : null;
                                    const opp = friendOppUid ? friendSession.answers?.[qid]?.[friendOppUid] : null;
                                    return `${mine ? 'You ✓' : 'You…'} | ${opp ? 'Friend ✓' : 'Friend…'}`;
                                  })()}
                                </div>
                              </div>

                              <div style={{ fontSize: 13, lineHeight: 1.35, marginBottom: 12, color: 'white' }}>
                                {renderPromptBlocks(friendCurrent)}
                              </div>

                              {(() => {
                                const qid = friendSession.questionIds?.[friendSession.currentIndex] ?? '';
                                const mine = friendMyUid ? friendSession.answers?.[qid]?.[friendMyUid] : null;
                                const disabledAll = !!mine || friendBusy;
                                const finalInteraction = getFinalInteraction(friendCurrent);
                                const correctIndex = finalInteraction?.type === 'mcq' ? finalInteraction.correctChoiceIndex : 0;
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {renderCompositeStepCards(friendCurrent, soloStepAnswers, setSoloStepAnswers, disabledAll)}
                                    {finalInteraction?.type === 'mcq' ? (
                                      finalInteraction.choices.map((c, idx) => {
                                        const show = !!mine;
                                        const mineIdx = typeof (mine as any)?.choiceIndex === 'number' ? (mine as any).choiceIndex : -1;
                                        const bg = !show
                                          ? 'rgba(15,23,42,0.6)'
                                          : idx === correctIndex
                                            ? 'rgba(16,185,129,0.18)'
                                            : mineIdx === idx
                                              ? 'rgba(239,68,68,0.12)'
                                              : 'rgba(15,23,42,0.6)';
                                        const border = !show
                                          ? '1px solid #1f2a44'
                                          : idx === correctIndex
                                            ? '1px solid rgba(16,185,129,0.55)'
                                            : mineIdx === idx
                                              ? '1px solid rgba(239,68,68,0.35)'
                                              : '1px solid #1f2a44';
                                        return (
                                          <button
                                            key={idx}
                                            onClick={() => answerFriend(idx)}
                                            disabled={disabledAll}
                                            className="ll-btn"
                                            style={{
                                              padding: '10px 10px',
                                              fontSize: 13,
                                              textAlign: 'left',
                                              background: bg,
                                              border,
                                              opacity: disabledAll && !show ? 0.75 : 1,
                                            }}
                                          >
                                            {c}
                                          </button>
                                        );
                                      })
                                    ) : finalInteraction?.type === 'numeric' ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <input
                                          value={soloTextAnswer}
                                          disabled={disabledAll}
                                          onChange={(e) => setSoloTextAnswer(e.target.value)}
                                          placeholder="Enter number"
                                          style={{
                                            width: '100%',
                                            padding: '12px 12px',
                                            borderRadius: 12,
                                            border: '1px solid #1f2a44',
                                            background: 'rgba(15,23,42,0.6)',
                                            color: 'white',
                                            outline: 'none',
                                            fontSize: 14,
                                            fontWeight: 900,
                                          }}
                                        />
                                        <button
                                          className="ll-btn ll-btn-primary"
                                          disabled={disabledAll || !soloTextAnswer.trim()}
                                          onClick={() => answerFriendFreeform('numeric')}
                                          style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                                        >
                                          Submit
                                        </button>
                                      </div>
                                    ) : isTextSubmittedInteraction(finalInteraction) ? (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {renderTextSubmittedEditor(finalInteraction, soloTextAnswer, setSoloTextAnswer, disabledAll, () => answerFriendFreeform('text'))}
                                      </div>
                                    ) : (
                                      <div style={{ color: '#94a3b8', fontSize: 13 }}>This question type is not supported yet.</div>
                                    )}
                                    {mine && (
                                      <div style={{
                                        marginTop: 8,
                                        padding: '10px 10px',
                                        borderRadius: 12,
                                        border: '1px solid #1f2a44',
                                        background: 'rgba(2,6,23,0.35)',
                                        color: '#94a3b8',
                                        fontSize: 12,
                                        lineHeight: 1.35,
                                      }}>
                                        {(() => {
                                          const opp = friendOppUid ? friendSession.answers?.[qid]?.[friendOppUid] : null;
                                          const mineIdx = typeof (mine as any)?.choiceIndex === 'number' ? ((mine as any).choiceIndex as number) : null;
                                          const oppIdx = typeof (opp as any)?.choiceIndex === 'number' ? ((opp as any).choiceIndex as number) : null;

                                          const myText = mineIdx != null && finalInteraction?.type === 'mcq'
                                            ? (finalInteraction.choices?.[mineIdx] ?? '—')
                                            : (typeof (mine as any)?.valueText === 'string' ? String((mine as any).valueText) : '—');
                                          const oppText = opp
                                            ? (oppIdx != null && finalInteraction?.type === 'mcq'
                                                ? (finalInteraction.choices?.[oppIdx] ?? '—')
                                                : (typeof (opp as any)?.valueText === 'string' ? String((opp as any).valueText) : '✓'))
                                            : '…';
                                          const corrText = finalInteraction?.type === 'mcq'
                                            ? (finalInteraction.choices?.[correctIndex] ?? '—')
                                            : '—';
                                          return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                              <div><span style={{ color: '#e2e8f0', fontWeight: 900 }}>You:</span> {myText} {mine.correct ? '(correct)' : '(wrong)'}</div>
                                              <div><span style={{ color: '#e2e8f0', fontWeight: 900 }}>Friend:</span> {oppText}</div>
                                              {finalInteraction?.type === 'mcq' && (
                                                <div><span style={{ color: '#34d399', fontWeight: 900 }}>Correct:</span> {corrText}</div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 12, lineHeight: 1.35 }}>
                                Next question advances automatically once both players answer.
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                      );
                    }
                    if (rankedActive) {
                      return (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13 }}>Ranked Practice</div>
                        <button onClick={exitRanked} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>Exit</button>
                      </div>

                      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                        Trophies: <span style={{ color: '#fbbf24', fontWeight: 900 }}>{rankedTrophies}</span>
                        <span style={{ color: '#64748b' }}>
                          {' '}| Rank: {computeRankInfo({ trophies: rankedTrophies, totalQuestions: playableOverallTotal }).name}
                        </span>
                        <span style={{ color: '#64748b' }}>
                          {' '}| Next checkpoint: {Math.ceil((rankedTrophies + 1) / 100) * 100}
                        </span>
                        {rankedSaving ? ' | Saving...' : ''}
                      </div>

                      {!rankedCurrent ? (
                        <div style={{ color: '#94a3b8', fontSize: 13 }}>
                          {rankedCandidates.length === 0 ? 'No ranked questions yet' : 'Ranked complete'}
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 900, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                            Ranked Question
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
                            {renderPromptBlocks(rankedCurrent)}
                          </div>

                          {(() => {
                            const finalInteraction = getFinalInteraction(rankedCurrent);
                            return finalInteraction?.type === 'mcq' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {renderCompositeStepCards(rankedCurrent, rankedStepAnswers, setRankedStepAnswers, !!rankedFeedback)}
                              {finalInteraction.choices.map((c, idx) => {
                                const disabled = !!rankedFeedback;
                                const isCorrect = rankedFeedback?.correctIndex === idx;
                                const isChosenWrong = rankedFeedback && !rankedFeedback.correct && idx !== rankedFeedback.correctIndex;
                                const bg = !rankedFeedback
                                  ? 'rgba(15,23,42,0.6)'
                                  : isCorrect
                                    ? 'rgba(16,185,129,0.18)'
                                    : 'rgba(239,68,68,0.12)';
                                const border = !rankedFeedback
                                  ? '1px solid #1f2a44'
                                  : isCorrect
                                    ? '1px solid rgba(16,185,129,0.55)'
                                    : '1px solid rgba(239,68,68,0.35)';
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => answerRankedMcq(idx)}
                                    disabled={disabled}
                                    className="ll-btn"
                                    style={{
                                      padding: '10px 10px',
                                      fontSize: 13,
                                      textAlign: 'left',
                                      background: bg,
                                      border,
                                      opacity: disabled && !isCorrect && isChosenWrong ? 0.75 : 1,
                                    }}
                                  >
                                    {c}
                                  </button>
                                );
                              })}
                            </div>
                          ) : finalInteraction?.type === 'numeric' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {renderCompositeStepCards(rankedCurrent, rankedStepAnswers, setRankedStepAnswers, !!rankedFeedback)}
                              <input
                                value={rankedTextAnswer}
                                disabled={!!rankedFeedback}
                                inputMode="decimal"
                                onChange={(e) => setRankedTextAnswer(e.target.value)}
                                placeholder="Enter answer"
                                style={{
                                  width: '100%',
                                  padding: '12px 12px',
                                  borderRadius: 12,
                                  border: '1px solid #1f2a44',
                                  background: 'rgba(15,23,42,0.6)',
                                  color: 'white',
                                  outline: 'none',
                                  fontSize: 14,
                                  fontWeight: 900,
                                }}
                              />

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                {['7', '8', '9', '4', '5', '6', '1', '2', '3', '-', '.', '0', '⌫'].map((k) => (
                                  <button
                                    key={k}
                                    className="ll-btn"
                                    disabled={!!rankedFeedback}
                                    onClick={() => {
                                      if (rankedFeedback) return;
                                      if (k === '⌫') {
                                        setRankedTextAnswer((p) => p.slice(0, -1));
                                      } else if (k === '-') {
                                        setRankedTextAnswer((p) => (p.startsWith('-') ? p.slice(1) : `-${p}`));
                                      } else {
                                        setRankedTextAnswer((p) => `${p}${k}`);
                                      }
                                    }}
                                    style={{ padding: '12px 10px', fontSize: 14, fontWeight: 1000, borderRadius: 14, background: 'rgba(30,41,59,0.7)' }}
                                  >
                                    {k}
                                  </button>
                                ))}
                              </div>

                              <button
                                className="ll-btn ll-btn-primary"
                                disabled={!!rankedFeedback || rankedSaving || !rankedTextAnswer.trim()}
                                onClick={() => answerRankedFreeform('numeric')}
                                style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                              >
                                Submit
                              </button>
                            </div>
                          ) : isTextSubmittedInteraction(finalInteraction) ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {renderCompositeStepCards(rankedCurrent, rankedStepAnswers, setRankedStepAnswers, !!rankedFeedback)}
                              {renderTextSubmittedEditor(finalInteraction, rankedTextAnswer, setRankedTextAnswer, !!rankedFeedback || rankedSaving, () => answerRankedFreeform('text'))}
                            </div>
                          ) : (
                            <div style={{ color: '#94a3b8', fontSize: 13 }}>This question type is not supported yet.</div>
                          );
                          })()}

                          {rankedFeedback && (
                            <div style={{ marginTop: 12 }}>
                              <div style={{
                                color: rankedFeedback.correct ? '#34d399' : '#fca5a5',
                                fontWeight: 900,
                                marginBottom: 10,
                              }}>
                                {rankedFeedback.correct ? 'Correct! (+14–16)' : 'Wrong (−14–16) — will appear again'}
                              </div>
                              <button
                                onClick={continueRanked}
                                className="ll-btn ll-btn-primary"
                                style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                              >
                                Continue
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                      );
                    }

                    if (practiceMode === 'study') {
                      return (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13 }}>Study Session</div>
                        <button onClick={exitStudy} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>Exit</button>
                      </div>

                      {studyError && (
                        <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{studyError}</div>
                      )}

                      {!studySession ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{
                            border: '1px solid #1f2a44',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(2,6,23,0.35)',
                          }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Create a session</div>
                            <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.35, marginBottom: 10 }}>
                              Generates a 5-digit code. Anyone can join.
                            </div>
                            <button
                              onClick={createStudySession}
                              disabled={studyBusy}
                              className="ll-btn ll-btn-primary"
                              style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                            >
                              {studyBusy ? 'Creating...' : 'Create session'}
                            </button>
                          </div>

                          <div style={{
                            border: '1px solid #1f2a44',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(2,6,23,0.35)',
                          }}>
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>Join a session</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                value={studyCode}
                                onChange={(e) => setStudyCode(e.target.value.toUpperCase())}
                                placeholder="Enter code"
                                style={{
                                  flex: 1,
                                  padding: '10px 10px',
                                  borderRadius: 10,
                                  border: '1px solid #1f2a44',
                                  background: 'rgba(15,23,42,0.6)',
                                  color: 'white',
                                  outline: 'none',
                                  fontWeight: 800,
                                  letterSpacing: 1,
                                }}
                              />
                              <button
                                onClick={joinStudySession}
                                disabled={studyBusy || !studyCode.trim()}
                                className="ll-btn ll-btn-primary"
                                style={{ padding: '10px 12px', fontSize: 13 }}
                              >
                                {studyBusy ? 'Joining...' : 'Join'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                              <div style={{ color: '#94a3b8', fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                Code:{' '}
                                <span style={{ color: '#93c5fd', fontWeight: 900, letterSpacing: 1 }}>{studySession.code}</span>
                              </div>
                              <button
                                onClick={() => copyStudyCode(studySession.code)}
                                className="ll-btn"
                                style={{ padding: '5px 10px', fontSize: 12 }}
                              >
                                {studyCopied ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: 12 }}>
                              {Object.keys(studySession.participants ?? {}).length}/5
                            </div>
                          </div>

                          <div style={{
                            border: '1px solid #1f2a44',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(2,6,23,0.35)',
                          }}>
                            <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 6 }}>
                              Participants
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {Object.values(studySession.participants ?? {}).map((p) => (
                                <div key={p.uid} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                                  <div style={{ color: 'white', fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.username}
                                    {studySession.hostUid === p.uid ? (
                                      <span style={{ color: '#fbbf24', fontWeight: 900 }}>{' '}· Host</span>
                                    ) : null}
                                  </div>
                                  <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                    {(() => {
                                      const ts = Date.parse(p.lastActiveAt);
                                      if (!Number.isFinite(ts)) return '—';
                                      const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
                                      return s <= 8 ? 'Online' : `${s}s`;
                                    })()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {studySession.state === 'complete' ? (
                            <div style={{
                              border: '1px solid #1f2a44',
                              borderRadius: 12,
                              padding: 12,
                              background: 'rgba(15,23,42,0.55)',
                            }}>
                              <div style={{ fontWeight: 900, marginBottom: 6 }}>Session ended</div>
                              <button
                                onClick={exitStudy}
                                className="ll-btn ll-btn-primary"
                                style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                              >
                                Back
                              </button>
                            </div>
                          ) : studySession.state === 'lobby' ? (
                            <div style={{
                              border: '1px solid #1f2a44',
                              borderRadius: 12,
                              padding: 12,
                              background: 'rgba(15,23,42,0.55)',
                            }}>
                              <div style={{ fontWeight: 900, marginBottom: 6 }}>Lobby</div>
                              <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
                                Host starts when everyone is ready.
                              </div>
                              {studyIsHost ? (
                                <button
                                  onClick={startStudySessionNow}
                                  className="ll-btn ll-btn-primary"
                                  style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                                >
                                  Start session
                                </button>
                              ) : (
                                <div style={{ color: '#94a3b8', fontSize: 13 }}>Waiting for host…</div>
                              )}
                            </div>
                          ) : !studyCurrent ? (
                            <div style={{ color: '#94a3b8', fontSize: 13 }}>Loading question…</div>
                          ) : (
                            <div style={{
                              border: '1px solid #1f2a44',
                              borderRadius: 12,
                              padding: 12,
                              background: 'rgba(2,6,23,0.35)',
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                                <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                  Question {Math.min((studySession.currentIndex ?? 0) + 1, studySession.questionIds.length)} / {studySession.questionIds.length}
                                </div>
                                {studyIsHost ? (
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={studyPrev} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>
                                      ←
                                    </button>
                                    <button onClick={studyNext} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>
                                      →
                                    </button>
                                    <button
                                      onClick={toggleStudyReveal}
                                      className={studySession.reveal ? 'll-btn ll-btn-primary' : 'll-btn'}
                                      style={{ padding: '6px 10px', fontSize: 12 }}
                                    >
                                      {studySession.reveal ? 'Hide' : 'Reveal'}
                                    </button>
                                  </div>
                                ) : (
                                  <div style={{ color: '#94a3b8', fontSize: 12 }}>
                                    {studySession.reveal ? 'Answer revealed' : 'Answer hidden'}
                                  </div>
                                )}
                              </div>

                              <div style={{ fontSize: 13, lineHeight: 1.35, marginBottom: 12, color: 'white' }}>
                                {renderPromptBlocks(studyCurrent)}
                              </div>

                              {(() => {
                                const finalInteraction = getFinalInteraction(studyCurrent);
                                return finalInteraction?.type === 'mcq' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {renderCompositeStepCards(studyCurrent, soloStepAnswers, setSoloStepAnswers, !!(uid ? studySession.answers?.[studySession.questionIds?.[studySession.currentIndex] ?? '']?.[uid] : null))}
                                  {finalInteraction.choices.map((c, idx) => {
                                    const qid = studySession.questionIds?.[studySession.currentIndex] ?? '';
                                    const myAns = uid ? studySession.answers?.[qid]?.[uid] : null;
                                    const myIdx = typeof (myAns as any)?.choiceIndex === 'number' ? (myAns as any).choiceIndex : -1;
                                    const chosen = myIdx === idx;
                                    const correctIdx = finalInteraction?.type === 'mcq' ? finalInteraction.correctChoiceIndex : 0;
                                    const showCorrect = studySession.reveal;
                                    const isCorrect = showCorrect && correctIdx === idx;
                                    const border = isCorrect
                                      ? '1px solid rgba(34,197,94,0.55)'
                                      : chosen
                                        ? '1px solid rgba(59,130,246,0.55)'
                                        : '1px solid #1f2a44';
                                    const bg = isCorrect
                                      ? 'rgba(34,197,94,0.12)'
                                      : chosen
                                        ? 'rgba(59,130,246,0.10)'
                                        : 'rgba(15,23,42,0.55)';
                                    return (
                                      <button
                                        key={idx}
                                        onClick={() => answerStudy(idx)}
                                        disabled={!!myAns}
                                        className="ll-btn"
                                        style={{
                                          textAlign: 'left',
                                          padding: '10px 10px',
                                          borderRadius: 12,
                                          border,
                                          background: bg,
                                          color: 'white',
                                          opacity: !myAns ? 1 : (chosen || isCorrect ? 1 : 0.7),
                                        }}
                                      >
                                        {c}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : finalInteraction?.type === 'numeric' ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {(() => {
                                    const qid = studySession.questionIds?.[studySession.currentIndex] ?? '';
                                    const myAns = uid ? studySession.answers?.[qid]?.[uid] : null;
                                    const disabled = !!myAns;
                                    return (
                                      <>
                                        {renderCompositeStepCards(studyCurrent, soloStepAnswers, setSoloStepAnswers, disabled)}
                                        <input
                                          value={soloTextAnswer}
                                          disabled={disabled}
                                          onChange={(e) => setSoloTextAnswer(e.target.value)}
                                          placeholder="Enter number"
                                          style={{
                                            width: '100%',
                                            padding: '12px 12px',
                                            borderRadius: 12,
                                            border: '1px solid #1f2a44',
                                            background: 'rgba(15,23,42,0.6)',
                                            color: 'white',
                                            outline: 'none',
                                            fontSize: 14,
                                            fontWeight: 900,
                                          }}
                                        />
                                        <button
                                          className="ll-btn ll-btn-primary"
                                          disabled={disabled || !soloTextAnswer.trim()}
                                          onClick={() => answerStudyFreeform('numeric')}
                                          style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                                        >
                                          Submit
                                        </button>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : isTextSubmittedInteraction(finalInteraction) ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {(() => {
                                    const qid = studySession.questionIds?.[studySession.currentIndex] ?? '';
                                    const myAns = uid ? studySession.answers?.[qid]?.[uid] : null;
                                    const disabled = !!myAns;
                                    return (
                                      <>
                                        {renderCompositeStepCards(studyCurrent, soloStepAnswers, setSoloStepAnswers, disabled)}
                                        {renderTextSubmittedEditor(finalInteraction, soloTextAnswer, setSoloTextAnswer, disabled, () => answerStudyFreeform('text'))}
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div style={{ color: '#94a3b8', fontSize: 13 }}>This question type is not supported yet.</div>
                              );
                              })()}

                              <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 12 }}>
                                {(() => {
                                  const qid = studySession.questionIds?.[studySession.currentIndex] ?? '';
                                  const ans = studySession.answers?.[qid] ?? {};
                                  const parts = Object.values(studySession.participants ?? {}).map((p) => {
                                    const a = ans[p.uid];
                                    if (!a) return `${p.username}: …`;
                                    const ci = typeof (a as any).choiceIndex === 'number' ? (a as any).choiceIndex : null;
                                    if (ci != null) return `${p.username}: ${String.fromCharCode(65 + ci)}`;
                                    const vt = typeof (a as any).valueText === 'string' ? (a as any).valueText : null;
                                    return `${p.username}: ${vt != null && String(vt).trim() ? String(vt) : '✓'}`;
                                  });
                                  return parts.join(' | ');
                                })()}
                              </div>
                            </div>
                          )}

                          <div style={{
                            border: '1px solid #1f2a44',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(2,6,23,0.35)',
                          }}>
                            <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 8 }}>
                              Chat
                            </div>
                            <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                              {studyMessages.length === 0 ? (
                                <div style={{ color: '#94a3b8', fontSize: 12 }}>No messages yet.</div>
                              ) : (
                                studyMessages.map((m) => (
                                  <div key={m.id} style={{ fontSize: 12, lineHeight: 1.35 }}>
                                    <span style={{ color: '#93c5fd', fontWeight: 900 }}>{m.fromUsername}</span>
                                    <span style={{ color: '#64748b' }}> · </span>
                                    <span style={{ color: '#e2e8f0' }}>{m.text}</span>
                                  </div>
                                ))
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                value={studyChatText}
                                onChange={(e) => setStudyChatText(e.target.value)}
                                placeholder="Message"
                                style={{
                                  flex: 1,
                                  padding: '10px 10px',
                                  borderRadius: 10,
                                  border: '1px solid #1f2a44',
                                  background: 'rgba(15,23,42,0.6)',
                                  color: 'white',
                                  outline: 'none',
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') sendStudyChat();
                                }}
                              />
                              <button
                                onClick={sendStudyChat}
                                disabled={!studyChatText.trim()}
                                className="ll-btn ll-btn-primary"
                                style={{ padding: '10px 12px', fontSize: 13 }}
                              >
                                Send
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                      );
                    }

                    if (soloActive) {
                      return (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13 }}>Solo Practice</div>
                        <button onClick={exitSolo} className="ll-btn" style={{ padding: '6px 10px', fontSize: 12 }}>Exit</button>
                      </div>

                      <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                        Seen: {soloSeenIds.length} / {soloCandidates.length}
                        {soloAwarding ? ' | Awarding...' : ''}
                      </div>

                      {!soloCurrent ? (
                        <div style={{ color: '#94a3b8', fontSize: 13 }}>
                          No questions found for this question type yet.
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 900, fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                            Question
                          </div>
                          <div style={{ fontSize: 13, lineHeight: 1.35, marginBottom: 12 }}>
                            {renderPromptBlocks(soloCurrent)}
                          </div>

                          {(() => {
                            const finalInteraction = getFinalInteraction(soloCurrent);
                            return finalInteraction?.type === 'mcq' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {renderCompositeStepCards(soloCurrent, soloStepAnswers, setSoloStepAnswers, !!soloFeedback)}
                              {finalInteraction.choices.map((c, idx) => {
                                const disabled = !!soloFeedback;
                                const isCorrect = soloFeedback?.correctIndex === idx;
                                const isChosenWrong = soloFeedback && !soloFeedback.correct && idx !== soloFeedback.correctIndex;
                                const bg = !soloFeedback
                                  ? 'rgba(15,23,42,0.6)'
                                  : isCorrect
                                    ? 'rgba(16,185,129,0.18)'
                                    : 'rgba(239,68,68,0.12)';
                                const border = !soloFeedback
                                  ? '1px solid #1f2a44'
                                  : isCorrect
                                    ? '1px solid rgba(16,185,129,0.55)'
                                    : '1px solid rgba(239,68,68,0.35)';

                                return (
                                  <button
                                    key={idx}
                                    onClick={() => answerSoloMcq(idx)}
                                    disabled={disabled}
                                    className="ll-btn"
                                    style={{
                                      padding: '10px 10px',
                                      fontSize: 13,
                                      textAlign: 'left',
                                      background: bg,
                                      border,
                                      opacity: disabled && !isCorrect && isChosenWrong ? 0.75 : 1,
                                    }}
                                  >
                                    {c}
                                  </button>
                                );
                              })}
                            </div>
                          ) : finalInteraction?.type === 'numeric' ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {renderCompositeStepCards(soloCurrent, soloStepAnswers, setSoloStepAnswers, !!soloFeedback)}
                              <input
                                value={soloTextAnswer}
                                disabled={!!soloFeedback}
                                inputMode="decimal"
                                onChange={(e) => setSoloTextAnswer(e.target.value)}
                                placeholder="Enter answer"
                                style={{
                                  width: '100%',
                                  padding: '12px 12px',
                                  borderRadius: 12,
                                  border: '1px solid #1f2a44',
                                  background: 'rgba(15,23,42,0.6)',
                                  color: 'white',
                                  outline: 'none',
                                  fontSize: 14,
                                  fontWeight: 900,
                                }}
                              />

                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                {['7', '8', '9', '4', '5', '6', '1', '2', '3', '-', '.', '0', '⌫'].map((k) => (
                                  <button
                                    key={k}
                                    className="ll-btn"
                                    disabled={!!soloFeedback}
                                    onClick={() => {
                                      if (soloFeedback) return;
                                      if (k === '⌫') {
                                        setSoloTextAnswer((p) => p.slice(0, -1));
                                      } else if (k === '-') {
                                        setSoloTextAnswer((p) => (p.startsWith('-') ? p.slice(1) : `-${p}`));
                                      } else {
                                        setSoloTextAnswer((p) => `${p}${k}`);
                                      }
                                    }}
                                    style={{ padding: '12px 10px', fontSize: 14, fontWeight: 1000, borderRadius: 14, background: 'rgba(30,41,59,0.7)' }}
                                  >
                                    {k}
                                  </button>
                                ))}
                              </div>

                              <button
                                className="ll-btn ll-btn-primary"
                                disabled={!!soloFeedback || !soloTextAnswer.trim()}
                                onClick={() => answerSoloFreeform('numeric')}
                                style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}
                              >
                                Submit
                              </button>
                            </div>
                          ) : isTextSubmittedInteraction(finalInteraction) ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {renderCompositeStepCards(soloCurrent, soloStepAnswers, setSoloStepAnswers, !!soloFeedback)}
                              {renderTextSubmittedEditor(finalInteraction, soloTextAnswer, setSoloTextAnswer, !!soloFeedback, () => answerSoloFreeform('text'))}
                            </div>
                          ) : (
                            <div style={{ color: '#94a3b8', fontSize: 13 }}>This question type is not supported yet.</div>
                          );
                          })()}

                          {soloFeedback && (
                            <div style={{ marginTop: 12 }}>
                              <div style={{
                                color: soloFeedback.correct ? '#34d399' : '#fca5a5',
                                fontWeight: 900,
                                marginBottom: 10,
                              }}>
                                {soloFeedback.correct ? 'Correct!' : 'Not quite'}
                              </div>
                              <button onClick={nextSolo} className="ll-btn ll-btn-primary" style={{ padding: '10px 12px', fontSize: 13, width: '100%' }}>
                                Next Question
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                      );
                    }

                    return (
                      <div style={{ color: '#94a3b8', fontSize: 13 }}>
                        Choose a practice mode from Question Types.
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
