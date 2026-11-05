import type { Word } from './types';

/** Subset of YouTube's `fmt=json3` timedtext format that we read. */
export interface Json3Seg {
  utf8?: string;
  tOffsetMs?: number;
}

export interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Json3Seg[];
  aAppend?: number;
}

export interface Json3 {
  events: Json3Event[];
}

export interface RawCue {
  startMs: number;
  endMs: number;
  text: string;
}

export function isJson3(value: unknown): value is Json3 {
  return typeof value === 'object' && value !== null && 'events' in value && Array.isArray(value.events);
}

/** Parses a JSON string into json3, or returns null when it is not json3. */
export function parseJson3Text(text: string): Json3 | null {
  if (!text.trim()) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isJson3(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Human-made track: every event is one caption. Events starting at the same
 * time are merged; overlapping ends are clamped to the next start.
 */
export function parseStandardCues(data: Json3): RawCue[] {
  const raw: RawCue[] = [];
  for (const event of data.events) {
    if (!event.segs || event.tStartMs === undefined) continue;
    const text = event.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const startMs = event.tStartMs;
    raw.push({ startMs, endMs: startMs + (event.dDurationMs ?? 0), text });
  }
  raw.sort((a, b) => a.startMs - b.startMs);

  const merged: RawCue[] = [];
  for (const cue of raw) {
    const last = merged[merged.length - 1];
    if (last && last.startMs === cue.startMs) {
      last.text = `${last.text} ${cue.text}`;
      last.endMs = Math.max(last.endMs, cue.endMs);
    } else {
      merged.push({ ...cue });
    }
  }
  for (let i = 0; i < merged.length - 1; i++) {
    const cue = merged[i] as RawCue;
    const next = merged[i + 1] as RawCue;
    if (cue.endMs > next.startMs) cue.endMs = next.startMs;
  }
  return merged.filter((c) => c.endMs > c.startMs);
}

/**
 * ASR track: words carry `tOffsetMs` relative to their event. Line-break
 * events (`aAppend` with "\n") contain no words and fall out naturally.
 */
export function parseAsrWords(data: Json3): Word[] {
  const words: Word[] = [];
  for (const event of data.events) {
    if (!event.segs || event.tStartMs === undefined) continue;
    for (const seg of event.segs) {
      const text = (seg.utf8 ?? '').trim();
      if (!text) continue;
      words.push({ text, startMs: event.tStartMs + (seg.tOffsetMs ?? 0) });
    }
  }
  words.sort((a, b) => a.startMs - b.startMs);
  return words.filter((w, i) => {
    const prev = words[i - 1];
    return !prev || prev.startMs !== w.startMs || prev.text !== w.text;
  });
}
