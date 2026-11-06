import { type Browser, browser } from 'wxt/browser';
import { beginVideoCacheActivity } from '../cache/activity';
import { recordCacheVideo } from '../cache/cache';
import { clearUnassignedCache, deleteVideoCache, listVideoCaches } from '../cache/manager';
import type { CacheVideoContext } from '../cache/types';
import { isRecord } from '../guards';
import { clearVoiceCache, getVoiceCache, putVoiceCache, voiceCacheInfo, voiceCacheKey } from './cache';
import { retainVoiceHost, voiceNativeRequest } from './native';
import { MAX_AUDIO_BYTES, MAX_VOICE_TEXT, type VoiceAudio, type VoiceHelperStatus, type VoiceReply } from './types';

function helperStatus(value: unknown): VoiceHelperStatus {
  if (
    !isRecord(value) ||
    typeof value.ready !== 'boolean' ||
    typeof value.version !== 'string' ||
    !Array.isArray(value.voices)
  ) {
    throw new Error('Trợ lý chưa hỗ trợ giọng đọc. Hãy nâng trợ lý bằng lệnh trong Cài đặt.');
  }
  const voices = value.voices
    .filter(
      (v): v is { id: string; label: string } =>
        isRecord(v) &&
        typeof v.id === 'string' &&
        v.id.length <= 100 &&
        typeof v.label === 'string' &&
        v.label.length <= 200,
    )
    .slice(0, 100);
  return {
    ready: value.ready,
    version: value.version.slice(0, 200),
    voices,
    ...(typeof value.message === 'string' ? { message: value.message.slice(0, 2000) } : {}),
  };
}

function trustedSource(port: Browser.runtime.Port): { extensionPage: boolean; videoId?: string } | null {
  if (port.sender?.id !== browser.runtime.id || !port.sender.url) return null;
  const extensionPage = port.sender.url.startsWith(browser.runtime.getURL(''));
  if (extensionPage) return { extensionPage };
  try {
    const url = new URL(port.sender.url);
    return url.hostname === 'www.youtube.com' && (url.protocol === 'https:' || url.protocol === 'http:')
      ? { extensionPage, videoId: url.searchParams.get('v') ?? undefined }
      : null;
  } catch {
    return null;
  }
}

