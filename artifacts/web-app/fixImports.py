import re
import glob

files = [
    r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\lib\logicGameFriendService.ts',
    r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\pages\SuperAdminPage.tsx',
    r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\views\LogicGamesView.tsx'
]

replacements = {
    "getPublishedLogicGameQuestions": "getLogicGameQuestions",
    "listPublishedLogicGameNodes": "listLogicGameNodes",
    "deleteDraftLogicGameNode": "deleteLogicGameNode",
    "getDraftLogicGameQuestions": "getLogicGameQuestions",
    "listDraftLogicGameNodes": "listLogicGameNodes",
    "upsertDraftLogicGameNode": "upsertLogicGameNode",
    "upsertDraftLogicGameQuestions": "upsertLogicGameQuestions",
}

for path in files:
    with open(path, 'r', encoding='utf-8') as f:
        code = f.read()
    
    for old, new in replacements.items():
        # First fix imports (they might be inside curly braces)
        code = code.replace(old, new)
        
    with open(path, 'w', encoding='utf-8') as f:
        f.write(code)

print("Updated imports successfully")
