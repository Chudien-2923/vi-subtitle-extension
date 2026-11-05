import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { clearCache, countCachedChunks, indexedDbCache, sessionCacheKey } from './cache';

const meta = { videoId: 'vid', track: { languageCode: 'en', kind: 'asr' as const, name: 'English', vssId: 'a.en' } };

describe('sessionCacheKey', () => {
  it('changes with anything that changes the translation', () => {
    const base = sessionCacheKey(meta, 'gemini', 'm1', false);
    expect(sessionCacheKey(meta, 'gemini', 'm2', false)).not.toBe(base);
    expect(sessionCacheKey(meta, 'openai', 'm1', false)).not.toBe(base);
    expect(sessionCacheKey(meta, 'gemini', 'm1', true)).not.toBe(base);
    expect(sessionCacheKey({ ...meta, track: { ...meta.track, vssId: '.en' } }, 'gemini', 'm1', false)).not.toBe(base);
  });
});

describe('indexedDbCache', () => {
  it('stores chunks per session key and clears them', async () => {
    await indexedDbCache.putChunk('a', 0, { mode: 'segments', segments: [{ start: 0, vi: 'Xin chào' }] });
    await indexedDbCache.putChunk('b', 0, { mode: 'cues', translations: { c0: 'Khác' } });
    expect(await indexedDbCache.getChunk('a', 0)).toEqual({
      mode: 'segments',
      segments: [{ start: 0, vi: 'Xin chào' }],
    });
    expect(await indexedDbCache.getChunk('a', 1)).toBeUndefined();
    expect(await countCachedChunks()).toBe(2);
    await clearCache();
    expect(await indexedDbCache.getChunk('a', 0)).toBeUndefined();
  });
});
