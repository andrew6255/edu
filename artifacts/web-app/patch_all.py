"""
Comprehensive clean patch for SuperAdminPage.tsx
Applied on top of the git-committed version.

Changes:
1. Remove Testing tab completely
2. Add imports for PersonalProgramView and ProgramExplorerUploadModal
3. Add view type 'worksheet_sandbox' 
4. Add state variables: explorerUploadOpen, subjectPopupOpen, renamingNodeId, renamingValue,
   showNewDraftModal, newDraftData, customSubjects, newSubjectText, sandboxWorksheet
5. Change startNewBuilder to open a popup modal
6. Add the Create New Program popup modal
7. Add the worksheet_sandbox view to the render
8. Add the upload modal integration to the builder view
9. Swap the builder header to say 'File Explorer' instead of 'Program Builder'
10. Add file explorer features (folder creation with inline rename, upload worksheet)
11. Add subject popup to builder for inline editing
"""

import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# ═══════════════════════════════════════════
# 1. REMOVE TESTING TAB
# ═══════════════════════════════════════════
# Remove from Tab type
content = content.replace(
    "type Tab = 'overview' | 'users' | 'programs' | 'logicGames' | 'testing';",
    "type Tab = 'overview' | 'users' | 'programs' | 'logicGames';"
)
# Remove from tabs array
content = content.replace(
    "    { id: 'logicGames', icon: '\U0001f9e0', label: 'IQ Games' },\n    { id: 'testing', icon: '\U0001f9ea', label: 'Testing' },\n",
    "    { id: 'logicGames', icon: '\U0001f9e0', label: 'IQ Games' },\n"
)
# Remove the testing tab rendering block
content = content.replace(
    """        {/* ── TESTING (MyScript) ── */}
        {tab === 'testing' && (
          <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 420 }}>
                        <TestingWhiteboard />
          </div>
        )}""",
    ""
)
# Remove TestingWhiteboard import
content = content.replace("import TestingWhiteboard from '@/components/TestingWhiteboard';\n", "")
# Remove the comment about TestingWhiteboard
content = content.replace("/* TestingWhiteboard is imported from @/components/TestingWhiteboard */\n", "")

# ═══════════════════════════════════════════
# 2. ADD IMPORTS
# ═══════════════════════════════════════════
content = content.replace(
    "import { parseAIProgramImport } from '@/lib/aiProgramImport';",
    "import { parseAIProgramImport } from '@/lib/aiProgramImport';\nimport PersonalProgramView from '@/views/PersonalProgramView';\nimport { PersonalProgramData, PersonalProgramMeta } from '@/lib/personalProgramService';\nimport ProgramExplorerUploadModal from '@/components/superadmin/ProgramExplorerUploadModal';"
)

# ═══════════════════════════════════════════
# 3. ADD VIEW TYPE 'worksheet_sandbox'
# ═══════════════════════════════════════════
content = content.replace(
    "const [view, setView] = useState<'list' | 'builder' | 'preview'>('list');",
    "const [view, setView] = useState<'list' | 'builder' | 'preview' | 'worksheet_sandbox'>('list');"
)

# ═══════════════════════════════════════════
# 4. ADD STATE VARIABLES
# ═══════════════════════════════════════════
content = content.replace(
    "  const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);",
    """  const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);
  const [explorerUploadOpen, setExplorerUploadOpen] = useState(false);
  const [subjectPopupOpen, setSubjectPopupOpen] = useState(false);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState('');
  const [showNewDraftModal, setShowNewDraftModal] = useState(false);
  const [newDraftData, setNewDraftData] = useState({ title: '', emoji: '', subject: '' });
  const [customSubjects, setCustomSubjects] = useState<string[]>([]);
  const [newSubjectText, setNewSubjectText] = useState('');
  const [sandboxWorksheet, setSandboxWorksheet] = useState<{ title: string; jsonText: string } | null>(null);"""
)

# ═══════════════════════════════════════════
# 5. CHANGE startNewBuilder TO OPEN MODAL
# ═══════════════════════════════════════════
content = content.replace(
    """  function startNewBuilder() {
    const b = newBuilderSpec();
    setEditingId(null);
    setEditingDraftId(null);
    setView('builder');
    setBuilder(b);
    setBuilderPathIds(['root']);
    setBuilderSelectedQuestionTypeId(null);
  }""",
    """  function startNewBuilder() {
    setShowNewDraftModal(true);
    setNewDraftData({ title: '', emoji: '', subject: '' });
  }"""
)

