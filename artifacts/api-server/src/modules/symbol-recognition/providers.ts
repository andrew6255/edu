import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SymbolRecognitionInput, SymbolRecognitionResult } from './types';

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

function getInferenceScriptPath(): string {
  const overridden = (process.env['SYMBOL_RECOGNITION_SCRIPT'] ?? '').trim();
  if (overridden) return overridden;

  const here = path.dirname(fileURLToPath(import.meta.url));
  // After bundling, file lives at api-server/dist/index.mjs; scripts/ sits at api-server/scripts.
  // During dev (tsx) it may be deeper under src/modules/...
  const candidatePaths = [
    path.resolve(here, '..', 'scripts', 'digit_classifier_inference.py'),
    path.resolve(here, '..', '..', 'scripts', 'digit_classifier_inference.py'),
    path.resolve(here, '..', '..', '..', 'scripts', 'digit_classifier_inference.py'),
    path.resolve(process.cwd(), 'scripts', 'digit_classifier_inference.py'),
    path.resolve(process.cwd(), 'artifacts', 'api-server', 'scripts', 'digit_classifier_inference.py'),
  ];
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fall back to the first candidate so the error message points at a real attempt.
  return candidatePaths[0]!;
}

export interface SymbolRecognitionProvider {
  recognize(input: SymbolRecognitionInput): Promise<SymbolRecognitionResult>;
}

class MnistCnnProvider implements SymbolRecognitionProvider {
  async recognize(input: SymbolRecognitionInput): Promise<SymbolRecognitionResult> {
    const python = getPythonCommand();
    const scriptPath = getInferenceScriptPath();

    const { stdout, stderr } = await execFileAsync(
      python.command,
      [...python.args, scriptPath, JSON.stringify(input)],
      { maxBuffer: 20 * 1024 * 1024, windowsHide: true },
    );

    if (stderr && stderr.trim().length > 0) {
      console.warn('[symbol-recognition] python stderr:', stderr);
    }

    const parsed = JSON.parse(stdout) as Partial<SymbolRecognitionResult> & { error?: string };
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return {
      provider: parsed.provider || 'mnist_cnn',
      symbol: typeof parsed.symbol === 'string' ? parsed.symbol : null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      candidates: Array.isArray(parsed.candidates)
        ? parsed.candidates.filter((entry): entry is string => typeof entry === 'string')
        : [],
    };
  }
}

export function getSymbolRecognitionProvider(): SymbolRecognitionProvider {
  return new MnistCnnProvider();
}
