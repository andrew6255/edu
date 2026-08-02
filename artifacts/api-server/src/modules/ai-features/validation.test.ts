import { describe, expect, it } from 'vitest';
import { parseAiFeatureRequest } from './validation';

describe('parseAiFeatureRequest', () => {
  it('accepts a known task with text messages', () => {
    expect(parseAiFeatureRequest({
      task: 'study_sheet',
      messages: [{ role: 'user', content: 'Explain the equation.' }],
    })).toEqual({
      task: 'study_sheet',
      messages: [{ role: 'user', content: 'Explain the equation.' }],
    });
  });

  it('rejects unknown tasks and remote image URLs', () => {
    expect(() => parseAiFeatureRequest({ task: 'arbitrary_proxy', messages: [{ role: 'user', content: 'Hello' }] })).toThrow('Unsupported');
    expect(() => parseAiFeatureRequest({
      task: 'test_grading',
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }] }],
    })).toThrow('embedded');
  });
});
