import type { VoiceVideoCache } from '../cache/types';
import type { VoiceAudio } from './types';

const DATABASE = 'chudin-voiceover';
// v1: audio + metadata{id,bytes,usedAt}. v2: metadata adds `owners` + `unassigned`; bytes become serialized base64 size.
const VERSION = 2;
// Keep the previous 128 MiB decoded-audio budget while reporting actual base64 payload sizes.
const LIMIT_BYTES = Math.ceil((128 * 1024 * 1024) / 3) * 4;
interface Metadata {
  id: string;
  /** Serialized payload size: the base64 string length, which is what IndexedDB stores. */
  bytes: number;
  usedAt: number;
  /** Exact video ids that use this physical audio. */
  owners: string[];
  /**
   * Audio that some unknown video/preview may still use: v1 records and previews without a video.
   * It survives when the last known owner is deleted, because we cannot prove nobody else needs it.
   */
  unassigned: boolean;
}
let opening: Promise<IDBDatabase> | undefined;

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Audio cache transaction aborted'));
    transaction.onerror = () => reject(transaction.error);
  });
}

function upgrade(open: IDBOpenDBRequest, oldVersion: number): void {
  const db = open.result;
  if (oldVersion < 1) {
    db.createObjectStore('audio');
    db.createObjectStore('metadata', { keyPath: 'id' });
    return;
  }
  const transaction = open.transaction;
  if (!transaction) throw new Error('Audio cache upgrade has no transaction');
  // v1 -> v2: every existing audio is kept as legacy-unassigned; only the metadata is annotated in place.
  const audio = transaction.objectStore('audio');
  const cursorRequest = transaction.objectStore('metadata').openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const record = cursor.value as Metadata;
    if (Array.isArray(record.owners)) {
      cursor.continue();
      return;
    }
    const audioRequest = audio.get(record.id) as IDBRequest<VoiceAudio | undefined>;
    audioRequest.onsuccess = () => {
      cursor.update({
        ...record,
        bytes: audioRequest.result?.base64.length ?? record.bytes,
        owners: [],
        unassigned: true,
      } satisfies Metadata);
      cursor.continue();
    };
  };
}

function database(): Promise<IDBDatabase> {
  if (!opening) {
    const open = indexedDB.open(DATABASE, VERSION);
    open.onupgradeneeded = (event) => upgrade(open, event.oldVersion);
    opening = request(open)
      .then((db) => {
        // Let a newer schema (or a database reset) proceed instead of blocking behind this connection.
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        return db;
      })
      .catch((error: unknown) => {
        opening = undefined;
        throw error;
      });
  }
  return opening;
}

/**
 * Runs `run` inside one transaction over audio + metadata. `signal` is checked after the database is open and the
 * transaction exists (and again by `run` before each write), so an already-aborted request can neither write nor
 * attach an owner. Any failure aborts the transaction, discarding writes already queued.
 */
