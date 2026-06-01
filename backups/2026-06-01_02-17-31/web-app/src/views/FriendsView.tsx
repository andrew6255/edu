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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUnfriend, setPendingUnfriend] = useState<{ uid: string; username: string } | null>(null);
  const [unfriending, setUnfriending] = useState(false);

  useEffect(() => {
    loadFriends();
  }, [userData?.friends]);

  async function loadFriends() {
    if (!userData?.friends || userData.friends.length === 0) {
      setFriends([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const fData = await Promise.all(
        userData.friends.map(async (uid) => {
          try {
            const d = await getUserData(uid);
            if (!d) return { uid, username: 'Unknown', last_active: '' };
            return { uid, ...d };
          } catch {
            return { uid, username: 'Unknown', last_active: '' };
          }
        })
      );

      // sort by online status
      const today = new Date().toISOString().split('T')[0];
      fData.sort((a, b) => {
        const aOnline = a.last_active === today ? 1 : 0;
        const bOnline = b.last_active === today ? 1 : 0;
        return bOnline - aOnline;
      });
      setFriends(fData);
    } finally {
      setLoading(false);
    }
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
      const msg = e instanceof Error ? e.message : String(e);
      if ((msg || '').toLowerCase().includes('already friends')) {
        setMsg('✅ You are already friends');
      } else {
        setMsg(`❌ ${msg || 'Error sending request.'}`);
      }
    }
    setTimeout(() => setMsg(''), 3000);
    setSearch('');
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', padding: 20, overflowY: 'auto' }}>
      <h2 style={{ color: 'white', margin: '0 0 16px', fontSize: 22 }}>👥 Friends List</h2>

      {confirmOpen && pendingUnfriend && (
        <>
          <div
            onClick={() => { if (!unfriending) { setConfirmOpen(false); setPendingUnfriend(null); } }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1200 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 'min(420px, 92vw)', background: '#0b1220', border: '1px solid #334155',
            borderRadius: 16, padding: 18, zIndex: 1201, boxShadow: '0 20px 70px rgba(0,0,0,0.75)'
          }}>
            <div style={{ color: 'white', fontWeight: 'bold', fontSize: 16, marginBottom: 8 }}>
              Unfriend {pendingUnfriend.username}?
            </div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 16, lineHeight: 1.4 }}>
              This will remove you from each other's friends list.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="ll-btn"
                disabled={unfriending}
                onClick={() => { setConfirmOpen(false); setPendingUnfriend(null); }}
                style={{ flex: 1, padding: '10px', background: '#0f172a', border: '1px solid #334155', color: 'white' }}
              >
                Cancel
              </button>
              <button
                className="ll-btn ll-btn-danger"
                disabled={unfriending}
                onClick={async () => {
                  if (!user) return;
                  setUnfriending(true);
                  try {
                    await removeFriend(user.uid, pendingUnfriend.uid);
                    await refreshUserData();
                  } finally {
                    setUnfriending(false);
                    setConfirmOpen(false);
                    setPendingUnfriend(null);
                  }
                }}
                style={{ flex: 1, padding: '10px' }}
              >
                {unfriending ? 'Unfriending…' : 'Unfriend'}
              </button>
            </div>
          </div>
        </>
      )}
      
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
                  <button
                    onClick={() => {
                      if (!user) return;
                      setPendingUnfriend({ uid: f.uid, username: f.username || 'this user' });
                      setConfirmOpen(true);
                    }}
                    className="ll-btn"
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(239,68,68,0.1)',
                      borderColor: 'rgba(239,68,68,0.35)',
                      color: '#ef4444',
                      fontSize: 13
                    }}
                  >
                    Unfriend
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
