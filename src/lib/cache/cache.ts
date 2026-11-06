import { SEGMENTER_VERSION, type VideoMeta } from '../captions/types';
import type { ProviderId } from '../settings/settings';
import type { ChunkPayload } from '../translate/display';
import { STYLE_VERSION } from '../translate/prompt';
import type { TranslationVideoCache } from './types';

export interface TranslationCache {
  getChunk(sessionKey: string, index: number): Promise<ChunkPayload | undefined>;
  /** `signal` is checked inside the write transaction: an aborted caller can never write (or resurrect) a chunk. */
  putChunk(sessionKey: string, index: number, payload: ChunkPayload, signal?: AbortSignal): Promise<void>;
}

/** Everything that changes the translated output of a chunk is part of the key. */
export function sessionCacheKey(
  transcript: Pick<VideoMeta, 'videoId' | 'track'>,
  provider: ProviderId,
  model: string,
  reviewPass: boolean,
): string {
  return [
    transcript.videoId,
    transcript.track.vssId,
    `seg${SEGMENTER_VERSION}`,
    `style${STYLE_VERSION}`,
    provider,
    model,
    reviewPass ? 'review' : 'single',
  ].join('|');
}

const DB_NAME = 'chudin-vi-subtitle';
// v1: `chunks` only. v2: chunk records carry `videoId` + `bytes`, `videoId` index, `videos` catalog store.
const DB_VERSION = 2;
const STORE = 'chunks';
const VIDEOS = 'videos';
const VIDEO_INDEX = 'videoId';

interface ChunkRecord {
  id: string;
  sessionKey: string;
  /** Exact `sessionKey.split('|')[0]`; indexed so a video is deleted by equality, never by prefix. */
  videoId: string;
  index: number;
  payload: ChunkPayload;
  /** UTF-8 size of the JSON payload. */
  bytes: number;
  savedAt: number;
}

interface VideoRecord {
  videoId: string;
  title: string;
  lastUsedAt: number;
}

const encoder = new TextEncoder();

/** The video id is the first segment of every session key (see sessionCacheKey). */
function sessionVideoId(sessionKey: string): string {
  return sessionKey.split('|')[0] ?? '';
}

function payloadBytes(payload: ChunkPayload): number {
  return encoder.encode(JSON.stringify(payload)).byteLength;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

function committed(transaction: IDBTransaction): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('Translation cache transaction aborted'));
  transaction.onerror = () => reject(transaction.error);
  return promise;
}

function upgrade(request: IDBOpenDBRequest, oldVersion: number): void {
  const db = request.result;
  const transaction = request.transaction;
  if (!transaction) throw new Error('Translation cache upgrade has no transaction');
  const chunks = oldVersion < 1 ? db.createObjectStore(STORE, { keyPath: 'id' }) : transaction.objectStore(STORE);
  if (!chunks.indexNames.contains(VIDEO_INDEX)) chunks.createIndex(VIDEO_INDEX, VIDEO_INDEX);
  if (!db.objectStoreNames.contains(VIDEOS)) db.createObjectStore(VIDEOS, { keyPath: 'videoId' });
  if (oldVersion < 1) return;
  // v1 -> v2: annotate every existing chunk in place. Nothing is deleted or re-keyed.
  const cursorRequest = chunks.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const record = cursor.value as Pick<ChunkRecord, 'sessionKey' | 'payload'> & Partial<ChunkRecord>;
    if (record.videoId === undefined || record.bytes === undefined) {
      cursor.update({
        ...record,
        videoId: sessionVideoId(record.sessionKey),
        bytes: payloadBytes(record.payload),
      });
    }
    cursor.continue();
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => upgrade(request, event.oldVersion);
    dbPromise = promisify(request)
      .then((db) => {
        // Let a newer schema (or a database reset) proceed instead of blocking behind this connection.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        return db;
      })
      .catch((error: unknown) => {
        dbPromise = null;
        throw error;
      });
  }
  return dbPromise;
}

/**
 * Runs `run` inside one transaction. `signal` is checked after the database is open and the transaction exists,
 * so a request that was aborted while waiting for IndexedDB never touches the stores. Any failure aborts the
 * transaction, discarding writes already queued by `run`.
 */
async function transact<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const db = await openDb();
  const transaction = db.transaction(stores, mode);
  const done = committed(transaction);
  try {
    signal?.throwIfAborted();
    const value = await run(transaction);
    await done;
    return value;
  } catch (error) {
    done.catch(() => undefined);
    try {
      transaction.abort();
    } catch {
      // Already finished.
    }
    throw error;
  }
}

