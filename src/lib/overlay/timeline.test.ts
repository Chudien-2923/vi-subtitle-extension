import { describe, expect, it } from 'vitest';
import type { Cue, Word } from '../captions/types';
import { englishLineAt, findActiveCue, PHRASE_MAX_CHARS, PHRASE_MAX_WORDS, splitPhrases } from './timeline';

const cue = (id: string, startMs: number, endMs: number, words: Word[] | null = null): Cue => ({
  id,
  startMs,
  endMs,
  text: words ? words.map((w) => w.text).join(' ') : id,
  words,
});

describe('findActiveCue', () => {
  const cues = [cue('a', 1000, 2000), cue('b', 2000, 3000), cue('c', 5000, 6000)];

  it('uses half-open [start, end) intervals', () => {
    expect(findActiveCue(cues, 999)).toBe(-1);
    expect(findActiveCue(cues, 1000)).toBe(0);
    expect(findActiveCue(cues, 1999)).toBe(0);
    expect(findActiveCue(cues, 2000)).toBe(1);
  });

  it('returns -1 in gaps and after the last cue', () => {
    expect(findActiveCue(cues, 4000)).toBe(-1);
    expect(findActiveCue(cues, 6000)).toBe(-1);
    expect(findActiveCue([], 0)).toBe(-1);
  });
});

describe('splitPhrases', () => {
  it('respects word and character limits without losing words', () => {
    const words: Word[] = Array.from({ length: 17 }, (_, i) => ({ text: `word${i}`, startMs: i * 100 }));
    const phrases = splitPhrases(words);
    expect(phrases.flat()).toEqual(words);
    for (const phrase of phrases) {
      expect(phrase.length).toBeLessThanOrEqual(PHRASE_MAX_WORDS);
      expect(phrase.map((w) => w.text).join(' ').length).toBeLessThanOrEqual(PHRASE_MAX_CHARS);
    }
  });

  it('splits on characters before reaching the word limit', () => {
    const long = Array.from({ length: 5 }, (_, i) => ({ text: 'x'.repeat(20), startMs: i }));
    expect(splitPhrases(long).map((p) => p.length)).toEqual([3, 2]);
  });
});

describe('englishLineAt', () => {
  const words: Word[] = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].map((text, i) => ({
    text,
    startMs: 1000 + i * 100,
  }));
  const timed = cue('t', 1000, 3000, words);
  const phrases = splitPhrases(words);

  it('never reveals a word before it is spoken', () => {
    for (let t = 900; t <= 2000; t += 50) {
      const line = englishLineAt(timed, phrases, t);
      const spoken = new Set(words.filter((w) => w.startMs <= t).map((w) => w.text));
      for (const visible of line.words.slice(0, line.visible)) expect(spoken.has(visible)).toBe(true);
    }
  });

  it('shows nothing before the first word and lays out the whole current phrase', () => {
    expect(englishLineAt(timed, phrases, 999)).toEqual({ words: [], visible: 0 });
    expect(englishLineAt(timed, phrases, 1150)).toEqual({
      words: ['one', 'two', 'three', 'four', 'five', 'six', 'seven'],
      visible: 2,
    });
  });

  it('moves to the next phrase once it starts', () => {
    expect(englishLineAt(timed, phrases, 1700)).toEqual({ words: ['eight', 'nine'], visible: 1 });
    expect(englishLineAt(timed, phrases, 2900)).toEqual({ words: ['eight', 'nine'], visible: 2 });
  });

  it('shows the full text when the track has no word timings', () => {
    expect(englishLineAt(cue('Hello there.', 0, 1000), null, 10)).toEqual({ words: ['Hello there.'], visible: 1 });
  });
});
