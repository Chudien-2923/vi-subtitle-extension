import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCache,
  countCachedChunks,
  deleteTranslationVideoCache,
  indexedDbCache,
  listTranslationVideoCaches,
  recordCacheVideo,
  sessionCacheKey,
  translationCacheInfo,
} from './cache';

const meta = { videoId: 'vid', track: { languageCode: 'en', kind: 'asr' as const, name: 'English', vssId: 'a.en' } };
const DB_NAME = 'chudin-vi-subtitle';
const cues = { mode: 'cues' as const, translations: { c0: 'Khác' } };

function keyFor(videoId: string, provider: 'gemini' | 'openai' = 'gemini', model = 'm1'): string {
  return sessionCacheKey({ ...meta, videoId }, provider, model, false);
}

function utf8Json(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteDatabase(): Promise<void> {
  const request = indexedDB.deleteDatabase(DB_NAME);
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Translation database is still open'));
  });
}

/** Writes a database exactly as the previous release did: version 1, `chunks` only, no videoId/bytes fields. */
async function seedVersion1(records: { sessionKey: string; index: number; payload: unknown }[]): Promise<void> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore('chunks', { keyPath: 'id' });
  };
  const db = await settle(open);
  const tx = db.transaction('chunks', 'readwrite');
  for (const { sessionKey, index, payload } of records) {
    tx.objectStore('chunks').put({ id: `${sessionKey}#${index}`, sessionKey, index, payload, savedAt: 1000 + index });
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

beforeEach(deleteDatabase);

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

  it('does not write when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(indexedDbCache.putChunk(keyFor('vid'), 0, cues, controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    );
    expect(await translationCacheInfo()).toEqual({ chunks: 0, bytes: 0 });
  });

  it('does not write when the signal aborts while the database is still opening', async () => {
    const controller = new AbortController();
    const write = indexedDbCache.putChunk(keyFor('vid'), 0, cues, controller.signal);
    controller.abort();
    await expect(write).rejects.toHaveProperty('name', 'AbortError');
    expect(await countCachedChunks()).toBe(0);
  });

  it('does not record a video title for an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(recordCacheVideo({ videoId: 'vid', title: 'Tiêu đề' }, controller.signal)).rejects.toHaveProperty(
      'name',
      'AbortError',
    );
    expect(await listTranslationVideoCaches()).toEqual([]);
  });
});

describe('per-video translation cache', () => {
  it('lists chunk count, serialized bytes and the recorded title per video', async () => {
    await indexedDbCache.putChunk(keyFor('vid'), 0, cues);
    await indexedDbCache.putChunk(keyFor('vid'), 1, cues);
    await recordCacheVideo({ videoId: 'vid', title: '  Bài giảng  ' });
    const [video, ...rest] = await listTranslationVideoCaches();
    expect(rest).toEqual([]);
    expect(video).toMatchObject({
      videoId: 'vid',
      title: 'Bài giảng',
      translationChunks: 2,
      translationBytes: 2 * utf8Json(cues),
    });
    expect(video?.translationBytes).toBeGreaterThan(2 * JSON.stringify(cues).length);
    expect(await translationCacheInfo()).toEqual({ chunks: 2, bytes: 2 * utf8Json(cues) });
  });

  it('keeps an earlier title when a later record has none, and falls back to the id without any title', async () => {
    await recordCacheVideo({ videoId: 'vid', title: 'Tên cũ' });
    await recordCacheVideo({ videoId: 'vid', title: '  ' });
    await indexedDbCache.putChunk(keyFor('untitled'), 0, cues);
    const titles = Object.fromEntries((await listTranslationVideoCaches()).map((v) => [v.videoId, v.title]));
    expect(titles).toEqual({ vid: 'Tên cũ', untitled: 'untitled' });
  });

  it('deletes exactly one video id across every provider/model variant and leaves look-alike ids alone', async () => {
    await indexedDbCache.putChunk(keyFor('abc', 'gemini', 'm1'), 0, cues);
    await indexedDbCache.putChunk(keyFor('abc', 'gemini', 'm2'), 0, cues);
    await indexedDbCache.putChunk(keyFor('abc', 'openai', 'm1'), 3, cues);
    await indexedDbCache.putChunk(keyFor('abcd'), 0, cues);
    await indexedDbCache.putChunk(keyFor('xabc'), 0, cues);
    await indexedDbCache.putChunk('abc', 0, cues);
    await recordCacheVideo({ videoId: 'abc', title: 'A' });
    await recordCacheVideo({ videoId: 'abcd', title: 'AD' });

    await deleteTranslationVideoCache('abc');

    expect(await indexedDbCache.getChunk(keyFor('abc', 'gemini', 'm1'), 0)).toBeUndefined();
    expect(await indexedDbCache.getChunk(keyFor('abc', 'gemini', 'm2'), 0)).toBeUndefined();
    expect(await indexedDbCache.getChunk(keyFor('abc', 'openai', 'm1'), 3)).toBeUndefined();
    expect(await indexedDbCache.getChunk('abc', 0)).toBeUndefined();
    expect(await indexedDbCache.getChunk(keyFor('abcd'), 0)).toEqual(cues);
    expect(await indexedDbCache.getChunk(keyFor('xabc'), 0)).toEqual(cues);
    const remaining = await listTranslationVideoCaches();
    expect(remaining.map((v) => [v.videoId, v.title, v.translationChunks]).sort()).toEqual([
      ['abcd', 'AD', 1],
      ['xabc', 'xabc', 1],
    ]);
  });

  it('lists a title-only video with zero chunks and keeps titles when translations are cleared', async () => {
    await recordCacheVideo({ videoId: 'voice-only', title: 'Chỉ có giọng đọc' });
    await indexedDbCache.putChunk(keyFor('vid'), 0, cues);
    await clearCache();
    const videos = await listTranslationVideoCaches();
    expect(videos.map((v) => [v.videoId, v.title, v.translationChunks, v.translationBytes])).toEqual([
      ['voice-only', 'Chỉ có giọng đọc', 0, 0],
    ]);
  });

  it('upgrades a v1 database in place: keeps every chunk and attributes it to its exact video id', async () => {
    await seedVersion1([
      { sessionKey: keyFor('abc', 'gemini', 'm1'), index: 0, payload: cues },
      { sessionKey: keyFor('abc', 'openai', 'm2'), index: 1, payload: cues },
      { sessionKey: keyFor('abcd'), index: 0, payload: cues },
      { sessionKey: 'legacy-key-without-separator', index: 0, payload: cues },
    ]);

    const videos = await listTranslationVideoCaches();
    expect(videos.map((v) => [v.videoId, v.title, v.translationChunks, v.translationBytes]).sort()).toEqual([
      ['abc', 'abc', 2, 2 * utf8Json(cues)],
      ['abcd', 'abcd', 1, utf8Json(cues)],
      ['legacy-key-without-separator', 'legacy-key-without-separator', 1, utf8Json(cues)],
    ]);
    expect(videos.find((v) => v.videoId === 'abc')?.lastUsedAt).toBe(1001);
    expect(await countCachedChunks()).toBe(4);
    expect(await indexedDbCache.getChunk(keyFor('abc', 'openai', 'm2'), 1)).toEqual(cues);

    await deleteTranslationVideoCache('abc');
    expect(await countCachedChunks()).toBe(2);
    expect(await indexedDbCache.getChunk(keyFor('abcd'), 0)).toEqual(cues);
  });
});