export const indexedDbCache: TranslationCache = {
  async getChunk(sessionKey, index) {
    // Records in this store are only ever written by putChunk below.
    const record = await transact(
      STORE,
      'readonly',
      async (tx) => (await promisify(tx.objectStore(STORE).get(`${sessionKey}#${index}`))) as ChunkRecord | undefined,
    );
    return record?.payload;
  },
  async putChunk(sessionKey, index, payload, signal) {
    const record: ChunkRecord = {
      id: `${sessionKey}#${index}`,
      sessionKey,
      videoId: sessionVideoId(sessionKey),
      index,
      payload,
      bytes: payloadBytes(payload),
      savedAt: Date.now(),
    };
    await transact(
      STORE,
      'readwrite',
      async (tx) => {
        signal?.throwIfAborted();
        await promisify(tx.objectStore(STORE).put(record));
      },
      signal,
    );
  },
};

/** Remembers the human title (and last use) of a video so cache lists need not show raw ids. */
export async function recordCacheVideo(video: { videoId: string; title: string }, signal?: AbortSignal): Promise<void> {
  if (!video.videoId) return;
  await transact(
    VIDEOS,
    'readwrite',
    async (tx) => {
      const store = tx.objectStore(VIDEOS);
      const existing = (await promisify(store.get(video.videoId))) as VideoRecord | undefined;
      signal?.throwIfAborted();
      const title = video.title.trim() || existing?.title || '';
      await promisify(store.put({ videoId: video.videoId, title, lastUsedAt: Date.now() } satisfies VideoRecord));
    },
    signal,
  );
}

/**
 * Every video known to the translation cache: videos with stored chunks plus catalog-only videos
 * (0 chunks, e.g. voice-only videos or after clearCache), newest first. Title falls back to the id.
 */
export async function listTranslationVideoCaches(): Promise<TranslationVideoCache[]> {
  return transact([STORE, VIDEOS], 'readonly', async (tx) => {
    const [chunks, videos] = await Promise.all([
      promisify(tx.objectStore(STORE).getAll()) as Promise<ChunkRecord[]>,
      promisify(tx.objectStore(VIDEOS).getAll()) as Promise<VideoRecord[]>,
    ]);
    const result = new Map<string, TranslationVideoCache>();
    const entry = (videoId: string): TranslationVideoCache => {
      let value = result.get(videoId);
      if (!value) {
        value = { videoId, title: videoId, lastUsedAt: 0, translationChunks: 0, translationBytes: 0 };
        result.set(videoId, value);
      }
      return value;
    };
    for (const record of chunks) {
      const value = entry(record.videoId ?? sessionVideoId(record.sessionKey));
      value.translationChunks += 1;
      value.translationBytes += record.bytes ?? payloadBytes(record.payload);
      value.lastUsedAt = Math.max(value.lastUsedAt, record.savedAt);
    }
    for (const video of videos) {
      const value = entry(video.videoId);
      if (video.title.trim()) value.title = video.title;
      value.lastUsedAt = Math.max(value.lastUsedAt, video.lastUsedAt);
    }
    return [...result.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  });
}

/** Deletes translations of exactly this video id across every track/provider/model variant. */
export async function deleteTranslationVideoCache(videoId: string): Promise<void> {
  if (!videoId) return;
  await transact([STORE, VIDEOS], 'readwrite', async (tx) => {
    const chunks = tx.objectStore(STORE);
    const keys = await promisify(chunks.index(VIDEO_INDEX).getAllKeys(IDBKeyRange.only(videoId)));
    for (const key of keys) chunks.delete(key);
    tx.objectStore(VIDEOS).delete(videoId);
  });
}

export async function countCachedChunks(): Promise<number> {
  return transact(STORE, 'readonly', (tx) => promisify(tx.objectStore(STORE).count()));
}

/** Count and serialized (UTF-8 JSON) size of stored translation chunks. */
export async function translationCacheInfo(): Promise<{ chunks: number; bytes: number }> {
  return transact(STORE, 'readonly', async (tx) => {
    const records = (await promisify(tx.objectStore(STORE).getAll())) as ChunkRecord[];
    return {
      chunks: records.length,
      bytes: records.reduce((sum, record) => sum + (record.bytes ?? payloadBytes(record.payload)), 0),
    };
  });
}

/** Clears stored translations only. The video title catalog is kept so voice-only entries stay readable. */
export async function clearCache(): Promise<void> {
  await transact(STORE, 'readwrite', async (tx) => {
    await promisify(tx.objectStore(STORE).clear());
  });
}
