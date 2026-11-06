import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';

async function setup() {
  vi.resetModules();
  const listeners: Array<(message: unknown) => void> = [];
  const disconnects: Array<() => void> = [];
  const sent: Array<Record<string, unknown>> = [];
  const port = {
    postMessage: (value: Record<string, unknown>) => sent.push(value),
    disconnect: vi.fn(),
    onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnects.push(fn) },
  };
  Object.assign(browser.runtime, { connectNative: vi.fn(() => port) });
  const transport = await import('./native');
  const release = transport.retainVoiceHost();
  return {
    ...transport,
    release,
    sent,
    disconnected: () =>
      disconnects.forEach((f) => {
        f();
      }),
    reply: (message: unknown) =>
      listeners.forEach((fn) => {
        fn(message);
      }),
  };
}

describe('native voice audio integrity', () => {
  afterEach(() => vi.restoreAllMocks());
  it('reassembles bounded frames only when the final byte count and order match', async () => {
    const t = await setup();
    const result = t.voiceNativeRequest('/tts/synthesize', { text: 'Xin chào', voice: 'Hải Đăng' });
    const id = t.sent[0]?.id;
    t.reply({ id, event: 'audio', seq: 0, data: 'UklG' });
    t.reply({ id, event: 'audio', seq: 1, data: 'Rg==' });
    t.reply({
      id,
      status: 200,
      body: { mime: 'audio/wav', durationMs: 100, bytes: 4, chunks: 2, engineVersion: 'test', voice: 'Hải Đăng' },
    });
    await expect(result).resolves.toMatchObject({ base64: 'UklGRg==', durationMs: 100 });
    t.release();
  });
  it('rejects missing frames rather than playing truncated audio', async () => {
    const t = await setup();
    const result = t.voiceNativeRequest('/tts/synthesize', {});
    const rejected = expect(result).rejects.toThrow('Dữ liệu audio');
    t.reply({ id: t.sent[0]?.id, event: 'audio', seq: 1, data: 'UklG' });
    await rejected;
    expect(t.sent.at(-1)).toMatchObject({ path: '/tts/cancel', body: { requestId: t.sent[0]?.id } });
    t.release();
  });
  it('cancels only the aborted utterance and still accepts the next response', async () => {
    const t = await setup();
    const signal = new AbortController();
    const a = t.voiceNativeRequest('/tts/synthesize', {}, signal.signal);
    const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    const b = t.voiceNativeRequest('/tts/status');
    signal.abort();
    await rejected;
    t.reply({ id: t.sent[0]?.id, status: 200, body: { stale: true } });
    t.reply({ id: t.sent[1]?.id, status: 200, body: { ready: true } });
    await expect(b).resolves.toEqual({ ready: true });
    t.release();
  });
  it('rejects outstanding requests on native exit instead of leaving playback waiting forever', async () => {
    const t = await setup();
    const result = t.voiceNativeRequest('/tts/status');
    const rejected = expect(result).rejects.toThrow('Cài đặt');
    t.disconnected();
    await rejected;
    t.release();
  });
});
