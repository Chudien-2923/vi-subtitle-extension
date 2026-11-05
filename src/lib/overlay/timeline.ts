import type { Cue, Word } from '../captions/types';

/** English phrase limits, from the approved IINA bilingual layout. */
export const PHRASE_MAX_WORDS = 7;
export const PHRASE_MAX_CHARS = 64;

/** Index of the cue on screen at `timeMs`, or -1. `cues` must be sorted by start. */
export function findActiveCue(cues: readonly Cue[], timeMs: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((cues[mid] as Cue).startMs <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return -1;
  return timeMs < (cues[found] as Cue).endMs ? found : -1;
}

/** Splits a cue's words into short phrases shown one at a time. */
export function splitPhrases(words: readonly Word[]): Word[][] {
  const phrases: Word[][] = [];
  let current: Word[] = [];
  let chars = 0;
  for (const word of words) {
    const projected = current.length === 0 ? word.text.length : chars + 1 + word.text.length;
    if (current.length > 0 && (current.length >= PHRASE_MAX_WORDS || projected > PHRASE_MAX_CHARS)) {
      phrases.push(current);
      current = [];
      chars = word.text.length;
    } else {
      chars = projected;
    }
    current.push(word);
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
}

export interface EnglishLine {
  /** Words laid out on the line, including not-yet-spoken ones (kept hidden for a stable layout). */
  words: string[];
  /** How many leading `words` have been spoken and are visible. */
  visible: number;
}

/**
 * English line at `timeMs`. With word timings, reveals the current phrase
 * word by word; without them, shows the whole cue.
 */
export function englishLineAt(cue: Cue, phrases: readonly Word[][] | null, timeMs: number): EnglishLine {
  if (!cue.words || !phrases) {
    return { words: [cue.text], visible: 1 };
  }
  let spoken = 0;
  for (const word of cue.words) {
    if (word.startMs > timeMs) break;
    spoken++;
  }
  if (spoken === 0) return { words: [], visible: 0 };

  let offset = 0;
  for (const phrase of phrases) {
    if (spoken <= offset + phrase.length) {
      return { words: phrase.map((w) => w.text), visible: spoken - offset };
    }
    offset += phrase.length;
  }
  const lastPhrase = phrases[phrases.length - 1] ?? [];
  return { words: lastPhrase.map((w) => w.text), visible: lastPhrase.length };
}
