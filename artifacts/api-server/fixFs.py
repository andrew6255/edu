import re

path = r'c:\Users\antoi\OneDrive\Desktop\edu\artifacts\api-server\src\modules\program-ingestion\controller.ts'

with open(path, 'r', encoding='utf-8') as f:
    code = f.read()

# Replace the second `const fs = await import("node:fs/promises");` with nothing
# Or just rename it to `fs2`

code = code.replace("""    // Clean up temp file
    const fs = await import("node:fs/promises");
    await fs.unlink(file.path).catch(console.warn);""", """    // Clean up temp file
    await fs.unlink(file.path).catch(console.warn);""")

with open(path, 'w', encoding='utf-8') as f:
    f.write(code)

print("Updated successfully")
