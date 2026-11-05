import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { IS_FATAL } from './errors';

type Listener = (message: unknown) => void;

/** Minimal stand-in for the port Chrome returns from `connectNative`. */
function fakePort() {
  const messages: Listener[] = [];
  const disconnects: (() => void)[] = [];
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    port: {
      postMessage: (message: Record<string, unknown>) => sent.push(message),
      disconnect: vi.fn(),
      onMessage: { addListener: (fn: Listener) => messages.push(fn) },
      onDisconnect: { addListener: (fn: () => void) => disconnects.push(fn) },
    },
    reply: (message: unknown) => {
      for (const fn of messages) fn(message);
    },
    hostGone: (reason: string) => {
      vi.spyOn(browser.runtime, 'lastError', 'get').mockReturnValue({ message: reason });
      for (const fn of disconnects) fn();
    },
  };
}

async function setup() {
  vi.resetModules();
  const fake = fakePort();
  const connect = vi.fn(() => fake.port);
  Object.assign(browser.runtime, { connectNative: connect });
  // Dynamic import: native.ts keeps one port per module instance; each test needs a fresh one.
  const native = await import('./native');
  return { ...fake, connect, native };
}

describe('Oh My Pi native transport', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('resolves replies by id, even when they arrive out of order', async () => {
    const { native, sent, reply, connect } = await setup();
    const a = native.ompTransport('/v1/models', { method: 'GET' });
    const b = native.ompTransport('/v1/chat/completions', { method: 'POST', body: { model: 'm' } });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(native.OMP_HOST_NAME);
    reply({ id: sent[1]?.id, status: 200, body: 'chat' });
    reply({ id: sent[0]?.id, status: 200, body: 'models' });
    await expect(a).resolves.toBe('models');
    await expect(b).resolves.toBe('chat');
  });

  it('reports a missing helper as a fatal, actionable error', async () => {
    const { native, hostGone } = await setup();
    const request = native.checkOmpHelper();
    hostGone('Specified native messaging host not found.');
    await expect(request).rejects.toMatchObject({ code: 'helper-missing' });
    expect(IS_FATAL['helper-missing']).toBe(true);
  });

  it('treats "helper cannot start omp" as helper-missing and other HTTP errors normally', async () => {
    const { native, sent, reply } = await setup();
    const health = native.checkOmpHelper();
    const chat = native.ompTransport('/v1/chat/completions', { method: 'POST', body: {} });
    reply({ id: sent[0]?.id, status: 503, body: { error: { type: 'omp_unavailable', message: 'spawn omp ENOENT' } } });
    reply({ id: sent[1]?.id, status: 404, body: { error: { message: 'No available model matches "x"' } } });
    await expect(health).rejects.toMatchObject({ code: 'helper-missing' });
    await expect(chat).rejects.toMatchObject({ code: 'bad-model' });
  });

  it('rejects an aborted request without waiting for the helper', async () => {
    const { native } = await setup();
    const controller = new AbortController();
    const request = native.ompTransport('/v1/models', { method: 'GET', signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'aborted' });
  });
});
