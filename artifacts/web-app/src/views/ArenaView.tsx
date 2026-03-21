import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updateEconomy, updateUserData, computeLevel, getAllUsers } from '@/lib/userService';
import BattleScreen, { BattleStats } from './arena/BattleScreen';
import { Difficulty } from '@/lib/questionGenerator';

interface Enemy {
  id: string;
  name: string;
  title: string;
  avatar: string;
  color: string;
  difficulty: Difficulty;
  counterDmg: [number, number];
  xpReward: number;
  goldReward: number;
  description: string;
}

const ENEMIES: Enemy[] = [
  {
    id: 'circuit_bot', name: 'Circuit Bot', title: 'The Rookie Challenger',
    avatar: '🤖', color: '#60a5fa', difficulty: 'easy',
    counterDmg: [8, 14], xpReward: 80, goldReward: 50,
    description: 'A basic training AI. Good for warming up!'
  },
  {
    id: 'scholar_mage', name: 'Scholar Mage', title: 'The Arcane Mathematician',
    avatar: '🧙', color: '#a78bfa', difficulty: 'medium',
    counterDmg: [14, 20], xpReward: 180, goldReward: 120,
    description: 'An ancient spellcaster. Requires solid arithmetic skills.'
  },
  {
    id: 'logic_drake', name: 'Logic Drake', title: 'The Algebraic Beast',
    avatar: '🐉', color: '#f97316', difficulty: 'hard',
    counterDmg: [20, 28], xpReward: 350, goldReward: 250,
    description: 'A fearsome dragon. Solves algebra in its sleep.'
  },
  {
    id: 'logic_lord', name: 'Logic Lord', title: 'The Eternal Master',
    avatar: '👑', color: '#fbbf24', difficulty: 'boss',
    counterDmg: [28, 38], xpReward: 700, goldReward: 500,
    description: 'The ultimate challenge. Only the worthy may face the Logic Lord.'
  }
];

const DIFF_LABELS: Record<Difficulty, { label: string; color: string }> = {
  easy: { label: 'EASY', color: '#10b981' },
  medium: { label: 'MEDIUM', color: '#3b82f6' },
  hard: { label: 'HARD', color: '#f97316' },
  boss: { label: 'BOSS', color: '#fbbf24' }
};

