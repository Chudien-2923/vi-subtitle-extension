import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationCache } from '../cache/cache';
import type { Cue, SourceText, VideoMeta, Word } from '../captions/types';
import { ProviderError } from '../providers/errors';
import type { CompletionRequest, LlmClient } from '../providers/types';
import { CUE_CHUNK_SIZE } from './chunks';
import type { ChunkPayload } from './display';
import { type SessionEvents, TranslationSession } from './session';
import { createWorker } from './workers';

const meta = (kind: 'asr' | 'standard'): VideoMeta => ({
  videoId: 'vid',
  title: 't',
  author: 'a',
  track: { languageCode: 'en', kind, name: 'English', vssId: kind === 'asr' ? 'a.en' : '.en' },
});

const cueSource = (count: number): SourceText => ({
  mode: 'cues',
  cues: Array.from(
    { length: count },
    (_, i): Cue => ({ id: `c${i}`, startMs: i * 1000, endMs: i * 1000 + 900, text: `line ${i}`, words: null }),
  ),
});

const wordSource = (count: number): SourceText => ({
  mode: 'words',
  words: Array.from({ length: count }, (_, i): Word => ({ text: `w${i}`, startMs: i * 300 })),
});

type Body = { cues?: Array<{ id: string; en: string }>; first_index?: number; last_index?: number };
const bodyOf = (request: CompletionRequest) => JSON.parse(request.user) as Body;

/** Answers like a model: one translation per cue, or 5-word segments in word mode. */
function answer(request: CompletionRequest, drop: string[] = []): string {
  const body = bodyOf(request);
  if (body.cues) {
    return JSON.stringify({
      cues: body.cues.filter((c) => !drop.includes(c.id)).map((c) => ({ id: c.id, vi: `vi:${c.en}` })),
      uncertainties: [],
    });
  }
  const segments = [];
  for (let start = body.first_index ?? 0; start <= (body.last_index ?? 0); start += 5) {
    segments.push({ start, vi: `câu ${start}` });
  }
  return JSON.stringify({ segments, uncertainties: [] });
}

function memoryCache(initial: Record<string, ChunkPayload> = {}) {
  const store = new Map(Object.entries(initial));
  const cache: TranslationCache = {
    getChunk: async (key, index) => store.get(`${key}#${index}`),
    putChunk: async (key, index, payload) => {
      store.set(`${key}#${index}`, payload);
    },
  };
  return { cache, store };
}

function run(options: {
  source: SourceText;
  complete: (r: CompletionRequest) => Promise<string>;
  cache?: TranslationCache;
  concurrency?: number;
  review?: boolean;
}) {
  const payloads = new Map<number, ChunkPayload>();
  const log = { fatal: [] as ProviderError[], waiting: [] as number[], done: [] as number[] };
  const events: SessionEvents = {
    onChunk: (index, payload) => payloads.set(index, payload),
    onProgress: () => undefined,
    onWaiting: (ms) => log.waiting.push(ms),
    onFatal: (error) => log.fatal.push(error),
    onDone: (failed) => log.done.push(failed),
  };
  const client: LlmClient = { complete: options.complete, listModels: async () => [] };
  const kind = options.source.mode === 'words' ? 'asr' : 'standard';
  const session = new TranslationSession({
    worker: createWorker({ meta: meta(kind), client, reviewPass: options.review ?? false }, options.source),
    cache: options.cache ?? memoryCache().cache,
    cacheKey: 'key',
    concurrency: options.concurrency ?? 1,
    events,
  });
  return { session, payloads, log };
}

const cueTranslations = (payloads: Map<number, ChunkPayload>) =>
  new Map([...payloads.values()].flatMap((p) => (p.mode === 'cues' ? Object.entries(p.translations) : [])));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('TranslationSession scheduling', () => {
  it('translates the chunk at the playhead first, then later chunks, then earlier ones', async () => {
    const order: Array<string | undefined> = [];
    const { session, log, payloads } = run({
      source: cueSource(CUE_CHUNK_SIZE * 4),
      complete: async (r) => {
        order.push(bodyOf(r).cues?.[0]?.id);
        return answer(r);
      },
    });
    await session.start(CUE_CHUNK_SIZE * 2 * 1000 + 10);
    await vi.runAllTimersAsync();
    expect(order).toEqual([`c${CUE_CHUNK_SIZE * 2}`, `c${CUE_CHUNK_SIZE * 3}`, `c${CUE_CHUNK_SIZE}`, 'c0']);
    expect(cueTranslations(payloads).size).toBe(CUE_CHUNK_SIZE * 4);
    expect(log.done).toEqual([0]);
  });

  it('reprioritizes when the viewer seeks', async () => {
    const order: Array<string | undefined> = [];
    const { session } = run({
      source: cueSource(CUE_CHUNK_SIZE * 4),
      complete: async (r) => {
        order.push(bodyOf(r).cues?.[0]?.id);
        return answer(r);
      },
    });
    await session.start(0);
    session.setPlayhead(CUE_CHUNK_SIZE * 3 * 1000);
    await vi.runAllTimersAsync();
    expect(order.slice(0, 2)).toEqual(['c0', `c${CUE_CHUNK_SIZE * 3}`]);
  });

  it('serves cached chunks without calling the model and caches new ones', async () => {
    const cachedPayload: ChunkPayload = { mode: 'cues', translations: { c0: 'cached 0' } };
    const { cache, store } = memoryCache({ 'key#0': cachedPayload });
    const complete = vi.fn(async (r: CompletionRequest) => answer(r));
    const { session, payloads } = run({ source: cueSource(CUE_CHUNK_SIZE + 3), complete, cache });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(payloads.get(0)).toEqual(cachedPayload);
    expect(store.get('key#1')).toEqual(payloads.get(1));
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const { session } = run({
      source: cueSource(CUE_CHUNK_SIZE * 5),
      concurrency: 2,
      complete: async (r) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 100));
        inFlight--;
        return answer(r);
      },
    });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(peak).toBe(2);
  });
});

