import { describe, expect, it } from 'vitest';
import { errorFromResponse } from '../providers/errors';
import { parseSegments, parseTranslation } from './validate';

describe('parseTranslation', () => {
  it('reads fenced JSON and normalizes whitespace', () => {
    const text = '```json\n{"cues":[{"id":"c0","vi":" Xin  chào\\ncác bạn "}],"uncertainties":[]}\n```';
    const result = parseTranslation(text, ['c0']);
    expect(result.translations.get('c0')).toBe('Xin chào các bạn');
    expect(result.missing).toEqual([]);
  });

  it('reports missing and empty ids and ignores unexpected ones', () => {
    const text = JSON.stringify({
      cues: [
        { id: 'c0', vi: 'Một' },
        { id: 'c1', vi: '   ' },
        { id: 'c9', vi: 'Lạ' },
      ],
    });
    const result = parseTranslation(text, ['c0', 'c1', 'c2']);
    expect([...result.translations.keys()]).toEqual(['c0']);
    expect(result.missing).toEqual(['c1', 'c2']);
  });

  it('rejects output without a cues array', () => {
    expect(() => parseTranslation('Sorry, I cannot help.', ['c0'])).toThrow(
      expect.objectContaining({ code: 'bad-output' }),
    );
    expect(() => parseTranslation('{"result":[]}', ['c0'])).toThrow(expect.objectContaining({ code: 'bad-output' }));
  });
});

describe('parseSegments', () => {
  const json = (segments: unknown[]) => JSON.stringify({ segments, uncertainties: [] });

  it('accepts contiguous segments covering the chunk', () => {
    expect(
      parseSegments(
        json([
          { start: 100, vi: 'Một' },
          { start: '108', vi: 'Hai' },
        ]),
        100,
        120,
        30,
      ),
    ).toEqual([
      { start: 100, vi: 'Một' },
      { start: 108, vi: 'Hai' },
    ]);
  });

  const at = (...starts: number[]) => starts.map((start) => ({ start, vi: 'x' }));

  it.each([
    ['not starting at the chunk start', at(101), 30],
    ['non-increasing starts', at(100, 100), 30],
    ['a start outside the chunk', at(100, 125), 30],
    ['an over-long segment', at(100), 10],
  ])('rejects %s', (_label, segments, maxWords) => {
    expect(() => parseSegments(json(segments), 100, 120, maxWords)).toThrow(
      expect.objectContaining({ code: 'bad-output' }),
    );
  });
});

describe('errorFromResponse', () => {
  const headers = (init: Record<string, string> = {}) => new Headers(init);

  it('treats per-minute 429s as rate limits even when the body mentions quota', () => {
    const body =
      '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"retryDelay":"36s"}]}}';
    const error = errorFromResponse(429, headers(), body);
    expect(error.code).toBe('rate-limit');
    expect(error.retryAfterMs).toBe(36_000);
  });

  it('treats daily or billing exhaustion as quota', () => {
    expect(
      errorFromResponse(429, headers(), '{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}').code,
    ).toBe('quota');
    expect(errorFromResponse(429, headers(), '{"error":{"code":"insufficient_quota"}}').code).toBe('quota');
    expect(errorFromResponse(400, headers(), 'Your credit balance is too low').code).toBe('quota');
    expect(errorFromResponse(402, headers(), '').code).toBe('quota');
  });

  it('recognizes bad keys, including Gemini 400 responses', () => {
    expect(errorFromResponse(401, headers(), '').code).toBe('invalid-key');
    expect(errorFromResponse(400, headers(), '{"reason":"API_KEY_INVALID"}').code).toBe('invalid-key');
  });

  it('maps unknown models, server errors and Retry-After', () => {
    expect(errorFromResponse(404, headers(), 'models/foo is not found').code).toBe('bad-model');
    const server = errorFromResponse(503, headers({ 'retry-after': '5' }), 'overloaded');
    expect(server.code).toBe('server');
    expect(server.retryAfterMs).toBe(5000);
  });
});
