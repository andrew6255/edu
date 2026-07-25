import sys
import json
import fitz
import base64
import cv2
import numpy as np

def extract_pdf(pdf_path, mode="text"):
    doc = fitz.open(pdf_path)
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

            # 2. Mask out text blocks with white rectangles to isolate figures
            text_blocks = page.get_text("blocks")
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
            
            # Filter contours (ignore very small noise)
            min_area = 200
            bboxes = []
            for c in contours:
                x, y, w, h = cv2.boundingRect(c)
                if w * h > min_area:
                    bboxes.append({
                        'bbox': (x, y, x+w, y+h)
                    })

            # Sort reading order (group by rows)
            def sort_reading_order(boxes):
                if not boxes: return []
                # sort roughly by y0
                boxes.sort(key=lambda d: d['bbox'][1])
                rows = []
                current_row = [boxes[0]]
                current_y = boxes[0]['bbox'][1]
                for box in boxes[1:]:
                    # 40 pixels tolerance at 2x scale
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
            for box in bboxes:
                x0, y0, x1, y1 = box['bbox']
                label = f"[IMG_{global_img_idx}]"
                
                # Draw red box and label on the annotated image
                cv2.rectangle(img, (x0, y0), (x1, y1), (0, 0, 255), 3)
                cv2.putText(img, label, (x0, max(y0 - 10, 20)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                
                # Crop from clean image with a larger padding to avoid cutting edges
                h_img, w_img = clean_img.shape[:2]
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
                
                global_img_idx += 1

            # Encode full page with red boxes to base64 for vision model
            success, buffer = cv2.imencode('.png', img)
            b64_png = base64.b64encode(buffer).decode("ascii")

            pages_data.append({
                "page": i + 1,
                "pngBase64": b64_png,
                "images": images_dict
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