describe('TranslationSession errors', () => {
  it('retries incomplete output, then keeps the best partial result without caching it', async () => {
    const { cache, store } = memoryCache();
    const complete = vi.fn(async (r: CompletionRequest) => answer(r, ['c1']));
    const { session, payloads, log } = run({ source: cueSource(3), complete, cache });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(complete).toHaveBeenCalledTimes(3);
    const translations = cueTranslations(payloads);
    expect(translations.has('c1')).toBe(false);
    expect(translations.get('c2')).toBe('vi:line 2');
    expect(log.done).toEqual([1]);
    expect(store.size).toBe(0);
  });

  it('waits out rate limits and then continues', async () => {
    let calls = 0;
    const { session, log, payloads } = run({
      source: cueSource(2),
      complete: async (r) => {
        calls++;
        if (calls === 1) throw new ProviderError('rate-limit', '429', 30_000);
        return answer(r);
      },
    });
    await session.start(0);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toBe(2);
    expect(log.waiting).toEqual([30_000]);
    expect(cueTranslations(payloads).size).toBe(2);
  });

  it('stops everything on a fatal error', async () => {
    const complete = vi.fn(async () => {
      throw new ProviderError('invalid-key', '401');
    });
    const { session, log } = run({ source: cueSource(CUE_CHUNK_SIZE * 3), complete });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(log.fatal.map((e) => e.code)).toEqual(['invalid-key']);
    expect(log.done).toEqual([]);
  });

  it('gives up after repeated network failures', async () => {
    const complete = vi.fn(async () => {
      throw new ProviderError('network', 'offline');
    });
    const { session, log } = run({ source: cueSource(1), complete });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(complete).toHaveBeenCalledTimes(6);
    expect(log.fatal.map((e) => e.code)).toEqual(['network']);
  });
});

describe('word mode', () => {
  it('stores the model segmentation for auto-generated captions', async () => {
    const { session, payloads } = run({ source: wordSource(12), complete: async (r) => answer(r) });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(payloads.get(0)).toEqual({
      mode: 'segments',
      segments: [
        { start: 0, vi: 'câu 0' },
        { start: 5, vi: 'câu 5' },
        { start: 10, vi: 'câu 10' },
      ],
    });
  });

  it('falls back to heuristic cues after invalid segmentations', async () => {
    const prompts: string[] = [];
    const { session, payloads, log } = run({
      source: wordSource(12),
      complete: async (r) => {
        const body = bodyOf(r);
        prompts.push(body.cues ? 'cues' : 'segments');
        // Segment mode: starts at the wrong index, which must be rejected.
        if (!body.cues) return JSON.stringify({ segments: [{ start: 3, vi: 'sai' }], uncertainties: [] });
        return answer(r);
      },
    });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(prompts).toEqual(['segments', 'segments', 'cues']);
    const payload = payloads.get(0);
    expect(payload?.mode).toBe('cues');
    expect(log.done).toEqual([0]);
  });

  it('reviews segment translations when the review pass is on', async () => {
    const systems: string[] = [];
    const { session, payloads } = run({
      source: wordSource(6),
      review: true,
      complete: async (r) => {
        systems.push(r.system);
        const body = bodyOf(r);
        if (!body.cues) return answer(r);
        return JSON.stringify({ cues: body.cues.map((c) => ({ id: c.id, vi: `sửa ${c.id}` })), uncertainties: [] });
      },
    });
    await session.start(0);
    await vi.runAllTimersAsync();
    expect(systems).toHaveLength(2);
    expect(systems[1]).toContain('BIÊN TẬP ĐỐI CHIẾU');
    expect(payloads.get(0)).toEqual({
      mode: 'segments',
      segments: [
        { start: 0, vi: 'sửa s0-0' },
        { start: 5, vi: 'sửa s0-1' },
      ],
    });
  });
});
