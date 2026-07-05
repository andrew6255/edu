#!/usr/bin/env python3
"""
OCR Server — Phase 1  (PyMuPDF + Tesseract + pix2text)
=======================================================
Pipeline per page:

  Step 1  PyMuPDF text-layer extraction
            → fast & perfect for digital PDFs that embed text

  Step 2  If text layer is sparse (scanned / image-based PDF):
            a) Render page at 300 DPI
            b) Run pix2text  (layout analysis → Tesseract for prose,
                               LaTeX-OCR model for math formulas)
               Falls back to raw Tesseract if pix2text is unavailable.

  Step 3  Basic post-processing
            → normalise dash variants, flag any remaining artifacts

Output:  <project_root>/output_phase_1.json
Server:  http://localhost:5100

No cloud APIs are used.
"""

import base64
import io
import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Force UTF-8 console output (Windows cp1252 crashes on any non-ASCII print)
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import fitz  # PyMuPDF
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, ImageEnhance, ImageFilter

try:
    import groq
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Optional: Tesseract (fallback when pix2text is unavailable)
# ---------------------------------------------------------------------------
try:
    import pytesseract

    _TESSERACT_PATHS = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for _p in _TESSERACT_PATHS:
        if os.path.isfile(_p):
            pytesseract.pytesseract.tesseract_cmd = _p
            break

    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False

# ---------------------------------------------------------------------------
# Optional: pix2text  (preferred — math-aware OCR)
# ---------------------------------------------------------------------------
PIX2TEXT_AVAILABLE = False
_pix2text_instance = None

try:
    import pix2text as _pix2text_module
    PIX2TEXT_AVAILABLE = True
    print("[OCR Server] pix2text is installed. Models will be loaded on first request.", flush=True)
except ImportError:
    print("[OCR Server] pix2text not found — falling back to Tesseract only.", flush=True)


def get_pix2text():
    """Lazy-load the pix2text instance (downloads models on very first call)."""
    global _pix2text_instance
    if _pix2text_instance is None:
        from pix2text import Pix2Text
        print("[OCR Server] Loading pix2text models (may take a minute on first run)...", flush=True)
        _pix2text_instance = Pix2Text.from_config()
        print("[OCR Server] pix2text models ready.", flush=True)
    return _pix2text_instance

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ROOT_DIR    = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR  = Path(os.environ.get('OCR_OUTPUT_DIR', ROOT_DIR))
OUTPUT_FILE = OUTPUT_DIR / "output_phase_1.json"
OUTPUT_PHASE_2_FILE = OUTPUT_DIR / "output_phase_2.json"

