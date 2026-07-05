with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

emoji_heuristic = """
      const emojiMap: Record<string, string> = {
        mathematics: '📐',
        science: '🔬',
        history: '📜',
        language: '📚',
        logic: '🧠',
        art: '🎨'
      };
      const autoEmoji = builder.coverEmoji.trim() || emojiMap[builder.subject || ''] || '📘';
"""

# In saveBuilderDraft:
content = content.replace(
    "const draftEmoji = builder.coverEmoji.trim();",
    emoji_heuristic + "      const draftEmoji = autoEmoji;"
)

# In publishBuilder:
content = content.replace(
    "const draftEmoji = builder.coverEmoji.trim();",
    emoji_heuristic + "      const draftEmoji = autoEmoji;"
)

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)