export default function ArenaView() {
  const { user, userData, refreshUserData } = useAuth();
  const [screen, setScreen] = useState<'hub' | 'battle' | 'result'>('hub');
  const [selectedEnemy, setSelectedEnemy] = useState<Enemy | null>(null);
  const [lastResult, setLastResult] = useState<{ won: boolean; xp: number; gold: number; stats: BattleStats } | null>(null);
  const [arenaStats, setArenaStats] = useState({ wins: 0, losses: 0 });
  const [leaderboard, setLeaderboard] = useState<Array<{ username: string; wins: number; xp: number }>>([]);
  const [loadingLb, setLoadingLb] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(`arena_stats_${user?.uid}`);
    if (saved) setArenaStats(JSON.parse(saved));
    loadLeaderboard();
  }, [user]);

  async function loadLeaderboard() {
    setLoadingLb(true);
    try {
      const users = await getAllUsers();
      const sorted = users
        .map(u => ({
          username: u.username || `${u.firstName} ${u.lastName}`,
          wins: parseInt(localStorage.getItem(`arena_stats_${u.uid}`) ? JSON.parse(localStorage.getItem(`arena_stats_${u.uid}`)!).wins : '0') || 0,
          xp: u.economy?.global_xp || 0
        }))
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 10);
      setLeaderboard(sorted);
    } finally {
      setLoadingLb(false);
    }
  }

  async function handleBattleComplete(won: boolean, xp: number, gold: number, stats: BattleStats) {
    if (!user) return;

    await updateEconomy(user.uid, gold, xp);

    const newStats = {
      wins: arenaStats.wins + (won ? 1 : 0),
      losses: arenaStats.losses + (won ? 0 : 1)
    };
    setArenaStats(newStats);
    localStorage.setItem(`arena_stats_${user.uid}`, JSON.stringify(newStats));

    await refreshUserData();
    setLastResult({ won, xp, gold, stats });
    setScreen('result');
  }

  function handleFlee() {
    const newStats = { ...arenaStats, losses: arenaStats.losses + 1 };
    setArenaStats(newStats);
    localStorage.setItem(`arena_stats_${user?.uid}`, JSON.stringify(newStats));
    setScreen('hub');
    setSelectedEnemy(null);
  }

  const winRate = arenaStats.wins + arenaStats.losses > 0
    ? Math.round((arenaStats.wins / (arenaStats.wins + arenaStats.losses)) * 100)
    : 0;

  const { level } = computeLevel(userData?.economy?.global_xp || 0);

  if (screen === 'battle' && selectedEnemy) {
    return (
      <BattleScreen
        enemy={selectedEnemy}
        onComplete={handleBattleComplete}
        onFlee={handleFlee}
      />
    );
  }

  if (screen === 'result' && lastResult) {
    const { won, xp, gold, stats } = lastResult;
    const accuracy = stats.totalQuestions > 0 ? Math.round((stats.correct / stats.totalQuestions) * 100) : 0;
    return (
      <div style={{
        height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 30, gap: 20,
        background: won
          ? 'radial-gradient(circle, rgba(251,191,36,0.08) 0%, #0f172a 70%)'
          : 'radial-gradient(circle, rgba(239,68,68,0.08) 0%, #0f172a 70%)',
        animation: 'fadeIn 0.5s ease'
      }}>
        <div style={{ fontSize: 90 }}>{won ? '🏆' : '💀'}</div>
        <h1 style={{
          margin: 0, fontSize: 40, letterSpacing: 4, fontWeight: 'black',
          color: won ? '#fbbf24' : '#ef4444',
          textShadow: `0 0 30px ${won ? '#fbbf24' : '#ef4444'}`
        }}>
          {won ? 'VICTORY!' : 'DEFEATED'}
        </h1>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, width: '100%', maxWidth: 360
        }}>
          {[
            { label: 'Accuracy', value: `${accuracy}%`, icon: '🎯', color: accuracy > 70 ? '#10b981' : '#fbbf24' },
            { label: 'Correct', value: `${stats.correct}/${stats.totalQuestions}`, icon: '✅', color: '#10b981' },
            { label: 'Dmg Dealt', value: stats.damageDealt, icon: '⚔️', color: '#3b82f6' },
            { label: 'Dmg Taken', value: stats.damageTaken, icon: '🛡️', color: '#f97316' },
          ].map(s => (
            <div key={s.label} style={{ background: '#1e293b', borderRadius: 12, padding: '14px', textAlign: 'center', border: '1px solid #334155' }}>
              <div style={{ fontSize: 22, marginBottom: 5 }}>{s.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              <div style={{ color: '#64748b', fontSize: 12 }}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#1e293b', borderRadius: 12, padding: '16px 24px', border: '1px solid #334155', textAlign: 'center', width: '100%', maxWidth: 360 }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>
            <span style={{ color: '#10b981', fontWeight: 'bold' }}>+{xp} XP</span>
            {'  '}
            <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>+{gold} 🪙</span>
          </div>
          <div style={{ color: '#64748b', fontSize: 13 }}>
            Season record: <strong style={{ color: 'white' }}>{arenaStats.wins}W / {arenaStats.losses}L</strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360 }}>
          <button
            className="ll-btn ll-btn-primary"
            style={{ flex: 1, padding: '14px' }}
            onClick={() => {
              setScreen('battle');
            }}
          >
            ⚔️ Rematch
          </button>
          <button
            className="ll-btn"
            style={{ flex: 1, padding: '14px' }}
            onClick={() => { setScreen('hub'); setSelectedEnemy(null); setLastResult(null); }}
          >
            🏟️ Arena
          </button>
        </div>
      </div>
    );
  }

  // Hub
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 16px 20px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 40, marginBottom: 6 }}>⚔️</div>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 'bold', color: 'white', letterSpacing: 2 }}>BATTLE ARENA</h2>
        <p style={{ color: '#64748b', fontSize: 13, margin: '6px 0 0' }}>Answer questions to defeat your enemies</p>
      </div>

      {/* Player stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 20
      }}>
        {[
          { label: 'Victories', value: arenaStats.wins, icon: '🏆', color: '#fbbf24' },
          { label: 'Defeats', value: arenaStats.losses, icon: '💀', color: '#ef4444' },
          { label: 'Win Rate', value: `${winRate}%`, icon: '📊', color: '#10b981' },
        ].map(s => (
          <div key={s.label} style={{ background: '#1e293b', borderRadius: 12, padding: '12px 8px', textAlign: 'center', border: '1px solid #334155' }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
            <div style={{ color: '#64748b', fontSize: 11 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Choose opponent */}
      <h3 style={{ color: '#94a3b8', fontSize: 14, fontWeight: 'bold', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: 1 }}>
        Choose Your Opponent
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {ENEMIES.map(enemy => {
          const diff = DIFF_LABELS[enemy.difficulty];
          const isLocked = enemy.difficulty === 'hard' && level < 5
            || enemy.difficulty === 'boss' && level < 8;
          return (
            <div key={enemy.id} style={{
              background: '#1e293b', borderRadius: 14, padding: '16px',
              border: `1px solid ${isLocked ? '#334155' : enemy.color + '44'}`,
              opacity: isLocked ? 0.6 : 1,
              boxShadow: isLocked ? 'none' : `0 0 15px ${enemy.color}11`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ fontSize: 52, flexShrink: 0, filter: isLocked ? 'grayscale(1)' : 'none' }}>
                  {isLocked ? '🔒' : enemy.avatar}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 'bold', color: 'white', fontSize: 16 }}>{enemy.name}</span>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 5, fontWeight: 'bold',
                      background: `${diff.color}22`, border: `1px solid ${diff.color}55`, color: diff.color
                    }}>
                      {diff.label}
                    </span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>{enemy.title}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>
                    {isLocked
                      ? `🔒 Requires Level ${enemy.difficulty === 'hard' ? 5 : 8}`
                      : enemy.description}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ color: '#10b981', fontSize: 13, fontWeight: 'bold', marginBottom: 4 }}>+{enemy.xpReward} XP</div>
                  <div style={{ color: '#fbbf24', fontSize: 12 }}>+{enemy.goldReward} 🪙</div>
                  <button
                    disabled={isLocked}
                    onClick={() => { setSelectedEnemy(enemy); setScreen('battle'); }}
                    style={{
                      marginTop: 8, padding: '8px 16px', borderRadius: 8, fontSize: 13,
                      fontWeight: 'bold', fontFamily: 'inherit', cursor: isLocked ? 'not-allowed' : 'pointer',
                      background: isLocked ? 'rgba(71,85,105,0.3)' : `${enemy.color}22`,
                      border: `1px solid ${isLocked ? '#334155' : enemy.color + '66'}`,
                      color: isLocked ? '#475569' : enemy.color
                    }}
                  >
                    {isLocked ? 'Locked' : 'FIGHT ⚔️'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Leaderboard */}
      <h3 style={{ color: '#94a3b8', fontSize: 14, fontWeight: 'bold', margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: 1 }}>
        🏆 XP Leaderboard
      </h3>
      <div style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', overflow: 'hidden' }}>
        {loadingLb ? (
          <div style={{ color: '#64748b', padding: '20px', textAlign: 'center', fontSize: 14 }}>Loading...</div>
        ) : leaderboard.length === 0 ? (
          <div style={{ color: '#64748b', padding: '20px', textAlign: 'center', fontSize: 14 }}>No players yet.</div>
        ) : (
          leaderboard.map((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
            const isMe = p.username === userData?.username;
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                borderBottom: i < leaderboard.length - 1 ? '1px solid #334155' : 'none',
                background: isMe ? 'rgba(59,130,246,0.07)' : 'transparent'
              }}>
                <span style={{ fontSize: 16, width: 28, textAlign: 'center' }}>{medal}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: isMe ? 'bold' : 'normal', color: isMe ? '#93c5fd' : 'white', fontSize: 14 }}>
                    {p.username} {isMe ? '(you)' : ''}
                  </span>
                </div>
                <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: 14 }}>{p.xp.toLocaleString()} XP</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
