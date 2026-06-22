const fs = require('fs');

const path = 'c:\\Users\\antoi\\OneDrive\\Desktop\\edu\\artifacts\\web-app\\src\\pages\\SuperAdminPage.tsx';
let code = fs.readFileSync(path, 'utf8');

// Replace logic game service calls in LogicGamesAdmin
code = code.replace(/listPublishedLogicGameNodes/g, 'listDraftLogicGameNodes');
code = code.replace(/getPublishedLogicGameQuestions/g, 'getDraftLogicGameQuestions');
code = code.replace(/upsertPublishedLogicGameNode/g, 'upsertDraftLogicGameNode');
code = code.replace(/upsertPublishedLogicGameQuestions/g, 'upsertDraftLogicGameQuestions');
code = code.replace(/deletePublishedLogicGameNode/g, 'deleteDraftLogicGameNode');

// Add the publish button to the header
const headerRegex = /(<div style=\{\{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, flexShrink: 0 \}\}>)\s*(<h3 style=\{\{ color: 'white', margin: 0, fontSize: 16 \}\}>🧠 IQ Games<\/h3>)\s*(<button onClick=\{load\} className="ll-btn" style=\{\{ padding: '7px 14px', fontSize: 12 \}\}>)\s*(↺ Refresh)\s*(<\/button>)/;
const publishButtonStr = `
          <button 
            onClick={async () => {
              if (!window.confirm('Publish all edits to all students now?')) return;
              setSaving(true); setStatus(null); setErr(null);
              try {
                await import('@/lib/logicGamesService').then(m => m.publishAllLogicGames());
                setStatus('✅ Published all questions successfully!');
              } catch(e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setSaving(false);
              }
            }} 
            disabled={saving}
            className="ll-btn ll-btn-primary" style={{ padding: '7px 14px', fontSize: 12, fontWeight: 'bold' }}>
            🚀 Publish to Students
          </button>
`;

if (headerRegex.test(code)) {
  code = code.replace(headerRegex, `$1\n        $2\n        <div style={{ display: 'flex', gap: 10 }}>$3$4$5${publishButtonStr}</div>`);
  fs.writeFileSync(path, code);
  console.log('Updated SuperAdminPage.tsx');
} else {
  console.log('Header regex did not match');
}
