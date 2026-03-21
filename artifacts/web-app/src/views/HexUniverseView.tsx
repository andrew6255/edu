interface HexUniverseViewProps {
  onSelectSubject: (subject: string) => void;
}

const SUBJECTS = [
  { id: 'math', label: 'Mathematics', icon: '∑', color: '#0ea5e9', desc: 'Numbers & Logic', locked: false },
  { id: 'physics', label: 'Physics', icon: '⚛', color: '#7e22ce', desc: 'Forces & Motion', locked: false },
  { id: 'chemistry', label: 'Chemistry', icon: '⚗', color: '#be185d', desc: 'Matter & Reactions', locked: false },
  { id: 'biology', label: 'Biology', icon: '🧬', color: '#15803d', desc: 'Life Sciences', locked: false },
  { id: 'compsci', label: 'Comp. Sci.', icon: '💻', color: '#b45309', desc: 'Algorithms & Code', locked: true },
  { id: 'history', label: 'History', icon: '📜', color: '#ca8a04', desc: 'Past & Present', locked: true },
];

const HEX_W = 130;
const HEX_H = 150;
const HEX_GAP_X = 100;
const HEX_GAP_Y = 75;

const HEX_POSITIONS = [
  { col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 },
  { col: 0, row: 1 }, { col: 1, row: 1 }, { col: 2, row: 1 },
];

export default function HexUniverseView({ onSelectSubject }: HexUniverseViewProps) {
  return (
    <div style={{
      height: '100%', overflow: 'auto',
      background: 'radial-gradient(ellipse at center, #1e293b 0%, #020617 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', position: 'relative', padding: 20
    }}>
      <div style={{ textAlign: 'center', marginBottom: 30, zIndex: 2 }}>
        <h1 style={{
          fontSize: 'clamp(24px, 5vw, 42px)', margin: '0 0 8px',
          color: '#c4b5fd', textShadow: '0 0 20px rgba(139,92,246,0.4)', letterSpacing: 2
        }}>
          KNOWLEDGE UNIVERSE
        </h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>Choose your domain to begin your journey</p>
      </div>

      {/* Hex grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '15px 10px',
        maxWidth: 480,
        width: '100%',
        padding: '0 10px'
      }}>
        {SUBJECTS.map((subj, i) => (
          <div
            key={subj.id}
            onClick={() => !subj.locked && onSelectSubject(subj.id)}
            style={{
              background: subj.locked ? 'rgba(71,85,105,0.3)' : `${subj.color}22`,
              border: `2px solid ${subj.locked ? '#475569' : subj.color}`,
              borderRadius: 16,
              padding: '20px 10px',
              textAlign: 'center',
              cursor: subj.locked ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s',
              opacity: subj.locked ? 0.5 : 1,
              filter: subj.locked ? 'grayscale(1)' : 'none',
              boxShadow: subj.locked ? 'none' : `0 0 20px ${subj.color}33`,
              animation: `fadeIn ${0.2 + i * 0.1}s ease`
            }}
            onMouseEnter={e => {
              if (!subj.locked) {
                const el = e.currentTarget;
                el.style.transform = 'scale(1.05) translateY(-4px)';
                el.style.boxShadow = `0 10px 30px ${subj.color}55`;
              }
            }}
            onMouseLeave={e => {
              const el = e.currentTarget;
              el.style.transform = '';
              el.style.boxShadow = subj.locked ? 'none' : `0 0 20px ${subj.color}33`;
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8, color: subj.locked ? '#475569' : subj.color }}>
              {subj.locked ? '🔒' : subj.icon}
            </div>
            <div style={{ fontWeight: 'bold', fontSize: 13, color: subj.locked ? '#64748b' : 'white', marginBottom: 4 }}>
              {subj.label}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{subj.desc}</div>
          </div>
        ))}
      </div>

      {/* Decorative orbs */}
      <div style={{
        position: 'absolute', width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(139,92,246,0.08) 0%, transparent 70%)',
        top: '10%', left: '5%', pointerEvents: 'none'
      }} />
      <div style={{
        position: 'absolute', width: 200, height: 200, borderRadius: '50%',
        background: 'radial-gradient(circle at center, rgba(59,130,246,0.08) 0%, transparent 70%)',
        bottom: '15%', right: '10%', pointerEvents: 'none'
      }} />
    </div>
  );
}
