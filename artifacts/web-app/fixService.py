import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\web-app\src\lib\logicGamesService.ts'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# I will find everything after `export async function setLogicGamesIq` and replace it entirely.
idx = code.find("export async function setLogicGamesIq")
if idx == -1:
    print("Could not find setLogicGamesIq")
    exit(1)

# Find the end of `setLogicGamesIq` function block
# Let's just find the next line `export async function getLogicGameQuestions` or similar
end_idx = code.find("}", idx)
end_idx = code.find("}", end_idx + 1)
end_idx = code.find("}", end_idx + 1)

new_code = code[:end_idx+1] + """

export async function getLogicGameQuestions(nodeId: string): Promise<LogicGameQuestionsDoc | null> {
  return getQuestions(QUESTIONS_PUBLIC_COL, nodeId);
}

export async function upsertLogicGameQuestions(nodeId: string, docData: Omit<LogicGameQuestionsDoc, 'nodeId'>): Promise<void> {
  await replaceQuestions(QUESTIONS_PUBLIC_COL, nodeId, docData, new Date().toISOString());
}
"""

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_code)

print("Updated successfully")
