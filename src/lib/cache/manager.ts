import { browser } from 'wxt/browser';
import { clearUnassignedVoiceCache, deleteVoiceVideoCache, listVoiceVideoCaches } from '../voiceover/cache';
import { deletingVideoCache } from './activity';
import { deleteTranslationVideoCache, listTranslationVideoCaches } from './cache';
import type { VideoCacheList, VideoCacheSummary } from './types';

export async function listVideoCaches(): Promise<VideoCacheList> {
  const [translations, voices] = await Promise.all([listTranslationVideoCaches(), listVoiceVideoCaches()]);
  const combined = new Map<string, VideoCacheSummary>();
  for (const video of translations)
    combined.set(video.videoId, { ...video, voiceEntries: 0, voiceBytes: 0, reclaimableVoiceBytes: 0 });
  for (const voice of voices.videos) {
    const base = combined.get(voice.videoId) ?? {
      videoId: voice.videoId,
      title: voice.videoId,
      lastUsedAt: voice.lastUsedAt,
      translationChunks: 0,
      translationBytes: 0,
      voiceEntries: 0,
      voiceBytes: 0,
      reclaimableVoiceBytes: 0,
    };
    combined.set(voice.videoId, { ...base, ...voice, lastUsedAt: Math.max(base.lastUsedAt, voice.lastUsedAt) });
  }
  return {
    videos: [...combined.values()]
      .filter((video) => video.translationChunks > 0 || video.voiceEntries > 0)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.videoId.localeCompare(b.videoId)),
    unassignedVoice: voices.unassigned,
  };
}

async function stopOpenVideo(videoId: string): Promise<void> {
  // Tab IDs are available without the sensitive `tabs` permission. No tab URLs/titles are read.
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await browser.tabs.sendMessage(tab.id, { kind: 'video-cache-deleted', videoId });
      } catch {
        /* Non-YouTube/closed tabs have no matching content script. */
      }
    }),
  );
}

export async function deleteVideoCache(videoId: string): Promise<void> {
  if (!videoId || videoId.length > 128 || /[|\s]/.test(videoId)) throw new Error('Mã video không hợp lệ.');
  await deletingVideoCache(videoId, async () => {
    await stopOpenVideo(videoId);
    // Each store commits independently; retrying after a storage error is safe and idempotent.
    await Promise.all([deleteTranslationVideoCache(videoId), deleteVoiceVideoCache(videoId)]);
  });
}

export async function clearUnassignedCache(): Promise<void> {
  await clearUnassignedVoiceCache();
}
