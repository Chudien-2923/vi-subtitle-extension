import type { CaptionTrackInfo } from '../captions/types';
import { isRecord } from '../guards';

export interface YtCaptionTrack extends CaptionTrackInfo {
  baseUrl: string;
}

export interface PlayerInfo {
  tracks: YtCaptionTrack[];
  title: string;
  author: string;
}

function textOf(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (!Array.isArray(value.runs)) return '';
  return value.runs.map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : '')).join('');
}

/** Reads caption tracks and metadata from a YouTube player response, if it belongs to `videoId`. */
export function parsePlayerResponse(response: unknown, videoId: string): PlayerInfo | null {
  if (!isRecord(response) || !isRecord(response.videoDetails)) return null;
  const details = response.videoDetails;
  if (details.videoId !== videoId) return null;
  const renderer = isRecord(response.captions) ? response.captions.playerCaptionsTracklistRenderer : undefined;
  const rawTracks = isRecord(renderer) && Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
  const tracks = rawTracks.flatMap((t): YtCaptionTrack[] => {
    if (!isRecord(t) || typeof t.baseUrl !== 'string' || typeof t.languageCode !== 'string') return [];
    const kind = t.kind === 'asr' ? 'asr' : 'standard';
    return [
      {
        baseUrl: t.baseUrl,
        languageCode: t.languageCode,
        kind,
        name: textOf(t.name),
        vssId: typeof t.vssId === 'string' ? t.vssId : `${kind === 'asr' ? 'a' : ''}.${t.languageCode}`,
      },
    ];
  });
  return {
    tracks,
    title: typeof details.title === 'string' ? details.title : '',
    author: typeof details.author === 'string' ? details.author : '',
  };
}

/** Human-made English beats auto-generated; plain `en` beats regional variants. */
export function pickEnglishTrack(tracks: readonly YtCaptionTrack[]): YtCaptionTrack | null {
  const rank = (t: YtCaptionTrack) => (t.kind === 'standard' ? 0 : 2) + (t.languageCode === 'en' ? 0 : 1);
  const english = tracks.filter((t) => t.languageCode === 'en' || t.languageCode.startsWith('en-'));
  return english.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Validates a track description received over window.postMessage (page scripts can forge messages). */
export function parseTrackInfo(value: unknown): CaptionTrackInfo | null {
  if (!isRecord(value)) return null;
  const { languageCode, kind, name, vssId } = value;
  if (typeof languageCode !== 'string' || typeof name !== 'string' || typeof vssId !== 'string') return null;
  if (kind !== 'asr' && kind !== 'standard') return null;
  return { languageCode, kind, name, vssId };
}
