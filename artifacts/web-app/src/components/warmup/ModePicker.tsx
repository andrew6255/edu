import { GameMode } from '@/types/warmup';
import { useAuth } from '@/contexts/AuthContext';

interface GameConfig {
  id: string;
  label: string;
  icon: string;
}

interface ModePickerProps {
  game: GameConfig;
  onSelect: (mode: GameMode) => void;
  onBack: () => void;
}

const MODES = [
  {
    id: 'solo' as GameMode,
    label: 'Solo Practice',
    icon: '🎯',
    desc: 'Play alone and compete for the Top 5 leaderboard',
    cost: null,
    color: '#10b981'
  },
  {
    id: 'ranked' as GameMode,
    label: 'Ranked',
    icon: '⚔️',
    desc: 'Enter matchmaking and face a random opponent. Best of 5 rounds.',
    cost: 25,
    color: '#f97316'
  },
  {
    id: 'friend' as GameMode,
    label: 'Play a Friend',
    icon: '👥',
    desc: 'Challenge a friend by username. Best of 5 rounds.',
    cost: null,
    color: '#3b82f6'
  }
];

export default function ModePicker({ game, onSelect, onBack }: ModePickerProps) {
  const { userData } = useAuth();
  const gold = userData?.economy?.gold ?? 0;

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px 20px', gap: 20
    }}>
      <button onClick={onBack} style={{
        position: 'absolute', top: 16, left: 16,
        background: 'none', border: 'none', color: '#64748b', fontSize: 14, cursor: 'pointer'
      }}>← Back</button>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>{game.icon}</div>
        <h2 style={{ margin: '0 0 4px', color: 'white', fontSize: 22 }}>{game.label}</h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: 13 }}>Choose a mode to play</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 360 }}>
        {MODES.map(mode => {
          const canAfford = mode.cost === null || gold >= mode.cost;
          return (
            <div
              key={mode.id}
              onClick={() => canAfford && onSelect(mode.id)}
              style={{
                background: '#1e293b',
                border: `2px solid ${canAfford ? mode.color + '55' : '#334155'}`,
                borderRadius: 16, padding: '18px 20px',
                cursor: canAfford ? 'pointer' : 'not-allowed',
                opacity: canAfford ? 1 : 0.5,
                transition: '0.2s',
                display: 'flex', alignItems: 'center', gap: 16
              }}
              onMouseEnter={e => {
                if (canAfford) {
                  (e.currentTarget as HTMLDivElement).style.borderColor = mode.color;
                  (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `0 6px 20px ${mode.color}22`;
                }
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.borderColor = canAfford ? mode.color + '55' : '#334155';
                (e.currentTarget as HTMLDivElement).style.transform = '';
                (e.currentTarget as HTMLDivElement).style.boxShadow = '';
              }}
            >
              <div style={{
                width: 48, height: 48, borderRadius: 12, flexShrink: 0,
                background: `${mode.color}20`, border: `1.5px solid ${mode.color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22
              }}>
                {mode.icon}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', color: 'white', fontSize: 15, marginBottom: 3 }}>
                  {mode.label}
                </div>
                <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.4 }}>{mode.desc}</div>
                {!canAfford && (
                  <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }}>
                    Need {mode.cost} 🪙 gold — you have {gold}
                  </div>
                )}
              </div>
              {mode.cost !== null && canAfford && (
                <div style={{
                  background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)',
                  borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 'bold', color: '#fbbf24', flexShrink: 0
                }}>
                  {mode.cost} 🪙
                </div>
              )}
              {canAfford && (
                <div style={{ color: mode.color, fontSize: 20, flexShrink: 0 }}>›</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ color: '#475569', fontSize: 12, textAlign: 'center' }}>
        Your gold: <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>{gold} 🪙</span>
      </div>
    </div>
  );
}
