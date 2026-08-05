import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeAiFeature, getServerGroqKeys } from './service';

const previousServerKeys = process.env['GROQ_API_KEY'];

afterEach(() => {
  vi.unstubAllGlobals();
  if (previousServerKeys === undefined) delete process.env['GROQ_API_KEY'];
  else process.env['GROQ_API_KEY'] = previousServerKeys;
});

describe('AI feature Groq gateway', () => {
  it('uses the server-only key pool', () => {
    process.env['GROQ_API_KEY'] = 'server-one, server-two';
    expect(getServerGroqKeys()).toEqual(['server-one', 'server-two']);
  });

  it('fails over only when a server credential is rejected', async () => {
    process.env['GROQ_API_KEY'] = 'revoked-key,working-key';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"unauthorized"}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        choices: [{ message: { content: 'Useful response' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(completeAiFeature({
      task: 'feynman_feedback',
      messages: [{ role: 'user', content: 'My explanation' }],
    })).resolves.toMatchObject({ content: 'Useful response' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not rotate credentials when the shared organization quota is exhausted', async () => {
    process.env['GROQ_API_KEY'] = 'first-key,second-key';
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"error":"rate limited"}', {
      status: 429,
      headers: { 'Retry-After': '12' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = completeAiFeature({
      task: 'study_sheet',
      messages: [{ role: 'user', content: 'Teach me' }],
    });
    await expect(promise).rejects.toMatchObject({ status: 429, retryAfter: '12' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
