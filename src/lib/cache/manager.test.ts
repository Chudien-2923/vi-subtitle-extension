import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { clearVoiceCache, getVoiceCache, putVoiceCache } from '../voiceover/cache';
import type { VoiceAudio } from '../voiceover/types';
import { beginVideoCacheActivity, deletingVideoCache } from './activity';
import { clearCache, indexedDbCache, recordCacheVideo } from './cache';
import { deleteVideoCache, listVideoCaches } from './manager';

const audio: VoiceAudio = {
  mime: 'audio/wav',
  base64: 'UklGRg==',
  durationMs: 100,
  engineVersion: 'v1',
  voice: 'Hải Đăng',
};
const payload = { mode: 'cues' as const, translations: { a: 'Bằng chứng cần được kiểm tra.' } };

describe('per-video cache deletion lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(browser.tabs, 'query').mockImplementation(() => Promise.resolve([]));
    await clearCache();
    await clearVoiceCache();
  });

  it('deletes all of A while keeping B and its shared speech, then reclaims the last shared owner', async () => {
    await recordCacheVideo({ videoId: 'A', title: 'Video đã xem' });
    await recordCacheVideo({ videoId: 'B', title: 'Video chưa xem xong' });
    await indexedDbCache.putChunk('A|track|model1', 0, payload);
    await indexedDbCache.putChunk('A|track|model2', 1, payload);
    await indexedDbCache.putChunk('B|track|model1', 0, payload);
    await putVoiceCache('shared', audio, 'A');
    await getVoiceCache('shared', 'B');
    await putVoiceCache('exclusive-A', audio, 'A');
    const before = await listVideoCaches();
    expect(before.videos.find((video) => video.videoId === 'A')).toMatchObject({
      title: 'Video đã xem',
      translationChunks: 2,
      voiceEntries: 2,
    });
    await deleteVideoCache('A');
    expect(await indexedDbCache.getChunk('A|track|model1', 0)).toBeUndefined();
    expect(await indexedDbCache.getChunk('A|track|model2', 1)).toBeUndefined();
    expect(await getVoiceCache('exclusive-A')).toBeUndefined();
    expect(await indexedDbCache.getChunk('B|track|model1', 0)).toEqual(payload);
    const after = await listVideoCaches();
    expect(after.videos.map((video) => video.videoId)).toEqual(['B']);
    expect(after.videos[0]).toMatchObject({ title: 'Video chưa xem xong', translationChunks: 1, voiceEntries: 1 });
    await deleteVideoCache('B');
    expect(await getVoiceCache('shared')).toBeUndefined();
  });

  it('invalidates old producers only for the deleted video and refuses their late cache writes', async () => {
    const a = beginVideoCacheActivity('producer-A');
    const b = beginVideoCacheActivity('producer-B');
    const late = Promise.withResolvers<void>();
    const oldWork = late.promise
      .then(async () => {
        await recordCacheVideo({ videoId: 'producer-A', title: 'Stale' }, a.signal);
        await indexedDbCache.putChunk('producer-A|track|model', 0, payload, a.signal);
        await putVoiceCache('late-A', audio, 'producer-A', a.signal);
      })
      .catch(() => undefined);
    await deleteVideoCache('producer-A');
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    late.resolve();
    await oldWork;
    expect(await indexedDbCache.getChunk('producer-A|track|model', 0)).toBeUndefined();
    expect(await getVoiceCache('late-A')).toBeUndefined();
    await putVoiceCache('working-B', audio, 'producer-B', b.signal);
    expect((await listVideoCaches()).videos.map((video) => video.videoId)).toContain('producer-B');
    a.close();
    b.close();
  });

  it('blocks producers opened during deletion, then permits explicit reopening afterwards', async () => {
    const finish = Promise.withResolvers<void>();
    const deletion = deletingVideoCache('reopen', () => finish.promise);
    const during = beginVideoCacheActivity('reopen');
    expect(during.signal.aborted).toBe(true);
    finish.resolve();
    await deletion;
    const reopened = beginVideoCacheActivity('reopen');
    expect(reopened.signal.aborted).toBe(false);
    during.close();
    reopened.close();
  });
});
