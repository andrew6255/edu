const fs = require('fs');

const path = 'c:\\Users\\antoi\\OneDrive\\Desktop\\edu\\artifacts\\web-app\\src\\lib\\logicGamesService.ts';
let code = fs.readFileSync(path, 'utf8');

const publishAllCode = `
export async function publishAllLogicGames(): Promise<void> {
  const drafts = await listDraftLogicGameNodes();
  const publicNodes = await listPublishedLogicGameNodes();
  
  // Delete public nodes that are no longer in drafts
  const draftIds = new Set(drafts.map(d => d.id));
  for (const pub of publicNodes) {
    if (!draftIds.has(pub.id)) {
      await deletePublishedLogicGameNode(pub.id);
    }
  }

  // Publish remaining
  for (const draft of drafts) {
    await publishLogicGameNode(draft.id);
    await publishLogicGameQuestions(draft.id);
  }
}
`;

if (!code.includes('publishAllLogicGames')) {
  code += '\n' + publishAllCode;
  fs.writeFileSync(path, code);
  console.log('Added publishAllLogicGames');
} else {
  console.log('Already exists');
}
