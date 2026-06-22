const fs = require('fs');
const path = 'c:\\Users\\antoi\\OneDrive\\Desktop\\edu\\artifacts\\web-app\\src\\pages\\SuperAdminPage.tsx';
let code = fs.readFileSync(path, 'utf8');

const regex = /import \{\s*deleteDraftLogicGameNode,[\s\S]*?\} from '@\/lib\/logicGamesService';/;
const newImport = `import {
  deleteDraftLogicGameNode,
  getDraftLogicGameQuestions,
  listDraftLogicGameNodes,
  upsertDraftLogicGameNode,
  upsertDraftLogicGameQuestions,
} from '@/lib/logicGamesService';`;

code = code.replace(regex, newImport);
fs.writeFileSync(path, code);
console.log('Fixed imports');
