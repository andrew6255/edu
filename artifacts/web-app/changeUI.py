import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove auto-selection
code = re.sub(
    r"if \(!selectedNodeId && pub\.length > 0\) setSelectedNodeId\(pub\[0\]\.id\);\s*if \(selectedNodeId && pub\.every\(\(n\) => n\.id !== selectedNodeId\)\) \{\s*setSelectedNodeId\(pub\[0\]\?\.id \?\? null\);\s*\}",
    "",
    code
)

# 2. Re-arrange layout
# We will match the entire 'Main layout' div to the end of LogicGamesAdmin
start_idx = code.find("{/* Main layout */}")
end_idx = code.find("  );\n}\n\n\nfunction ProgramsAdmin()")

if start_idx == -1 or end_idx == -1:
    print("Could not find boundaries")
    exit(1)

layout_str = code[start_idx:end_idx]

# Inside layout_str, we need to extract the exact `questionsList` logic, which is the contents of `<div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>` 
# up to the end of the `selectedNodeId` truthy block `</>`
questions_block_start = layout_str.find("<div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>")
if questions_block_start == -1:
    print("Could not find questions block start")
    exit(1)

questions_block_end = layout_str.find("</>\n          ) : (")
if questions_block_end == -1:
    # Alternative match if formatted slightly differently
    questions_block_end = layout_str.find("</>\n           ) : (")

if questions_block_end == -1:
    print("Could not find questions block end")
    exit(1)

questions_content = layout_str[questions_block_start:questions_block_end]

new_layout = f"""{{/* Main layout */}}
      <div style={{{{ display: 'flex', justifyContent: 'center', flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px' }}}}>
        {{!selectedNodeId ? (
          <div style={{{{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16 }}}}>
            <div style={{{{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b', padding: 16, borderRadius: 12, border: '1px solid #334155' }}}}>
              <div>
                <h2 style={{{{ color: 'white', margin: 0, fontSize: 20 }}}}>Levels Management</h2>
                <div style={{{{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}}}>{{nodes.length}} total levels available.</div>
              </div>
              <button onClick={{addNode}} disabled={{saving}} className="ll-btn ll-btn-primary" style={{{{ padding: '10px 20px', fontSize: 14, fontWeight: 'bold' }}}}>
                + Add New Level
              </button>
            </div>
            <div style={{{{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, paddingBottom: 40 }}}}>
              {{nodes.map((n) => (
                <div key={{n.id}} style={{{{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}}}>
                  <div style={{{{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}}}>
                    <div style={{{{ color: 'white', fontWeight: 900, fontSize: 18 }}}}>{{n.label}}</div>
                    <div style={{{{ display: 'flex', gap: 4 }}}}>
                      <button className="ll-btn" title="Edit Name" onClick={{(e) => {{ e.stopPropagation(); renameNode(n.id); }}}} style={{{{ padding: '6px 10px', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.05)' }}}}>✎</button>
                      <button className="ll-btn" title="Delete" onClick={{(e) => {{ e.stopPropagation(); deleteNode(n.id); }}}} style={{{{ padding: '6px 10px', borderRadius: 8, fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}}}>🗑</button>
                    </div>
                  </div>
                  <div style={{{{ fontSize: 13, color: '#94a3b8', background: '#0f172a', padding: '8px 12px', borderRadius: 8, display: 'inline-block', alignSelf: 'flex-start' }}}}>
                    IQ Threshold: <span style={{{{ color: '#d8b4fe', fontWeight: 'bold', marginLeft: 4 }}}}>{{n.iq}}</span>
                  </div>
                  <button onClick={{() => setSelectedNodeId(n.id)}} className="ll-btn" style={{{{ marginTop: 'auto', padding: '12px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#d8b4fe', fontWeight: 'bold', fontSize: 14, borderRadius: 8 }}}}>
                    Open Level ➔
                  </button>
                </div>
              ))}}
            </div>
          </div>
        ) : (
          <div style={{{{ width: '100%', maxWidth: 1000, display: 'flex', flexDirection: 'column', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden', margin: '0 auto', height: '100%' }}}}>
            <div style={{{{ padding: 16, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' }}}}>
              <div style={{{{ display: 'flex', alignItems: 'center', gap: 16 }}}}>
                <button onClick={{() => setSelectedNodeId(null)}} className="ll-btn" style={{{{ padding: '8px 14px', fontSize: 14, background: 'rgba(255,255,255,0.1)' }}}}>
                  ← Back to Levels
                </button>
                <div>
                  <div style={{{{ color: 'white', fontWeight: 900, fontSize: 18 }}}}>
                    {{nodes.find(n => n.id === selectedNodeId)?.label}}
                  </div>
                  <div style={{{{ color: '#a855f7', fontSize: 13, fontWeight: 'bold' }}}}>{{questions.length}} questions</div>
                </div>
              </div>
              <button onClick={{() => setAddModalOpen(true)}} className="ll-btn ll-btn-primary" style={{{{ padding: '10px 20px', fontSize: 14, fontWeight: 'bold' }}}}>
                + Add Questions
              </button>
            </div>
            {questions_content}
          </div>
        )}}
      </div>
    </div>"""

# Replace the layout
code = code[:start_idx] + new_layout + code[end_idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated successfully")
