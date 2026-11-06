import type { Cue } from '../captions/types';

export interface SpeechCue {
  key: string;
  startMs: number;
  endMs: number;
  text: string | null;
}

/** Preserve every word, including unusually long manually authored caption cues. */
function splitText(text: string): string[] {
  const pieces: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 1000) {
    const space = remaining.lastIndexOf(' ', 1000);
    const boundary = space > 0 ? space : 1000;
    pieces.push(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

export function speechTimeline(cues: readonly Cue[], translations: ReadonlyMap<string, string>): SpeechCue[] {
  return cues.flatMap((cue): SpeechCue[] => {
    if (cue.endMs <= cue.startMs) return [];
    const text = translations.get(cue.id)?.trim();
    if (!text) return [{ key: `${cue.startMs}:pending`, startMs: cue.startMs, endMs: cue.endMs, text: null }];
    const pieces = splitText(text);
    const size = pieces.reduce((sum, piece) => sum + piece.length, 0);
    let offset = 0;
    return pieces.map((piece) => {
      const startMs = cue.startMs + ((cue.endMs - cue.startMs) * offset) / size;
      offset += piece.length;
      return {
        key: `${startMs}:${piece}`,
        startMs,
        endMs: cue.startMs + ((cue.endMs - cue.startMs) * offset) / size,
        text: piece,
      };
    });
  });
}

export function activeSpeech(cues: readonly SpeechCue[], timeMs: number): SpeechCue | undefined {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((cues[mid] as SpeechCue).startMs <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  const cue = cues[lo - 1];
  return cue && timeMs < cue.endMs ? cue : undefined;
}

/** Never squeeze speech without a bound; remaining overflow is handled by a video hold. */
export function speechRate(videoRate: number, durationMs: number, windowMs: number): number {
  const rate = Number.isFinite(videoRate) && videoRate > 0 ? videoRate : 1;
  const fit = Math.min(1.25, Math.max(1, durationMs / Math.max(windowMs, 1)));
  return rate * fit;
}