/** Long-lived independently cancellable channel; translating can finish before narration. */
export function handleVoicePort(port: Browser.runtime.Port): void {
  const source = trustedSource(port);
  if (!source) {
    port.disconnect();
    return;
  }
  const release = retainVoiceHost();
  const requests = new Map<number, AbortController>();
  const deletedVideos = new Set<string>();
  let disconnected = false;
  const post = (reply: VoiceReply) => {
    if (!disconnected) port.postMessage(reply);
  };
  port.onDisconnect.addListener(() => {
    disconnected = true;
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    release();
  });
  port.onMessage.addListener((message: unknown) => {
    if (
      !isRecord(message) ||
      !Number.isSafeInteger(message.id) ||
      typeof message.id !== 'number' ||
      typeof message.op !== 'string'
    )
      return;
    const id = message.id;
    if (message.op === 'cancel') {
      if (typeof message.requestId === 'number') requests.get(message.requestId)?.abort();
      return;
    }
    if (requests.has(id) || requests.size >= 4) {
      post({ id, ok: false, error: 'Có quá nhiều yêu cầu giọng đọc cùng lúc.' });
      return;
    }
    const controller = new AbortController();
    requests.set(id, controller);
    const signal = controller.signal;
    const run = async (): Promise<unknown> => {
      switch (message.op) {
        case 'status':
          return helperStatus(await voiceNativeRequest('/tts/status', undefined, signal));
        case 'install':
          if (!source.extensionPage) throw new Error('Hãy mở Cài đặt để cài giọng đọc.');
          return helperStatus(
            await voiceNativeRequest('/tts/install', {}, signal, (text) =>
              post({ id, event: 'progress', message: text }),
            ),
          );
        case 'cache-info':
          return voiceCacheInfo();
        case 'cache-clear':
          if (!source.extensionPage) throw new Error('Chỉ xóa cache giọng đọc từ Cài đặt.');
          await clearVoiceCache();
          return null;
        case 'cache-videos':
          if (!source.extensionPage) throw new Error('Chỉ quản lý cache từ Cài đặt.');
          return listVideoCaches();
        case 'cache-delete-video':
          if (!source.extensionPage || typeof message.videoId !== 'string')
            throw new Error('Chỉ xóa video từ Cài đặt.');
          await deleteVideoCache(message.videoId);
          return null;
        case 'cache-clear-unassigned':
          if (!source.extensionPage) throw new Error('Chỉ xóa cache chưa gắn video từ Cài đặt.');
          await clearUnassignedCache();
          return null;
        case 'synthesize': {
          if (
            typeof message.text !== 'string' ||
            !message.text.trim() ||
            message.text.length > MAX_VOICE_TEXT ||
            typeof message.voice !== 'string' ||
            message.voice.length > 100
          ) {
            throw new Error('Nội dung hoặc giọng đọc không hợp lệ.');
          }
          let video: CacheVideoContext | undefined;
          if (message.video !== undefined) {
            if (
              !isRecord(message.video) ||
              typeof message.video.videoId !== 'string' ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(message.video.videoId) ||
              typeof message.video.title !== 'string' ||
              message.video.title.length > 1000
            ) {
              throw new Error('Thông tin video không hợp lệ.');
            }
            video = { videoId: message.video.videoId, title: message.video.title };
          }
          if (!source.extensionPage && (!video || video.videoId !== source.videoId)) {
            throw new Error('Video không khớp với trang gửi yêu cầu giọng đọc.');
          }
          if (video && deletedVideos.has(video.videoId))
            throw new Error('Cache video đã xóa. Tải lại trang hoặc bật lại video để chuẩn bị lại.');
          const activity = video ? beginVideoCacheActivity(video.videoId) : undefined;
          const invalidate = () => {
            if (video) deletedVideos.add(video.videoId);
          };
          activity?.signal.addEventListener('abort', invalidate, { once: true });
          const synthesisSignal = activity ? AbortSignal.any([signal, activity.signal]) : signal;
          try {
            if (synthesisSignal.aborted) throw new DOMException('aborted', 'AbortError');
            if (video) await recordCacheVideo(video, synthesisSignal).catch(() => undefined);
            const state = helperStatus(await voiceNativeRequest('/tts/status', undefined, synthesisSignal));
            if (!state.ready)
              throw new Error(state.message ?? 'Chưa cài model giọng đọc. Mở Cài đặt → Giọng đọc để tải một lần.');
            if (!state.voices.some((voice) => voice.id === message.voice))
              throw new Error('Giọng đã chọn không còn khả dụng. Hãy chọn lại trong Cài đặt.');
            const key = await voiceCacheKey(state.version, message.voice, message.text);
            // Storage availability does not decide whether a viewer can hear the current sentence.
            const cached = await getVoiceCache(key, video?.videoId, synthesisSignal).catch(() => undefined);
            if (synthesisSignal.aborted) throw new DOMException('aborted', 'AbortError');
            if (cached) return cached;
            const value = await voiceNativeRequest(
              '/tts/synthesize',
              { text: message.text, voice: message.voice },
              synthesisSignal,
            );
            if (
              !isRecord(value) ||
              value.mime !== 'audio/wav' ||
              typeof value.base64 !== 'string' ||
              value.base64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 ||
              value.engineVersion !== state.version ||
              value.voice !== message.voice ||
              typeof value.durationMs !== 'number' ||
              !Number.isFinite(value.durationMs) ||
              value.durationMs <= 0 ||
              value.durationMs > 120_000
            ) {
              throw new Error('Trợ lý trả về audio không hợp lệ.');
            }
            const audio: VoiceAudio = {
              mime: 'audio/wav',
              base64: value.base64,
              durationMs: value.durationMs,
              engineVersion: state.version,
              voice: message.voice,
            };
            if (synthesisSignal.aborted) throw new DOMException('aborted', 'AbortError');
            await putVoiceCache(key, audio, video?.videoId, synthesisSignal).catch(() => undefined);
            return audio;
          } finally {
            activity?.signal.removeEventListener('abort', invalidate);
            activity?.close();
          }
        }
        default:
          throw new Error('Yêu cầu giọng đọc không được hỗ trợ.');
      }
    };
    void run()
      .then((value) => {
        if (!signal.aborted) post({ id, ok: true, value });
      })
      .catch((error: unknown) => {
        if (!signal.aborted) post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => requests.delete(id));
  });
}
