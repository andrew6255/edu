with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add import ProgramExplorerUploadModal
if "import ProgramExplorerUploadModal" not in content:
    content = content.replace(
        "import { parseAIProgramImport } from '@/lib/aiProgramImport';",
        "import { parseAIProgramImport } from '@/lib/aiProgramImport';\nimport ProgramExplorerUploadModal from '@/components/superadmin/ProgramExplorerUploadModal';"
    )

# 2. Add state inside ProgramsAdmin
if "const [explorerUploadOpen, setExplorerUploadOpen] = useState(false);" not in content:
    content = content.replace(
        "const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);",
        "const [builderPathIds, setBuilderPathIds] = useState<string[]>(['root']);\n  const [explorerUploadOpen, setExplorerUploadOpen] = useState(false);"
    )

# 3. Add Modal render inside ProgramsAdmin's returned JSX
if "<ProgramExplorerUploadModal" not in content:
    content = content.replace(
        "<div style={{ animation: 'fadeIn 0.3s ease' }}>",
        """<div style={{ animation: 'fadeIn 0.3s ease' }}>
      <ProgramExplorerUploadModal
        open={explorerUploadOpen}
        onClose={() => setExplorerUploadOpen(false)}
        onSuccess={(questions, sourceFileName) => {
          const currentId = builderPathIds[builderPathIds.length - 1];
          const actualId = currentId === 'root' ? (builder.root.children.find(c => c.id === 'fixed_first_division')?.id || 'root') : currentId;
          const newSheet = {
            id: 'qt_' + Date.now(),
            title: sourceFileName.replace(/\.[^/.]+$/, ''),
            jsonText: JSON.stringify(questions, null, 2)
          };
          setBuilderAtNode(actualId, (n) => ({
            ...n,
            questionTypes: [...n.questionTypes, newSheet]
          }));
        }}
      />"""
    )

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
