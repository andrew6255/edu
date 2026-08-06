import sys
import json
import fitz
import base64
import cv2
import numpy as np
import zipfile
import xml.etree.ElementTree as ET
import os
import re

def load_universal_doc(file_path):
    try:
        # PyMuPDF natively opens PDF, PNG, JPG, WEBP, BMP, TIFF, TXT, XPS, EPUB, etc.
        return fitz.open(file_path)
    except Exception as e:
        # If fitz fails (e.g. for .docx, .doc, .rtf, or unsupported format), build a doc in memory
        doc = fitz.open()
        text_content = ""

        # Check if it is a Word document (.docx / .pptx ZIP archive)
        if zipfile.is_zipfile(file_path):
            try:
                with zipfile.ZipFile(file_path, 'r') as z:
                    for name in z.namelist():
                        if name.endswith('document.xml') or name.endswith('slide1.xml'):
                            xml_bytes = z.read(name)
                            root = ET.fromstring(xml_bytes)
                            paragraphs = []
                            for p in root.iter():
                                if p.tag.endswith('}p'):
                                    p_text = "".join(node.text for node in p.iter() if node.tag.endswith('}t') and node.text)
                                    if p_text.strip():
                                        paragraphs.append(p_text.strip())
                            if paragraphs:
                                text_content += "\n\n".join(paragraphs) + "\n\n"
                        # Also check if there are embedded media images in word/media/
                        elif name.startswith('word/media/') or name.startswith('ppt/media/'):
                            try:
                                img_bytes = z.read(name)
                                img_doc = fitz.open(stream=img_bytes, filetype=name.split('.')[-1])
                                if len(img_doc) > 0:
                                    doc.insert_pdf(img_doc)
                            except Exception:
                                pass
            except Exception:
                pass

        # If no text extracted from ZIP/XML, try reading as plain text (utf-8 or latin-1)
        if not text_content.strip() and len(doc) == 0:
            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    text_content = f.read()
            except Exception:
                pass

        # If we found text content, insert it into PDF pages in memory
        if text_content.strip():
            lines = text_content.split('\n')
            current_page = doc.new_page(width=595, height=842)
            y = 40
            for line in lines:
                if y > 800:
                    current_page = doc.new_page(width=595, height=842)
                    y = 40
                current_page.insert_text((40, y), line[:100], fontsize=11)
                y += 16
                if len(line) > 100:
                    for i in range(100, len(line), 100):
                        if y > 800:
                            current_page = doc.new_page(width=595, height=842)
                            y = 40
                        current_page.insert_text((50, y), line[i:i+100], fontsize=11)
                        y += 16

        # If still empty after everything, create at least 1 blank page
        if len(doc) == 0:
            p = doc.new_page(width=595, height=842)
            p.insert_text((50, 50), f"[Document Content from {os.path.basename(file_path)}]", fontsize=12)

        return doc


def auto_trim_crop(crop_img):
    """Trim excess white/empty border from a cropped image, then re-add a small padding."""
    if crop_img is None or crop_img.size == 0:
        return crop_img
    gray_crop = cv2.cvtColor(crop_img, cv2.COLOR_BGR2GRAY) if len(crop_img.shape) == 3 else crop_img.copy()
    # Invert so content is white on black for findNonZero
    _, thresh_crop = cv2.threshold(gray_crop, 250, 255, cv2.THRESH_BINARY_INV)
    coords = cv2.findNonZero(thresh_crop)
    if coords is None:
        return crop_img  # All-white — return as-is
    x, y, w, h = cv2.boundingRect(coords)
    # Add a small padding back (8px) to not cut edges
    pad = 8
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(crop_img.shape[1], x + w + pad)
    y1 = min(crop_img.shape[0], y + h + pad)
    trimmed = crop_img[y0:y1, x0:x1]
    if trimmed.size == 0:
        return crop_img
    return trimmed


