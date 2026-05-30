import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HandwritingRecognitionInput, HandwritingRecognitionResult } from './types';

const execFileAsync = promisify(execFile);

function getPythonCommand(): { command: string; args: string[] } {
  const configured = (process.env['HANDWRITING_OCR_PYTHON_BIN'] ?? '').trim();
  if (configured) {
    return { command: configured, args: [] };
  }

  if (process.platform === 'win32') {
    const configuredVersion = (process.env['HANDWRITING_OCR_PYTHON_VERSION'] ?? '3.13').trim();
    return { command: 'py', args: [`-${configuredVersion}`] };
  }

  return { command: 'python3', args: [] };
}

export interface HandwritingRecognitionProvider {
  recognize(input: HandwritingRecognitionInput): Promise<HandwritingRecognitionResult>;
}

class Pix2TexPythonProvider implements HandwritingRecognitionProvider {
  async recognize(input: HandwritingRecognitionInput): Promise<HandwritingRecognitionResult> {
    const python = getPythonCommand();
    const pythonCode = String.raw`
import base64
import io
import json
import sys
from PIL import Image
from pix2tex.cli import LatexOCR

payload = json.loads(sys.argv[1])
image_b64 = payload.get('imageBase64', '')
preferred_output = payload.get('preferredOutput', 'text')

if ',' in image_b64 and image_b64.startswith('data:'):
    image_b64 = image_b64.split(',', 1)[1]

image_bytes = base64.b64decode(image_b64)
image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
model = LatexOCR()
latex = model(image)
text = latex

result = {
    'provider': 'pix2tex',
    'text': text,
    'latex': latex,
    'confidence': None,
    'candidates': [latex] if latex else []
}
print(json.dumps(result, ensure_ascii=False))
`;

    const { stdout, stderr } = await execFileAsync(python.command, [...python.args, '-c', pythonCode, JSON.stringify(input)], {
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    });

    if (stderr && stderr.trim().length > 0) {
      console.warn('[handwriting-recognition] pix2tex stderr:', stderr);
    }

    const parsed = JSON.parse(stdout) as HandwritingRecognitionResult;
    return {
      provider: parsed.provider || 'pix2tex',
      text: typeof parsed.text === 'string' ? parsed.text : null,
      latex: typeof parsed.latex === 'string' ? parsed.latex : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.filter((entry): entry is string => typeof entry === 'string') : [],
    };
  }
}

class UnconfiguredPix2TexProvider implements HandwritingRecognitionProvider {
  async recognize(): Promise<HandwritingRecognitionResult> {
    throw new Error('pix2tex is not available. Install Python dependencies for the handwriting OCR service first.');
  }
}

export function getHandwritingRecognitionProvider(): HandwritingRecognitionProvider {
  const provider = (process.env['HANDWRITING_OCR_PROVIDER'] ?? 'pix2tex').toLowerCase().trim();
  switch (provider) {
    case 'pix2tex':
    case '':
      return new Pix2TexPythonProvider();
    default:
      return new UnconfiguredPix2TexProvider();
  }
}
