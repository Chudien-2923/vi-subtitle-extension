import { describe, expect, it } from 'vitest';
import type { Cue, Word } from '../captions/types';
import { chunkAtTime, planChunks, priorityOrder, WORD_CHUNK_SIZE } from './chunks';
import { buildDisplay, type ChunkPayload } from './display';

/** Continuous speech every 300 ms with a 2 s pause after each index in `pausesAfter`. */
function speech(count: number, pausesAfter: number[] = []): Word[] {
  const words: Word[] = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    words.push({ text: `w${i}`, startMs: t });
    t += pausesAfter.includes(i) ? 2000 : 300;
  }
  return words;
}

describe('planChunks (words)', () => {
  it('covers every word once and cuts at the longest nearby pause', () => {
    const words = speech(700, [WORD_CHUNK_SIZE + 17]);
    const plans = planChunks({ mode: 'words', words });
    expect(plans[0]?.start).toBe(0);
    expect(plans[0]?.end).toBe(WORD_CHUNK_SIZE + 18);
    for (let i = 1; i < plans.length; i++) expect(plans[i]?.start).toBe(plans[i - 1]?.end);
    expect(plans[plans.length - 1]?.end).toBe(700);
  });

  it('merges a short tail into the last chunk', () => {
    const plans = planChunks({ mode: 'words', words: speech(WORD_CHUNK_SIZE + 30) });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.end).toBe(WORD_CHUNK_SIZE + 30);
  });
});

describe('planChunks (cues) and playhead priority', () => {
  const cues: Cue[] = Array.from({ length: 100 }, (_, i) => ({
    id: `c${i}`,
    startMs: i * 1000,
    endMs: i * 1000 + 900,
    text: `${i}`,
    words: null,
  }));
  const plans = planChunks({ mode: 'cues', cues });

  it('splits into fixed-size chunks with time spans', () => {
    expect(plans.map((p) => [p.start, p.end])).toEqual([
      [0, 45],
      [45, 90],
      [90, 100],
    ]);
    expect(plans[1]?.startMs).toBe(45_000);
  });

  it('finds the watched chunk and orders the rest around it', () => {
    expect(chunkAtTime(plans, 50_000)).toBe(1);
    expect(chunkAtTime(plans, 10_000_000)).toBe(2);
    expect(priorityOrder(5, 2)).toEqual([2, 3, 4, 1, 0]);
  });
});

describe('buildDisplay (words)', () => {
  const words = speech(20, [9]);
  const source = { mode: 'words' as const, words };
  const plans = planChunks(source);

  it('shows heuristic cues until a chunk is translated', () => {
    const display = buildDisplay(source, plans, new Map());
    expect(display.translations).toEqual([]);
    expect(display.cues.flatMap((c) => c.words ?? [])).toEqual(words);
  });

  it('switches a translated chunk to the model segmentation with word timings', () => {
    const payload: ChunkPayload = {
      mode: 'segments',
      segments: [
        { start: 0, vi: 'Câu một' },
        { start: 6, vi: 'Câu hai' },
        { start: 10, vi: 'Câu ba' },
      ],
    };
    const display = buildDisplay(source, plans, new Map([[0, payload]]));
    expect(display.cues.map((c) => c.words?.map((w) => w.text).join(' '))).toEqual([
      'w0 w1 w2 w3 w4 w5',
      'w6 w7 w8 w9',
      'w10 w11 w12 w13 w14 w15 w16 w17 w18 w19',
    ]);
    expect(display.translations.map(([, vi]) => vi)).toEqual(['Câu một', 'Câu hai', 'Câu ba']);
    expect(display.cues[0]?.startMs).toBe(0);
    expect(display.cues[0]?.endMs).toBe(words[6]?.startMs);
  });

  it('uses per-cue fallback translations on heuristic cues', () => {
    const heuristic = buildDisplay(source, plans, new Map());
    const payload: ChunkPayload = { mode: 'cues', translations: { [heuristic.cues[0]?.id ?? '']: 'Dự phòng' } };
    const display = buildDisplay(source, plans, new Map([[0, payload]]));
    expect(display.cues.map((c) => c.id)).toEqual(heuristic.cues.map((c) => c.id));
    expect(display.translations).toEqual([[heuristic.cues[0]?.id, 'Dự phòng']]);
  });

  it('never lets cues overlap across chunk boundaries', () => {
    const long = speech(WORD_CHUNK_SIZE * 2 + 100, [WORD_CHUNK_SIZE]);
    const longSource = { mode: 'words' as const, words: long };
    const cues = buildDisplay(longSource, planChunks(longSource), new Map()).cues;
    for (let i = 0; i < cues.length - 1; i++) {
      expect(cues[i]?.endMs).toBeLessThanOrEqual(cues[i + 1]?.startMs ?? 0);
    }
  });
});
