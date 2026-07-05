import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Auto-set Emoji based on subject
prog_admin_idx = content.find("function ProgramsAdmin()")
if prog_admin_idx != -1:
    use_effect_str = """
  useEffect(() => {
    if (!builder.coverEmoji && builder.subject) {
      const s = builder.subject.toLowerCase();
      const emojiMap: Record<string, string> = {
        mathematics: '📐', math: '📐',
        science: '🔬', physics: '🔬', chemistry: '🔬', biology: '🔬',
        history: '📜', geography: '🌍',
        language: '📚', english: '📚',
        logic: '🧠', puzzles: '🧠',
        art: '🎨', music: '🎵'
      };
      const found = Object.keys(emojiMap).find(k => s.includes(k));
      if (found) {
        setBuilder(b => ({ ...b, coverEmoji: emojiMap[found] }));
      } else if (s.length > 2) {
        setBuilder(b => ({ ...b, coverEmoji: '📘' }));
      }
    }
  }, [builder.subject, builder.coverEmoji]);
"""
    if "Object.keys(emojiMap).find" not in content:
        target = "const [subjectPopupOpen, setSubjectPopupOpen] = useState(false);"
        content = content.replace(target, target + "\n" + use_effect_str)

# 2. Rename state and logic
if "const [renamingNodeId, setRenamingNodeId]" not in content:
    target = "const [subjectPopupOpen, setSubjectPopupOpen] = useState(false);"
    content = content.replace(target, target + "\n  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);\n  const [renamingValue, setRenamingValue] = useState('');\n")

content = re.sub(
    r"const title = window\.prompt\('New folder name'\);\s*if \(title\) \{\s*const newId = 'div_' \+ Date\.now\(\);\s*setBuilderAtNode\(actualId, \(n\) => \(\{ \.\.\.n, children: \[\.\.\.n\.children, \{ id: newId, title, children: \[\], questionTypes: \[\] \}\] \}\)\);\s*\}",
    """const newId = 'div_' + Date.now();
                            const title = 'New folder';
                            setBuilderAtNode(actualId, (n) => ({ ...n, children: [...n.children, { id: newId, title, children: [], questionTypes: [] }] }));
                            setRenamingNodeId(newId);
                            setRenamingValue(title);""",
    content
)

folder_render_old = """<div style={{ flex: 1, color: 'white', fontSize: 13, fontWeight: 'bold' }}>{child.title}</div>"""
folder_render_new = """<div style={{ flex: 1, color: 'white', fontSize: 13, fontWeight: 'bold' }}>
                          {renamingNodeId === child.id ? (
                            <input
                              autoFocus
                              value={renamingValue}
                              onChange={(e) => setRenamingValue(e.target.value)}
                              onBlur={() => {
                                if (renamingValue.trim()) {
                                  setBuilderAtNode(child.id, (n) => ({ ...n, title: renamingValue.trim() }));
                                }
                                setRenamingNodeId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (renamingValue.trim()) {
                                    setBuilderAtNode(child.id, (n) => ({ ...n, title: renamingValue.trim() }));
                                  }
                                  setRenamingNodeId(null);
                                } else if (e.key === 'Escape') {
                                  setRenamingNodeId(null);
                                }
                              }}
                              style={{ width: '100%', background: '#1e293b', border: '1px solid #3b82f6', color: 'white', padding: '2px 6px', borderRadius: 4, outline: 'none' }}
                            />
                          ) : (
                            child.title
                          )}
                        </div>"""
content = content.replace(folder_render_old, folder_render_new)

folder_rename_btn_old = """const newTitle = window.prompt('Rename folder', child.title);
                            if (newTitle) setBuilderAtNode(child.id, (n) => ({ ...n, title: newTitle }));"""
folder_rename_btn_new = """setRenamingNodeId(child.id);
                            setRenamingValue(child.title);"""
content = content.replace(folder_rename_btn_old, folder_rename_btn_new)


worksheet_render_old = """<div style={{ flex: 1 }}>
                          <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>{file.title}</div>"""
worksheet_render_new = """<div style={{ flex: 1 }}>
                          <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>
                            {renamingNodeId === file.id ? (
                            <input
                              autoFocus
                              value={renamingValue}
                              onChange={(e) => setRenamingValue(e.target.value)}
                              onBlur={() => {
                                if (renamingValue.trim()) {
                                  setBuilderAtNode(node.id, (n) => ({ ...n, questionTypes: n.questionTypes.map(q => q.id === file.id ? { ...q, title: renamingValue.trim() } : q) }));
                                }
                                setRenamingNodeId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  if (renamingValue.trim()) {
                                    setBuilderAtNode(node.id, (n) => ({ ...n, questionTypes: n.questionTypes.map(q => q.id === file.id ? { ...q, title: renamingValue.trim() } : q) }));
                                  }
                                  setRenamingNodeId(null);
                                } else if (e.key === 'Escape') {
                                  setRenamingNodeId(null);
                                }
                              }}
                              style={{ width: '100%', background: '#1e293b', border: '1px solid #3b82f6', color: 'white', padding: '2px 6px', borderRadius: 4, outline: 'none' }}
                            />
                          ) : (
                            file.title
                          )}
                          </div>"""
content = content.replace(worksheet_render_old, worksheet_render_new)

worksheet_rename_btn_old = """const newTitle = window.prompt('Rename worksheet', file.title);
                            if (newTitle) {
                              setBuilderAtNode(node.id, (n) => ({
                                ...n,
                                questionTypes: n.questionTypes.map(q => q.id === file.id ? { ...q, title: newTitle } : q)
                              }));
                            }"""
worksheet_rename_btn_new = """setRenamingNodeId(file.id);
                            setRenamingValue(file.title);"""
content = content.replace(worksheet_rename_btn_old, worksheet_rename_btn_new)

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Applied UI updates")
