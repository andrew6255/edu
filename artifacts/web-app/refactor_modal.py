import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add modal state
if "const [showNewDraftModal, setShowNewDraftModal] = useState(false);" not in content:
    content = content.replace(
        "const [renamingValue, setRenamingValue] = useState('');",
        "const [renamingValue, setRenamingValue] = useState('');\n  const [showNewDraftModal, setShowNewDraftModal] = useState(false);\n  const [newDraftData, setNewDraftData] = useState({ title: '', emoji: '', subject: '' });"
    )

# 2. Update startNewBuilder
new_startNewBuilder = """function startNewBuilder() {
    setShowNewDraftModal(true);
    setNewDraftData({ title: '', emoji: '', subject: '' });
  }"""
content = re.sub(r"function startNewBuilder\(\) \{[\s\S]*?\}", new_startNewBuilder, content, count=1)

# 3. Re-route startEditBuilder to 'builder'
content = content.replace("setView('builder_meta');", "setView('builder');")

# 4. Remove 'builder_meta' from view type
content = content.replace("'builder_meta' | ", "")

# 5. Restore inputs to 'builder' view and add Modal JSX
# Let's extract the builder_meta block and put it in a Modal at the very end of the component
# And restore the inputs to builder view.
meta_regex = r"\) : view === 'builder_meta' \? \([\s\S]*?\) : view === 'builder' \? \("
match = re.search(meta_regex, content)
if match:
    # Just remove the builder_meta block
    content = content.replace(match.group(0), ") : view === 'builder' ? (")

# Re-insert the inputs at the top of the builder view
builder_header_regex = r"(<div style=\{\{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 \}\}>[\s\S]*?</div>)"
match2 = re.search(builder_header_regex, content)
if match2:
    header = match2.group(1)
    # add the inputs block right after the header
    inputs_block = """
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 100 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Emoji</label>
              <input
                type="text"
                value={builder.coverEmoji || ''}
                onChange={(e) => setBuilder({ ...builder, coverEmoji: e.target.value })}
                placeholder="📘"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: 'white', fontSize: 13, outline: 'none', textAlign: 'center' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Program Name</label>
              <input
                type="text"
                value={builder.programTitle}
                onChange={(e) => setBuilder({ ...builder, programTitle: e.target.value })}
                placeholder="E.g. Grade 4 Mathematics"
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: 'white', fontSize: 13, outline: 'none' }}
              />
            </div>
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
                <button className="ll-btn" style={{ padding: '8px 12px', borderLeft: '1px solid #334155', background: 'rgba(255,255,255,0.05)', borderTopRightRadius: 8, borderBottomRightRadius: 8 }}>▼</button>
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
                    <button className="ll-btn ll-btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => {
                      if (newSubjectText.trim()) {
                        const val = newSubjectText.trim();
                        setCustomSubjects(prev => [...prev, val]);
                        setBuilder({ ...builder, subject: val });
                        setNewSubjectText('');
                        setSubjectPopupOpen(false);
                      }
                    }}>Add</button>
                  </div>
                  {(() => {
                    const uniqueSubjects = Array.from(new Set([...items.map(i => i.subject), ...customSubjects].filter(Boolean))) as string[];
                    if (uniqueSubjects.length === 0) return <div style={{ padding: 10, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>No existing subjects.</div>;
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
            </div>
          </div>
"""
    new_header = header + inputs_block
    content = content.replace(header, new_header)

# Fix back button in builder
content = content.replace("onClick={() => setView('builder_meta')}>← Back to Details</button>", "onClick={() => setView('list')}>← Back</button>")

