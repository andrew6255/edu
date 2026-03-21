import { useAuth } from '@/contexts/AuthContext';
import { computeLevel } from '@/lib/userService';

const GAME_LABELS: Record<string, string> = {
  quickMath: 'Quick Math', timeLimit: 'Time Limit', numGrid: 'Number Grid',
  blockPuzzle: 'Block Puzzle', ticTacToe: 'Tic-Tac-Toe', advQuickMath: 'Advanced Math',
  compareExp: 'Compare Expressions', trueFalse: 'True or False', missingOp: 'Missing Op',
  fifteenPuzzle: '15 Puzzle', completeEq: 'Complete Equation', sequence: 'Sequence',
  memoOrder: 'Memo Order', pyramid: 'Number Pyramid', memoCells: 'Memo Cells',
  chessNameSurvival: 'Chess: Name (Survival)', chessNameSpeed: 'Chess: Name (Speed)',
  chessFindSurvival: 'Chess: Find (Survival)', chessFindSpeed: 'Chess: Find (Speed)',
  chessMemory: 'Chess Memory'
};

export default function ProfileView() {
  const { userData } = useAuth();

  if (!userData) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#64748b' }}>
      Loading profile...
    </div>
  );

  const xp = userData.economy?.global_xp ?? 0;
  const gold = userData.economy?.gold ?? 0;
  const streak = userData.economy?.streak ?? 0;
  const { level, title } = computeLevel(xp);
  const highScores = userData.high_scores ?? {};

  const topScores = Object.entries(highScores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  const badges = userData.inventory?.badges ?? [];

  const BADGE_EMOJIS: Record<string, string> = {
    badge_pioneer: '🚀', badge_streak_3: '🔥', badge_streak_7: '⚡',
    badge_streak_30: '💫', badge_hoarder: '💰', badge_fashionista: '👗',
    badge_gold_scholar: '🎓', badge_logic_lord: '👑', badge_boss_slayer: '🗡️',
    badge_flawless_5: '💎', badge_no_hints: '🧠'
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, paddingBottom: 30 }}>
      {/* Profile header */}
      <div style={{
        background: '#1e293b', borderRadius: 16, border: '2px solid #3b82f6',
        padding: 25, marginBottom: 20, textAlign: 'center',
        boxShadow: '0 0 30px rgba(59,130,246,0.2)', animation: 'fadeIn 0.4s ease'
      }}>
        <div style={{ fontSize: 60, marginBottom: 10 }}>🧙</div>
        <div style={{ fontSize: 28, fontWeight: 'bold', color: 'white' }}>{userData.username}</div>
        <div style={{ color: '#93c5fd', fontSize: 14, marginTop: 4 }}>
          Level {level} • {title}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 30, marginTop: 20 }}>
          <div>
            <div style={{ color: '#fbbf24', fontSize: 22, fontWeight: 'bold' }}>🪙 {gold.toLocaleString()}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>Gold</div>
          </div>
          <div>
            <div style={{ color: '#10b981', fontSize: 22, fontWeight: 'bold' }}>{xp.toLocaleString()}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>XP</div>
          </div>
          <div>
            <div style={{ color: '#f97316', fontSize: 22, fontWeight: 'bold' }}>🔥 {streak}</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>Day Streak</div>
          </div>
        </div>

        {/* XP bar */}
        <div style={{ marginTop: 15 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
            <span>{xp} XP</span><span>{level * 1000} XP to Level {level + 1}</span>
          </div>
          <div style={{ height: 10, background: '#0f172a', borderRadius: 5, overflow: 'hidden', border: '1px solid #334155' }}>
            <div style={{
              width: `${Math.min(100, (xp % 1000) / 10)}%`, height: '100%',
              background: 'linear-gradient(90deg, #3b82f6, #10b981)', transition: '0.5s'
            }} />
          </div>
        </div>
      </div>

      {/* Badges */}
      {badges.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: 16, border: '1px solid #334155', padding: 20, marginBottom: 20 }}>
          <h3 style={{ color: '#94a3b8', margin: '0 0 15px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 2 }}>
            🎖️ Badges Earned
          </h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {badges.map(b => (
              <div key={b} style={{
                background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 10, padding: '8px 14px', fontSize: 22
              }}>
                {BADGE_EMOJIS[b] ?? '🏅'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High scores */}
      {topScores.length > 0 && (
        <div style={{ background: '#1e293b', borderRadius: 16, border: '1px solid #334155', padding: 20 }}>
          <h3 style={{ color: '#94a3b8', margin: '0 0 15px', fontSize: 14, textTransform: 'uppercase', letterSpacing: 2 }}>
            🏆 Personal Best
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topScores.map(([id, score]) => (
              <div key={id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 15px', background: 'rgba(0,0,0,0.3)', borderRadius: 10,
                border: '1px solid #334155'
              }}>
                <span style={{ color: '#cbd5e1', fontSize: 14 }}>{GAME_LABELS[id] || id}</span>
                <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>
                  {id === 'numGrid' ? `${score}s` : score}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {topScores.length === 0 && badges.length === 0 && (
        <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 15 }}>🎯</div>
          <p>Play warmup games to earn badges and high scores!</p>
        </div>
      )}
    </div>
  );
}
