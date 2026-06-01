export type HandwritingRecognitionRequest = {
  imageBase64: string;
  preferredOutput?: 'text' | 'latex';
  contextHint?: string | null;
};

export type HandwritingRecognitionResponse = {
  provider?: string;
  text: string | null;
  latex: string | null;
  confidence: number | null;
  candidates: string[];
};

function getHandwritingRecognitionApiBase(): string {
  const explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  const base = explicit && explicit.length > 0 ? explicit.replace(/\/+$/, '') : '';
  return `${base}/api/handwriting-recognition`;
}

async function expectJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = typeof (payload as { error?: unknown })?.error === 'string'
      ? (payload as { error: string }).error
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function recognizeHandwriting(input: HandwritingRecognitionRequest): Promise<HandwritingRecognitionResponse> {
  const response = await fetch(`${getHandwritingRecognitionApiBase()}/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return expectJson<HandwritingRecognitionResponse>(response);
}
