const fs = require('fs');

const path = 'c:\\Users\\antoi\\OneDrive\\Desktop\\edu\\artifacts\\web-app\\src\\pages\\SuperAdminPage.tsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Remove auto-selection of node in load()
code = code.replace(/if \(!selectedNodeId && pub\.length > 0\) setSelectedNodeId\(pub\[0\]\.id\);\s*if \(selectedNodeId && pub\.every\(\(n\) => n\.id !== selectedNodeId\)\) \{\s*setSelectedNodeId\(pub\[0\]\?\.id \?\? null\);\s*\}/, '');

// 2. Change the layout
const mainLayoutRegex = /\{\/\* Main layout \*\/\}\s*<div style=\{\{ display: 'flex', gap: 16, flex: 1, minHeight: 0 \}\}>\s*\{\/\* Left Panel: Levels \*\/\}\s*<div style=\{\{ width: 320, display: 'flex', flexDirection: 'column', background: '#1e293b', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' \}\}>([\s\S]*?)<\/div>\s*\{\/\* Right Panel: Questions \*\/\}\s*<div style=\{\{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' \}\}>([\s\S]*?)<\/div>\s*<\/div>/;

const newLayout = `{/* Main layout */}
      <div style={{ display: 'flex', justifyContent: 'center', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {!selectedNodeId ? (
          <div style={{ width: '100%', maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ color: 'white', margin: 0 }}>Levels ({nodes.length})</h2>
              <button onClick={addNode} disabled={saving} className="ll-btn ll-btn-primary" style={{ padding: '10px 16px', fontSize: 13, fontWeight: 'bold' }}>
                + Add New Level
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
              {nodes.map((n) => (
                <div key={n.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 16 }}>{n.label}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ll-btn" title="Edit Name" onClick={(e) => { e.stopPropagation(); renameNode(n.id); }} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12 }}>✎</button>
                      <button className="ll-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 12, color: '#fca5a5' }}>🗑</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>IQ Threshold: <span style={{ color: '#d8b4fe', fontWeight: 'bold' }}>{n.iq}</span></div>
                  <button onClick={() => setSelectedNodeId(n.id)} className="ll-btn" style={{ marginTop: 'auto', padding: '8px', background: 'rgba(15,23,42,0.5)', border: '1px solid #475569', color: 'white', fontWeight: 'bold' }}>
                    Open Level ➔
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 1000, display: 'flex', flexDirection: 'column', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: 12, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => setSelectedNodeId(null)} className="ll-btn" style={{ padding: '6px 12px', fontSize: 13 }}>
                  ← Back
                </button>
                <div>
                  <div style={{ color: 'white', fontWeight: 900, fontSize: 16 }}>
                    {nodes.find(n => n.id === selectedNodeId)?.label}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{questions.length} questions</div>
                </div>
              </div>
              <button onClick={() => setAddModalOpen(true)} className="ll-btn ll-btn-primary" style={{ padding: '8px 16px', fontSize: 13, fontWeight: 'bold' }}>
                + Add Questions
              </button>
            </div>
            
$2
          </div>
        )}
      </div>`;

