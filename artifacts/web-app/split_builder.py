import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update the view state type
content = content.replace(
    "const [view, setView] = useState<'list' | 'builder' | 'preview' | 'worksheet_sandbox'>('list');",
    "const [view, setView] = useState<'list' | 'builder' | 'builder_meta' | 'preview' | 'worksheet_sandbox'>('list');"
)

# 2. Update startNewBuilder, startEditBuilder, startEditDraftBuilder
content = content.replace("setView('builder');", "setView('builder_meta');")
# wait, wait! The Back buttons inside builder set it to 'list'. Let me check for that.
# Let's do targeted replacements for the start functions instead of a global replace.
# I will undo the global replace.
content = content.replace("setView('builder_meta');", "setView('builder');")

# Let's find startNewBuilder
content = re.sub(r'(function startNewBuilder\(\) \{[\s\S]*?setView\()\s*\'builder\'\s*(\);)', r'\1\'builder_meta\'\2', content)
# startEditDraftBuilder
content = re.sub(r'(function startEditDraftBuilder\(.*?\) \{[\s\S]*?setView\()\s*\'builder\'\s*(\);)', r'\1\'builder_meta\'\2', content)
# startEditBuilder
content = re.sub(r'(function startEditBuilder\(.*?\) \{[\s\S]*?setView\()\s*\'builder\'\s*(\);)', r'\1\'builder_meta\'\2', content)

# 3. We need to extract the Header (Emoji, Title, Subject) from `view === 'builder'` 
# into a new `view === 'builder_meta'` block, and in `builder` we remove it.
# Let's find the start of the `view === 'builder'` block.
builder_block_regex = r"(\) : view === 'builder' \? \([\s\S]*?)<div style=\{\{ background: '#0f172a', border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' \}\}>"
match = re.search(builder_block_regex, content)
if not match:
    print("Could not find builder block!")
else:
    # The matched group 1 contains the top buttons and the Emoji/Title/Subject fields.
    # We will split it into `builder_meta` and `builder`.
    
    meta_view = """      ) : view === 'builder_meta' ? (
        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>Program Details</div>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setView('list')}>← Back to List</button>
            <button 
              className="ll-btn ll-btn-primary" 
              style={{ padding: '7px 12px', fontSize: 12, background: '#3b82f6', borderColor: '#2563eb', color: 'white' }} 
              onClick={() => {
                // Auto-generate emoji logic can be triggered here if empty, but we already have auto-emoji on change in MyProgramsModal
                setView('builder');
              }}
              disabled={!builder.programTitle.trim()}
              title={!builder.programTitle.trim() ? "Please enter a program name" : ""}
            >
              Next →
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            {/* Emoji First */}
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
            {/* Program Name Second */}
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
            {/* Subject Third with Popup Button */}
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
            </div>
          </div>
        </div>
      ) : view === 'builder' ? (
        <div style={{ background: '#1e293b', borderRadius: 12, border: '1px solid #334155', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 14, flex: 1 }}>📂 Program File Explorer</div>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setView('builder_meta')}>← Back to Details</button>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={previewBuilder}>
              Preview
            </button>
            <button
              className="ll-btn"
              style={{ padding: '7px 12px', fontSize: 12 }}
              onClick={saveBuilderDraft}
              disabled={saving}
              title="Save draft (not published)"
            >
              {saving ? 'Saving...' : 'Save Draft'}
            </button>
            <button
              className="ll-btn ll-btn-primary"
              style={{ padding: '7px 12px', fontSize: 12, background: '#10b981', borderColor: '#059669', color: 'white' }}
              onClick={publishBuilder}
              disabled={saving}
            >
              {saving ? 'Publishing...' : 'Publish'}
            </button>
          </div>

          """
    # So we replace the entire match (which was `) : view === 'builder' ? (` up to `<div class=...>` )
    # with the `meta_view` and `<div style={{ background: '#0f172a', border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>`
    new_text = meta_view + "<div style={{ background: '#0f172a', border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>"
    content = content.replace(match.group(0), new_text)


with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Applied UI split")
