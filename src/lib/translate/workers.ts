import type { Cue, SourceText, VideoMeta } from '../captions/types';
import { ProviderError } from '../providers/errors';
import type { LlmClient } from '../providers/types';
import { type ChunkPlan, CUE_CONTEXT_SIZE, planChunks, WORD_CONTEXT_SIZE } from './chunks';
import { type ChunkPayload, heuristicCues, segmentCues } from './display';
import {
  buildCueUser,
  buildSegmentUser,
  CUE_SCHEMA,
  CUE_SYSTEM_PROMPT,
  type CueChunkInput,
  MAX_SEGMENT_WORDS,
  REVIEW_SYSTEM_PROMPT,
  SCHEMA_NAME,
  SEGMENT_SCHEMA,
  SEGMENT_SYSTEM_PROMPT,
} from './prompt';
import { parseSegments, parseTranslation } from './validate';

export interface ChunkOutcome {
  payload: ChunkPayload;
  /** Source units (cues or words) left untranslated; they show in English. */
  failedUnits: number;
  /** False when some units are missing and another attempt may fill them. */
  complete: boolean;
}

/** Turns one chunk plan into a translated payload; the session handles order, retries and cache. */
export interface ChunkWorker {
  readonly plans: ChunkPlan[];
  /** Attempts per chunk (bad output or incomplete output) before giving up. */
  readonly maxAttempts: number;
  unitCount(plan: ChunkPlan): number;
  translate(plan: ChunkPlan, attempt: number, signal: AbortSignal): Promise<ChunkOutcome>;
}

interface WorkerContext {
  meta: VideoMeta;
  client: LlmClient;
  reviewPass: boolean;
}

async function translateCues(
  ctx: WorkerContext,
  input: CueChunkInput,
  signal: AbortSignal,
): Promise<{ translations: Map<string, string>; missing: string[] }> {
  const ids = input.cues.map((c) => c.id);
  const draftText = await ctx.client.complete({
    system: CUE_SYSTEM_PROMPT,
    user: buildCueUser(ctx.meta, input),
    schema: CUE_SCHEMA,
    schemaName: SCHEMA_NAME,
    signal,
  });
  const draft = parseTranslation(draftText, ids);
  if (!ctx.reviewPass || draft.missing.length > 0) return draft;
  return { translations: await review(ctx, input, draft.translations, signal), missing: [] };
}

/** Second pass; a malformed review keeps the draft rather than failing the chunk. */
async function review(
  ctx: WorkerContext,
  input: CueChunkInput,
  draft: Map<string, string>,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const text = await ctx.client.complete({
    system: REVIEW_SYSTEM_PROMPT,
    user: buildCueUser(ctx.meta, input, draft),
    schema: CUE_SCHEMA,
    schemaName: SCHEMA_NAME,
    signal,
  });
  try {
    const reviewed = parseTranslation(
      text,
      input.cues.map((c) => c.id),
    );
    return new Map([...draft, ...reviewed.translations]);
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'bad-output') return draft;
    throw error;
  }
}

function cueInput(cues: readonly Cue[], start: number, end: number): CueChunkInput {
  return {
    before: cues.slice(Math.max(0, start - CUE_CONTEXT_SIZE), start),
    cues: cues.slice(start, end),
    after: cues.slice(end, end + CUE_CONTEXT_SIZE),
  };
}

/** Model attempts at sentence segmentation before falling back to heuristic cues. */
const SEGMENTATION_ATTEMPTS = 2;

export function createWorker(ctx: WorkerContext, source: SourceText): ChunkWorker {
  const plans = planChunks(source);

  if (source.mode === 'cues') {
    return {
      plans,
      maxAttempts: 3,
      unitCount: (plan) => plan.end - plan.start,
      async translate(plan, _attempt, signal) {
        const result = await translateCues(ctx, cueInput(source.cues, plan.start, plan.end), signal);
        return {
          payload: { mode: 'cues', translations: Object.fromEntries(result.translations) },
          failedUnits: result.missing.length,
          complete: result.missing.length === 0,
        };
      },
    };
  }

  const words = source.words;
  return {
    plans,
    maxAttempts: SEGMENTATION_ATTEMPTS + 2,
    unitCount: (plan) => plan.end - plan.start,
    async translate(plan, attempt, signal) {
      if (attempt >= SEGMENTATION_ATTEMPTS) {
        // Fallback: translate the heuristic cues one by one, like human captions.
        const cues = heuristicCues(words, plan);
        const previous = plans[plan.index - 1];
        const next = plans[plan.index + 1];
        const result = await translateCues(
          ctx,
          {
            before: previous ? heuristicCues(words, previous).slice(-CUE_CONTEXT_SIZE) : [],
            cues,
            after: next ? heuristicCues(words, next).slice(0, CUE_CONTEXT_SIZE) : [],
          },
          signal,
        );
        const failedWords = cues
          .filter((c) => !result.translations.has(c.id))
          .reduce((n, c) => n + (c.words?.length ?? 0), 0);
        return {
          payload: { mode: 'cues', translations: Object.fromEntries(result.translations) },
          failedUnits: failedWords,
          complete: result.missing.length === 0,
        };
      }

      const text = await ctx.client.complete({
        system: SEGMENT_SYSTEM_PROMPT,
        user: buildSegmentUser(ctx.meta, words, plan.start, plan.end, WORD_CONTEXT_SIZE),
        schema: SEGMENT_SCHEMA,
        schemaName: SCHEMA_NAME,
        signal,
      });
      let segments = parseSegments(text, plan.start, plan.end, MAX_SEGMENT_WORDS);
      if (ctx.reviewPass) {
        const cues = segmentCues(words, plan, segments);
        const draft = new Map(cues.map((c, k) => [c.id, segments[k]?.vi ?? '']));
        const reviewed = await review(ctx, { before: [], cues, after: [] }, draft, signal);
        segments = segments.map((s, k) => ({ start: s.start, vi: reviewed.get(cues[k]?.id ?? '') ?? s.vi }));
      }
      return { payload: { mode: 'segments', segments }, failedUnits: 0, complete: true };
    },
  };
}
