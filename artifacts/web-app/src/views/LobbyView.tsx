export default function LobbyView() {
  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: 'radial-gradient(ellipse at center, var(--ll-surface-1) 0%, var(--ll-surface-0) 100%)',
      color: 'var(--ll-text)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      position: 'relative', padding: '40px 20px'
    }}>
      <div style={{ textAlign: 'center', zIndex: 2 }}>
        <h1 style={{
          fontSize: 'clamp(28px, 6vw, 44px)', margin: '0 0 12px',
          color: '#f472b6', textShadow: '0 0 24px rgba(244,114,182,0.5)', letterSpacing: 2
        }}>
          THE LOBBY
        </h1>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏛️</div>
        <p style={{ color: 'var(--ll-text-muted)', fontSize: 16, margin: 0 }}>
          Welcome to the Lobby! New exciting features coming soon...
        </p>
      </div>

      {/* Decorative orbs */}
      <div style={{
        position: 'absolute', width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(244,114,182,0.05) 0%, transparent 60%)',
        top: '10%', left: '-10%', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(56,189,248,0.05) 0%, transparent 60%)',
        bottom: '-10%', right: '-10%', pointerEvents: 'none'
      }} />
    </div>
  );
}
