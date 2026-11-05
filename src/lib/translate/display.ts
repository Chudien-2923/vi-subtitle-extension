import { cueFromWords, segmentWords } from '../captions/segment';
import type { Cue, SourceText, Word } from '../captions/types';
import type { ChunkPlan } from './chunks';

/** A model-chosen subtitle: starts at word index `start`, runs until the next segment. */
export interface Segment {
  start: number;
  vi: string;
}

/** Translation result for one chunk; this is what gets cached. */
export type ChunkPayload =
  | { mode: 'cues'; translations: Record<string, string> }
  | { mode: 'segments'; segments: Segment[] };

/** Heuristic cues of one word chunk (stable ids, so the per-cue fallback can address them). */
export function heuristicCues(words: readonly Word[], plan: ChunkPlan): Cue[] {
  return segmentWords(words.slice(plan.start, plan.end), `h${plan.index}-`);
}

/** Cues for model segments; `segments` are validated: sorted, first at plan.start, inside the plan. */
export function segmentCues(words: readonly Word[], plan: ChunkPlan, segments: readonly Segment[]): Cue[] {
  return segments.map((segment, k) => {
    const end = segments[k + 1]?.start ?? plan.end;
    const nextStart = words[end]?.startMs ?? Number.POSITIVE_INFINITY;
    return cueFromWords(`s${plan.index}-${k}`, words.slice(segment.start, end), nextStart);
  });
}

export interface DisplayState {
  cues: Cue[];
  translations: Array<[string, string]>;
}

/** The cue list to show right now, given whichever chunks are translated. */
export function buildDisplay(
  source: SourceText,
  plans: readonly ChunkPlan[],
  payloads: ReadonlyMap<number, ChunkPayload>,
): DisplayState {
  const translations: Array<[string, string]> = [];
  if (source.mode === 'cues') {
    for (const payload of payloads.values()) {
      if (payload.mode === 'cues') translations.push(...Object.entries(payload.translations));
    }
    return { cues: source.cues, translations };
  }

  const cues: Cue[] = [];
  for (const plan of plans) {
    const payload = payloads.get(plan.index);
    if (payload?.mode === 'segments') {
      const chunkCues = segmentCues(source.words, plan, payload.segments);
      chunkCues.forEach((cue, k) => {
        translations.push([cue.id, (payload.segments[k] as Segment).vi]);
      });
      cues.push(...chunkCues);
    } else {
      cues.push(...heuristicCues(source.words, plan));
      if (payload?.mode === 'cues') translations.push(...Object.entries(payload.translations));
    }
  }
  // Chunks are built independently; a cue must not run into the next chunk's first cue.
  for (let i = 0; i < cues.length - 1; i++) {
    const cue = cues[i] as Cue;
    cue.endMs = Math.min(cue.endMs, (cues[i + 1] as Cue).startMs);
  }
  return { cues, translations };
}
