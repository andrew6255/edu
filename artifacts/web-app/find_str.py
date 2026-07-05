with open("src/pages/SuperAdminPage.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if "explorerUploadOpen" in line:
        print(f"Line {i+1}: {line.strip()}")
