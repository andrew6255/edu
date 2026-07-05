import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add states for custom subjects
state_insertion = """  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');"""
new_state = state_insertion + "\n  const [customSubjects, setCustomSubjects] = useState<string[]>([]);\n  const [newSubjectText, setNewSubjectText] = useState('');"

if "const [customSubjects, setCustomSubjects]" not in content:
    content = content.replace(state_insertion, new_state)


# 2. Modify Subject Block
old_subject_block_start = "            {/* Subject Third with Popup Button */}"
old_subject_block_end = """                </div>
              )}
            </div>"""

idx_start = content.find(old_subject_block_start)
idx_end = content.find(old_subject_block_end, idx_start) + len(old_subject_block_end)

new_subject_block = """            {/* Subject Third with Popup Button */}
            <div style={{ flex: 1, position: 'relative' }}>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Subject</label>
              <div 
                style={{ display: 'flex', alignItems: 'center', background: '#0f172a', borderRadius: 8, border: '1px solid #334155', cursor: 'pointer' }}
                onClick={() => setSubjectPopupOpen(!subjectPopupOpen)}
              >
                <input
                  type="text"
                  value={builder.subject || ''}
                  readOnly
                  placeholder="Select a subject..."
                  style={{ flex: 1, padding: '8px 10px', background: 'transparent', border: 'none', color: 'white', fontSize: 13, outline: 'none', cursor: 'pointer' }}
                />
                <button
                  className="ll-btn"
                  style={{ padding: '8px 12px', borderLeft: '1px solid #334155', background: 'rgba(255,255,255,0.05)', borderTopRightRadius: 8, borderBottomRightRadius: 8 }}
                >
                  ▼
                </button>
              </div>
              {subjectPopupOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#1e293b', border: '1px solid #475569', borderRadius: 8, zIndex: 10, maxHeight: 300, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                  <div style={{ padding: '8px', borderBottom: '1px solid #334155', display: 'flex', gap: 6, position: 'sticky', top: 0, background: '#1e293b', zIndex: 11 }}>
                    <input 
                      type="text" 
                      value={newSubjectText}
                      onChange={(e) => setNewSubjectText(e.target.value)}
                      placeholder="Add new subject..."
                      style={{ flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: 'white', padding: '4px 8px', fontSize: 12, outline: 'none' }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newSubjectText.trim()) {
                          const val = newSubjectText.trim();
                          setCustomSubjects(prev => [...prev, val]);
                          setBuilder({ ...builder, subject: val });
                          setNewSubjectText('');
                          setSubjectPopupOpen(false);
                        }
                      }}
                    />
                    <button 
                      className="ll-btn ll-btn-primary" 
                      style={{ padding: '4px 8px', fontSize: 11 }}
                      onClick={() => {
                        if (newSubjectText.trim()) {
                          const val = newSubjectText.trim();
                          setCustomSubjects(prev => [...prev, val]);
                          setBuilder({ ...builder, subject: val });
                          setNewSubjectText('');
                          setSubjectPopupOpen(false);
                        }
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {(() => {
                    const uniqueSubjects = Array.from(new Set([...items.map(i => i.subject), ...customSubjects].filter(Boolean))) as string[];
                    if (uniqueSubjects.length === 0) {
                      return <div style={{ padding: 10, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>No existing subjects.</div>;
                    }
                    return uniqueSubjects.map((sub, idx) => (
                      <div
                        key={idx}
                        onClick={() => {
                          setBuilder({ ...builder, subject: sub });
                          setSubjectPopupOpen(false);
                        }}
                        style={{ padding: '8px 12px', color: 'white', fontSize: 13, cursor: 'pointer', borderBottom: idx < uniqueSubjects.length - 1 ? '1px solid #334155' : 'none' }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#334155'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        {sub}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>"""

content = content[:idx_start] + new_subject_block + content[idx_end:]

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Applied Subject UI updates")
