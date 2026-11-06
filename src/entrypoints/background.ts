import { type Browser, browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { beginVideoCacheActivity } from '../lib/cache/activity';
import { indexedDbCache, recordCacheVideo, sessionCacheKey } from '../lib/cache/cache';
import { isRecord } from '../lib/guards';
import { type BackgroundToContent, type ContentToBackground, SESSION_PORT } from '../lib/messaging';
import { clientConfigFor, createClient, hasProviderPermission } from '../lib/providers';
import { ProviderError, toProviderError } from '../lib/providers/errors';
import { loadSecrets, loadSettings } from '../lib/settings/settings';
import { TranslationSession } from '../lib/translate/session';
import { createWorker } from '../lib/translate/workers';
import { handleVoicePort } from '../lib/voiceover/service';
import { VOICE_PORT } from '../lib/voiceover/types';

type StartMessage = Extract<ContentToBackground, { kind: 'start' }>;

async function createSession(start: StartMessage, post: (message: BackgroundToContent) => void, signal: AbortSignal) {
  const settings = await loadSettings();
  const secrets = await loadSecrets();
  const provider = settings.provider;
  const model = settings.models[provider];
  if (!(await hasProviderPermission(provider))) {
    throw new ProviderError('permission', `Missing host permission for ${provider}`);
  }
  await recordCacheVideo({ videoId: start.meta.videoId, title: start.meta.title.slice(0, 1000) }, signal).catch(
    () => undefined,
  );
  if (signal.aborted) throw new ProviderError('aborted', 'Cache activity cancelled');
  const client = createClient(clientConfigFor(settings, secrets));
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
  let started = false;
  const cancelled = new AbortController();
  let activity: ReturnType<typeof beginVideoCacheActivity> | undefined;
  const post = (message: BackgroundToContent) => {
    if (!disconnected) port.postMessage(message);
  };
  port.onDisconnect.addListener(() => {
    disconnected = true;
    session?.abort();
    cancelled.abort();
    activity?.close();
  });
  port.onMessage.addListener((message: ContentToBackground) => {
    if (message.kind === 'playhead') {
      session?.setPlayhead(message.playheadMs);
      return;
    }
    if (message.kind !== 'start' || started) return;
    started = true;
    activity = beginVideoCacheActivity(message.meta.videoId);
    const signal = AbortSignal.any([cancelled.signal, activity.signal]);
    signal.addEventListener('abort', () => session?.abort(), { once: true });
    createSession(message, post, signal)
      .then((created) => {
        if (disconnected || signal.aborted) {
          created.abort();
          return;
        }
        session = created;
        return created.start(message.playheadMs);
      })
      .catch((thrown: unknown) => {
        const error = toProviderError(thrown);
        if (signal.aborted) return;
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
    else if (port.name === VOICE_PORT) handleVoicePort(port);
  });
});
