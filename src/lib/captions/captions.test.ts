import { describe, expect, it } from 'vitest';
import { type Json3, parseAsrWords, parseJson3Text, parseStandardCues } from './json3';
import { segmentWords, standardCues } from './segment';
import type { Word } from './types';

/** Same shape as YouTube's auto-generated json3: window events, word events, "\n" append events. */
const ASR_JSON3: Json3 = {
  events: [
    { tStartMs: 0, dDurationMs: 265730 },
    { tStartMs: 110, dDurationMs: 4000, segs: [{ utf8: '[Music]' }] },
    {
      tStartMs: 5000,
      dDurationMs: 5000,
      segs: [
        { utf8: 'every' },
        { utf8: ' day', tOffsetMs: 300 },
        { utf8: ' we', tOffsetMs: 700 },
        { utf8: ' choose', tOffsetMs: 900 },
      ],
    },
    { tStartMs: 6500, dDurationMs: 2000, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 6510, dDurationMs: 4000, segs: [{ utf8: 'small' }, { utf8: ' things', tOffsetMs: 250 }] },
    { tStartMs: 9000, dDurationMs: 3000, segs: [{ utf8: 'then' }, { utf8: ' rest', tOffsetMs: 300 }] },
  ],
};

const words = (spec: Array<[string, number]>): Word[] => spec.map(([text, startMs]) => ({ text, startMs }));

describe('parseJson3Text', () => {
  it('accepts json3 and rejects other payloads', () => {
    expect(parseJson3Text('{"events":[]}')).toEqual({ events: [] });
    expect(parseJson3Text('')).toBeNull();
    expect(parseJson3Text('<transcript></transcript>')).toBeNull();
    expect(parseJson3Text('{"foo":1}')).toBeNull();
  });
});

describe('parseStandardCues', () => {
  it('joins multi-line captions, drops empty events and clamps overlaps', () => {
    const cues = parseStandardCues({
      events: [
        { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: 'Every day, a sea of decisions \nstretches before us.' }] },
        { tStartMs: 3500, dDurationMs: 1000, segs: [{ utf8: 'Some are small,' }] },
        { tStartMs: 4500, dDurationMs: 500, segs: [{ utf8: '\n' }] },
      ],
    });
    expect(cues).toEqual([
      { startMs: 1000, endMs: 3500, text: 'Every day, a sea of decisions stretches before us.' },
      { startMs: 3500, endMs: 4500, text: 'Some are small,' },
    ]);
  });

  it('merges events that start at the same time', () => {
    const cues = parseStandardCues({
      events: [
        { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '- Hi.' }] },
        { tStartMs: 0, dDurationMs: 2500, segs: [{ utf8: '- Hello.' }] },
      ],
    });
    expect(cues).toEqual([{ startMs: 0, endMs: 2500, text: '- Hi. - Hello.' }]);
  });

  it('gives standard cues ids and no word timings', () => {
    expect(standardCues({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello.' }] }] })).toEqual([
      { id: 'c0', startMs: 0, endMs: 1000, text: 'Hello.', words: null },
    ]);
  });
});

describe('parseAsrWords', () => {
  it('computes absolute onsets and skips line-break events', () => {
    expect(parseAsrWords(ASR_JSON3).map((w) => [w.text, w.startMs])).toEqual([
      ['[Music]', 110],
      ['every', 5000],
      ['day', 5300],
      ['we', 5700],
      ['choose', 5900],
      ['small', 6510],
      ['things', 6760],
      ['then', 9000],
      ['rest', 9300],
    ]);
  });
});

describe('segmentWords', () => {
  const asrWords = parseAsrWords(ASR_JSON3);

  it('keeps every word exactly once, in order, with non-overlapping cues', () => {
    const cues = segmentWords(asrWords, 'h');
    expect(cues.flatMap((c) => c.words ?? [])).toEqual(asrWords);
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const next = cues[i + 1];
      expect(cue?.endMs).toBeGreaterThan(cue?.startMs ?? 0);
      if (cue && next) expect(cue.endMs).toBeLessThanOrEqual(next.startMs);
    }
  });

  it('isolates non-speech tags and breaks at long pauses', () => {
    expect(segmentWords(asrWords, 'h').map((c) => [c.id, c.text])).toEqual([
      ['h0', '[Music]'],
      ['h1', 'every day we choose small things'],
      ['h2', 'then rest'],
    ]);
  });

  it('breaks after sentence punctuation once a cue has a few words', () => {
    const cues = segmentWords(
      words([
        ['So', 0],
        ['that', 200],
        ['is', 400],
        ['it.', 600],
        ['Next', 900],
        ['topic', 1100],
      ]),
      'h',
    );
    expect(cues.map((c) => c.text)).toEqual(['So that is it.', 'Next topic']);
  });

  it('caps cue length for continuous speech', () => {
    const continuous = words(Array.from({ length: 40 }, (_, i): [string, number] => [`w${i}`, i * 200]));
    const cues = segmentWords(continuous, 'h');
    expect(cues.length).toBeGreaterThan(2);
    for (const cue of cues) {
      expect(cue.words?.length).toBeLessThanOrEqual(14);
      expect(cue.text.length).toBeLessThanOrEqual(84);
    }
  });
});
