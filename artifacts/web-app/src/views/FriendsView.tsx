import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sendFriendRequest, getUserData, removeFriend } from '@/lib/userService';

export default function FriendsView() {
  const { user, userData, refreshUserData } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    loadFriends();
  }, [userData?.friends]);

  async function loadFriends() {
    if (!userData?.friends || userData.friends.length === 0) {
      setFriends([]);
      setLoading(false);
      return;
    }
    const fData = await Promise.all(userData.friends.map(uid => getUserData(uid).then(d => ({ uid, ...d }))));
    // sort by online status
    const today = new Date().toISOString().split('T')[0];
    fData.sort((a, b) => {
      const aOnline = a.last_active === today ? 1 : 0;
      const bOnline = b.last_active === today ? 1 : 0;
      return bOnline - aOnline;
    });
    setFriends(fData);
    setLoading(false);
  }

  async function handleAdd() {
    if (!search || !user || !userData) return;
    if (search.toLowerCase() === userData.username?.toLowerCase()) {
      setMsg("You can't add yourself!"); return;
    }
    setMsg('Sending request...');
    try {
      const ok = await sendFriendRequest(user.uid, userData.username || user.uid, search);
      setMsg(ok ? '✅ Friend request sent!' : '❌ User not found or request already sent.');
    } catch(e) {
      setMsg('❌ Error sending request.');
    }
    setTimeout(() => setMsg(''), 3000);
    setSearch('');
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', padding: 20, overflowY: 'auto' }}>
      <h2 style={{ color: 'white', margin: '0 0 16px', fontSize: 22 }}>👥 Friends List</h2>
      
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input 
          value={search} onChange={e => setSearch(e.target.value)} 
          placeholder="Add friend by username..." 
          style={{ flex: 1, padding: '12px 16px', borderRadius: 12, border: '1px solid #334155', background: '#1e293b', color: 'white', outline: 'none' }}
        />
        <button onClick={handleAdd} className="ll-btn ll-btn-primary" style={{ padding: '0 20px' }}>Add</button>
      </div>
      {msg && <div style={{ color: msg.startsWith('✅') ? '#10b981' : '#ef4444', marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      <div style={{ flex: 1 }}>
        {loading ? <div style={{ color: '#64748b' }}>Loading friends...</div> : friends.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>👻</div>
            <div>No friends yet. Add someone above!</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {friends.map(f => {
              const isOnline = f.last_active === today;
              return (
                <div key={f.uid} style={{ display: 'flex', alignItems: 'center', background: '#1e293b', padding: '12px 16px', borderRadius: 12, border: '1px solid #334155' }}>
                  <div style={{ position: 'relative', marginRight: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
                      {f.username?.[0]?.toUpperCase()}
                    </div>
                    <div style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: '50%', background: isOnline ? '#10b981' : '#64748b', border: '2px solid #1e293b' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'white', fontWeight: 'bold', fontSize: 15 }}>{f.username}</div>
                    <div style={{ color: isOnline ? '#10b981' : '#64748b', fontSize: 12 }}>{isOnline ? 'Online' : 'Offline'}</div>
                  </div>
                  <button onClick={async () => { await removeFriend(user!.uid, f.uid); await refreshUserData(); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18 }} title="Remove friend">×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
