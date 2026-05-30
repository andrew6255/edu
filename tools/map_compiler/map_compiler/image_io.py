from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class ImagePage:
    page_number: int  # best-effort (from filename ordering)
    png_bytes: bytes
    filename: str


def load_images_from_dir(images_dir: str) -> list[ImagePage]:
    p = Path(images_dir)
    if not p.exists() or not p.is_dir():
        raise FileNotFoundError(f"Images directory not found: {images_dir}")

    exts = {".png", ".jpg", ".jpeg", ".webp"}
    files = [f for f in p.iterdir() if f.is_file() and f.suffix.lower() in exts]
    files.sort(key=lambda x: x.name)

    out: list[ImagePage] = []
    for i, f in enumerate(files, start=1):
        data = f.read_bytes()
        # Gemini accepts png bytes; for jpg/webp we still pass bytes with png mime in client right now.
        # Keep bytes as-is; the client mime will be updated when we migrate to google-genai.
        out.append(ImagePage(page_number=i, png_bytes=data, filename=f.name))

    return out
