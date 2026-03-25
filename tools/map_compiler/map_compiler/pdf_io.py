from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional

import fitz  # pymupdf
from PIL import Image


@dataclass
class PageContent:
    page_number: int  # 1-based
    text: str
    png_bytes: bytes


def load_pdf_pages(
    pdf_path: str,
    *,
    start_page: Optional[int] = None,
    end_page: Optional[int] = None,
    dpi: int = 150,
) -> list[PageContent]:
    doc = fitz.open(pdf_path)
    try:
        total = doc.page_count
        start = max(1, start_page or 1)
        end = min(total, end_page or total)
        if start > end:
            raise ValueError("start_page must be <= end_page")

        out: list[PageContent] = []
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)

        for pno in range(start - 1, end):
            page = doc.load_page(pno)
            text = page.get_text("text") or ""

            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            png_bytes = buf.getvalue()

            out.append(PageContent(page_number=pno + 1, text=text, png_bytes=png_bytes))

        return out
    finally:
        doc.close()
