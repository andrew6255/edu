import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { computeLevel, updateUserData } from '@/lib/userService';
import { getOrgById } from '@/lib/orgService';

// ── constants ────────────────────────────────────────────────────────────────

const LEVELS = [
  { min: 0,     title: 'Initiate',     color: '#64748b' },
  { min: 500,   title: 'Apprentice',   color: '#3b82f6' },
  { min: 1500,  title: 'Seeker',       color: '#06b6d4' },
  { min: 3000,  title: 'Scholar',      color: '#10b981' },
  { min: 6000,  title: 'Adept',        color: '#84cc16' },
  { min: 10000, title: 'Expert',       color: '#f59e0b' },
  { min: 15000, title: 'Master',       color: '#f97316' },
  { min: 25000, title: 'Grandmaster',  color: '#ef4444' },
  { min: 50000, title: 'Logic Lord',   color: '#a855f7' },
];

const BADGE_META: Record<string, { emoji: string; name: string; desc: string }> = {
  badge_pioneer:    { emoji: '🚀', name: 'Pioneer',       desc: 'First to sign up'           },
  badge_streak_3:   { emoji: '🔥', name: 'On Fire',       desc: '3-day login streak'         },
  badge_streak_7:   { emoji: '⚡', name: 'Unstoppable',   desc: '7-day login streak'         },
  badge_streak_30:  { emoji: '💫', name: 'Legendary',     desc: '30-day login streak'        },
  badge_hoarder:    { emoji: '💰', name: 'Gold Hoarder',  desc: 'Amassed 1,000 gold'         },
  badge_fashionista:{ emoji: '👗', name: 'Fashionista',   desc: 'Equipped a custom banner'   },
  badge_gold_scholar:{ emoji: '🎓', name: 'Gold Scholar', desc: 'Earned 1,000 XP'            },
  badge_logic_lord: { emoji: '👑', name: 'Logic Lord',    desc: 'Reached max level'          },
  badge_boss_slayer:{ emoji: '🗡️', name: 'Boss Slayer',   desc: 'Defeated the Logic Lord'   },
  badge_flawless_5: { emoji: '💎', name: 'Flawless Five', desc: 'Won 5 arena battles in a row'},
  badge_no_hints:   { emoji: '🧠', name: 'No Hints',      desc: 'Completed a game hint-free' },
};

const GAME_META: Record<string, { label: string; icon: string }> = {
  quickMath:    { label: 'Quick Math',          icon: '⚡' },
  timeLimit:    { label: 'Time Limit',          icon: '⏱️' },
  advQuickMath: { label: 'Advanced Math',       icon: '🔢' },
  pyramid:      { label: 'Number Pyramid',      icon: '🔺' },
  blockPuzzle:  { label: 'Block Puzzle',        icon: '🟦' },
  flipNodes:    { label: 'Flip Nodes',          icon: '🔄' },
  fifteenPuzzle:{ label: '15 Puzzle',           icon: '🧩' },
  sequence:     { label: 'Sequence',            icon: '📈' },
  trueFalse:    { label: 'True or False',       icon: '✅' },
  missingOp:    { label: 'Missing Op',          icon: '❓' },
  compareExp:   { label: 'Compare Expressions', icon: '⚖️' },
  completeEq:   { label: 'Complete Equation',   icon: '✏️' },
  memoOrder:    { label: 'Memo Order',          icon: '🧠' },
  memoCells:    { label: 'Memo Cells',          icon: '🔲' },
  ticTacToe:    { label: 'Tic-Tac-Toe',         icon: '❌' },
  chessMemory:  { label: 'Chess Memory',        icon: '♟️' },
  neonGrid:     { label: 'Neon Grid',           icon: '🌐' },
  flipCup:      { label: 'Flip Cup',            icon: '🥤' },
  nameSquare10: { label: 'Name Square (10s)',   icon: '♜' },
  nameSquare60: { label: 'Name Square (60s)',   icon: '♝' },
  findSquare10: { label: 'Find Square (10s)',   icon: '♞' },
  findSquare60: { label: 'Find Square (60s)',   icon: '♛' },
};

// ── helpers ───────────────────────────────────────────────────────────────────

function xpProgress(xp: number): { pct: number; current: number; needed: number } {
  // Find current level index (0-based)
  let lvIdx = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].min) { lvIdx = i; break; }
  }
  if (lvIdx >= LEVELS.length - 1) return { pct: 100, current: xp - LEVELS[lvIdx].min, needed: 0 };
  const floor = LEVELS[lvIdx].min;
  const ceil  = LEVELS[lvIdx + 1].min;
  const current = xp - floor;
  const needed  = ceil - floor;
  return { pct: Math.min(100, (current / needed) * 100), current, needed };
}

