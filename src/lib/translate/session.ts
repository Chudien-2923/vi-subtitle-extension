import type { TranslationCache } from '../cache/cache';
import { IS_FATAL, type ProviderError, toProviderError } from '../providers/errors';
import { type ChunkPlan, chunkAtTime, priorityOrder } from './chunks';
import type { ChunkPayload } from './display';
import type { ChunkOutcome, ChunkWorker } from './workers';

/** Attempts for rate limits / server / network failures before giving up on the session. */
const MAX_TRANSIENT_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

export interface SessionEvents {
  onChunk(index: number, payload: ChunkPayload): void;
  onProgress(doneChunks: number, totalChunks: number): void;
  /** Translation is paused (rate limit / transient error) and resumes after `retryInMs`. */
  onWaiting(retryInMs: number): void;
  onFatal(error: ProviderError): void;
  /** All chunks settled. `failedUnits` (cues or words) stayed untranslated and show in English. */
  onDone(failedUnits: number): void;
}

export interface SessionOptions {
  worker: ChunkWorker;
  cache: TranslationCache;
  cacheKey: string;
  concurrency: number;
  events: SessionEvents;
}

interface ChunkTask {
  plan: ChunkPlan;
  state: 'pending' | 'running' | 'done';
  notBefore: number;
  attempts: number;
  transientAttempts: number;
  /** Best incomplete result so far, used if every attempt stays incomplete. */
  partial: ChunkOutcome | null;
}

/**
 * Translates chunk by chunk, nearest-to-playhead first, with a concurrency
 * cap, retries, backoff and a per-chunk cache.
 */
export class TranslationSession {
  private readonly options: SessionOptions;
  private readonly tasks: ChunkTask[];
  private readonly controller = new AbortController();
  private currentChunk = 0;
  private running = 0;
  private pausedUntil = 0;
  private failedUnits = 0;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  constructor(options: SessionOptions) {
    this.options = options;
    this.tasks = options.worker.plans.map((plan) => ({
      plan,
      state: 'pending',
      notBefore: 0,
      attempts: 0,
      transientAttempts: 0,
      partial: null,
    }));
  }

  get stopped(): boolean {
    return this.controller.signal.aborted;
  }

  async start(playheadMs: number): Promise<void> {
    this.currentChunk = chunkAtTime(this.options.worker.plans, playheadMs);
    const { cache, cacheKey, events } = this.options;
    for (const task of this.tasks) {
      const cached = await cache.getChunk(cacheKey, task.plan.index).catch(() => undefined);
      if (this.stopped) return;
      if (cached) {
        task.state = 'done';
        events.onChunk(task.plan.index, cached);
      }
    }
    this.reportProgress();
    this.pump();
  }

  setPlayhead(playheadMs: number): void {
    this.currentChunk = chunkAtTime(this.options.worker.plans, playheadMs);
    this.pump();
  }

  abort(): void {
    clearTimeout(this.wakeTimer);
    this.controller.abort();
  }

  private pump(): void {
    if (this.stopped || this.finished) return;
    clearTimeout(this.wakeTimer);
    const now = Date.now();
    let nextWake = Number.POSITIVE_INFINITY;
    for (const index of priorityOrder(this.tasks.length, this.currentChunk)) {
      if (this.running >= this.options.concurrency) break;
      const task = this.tasks[index] as ChunkTask;
      if (task.state !== 'pending') continue;
      const readyAt = Math.max(task.notBefore, this.pausedUntil);
      if (readyAt > now) {
        nextWake = Math.min(nextWake, readyAt);
        continue;
      }
      void this.run(task);
    }
    if (this.tasks.every((t) => t.state === 'done')) {
      this.finished = true;
      this.options.events.onDone(this.failedUnits);
    } else if (nextWake !== Number.POSITIVE_INFINITY && this.running < this.options.concurrency) {
      this.wakeTimer = setTimeout(() => this.pump(), nextWake - now);
    }
  }

  private async run(task: ChunkTask): Promise<void> {
    task.state = 'running';
    this.running++;
    const { worker } = this.options;
    try {
      const outcome = await worker.translate(task.plan, task.attempts, this.controller.signal);
      if (this.stopped) return;
      task.attempts++;
      if (outcome.complete || task.attempts >= worker.maxAttempts) {
        this.complete(task, outcome);
      } else {
        if (!task.partial || outcome.failedUnits < task.partial.failedUnits) task.partial = outcome;
        task.state = 'pending';
      }
    } catch (thrown) {
      if (this.stopped) return;
      this.handleError(task, toProviderError(thrown));
    } finally {
      this.running--;
      this.pump();
    }
  }

  private complete(task: ChunkTask, outcome: ChunkOutcome | null): void {
    task.state = 'done';
    const best = outcome && task.partial && task.partial.failedUnits < outcome.failedUnits ? task.partial : outcome;
    if (best) {
      this.failedUnits += best.failedUnits;
      this.options.events.onChunk(task.plan.index, best.payload);
      if (best.complete) {
        const { cache, cacheKey } = this.options;
        void cache.putChunk(cacheKey, task.plan.index, best.payload).catch(() => undefined);
      }
    } else {
      this.failedUnits += this.options.worker.unitCount(task.plan);
    }
    this.reportProgress();
  }

  private handleError(task: ChunkTask, error: ProviderError): void {
    if (IS_FATAL[error.code]) {
      this.abort();
      this.options.events.onFatal(error);
      return;
    }
    if (error.code === 'bad-output') {
      task.attempts++;
      if (task.attempts >= this.options.worker.maxAttempts) this.complete(task, task.partial);
      else task.state = 'pending';
      return;
    }
    task.transientAttempts++;
    if (task.transientAttempts >= MAX_TRANSIENT_ATTEMPTS) {
      this.abort();
      this.options.events.onFatal(error);
      return;
    }
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (task.transientAttempts - 1));
    const delay = error.retryAfterMs ?? backoff;
    task.notBefore = Date.now() + delay;
    task.state = 'pending';
    if (error.code === 'rate-limit') this.pausedUntil = Math.max(this.pausedUntil, task.notBefore);
    this.options.events.onWaiting(delay);
  }

  private reportProgress(): void {
    const done = this.tasks.filter((t) => t.state === 'done').length;
    this.options.events.onProgress(done, this.tasks.length);
  }
}
