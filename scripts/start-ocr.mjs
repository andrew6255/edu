import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(scriptDirectory, '..');
const ocrServer = path.join(workspaceDirectory, 'tools', 'ocr', 'ocr_server.py');
const configuredPython = (process.env.OCR_PYTHON_BIN || process.env.HANDWRITING_OCR_PYTHON_BIN || '').trim();

const candidates = [
  ...(configuredPython ? [{ command: configuredPython, prefix: [] }] : []),
  ...(process.platform === 'win32' ? [{ command: 'py', prefix: ['-3.12'] }] : []),
  { command: 'python3', prefix: [] },
  { command: 'python', prefix: [] },
];

const dependencyProbe = 'import flask, flask_cors, fitz, cv2, numpy, pytesseract, PIL, waitress';
const selected = candidates.find(candidate => {
  const result = spawnSync(candidate.command, [...candidate.prefix, '-c', dependencyProbe], {
    cwd: workspaceDirectory,
    stdio: 'ignore',
    windowsHide: true,
  });
  return result.status === 0;
});

if (!selected) {
  console.error('[ocr] No Python installation has the OCR dependencies.');
  console.error('[ocr] Install them with: py -3.12 -m pip install -r tools\\ocr\\requirements.txt');
  process.exit(1);
}

console.log(`[ocr] Starting with ${selected.command} ${selected.prefix.join(' ')}`.trim());
const child = spawn(selected.command, [...selected.prefix, ocrServer], {
  cwd: workspaceDirectory,
  stdio: 'inherit',
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', error => {
  console.error(`[ocr] Could not start: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', code => process.exit(code ?? 1));
