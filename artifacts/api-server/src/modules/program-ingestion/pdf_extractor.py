import sys
import json
import fitz
import base64
import cv2
import numpy as np
import zipfile
import xml.etree.ElementTree as ET
import os

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
            # Create standard A4 pages and insert text
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
        
        # If still empty after everything, create at least 1 blank page with filename so pipeline doesn't crash
        if len(doc) == 0:
            p = doc.new_page(width=595, height=842)
            p.insert_text((50, 50), f"[Document Content from {os.path.basename(file_path)}]", fontsize=12)
            
        return doc

def extract_pdf(pdf_path, mode="text"):
    doc = load_universal_doc(pdf_path)
    pages_data = []
    global_img_idx = 0

    for i in range(len(doc)):
        page = doc[i]

        if mode == "render":
            # 1. Rasterize page (2x scale to stay under Groq token limits!)
            zoom_matrix = fitz.Matrix(2, 2)
            pix = page.get_pixmap(matrix=zoom_matrix, alpha=False)
            
            # Convert to numpy array for OpenCV
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
            if pix.n == 4:
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
            else:
                img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

            clean_img = img.copy()

            # 2. Extract text words & blocks for spatial layout matching
            text_blocks = page.get_text("blocks")
            text_words = page.get_text("words") # (x0, y0, x1, y1, word, block_no, line_no, word_no)
            
            mask_img = img.copy()
            for b in text_blocks:
                # block_type == 0 means text
                if b[6] == 0:
                    x0, y0, x1, y1 = [int(v * 2) for v in b[:4]]
                    # Expand the text mask slightly to ensure text is fully erased
                    cv2.rectangle(mask_img, (max(0, x0-2), max(0, y0-2)), (x1+2, y1+2), (255, 255, 255), -1)

            # 3. Contour Detection
            gray = cv2.cvtColor(mask_img, cv2.COLOR_BGR2GRAY)
            # Threshold to get dark elements on white background
            _, thresh = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
            
            # Morphological operations to group nearby lines/shapes into single figures
            kernel = np.ones((15, 15), np.uint8)
            dilated = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
            dilated = cv2.dilate(dilated, kernel, iterations=2)

            contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            # Filter contours and gather initial boxes
            min_area = 200
            h_img, w_img = img.shape[:2]
            raw_boxes = []
            for c in contours:
                x, y, w, h = cv2.boundingRect(c)
                if w * h > min_area:
                    # Filter out thin header/footer noise (top/bottom 4% of page)
                    cy = y + h / 2.0
                    if (cy < h_img * 0.04 or cy > h_img * 0.96) and h < 50:
                        continue
                    raw_boxes.append([x, y, x+w, y+h])

            # Merge overlapping or closely adjacent bounding boxes (Spatial Consolidation)
            def merge_boxes(boxes, tolerance=35):
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
                            # Check if boxes overlap or are within tolerance distance
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

            bboxes = merge_boxes(raw_boxes)

            # Sort reading order (group by rows)
            def sort_reading_order(boxes):
                if not boxes: return []
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

            bboxes = sort_reading_order(bboxes)

            images_dict = {}
            image_metadata = {}
            
            import re

            for box in bboxes:
                x0, y0, x1, y1 = box['bbox']
                label = f"[IMG_{global_img_idx}]"
                
                # Draw red box and label on the annotated image
                cv2.rectangle(img, (x0, y0), (x1, y1), (0, 0, 255), 3)
                cv2.putText(img, label, (x0, max(y0 - 10, 20)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                
                # Crop from clean image with padding
                pad = 25
                cx0 = max(0, x0 - pad)
                cy0 = max(0, y0 - pad)
                cx1 = min(w_img, x1 + pad)
                cy1 = min(h_img, y1 + pad)
                cropped = clean_img[cy0:cy1, cx0:cx1]
                
                # Convert to base64
                success, buffer = cv2.imencode('.png', cropped)
                if success:
                    b64_img = base64.b64encode(buffer).decode('utf-8')
                    images_dict[label] = f"data:image/png;base64,{b64_img}"

                # Deterministic Proximity Analysis: Find nearest text line above or choice label beside
                nearest_text_before = ""
                nearest_choice_label = None
                min_y_dist = float('inf')
                min_x_dist = float('inf')

                for tb in text_blocks:
                    if tb[6] != 0: continue
                    tx0, ty0, tx1, ty1 = [int(v * 2) for v in tb[:4]]
                    t_str = tb[4].strip()
                    if not t_str: continue

                    # Check for horizontal proximity (choice label to the left of image)
                    if max(y0, ty0) < min(y1, ty1) + 20: # Overlaps vertically
                        if tx1 <= x0 + 20 and (x0 - tx1) < min_x_dist and (x0 - tx1) < 150:
                            min_x_dist = x0 - tx1
                            # Check if t_str is a choice label like A), B., C), Option D
                            m = re.match(r'^(?:Option\s*)?([A-Ea-e])[\.\)\:]|\b([A-Ea-e])[\.\)\:]', t_str)
                            if m:
                                nearest_choice_label = (m.group(1) or m.group(2)).upper()

                    # Check for vertical proximity (text block directly above image)
                    if ty1 <= y0 + 10 and (y0 - ty1) < min_y_dist and (y0 - ty1) < 250:
                        # Check horizontal overlap
                        if max(x0, tx0) < min(x1, tx1) or abs(x0 - tx0) < 200:
                            min_y_dist = y0 - ty1
                            nearest_text_before = t_str[:150].replace('\n', ' ')

                image_metadata[label] = {
                    "bbox": [x0, y0, x1, y1],
                    "nearestTextBefore": nearest_text_before,
                    "nearestChoiceLabel": nearest_choice_label
                }
                
                global_img_idx += 1

            # Encode full page with red boxes to base64 for vision model
            success, buffer = cv2.imencode('.png', img)
            b64_png = base64.b64encode(buffer).decode("ascii")

            pages_data.append({
                "page": i + 1,
                "pngBase64": b64_png,
                "images": images_dict,
                "imageMetadata": image_metadata
            })
        else:
            # Original text extraction mode
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
                "images": images
            })

    print(json.dumps({"pages": pages_data}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    mode = "text"
    if len(sys.argv) >= 3 and sys.argv[2] == "--render":
        mode = "render"
    extract_pdf(sys.argv[1], mode)
