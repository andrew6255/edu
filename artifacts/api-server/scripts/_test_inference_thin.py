"""Smoke test simulating real freehand drawing: thin strokes on a large canvas."""
import base64
import io
import json
import subprocess

from PIL import Image, ImageDraw, ImageFont


def stroke_digit(digit: str, size_px: int = 220, line_width: int = 4) -> str:
    img = Image.new("RGB", (300, 320), "white")
    draw = ImageDraw.Draw(img)
    # Use default font scaled up by rendering at small size then resizing... simpler: use truetype if available.
    try:
        font = ImageFont.truetype("arial.ttf", size_px)
    except Exception:
        font = ImageFont.load_default()
    # Draw thin outline by painting many slightly offset copies (cheap stroke).
    for dx in range(-line_width // 2, line_width // 2 + 1):
        for dy in range(-line_width // 2, line_width // 2 + 1):
            draw.text((40 + dx, 30 + dy), digit, fill="black", font=font)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    payload = json.dumps({"imageBase64": b64})
    r = subprocess.run(
        ["py", "-3.13", "digit_classifier_inference.py", payload],
        capture_output=True,
        text=True,
    )
    try:
        parsed = json.loads(r.stdout)
        return f"{digit} -> {parsed['symbol']} ({parsed['confidence']:.2f})"
    except Exception as exc:
        return f"{digit} -> ERROR ({exc})"


if __name__ == "__main__":
    for d in "0123456789":
        print(stroke_digit(d))
