export interface CacheVideo {
  videoId: string;
  title: string;
  lastUsedAt: number;
}

export type CacheVideoContext = Pick<CacheVideo, 'videoId' | 'title'>;

export interface TranslationVideoCache extends CacheVideo {
  translationChunks: number;
  translationBytes: number;
}

export interface VoiceVideoCache {
  videoId: string;
  voiceEntries: number;
  voiceBytes: number;
  reclaimableVoiceBytes: number;
  lastUsedAt: number;
}

export interface VideoCacheSummary extends TranslationVideoCache {
  voiceEntries: number;
  voiceBytes: number;
  reclaimableVoiceBytes: number;
}

export interface VideoCacheList {
  videos: VideoCacheSummary[];
  unassignedVoice: { entries: number; bytes: number };
}