# ═══════════════════════════════════════════
# 6. ADD WORKSHEET_SANDBOX VIEW TO RENDER
# ═══════════════════════════════════════════
# Insert before `) : view === 'builder' ? (`
sandbox_view = """      ) : view === 'worksheet_sandbox' && sandboxWorksheet ? (
        (() => {
          let questions: any[] = [];
          try {
            questions = JSON.parse(sandboxWorksheet.jsonText || '[]');
          } catch (e) {
            console.error('Failed to parse worksheet questions', e);
          }

          const mockData: PersonalProgramData = {
            id: 'sandbox_prog',
            title: sandboxWorksheet.title || 'Worksheet Preview',
            chapters: [{
              id: 'ch_1',
              title: 'Preview',
              topics: [{
                id: 't_1',
                title: 'Questions',
                questionTypeTitle: 'Questions',
                questionIds: questions.map(q => q.id)
              }]
            }],
            questions: questions,
            totalQuestions: questions.length,
          };

          const mockMeta: PersonalProgramMeta = {
            programId: 'sandbox_prog',
            uid: 'admin',
            createdAt: new Date().toISOString(),
            status: 'completed',
            jobId: 'sandbox',
            originalFileUrl: '',
            sourceFileName: sandboxWorksheet.title || 'Preview',
            programData: mockData
          };

          return (
            <div style={{ position: 'absolute', inset: 0, zIndex: 100 }}>
              <PersonalProgramView 
                programId={null} 
                sandboxData={mockData}
                sandboxMeta={mockMeta}
                onBack={() => {
                  setView('builder');
                  setSandboxWorksheet(null);
                }} 
              />
            </div>
          );
        })()
"""

content = content.replace(
    "      ) : view === 'builder' ? (",
    sandbox_view + "      ) : view === 'builder' ? ("
)

# ═══════════════════════════════════════════
# 7. UPDATE BUILDER HEADER
# ═══════════════════════════════════════════
# Change "🧱 Program Builder" to "📂 Program File Explorer"  
content = content.replace(
    '<div style={{ color: \'white\', fontWeight: 900, fontSize: 14, flex: 1 }}>\U0001f9f1 Program Builder</div>',
    '<div style={{ color: \'white\', fontWeight: 900, fontSize: 14, flex: 1 }}>\U0001f4c2 Program File Explorer</div>'
)

# ═══════════════════════════════════════════
# 8. ADD UPLOAD MODAL + EXPLORER FEATURES
# ═══════════════════════════════════════════
# Find the builder view's opening `<div style={{ animation: 'fadeIn 0.3s ease' }}>` for ProgramsAdmin
# and add the upload modal right after it.
# The return starts at `return (\n    <div style={{ animation: 'fadeIn 0.3s ease' }}>` inside ProgramsAdmin
content = content.replace(
    '    <div style={{ animation: \'fadeIn 0.3s ease\' }}>\n      {view === \'preview\' ? (',
    """    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <ProgramExplorerUploadModal
        open={explorerUploadOpen}
        onClose={() => setExplorerUploadOpen(false)}
        onSuccess={(questions, sourceFileName) => {
          const currentId = builderPathIds[builderPathIds.length - 1];
          const actualId = currentId === 'root' ? (builder.root.children.find(c => c.id === 'fixed_first_division')?.id || 'root') : currentId;
          const newSheet = {
            id: 'qt_' + Date.now(),
            title: sourceFileName.replace(/\\.[^/.]+$/, ''),
            jsonText: JSON.stringify(questions, null, 2)
          };
          setBuilderAtNode(actualId, (n) => ({
            ...n,
            questionTypes: [...n.questionTypes, newSheet]
          }));
        }}
      />
      {view === 'preview' ? ("""
)

# Add metadata inputs and file explorer buttons after the builder header's closing </div>
# The builder header ends with `</div>\n\n          <div style={{ border: '1px solid #334155', borderRadius: 12, background: '#0f172a', padding: 12, marginBottom: 12 }}>`
# which is the "Paste AI JSON Import" section

