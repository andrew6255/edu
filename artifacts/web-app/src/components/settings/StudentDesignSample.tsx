import type { AppThemeDefinition } from '@/lib/appTheme';

export default function StudentDesignSample({
  theme,
  onClose,
  onUseTheme,
}: {
  theme: AppThemeDefinition;
  onClose: () => void;
  onUseTheme: () => void;
}) {
  const isLight = theme.id === 'minimal-focus' || theme.id === 'ocean-breeze';
  const textPrimary = isLight ? '#1f2937' : '#f8fafc';
  const textSecondary = isLight ? '#475569' : '#cbd5e1';
  const textMuted = isLight ? '#64748b' : '#94a3b8';
  const shellBg = theme.preview.background;
  const cardBg = theme.preview.card;
  const accent = theme.preview.accent;
  const accentSoft = theme.preview.accentSoft;
  const chromeBg = isLight ? 'rgba(255,255,255,0.72)' : 'rgba(15,23,42,0.55)';
  const borderSoft = isLight ? 'rgba(148,163,184,0.28)' : 'rgba(255,255,255,0.08)';
  const panelSoft = isLight ? 'rgba(148,163,184,0.10)' : 'rgba(255,255,255,0.04)';
  const panelSofter = isLight ? 'rgba(148,163,184,0.16)' : 'rgba(255,255,255,0.08)';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1700 }} />
      <div style={{
        position: 'fixed',
        inset: '3vh 2vw',
        zIndex: 1701,
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 32px 90px rgba(0,0,0,0.55)',
        border: '1px solid rgba(255,255,255,0.12)',
        background: shellBg,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 18px',
          background: chromeBg,
          borderBottom: `1px solid ${borderSoft}`,
          backdropFilter: 'blur(14px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ color: textPrimary, fontSize: 18, fontWeight: 1000 }}>⚔️ LOGIC LORDS</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { label: '🪙 24,580', color: '#f59e0b' },
                { label: '⚡ 84', color: accent },
                { label: '🔥 9', color: '#f97316' },
              ].map((item) => (
                <div key={item.label} style={{ padding: '6px 10px', borderRadius: 999, background: panelSoft, color: item.color, fontSize: 12, fontWeight: 1000 }}>
                  {item.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ color: textMuted, fontSize: 12, fontWeight: 900 }}>Student Preview</div>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: accent, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 1000 }}>
              A
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '18px 22px',
          background: chromeBg,
          borderBottom: `1px solid ${borderSoft}`,
          backdropFilter: 'blur(12px)',
        }}>
          <div>
            <div style={{ color: textPrimary, fontSize: 22, fontWeight: 1000 }}>{theme.label} Sample Page</div>
            <div style={{ color: textSecondary, fontSize: 13, marginTop: 4 }}>{theme.description}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onUseTheme}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: 'none',
                background: accent,
                color: theme.id === 'minimal-focus' ? '#ffffff' : isLight ? '#ffffff' : '#0f172a',
                fontWeight: 1000,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Use This Design
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: `1px solid ${isLight ? 'rgba(148,163,184,0.45)' : 'rgba(255,255,255,0.15)'}`,
                background: isLight ? 'rgba(255,255,255,0.65)' : 'rgba(15,23,42,0.48)',
                color: textPrimary,
                fontWeight: 1000,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Close Preview
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '280px 1fr',
            gap: 18,
            minHeight: '100%',
          }}>
            <div style={{
              borderRadius: 22,
              background: cardBg,
              border: `1px solid ${borderSoft}`,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
              <div style={{ color: textPrimary, fontWeight: 1000, fontSize: 18 }}>⚔️ Logic Lords</div>
              <div style={{ color: textSecondary, fontSize: 12 }}>Student navigation sample</div>
              {[
                'Universe',
                'Chrono Empires',
                'Classes',
                'Logic Games',
                'Profile',
              ].map((item, index) => (
                <div
                  key={item}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: index === 0 ? accent : panelSoft,
                    color: index === 0 ? '#ffffff' : textPrimary,
                    fontWeight: 900,
                    fontSize: 14,
                  }}
                >
                  {item}
                </div>
              ))}
              <div style={{ marginTop: 'auto', padding: 14, borderRadius: 16, background: accentSoft, color: isLight ? '#1f2937' : '#111827' }}>
                <div style={{ fontWeight: 1000, fontSize: 13 }}>Daily Goal</div>
                <div style={{ marginTop: 6, fontSize: 24, fontWeight: 1000 }}>18 min</div>
                <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>Preview card for student motivation</div>
              </div>
              <div style={{ padding: 14, borderRadius: 16, background: panelSoft }}>
                <div style={{ color: textPrimary, fontWeight: 1000, fontSize: 13 }}>Next Unlock</div>
                <div style={{ marginTop: 6, color: textSecondary, fontSize: 12 }}>Complete 2 more missions to unlock a bonus chest.</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{
                borderRadius: 22,
                background: `linear-gradient(135deg, ${accent}, ${accentSoft})`,
                padding: 22,
                color: '#ffffff',
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.9 }}>SAMPLE STUDENT HOME</div>
                <div style={{ marginTop: 8, fontSize: 28, fontWeight: 1000 }}>Welcome back, Explorer</div>
                <div style={{ marginTop: 8, fontSize: 14, maxWidth: 560, lineHeight: 1.6, opacity: 0.95 }}>
                  This preview shows how the student experience could look if this design becomes official.
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
                  {[
                    { label: 'XP', value: '12,480' },
                    { label: 'Streak', value: '9 days' },
                    { label: 'Energy', value: '84' },
                    { label: 'Class', value: 'Level 12' },
                  ].map((stat) => (
                    <div key={stat.label} style={{ padding: '10px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.18)', minWidth: 110 }}>
                      <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.86 }}>{stat.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 1000, marginTop: 4 }}>{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
                {[
                  { title: 'Warmup', icon: '⚡', body: 'Start a quick study burst and build streak energy.' },
                  { title: 'Program Map', icon: '🗺️', body: 'Continue your current mathematics path and mastery progress.' },
                  { title: 'Battle Pass', icon: '🎟️', body: 'Track your rewards and see the next free unlock tier.' },
                ].map((item) => (
                  <div key={item.title} style={{ borderRadius: 20, background: cardBg, border: `1px solid ${borderSoft}`, padding: 18 }}>
                    <div style={{ fontSize: 26 }}>{item.icon}</div>
                    <div style={{ color: textPrimary, fontSize: 16, fontWeight: 1000, marginTop: 10 }}>{item.title}</div>
                    <div style={{ color: textSecondary, fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>{item.body}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 18 }}>
                <div style={{
                  borderRadius: 22,
                  background: cardBg,
                  border: `1px solid ${borderSoft}`,
                  padding: 18,
                }}>
                  <div style={{ color: textPrimary, fontSize: 18, fontWeight: 1000 }}>Today's Missions</div>
                  <div style={{ color: textSecondary, fontSize: 12, marginTop: 4 }}>Example of tasks and progress styling</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                    {[
                      ['Warmup session', '80%'],
                      ['Math chapter practice', '45%'],
                      ['Study reminder target', '60%'],
                      ['Chrono milestone', '35%'],
                    ].map(([label, pct]) => (
                      <div key={label} style={{ padding: 14, borderRadius: 16, background: panelSoft }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ color: textPrimary, fontWeight: 900, fontSize: 14 }}>{label}</div>
                          <div style={{ color: accent, fontWeight: 1000, fontSize: 13 }}>{pct}</div>
                        </div>
                        <div style={{ marginTop: 10, height: 10, borderRadius: 999, background: panelSofter, overflow: 'hidden' }}>
                          <div style={{ width: pct, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${accent}, ${accentSoft})` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{
                  borderRadius: 22,
                  background: cardBg,
                  border: `1px solid ${borderSoft}`,
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}>
                  <div style={{ color: textPrimary, fontSize: 18, fontWeight: 1000 }}>Reward Chest</div>
                  <div style={{ color: textSecondary, fontSize: 12, marginTop: 4 }}>Example reward card styling</div>
                  <div style={{
                    borderRadius: 18,
                    background: `linear-gradient(145deg, ${accentSoft}, ${accent})`,
                    padding: 18,
                    color: '#ffffff',
                  }}>
                    <div style={{ fontSize: 36 }}>🎁</div>
                    <div style={{ fontWeight: 1000, fontSize: 16, marginTop: 8 }}>Daily Reward Ready</div>
                    <div style={{ fontSize: 12, marginTop: 6, opacity: 0.92 }}>Coins, gems, and one random card reward preview.</div>
                    <button style={{ marginTop: 14, width: '100%', padding: '10px 12px', borderRadius: 12, border: 'none', background: '#ffffff', color: '#111827', fontWeight: 1000, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Claim Sample Reward
                    </button>
                  </div>
                  <div style={{ padding: 14, borderRadius: 16, background: panelSoft }}>
                    <div style={{ color: textPrimary, fontSize: 13, fontWeight: 1000 }}>Live Reminder Example</div>
                    <div style={{ color: textSecondary, fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
                      “You are 7 minutes away from today’s study goal.”
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <div style={{
                  borderRadius: 22,
                  background: cardBg,
                  border: `1px solid ${borderSoft}`,
                  padding: 18,
                }}>
                  <div style={{ color: textPrimary, fontSize: 18, fontWeight: 1000 }}>Chrono Empires Snapshot</div>
                  <div style={{ color: textSecondary, fontSize: 12, marginTop: 4 }}>How a premium gameplay module could feel under this design.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
                    {[
                      { label: 'Board', value: '1200' },
                      { label: 'Gems', value: '1,240' },
                      { label: 'Pass Tier', value: '11' },
                      { label: 'Chest', value: 'Ready' },
                    ].map((item) => (
                      <div key={item.label} style={{ padding: 14, borderRadius: 16, background: panelSoft }}>
                        <div style={{ color: textMuted, fontSize: 11, fontWeight: 900 }}>{item.label}</div>
                        <div style={{ color: textPrimary, fontSize: 18, fontWeight: 1000, marginTop: 6 }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{
                  borderRadius: 22,
                  background: cardBg,
                  border: `1px solid ${borderSoft}`,
                  padding: 18,
                }}>
                  <div style={{ color: textPrimary, fontSize: 18, fontWeight: 1000 }}>Teacher & Class Feed</div>
                  <div style={{ color: textSecondary, fontSize: 12, marginTop: 4 }}>Example of cards, announcements, and class content in this design.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                    {[
                      'New assignment added for Algebra Program 3',
                      'Teacher praised your 9-day streak',
                      'Quiz review is ready to open',
                    ].map((item, index) => (
                      <div key={item} style={{ padding: 14, borderRadius: 16, background: panelSoft, display: 'flex', gap: 12, alignItems: 'center' }}>
                        <div style={{ width: 34, height: 34, borderRadius: 12, background: index === 0 ? accent : index === 1 ? accentSoft : '#10b981', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 1000 }}>
                          {index === 0 ? '📚' : index === 1 ? '🏆' : '📝'}
                        </div>
                        <div style={{ color: textPrimary, fontSize: 13, fontWeight: 900 }}>{item}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{
                borderRadius: 22,
                background: cardBg,
                border: `1px solid ${borderSoft}`,
                padding: 18,
              }}>
                <div style={{ color: textPrimary, fontSize: 18, fontWeight: 1000 }}>Bottom Navigation Sample</div>
                <div style={{ color: textSecondary, fontSize: 12, marginTop: 4 }}>How icons, buttons, and cards can feel under this design.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 16 }}>
                  {['🕰️', '⚡', '🌌', '🧩', '👤'].map((icon, index) => (
                    <div key={icon} style={{
                      borderRadius: 16,
                      padding: '14px 10px',
                      textAlign: 'center',
                      background: index === 2 ? accent : panelSoft,
                      color: index === 2 ? '#ffffff' : textPrimary,
                    }}>
                      <div style={{ fontSize: 22 }}>{icon}</div>
                      <div style={{ marginTop: 6, fontSize: 11, fontWeight: 900 }}>{['Empires', 'Warmup', 'Universe', 'Games', 'Profile'][index]}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
