import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { respondToFriendRequest, AppNotification } from '@/lib/userService';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc } from 'firebase/firestore';

export default function NotificationsView() {
  const { user, refreshUserData } = useAuth();
  const [notifs, setNotifs] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `users/${user.uid}/notifications`), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setNotifs(snap.docs.map(d => d.data() as AppNotification));
    });
    return unsub;
  }, [user]);

  async function handleResponse(n: AppNotification, accept: boolean) {
    if (!user) return;
    await respondToFriendRequest(user.uid, n.fromUid, accept);
    await deleteDoc(doc(db, `users/${user.uid}/notifications`, n.id));
    await refreshUserData();
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', padding: 20, overflowY: 'auto' }}>
      <h2 style={{ color: 'white', margin: '0 0 16px', fontSize: 22 }}>🔔 Notifications</h2>
      
      {notifs.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#64748b', marginTop: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
          <div>You're all caught up!</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notifs.map(n => (
            <div key={n.id} style={{ background: '#1e293b', padding: '16px', borderRadius: 12, border: '1px solid #334155' }}>
              <div style={{ color: 'white', fontSize: 15, marginBottom: 8 }}>{n.message}</div>
              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 12 }}>{new Date(n.createdAt).toLocaleString()}</div>
              
              {n.type === 'friendRequest' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => handleResponse(n, true)} className="ll-btn ll-btn-primary" style={{ flex: 1, padding: '8px' }}>Accept</button>
                  <button onClick={() => handleResponse(n, false)} className="ll-btn" style={{ flex: 1, padding: '8px', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#ef4444' }}>Decline</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
