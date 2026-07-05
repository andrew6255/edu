import re

with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("setView(\\'builder_meta\\');", "setView('builder_meta');")

with open("src/pages/SuperAdminPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("Fixed Syntax Error")
