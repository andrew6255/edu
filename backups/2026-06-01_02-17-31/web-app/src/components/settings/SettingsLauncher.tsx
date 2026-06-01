import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import SettingsModal from '@/components/settings/SettingsModal';

export default function SettingsLauncher({ compact = false }: { compact?: boolean }) {
  const { user, userData, refreshUserData } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user || !userData) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          top: compact ? 14 : 18,
          right: compact ? 14 : 18,
          zIndex: 1500,
          padding: compact ? '8px 10px' : '10px 14px',
          borderRadius: 999,
          border: '1px solid rgba(148,163,184,0.25)',
          background: 'rgba(15,23,42,0.88)',
          color: 'white',
          fontSize: compact ? 12 : 13,
          fontWeight: 1000,
          cursor: 'pointer',
          boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
          fontFamily: 'inherit',
          backdropFilter: 'blur(10px)',
        }}
      >
        ⚙️ {compact ? '' : 'Settings'}
      </button>
      <SettingsModal
        open={open}
        onClose={() => setOpen(false)}
        uid={user.uid}
        userData={userData}
        onSaved={refreshUserData}
      />
    </>
  );
}
