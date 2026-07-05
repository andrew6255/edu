with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add state for subject popup
if "const [subjectPopupOpen, setSubjectPopupOpen] = useState(false);" not in content:
    content = content.replace(
        "const [explorerUploadOpen, setExplorerUploadOpen] = useState(false);",
        "const [explorerUploadOpen, setExplorerUploadOpen] = useState(false);\n  const [subjectPopupOpen, setSubjectPopupOpen] = useState(false);"
    )

import re

start_str = "          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>"
start_idx = content.find(start_str)

end_str = "          <div style={{ background: '#0f172a', border: '1px solid #1f2a44', borderRadius: 12, overflow: 'hidden' }}>"
end_idx = content.find(end_str)

if start_idx == -1 or end_idx == -1:
    print("Could not find the row block")
    exit(1)

new_row = """          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', background: '#0f172a', borderRadius: 8, border: '1px solid #334155' }}>
                <input
                  type="text"
                  value={builder.subject || ''}
                  onChange={(e) => setBuilder({ ...builder, subject: e.target.value })}
                  placeholder="e.g. Mathematics"
                  style={{ flex: 1, padding: '8px 10px', background: 'transparent', border: 'none', color: 'white', fontSize: 13, outline: 'none' }}
                />
                <button
                  className="ll-btn"
                  style={{ padding: '8px 12px', borderLeft: '1px solid #334155', background: 'rgba(255,255,255,0.05)', borderTopRightRadius: 8, borderBottomRightRadius: 8 }}
                  onClick={() => setSubjectPopupOpen(!subjectPopupOpen)}
                >
                  ▼
                </button>
              </div>
              {subjectPopupOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#1e293b', border: '1px solid #475569', borderRadius: 8, zIndex: 10, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                  {(() => {
                    const uniqueSubjects = Array.from(new Set(items.map(i => i.subject).filter(Boolean))) as string[];
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
          </div>\n\n"""

content = content[:start_idx] + new_row + content[end_idx:]

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Updated File Explorer Row")
