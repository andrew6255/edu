import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Locate the ProgramsAdmin function block
match = re.search(r'function ProgramsAdmin\(\) \{[\s\S]*?\}\n\n', content)
if not match:
    # If there is no \n\n after, try to match to the end of the file
    match = re.search(r'function ProgramsAdmin\(\) \{[\s\S]*$', content)

if not match:
    print("Could not find ProgramsAdmin!")
    exit(1)

programs_admin = match.group(0)

# Add the state variables
if "const [showNewDraftModal, setShowNewDraftModal] = useState(false);" not in programs_admin:
    programs_admin = programs_admin.replace(
        "const [renamingValue, setRenamingValue] = useState('');",
        "const [renamingValue, setRenamingValue] = useState('');\n  const [showNewDraftModal, setShowNewDraftModal] = useState(false);\n  const [newDraftData, setNewDraftData] = useState({ title: '', emoji: '', subject: '' });"
    )

# Add the Modal JSX at the end of the return statement
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

# Replace the last `    </div>\n  );\n}` in `programs_admin` with the modal + the ending.
last_div_idx = programs_admin.rfind("    </div>\n  );\n}")
if last_div_idx != -1:
    programs_admin = programs_admin[:last_div_idx] + modal_jsx + programs_admin[last_div_idx:]

new_content = content.replace(match.group(0), programs_admin)

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(new_content)

print("Applied Modal changes specifically to ProgramsAdmin")
