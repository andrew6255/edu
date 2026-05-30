# Map Compiler (PDF -> Blueprint -> ChapterData)

## Setup

1. Create a Python virtual env and install dependencies:

```bash
python -m venv .venv
.\\.venv\\Scripts\\python -m pip install -r tools/map_compiler/requirements.txt
```

2. Set your Gemini API key:

- Windows PowerShell:

```powershell
$env:GEMINI_API_KEY = "YOUR_KEY"
```

## Run

### 0) Organizer (TOC)

Generate a normalized table of contents (TOC) JSON. If the file has no TOC, the model will generate one.

```bash
.\\.venv\\Scripts\\python -m tools.map_compiler.map_compiler organize --pdf "path\\to\\book.pdf" --out toc.json --start-page 1 --end-page 6
```

Or from images:

```bash
.\\.venv\\Scripts\\python -m tools.map_compiler.map_compiler organize --images-dir "path\\to\\images" --out toc.json
```

### 1) Architect (Blueprint)

```bash
.\\.venv\\Scripts\\python -m tools.map_compiler.map_compiler architect --pdf "path\\to\\book.pdf" --out blueprint.json --start-page 1 --end-page 5
```

To feed the TOC into the Architect:

```bash
.\\.venv\\Scripts\\python -m tools.map_compiler.map_compiler architect --pdf "path\\to\\book.pdf" --toc toc.json --out blueprint.json --start-page 1 --end-page 12
```

Or run from a folder of page images (png/jpg/jpeg/webp) sorted by filename:

```bash
.\\.venv\\Scripts\\python -m tools.map_compiler.map_compiler architect --images-dir "path\\to\\images" --out blueprint.json
```

### 2) Laborer (ChapterData)

```bash
.\\.venv\\Scripts\\python -m tools.map_compiler.map_compiler laborer --pdf "path\\to\\book.pdf" --blueprint blueprint.json --out chapter.json --start-page 1 --end-page 60
```

Or run from a folder of page images:

```bash
.\\.venv\\Scripts\\python -m tools.map_compiler.map_compiler laborer --images-dir "path\\to\\images" --blueprint blueprint.json --out chapter.json
```

## Notes
- This pipeline uses **hybrid input**: it passes both extracted text and rendered page images into Gemini.
- The model is instructed to always populate `raw_text` and only populate `latex` when confident.
- If Gemini wraps JSON in fences, the CLI attempts to extract the JSON object automatically.