async function transact<T>(
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const db = await database();
  const transaction = db.transaction(['audio', 'metadata'], mode);
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

function withOwner(owners: string[], videoId: string | undefined): string[] {
  return videoId && !owners.includes(videoId) ? [...owners, videoId] : owners;
}

export async function voiceCacheKey(version: string, voice: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([version, voice, text]));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A hit links `videoId` as an owner (the physical audio is shared, never duplicated). */
export async function getVoiceCache(
  id: string,
  videoId?: string,
  signal?: AbortSignal,
): Promise<VoiceAudio | undefined> {
  return transact(
    'readwrite',
    async (tx) => {
      const metadata = tx.objectStore('metadata');
      const meta = (await request(metadata.get(id))) as Metadata | undefined;
      const audio = (await request(tx.objectStore('audio').get(id))) as VoiceAudio | undefined;
      if (meta) {
        signal?.throwIfAborted();
        metadata.put({
          ...meta,
          usedAt: Date.now(),
          // Legacy `unassigned` stays: attaching one known video does not prove no other video used this audio.
          owners: audio ? withOwner(meta.owners, videoId || undefined) : meta.owners,
        } satisfies Metadata);
      }
      return audio;
    },
    signal,
  );
}

export async function putVoiceCache(
  id: string,
  audio: VoiceAudio,
  videoId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const bytes = audio.base64.length;
  if (bytes > LIMIT_BYTES) return;
  await transact(
    'readwrite',
    async (tx) => {
      const meta = tx.objectStore('metadata');
      const all = (await request(meta.getAll())) as Metadata[];
      signal?.throwIfAborted();
      const existing = all.find((r) => r.id === id);
      const records = all.filter((r) => r.id !== id).sort((a, b) => a.usedAt - b.usedAt);
      let total = records.reduce((sum, record) => sum + record.bytes, bytes);
      for (const record of records) {
        if (total <= LIMIT_BYTES) break;
        meta.delete(record.id);
        tx.objectStore('audio').delete(record.id);
        total -= record.bytes;
      }
      tx.objectStore('audio').put(audio, id);
      meta.put({
        id,
        bytes,
        usedAt: Date.now(),
        owners: withOwner(existing?.owners ?? [], videoId || undefined),
        unassigned: existing ? existing.unassigned || !videoId : !videoId,
      } satisfies Metadata);
    },
    signal,
  );
}

/** Global totals: each physical audio is counted once, whoever owns it. */
export async function voiceCacheInfo(): Promise<{ bytes: number; entries: number }> {
  const db = await database();
  const tx = db.transaction('metadata', 'readonly');
  const records = await request(tx.objectStore('metadata').getAll() as IDBRequest<Metadata[]>);
  return { bytes: records.reduce((sum, record) => sum + record.bytes, 0), entries: records.length };
}

/**
 * Per-video voice usage (metadata only, audio is never loaded). `voiceBytes` counts shared audio for every owner;
 * `reclaimableVoiceBytes` is what deleting only that video would free: exclusively owned, not legacy-unassigned.
 * `unassigned` is the audio with no owner, i.e. exactly what clearUnassignedVoiceCache() removes.
 */
export async function listVoiceVideoCaches(): Promise<{
  videos: VoiceVideoCache[];
  unassigned: { entries: number; bytes: number };
}> {
  const db = await database();
  const tx = db.transaction('metadata', 'readonly');
  const records = await request(tx.objectStore('metadata').getAll() as IDBRequest<Metadata[]>);
  const videos = new Map<string, VoiceVideoCache>();
  const unassigned = { entries: 0, bytes: 0 };
  for (const record of records) {
    if (record.owners.length === 0) {
      unassigned.entries += 1;
      unassigned.bytes += record.bytes;
      continue;
    }
    const exclusive = record.owners.length === 1 && !record.unassigned;
    for (const videoId of record.owners) {
      let video = videos.get(videoId);
      if (!video) {
        video = { videoId, voiceEntries: 0, voiceBytes: 0, reclaimableVoiceBytes: 0, lastUsedAt: 0 };
        videos.set(videoId, video);
      }
      video.voiceEntries += 1;
      video.voiceBytes += record.bytes;
      if (exclusive) video.reclaimableVoiceBytes += record.bytes;
      video.lastUsedAt = Math.max(video.lastUsedAt, record.usedAt);
    }
  }
  return { videos: [...videos.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt), unassigned };
}

/** Removes exactly this video as an owner; audio is deleted only when nobody else (and no legacy flag) needs it. */
export async function deleteVoiceVideoCache(videoId: string): Promise<void> {
  if (!videoId) return;
  await transact('readwrite', async (tx) => {
    const metadata = tx.objectStore('metadata');
    const records = (await request(metadata.getAll())) as Metadata[];
    for (const record of records) {
      if (!record.owners.includes(videoId)) continue;
      const owners = record.owners.filter((owner) => owner !== videoId);
      if (owners.length === 0 && !record.unassigned) {
        metadata.delete(record.id);
        tx.objectStore('audio').delete(record.id);
      } else {
        metadata.put({ ...record, owners } satisfies Metadata);
      }
    }
  });
}

/** Deletes only audio no video references. Audio with any owner is never touched. */
export async function clearUnassignedVoiceCache(): Promise<void> {
  await transact('readwrite', async (tx) => {
    const metadata = tx.objectStore('metadata');
    const records = (await request(metadata.getAll())) as Metadata[];
    for (const record of records) {
      if (record.owners.length > 0) continue;
      metadata.delete(record.id);
      tx.objectStore('audio').delete(record.id);
    }
  });
}

export async function clearVoiceCache(): Promise<void> {
  const db = await database();
  const tx = db.transaction(['audio', 'metadata'], 'readwrite');
  const done = committed(tx);
  tx.objectStore('audio').clear();
  tx.objectStore('metadata').clear();
  await done;
}
