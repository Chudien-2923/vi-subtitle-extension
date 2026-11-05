import { type Browser, browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { indexedDbCache, sessionCacheKey } from '../lib/cache/cache';
import { isRecord } from '../lib/guards';
import { type BackgroundToContent, type ContentToBackground, SESSION_PORT } from '../lib/messaging';
import { createClient, hasProviderPermission } from '../lib/providers';
import { ProviderError, toProviderError } from '../lib/providers/errors';
import { loadSecrets, loadSettings } from '../lib/settings/settings';
import { TranslationSession } from '../lib/translate/session';
import { createWorker } from '../lib/translate/workers';

type StartMessage = Extract<ContentToBackground, { kind: 'start' }>;

async function createSession(start: StartMessage, post: (message: BackgroundToContent) => void) {
  const settings = await loadSettings();
  const secrets = await loadSecrets();
  const provider = settings.provider;
  const model = settings.models[provider];
  if (!(await hasProviderPermission(provider))) {
    throw new ProviderError('permission', `Missing host permission for ${provider}`);
  }
  const client = createClient({
    provider,
    model,
    apiKey: provider === 'ollama' ? undefined : secrets[provider],
    ollamaBaseUrl: settings.ollamaBaseUrl,
  });
  return new TranslationSession({
    worker: createWorker({ meta: start.meta, client, reviewPass: settings.reviewPass }, start.source),
    cache: indexedDbCache,
    cacheKey: sessionCacheKey(start.meta, provider, model, settings.reviewPass),
    concurrency: settings.concurrency,
    events: {
      onChunk: (index, payload) => post({ kind: 'chunk', index, payload }),
      onProgress: (done, total) => post({ kind: 'progress', done, total }),
      onWaiting: (retryInMs) => post({ kind: 'waiting', retryInMs }),
      onFatal: (error) => {
        if (error.code !== 'aborted') post({ kind: 'fatal', code: error.code, message: error.message });
      },
      onDone: (failedUnits) => post({ kind: 'done', failedUnits }),
    },
  });
}

function handlePort(port: Browser.runtime.Port): void {
  let session: TranslationSession | null = null;
  let disconnected = false;
  const post = (message: BackgroundToContent) => {
    if (!disconnected) port.postMessage(message);
  };
  port.onDisconnect.addListener(() => {
    disconnected = true;
    session?.abort();
  });
  port.onMessage.addListener((message: ContentToBackground) => {
    if (message.kind === 'playhead') {
      session?.setPlayhead(message.playheadMs);
      return;
    }
    if (message.kind !== 'start' || session) return;
    createSession(message, post)
      .then((created) => {
        if (disconnected) return;
        session = created;
        return created.start(message.playheadMs);
      })
      .catch((thrown: unknown) => {
        const error = toProviderError(thrown);
        post({ kind: 'fatal', code: error.code, message: error.message });
      });
  });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.runtime.openOptionsPage();
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (isRecord(message) && message.kind === 'open-options') void browser.runtime.openOptionsPage();
    return false;
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === SESSION_PORT) handlePort(port);
  });
});
