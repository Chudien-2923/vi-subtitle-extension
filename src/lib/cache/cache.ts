import { SEGMENTER_VERSION, type VideoMeta } from '../captions/types';
import type { ProviderId } from '../settings/settings';
import type { ChunkPayload } from '../translate/display';
import { STYLE_VERSION } from '../translate/prompt';

export interface TranslationCache {
  getChunk(sessionKey: string, index: number): Promise<ChunkPayload | undefined>;
  putChunk(sessionKey: string, index: number, payload: ChunkPayload): Promise<void>;
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
const STORE = 'chunks';

interface ChunkRecord {
  id: string;
  sessionKey: string;
  index: number;
  payload: ChunkPayload;
  savedAt: number;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    dbPromise = promisify(request).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return promisify(run(db.transaction(STORE, mode).objectStore(STORE)));
}

export const indexedDbCache: TranslationCache = {
  async getChunk(sessionKey, index) {
    // Records in this store are only ever written by putChunk below.
    const record = (await withStore('readonly', (s) => s.get(`${sessionKey}#${index}`))) as ChunkRecord | undefined;
    return record?.payload;
  },
  async putChunk(sessionKey, index, payload) {
    const record: ChunkRecord = { id: `${sessionKey}#${index}`, sessionKey, index, payload, savedAt: Date.now() };
    await withStore('readwrite', (s) => s.put(record));
  },
};

export async function countCachedChunks(): Promise<number> {
  return withStore('readonly', (s) => s.count());
}

export async function clearCache(): Promise<void> {
  await withStore('readwrite', (s) => s.clear());
}
