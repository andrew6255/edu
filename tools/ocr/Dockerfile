FROM python:3.12-slim

# Install system dependencies for Tesseract, PyMuPDF, and pdf2image
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-fra \
    poppler-utils \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download pix2text models during build time (optional but speeds up first boot)
RUN python -c "from pix2text import Pix2Text; p2t = Pix2Text.from_config()" || true

# Copy source code
COPY . .

# Expose port 5100
EXPOSE 5100

# Set environment variables
ENV FLASK_APP=ocr_server.py
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1
ENV OCR_OUTPUT_DIR=/tmp

# Run with gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5100", "--workers", "1", "--threads", "4", "--timeout", "120", "ocr_server:app"]
