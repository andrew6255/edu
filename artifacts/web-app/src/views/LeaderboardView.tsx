import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, computeLevel } from '@/lib/userService';

type Tab = 'global' | 'arena' | 'weekly';

const MEDAL = ['🥇', '🥈', '🥉'];
const AVATAR_COLORS = [
  '#3b82f6', '#10b981', '#f97316', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f59e0b', '#ef4444'
];

function avatarColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = username.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function currentWeekStart(): string {
  const now = new Date();
  const diff = now.getDay() === 0 ? -6 : 1 - now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon.toISOString().split('T')[0];
}

interface Entry {
  uid: string;
  username: string;
  xp: number;
  arenaWins: number;
  weeklyXp: number;
  level: number;
  title: string;
}

function buildEntries(users: ReturnType<typeof Array.prototype.map>): Entry[] {
  const weekStart = currentWeekStart();
  return (users as Array<{
    uid: string; username?: string; firstName?: string; lastName?: string;
    economy?: { global_xp?: number }; arenaStats?: { wins?: number };
    last_active?: string;
  }>).map(u => {
    const xp = u.economy?.global_xp ?? 0;
    const { level, title } = computeLevel(xp);
    const lastActive = u.last_active ?? '';
    const weeklyXp = lastActive >= weekStart ? Math.min(xp, 500) : 0;
    return {
      uid: u.uid,
      username: u.username || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Unknown',
      xp,
      arenaWins: u.arenaStats?.wins ?? 0,
      weeklyXp,
      level,
      title,
    };
  });
}

function SkeletonRow() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 10, background: 'rgba(255,255,255,0.04)',
      border: '1px solid #1e293b', marginBottom: 6
    }}>
      <div style={{ width: 26, height: 16, borderRadius: 4, background: '#1e293b' }} />
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1e293b' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ height: 12, width: '55%', borderRadius: 4, background: '#1e293b' }} />
        <div style={{ height: 10, width: '35%', borderRadius: 4, background: '#1e293b' }} />
      </div>
      <div style={{ width: 50, height: 16, borderRadius: 4, background: '#1e293b' }} />
    </div>
  );
}

interface RowProps {
  rank: number;
  entry: Entry;
  isSelf: boolean;
  tab: Tab;
}

function LeaderboardRow({ rank, entry, isSelf, tab }: RowProps) {
  const color = avatarColor(entry.username);
  const score = tab === 'global' ? entry.xp : tab === 'arena' ? entry.arenaWins : entry.weeklyXp;
  const scoreUnit = tab === 'arena' ? 'Wins' : 'XP';
  const scoreColor = tab === 'arena' ? '#60a5fa' : '#fbbf24';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px', borderRadius: 10, marginBottom: 6,
      background: isSelf ? 'rgba(59,130,246,0.12)' : '#1e293b',
      border: isSelf ? '1px solid rgba(59,130,246,0.45)' : '1px solid #334155',
      transition: 'background 0.15s'
    }}>
      <div style={{ width: 28, textAlign: 'center', flexShrink: 0, fontSize: rank <= 3 ? 18 : 13, color: '#64748b', fontWeight: 'bold' }}>
        {rank <= 3 ? MEDAL[rank - 1] : rank}
      </div>
      <div style={{
        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
        background: `${color}30`, border: `2px solid ${color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 15, fontWeight: 'bold', color: 'white'
      }}>
        {entry.username[0]?.toUpperCase() ?? '?'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: isSelf ? '#93c5fd' : 'white', fontWeight: isSelf ? 'bold' : 'normal',
          fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {entry.username}
          {isSelf && <span style={{ color: '#64748b', fontSize: 11, fontWeight: 'normal' }}> (you)</span>}
        </div>
        <div style={{ color: '#64748b', fontSize: 11 }}>Lv.{entry.level} · {entry.title}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ color: scoreColor, fontWeight: 'bold', fontSize: 14 }}>{score.toLocaleString()}</div>
        <div style={{ color: '#475569', fontSize: 10 }}>{scoreUnit}</div>
      </div>
    </div>
  );
}

export default function LeaderboardView() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('global');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const users = await getAllUsers();
      setEntries(buildEntries(users));
      setLastFetched(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const myUid = user?.uid ?? '';

  const sortKey: keyof Entry = tab === 'global' ? 'xp' : tab === 'arena' ? 'arenaWins' : 'weeklyXp';
  const sorted = [...entries].sort((a, b) => b[sortKey] - a[sortKey]);
  const top50 = sorted.slice(0, 50);
  const selfInTop = top50.some(e => e.uid === myUid);
  const myRank = sorted.findIndex(e => e.uid === myUid) + 1;
  const myEntry = sorted.find(e => e.uid === myUid);

  const tabDefs: { id: Tab; icon: string; label: string }[] = [
    { id: 'global', icon: '🌐', label: 'Global XP' },
    { id: 'arena', icon: '⚔️', label: 'Arena' },
    { id: 'weekly', icon: '📅', label: 'Weekly' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h2 style={{ color: 'white', margin: 0, fontSize: 22, fontWeight: 'bold' }}>🏆 Leaderboard</h2>
            {lastFetched && (
              <div style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                Updated {lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            style={{
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 'bold',
              fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer',
              background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
              color: loading ? '#475569' : '#93c5fd', transition: '0.2s'
            }}
          >
            {loading ? '⏳' : '🔄 Refresh'}
          </button>
        </div>

        {/* Personal rank chips */}
        {!loading && myEntry && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold',
              background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#93c5fd'
            }}>
              🌐 Global #{myRank}
            </div>
            {myEntry.arenaWins > 0 && (
              <div style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold',
                background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa'
              }}>
                ⚔️ Arena #{sorted.findIndex(e => e.uid === myUid && tab === 'arena') + 1 || '—'}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: '#1e293b', borderRadius: 12, padding: 4 }}>
          {tabDefs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 'bold',
                fontFamily: 'inherit', border: 'none', cursor: 'pointer',
                background: tab === t.id ? '#0f172a' : 'transparent',
                color: tab === t.id ? 'white' : '#64748b',
                boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.5)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {loading ? (
          <div>
            {Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : top50.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#64748b' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>
              {tab === 'arena' ? '⚔️' : tab === 'weekly' ? '📅' : '🌐'}
            </div>
            <div style={{ fontWeight: 'bold', color: '#94a3b8', marginBottom: 6 }}>No entries yet</div>
            <div style={{ fontSize: 13 }}>
              {tab === 'arena' ? 'Start battling in the Arena to appear here!' : 'Keep earning XP to climb the ranks!'}
            </div>
          </div>
        ) : (
          <>
            {top50.map((e, i) => (
              <LeaderboardRow key={e.uid} rank={i + 1} entry={e} isSelf={e.uid === myUid} tab={tab} />
            ))}

            {/* Pinned "you" row when outside top 50 */}
            {!selfInTop && myEntry && myRank > 0 && (
              <div style={{
                position: 'sticky', bottom: 0, background: '#0f172a',
                paddingTop: 8, borderTop: '1px solid rgba(59,130,246,0.2)',
                marginTop: 4
              }}>
                <div style={{ color: '#475569', fontSize: 11, textAlign: 'center', marginBottom: 4 }}>
                  ··· Your ranking ···
                </div>
                <LeaderboardRow rank={myRank} entry={myEntry} isSelf tab={tab} />
              </div>
            )}

            {!selfInTop && !myEntry && (
              <div style={{ textAlign: 'center', paddingTop: 16, color: '#475569', fontSize: 12 }}>
                Play to earn XP and appear on the leaderboard!
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
