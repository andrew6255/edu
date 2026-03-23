import { useState, useEffect } from 'react';
import { GameMode } from '@/types/warmup';
import { useAuth } from '@/contexts/AuthContext';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getUserData } from '@/lib/userService';

interface GameConfig {
  id: string;
  label: string;
  icon: string;
}

interface ModePickerProps {
  game: GameConfig;
  gameId: string;
  supportsVariants: boolean;
  variant: '10s' | '60s';
  onVariantChange: (v: '10s' | '60s') => void;
  onSelect: (mode: GameMode) => void;
  onBack: () => void;
}

const MODES = [
  { id: 'solo' as GameMode,   label: 'Solo Practice', icon: '🎯', desc: 'Play alone to set high scores', cost: null, color: '#10b981' },
  { id: 'ranked' as GameMode, label: 'Ranked Match',  icon: '⚔️', desc: 'Face a random opponent. Best of 5', cost: 25,   color: '#f97316' },
  { id: 'friend' as GameMode, label: 'Play a Friend', icon: '👥', desc: 'Challenge a friend directly.', cost: null, color: '#3b82f6' }
];

export default function ModePicker({ game, gameId, supportsVariants, variant, onVariantChange, onSelect, onBack }: ModePickerProps) {
  const { user, userData } = useAuth();
  const gold = userData?.economy?.gold ?? 0;
  
  const [leaderboardMode, setLeaderboardMode] = useState<'global' | 'friends'>('global');
  const [board, setBoard] = useState<{ uid: string, username: string, score: number }[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(true);

  const stats = userData?.rankedStats?.[gameId] || { wins: 0, losses: 0, highestStreak: 0 };
  const total = stats.wins + stats.losses;
  const winRate = total > 0 ? Math.round((stats.wins / total) * 100) : 0;

  useEffect(() => {
    loadLeaderboard();
  }, [leaderboardMode, gameId]);

  async function loadLeaderboard() {
    if (!user) return;
    setLoadingBoard(true);
    try {
      if (leaderboardMode === 'global') {
        const q = query(collection(db, 'users'), orderBy(`high_scores.${gameId}`, 'desc'), limit(10));
        const snap = await getDocs(q);
        const data = snap.docs.map(d => ({
          uid: d.id, username: d.data().username || 'Unknown', score: d.data().high_scores?.[gameId] || 0
        })).filter(x => x.score > 0);
        setBoard(data);
      } else {
        if (!userData?.friends || userData.friends.length === 0) {
          // Just me
          setBoard([{ uid: user.uid, username: userData?.username || 'You', score: userData?.high_scores?.[gameId] || 0 }].filter(x => x.score > 0));
        } else {
          // fetch friends + self
          const uids = [...userData.friends, user.uid];
          const fetched = await Promise.all(uids.map(async id => {
            const d = await getUserData(id);
            return { uid: id, username: d?.username || 'Unknown', score: d?.high_scores?.[gameId] || 0 };
          }));
          fetched.sort((a,b) => b.score - a.score);
          setBoard(fetched.filter(x => x.score > 0).slice(0, 10));
        }
      }
    } catch(e) {
      console.error("Board error:", e);
    }
    setLoadingBoard(false);
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', overflowY: 'auto' }}>
      
      {/* ── TOP NAV ── */}
      <div style={{ padding: '20px', position: 'relative', textAlign: 'center' }}>
        <button onClick={onBack} style={{
          position: 'absolute', top: 24, left: 16,
          background: 'none', border: 'none', color: '#64748b', fontSize: 14, cursor: 'pointer'
        }}>← Back</button>
        <div style={{ fontSize: 44, marginBottom: 8 }}>{game.icon}</div>
        <h2 style={{ margin: '0 0 4px', color: 'white', fontSize: 22 }}>{game.label}</h2>
      </div>

      {/* ── RANKED STATS ── */}
      <div style={{ padding: '0 20px 20px' }}>
        {supportsVariants && (
          <div style={{
            display: 'flex', justifyContent: 'center', padding: '0 0 14px'
          }}>
            <div style={{ display: 'flex', gap: 6, background: '#0f172a', padding: 6, borderRadius: 999, border: '1px solid #334155' }}>
              <button
                onClick={() => onVariantChange('10s')}
                style={{
                  background: variant === '10s' ? '#3b82f6' : 'transparent',
                  color: variant === '10s' ? 'white' : '#64748b',
                  border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12,
                  cursor: 'pointer', fontWeight: 'bold', fontFamily: 'inherit'
                }}
              >
                10s
              </button>
              <button
                onClick={() => onVariantChange('60s')}
                style={{
                  background: variant === '60s' ? '#3b82f6' : 'transparent',
                  color: variant === '60s' ? 'white' : '#64748b',
                  border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12,
                  cursor: 'pointer', fontWeight: 'bold', fontFamily: 'inherit'
                }}
              >
                60s
              </button>
            </div>
          </div>
        )}
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '14px 16px', border: '1px solid #334155' }}>
          <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12, fontWeight: 'bold' }}>
            ⚔️ Your Ranked Stats
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              { label: 'Wins',       value: stats.wins,          color: '#10b981' },
              { label: 'Losses',     value: stats.losses,        color: '#ef4444' },
              { label: 'Win Rate',   value: `${winRate}%`,       color: '#3b82f6' },
              { label: 'Best Streak',value: stats.highestStreak, color: '#f97316' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#0f172a', borderRadius: 10, padding: '10px 4px',
                textAlign: 'center', border: `1px solid ${s.color}33`
              }}>
                <div style={{ fontSize: 18, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                <div style={{ color: '#64748b', fontSize: 10, marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── MODES ── */}
      <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MODES.map(mode => {
          const canAfford = mode.cost === null || gold >= mode.cost;
          return (
            <div
              key={mode.id}
              onClick={() => canAfford && onSelect(mode.id)}
              style={{
                background: '#1e293b',
                border: `2px solid ${canAfford ? mode.color + '55' : '#334155'}`,
                borderRadius: 16, padding: '18px 20px',
                cursor: canAfford ? 'pointer' : 'not-allowed',
                opacity: canAfford ? 1 : 0.5,
                transition: '0.2s',
                display: 'flex', alignItems: 'center', gap: 16
              }}
              onMouseEnter={e => {
                if (canAfford) {
                  const el = e.currentTarget as HTMLDivElement;
                  el.style.borderColor = mode.color;
                  el.style.transform = 'translateY(-2px)';
                  el.style.boxShadow = `0 6px 20px ${mode.color}22`;
                }
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.borderColor = canAfford ? mode.color + '55' : '#334155';
                el.style.transform = '';
                el.style.boxShadow = '';
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                background: `${mode.color}20`, border: `1.5px solid ${mode.color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22
              }}>
                {mode.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', color: 'white', fontSize: 15, marginBottom: 3 }}>
                  {mode.label}
                </div>
                <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.4 }}>{mode.desc}</div>
                {!canAfford && (
                  <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>
                    Need {mode.cost} 🪙 gold — you have {gold}
                  </div>
                )}
              </div>
              {mode.cost !== null && canAfford && (
                <div style={{
                  background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)',
                  borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 'bold', color: '#fbbf24', flexShrink: 0
                }}>
                  {mode.cost} 🪙
                </div>
              )}
              {canAfford && (
                <div style={{ color: mode.color, fontSize: 20, flexShrink: 0 }}>›</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── LEADERBOARD ── */}
      <div style={{ padding: '0 20px 30px' }}>
        <div style={{ background: '#1e293b', borderRadius: 14, padding: '16px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' }}>
              🏆 Top 10 High Scores
            </div>
            <div style={{ display: 'flex', gap: 4, background: '#0f172a', padding: 4, borderRadius: 8, border: '1px solid #334155' }}>
              <button 
                onClick={() => setLeaderboardMode('global')}
                style={{
                  background: leaderboardMode === 'global' ? '#3b82f6' : 'transparent',
                  color: leaderboardMode === 'global' ? 'white' : '#64748b',
                  border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 'bold'
                }}
              >Global</button>
              <button 
                onClick={() => setLeaderboardMode('friends')}
                style={{
                  background: leaderboardMode === 'friends' ? '#3b82f6' : 'transparent',
                  color: leaderboardMode === 'friends' ? 'white' : '#64748b',
                  border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 'bold'
                }}
              >Friends</button>
            </div>
          </div>
          
          {loadingBoard ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '20px 0' }}>Loading ranks...</div>
          ) : board.length === 0 ? (
            <div style={{ color: '#475569', textAlign: 'center', padding: '20px 0', fontSize: 13 }}>
              No scores yet. Be the first!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {board.map((u, i) => (
                <div key={u.uid} style={{ 
                  display: 'flex', alignItems: 'center', background: '#0f172a', 
                  padding: '10px 14px', borderRadius: 8, border: '1px solid #334155' 
                }}>
                  <div style={{ width: 24, fontSize: 14, fontWeight: 'bold', color: i < 3 ? '#fbbf24' : '#64748b' }}>
                    #{i + 1}
                  </div>
                  <div style={{ flex: 1, color: u.uid === user?.uid ? '#3b82f6' : 'white', fontWeight: 'bold', fontSize: 14 }}>
                    {u.username} {u.uid === user?.uid && '(You)'}
                  </div>
                  <div style={{ color: '#10b981', fontWeight: 'bold', fontSize: 14 }}>
                    {game.id === 'numGrid' ? `${u.score}s` : u.score.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
    </div>
  );
}
