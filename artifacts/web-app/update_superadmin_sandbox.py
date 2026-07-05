import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Replace WorksheetSandboxView import with PersonalProgramView
content = content.replace(
    "import WorksheetSandboxView from '@/components/superadmin/WorksheetSandboxView';",
    "import PersonalProgramView from '@/views/PersonalProgramView';\nimport { PersonalProgramData, PersonalProgramMeta } from '@/lib/personalProgramService';"
)

# 2. Update the render block for worksheet_sandbox
old_render = """      ) : view === 'worksheet_sandbox' && sandboxWorksheet ? (
        <WorksheetSandboxView 
          worksheet={sandboxWorksheet} 
          onBack={() => {
            setView('builder');
            setSandboxWorksheet(null);
          }} 
        />"""

new_render = """      ) : view === 'worksheet_sandbox' && sandboxWorksheet ? (
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

if "PersonalProgramView \n                programId={null}" not in content:
    content = content.replace(old_render, new_render)

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Applied SuperAdminPage patches for PersonalProgramView")
