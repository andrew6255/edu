import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers, UserData, computeLevel } from '@/lib/userService';

type LBTab = 'global' | 'arena' | 'org';

const MEDAL = ['🥇', '🥈', '🥉'];

function avatarBg(username: string): string {
  const hue = ((username?.charCodeAt(0) || 65) * 137) % 360;
  return `hsl(${hue}, 55%, 35%)`;
}

interface LBEntry {
  uid: string;
  username: string;
  xp: number;
  arenaWins: number;
  role: string;
  orgId?: string;
}

export default function LeaderboardView() {
  const { userData, user } = useAuth();
  const [tab, setTab] = useState<LBTab>('global');
  const [entries, setEntries] = useState<LBEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAllUsers().then(users => {
      setEntries(
        users
          .filter(u => u.role === 'student' || u.role === 'teacher')
          .map(u => ({
            uid: u.uid,
            username: u.username || `${u.firstName} ${u.lastName}`,
            xp: u.economy?.global_xp || 0,
            arenaWins: u.arenaStats?.wins || 0,
            role: u.role,
            orgId: u.organisationId,
          }))
      );
      setLoading(false);
    });
  }, []);

  const byXP = [...entries].sort((a, b) => b.xp - a.xp).slice(0, 50);
  const byArena = [...entries].sort((a, b) => b.arenaWins - a.arenaWins).filter(e => e.arenaWins > 0).slice(0, 50);
  const byOrg = userData?.organisationId
    ? [...entries].filter(e => e.orgId === userData.organisationId).sort((a, b) => b.xp - a.xp)
    : [];

  const myUid = user?.uid;

  const lists: Record<LBTab, LBEntry[]> = { global: byXP, arena: byArena, org: byOrg };
  const active = lists[tab];

  const tabs: { id: LBTab; icon: string; label: string }[] = [
    { id: 'global', icon: '🌍', label: 'Global XP' },
    { id: 'arena', icon: '⚔️', label: 'Arena' },
    { id: 'org', icon: '🏢', label: 'My School' },
  ];

  function myRank(list: LBEntry[], key: 'xp' | 'arenaWins') {
    if (!myUid) return null;
    const sorted = [...list].sort((a, b) => b[key] - a[key]);
    const idx = sorted.findIndex(e => e.uid === myUid);
    return idx >= 0 ? idx + 1 : null;
  }

  const myGlobalRank = myRank(entries, 'xp');
  const myArenaRank = myRank(entries, 'arenaWins');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', flexShrink: 0 }}>
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 36, marginBottom: 4 }}>🏆</div>
          <h2 style={{ margin: 0, color: 'white', fontSize: 20, fontWeight: 'bold' }}>Leaderboards</h2>
          <p style={{ color: '#64748b', fontSize: 12, margin: '4px 0 0' }}>
            Top players across Logic Lords
          </p>
        </div>

        {/* My rank chips */}
        {!loading && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
            {myGlobalRank && (
              <div style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold',
                background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)', color: '#34d399'
              }}>
                🌍 Global Rank #{myGlobalRank}
              </div>
            )}
            {myArenaRank && (
              <div style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 'bold',
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171'
              }}>
                ⚔️ Arena Rank #{myArenaRank}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: '#1e293b', borderRadius: 12, padding: 4 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 9, fontSize: 12, fontWeight: 'bold',
                fontFamily: 'inherit', border: 'none', cursor: 'pointer',
                background: tab === t.id ? '#0f172a' : 'transparent',
                color: tab === t.id ? 'white' : '#64748b',
                boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
                transition: 'all 0.2s'
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
            <div>Loading rankings...</div>
          </div>
        ) : active.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>
              {tab === 'org' ? '🏢' : tab === 'arena' ? '⚔️' : '🌍'}
            </div>
            <div style={{ fontWeight: 'bold', color: '#94a3b8', marginBottom: 6 }}>
              {tab === 'org' ? 'Join an organisation to see your school ranking' : 'No entries yet'}
            </div>
            <div style={{ fontSize: 12 }}>
              {tab === 'arena' ? 'Start battling in the Arena to appear here!' : 'Keep earning XP to climb the ranks!'}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Top 3 podium */}
            {active.length >= 1 && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 10, padding: '0 4px' }}>
                {[1, 0, 2].map(i => {
                  const e = active[i];
                  if (!e) return <div key={i} style={{ flex: 1 }} />;
                  const isCenter = i === 0;
                  const isMe = e.uid === myUid;
                  const { level } = computeLevel(e.xp);
                  const value = tab === 'arena' ? `${e.arenaWins}W` : `${e.xp.toLocaleString()} XP`;
                  const podiumH = isCenter ? 90 : i === 1 ? 70 : 60;
                  const textColor = isCenter ? '#fbbf24' : i === 1 ? '#94a3b8' : '#b45309';
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: isCenter ? 20 : 16 }}>{MEDAL[i]}</div>
                      <div style={{
                        width: isCenter ? 44 : 34, height: isCenter ? 44 : 34, borderRadius: '50%',
                        background: avatarBg(e.username),
                        border: isMe ? '2px solid #3b82f6' : `2px solid ${textColor}66`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: isCenter ? 18 : 14, fontWeight: 'bold', color: 'white'
                      }}>
                        {e.username[0]?.toUpperCase()}
                      </div>
                      <div style={{ color: 'white', fontSize: 10, fontWeight: 'bold', textAlign: 'center', maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isMe ? '👑 You' : e.username}
                      </div>
                      <div style={{
                        width: '100%', height: podiumH,
                        background: isCenter ? 'linear-gradient(0deg, rgba(251,191,36,0.2), rgba(251,191,36,0.05))' : 'rgba(30,41,59,0.8)',
                        border: `1px solid ${textColor}44`, borderRadius: '8px 8px 0 0',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
                        paddingTop: 8, fontSize: 11, color: textColor, fontWeight: 'bold'
                      }}>
                        <div>{value}</div>
                        <div style={{ color: '#475569', fontSize: 9, marginTop: 2 }}>Lv.{level}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Rest of the list */}
            {active.slice(3).map((e, i) => {
              const rank = i + 4;
              const isMe = e.uid === myUid;
              const { level } = computeLevel(e.xp);
              const value = tab === 'arena' ? `${e.arenaWins}W` : `${e.xp.toLocaleString()}`;
              const suffix = tab === 'arena' ? '' : ' XP';

              return (
                <div key={e.uid} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: isMe ? 'rgba(59,130,246,0.1)' : '#1e293b',
                  border: isMe ? '1px solid rgba(59,130,246,0.4)' : '1px solid #334155',
                  borderRadius: 10, padding: '10px 12px'
                }}>
                  <div style={{
                    width: 26, flexShrink: 0, textAlign: 'center',
                    color: '#475569', fontSize: 12, fontWeight: 'bold'
                  }}>
                    {rank}
                  </div>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                    background: avatarBg(e.username),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 'bold', color: 'white',
                    border: isMe ? '2px solid #3b82f6' : 'none'
                  }}>
                    {e.username[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: isMe ? '#93c5fd' : 'white', fontSize: 13, fontWeight: isMe ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isMe ? '👑 ' : ''}{e.username}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 10 }}>Lv.{level}</div>
                  </div>
                  <div style={{ color: tab === 'arena' ? '#60a5fa' : '#10b981', fontWeight: 'bold', fontSize: 13, flexShrink: 0 }}>
                    {value}{suffix}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
