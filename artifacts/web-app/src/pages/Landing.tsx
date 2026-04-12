import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { requireSupabase } from '@/lib/supabase';

export default function Landing() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#logout') {
      requireSupabase().auth.signOut();
      localStorage.clear();
      history.replaceState(null, '', ' ');
    }
  }, []);

  useEffect(() => {
    if (!loading && user) setLocation('/app');
  }, [user, loading]);

  return (
    <div style={{
      background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', textAlign: 'center', padding: '20px'
    }}>
      <div style={{ maxWidth: 800, animation: 'fadeIn 0.8s ease' }}>
        <div style={{ fontSize: 80, marginBottom: 20, textShadow: '0 0 30px rgba(59,130,246,0.5)', animation: 'pulse 3s infinite alternate' }}>
          🌌
        </div>
        <h1 style={{
          fontSize: 'clamp(36px, 8vw, 64px)', margin: '0 0 10px',
          textShadow: '0 0 20px rgba(59,130,246,0.5)', letterSpacing: 2,
          background: 'linear-gradient(135deg, #f8fafc, #93c5fd)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
        }}>
          LOGIC LORDS
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 'clamp(14px, 3vw, 18px)', lineHeight: 1.6, margin: '20px auto 40px', maxWidth: 550 }}>
          Standard curriculums transformed into living, breathing worlds. Your knowledge is your currency — mastery is the only way forward.
        </p>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="ll-btn"
            style={{ fontSize: 16, padding: '14px 36px' }}
            onClick={() => setLocation('/auth?mode=login')}
          >
            LOG IN
          </button>
          <button
            className="ll-btn ll-btn-primary"
            style={{ fontSize: 16, padding: '14px 36px' }}
            onClick={() => setLocation('/auth?mode=register')}
          >
            SIGN UP 🡢
          </button>
        </div>

        <div style={{ marginTop: 60, display: 'flex', gap: 30, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { icon: '⚔️', label: 'Battle Arena' },
            { icon: '🧠', label: 'Warmup Games' },
            { icon: '🗺️', label: 'Curriculum Maps' },
            { icon: '🏆', label: 'Leaderboards' }
          ].map(f => (
            <div key={f.label} style={{ textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{f.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>{f.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
