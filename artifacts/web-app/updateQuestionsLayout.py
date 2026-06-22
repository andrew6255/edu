import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

render_old = r"""        \) : \(
          <div style=\{\{ width: '100%', maxWidth: 1000, display: 'flex', flexDirection: 'column', background: '#0f172a', border: '1px solid #334155', borderRadius: 12, overflow: 'hidden', margin: '0 auto', height: '100%' \}\}>
            <div style=\{\{ padding: 16, borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1e293b' \}\}>
              <div style=\{\{ display: 'flex', alignItems: 'center', gap: 16 \}\}>
                <button onClick=\{\(\) => setSelectedNodeId\(null\)\} className="ll-btn" style=\{\{ padding: '8px 14px', fontSize: 14, background: 'rgba\(255,255,255,0\.1\)' \}\}>
                  ← Back to Levels
                </button>
                <div>
                  <div style=\{\{ color: 'white', fontWeight: 900, fontSize: 18 \}\}>
                    \{nodes\.find\(n => n\.id === selectedNodeId\)\?\.label\}
                  </div>
                  <div style=\{\{ color: '#a855f7', fontSize: 13, fontWeight: 'bold' \}\}>\{questions\.length\} questions</div>
                </div>
              </div>
              <button onClick=\{\(\) => setAddModalOpen\(true\)\} className="ll-btn ll-btn-primary" style=\{\{ padding: '10px 20px', fontSize: 14, fontWeight: 'bold' \}\}>
                \+ Add Questions
              </button>
            </div>
            
            <div style=\{\{ flex: 1, overflowY: 'auto', padding: 20 \}\}>"""

render_new = """        ) : (
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', margin: '0 auto', paddingBottom: 40 }}>
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 24, padding: '10px 0' }}>
              <button onClick={() => setSelectedNodeId(null)} className="ll-btn" style={{ position: 'absolute', left: 0, padding: '8px 14px', fontSize: 14, background: 'rgba(255,255,255,0.1)' }}>
                ← Back to Levels
              </button>
              
              <div style={{ textAlign: 'center' }}>
                <h1 style={{ color: 'white', fontWeight: 900, fontSize: 28, margin: 0 }}>
                  {nodes.find(n => n.id === selectedNodeId)?.label}
                </h1>
                <div style={{ color: '#a855f7', fontSize: 14, fontWeight: 'bold', marginTop: 4 }}>{questions.length} questions</div>
              </div>

              <button onClick={() => setAddModalOpen(true)} className="ll-btn ll-btn-primary" style={{ position: 'absolute', right: 0, padding: '10px 20px', fontSize: 14, fontWeight: 'bold' }}>
                + Add Questions
              </button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column' }}>"""

code = re.sub(render_old, render_new, code, flags=re.DOTALL)

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated SuperAdminPage.tsx questions view layout successfully")
