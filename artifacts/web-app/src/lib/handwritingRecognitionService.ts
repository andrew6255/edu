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

export type MyScriptInkRequest = {
  width: number;
  height: number;
  strokes: Array<{ x: number[]; y: number[]; t: number[] }>;
};

export type MyScriptInkResponse = { jiix: unknown; latex: string };

function getHandwritingRecognitionApiBase(): string {
  let explicit = (import.meta.env.VITE_API_SERVER_URL as string | undefined)?.trim();
  if (explicit && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    explicit = explicit.replace('localhost', window.location.hostname);
  }
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

async function getAccessToken(): Promise<string> {
  const { requireSupabase } = await import('./supabase');
  const { data } = await requireSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Authentication required.');
  return token;
}

export async function recognizeHandwriting(input: HandwritingRecognitionRequest): Promise<HandwritingRecognitionResponse> {
  const token = await getAccessToken();
  const response = await fetch(`${getHandwritingRecognitionApiBase()}/recognize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  return expectJson<HandwritingRecognitionResponse>(response);
}

export async function recognizeMyScriptInk(input: MyScriptInkRequest): Promise<MyScriptInkResponse> {
  const token = await getAccessToken();
  const response = await fetch(`${getHandwritingRecognitionApiBase()}/myscript`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  return expectJson<MyScriptInkResponse>(response);
}
