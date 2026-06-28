import { useState, useEffect } from 'react';

export default function GlobalLoadingScreen({ progress }: { progress?: number }) {
  const [showRefresh, setShowRefresh] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setShowRefresh(true), 10000); // 10s wait before showing refresh
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', width: '100vw', background: '#0f172a',
      color: 'white', position: 'fixed', top: 0, left: 0, zIndex: 9999,
      flexDirection: 'column',
    }}>
      <style>{`
        @keyframes pulseGlow {
          0% { box-shadow: 0 0 20px rgba(99, 102, 241, 0.4); transform: scale(1); }
          50% { box-shadow: 0 0 40px rgba(168, 85, 247, 0.7); transform: scale(1.05); }
          100% { box-shadow: 0 0 20px rgba(99, 102, 241, 0.4); transform: scale(1); }
        }
        @keyframes spinSlow {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeInSlide {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
      
      <div style={{
        position: 'relative', width: 100, height: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 32,
      }}>
        {/* Outer rotating ring */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          borderRadius: '50%',
          border: '4px solid transparent',
          borderTopColor: '#8b5cf6',
          borderRightColor: '#6366f1',
          animation: 'spinSlow 2s linear infinite',
        }} />
        
        {/* Inner pulsing circle */}
        <div style={{
          width: 70, height: 70, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #a855f7)',
          animation: 'pulseGlow 2s ease-in-out infinite',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32,
        }}>
          ⚔️
        </div>
      </div>

      <div style={{
        fontSize: 22, fontWeight: 800, letterSpacing: 2,
        background: 'linear-gradient(90deg, #818cf8, #c084fc)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        marginBottom: 12,
        animation: 'fadeInSlide 0.5s ease-out forwards',
      }}>
        LOADING REALM
      </div>

      <div style={{
        color: '#94a3b8', fontSize: 14, fontWeight: 500, letterSpacing: 1,
        animation: 'fadeInSlide 0.5s ease-out forwards', animationDelay: '0.2s', opacity: 0,
        marginBottom: 32,
      }}>
        Synchronizing your data...
      </div>

      {/* Progress Bar */}
      <div style={{ width: 240, height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden', animation: 'fadeInSlide 0.5s ease-out forwards', animationDelay: '0.3s', opacity: 0 }}>
        <div style={{
          width: progress !== undefined ? `${progress}%` : '100%',
          height: '100%',
          background: 'linear-gradient(90deg, #818cf8, #c084fc, #818cf8)',
          backgroundSize: '200% 100%',
          animation: progress === undefined ? 'shimmer 2s infinite linear' : 'none',
          transition: 'width 0.4s ease-out',
          borderRadius: 3,
        }} />
      </div>

      {showRefresh && (
        <div style={{
          marginTop: 40, animation: 'fadeInSlide 0.5s ease-out forwards',
          display: 'flex', flexDirection: 'column', alignItems: 'center'
        }}>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Taking longer than expected...</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', borderRadius: 12, fontSize: 13, fontWeight: 700,
              background: 'rgba(99,102,241,0.1)', color: '#a5b4fc',
              border: '1px solid rgba(99,102,241,0.3)', cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(99,102,241,0.2)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
          >
            Reload App
          </button>
        </div>
      )}
    </div>
  );
}