def _load_groq_key() -> str:
    env_file = ROOT_DIR / "artifacts" / "web-app" / ".env.local"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("VITE_GROQ_API_KEY="):
                return line.split("=", 1)[1].strip()
            if line.startswith("GROQ_API_KEY="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("GROQ_API_KEY", "")

GROQ_API_KEY = _load_groq_key()

MIN_CHARS_PER_PAGE = 80
OCR_DPI            = 300

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def render_page(page: fitz.Page, dpi: int = OCR_DPI) -> Image.Image:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return Image.frombytes("RGB", [pix.width, pix.height], pix.samples)


def preprocess_for_tesseract(img: Image.Image) -> Image.Image:
    """Greyscale → contrast boost → double sharpen → binarize."""
    img = img.convert("L")
    img = ImageEnhance.Contrast(img).enhance(2.0)
    img = img.filter(ImageFilter.SHARPEN)
    img = img.filter(ImageFilter.SHARPEN)
    img = img.point(lambda p: 255 if p > 160 else 0, "1")
    return img.convert("RGB")

# ---------------------------------------------------------------------------
# OCR back-ends
# ---------------------------------------------------------------------------

def ocr_with_pix2text(pil_image: Image.Image) -> dict:
    """
    Run a true Hybrid OCR pipeline (Pix2Text + Tesseract):
      1. Use pix2text for layout analysis (finding text vs math blocks)
      2. For 'text' blocks, crop the original 300DPI image and send to Tesseract
         (since Tesseract is vastly superior at standard English prose).
      3. For 'isolated' (pure math) or 'embedding' (inline math) blocks, 
         use pix2text's output (LaTeX-OCR) to preserve math notation perfectly.
    """
    p2t = get_pix2text()
    
    # We use a large resized_shape (2048) so that downscaling doesn't ruin
    # the inline English text inside 'embedding' blocks.
    blocks = p2t.recognize_text_formula(pil_image, return_text=False, resized_shape=2048)
    
    out_lines = []
    
    for box in blocks:
        btype = box.get("type", "text")
        p2t_text = box.get("text", "")
        
        if btype == "text" and TESSERACT_AVAILABLE:
            # Crop the high-res image and run Tesseract for perfect prose
            pos = box.get("position")  # np.ndarray shape [4, 2]
            x_coords = [p[0] for p in pos]
            y_coords = [p[1] for p in pos]
            xmin, xmax = min(x_coords), max(x_coords)
            ymin, ymax = min(y_coords), max(y_coords)
            
            # Expand crop slightly (5px padding)
            w, h = pil_image.size
            xmin = max(0, xmin - 5)
            ymin = max(0, ymin - 5)
            xmax = min(w, xmax + 5)
            ymax = min(h, ymax + 5)
            
            crop = pil_image.crop((xmin, ymin, xmax, ymax))
            tess_result = ocr_with_tesseract(crop)
            tess_text = tess_result.get("text", "").strip()
            
            # Fallback to pix2text if Tesseract yields nothing
            out_lines.append(tess_text if tess_text else p2t_text)
            
        elif btype == "isolated":
            # Pure math -> preserve exact LaTeX block
            out_lines.append(f"$${p2t_text}$$")
            
        else:
            # "embedding" -> inline math mixed with text. 
            # We must use pix2text here so math isn't ruined.
            # We wrap inline math in standard single $
            out_lines.append(p2t_text)

    # Join with newlines
    combined = "\n".join(out_lines)
    
    return {"text": combined, "method": "hybrid_pix2text_tesseract"}


def ocr_with_tesseract(pil_image: Image.Image) -> dict:
    """Run Tesseract after preprocessing. Returns text and method tag."""
    if not TESSERACT_AVAILABLE:
        return {"text": "[Tesseract not available]", "method": "none"}
    processed = preprocess_for_tesseract(pil_image)
    config = "--oem 3 --psm 6 -c preserve_interword_spaces=1"
    text = pytesseract.image_to_string(processed, config=config)
    return {"text": text, "method": "tesseract"}

# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------

def postprocess(text: str) -> str:
    """
    Normalise common OCR artifacts in mathematical text:
      1. All dash variants → plain hyphen-minus
      2. Errant comma before an instruction word → period
      3. Tag suspected fraction artifacts for visibility
    """
    # 1. Dash normalisation
    for ch in ('\u2014', '\u2013', '\u2012', '\u2212', '\u00ad'):
        text = text.replace(ch, '-')

    # 2. Errant comma before a capital instruction word
    text = re.sub(
        r',\s+(List|Find|Write|Generate|The|Calculate|Solve)\b',
        r'. \1', text
    )

    # 3. Tag probable fraction artifacts (leftover Tesseract garbage)
    text = re.sub(
        r'(=\s*-\s*)([a-z]{1,4})(\s*[+\-])',
        lambda m: m.group(0) + ' [OCR_FRACTION_ARTIFACT?]',
        text,
    )
    return text

# ---------------------------------------------------------------------------
# Page extraction
# ---------------------------------------------------------------------------

def extract_page(page: fitz.Page, page_num: int) -> dict:
    """Extract text from a single PDF page. Returns per-page result dict."""

    # Step 1 — try embedded text layer
    raw_text = page.get_text("text").strip()
    
    # Bypass pymupdf text layer if pix2text is available because pymupdf ruins math formatting
    if not PIX2TEXT_AVAILABLE and len(raw_text) >= MIN_CHARS_PER_PAGE:
        text = postprocess(raw_text)
        return {
            "page": page_num + 1,
            "method": "pymupdf_text_layer",
            "char_count": len(text),
            "text": text,
        }

    # Step 2 — render at 300 DPI and run math-aware OCR
    pil_img = render_page(page)

    if PIX2TEXT_AVAILABLE:
        try:
            result = ocr_with_pix2text(pil_img)
            text = postprocess(result["text"].strip())
            return {
                "page": page_num + 1,
                "method": "pix2text",
                "char_count": len(text),
                "text": text,
            }
        except Exception as e:
            print(f"[OCR Server] pix2text failed on page {page_num+1}: {e} — falling back to Tesseract", flush=True)

    # Fallback: Tesseract
    result = ocr_with_tesseract(pil_img)
    text = postprocess(result["text"].strip())
    return {
        "page": page_num + 1,
        "method": "tesseract_ocr",
        "char_count": len(text),
        "text": text,
    }


def extract_from_pdf(file_bytes: bytes) -> dict:
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages_result = []

    for i in range(len(doc)):
        page_result = extract_page(doc[i], i)
        pages_result.append(page_result)

    doc.close()

    full_text = "\n\n--- PAGE BREAK ---\n\n".join(p["text"] for p in pages_result)
    methods_used = sorted({p["method"] for p in pages_result})

    return {
        "pages": pages_result,
        "full_text": full_text,
        "page_count": len(pages_result),
        "methods_used": methods_used,
    }


def extract_from_image(file_bytes: bytes) -> dict:
    pil_img = Image.open(io.BytesIO(file_bytes)).convert("RGB")

    if PIX2TEXT_AVAILABLE:
        try:
            result = ocr_with_pix2text(pil_img)
            text = postprocess(result["text"].strip())
            method = "pix2text"
        except Exception as e:
            print(f"[OCR Server] pix2text failed: {e} — falling back to Tesseract", flush=True)
            result = ocr_with_tesseract(pil_img)
            text = postprocess(result["text"].strip())
            method = "tesseract_ocr"
    else:
        result = ocr_with_tesseract(pil_img)
        text = postprocess(result["text"].strip())
        method = "tesseract_ocr"

    page = {"page": 1, "method": method, "char_count": len(text), "text": text}
    return {
        "pages": [page],
        "full_text": text,
        "page_count": 1,
        "methods_used": [method],
    }

# ---------------------------------------------------------------------------
# Flask routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "pix2text_available": PIX2TEXT_AVAILABLE,
        "tesseract_available": TESSERACT_AVAILABLE,
        "pymupdf_version": fitz.__version__,
        "groq_api_key_loaded": bool(GROQ_API_KEY),
    })