# Breathing room drawn around every extracted figure, as a fraction of its larger
# side, with a floor in pixels. Pages render at 2x, so 28px reads as ~14pt.
FIGURE_MARGIN_RATIO = 0.06
FIGURE_MARGIN_MIN_PX = 28
FIGURE_MARGIN_MAX_PX = 90


def add_white_margin(crop_img):
    """Frame a crop in white so the figure's own borders stay visible.

    Padding the crop *before* cutting cannot solve this: for a native image the
    crop box is already exactly the figure, so widening it pulls in neighbouring
    page content, and auto_trim_crop can only re-pad within what it was given.
    Compositing a margin afterwards is independent of what surrounds the figure
    on the page, so a square with a white background no longer comes out cut
    exactly on its outline.
    """
    if crop_img is None or crop_img.size == 0:
        return crop_img
    h, w = crop_img.shape[:2]
    margin = int(round(FIGURE_MARGIN_RATIO * max(h, w)))
    margin = max(FIGURE_MARGIN_MIN_PX, min(FIGURE_MARGIN_MAX_PX, margin))
    return cv2.copyMakeBorder(
        crop_img, margin, margin, margin, margin,
        cv2.BORDER_CONSTANT, value=(255, 255, 255),
    )


def draw_label_with_bg(img, label, x, y, font_scale=1.0, thickness=2):
    """Draw a label string with a white filled background rectangle for maximum readability."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    (lw, lh), baseline = cv2.getTextSize(label, font, font_scale, thickness)
    lx = x
    ly = max(y - 12, lh + 6)
    # White background rectangle
    cv2.rectangle(img, (lx - 3, ly - lh - 5), (lx + lw + 5, ly + baseline + 2), (255, 255, 255), -1)
    # Red border for visibility
    cv2.rectangle(img, (lx - 3, ly - lh - 5), (lx + lw + 5, ly + baseline + 2), (0, 0, 220), 2)
    cv2.putText(img, label, (lx, ly), font, font_scale, (0, 0, 200), thickness)


def overlaps_native(vbox, native_boxes, threshold=0.5):
    """Check if a vector box substantially overlaps with any native image box."""
    vx0, vy0, vx1, vy1 = vbox
    va = max(0, vx1 - vx0) * max(0, vy1 - vy0)
    if va == 0:
        return True
    for nb in native_boxes:
        nx0, ny0, nx1, ny1 = nb
        ix0, iy0 = max(vx0, nx0), max(vy0, ny0)
        ix1, iy1 = min(vx1, nx1), min(vy1, ny1)
        inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
        if inter / va > threshold:
            return True
    return False


def merge_boxes(boxes, tolerance=20):
    """Merge overlapping or closely adjacent bounding boxes."""
    if not boxes:
        return []
    merged = True
    while merged:
        merged = False
        new_boxes = []
        while boxes:
            box = boxes.pop(0)
            x0, y0, x1, y1 = box
            i = 0
            while i < len(boxes):
                bx0, by0, bx1, by1 = boxes[i]
                if not (x1 + tolerance < bx0 or bx1 + tolerance < x0 or y1 + tolerance < by0 or by1 + tolerance < y0):
                    x0 = min(x0, bx0)
                    y0 = min(y0, by0)
                    x1 = max(x1, bx1)
                    y1 = max(y1, by1)
                    boxes.pop(i)
                    merged = True
                else:
                    i += 1
            new_boxes.append([x0, y0, x1, y1])
        boxes = new_boxes
    return [{'bbox': b} for b in boxes]


def sort_reading_order(boxes):
    """Sort bboxes in natural reading order (top-to-bottom, left-to-right)."""
    if not boxes:
        return []
    boxes.sort(key=lambda d: d['bbox'][1])
    rows = []
    current_row = [boxes[0]]
    current_y = boxes[0]['bbox'][1]
    for box in boxes[1:]:
        if abs(box['bbox'][1] - current_y) < 40:
            current_row.append(box)
        else:
            rows.append(current_row)
            current_row = [box]
            current_y = box['bbox'][1]
    rows.append(current_row)
    sorted_boxes = []
    for row in rows:
        row.sort(key=lambda d: d['bbox'][0])
        sorted_boxes.extend(row)
    return sorted_boxes


def extract_pdf(pdf_path, mode="text"):
    doc = load_universal_doc(pdf_path)
    pages_data = []
    global_img_idx = 0

    for i in range(len(doc)):
        page = doc[i]

        if mode == "render":
            SCALE = 2.0  # 2x zoom for clarity
            zoom_matrix = fitz.Matrix(SCALE, SCALE)
            pix = page.get_pixmap(matrix=zoom_matrix, alpha=False)

            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
            if pix.n == 4:
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
            else:
                img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

            clean_img = img.copy()
            h_img, w_img = img.shape[:2]

            # ── Extract text blocks for spatial metadata ──────────────────────────
            text_blocks = page.get_text("blocks")
            # Determine if this is a scanned/image-based page (very little selectable text)
            page_text = page.get_text("text").strip()
            is_scanned_page = len(page_text) < 30

            # ── Priority A: Native raster image XObjects (pixel-perfect bboxes) ──
            # PyMuPDF knows the exact placement rect of every embedded raster image.
            # EXCEPTION: If a native image covers most of the page, it is the page background
            # (e.g. a scanned PNG uploaded as a document). We reject those so that contour
            # detection can find actual figures within the rendered pixels instead.
            native_boxes = []
            page_area = w_img * h_img
            try:
                for img_info in page.get_images(full=True):
                    xref = img_info[0]
                    rects = page.get_image_rects(xref)
                    for rect in rects:
                        if rect.is_empty or rect.is_infinite:
                            continue
                        x0 = int(rect.x0 * SCALE)
                        y0 = int(rect.y0 * SCALE)
                        x1 = int(rect.x1 * SCALE)
                        y1 = int(rect.y1 * SCALE)
                        # Clamp to image bounds
                        x0, y0 = max(0, x0), max(0, y0)
                        x1, y1 = min(w_img, x1), min(h_img, y1)
                        w_box = x1 - x0
                        h_box = y1 - y0
                        box_area = w_box * h_box
                        if box_area < 500:
                            continue
                        # CRITICAL: Reject background/full-page images.
                        # If one native image covers >55% of the page, it is the scan background,
                        # not a figure. We let contour detection handle these pages instead.
                        if box_area / page_area > 0.55:
                            continue
                        # Filter header/footer noise
                        cy = (y0 + y1) / 2.0
                        if (cy < h_img * 0.04 or cy > h_img * 0.96) and h_box < 50:
                            continue
                        native_boxes.append([x0, y0, x1, y1])
            except Exception:
                pass

            # ── Priority B: OpenCV contour detection for vector / drawn figures ──
            # Mask out all text blocks AND native image areas before detecting contours
            # so that only pure vector-drawn shapes remain.
            mask_img = img.copy()
            for b in text_blocks:
                if b[6] == 0:  # text block
                    bx0, by0, bx1, by1 = [int(v * SCALE) for v in b[:4]]
                    cv2.rectangle(mask_img, (max(0, bx0 - 2), max(0, by0 - 2)), (bx1 + 2, by1 + 2), (255, 255, 255), -1)
            # Also mask out native image regions to prevent duplicate detection
            for nb in native_boxes:
                cv2.rectangle(mask_img, (nb[0], nb[1]), (nb[2], nb[3]), (255, 255, 255), -1)

            gray = cv2.cvtColor(mask_img, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)

            # TIGHTER kernel (8×8 instead of 15×15) to avoid merging separate question elements
            kernel = np.ones((8, 8), np.uint8)
            dilated = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
            dilated = cv2.dilate(dilated, kernel, iterations=1)  # Only 1 iteration

            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            # Adaptive minimum area: scanned pages need a much higher threshold because
            # character glyphs like "(A)", "(B)" etc. appear as small dark blobs.
            # Digital PDF pages: 500px minimum. Scanned pages: 3500px minimum.
            min_contour_area = 3500 if is_scanned_page else 500

            vector_boxes = []
            for c in contours:
                x, y, w, h = cv2.boundingRect(c)
                area = w * h
                if area < min_contour_area:
                    continue
                # Minimum absolute dimensions — nothing that could be a single character or letter label
                if w < 40 or h < 40:
                    continue
                # Filter header/footer noise
                cy = y + h / 2.0
                if (cy < h_img * 0.04 or cy > h_img * 0.96) and h < 60:
                    continue
                # CRITICAL: Reject contours that span too much of the page — these are
                # almost certainly a full-question-block merge artifact, not a real figure.
                width_ratio = w / w_img
                height_ratio = h / h_img
                if width_ratio > 0.75 and height_ratio > 0.30:
                    continue
                # Reject by absolute area (>25% of page = suspicious merge)
                if area > (w_img * h_img * 0.25):
                    continue
                # Reject very narrow tall strips or very wide flat strips (table lines, separators)
                aspect = max(w, h) / max(min(w, h), 1)
                if aspect > 12:
                    continue
                vector_boxes.append([x, y, x + w, y + h])

            # Merge nearby vector boxes (smaller tolerance than before to keep figures separate)
            vector_bboxes = merge_boxes(vector_boxes, tolerance=20)

            # Combine: native raster images first (most accurate), then non-overlapping vector figures
            all_raw_boxes = [{'bbox': b} for b in native_boxes]
            for vb in vector_bboxes:
                if not overlaps_native(vb['bbox'], native_boxes, threshold=0.4):
                    all_raw_boxes.append(vb)

            # Sort in reading order
            bboxes = sort_reading_order(all_raw_boxes)

            images_dict = {}
            image_metadata = {}

            for box in bboxes:
                x0, y0, x1, y1 = box['bbox']
                label = f"[IMG_{global_img_idx}]"

                # Draw red bounding box on annotated page
                cv2.rectangle(img, (x0, y0), (x1, y1), (0, 0, 255), 3)

                # Draw label with white background above the box for maximum readability
                draw_label_with_bg(img, label, x0, y0, font_scale=1.0, thickness=2)

                # ── Crop from the clean (unannotated) image ──────────────────────
                # Native PDF images: no extra padding (already pixel-perfect)
                # Vector/drawn figures: small padding only
                is_native = any(abs(x0 - nb[0]) < 6 and abs(y0 - nb[1]) < 6 for nb in native_boxes)
                if is_native:
                    cx0, cy0, cx1, cy1 = x0, y0, x1, y1
                else:
                    pad = 10
                    cx0 = max(0, x0 - pad)
                    cy0 = max(0, y0 - pad)
                    cx1 = min(w_img, x1 + pad)
                    cy1 = min(h_img, y1 + pad)

                cropped = clean_img[cy0:cy1, cx0:cx1]
                # Tighten to the actual content, then frame it in white so the
                # figure's outline is clearly visible rather than flush to the edge.
                cropped = auto_trim_crop(cropped)
                cropped = add_white_margin(cropped)

                success, buffer = cv2.imencode('.png', cropped)
                if success:
                    b64_img = base64.b64encode(buffer).decode('utf-8')
                    images_dict[label] = f"data:image/png;base64,{b64_img}"

                # ── Spatial proximity analysis ────────────────────────────────────
                # Find the nearest choice label (A, B, C...) to the LEFT of or DIRECTLY ABOVE the image.
                # This is used as a deterministic fallback when the AI misidentifies image placements.
                nearest_text_before = ""
                nearest_choice_label = None
                min_y_dist = float('inf')
                min_x_dist = float('inf')

                for tb in text_blocks:
                    if tb[6] != 0:
                        continue
                    tx0_s = int(tb[0] * SCALE)
                    ty0_s = int(tb[1] * SCALE)
                    tx1_s = int(tb[2] * SCALE)
                    ty1_s = int(tb[3] * SCALE)
                    t_str = tb[4].strip()
                    if not t_str:
                        continue

                    # Direction 1: choice label to the LEFT of this image (same vertical band)
                    vert_overlap = max(y0, ty0_s) < min(y1, ty1_s) + 20
                    if vert_overlap and tx1_s <= x0 + 20 and (x0 - tx1_s) < min_x_dist and (x0 - tx1_s) < 160:
                        min_x_dist = x0 - tx1_s
                        m = re.match(r'^(?:Option\s*)?([A-Ea-e])[\.\)\:]', t_str.strip())
                        if not m:
                            m = re.search(r'\b([A-Ea-e])[\.\)\:]', t_str.strip())
                        if m:
                            nearest_choice_label = (m.group(1)).upper()

                    # Direction 2: choice label DIRECTLY ABOVE the image (close vertical distance)
                    if nearest_choice_label is None:
                        is_above = ty1_s <= y0 + 5 and (y0 - ty1_s) < 80
                        horiz_align = (max(x0, tx0_s) < min(x1, tx1_s)) or (abs(x0 - tx0_s) < 100)
                        if is_above and horiz_align and (y0 - ty1_s) < min_y_dist:
                            m = re.match(r'^(?:Option\s*)?([A-Ea-e])[\.\)\:]', t_str.strip())
                            if not m:
                                m = re.search(r'\b([A-Ea-e])[\.\)\:]', t_str.strip())
                            if m:
                                min_y_dist = y0 - ty1_s
                                nearest_choice_label = (m.group(1)).upper()

                    # Vertical proximity above for question context (used by controller.ts matching)
                    if ty1_s <= y0 + 10 and (y0 - ty1_s) < 300:
                        horiz_overlap = (max(x0, tx0_s) < min(x1, tx1_s)) or (abs(x0 - tx0_s) < 200)
                        if horiz_overlap:
                            dist = y0 - ty1_s
                            # Track the closest text block above (regardless of it being a choice label)
                            existing_dist = min_y_dist if nearest_choice_label is None else float('inf')
                            if dist < existing_dist:
                                nearest_text_before = t_str[:150].replace('\n', ' ')

                image_metadata[label] = {
                    "bbox": [x0, y0, x1, y1],
                    "nearestTextBefore": nearest_text_before,
                    "nearestChoiceLabel": nearest_choice_label,
                    "isNativeImage": is_native,
                }

                global_img_idx += 1

            # Encode full annotated page PNG for the vision model
            success, buffer = cv2.imencode('.png', img)
            b64_png = base64.b64encode(buffer).decode("ascii")

            pages_data.append({
                "page": i + 1,
                "pngBase64": b64_png,
                "images": images_dict,
                "imageMetadata": image_metadata,
            })

        else:
            # Original text extraction mode (used for answer key PDFs)
            text = page.get_text("text")
            images = []
            image_list = page.get_images(full=True)
            for img_index, img_info in enumerate(image_list):
                xref = img_info[0]
                try:
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]
                    b64_img = base64.b64encode(image_bytes).decode('utf-8')
                    mime_type = "image/jpeg" if image_ext == "jpeg" else f"image/{image_ext}"
                    data_uri = f"data:{mime_type};base64,{b64_img}"
                    images.append(data_uri)
                except Exception:
                    pass

            pages_data.append({
                "page": i + 1,
                "text": text.strip(),
                "images": images,
            })

    print(json.dumps({"pages": pages_data}))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    mode = "text"
    if len(sys.argv) >= 3 and sys.argv[2] == "--render":
        mode = "render"
    extract_pdf(sys.argv[1], mode)
