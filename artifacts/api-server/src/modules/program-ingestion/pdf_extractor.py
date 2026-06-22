import sys
import json
import fitz
import base64
import re

def extract_pdf(pdf_path):
    doc = fitz.open(pdf_path)
    pages_data = []

    for i in range(len(doc)):
        page = doc[i]
        text = page.get_text("text")
        
        # Extract images
        images = []
        image_list = page.get_images(full=True)
        for img_index, img_info in enumerate(image_list):
            xref = img_info[0]
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]
            image_ext = base_image["ext"]
            # Convert to base64
            b64_img = base64.b64encode(image_bytes).decode('utf-8')
            mime_type = "image/jpeg" if image_ext == "jpeg" else f"image/{image_ext}"
            data_uri = f"data:{mime_type};base64,{b64_img}"
            images.append(data_uri)
            
            # Put a placeholder in text if we can heuristically place it (PyMuPDF get_text doesn't inline images, 
            # so we just append placeholders at the end of the page or return them separately)
            
        pages_data.append({
            "page": i + 1,
            "text": text.strip(),
            "images": images
        })

    print(json.dumps({"pages": pages_data}))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(1)
    extract_pdf(sys.argv[1])
