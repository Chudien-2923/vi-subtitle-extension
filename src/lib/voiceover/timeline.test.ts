import { describe, expect, it } from 'vitest';
import { activeSpeech, speechRate, speechTimeline } from './timeline';

describe('speech timeline', () => {
  it('never treats untranslated English as Vietnamese and switches at exact cue boundaries', () => {
    const cues = speechTimeline(
      [
        { id: 'a', text: 'English only', startMs: 0, endMs: 5000, words: null },
        { id: 'b', text: 'Next', startMs: 5000, endMs: 9000, words: null },
      ],
      new Map([['b', 'Bằng chứng quan trọng hơn số đông.']]),
    );
    expect(activeSpeech(cues, 4999)?.text).toBeNull();
    expect(activeSpeech(cues, 5000)?.text).toBe('Bằng chứng quan trọng hơn số đông.');
    expect(activeSpeech(cues, 9000)).toBeUndefined();
  });
  it('keeps every word in unusually long cues and allocates non-overlapping windows', () => {
    const text = Array.from({ length: 1200 }, (_, i) => `từ${i}`).join(' ');
    const timeline = speechTimeline(
      [{ id: 'a', text: 'source', startMs: 100, endMs: 60_000, words: null }],
      new Map([['a', text]]),
    );
    expect(timeline.map((cue) => cue.text).join(' ')).toBe(text);
    expect(timeline[0]?.startMs).toBe(100);
    expect(timeline.at(-1)?.endMs).toBe(60_000);
    timeline.forEach((cue, i) => {
      expect((cue.text ?? '').length).toBeLessThanOrEqual(1000);
      if (i) expect(cue.startMs).toBe(timeline[i - 1]?.endMs);
    });
  });
  it('combines video speed with duration fitting but does not squeeze arbitrarily long speech', () => {
    expect(speechRate(1.5, 6000, 5000)).toBeCloseTo(1.8);
    expect(speechRate(2, 30_000, 5000)).toBe(2.5);
    expect(speechRate(1.5, 2000, 5000)).toBe(1.5);
  });
});
