/** A spoken word with its onset, taken from YouTube ASR word timings. */
export interface Word {
  text: string;
  startMs: number;
}

/** One display/translation unit. `words` is null when the track has no per-word timing. */
export interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words: Word[] | null;
}

export type TrackKind = 'asr' | 'standard';

export interface CaptionTrackInfo {
  languageCode: string;
  kind: TrackKind;
  name: string;
  vssId: string;
}

export interface VideoMeta {
  videoId: string;
  title: string;
  author: string;
  track: CaptionTrackInfo;
}

/**
 * What gets translated. Human captions are already sentence-shaped cues;
 * auto-generated captions are an unpunctuated word stream that the model
 * splits into sentences itself.
 */
export type SourceText = { mode: 'cues'; cues: Cue[] } | { mode: 'words'; words: Word[] };

/** Bump when cue segmentation or chunk planning changes: ids and indices are cache keys. */
export const SEGMENTER_VERSION = 2;