# 6. Add Modal JSX at the end of the file, just before the closing </div> of the component
modal_jsx = """
      {/* New Draft Modal */}
      {showNewDraftModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, width: '100%', maxWidth: 400, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Create New Program</div>
              <button className="ll-btn" style={{ padding: '4px 8px', fontSize: 16, border: 'none', background: 'transparent' }} onClick={() => setShowNewDraftModal(false)}>✕</button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Emoji</label>
                <input
                  type="text"
                  value={newDraftData.emoji}
                  onChange={(e) => setNewDraftData({ ...newDraftData, emoji: e.target.value })}
                  placeholder="📘"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: 'white', fontSize: 14, outline: 'none' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Program Name</label>
                <input
                  type="text"
                  value={newDraftData.title}
                  onChange={(e) => setNewDraftData({ ...newDraftData, title: e.target.value })}
                  placeholder="E.g. Grade 4 Mathematics"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: 'white', fontSize: 14, outline: 'none' }}
                />
              </div>
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Subject</label>
                <div 
                  style={{ display: 'flex', alignItems: 'center', background: '#0f172a', borderRadius: 8, border: '1px solid #334155', cursor: 'pointer' }}
                  onClick={() => setSubjectPopupOpen(!subjectPopupOpen)}
                >
                  <input
                    type="text"
                    value={newDraftData.subject}
                    readOnly
                    placeholder="Select a subject..."
                    style={{ flex: 1, padding: '10px 12px', background: 'transparent', border: 'none', color: 'white', fontSize: 14, outline: 'none', cursor: 'pointer' }}
                  />
                  <button className="ll-btn" style={{ padding: '10px 14px', borderLeft: '1px solid #334155', background: 'rgba(255,255,255,0.05)', borderTopRightRadius: 8, borderBottomRightRadius: 8 }}>▼</button>
                </div>
                {subjectPopupOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#1e293b', border: '1px solid #475569', borderRadius: 8, zIndex: 10, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
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
                            setNewDraftData({ ...newDraftData, subject: val });
                            setNewSubjectText('');
                            setSubjectPopupOpen(false);
                          }
                        }}
                      />
                      <button className="ll-btn ll-btn-primary" style={{ padding: '4px 8px', fontSize: 11 }} onClick={() => {
                        if (newSubjectText.trim()) {
                          const val = newSubjectText.trim();
                          setCustomSubjects(prev => [...prev, val]);
                          setNewDraftData({ ...newDraftData, subject: val });
                          setNewSubjectText('');
                          setSubjectPopupOpen(false);
                        }
                      }}>Add</button>
                    </div>
                    {(() => {
                      const uniqueSubjects = Array.from(new Set([...items.map(i => i.subject), ...customSubjects].filter(Boolean))) as string[];
                      if (uniqueSubjects.length === 0) return <div style={{ padding: 10, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>No existing subjects.</div>;
                      return uniqueSubjects.map((sub, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setNewDraftData({ ...newDraftData, subject: sub });
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
              </div>
            </div>
            <div style={{ padding: '16px 20px', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="ll-btn" onClick={() => setShowNewDraftModal(false)}>Cancel</button>
              <button 
                className="ll-btn ll-btn-primary" 
                disabled={!newDraftData.title.trim()}
                onClick={() => {
                  const b = newBuilderSpec();
                  b.id = 'draft_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
                  b.programTitle = newDraftData.title.trim();
                  b.coverEmoji = newDraftData.emoji.trim();
                  b.subject = newDraftData.subject.trim();
                  
                  const existing = localStorage.getItem('edu_superadmin_builder_drafts');
                  let drafts: ProgramBuilderData[] = [];
                  if (existing) {
                    try { drafts = JSON.parse(existing); } catch {}
                  }
                  drafts.push(b);
                  localStorage.setItem('edu_superadmin_builder_drafts', JSON.stringify(drafts));
                  setDraftItems(drafts);
                  
                  setShowNewDraftModal(false);
                  setNewDraftData({ title: '', emoji: '', subject: '' });
                }}
              >
                Create Draft
              </button>
            </div>
          </div>
        </div>
      )}
"""

content = content.replace("    </div>\n  );\n}", modal_jsx + "    </div>\n  );\n}")

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Applied Modal changes")