function countMastered(progress?: Record<string, Record<string, Record<string, { mastered: boolean }>>>): number {
  if (!progress) return 0;
  let n = 0;
  for (const cur of Object.values(progress))
    for (const ch of Object.values(cur))
      for (const obj of Object.values(ch))
        if (obj.mastered) n++;
  return n;
}

function avatarBg(username: string): string {
  const hue = ((username?.charCodeAt(0) || 65) * 137) % 360;
  return `hsl(${hue}, 60%, 35%)`;
}

// ── component ─────────────────────────────────────────────────────────────────

const CURRICULUM_SYSTEM_LABELS: Record<string, string> = {
  IGCSE: '🇬🇧 IGCSE', BAC: '🇫🇷 Baccalauréat', American: '🇺🇸 American', IB: '🌐 IB', Other: '📚 Other'
};

export default function ProfileView() {
  const { user, userData, refreshUserData } = useAuth();
  const [hoveredBadge, setHoveredBadge] = useState<string | null>(null);
  const [showAllScores, setShowAllScores] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [resettingOnboarding, setResettingOnboarding] = useState(false);

  useEffect(() => {
    if (userData?.organisationId) {
      getOrgById(userData.organisationId).then(org => setOrgName(org?.name ?? null));
    } else {
      setOrgName(null);
    }
  }, [userData?.organisationId]);

  if (!userData) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
      Loading profile...
    </div>
  );

  const xp      = userData.economy?.global_xp ?? 0;
  const gold    = userData.economy?.gold ?? 0;
  const streak  = userData.economy?.streak ?? 0;
  const { level, title } = computeLevel(xp);
  const lvColor = LEVELS[level - 1]?.color ?? '#64748b';
  const prog    = xpProgress(xp);

  const arenaW  = userData.arenaStats?.wins ?? 0;
  const arenaL  = userData.arenaStats?.losses ?? 0;
  const arenaTotal = arenaW + arenaL;
  const winRate = arenaTotal > 0 ? Math.round((arenaW / arenaTotal) * 100) : 0;
  const bestStreak = userData.arenaStats?.highestStreak ?? 0;

  const badges    = userData.inventory?.badges ?? [];
  const mastered  = countMastered(userData.progress);

  const highScores = userData.high_scores ?? {};
  const allGames = Object.entries(GAME_META).map(([id, meta]) => ({
    id, ...meta, score: highScores[id] ?? 0, played: (highScores[id] ?? 0) > 0
  }));
  const playedGames  = allGames.filter(g => g.played).sort((a, b) => b.score - a.score);
  const shownScores  = showAllScores ? allGames : (playedGames.length > 0 ? playedGames : allGames.slice(0, 6));

  const initial = (userData.username?.[0] || userData.firstName?.[0] || '?').toUpperCase();

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#0f172a' }}>
      {/* ── Hero ── */}
      <div style={{
        background: `linear-gradient(160deg, ${lvColor}22 0%, #0f172a 60%)`,
        padding: '28px 20px 20px',
        borderBottom: `1px solid ${lvColor}44`,
        animation: 'fadeIn 0.4s ease'
      }}>
        {/* Avatar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18 }}>
          <div style={{
            width: 76, height: 76, borderRadius: '50%',
            background: avatarBg(userData.username),
            border: `3px solid ${lvColor}`,
            boxShadow: `0 0 20px ${lvColor}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 34, fontWeight: 'bold', color: 'white', marginBottom: 10,
            flexShrink: 0
          }}>
            {initial}
          </div>
          <div style={{ fontSize: 22, fontWeight: 'bold', color: 'white' }}>{userData.username}</div>
          {(userData.firstName || userData.lastName) && (
            <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>
              {userData.firstName} {userData.lastName}
            </div>
          )}
          <div style={{
            marginTop: 8, padding: '4px 14px', borderRadius: 20,
            background: `${lvColor}22`, border: `1px solid ${lvColor}66`,
            color: lvColor, fontSize: 13, fontWeight: 'bold'
          }}>
            Level {level} · {title}
          </div>
        </div>

        {/* 4-stat row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'XP',      value: xp.toLocaleString(),    color: '#10b981', icon: '⭐' },
            { label: 'Gold',    value: gold.toLocaleString(),   color: '#fbbf24', icon: '🪙' },
            { label: 'Streak',  value: `${streak}d`,            color: '#f97316', icon: '🔥' },
            { label: 'Mastered',value: mastered,                color: '#a78bfa', icon: '🎯' },
          ].map(s => (
            <div key={s.label} style={{
              background: 'rgba(30,41,59,0.8)', borderRadius: 10, padding: '10px 6px',
              textAlign: 'center', border: `1px solid ${s.color}33`
            }}>
              <div style={{ fontSize: 16 }}>{s.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: s.color, marginTop: 2 }}>{s.value}</div>
              <div style={{ color: '#64748b', fontSize: 10, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* XP Progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 5 }}>
            <span>{prog.current.toLocaleString()} XP into level</span>
            {prog.needed > 0
              ? <span>{prog.needed.toLocaleString()} XP to Level {level + 1}</span>
              : <span style={{ color: '#a855f7' }}>MAX LEVEL</span>
            }
          </div>
          <div style={{ height: 10, background: '#1e293b', borderRadius: 5, overflow: 'hidden', border: `1px solid ${lvColor}44` }}>
            <div style={{
              width: `${prog.pct}%`, height: '100%', borderRadius: 5, transition: 'width 0.8s ease',
              background: `linear-gradient(90deg, ${lvColor}, ${lvColor}cc)`
            }} />
          </div>
        </div>
      </div>

      <div style={{ padding: '16px 16px 32px' }}>

        {/* ── Level Path ── */}
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, fontWeight: 'bold' }}>
            Level Path
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', paddingBottom: 4 }}>
            {LEVELS.map((lv, i) => {
              const lvNum = i + 1;
              const isReached  = level >= lvNum;
              const isCurrent  = level === lvNum;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: isCurrent ? 32 : 24, height: isCurrent ? 32 : 24, borderRadius: '50%',
                      background: isReached ? lv.color : '#334155',
                      border: isCurrent ? `3px solid white` : `2px solid ${isReached ? lv.color : '#475569'}`,
                      boxShadow: isCurrent ? `0 0 12px ${lv.color}99` : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: isCurrent ? 13 : 10, fontWeight: 'bold',
                      color: isReached ? 'white' : '#475569',
                      transition: 'all 0.3s'
                    }}>
                      {lvNum}
                    </div>
                    <div style={{ fontSize: 8, color: isCurrent ? lv.color : isReached ? '#94a3b8' : '#475569', whiteSpace: 'nowrap', textAlign: 'center' }}>
                      {lv.title}
                    </div>
                  </div>
                  {i < LEVELS.length - 1 && (
                    <div style={{
                      width: 22, height: 2, flexShrink: 0, marginBottom: 14,
                      background: level > lvNum ? LEVELS[i].color : '#334155',
                      transition: 'background 0.3s'
                    }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Curriculum Profile ── */}
        {userData.curriculumProfile ? (
          <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: '1px solid #334155' }}>
            <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 'bold' }}>
              📚 My Curriculum
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', border: '1px solid #334155' }}>
                <div style={{ color: '#64748b', fontSize: 10, marginBottom: 3 }}>SYSTEM</div>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>
                  {CURRICULUM_SYSTEM_LABELS[userData.curriculumProfile.system] || userData.curriculumProfile.system}
                </div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', border: '1px solid #334155' }}>
                <div style={{ color: '#64748b', fontSize: 10, marginBottom: 3 }}>YEAR</div>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>{userData.curriculumProfile.year}</div>
              </div>
            </div>
            <div style={{ background: '#0f172a', borderRadius: 10, padding: '10px 12px', border: '1px solid #334155', marginTop: 8 }}>
              <div style={{ color: '#64748b', fontSize: 10, marginBottom: 3 }}>TEXTBOOK / CURRICULUM</div>
              <div style={{ color: '#93c5fd', fontWeight: 'bold', fontSize: 14 }}>
                {userData.curriculumProfile.customTextbook
                  ? '📖 Custom — pending review'
                  : `📖 ${userData.curriculumProfile.textbook}`}
              </div>
            </div>
          </div>
        ) : (
          <div style={{
            background: '#1e293b', borderRadius: 14, padding: '14px 16px', marginBottom: 14,
            border: '1px solid rgba(59,130,246,0.2)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 32, flexShrink: 0 }}>📚</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'white', fontWeight: 'bold', fontSize: 14, marginBottom: 4 }}>Complete your curriculum setup</div>
                <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5 }}>
                  Tell us which education system and textbook you use so Logic Lords can personalise your learning path.
                </div>
              </div>
            </div>
            <button
              disabled={resettingOnboarding}
              onClick={async () => {
                if (!user) return;
                setResettingOnboarding(true);
                try {
                  await updateUserData(user.uid, { onboardingComplete: false });
                  await refreshUserData();
                } finally {
                  setResettingOnboarding(false);
                }
              }}
              style={{
                width: '100%', padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 'bold',
                fontFamily: 'inherit', cursor: 'pointer',
                background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)',
                color: '#93c5fd'
              }}
            >
              {resettingOnboarding ? 'Opening…' : '🎓 Set Up My Curriculum'}
            </button>
          </div>
        )}

        {/* ── Organisation chip (shown independently of curriculum presence) ── */}
        {orgName && (
          <div style={{ marginBottom: 14 }}>
            <span style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 13,
              background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.35)',
              color: '#fb923c', display: 'inline-flex', alignItems: 'center', gap: 6
            }}>
              🏢 {orgName}
            </span>
          </div>
        )}

        {/* ── Arena Stats ── */}
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 'bold' }}>
            ⚔️ Battle Arena Record
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              { label: 'Wins',       value: arenaW,              color: '#10b981' },
              { label: 'Losses',     value: arenaL,              color: '#ef4444' },
              { label: 'Win Rate',   value: `${winRate}%`,       color: '#3b82f6' },
              { label: 'Best Streak',value: bestStreak,          color: '#f97316' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#0f172a', borderRadius: 10, padding: '10px 8px',
                textAlign: 'center', border: `1px solid ${s.color}33`
              }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {arenaTotal === 0 && (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 10 }}>
              No battles yet — visit the Arena to fight!
            </div>
          )}
        </div>

        {/* ── Badges ── */}
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 16px', marginBottom: 14, border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 'bold' }}>
            🎖️ Badges ({badges.length})
          </div>
          {badges.length === 0 ? (
            <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>
              No badges yet — keep playing to earn them!
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {badges.map(b => {
                const meta = BADGE_META[b] ?? { emoji: '🏅', name: b, desc: '' };
                const isHovered = hoveredBadge === b;
                return (
                  <div
                    key={b}
                    onMouseEnter={() => setHoveredBadge(b)}
                    onMouseLeave={() => setHoveredBadge(null)}
                    onClick={() => setHoveredBadge(isHovered ? null : b)}
                    style={{ position: 'relative', cursor: 'pointer' }}
                  >
                    <div style={{
                      background: isHovered ? 'rgba(59,130,246,0.2)' : 'rgba(30,41,59,0.8)',
                      border: `1px solid ${isHovered ? 'rgba(59,130,246,0.6)' : '#334155'}`,
                      borderRadius: 10, padding: '8px 12px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                      minWidth: 64, transition: 'all 0.15s'
                    }}>
                      <span style={{ fontSize: 24 }}>{meta.emoji}</span>
                      <span style={{ fontSize: 9, color: isHovered ? '#93c5fd' : '#64748b', textAlign: 'center', lineHeight: 1.2 }}>
                        {meta.name}
                      </span>
                    </div>
                    {isHovered && meta.desc && (
                      <div style={{
                        position: 'absolute', bottom: '110%', left: '50%', transform: 'translateX(-50%)',
                        background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 8,
                        padding: '6px 10px', fontSize: 11, color: '#93c5fd', whiteSpace: 'nowrap',
                        zIndex: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.5)', pointerEvents: 'none'
                      }}>
                        {meta.desc}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── High Scores ── */}
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 16px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
              🏆 Personal Best
            </div>
            <button
              onClick={() => setShowAllScores(v => !v)}
              style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                background: 'transparent', border: '1px solid #334155', color: '#64748b',
                fontFamily: 'inherit'
              }}
            >
              {showAllScores ? 'Show Played' : 'Show All'}
            </button>
          </div>

          {shownScores.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: '16px 0' }}>
              Play warmup games to set personal bests!
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {shownScores.map(({ id, label, icon, score, played }) => (
                <div key={id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: '#0f172a', borderRadius: 9, padding: '8px 10px',
                  border: played ? '1px solid #334155' : '1px solid #1e293b',
                  opacity: played ? 1 : 0.45
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 'bold', color: played ? '#fbbf24' : '#334155' }}>
                      {played ? (id === 'numGrid' ? `${score}s` : score.toLocaleString()) : '—'}
                    </div>
                  </div>
                  {played && (
                    <div style={{ flexShrink: 0 }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%', background: '#10b981'
                      }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
