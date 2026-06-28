const fs = require('fs');
const file = 'c:/Users/antoi/OneDrive/Desktop/edu/artifacts/web-app/src/views/LobbyView.tsx';
let content = fs.readFileSync(file, 'utf8');

// Add states
content = content.replace(
  "  const [initializing, setInitializing] = useState(true);",
  `  const [initializing, setInitializing] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<'players' | 'game' | 'friends'>('players');

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);`
);

const leftPanelStart = `        {/* ── LEFT PANEL ───────────────────────────────────────────────────── */}`;
const centerPanelStart = `        {/* ── CENTER PANEL ─────────────────────────────────────────────────── */}`;
const rightPanelStart = `        {/* ── RIGHT PANEL ──────────────────────────────────────────────────── */}`;
const layoutEndIdx = content.lastIndexOf('      </div>\n    </div>\n  );\n}');

const leftPanelCode = content.substring(content.indexOf(leftPanelStart), content.indexOf(centerPanelStart));
const centerPanelCodeDesktop = content.substring(content.indexOf(centerPanelStart), content.indexOf(rightPanelStart));
const rightPanelCode = content.substring(content.indexOf(rightPanelStart), layoutEndIdx);

// For mobile center panel, replace the absolute slots container with flex container
const vSlotsReplacement = `            <div style={{
              position: 'relative',
              width: 600,
              height: 280,
              flexShrink: 0,
            }}>`;
const vSlotsMobile = `            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 16,
              width: '100%',
              padding: '20px 0',
            }}>`;
const slotPosReplacement = `                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left,
                    top,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >`;
const slotPosMobile = `                <div
                  key={i}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >`;
let centerPanelCodeMobile = centerPanelCodeDesktop.replace(vSlotsReplacement, vSlotsMobile);
centerPanelCodeMobile = centerPanelCodeMobile.replaceAll(slotPosReplacement, slotPosMobile); // replaceAll for all slots

const newRenderCode = `
  const renderLeftPanel = () => (
${leftPanelCode}
  );

  const renderCenterPanelDesktop = () => (
${centerPanelCodeDesktop}
  );

  const renderCenterPanelMobile = () => (
${centerPanelCodeMobile}
  );

  const renderRightPanel = () => (
${rightPanelCode}
  );

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.12) 0%, transparent 60%), #0f172a',
      color: 'var(--ll-text)', overflow: 'hidden', position: 'relative',
    }}>

      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0,
        background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(8px)',
        position: 'relative'
      }}>
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontSize: 14, fontWeight: 800, color: '#f472b6', letterSpacing: 1 }}>
          🏛️ THE LOBBY
        </div>
      </div>

      {isMobile ? (
        <>
          <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', flexShrink: 0, background: 'rgba(15,23,42,0.9)' }}>
            {(['players', 'game', 'friends'] as const).map(tab => (
              <button key={tab} onClick={() => setMobileTab(tab)}
                style={{
                  flex: 1, padding: '11px 4px', fontSize: 10, fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: 1,
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: mobileTab === tab ? '#a78bfa' : '#64748b',
                  borderBottom: \`2px solid \${mobileTab === tab ? '#a78bfa' : 'transparent'}\`,
                }}
              >
                {tab === 'players' ? '👥 Players' : tab === 'game' ? '🎮 Game' : '🤝 Friends'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            {mobileTab === 'players' && renderCenterPanelMobile()}
            {mobileTab === 'game' && renderLeftPanel()}
            {mobileTab === 'friends' && renderRightPanel()}
          </div>
        </>
      ) : (
        /* Main 3-col layout */
        <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
          {renderLeftPanel()}
          {renderCenterPanelDesktop()}
          {renderRightPanel()}
        </div>
      )}
    </div>
  );
}`;

content = content.substring(0, content.lastIndexOf('  return (\n')) + newRenderCode;
fs.writeFileSync(file, content, 'utf8');
