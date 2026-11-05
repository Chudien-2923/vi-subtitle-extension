import { browser } from 'wxt/browser';
import { isRecord } from '../guards';
import { errorFromResponse, ProviderError } from './errors';
import type { JsonTransport } from './openai-compatible';

/** Native messaging host installed by `bridge/install.sh` (see bridge/omp-host.mjs). */
export const OMP_HOST_NAME = 'com.chudin.vi_subtitle';
/** Chrome keeps the helper process alive while the port is open; close it when unused. */
const IDLE_CLOSE_MS = 60_000;

type Port = ReturnType<typeof browser.runtime.connectNative>;
interface Pending {
  resolve: (body: unknown) => void;
  reject: (error: unknown) => void;
}

let port: Port | null = null;
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, Pending>();

function settle(id: number): Pending | undefined {
  const entry = pending.get(id);
  pending.delete(id);
  if (pending.size === 0) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      port?.disconnect();
      port = null;
    }, IDLE_CLOSE_MS);
  }
  return entry;
}

function replyError(status: number, body: unknown): ProviderError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  if (error?.type === 'omp_unavailable') {
    return new ProviderError('helper-missing', `Oh My Pi helper cannot run omp: ${String(error.message)}`);
  }
  return errorFromResponse(status, new Headers(), JSON.stringify(body));
}

function connect(): Port {
  if (port) return port;
  if (typeof browser.runtime.connectNative !== 'function') {
    throw new ProviderError('helper-missing', 'nativeMessaging is not available in this browser');
  }
  const opened = browser.runtime.connectNative(OMP_HOST_NAME);
  opened.onMessage.addListener((message: unknown) => {
    if (!isRecord(message) || typeof message.id !== 'number') return;
    const entry = settle(message.id);
    if (!entry) return;
    const status = typeof message.status === 'number' ? message.status : 502;
    if (status >= 200 && status < 300) entry.resolve(message.body);
    else entry.reject(replyError(status, message.body));
  });
  opened.onDisconnect.addListener(() => {
    // "Specified native messaging host not found", "Access … forbidden", "Native host has exited".
    const reason = browser.runtime.lastError?.message ?? 'Native host has exited.';
    if (port === opened) port = null;
    for (const [id, entry] of pending) {
      settle(id);
      entry.reject(new ProviderError('helper-missing', `Oh My Pi helper: ${reason}`));
    }
  });
  port = opened;
  return opened;
}

/** JSON request to the Oh My Pi helper; same shape as the OpenAI-compatible HTTP API. */
export const ompTransport: JsonTransport = (path, init) => {
  const target = connect();
  clearTimeout(idleTimer);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const signal = init.signal;
    const onAbort = () => {
      settle(id);
      reject(new ProviderError('aborted', 'aborted'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    pending.set(id, {
      resolve: (body) => {
        done();
        resolve(body);
      },
      reject: (error) => {
        done();
        reject(error);
      },
    });
    target.postMessage({ id, path, method: init.method, ...(init.body === undefined ? {} : { body: init.body }) });
  });
};

/** Starts the helper and checks it can reach Oh My Pi; returns the omp version. */
export async function checkOmpHelper(signal?: AbortSignal): Promise<string> {
  const body = await ompTransport('/health', { method: 'GET', signal });
  return isRecord(body) && typeof body.omp === 'string' ? body.omp : '?';
}
