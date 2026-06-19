export type SymbolRecognitionRequest = {
  imageBase64: string;
  allowedSymbols?: string[];
};

export type SymbolRecognitionResponse = {
  provider?: string;
  symbol: string | null;
  confidence: number | null;
  candidates: string[];
};

function getSymbolRecognitionApiBase(): string {
  let explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  if (explicit && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    explicit = explicit.replace('localhost', window.location.hostname);
  }
  const base = explicit && explicit.length > 0 ? explicit.replace(/\/+$/, '') : '';
  return `${base}/api/symbol-recognition`;
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

export async function recognizeSymbol(input: SymbolRecognitionRequest): Promise<SymbolRecognitionResponse> {
  const response = await fetch(`${getSymbolRecognitionApiBase()}/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return expectJson<SymbolRecognitionResponse>(response);
}
