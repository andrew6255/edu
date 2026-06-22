import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# First replace the renameNode and setNodeIq with an inline edit state and function

state_injection = """
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editNodeLabel, setEditNodeLabel] = useState("");
  const [editNodeIq, setEditNodeIq] = useState("");

  async function saveNodeEdits(nodeId: string) {
    const n = nodes.find(x => x.id === nodeId);
    if (!n) return;
    
    const label = editNodeLabel.trim();
    const iq = Number(editNodeIq.trim());
    if (!label || !Number.isFinite(iq)) {
       setEditingNodeId(null);
       return;
    }

    setSaving(true);
    try {
      await upsertLogicGameNode({ ...n, label, iq });
      setNodes((prev) =>
        prev
          .map((x) => (x.id === nodeId ? { ...x, label, iq } : x))
          .slice()
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      );
      setStatus('✅ Level updated');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
      setEditingNodeId(null);
    }
  }
"""

# Inject state before addNode
code = re.sub(r'(async function addNode\(\) \{)', state_injection + r'\n  \1', code, count=1)

# Now remove renameNode and setNodeIq functions
code = re.sub(r'async function renameNode\(.*?\).*?finally \{\s*setSaving\(false\);\s*\}\s*\}', '', code, flags=re.DOTALL)
code = re.sub(r'async function setNodeIq\(.*?\).*?finally \{\s*setSaving\(false\);\s*\}\s*\}', '', code, flags=re.DOTALL)

# Inject the IQ levels title and replace the node rendering block
render_old = r"""        {!selectedNodeId \? \(
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }}>
            \{nodes\.map\(\(n\) => \(
              <div key=\{n\.id\}.*?🗑 Delete</button>
                </div>
              </div>
            \)\)\}"""

render_new = """        {!selectedNodeId ? (
          <div style={{ width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 40 }}>
            <h1 style={{ textAlign: 'center', color: 'white', margin: '0 0 20px 0', fontSize: 32, fontWeight: 900 }}>IQ levels</h1>
            {nodes.map((n) => (
              <div key={n.id} 
                   onClick={() => { if (editingNodeId !== n.id) setSelectedNodeId(n.id); }}
                   style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.2)', cursor: editingNodeId === n.id ? 'default' : 'pointer', transition: 'all 0.2s' }}
                   onMouseEnter={(e) => { if (editingNodeId !== n.id) e.currentTarget.style.borderColor = '#a855f7'; }}
                   onMouseLeave={(e) => { if (editingNodeId !== n.id) e.currentTarget.style.borderColor = '#334155'; }}
              >
                {editingNodeId === n.id ? (
                  <div style={{ display: 'flex', gap: 16, flex: 1, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                       <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 'bold' }}>Level Name</label>
                       <input value={editNodeLabel} onChange={e => setEditNodeLabel(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 120 }}>
                       <label style={{ fontSize: 12, color: '#94a3b8', fontWeight: 'bold' }}>IQ Threshold</label>
                       <input type="number" value={editNodeIq} onChange={e => setEditNodeIq(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, background: '#0f172a', border: '1px solid #475569', color: 'white', outline: 'none' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                       <button onClick={() => saveNodeEdits(n.id)} className="ll-btn ll-btn-primary" style={{ padding: '8px 16px', fontWeight: 'bold' }}>Save</button>
                       <button onClick={() => setEditingNodeId(null)} className="ll-btn" style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.1)' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                       <div style={{ color: 'white', fontWeight: 900, fontSize: 18 }}>{n.label}</div>
                       <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
                         IQ Threshold: <span style={{ color: '#d8b4fe', fontWeight: 'bold' }}>{n.iq}</span>
                       </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="ll-btn" title="Edit Level" onClick={(e) => { e.stopPropagation(); setEditNodeLabel(n.label || ''); setEditNodeIq(n.iq?.toString() || '80'); setEditingNodeId(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, background: 'rgba(255,255,255,0.05)', color: 'white' }}>✎ Edit</button>
                      <button className="ll-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}>🗑 Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}"""

code = re.sub(render_old, render_new, code, flags=re.DOTALL)

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated SuperAdminPage.tsx successfully")
