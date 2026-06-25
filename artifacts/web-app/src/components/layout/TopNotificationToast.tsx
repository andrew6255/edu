import React, { useEffect, useState } from 'react';
import type { AppNotification } from '@/lib/userService';

interface Props {
  notification: AppNotification;
  onAccept?: (n: AppNotification) => void;
  onDismiss: (n: AppNotification) => void;
}

export default function TopNotificationToast({ notification, onAccept, onDismiss }: Props) {
  const [animatingOut, setAnimatingOut] = useState(false);

  useEffect(() => {
    // Automatically dismiss after 5 seconds
    const timer = setTimeout(() => {
      setAnimatingOut(true);
      setTimeout(() => onDismiss(notification), 300); // Wait for fade out
    }, 5000);

    return () => clearTimeout(timer);
  }, [notification, onDismiss]);

  const isActionable = 
    notification.type === 'friendRequest' ||
    notification.type === 'challenge' ||
    notification.type === 'lobbyInvite' ||
    notification.type === 'lobbyJoinRequest';

  const handleAccept = () => {
    if (onAccept) onAccept(notification);
    setAnimatingOut(true);
    setTimeout(() => onDismiss(notification), 300);
  };

  const handleClose = () => {
    setAnimatingOut(true);
    setTimeout(() => onDismiss(notification), 300);
  };

  const title = 
    notification.type === 'friendRequest' ? 'Friend Request' : 
    notification.type === 'lobbyJoinRequest' ? 'Party Request' :
    notification.type === 'lobbyInvite' ? 'Party Invite' :
    notification.type === 'challenge' ? 'Game Challenge' : 'Notification';

  return (
    <div style={{
      position: 'absolute',
      top: 60,
      right: 16,
      width: 320,
      background: 'rgba(15, 23, 42, 0.95)',
      backdropFilter: 'blur(8px)',
      border: '1px solid #334155',
      borderRadius: 12,
      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transform: animatingOut ? 'translateX(120%)' : 'translateX(0)',
      opacity: animatingOut ? 0 : 1,
      transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease',
    }}>
      <div style={{ padding: '12px 16px', position: 'relative' }}>
        <button 
          onClick={handleClose}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'transparent', border: 'none', color: '#64748b',
            cursor: 'pointer', fontSize: 16, width: 24, height: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%'
          }}
        >
          ×
        </button>
        
        <div style={{ fontSize: 12, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: 'white', lineHeight: 1.4, paddingRight: 16 }}>
          {notification.message}
        </div>
        
        {isActionable && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={handleAccept}
              className="ll-btn ll-btn-primary"
              style={{
                width: '100%',
                padding: '8px',
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 6
              }}
            >
              Accept
            </button>
          </div>
        )}
      </div>

      {/* Timer Bar */}
      <div style={{
        height: 3,
        background: 'rgba(167, 139, 250, 0.3)',
        width: '100%'
      }}>
        <div style={{
          height: '100%',
          background: '#a78bfa',
          animation: 'll-shrink-width 5s linear forwards'
        }} />
      </div>
    </div>
  );
}