// We need to carefully replace the $2 which is the inside of the Questions panel.
// Wait, the original regex captured the inside of the Right Panel as $2. 
// But the right panel starts with:
/*
          {selectedNodeId ? (
             <>
               <div style={{ padding: 12, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}>
                  <div>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 14 }}>
                      {nodes.find(n => n.id === selectedNodeId)?.label} Questions
                    </div>
*/
// It's safer to just replace it manually. Let's do it cleanly by updating the file.
fs.writeFileSync('changeUI.cjs', \`
const fs = require('fs');
let code = fs.readFileSync('${path.replace(/\\/g, '\\\\')}', 'utf8');

// 1. Remove auto-selection
code = code.replace(/if \\(\\!selectedNodeId && pub\\.length > 0\\) setSelectedNodeId\\(pub\\[0\\]\\.id\\);\\s*if \\(selectedNodeId && pub\\.every\\(\\(n\\) => n\\.id !== selectedNodeId\\)\\) \\{\\s*setSelectedNodeId\\(pub\\[0\\]\\?\\.id \\?\\? null\\);\\s*\\}/, '');

const startIdx = code.indexOf('{/* Main layout */}');
const endIdx = code.indexOf('</>', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    const mainLayoutRegex = /\\{\\/\\* Main layout \\*\\/\\}[\\s\\S]*?\\{\\/\\* Right Panel: Questions \\*\\/\\}\\s*<div[^>]*>\\s*\\{selectedNodeId \\? \\(\\s*<>\\s*<div[^>]*>[\\s\\S]*?<\\/div>\\s*(<div style=\\{\\{ flex: 1, overflowY: 'auto', padding: 16 \\}\\}>)/;
    
    const match = code.match(mainLayoutRegex);
    if (match) {
        const replacement = \`{/* Main layout */}
      <div style={{ display: 'flex', justifyContent: 'center', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px' }}>
        {!selectedNodeId ? (
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: 16, borderRadius: 12, border: '1px solid #334155' }}>
              <div>
                <h2 style={{ color: 'white', margin: 0, fontSize: 20 }}>Levels Management</h2>
                <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{nodes.length} total levels available.</div>
              </div>
              <button onClick={addNode} disabled={saving} className="ll-btn ll-btn-primary" style={{ padding: '10px 20px', fontSize: 14, fontWeight: 'bold' }}>
                + Add New Level
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, paddingBottom: 40 }}>
              {nodes.map((n) => (
                <div key={n.id} style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>{n.label}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ll-btn" title="Edit Name" onClick={(e) => { e.stopPropagation(); renameNode(n.id); }} style={{ padding: '6px 10px', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.05)' }}>✎</button>
                      <button className="ll-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }} style={{ padding: '6px 10px', borderRadius: 8, fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}>🗑</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: '#94a3b8', background: '#0f172a', padding: '8px 12px', borderRadius: 8, display: 'inline-block', alignSelf: 'flex-start' }}>
                    IQ Threshold: <span style={{ color: '#d8b4fe', fontWeight: 'bold', marginLeft: 4 }}>{n.iq}</span>
                  </div>
                  <button onClick={() => setSelectedNodeId(n.id)} className="ll-btn" style={{ marginTop: 'auto', padding: '12px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#d8b4fe', fontWeight: 'bold', fontSize: 14, borderRadius: 8 }}>
                    Open Level ➔
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 1000, display: 'flex', flexDirection: 'column', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden', margin: '0 auto', height: '100%' }}>
            <div style={{ padding: 16, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <button onClick={() => setSelectedNodeId(null)} className="ll-btn" style={{ padding: '8px 14px', fontSize: 14, background: 'rgba(255,255,255,0.1)' }}>
                  ← Back to Levels
                </button>
                <div>
                  <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>
                    {nodes.find(n => n.id === selectedNodeId)?.label}
                  </div>
                  <div style={{ color: '#a855f7', fontSize: 13, fontWeight: 'bold' }}>{questions.length} questions</div>
                </div>
              </div>
              <button onClick={() => setAddModalOpen(true)} className="ll-btn ll-btn-primary" style={{ padding: '10px 20px', fontSize: 14, fontWeight: 'bold' }}>
                + Add Questions
              </button>
            </div>
            
            $1\`;
        
        code = code.replace(mainLayoutRegex, replacement);
        
        // Also need to remove the closing tags that belonged to the old layout
        // The old layout ended with:
        /*
               </div>
             </>
           ) : (
             <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
               Select a level to view questions
             </div>
           )}
         </div>
       </div>
        */
        const endLayoutRegex = /<\/>\s*\)\s*:\s*\(\s*<div[^>]*>\s*Select a level to view questions\s*<\/div>\s*\)\}\s*<\/div>\s*<\/div>/;
        code = code.replace(endLayoutRegex, '</div>)}</div>');

        fs.writeFileSync('${path.replace(/\\/g, '\\\\')}', code);
        console.log('UI updated successfully.');
    } else {
        console.log('Regex did not match.');
    }
}
\`);
