@echo off
echo ============================================================
echo  OCR Server (Phase 1)
echo  Uses PyMuPDF + Tesseract OCR
echo  Output: output_phase_1.json in the project root
echo  Listening on: http://localhost:5100
echo ============================================================
echo.
cd /d "%~dp0"
python ocr_server.py
pause
