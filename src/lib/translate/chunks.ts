import type { Cue, SourceText, Word } from '../captions/types';

/** Human captions per translation request. */
export const CUE_CHUNK_SIZE = 45;
export const CUE_CONTEXT_SIZE = 6;
/** ASR words per translation request (~1.5–2 minutes of speech). */
export const WORD_CHUNK_SIZE = 250;
export const WORD_CONTEXT_SIZE = 40;
/** How far a word chunk boundary may move to land on the longest pause. */
const WORD_BOUNDARY_WINDOW = 40;
/** A trailing remainder shorter than this joins the previous chunk. */
const MIN_TAIL_WORDS = 60;
const LAST_CHUNK_HOLD_MS = 2000;

/**
 * Half-open index range [start, end) into the source's cues or words, with
 * the time span used to prioritize chunks around the playhead.
 */
export interface ChunkPlan {
  index: number;
  start: number;
  end: number;
  startMs: number;
  endMs: number;
}

function planCueChunks(cues: readonly Cue[]): ChunkPlan[] {
  const plans: ChunkPlan[] = [];
  for (let start = 0; start < cues.length; start += CUE_CHUNK_SIZE) {
    const end = Math.min(cues.length, start + CUE_CHUNK_SIZE);
    plans.push({
      index: plans.length,
      start,
      end,
      startMs: (cues[start] as Cue).startMs,
      endMs: (cues[end - 1] as Cue).endMs,
    });
  }
  return plans;
}

/** Cuts word chunks at the longest pause near the target size so sentences rarely straddle chunks. */
function planWordChunks(words: readonly Word[]): ChunkPlan[] {
  const bounds: Array<[number, number]> = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(words.length, start + WORD_CHUNK_SIZE);
    if (words.length - end < MIN_TAIL_WORDS) {
      end = words.length;
    } else {
      let bestGap = -1;
      const from = Math.max(start + 1, end - WORD_BOUNDARY_WINDOW);
      const to = Math.min(words.length - 1, end + WORD_BOUNDARY_WINDOW);
      for (let i = from; i <= to; i++) {
        const gap = (words[i] as Word).startMs - (words[i - 1] as Word).startMs;
        if (gap > bestGap) {
          bestGap = gap;
          end = i;
        }
      }
    }
    bounds.push([start, end]);
    start = end;
  }
  return bounds.map(([s, e], index) => ({
    index,
    start: s,
    end: e,
    startMs: (words[s] as Word).startMs,
    endMs: words[e]?.startMs ?? (words[e - 1] as Word).startMs + LAST_CHUNK_HOLD_MS,
  }));
}

export function planChunks(source: SourceText): ChunkPlan[] {
  return source.mode === 'cues' ? planCueChunks(source.cues) : planWordChunks(source.words);
}

/** Index of the chunk being watched at `playheadMs` (first chunk that has not ended yet). */
export function chunkAtTime(plans: readonly ChunkPlan[], playheadMs: number): number {
  const index = plans.findIndex((p) => p.endMs > playheadMs);
  return index === -1 ? plans.length - 1 : index;
}

/**
 * Chunk order for a playhead: the chunk being watched, then everything after
 * it, then earlier chunks (nearest first).
 */
export function priorityOrder(chunkCount: number, current: number): number[] {
  const first = Math.min(Math.max(0, current), Math.max(0, chunkCount - 1));
  const order: number[] = [];
  for (let i = first; i < chunkCount; i++) order.push(i);
  for (let i = first - 1; i >= 0; i--) order.push(i);
  return order;
}
