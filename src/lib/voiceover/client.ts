import { type Browser, browser } from 'wxt/browser';
import type { CacheVideoContext, VideoCacheList } from '../cache/types';
import { isRecord } from '../guards';
import { VOICE_PORT, type VoiceAudio, type VoiceHelperStatus, type VoiceOperation } from './types';

export type { VoiceAudio, VoiceHelperStatus } from './types';
export { voiceAudioBlob } from './types';

interface Pending {
  settle: (value: unknown, error?: Error) => void;
  progress?: (message: string) => void;
}

export class VoiceClient {
  private port: Browser.runtime.Port | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  status(): Promise<VoiceHelperStatus> {
    return this.request({ op: 'status' }) as Promise<VoiceHelperStatus>;
  }
  install(onProgress?: (message: string) => void): Promise<VoiceHelperStatus> {
    return this.request({ op: 'install' }, undefined, onProgress) as Promise<VoiceHelperStatus>;
  }
  synthesize(text: string, voice: string, signal?: AbortSignal, video?: CacheVideoContext): Promise<VoiceAudio> {
    return this.request({ op: 'synthesize', text, voice, ...(video ? { video } : {}) }, signal) as Promise<VoiceAudio>;
  }
  cacheInfo(): Promise<{ bytes: number; entries: number }> {
    return this.request({ op: 'cache-info' }) as Promise<{ bytes: number; entries: number }>;
  }
  async clearCache(): Promise<void> {
    await this.request({ op: 'cache-clear' });
  }
  listVideoCaches(): Promise<VideoCacheList> {
    return this.request({ op: 'cache-videos' }) as Promise<VideoCacheList>;
  }
  async deleteVideoCache(videoId: string): Promise<void> {
    await this.request({ op: 'cache-delete-video', videoId });
  }
  async clearUnassignedCache(): Promise<void> {
    await this.request({ op: 'cache-clear-unassigned' });
  }

  close(): void {
    const old = this.port;
    this.port = null;
    this.failPending(new Error('Đã đóng phiên giọng đọc.'));
    old?.disconnect();
  }

  private failPending(error: Error): void {
    for (const entry of [...this.pending.values()]) entry.settle(undefined, error);
  }
  private connection(): Browser.runtime.Port {
    if (this.port) return this.port;
    const opened = browser.runtime.connect({ name: VOICE_PORT });
    this.port = opened;
    opened.onMessage.addListener((value: unknown) => {
      if (!isRecord(value) || typeof value.id !== 'number') return;
      const entry = this.pending.get(value.id);
      if (!entry) return;
      if (value.event === 'progress' && typeof value.message === 'string') {
        entry.progress?.(value.message);
      } else if (value.ok === true) entry.settle(value.value);
      else if (value.ok === false && typeof value.error === 'string') entry.settle(undefined, new Error(value.error));
    });
    opened.onDisconnect.addListener(() => {
      if (this.port !== opened) return;
      this.port = null;
      this.failPending(new Error('Mất kết nối giọng đọc. Bấm nút Đọc trên video để thử lại.'));
    });
    return opened;
  }
  private request(
    operation: VoiceOperation,
    signal?: AbortSignal,
    progress?: (message: string) => void,
  ): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
    const target = this.connection();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => {
        try {
          target.postMessage({ id: this.nextId++, op: 'cancel', requestId: id });
        } catch {
          /* Already disconnected. */
        }
        entry.settle(undefined, new DOMException('aborted', 'AbortError'));
      };
      const entry: Pending = {
        progress,
        settle: (value, error) => {
          if (!this.pending.delete(id)) return;
          signal?.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve(value);
        },
      };
      this.pending.set(id, entry);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        target.postMessage({ ...operation, id });
      } catch (error) {
        entry.settle(undefined, new Error(String(error)));
      }
    });
  }
}

const unlocked = new WeakSet<HTMLAudioElement>();
/** Call synchronously from a player/options click, before fetching audio. */
export async function unlockVoiceAudio(audio: HTMLAudioElement): Promise<void> {
  if (unlocked.has(audio)) return;
  const wav = new Uint8Array(44 + 960);
  const view = new DataView(wav.buffer);
  const word = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i);
  };
  word(0, 'RIFF');
  view.setUint32(4, wav.length - 8, true);
  word(8, 'WAVE');
  word(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, 'data');
  view.setUint32(40, 960, true);
  const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  audio.src = url;
  try {
    await audio.play();
    unlocked.add(audio);
  } finally {
    if (audio.src === url) {
      audio.pause();
      audio.removeAttribute('src');
    }
    URL.revokeObjectURL(url);
  }
}
