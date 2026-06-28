const fs = require('fs');
const file = 'c:/Users/antoi/OneDrive/Desktop/edu/artifacts/web-app/src/views/LobbyView.tsx';
let content = fs.readFileSync(file, 'utf8');

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

const leftPanelIdx = content.indexOf(leftPanelStart);
const centerPanelIdx = content.indexOf(centerPanelStart);
const rightPanelIdx = content.indexOf(rightPanelStart);
const layoutEndIdx = content.lastIndexOf('</div>\n    </div>\n  );\n}');
const layoutStartIdx = content.lastIndexOf('      {/* Main 3-col layout */}', leftPanelIdx);

const leftPanelCode = content.substring(leftPanelIdx, centerPanelIdx).trimRight();
let centerPanelCode = content.substring(centerPanelIdx, rightPanelIdx).trimRight();
const rightPanelCode = content.substring(rightPanelIdx, layoutEndIdx).trimRight();

const vSlotsReplacement = `            <div style={{
              position: 'relative',
              width: 600,
              height: 280,
              flexShrink: 0,
            }}>`;
const vSlotsMobile = `            <div style={{
              position: isMobile ? 'static' : 'relative',
              width: isMobile ? '100%' : 600,
              height: isMobile ? 'auto' : 280,
              flexShrink: 0,
              display: isMobile ? 'flex' : 'block',
              flexWrap: isMobile ? 'wrap' : 'nowrap',
              justifyContent: isMobile ? 'center' : 'initial',
              gap: isMobile ? 16 : 0,
            }}>`;
centerPanelCode = centerPanelCode.replace(vSlotsReplacement, vSlotsMobile);

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
                    position: isMobile ? 'relative' : 'absolute',
                    left: isMobile ? 'auto' : left,
                    top: isMobile ? 'auto' : top,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  }}
                >`;
centerPanelCode = centerPanelCode.replace(slotPosReplacement, slotPosMobile);

const newLayout = `      {isMobile ? (
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
            {mobileTab === 'players' && (
${centerPanelCode}
            )}
            {mobileTab === 'game' && (
${leftPanelCode}
            )}
            {mobileTab === 'friends' && (
${rightPanelCode}
            )}
          </div>
        </>
      ) : (
        /* Main 3-col layout for Desktop */
        <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
${leftPanelCode}
${centerPanelCode}
${rightPanelCode}
        </div>
      )}`;

content = content.substring(0, layoutStartIdx) + newLayout + '\n    </div>\n  );\n}\n';
fs.writeFileSync(file, content, 'utf8');
console.log('Mobile layout injected successfully');
