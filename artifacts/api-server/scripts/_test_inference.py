"""Quick smoke test for the digit classifier across all digits."""
import base64
import io
import json
import subprocess
import sys

from PIL import Image, ImageDraw


def test_digit(digit: str) -> str:
    img = Image.new("RGB", (180, 200), "white")
    draw = ImageDraw.Draw(img)
    draw.text((60, 40), digit, fill="black")
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
        print(test_digit(d))
