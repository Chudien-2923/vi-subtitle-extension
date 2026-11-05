import { type Json3, parseStandardCues } from './json3';
import type { Cue, Word } from './types';

/** Gap after a word's estimated end that counts as a pause. */
const PAUSE_MS = 600;
const MAX_WORDS = 14;
const MAX_CHARS = 84;
const MAX_CUE_MS = 7000;
/** Words a cue needs before sentence punctuation / commas may close it. */
const MIN_WORDS_BEFORE_SENTENCE_BREAK = 3;
const MIN_WORDS_BEFORE_COMMA_BREAK = 8;
/** How long a cue stays on screen after its last word starts, at most. */
export const LAST_WORD_HOLD_MS = 1300;
const NON_SPEECH_HOLD_MS = 2500;

const SENTENCE_END = /[.?!…]["'”’)\]]*$/;
const NON_SPEECH = /^\[.*\]$/;

/** Rough spoken duration of a word; YouTube ASR only provides onsets. */
function estimatedDurationMs(word: Word): number {
  return Math.min(700, Math.max(180, word.text.length * 65));
}

function shouldBreakBefore(group: Word[], next: Word): boolean {
  const last = group[group.length - 1];
  const first = group[0];
  if (!last || !first) return false;
  if (NON_SPEECH.test(last.text) || NON_SPEECH.test(next.text)) return true;
  if (next.startMs - (last.startMs + estimatedDurationMs(last)) > PAUSE_MS) return true;
  if (group.length >= MAX_WORDS) return true;
  const chars = group.reduce((n, w) => n + w.text.length + 1, 0);
  if (chars + next.text.length > MAX_CHARS) return true;
  if (next.startMs - first.startMs > MAX_CUE_MS) return true;
  if (group.length >= MIN_WORDS_BEFORE_SENTENCE_BREAK && SENTENCE_END.test(last.text)) return true;
  return group.length >= MIN_WORDS_BEFORE_COMMA_BREAK && last.text.endsWith(',');
}

/** Builds a cue from consecutive words; it ends at the next cue or shortly after its last word. */
export function cueFromWords(id: string, words: Word[], nextStartMs: number): Cue {
  const first = words[0] as Word;
  const last = words[words.length - 1] as Word;
  const hold = NON_SPEECH.test(last.text) ? NON_SPEECH_HOLD_MS : LAST_WORD_HOLD_MS;
  return {
    id,
    startMs: first.startMs,
    endMs: Math.min(nextStartMs, last.startMs + hold),
    text: words.map((w) => w.text).join(' '),
    words,
  };
}

/**
 * Heuristic cues for ASR words (pauses, punctuation, length limits). Used
 * until the model's sentence segmentation for that stretch arrives, and as
 * the fallback when segmentation fails.
 */
export function segmentWords(words: readonly Word[], idPrefix: string): Cue[] {
  const groups: Word[][] = [];
  let current: Word[] = [];
  for (const word of words) {
    if (current.length > 0 && shouldBreakBefore(current, word)) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group, i) =>
    cueFromWords(`${idPrefix}${i}`, group, groups[i + 1]?.[0]?.startMs ?? Number.POSITIVE_INFINITY),
  );
}

/** Cues for a human-made track: one per caption event. */
export function standardCues(data: Json3): Cue[] {
  return parseStandardCues(data).map((raw, i) => ({ id: `c${i}`, ...raw, words: null }));
}
