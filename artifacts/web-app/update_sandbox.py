import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add import for WorksheetSandboxView
import_str = "import WorksheetSandboxView from '@/components/superadmin/WorksheetSandboxView';\n"
if "import WorksheetSandboxView" not in content:
    idx = content.find("import ")
    content = content[:idx] + import_str + content[idx:]

# 2. Update view state type
content = content.replace(
    "const [view, setView] = useState<'list' | 'builder' | 'preview'>('list');",
    "const [view, setView] = useState<'list' | 'builder' | 'preview' | 'worksheet_sandbox'>('list');"
)

# 3. Add sandboxWorksheet state
state_str = "  const [sandboxWorksheet, setSandboxWorksheet] = useState<any | null>(null);\n"
if "const [sandboxWorksheet" not in content:
    idx = content.find("const [view, setView]")
    content = content[:idx] + state_str + content[idx:]

# 4. Handle double click on Worksheet in File Explorer
# Find: <div style={{ flex: 1 }}>\n  <div style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>
# Oh wait, the parent div of the worksheet has: `key={file.id}` and `style={{ display: 'flex', alignItems: 'center'...`
worksheet_item_match = re.search(r'(<div\s+key=\{file\.id\}\s+style=\{\{\s*display:\s*\'flex\',\s*alignItems:\s*\'center\'.*?\})', content, re.DOTALL)
if worksheet_item_match:
    target = worksheet_item_match.group(1)
    replacement = target + "\n                        onDoubleClick={() => {\n                          setSandboxWorksheet(file);\n                          setView('worksheet_sandbox');\n                        }}"
    if "onDoubleClick" not in target and "setSandboxWorksheet(file)" not in content:
        content = content.replace(target, replacement)

# 5. Add rendering for worksheet_sandbox view
view_render_str = """
      ) : view === 'worksheet_sandbox' && sandboxWorksheet ? (
        <WorksheetSandboxView 
          worksheet={sandboxWorksheet} 
          onBack={() => {
            setView('builder');
            setSandboxWorksheet(null);
          }} 
        />
"""
if "view === 'worksheet_sandbox'" not in content:
    # insert before the `) : view === 'builder' ? (`
    target = ") : view === 'builder' ? ("
    content = content.replace(target, view_render_str + "      " + target)

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Applied Sandbox view state updates")
