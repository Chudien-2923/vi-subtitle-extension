import { browser } from 'wxt/browser';
import { isRecord } from '../guards';
import { MAX_AUDIO_BYTES, type VoiceAudio } from './types';

const HOST = 'com.chudin.vi_subtitle';
const MAX_FRAME_CHARS = 256 * 1024;
type NativePort = ReturnType<typeof browser.runtime.connectNative>;
interface Pending {
  chunks: string[];
  encodedLength: number;
  finish: (value: unknown, error?: Error) => void;
  progress?: (message: string) => void;
}
let port: NativePort | null = null;
let clients = 0;
let nextId = 1;
const pending = new Map<number, Pending>();

/** Voice owns a different native connection/process from the translation provider. */
export function retainVoiceHost(): () => void {
  clients++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    clients--;
    if (clients === 0) {
      const old = port;
      port = null;
      for (const entry of [...pending.values()]) entry.finish(undefined, new Error('Đã đóng phiên giọng đọc.'));
      old?.disconnect();
    }
  };
}

function connect(): NativePort {
  if (port) return port;
  const opened = browser.runtime.connectNative(HOST);
  port = opened;
  opened.onDisconnect.addListener(() => {
    if (port !== opened) return;
    port = null;
    const detail = browser.runtime.lastError?.message ?? 'Native host has exited';
    for (const entry of [...pending.values()]) {
      entry.finish(
        undefined,
        new Error(`Chưa kết nối được trợ lý giọng đọc. Mở Cài đặt → Giọng đọc để cài/nâng trợ lý. (${detail})`),
      );
    }
  });
  opened.onMessage.addListener((message: unknown) => {
    if (!isRecord(message) || typeof message.id !== 'number') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.event === 'progress') {
      if (typeof message.message === 'string') entry.progress?.(message.message.slice(0, 1000));
      return;
    }
    if (message.event === 'audio') {
      const data = message.data;
      if (
        message.seq !== entry.chunks.length ||
        typeof data !== 'string' ||
        data.length > MAX_FRAME_CHARS ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
        entry.encodedLength + data.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4
      ) {
        entry.finish(undefined, new Error('Dữ liệu audio không hợp lệ hoặc vượt giới hạn.'));
        cancelRequest(message.id);
        return;
      }
      entry.chunks.push(data);
      entry.encodedLength += data.length;
      return;
    }
    if (typeof message.status !== 'number' || message.status < 200 || message.status >= 300) {
      const error = isRecord(message.body) && isRecord(message.body.error) ? message.body.error : null;
      const detail = typeof error?.message === 'string' ? error.message : 'Trợ lý không trả lời đúng giao thức.';
      entry.finish(undefined, new Error(`Không tạo được giọng đọc: ${detail}`));
      return;
    }
    if (entry.chunks.length > 0) {
      const body = message.body;
      const base64 = entry.chunks.join('');
      const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
      const bytes = (base64.length / 4) * 3 - padding;
      if (
        !isRecord(body) ||
        body.mime !== 'audio/wav' ||
        body.bytes !== bytes ||
        body.chunks !== entry.chunks.length ||
        !Number.isInteger(bytes) ||
        typeof body.durationMs !== 'number' ||
        !Number.isFinite(body.durationMs) ||
        body.durationMs <= 0 ||
        body.durationMs > 120_000 ||
        typeof body.engineVersion !== 'string' ||
        typeof body.voice !== 'string'
      ) {
        entry.finish(undefined, new Error('Metadata audio không khớp nội dung.'));
        return;
      }
      const audio: VoiceAudio = {
        mime: 'audio/wav',
        base64,
        durationMs: body.durationMs,
        engineVersion: body.engineVersion,
        voice: body.voice,
      };
      entry.finish(audio);
    } else entry.finish(message.body);
  });
  return opened;
}

function cancelRequest(requestId: number): void {
  try {
    port?.postMessage({ id: nextId++, path: '/tts/cancel', method: 'POST', body: { requestId } });
  } catch {
    // The native process may already have exited; the caller is settled locally.
  }
}

export function voiceNativeRequest(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  progress?: (message: string) => void,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));
  let target: NativePort;
  try {
    target = connect();
  } catch (error) {
    return Promise.reject(new Error(`Chưa cài trợ lý giọng đọc: ${String(error)}`));
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        cancelRequest(id);
        entry.finish(undefined, new Error('Trợ lý giọng đọc phản hồi quá lâu. Thử lại trong Cài đặt.'));
      },
      path === '/tts/install' ? 20 * 60_000 : path === '/tts/synthesize' ? 180_000 : 20_000,
    );
    const abort = () => {
      cancelRequest(id);
      entry.finish(undefined, new DOMException('aborted', 'AbortError'));
    };
    const entry: Pending = {
      chunks: [],
      encodedLength: 0,
      progress,
      finish(value, error) {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      },
    };
    pending.set(id, entry);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      target.postMessage({
        id,
        path,
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      entry.finish(undefined, new Error(String(error)));
    }
  });
}
