import sys
from pathlib import Path
from PIL import Image
from pix2text import Pix2Text
import fitz

pdf_path = r"C:\Users\antoi\OneDrive\Desktop\edu\Equation20a line.pdf"

doc = fitz.open(pdf_path)
page = doc[0]
pix = page.get_pixmap(matrix=fitz.Matrix(300/72, 300/72))
img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

p2t = Pix2Text.from_config()

# Default
print("--- DEFAULT ---")
text_default = p2t.recognize_text_formula(img, return_text=True)
print(text_default[:500])

# Resized 1536
print("\n--- RESIZED 1536 ---")
text_1536 = p2t.recognize_text_formula(img, return_text=True, resized_shape=1536)
print(text_1536[:500])

# Resized 2048
print("\n--- RESIZED 2048 ---")
text_2048 = p2t.recognize_text_formula(img, return_text=True, resized_shape=2048)
print(text_2048[:500])