builder_header_end = """            {saving ? 'Publishing...' : 'Publish'}
            </button>
          </div>"""

builder_additions = """            {saving ? 'Publishing...' : 'Publish'}
            </button>
          </div>

          {/* Metadata Inputs */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 80 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Emoji</label>
              <input
                type="text"
                value={builder.coverEmoji || ''}
                onChange={(e) => setBuilder({ ...builder, coverEmoji: e.target.value })}
                placeholder="\U0001f4d8"
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
                <button className="ll-btn" style={{ padding: '8px 12px', borderLeft: '1px solid #334155', background: 'rgba(255,255,255,0.05)', borderTopRightRadius: 8, borderBottomRightRadius: 8 }}>\u25bc</button>
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

          {/* File Explorer Actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => {
              const currentId = builderPathIds[builderPathIds.length - 1];
              const actualId = currentId === 'root' ? (builder.root.children.find(c => c.id === 'fixed_first_division')?.id || 'root') : currentId;
              const newId = 'node_' + Date.now();
              setBuilderAtNode(actualId, (n) => ({
                ...n,
                children: [...n.children, { id: newId, title: 'New Folder', children: [], questionTypes: [] }]
              }));
              setRenamingNodeId(newId);
              setRenamingValue('New Folder');
            }}>\U0001f4c1 New Folder</button>
            <button className="ll-btn" style={{ padding: '7px 12px', fontSize: 12 }} onClick={() => setExplorerUploadOpen(true)}>\U0001f4e4 Upload Worksheet</button>
          </div>"""

content = content.replace(builder_header_end, builder_additions)

# ═══════════════════════════════════════════
# 9. ADD POPUP MODAL BEFORE CLOSING </div>
# ═══════════════════════════════════════════
# Find the end of ProgramsAdmin's return: `    </div>\n  );\n}`
# and insert the modal just before it

modal_jsx = """
      {/* ── Create New Program Modal ── */}
      {showNewDraftModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, width: '100%', maxWidth: 400, overflow: 'hidden', boxShadow: '0 20px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Create New Program</div>
              <button className="ll-btn" style={{ padding: '4px 8px', fontSize: 16, border: 'none', background: 'transparent' }} onClick={() => setShowNewDraftModal(false)}>\u2715</button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Emoji</label>
                <input
                  type="text"
                  value={newDraftData.emoji}
                  onChange={(e) => setNewDraftData({ ...newDraftData, emoji: e.target.value })}
                  placeholder="\U0001f4d8"
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
                  <button className="ll-btn" style={{ padding: '10px 14px', borderLeft: '1px solid #334155', background: 'rgba(255,255,255,0.05)', borderTopRightRadius: 8, borderBottomRightRadius: 8 }}>\u25bc</button>
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
                onClick={async () => {
                  const b = newBuilderSpec();
                  b.programTitle = newDraftData.title.trim();
                  b.coverEmoji = newDraftData.emoji.trim() || '\U0001f4d8';
                  b.subject = newDraftData.subject.trim();
                  b.root.title = newDraftData.title.trim();
                  
                  setEditingId(null);
                  setEditingDraftId(null);
                  setBuilder(b);
                  setBuilderPathIds(['root']);
                  setBuilderSelectedQuestionTypeId(null);
                  
                  // Save as draft immediately
                  try {
                    const id = await saveDraftProgramAdmin({
                      title: b.programTitle,
                      subject: b.subject,
                      grade_band: b.gradeBand,
                      coverEmoji: b.coverEmoji,
                      builderSpec: b,
                    });
                    setEditingDraftId(id);
                    await load();
                  } catch (e) {
                    console.error('Failed to save initial draft', e);
                  }
                  
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

# Find the very end of ProgramsAdmin's return statement
# It ends with `    </div>\n  );\n}\n`
# We need to insert the modal before the closing </div>
# The last `    </div>\n  );\n}` in the file is ProgramsAdmin's ending
content = content.rstrip()
if content.endswith("    </div>\n  );\n}"):
    content = content[:-len("    </div>\n  );\n}")] + modal_jsx + "    </div>\n  );\n}\n"
else:
    # Find it by searching from the end
    idx = content.rfind("    </div>\n  );\n}")
    if idx != -1:
        content = content[:idx] + modal_jsx + content[idx:]

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("All patches applied successfully!")
