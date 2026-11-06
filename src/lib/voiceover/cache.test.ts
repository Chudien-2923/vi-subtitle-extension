import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDbCache } from '../cache/cache';
import {
  clearUnassignedVoiceCache,
  clearVoiceCache,
  deleteVoiceVideoCache,
  getVoiceCache,
  listVoiceVideoCaches,
  putVoiceCache,
  voiceCacheInfo,
  voiceCacheKey,
} from './cache';
import type { VoiceAudio } from './types';

const DATABASE = 'chudin-voiceover';
const audio: VoiceAudio = {
  mime: 'audio/wav',
  base64: 'UklGRg==',
  durationMs: 100,
  engineVersion: 'v1',
  voice: 'Hải Đăng',
};
/** Serialized size of `audio`: the length of its base64 string. */
const AUDIO_BYTES = audio.base64.length;

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteDatabase(): Promise<void> {
  const request = indexedDB.deleteDatabase(DATABASE);
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Voice database is still open'));
  });
}

type LegacyRecord = { id: string; audio: VoiceAudio; bytes: number; usedAt: number };

/** Writes a database exactly as the previous release did: version 1, metadata without owner fields. */
async function seedVersion1(records: LegacyRecord[]): Promise<void> {
  const open = indexedDB.open(DATABASE, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore('audio');
    open.result.createObjectStore('metadata', { keyPath: 'id' });
  };
  const db = await settle(open);
  const tx = db.transaction(['audio', 'metadata'], 'readwrite');
  for (const record of records) {
    tx.objectStore('audio').put(record.audio, record.id);
    tx.objectStore('metadata').put({ id: record.id, bytes: record.bytes, usedAt: record.usedAt });
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function videos() {
  const { videos: list, unassigned } = await listVoiceVideoCaches();
  const byId: Record<string, { voiceEntries: number; voiceBytes: number; reclaimableVoiceBytes: number }> = {};
  for (const { videoId, voiceEntries, voiceBytes, reclaimableVoiceBytes } of list) {
    byId[videoId] = { voiceEntries, voiceBytes, reclaimableVoiceBytes };
  }
  return { byId, unassigned };
}

beforeEach(deleteDatabase);

describe('voice cache output identity', () => {
  it('does not reuse audio after translated text, voice or engine changes', async () => {
    const key = await voiceCacheKey('v1', 'Hải Đăng', 'Đúng.');
    await putVoiceCache(key, audio);
    expect(await getVoiceCache(key)).toEqual(audio);
    for (const other of [
      await voiceCacheKey('v2', 'Hải Đăng', 'Đúng.'),
      await voiceCacheKey('v1', 'Trúc Ly', 'Đúng.'),
      await voiceCacheKey('v1', 'Hải Đăng', 'Không đúng.'),
    ])
      expect(await getVoiceCache(other)).toBeUndefined();
  });
  it('clears voice audio without losing translations', async () => {
    await indexedDbCache.putChunk('voice-isolation', 0, { mode: 'cues', translations: { c: 'Xin chào' } });
    await putVoiceCache('a', audio);
    await clearVoiceCache();
    expect(await getVoiceCache('a')).toBeUndefined();
    expect(await voiceCacheInfo()).toEqual({ bytes: 0, entries: 0 });
    expect(await indexedDbCache.getChunk('voice-isolation', 0)).toEqual({
      mode: 'cues',
      translations: { c: 'Xin chào' },
    });
  });
  it('evicts the least recently used audio under quota, not a recently replayed sentence', async () => {
    let stamp = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => stamp++);
    try {
      // 14 x 12 MiB base64 represents 126 MiB audio; the 15th exceeds the 128 MiB audio budget.
      const large = { ...audio, base64: 'A'.repeat(12 * 1024 * 1024) };
      for (let i = 0; i < 14; i++) await putVoiceCache(String(i), large);
      await getVoiceCache('0');
      await putVoiceCache('14', large);
      expect(await getVoiceCache('1')).toBeUndefined();
      expect((await getVoiceCache('0'))?.durationMs).toBe(100);
      expect((await getVoiceCache('14'))?.durationMs).toBe(100);
      expect((await voiceCacheInfo()).bytes).toBeLessThanOrEqual(Math.ceil((128 * 1024 * 1024) / 3) * 4);
    } finally {
      clock.mockRestore();
      await clearVoiceCache();
    }
  });
  it('measures stored bytes as the serialized base64 length', async () => {
    await putVoiceCache('a', { ...audio, base64: 'A'.repeat(1000) });
    expect(await voiceCacheInfo()).toEqual({ bytes: 1000, entries: 1 });
  });
});

describe('voice cache video ownership', () => {
  it('shares one physical audio between two videos that speak the same sentence', async () => {
    await putVoiceCache('same', audio, 'A');
    expect(await getVoiceCache('same', 'B')).toEqual(audio);
    await putVoiceCache('same', audio, 'B');

    expect(await voiceCacheInfo()).toEqual({ bytes: AUDIO_BYTES, entries: 1 });
    expect(await videos()).toEqual({
      byId: {
        A: { voiceEntries: 1, voiceBytes: AUDIO_BYTES, reclaimableVoiceBytes: 0 },
        B: { voiceEntries: 1, voiceBytes: AUDIO_BYTES, reclaimableVoiceBytes: 0 },
      },
      unassigned: { entries: 0, bytes: 0 },
    });
  });

  it('keeps shared audio for the other video when one owner is deleted', async () => {
    await putVoiceCache('same', audio, 'A');
    await getVoiceCache('same', 'B');

    await deleteVoiceVideoCache('A');

    expect(await getVoiceCache('same')).toEqual(audio);
    expect(await videos()).toEqual({
      byId: { B: { voiceEntries: 1, voiceBytes: AUDIO_BYTES, reclaimableVoiceBytes: AUDIO_BYTES } },
      unassigned: { entries: 0, bytes: 0 },
    });
  });

  it('frees audio owned only by the deleted video, and everything once the last owner is gone', async () => {
    await putVoiceCache('same', audio, 'A');
    await getVoiceCache('same', 'B');
    await putVoiceCache('only-a', { ...audio, base64: 'AAAA' }, 'A');
    expect((await videos()).byId.A).toEqual({
      voiceEntries: 2,
      voiceBytes: AUDIO_BYTES + 4,
      reclaimableVoiceBytes: 4,
    });

    await deleteVoiceVideoCache('A');
    expect(await voiceCacheInfo()).toEqual({ bytes: AUDIO_BYTES, entries: 1 });
    expect(await getVoiceCache('only-a')).toBeUndefined();

    await deleteVoiceVideoCache('B');
    expect(await voiceCacheInfo()).toEqual({ bytes: 0, entries: 0 });
    expect(await getVoiceCache('same')).toBeUndefined();
    expect(await videos()).toEqual({ byId: {}, unassigned: { entries: 0, bytes: 0 } });
  });

  it('deletes by exact video id, never by prefix', async () => {
    await putVoiceCache('k-abc', audio, 'abc');
    await putVoiceCache('k-abcd', audio, 'abcd');
    await putVoiceCache('k-xabc', audio, 'xabc');

    await deleteVoiceVideoCache('abc');

    expect(await getVoiceCache('k-abc')).toBeUndefined();
    expect(await getVoiceCache('k-abcd')).toEqual(audio);
    expect(await getVoiceCache('k-xabc')).toEqual(audio);
    expect(Object.keys((await videos()).byId).sort()).toEqual(['abcd', 'xabc']);
  });

  it('treats audio synthesized without a video as unassigned and removes it only through clearUnassigned', async () => {
    await putVoiceCache('preview', audio);
    await putVoiceCache('owned', audio, 'A');
    await deleteVoiceVideoCache('A');
    expect(await getVoiceCache('owned')).toBeUndefined();
    expect((await videos()).unassigned).toEqual({ entries: 1, bytes: AUDIO_BYTES });

    await clearUnassignedVoiceCache();
    expect(await voiceCacheInfo()).toEqual({ bytes: 0, entries: 0 });
  });

  it('reading without a video id never changes ownership or the unassigned flag of an owned record', async () => {
    await putVoiceCache('owned', audio, 'A');
    await getVoiceCache('owned');
    await getVoiceCache('owned');

    expect(await videos()).toEqual({
      byId: { A: { voiceEntries: 1, voiceBytes: AUDIO_BYTES, reclaimableVoiceBytes: AUDIO_BYTES } },
      unassigned: { entries: 0, bytes: 0 },
    });
    await deleteVoiceVideoCache('A');
    expect(await getVoiceCache('owned')).toBeUndefined();
  });
  it('clearing unassigned audio never touches audio that any video owns', async () => {
    await putVoiceCache('preview', audio);
    await putVoiceCache('shared', audio, 'A');
    await getVoiceCache('shared', 'B');
    await putVoiceCache('only-b', { ...audio, base64: 'AAAA' }, 'B');
    // Preview first, then a video replays it: linked, but a preview may still need it.
    await putVoiceCache('preview-then-video', audio);
    await getVoiceCache('preview-then-video', 'A');

    await clearUnassignedVoiceCache();

    expect(await getVoiceCache('preview')).toBeUndefined();
    expect(await getVoiceCache('shared')).toEqual(audio);
    expect(await getVoiceCache('only-b')).toMatchObject({ base64: 'AAAA' });
    expect(await getVoiceCache('preview-then-video')).toEqual(audio);
    expect((await videos()).byId).toEqual({
      A: { voiceEntries: 2, voiceBytes: 2 * AUDIO_BYTES, reclaimableVoiceBytes: 0 },
      B: { voiceEntries: 2, voiceBytes: AUDIO_BYTES + 4, reclaimableVoiceBytes: 4 },
    });

    // Deleting the only known owner keeps the preview-linked audio (still flagged unassigned)...
    await deleteVoiceVideoCache('A');
    expect(await getVoiceCache('preview-then-video')).toEqual(audio);
    // ...and only then can the unassigned cleanup remove it.
    await clearUnassignedVoiceCache();
    expect(await getVoiceCache('preview-then-video')).toBeUndefined();
    expect(await getVoiceCache('shared')).toEqual(audio);
  });
});

describe('voice cache v1 migration', () => {
  it('keeps old audio as unassigned, re-measures its bytes and removes nothing', async () => {
    await seedVersion1([
      { id: 'old-1', audio, bytes: 6, usedAt: 10 },
      { id: 'old-2', audio: { ...audio, base64: 'AAAA' }, bytes: 3, usedAt: 20 },
    ]);

    expect(await voiceCacheInfo()).toEqual({ bytes: AUDIO_BYTES + 4, entries: 2 });
    expect(await videos()).toEqual({ byId: {}, unassigned: { entries: 2, bytes: AUDIO_BYTES + 4 } });
    expect(await getVoiceCache('old-1')).toEqual(audio);
  });

  it('attaches a known video on first hit but keeps the legacy unknown-owner protection', async () => {
    await seedVersion1([{ id: 'old', audio, bytes: 6, usedAt: 10 }]);

    expect(await getVoiceCache('old', 'A')).toEqual(audio);
    expect(await videos()).toEqual({
      byId: { A: { voiceEntries: 1, voiceBytes: AUDIO_BYTES, reclaimableVoiceBytes: 0 } },
      unassigned: { entries: 0, bytes: 0 },
    });

    // Another, unknown video may have used this audio before the upgrade: deleting A must not lose it.
    await deleteVoiceVideoCache('A');
    expect(await getVoiceCache('old')).toEqual(audio);
    expect((await videos()).unassigned).toEqual({ entries: 1, bytes: AUDIO_BYTES });
  });

  it('keeps legacy audio when a video that merely replayed it is deleted, and clears it only explicitly', async () => {
    await seedVersion1([{ id: 'old', audio, bytes: 6, usedAt: 10 }]);
    await putVoiceCache('new', audio, 'A');
    await getVoiceCache('old', 'A');

    await deleteVoiceVideoCache('A');
    expect(await getVoiceCache('new')).toBeUndefined();
    expect(await getVoiceCache('old')).toEqual(audio);

    await clearUnassignedVoiceCache();
    expect(await getVoiceCache('old')).toBeUndefined();
  });

  it('does not clear legacy audio that a video has already linked', async () => {
    await seedVersion1([
      { id: 'linked', audio, bytes: 6, usedAt: 10 },
      { id: 'orphan', audio, bytes: 6, usedAt: 11 },
    ]);
    await getVoiceCache('linked', 'A');

    await clearUnassignedVoiceCache();

    expect(await getVoiceCache('linked')).toEqual(audio);
    expect(await getVoiceCache('orphan')).toBeUndefined();
  });
});

describe('voice cache aborted requests', () => {
  it('does not write or link an owner when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(putVoiceCache('new', audio, 'A', controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(await voiceCacheInfo()).toEqual({ bytes: 0, entries: 0 });

    await putVoiceCache('kept', audio, 'A');
    await expect(getVoiceCache('kept', 'B', controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    await expect(putVoiceCache('kept', audio, 'B', controller.signal)).rejects.toHaveProperty('name', 'AbortError');
    expect(Object.keys((await videos()).byId)).toEqual(['A']);
  });

  it('cannot reattach audio that was deleted while the old request was still waiting', async () => {
    await putVoiceCache('same', audio, 'A');
    await getVoiceCache('same', 'B');
    const controller = new AbortController();

    // The old request is waiting for the database when it gets cancelled; the delete runs right after it.
    const stale = getVoiceCache('same', 'A', controller.signal);
    const rejected = expect(stale).rejects.toHaveProperty('name', 'AbortError');
    controller.abort();
    await deleteVoiceVideoCache('A');
    await rejected;

    expect(Object.keys((await videos()).byId)).toEqual(['B']);
    const stalePut = putVoiceCache('same', audio, 'A', controller.signal);
    await expect(stalePut).rejects.toHaveProperty('name', 'AbortError');
    expect(Object.keys((await videos()).byId)).toEqual(['B']);
  });
});