@app.route("/ocr/phase1", methods=["POST"])
def phase1_ocr():
    try:
        body = request.get_json(force=True)
        if not body:
            return jsonify({"error": "Empty request body"}), 400

        file_name   = body.get("fileName", "unknown")
        mime_type   = body.get("mimeType", "application/pdf")
        content_b64 = body.get("contentBase64", "")
        title       = body.get("title") or file_name

        if not content_b64:
            return jsonify({"error": "contentBase64 is required"}), 400

        file_bytes = base64.b64decode(content_b64)
        print(f"[OCR Server] Processing '{file_name}' ({len(file_bytes)//1024} KB) ...", flush=True)

        if mime_type == "application/pdf" or file_name.lower().endswith(".pdf"):
            result = extract_from_pdf(file_bytes)
        else:
            result = extract_from_image(file_bytes)

        output = {
            "phase": "phase1_ocr",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": {
                "file_name": file_name,
                "title": title,
                "mime_type": mime_type,
                "size_bytes": len(file_bytes),
            },
            "result": result,
            "debug": {
                "pix2text_available": PIX2TEXT_AVAILABLE,
                "tesseract_available": TESSERACT_AVAILABLE,
                "pymupdf_version": fitz.__version__,
            },
        }

        OUTPUT_FILE.write_text(
            json.dumps(output, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"[OCR Server] Done — wrote {OUTPUT_FILE}", flush=True)
        return jsonify(output)

    except Exception as exc:
        traceback.print_exc()
        error_output = {
            "phase": "phase1_ocr",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        try:
            OUTPUT_FILE.write_text(
                json.dumps(error_output, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass
        return jsonify({"error": str(exc)}), 500


@app.route("/ocr/phase2", methods=["POST"])
def phase2_questions():
    try:
        body = request.get_json(force=True)
        text = body.get("text", "")
        if not text:
            return jsonify({"error": "No text provided"}), 400

        if not GROQ_API_KEY:
            return jsonify({"error": "GROQ_API_KEY not found in .env.local"}), 401

        client = groq.Groq(api_key=GROQ_API_KEY)

        # ── PASS 1 ─────────────────────────────────────────────────────────────
        # Structural analysis + Q&A pairing.
        # The LLM first understands the layout of the document (questions section,
        # answer-key section, inline answers, etc.) and extracts every Q&A pair.
        # If no answer exists in the PDF it generates a correct model answer.
        # ────────────────────────────────────────────────────────────────────────
        pass1_system = (
            "You are a strict educational document parser. Your job is to extract every "
            "question from a worksheet/exam and match it with its correct answer.\n\n"
            "STEP 1 — Understand the document structure:\n"
            "  • Look for an 'Answer Key', 'Answers', 'Solutions' section (often at the end).\n"
            "  • Answers may also appear inline right after each question.\n"
            "  • Irrelevant content (headers, student names, dates, instructions, page numbers) must be DROPPED.\n\n"
            "STEP 2 — Extract every question:\n"
            "  • Extract EXACTLY as written. Do NOT rephrase.\n"
            "  • If a shared instruction applies to multiple independent sub-items "
            "(e.g. 'Find the derivative: a) f(x)=cos(x) b) f(x)=sin(x)'), expand each into a "
            "fully self-contained question by prepending the instruction. Output 'Find the derivative of f(x)=cos(x)' "
            "AND 'Find the derivative of f(x)=sin(x)' as SEPARATE questions.\n"
            "  • CRITICAL: Preserve ALL mathematical notation and LaTeX. You MUST wrap all math, equations, and symbols in $...$ (inline) or $$...$$ (display) delimiters if they are not already wrapped.\n"
            "  • Double-escape all LaTeX backslashes for valid JSON (e.g. '\\\\frac' not '\\frac').\n\n"
            "STEP 3 — Match each question to its answer:\n"
            "  • Use any Answer Key, inline answer, or worked solution found in the PDF.\n"
            "  • Set 'answerFromPdf': true when an answer was found in the document.\n"
            "  • If no answer exists in the PDF, GENERATE a correct model answer yourself and set 'answerFromPdf': false.\n\n"
            "OUTPUT FORMAT — Return ONLY a valid JSON object with this exact shape:\n"
            "{\n"
            "  \"questions\": [\n"
            "    {\n"
            "      \"id\": \"q_1\",\n"
            "      \"label\": \"1.\",\n"
            "      \"rawText\": \"Exact question text here\",\n"
            "      \"answerFromPdf\": true,\n"
            "      \"rawAnswerText\": \"Answer exactly as in PDF, or null\",\n"
            "      \"modelAnswer\": \"Clean, correct final answer\"\n"
            "    }\n"
            "  ]\n"
            "}\n"
        )

        print("[OCR Server] Phase 2 — Pass 1: Extracting Q&A pairs...", flush=True)
        pass1_response = client.chat.completions.create(
            messages=[
                {"role": "system", "content": pass1_system},
                {"role": "user", "content": text}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.0,
            response_format={"type": "json_object"}
        )

        pass1_json = json.loads(pass1_response.choices[0].message.content)
        qa_pairs = pass1_json.get("questions", [])
        print(f"[OCR Server] Phase 2 — Pass 1 done. Extracted {len(qa_pairs)} Q&A pair(s).", flush=True)

        if not qa_pairs:
            result_json = {"topics": []}
        else:
            # ── PASS 2 ─────────────────────────────────────────────────────────
            # Classification into fine-grained question types.
            # The LLM sees ALL questions together so it can reason holistically
            # about what makes each cluster distinct.
            # ──────────────────────────────────────────────────────────────────
            pass2_system = (
                "You are an expert curriculum designer. You are given a list of extracted math/science questions "
                "from a single worksheet. Your job is to classify them into specific, descriptive question types.\n\n"
                "RULES FOR QUESTION TYPE NAMES:\n"
                "  • Names must be SPECIFIC and DESCRIPTIVE, not generic.\n"
                "  • Good examples: 'Finding equation of line using two points', "
                "'Expanding using Newton's Binomial Theorem', 'Solving quadratic by completing the square'.\n"
                "  • Bad examples: 'Line questions', 'Algebra', 'Practice'.\n"
                "  • If there are subtle differences between groups of questions, create separate types for each.\n"
                "  • Analyze ALL questions together before deciding on types — don't classify one at a time.\n\n"
                "OUTPUT FORMAT — Return ONLY a valid JSON object with this exact shape:\n"
                "{\n"
                "  \"topics\": [\n"
                "    {\n"
                "      \"id\": \"t1\",\n"
                "      \"title\": \"Specific descriptive question type name\",\n"
                "      \"questions\": [\n"
                "        {\n"
                "          \"id\": \"q_1\",\n"
                "          \"label\": \"1.\",\n"
                "          \"rawText\": \"Exact question text\",\n"
                "          \"answerFromPdf\": true,\n"
                "          \"rawAnswerText\": \"answer or null\",\n"
                "          \"modelAnswer\": \"clean correct answer\"\n"
                "        }\n"
                "      ]\n"
                "    }\n"
                "  ]\n"
                "}\n"
                "IMPORTANT: Include ALL question IDs from the input. Do not drop any questions."
            )

            # Compact input for Pass 2 (summaries only — saves tokens)
            pass2_input = json.dumps({
                "questions": [
                    {"id": q.get("id"), "rawText": q.get("rawText"), "modelAnswer": q.get("modelAnswer")}
                    for q in qa_pairs
                ]
            }, ensure_ascii=False)

            print("[OCR Server] Phase 2 — Pass 2: Classifying into question types...", flush=True)
            pass2_response = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": pass2_system},
                    {"role": "user", "content": pass2_input}
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.0,
                response_format={"type": "json_object"}
            )

            pass2_json = json.loads(pass2_response.choices[0].message.content)
            topics_raw = pass2_json.get("topics", [])

            # Merge the full Q&A data (from Pass 1) back into the classified topics
            qa_by_id = {q.get("id"): q for q in qa_pairs}
            topics_merged = []
            for topic in topics_raw:
                merged_questions = []
                for q in topic.get("questions", []):
                    full_q = qa_by_id.get(q.get("id"), q)
                    merged_questions.append(full_q)
                topics_merged.append({
                    "id": topic.get("id"),
                    "title": topic.get("title"),
                    "questions": merged_questions,
                })

            result_json = {"topics": topics_merged}

        print(f"[OCR Server] Phase 2 Done — {len(result_json.get('topics', []))} topic(s).", flush=True)

        output = {
            "phase": "phase2_questions",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "result": result_json
        }

        OUTPUT_PHASE_2_FILE.write_text(
            json.dumps(output, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

        return jsonify(output)

    except Exception as exc:
        traceback.print_exc()
        error_output = {
            "phase": "phase2_questions",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }
        try:
            OUTPUT_PHASE_2_FILE.write_text(
                json.dumps(error_output, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception:
            pass
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import logging
    from waitress import serve
    
    print(f"[OCR Server] PyMuPDF   : {fitz.__version__}", flush=True)
    print(f"[OCR Server] pix2text  : {'yes' if PIX2TEXT_AVAILABLE else 'no (install: pip install pix2text)'}", flush=True)
    print(f"[OCR Server] Tesseract : {'yes' if TESSERACT_AVAILABLE else 'no'}", flush=True)
    print(f"[OCR Server] Output    : {OUTPUT_FILE}", flush=True)
    print(f"[OCR Server] Starting on http://0.0.0.0:5100 ...", flush=True)
    
    # Use Waitress WSGI server for production
    serve(app, host="0.0.0.0", port=5100, threads=8)
