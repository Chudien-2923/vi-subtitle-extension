import { type Browser, browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { isJson3, parseAsrWords } from '../lib/captions/json3';
import { standardCues } from '../lib/captions/segment';
import type { SourceText, VideoMeta } from '../lib/captions/types';
import { statusText } from '../lib/i18n/vi';
import {
  type BackgroundToContent,
  type ContentToBackground,
  postBridge,
  type RuntimeMessage,
  readBridge,
  SESSION_PORT,
  type SessionStatus,
  type TabMessage,
  type TabStatusReply,
} from '../lib/messaging';
import { SubtitleOverlay } from '../lib/overlay/overlay';
import { loadSettings, onSettingsChanged, type Settings } from '../lib/settings/settings';
import { type ChunkPlan, planChunks } from '../lib/translate/chunks';
import { buildDisplay, type ChunkPayload } from '../lib/translate/display';
import { parseTrackInfo } from '../lib/youtube/tracks';

const HEARTBEAT_MS = 10_000;
const MAX_RECONNECTS = 3;
const TRANSIENT_BADGE_MS = 5000;

type Port = Browser.runtime.Port;

async function waitForPlayer(timeoutMs: number): Promise<{ player: HTMLElement; video: HTMLVideoElement } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const player = document.getElementById('movie_player');
    const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video');
    if (player && video) return { player, video };
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 250);
    await promise;
  }
  return null;
}

/** Settings that change translated output; changing them restarts the session. */
const translationSettingsKey = (s: Settings) =>
  JSON.stringify([s.enabled, s.provider, s.models[s.provider], s.ollamaUrl, s.reviewPass, s.concurrency]);

/** One video: captions → overlay → background translation session. */
class VideoSession {
  private readonly videoId: string;
  private readonly requestId: number;
  private settings: Settings;
  private readonly reportStatus: (status: SessionStatus) => void;
  private overlay: SubtitleOverlay | null = null;
  private video: HTMLVideoElement | null = null;
  private port: Port | null = null;
  private startMessage: ContentToBackground | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private badgeTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnects = 0;
  private finished = false;
  private disposed = false;
  private progress = { done: 0, total: 0 };
  private source: SourceText | null = null;
  private plans: ChunkPlan[] = [];
  private readonly payloads = new Map<number, ChunkPayload>();

  constructor(videoId: string, requestId: number, settings: Settings, reportStatus: (s: SessionStatus) => void) {
    this.videoId = videoId;
    this.requestId = requestId;
    this.settings = settings;
    this.reportStatus = reportStatus;
  }

  start(): void {
    this.setStatus({ state: 'loading-captions' });
    postBridge('main', { kind: 'load-captions', requestId: this.requestId, videoId: this.videoId });
  }

  handleBridge(message: Record<string, unknown>): void {
    if (message.requestId !== this.requestId || message.videoId !== this.videoId) return;
    if (message.kind === 'captions-failed') {
      void this.showFailure(message.reason === 'no-captions' ? { state: 'no-captions' } : { state: 'captions-failed' });
    } else if (message.kind === 'captions' && isJson3(message.json3)) {
      const track = parseTrackInfo(message.track);
      if (!track) return;
      const source: SourceText =
        track.kind === 'asr'
          ? { mode: 'words', words: parseAsrWords(message.json3) }
          : { mode: 'cues', cues: standardCues(message.json3) };
      if ((source.mode === 'words' ? source.words : source.cues).length === 0) {
        void this.showFailure({ state: 'no-captions' });
        return;
      }
      void this.mount(source, {
        videoId: this.videoId,
        title: typeof message.title === 'string' ? message.title : '',
        author: typeof message.author === 'string' ? message.author : '',
        track,
      });
    }
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    this.overlay?.setAppearance(settings.appearance, settings.bilingual);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.badgeTimer);
    this.port?.disconnect();
    this.port = null;
    this.overlay?.destroy();
    this.overlay = null;
    postBridge('main', { kind: 'release-captions' });
  }

  private async mount(source: SourceText, meta: VideoMeta) {
    const found = await waitForPlayer(20_000);
    if (!found || this.disposed) return;
    this.video = found.video;
    this.source = source;
    this.plans = planChunks(source);
    this.overlay = new SubtitleOverlay(found.player, found.video, this.settings.appearance, this.settings.bilingual);
    this.refreshDisplay();
    this.startMessage = { kind: 'start', meta, source, playheadMs: 0 };
    found.video.addEventListener('seeked', () => this.sendPlayhead());
    this.heartbeat = setInterval(() => this.sendPlayhead(), HEARTBEAT_MS);
    this.connect();
  }

  /** Shows a short notice on the player without taking over YouTube's own captions. */
  private async showFailure(status: SessionStatus) {
    this.setStatus(status);
    const found = await waitForPlayer(20_000);
    if (!found || this.disposed) return;
    const overlay = new SubtitleOverlay(found.player, found.video, this.settings.appearance, false);
    this.overlay = overlay;
    overlay.setBadge(statusText(status));
    this.badgeTimer = setTimeout(() => {
      overlay.destroy();
      if (this.overlay === overlay) this.overlay = null;
    }, TRANSIENT_BADGE_MS + 3000);
  }

  private connect(): void {
    if (!this.startMessage || this.disposed) return;
    const port = browser.runtime.connect({ name: SESSION_PORT });
    this.port = port;
    port.onMessage.addListener((message: BackgroundToContent) => this.handlePort(message));
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      // The service worker can be stopped by Chrome; the cache makes a reconnect cheap.
      if (!this.disposed && !this.finished && this.reconnects < MAX_RECONNECTS) {
        this.reconnects++;
        setTimeout(() => this.connect(), 1000);
      }
    });
    const playheadMs = (this.video?.currentTime ?? 0) * 1000;
    port.postMessage({ ...this.startMessage, playheadMs });
  }

  private sendPlayhead(): void {
    if (!this.port || !this.video || this.finished) return;
    const message: ContentToBackground = { kind: 'playhead', playheadMs: this.video.currentTime * 1000 };
    this.port.postMessage(message);
  }

  /** Rebuilds the cue list: translated word chunks switch to the model's sentence segmentation. */
  private refreshDisplay(): void {
    if (!this.overlay || !this.source) return;
    const display = buildDisplay(this.source, this.plans, this.payloads);
    this.overlay.setCues(display.cues);
    this.overlay.addTranslations(display.translations);
  }

  private handlePort(message: BackgroundToContent): void {
    switch (message.kind) {
      case 'chunk':
        this.payloads.set(message.index, message.payload);
        this.refreshDisplay();
        break;
      case 'progress':
        this.progress = { done: message.done, total: message.total };
        if (message.done < message.total) this.setStatus({ state: 'translating', ...this.progress });
        break;
      case 'waiting':
        this.setStatus({ state: 'waiting', ...this.progress, retryInMs: message.retryInMs });
        break;
      case 'fatal':
        this.finished = true;
        this.setStatus({ state: 'error', code: message.code, message: message.message });
        break;
      case 'done':
        this.finished = true;
        clearInterval(this.heartbeat);
        this.setStatus({ state: 'done', someUntranslated: message.failedUnits > 0 });
        this.port?.disconnect();
        this.port = null;
        break;
    }
  }

  private setStatus(status: SessionStatus): void {
    this.reportStatus(status);
    if (!this.overlay || this.disposed) return;
    clearTimeout(this.badgeTimer);
    const overlay = this.overlay;
    if (status.state === 'error') {
      overlay.setBadge(`${statusText(status)} (bấm để mở Cài đặt)`, {
        error: true,
        onClick: () => {
          const message: RuntimeMessage = { kind: 'open-options' };
          void browser.runtime.sendMessage(message);
        },
      });
      return;
    }
    overlay.setBadge(statusText(status));
    if (status.state === 'done') {
      this.badgeTimer = setTimeout(() => overlay.setBadge(null), TRANSIENT_BADGE_MS);
    }
  }
}

class Controller {
  private settings!: Settings;
  private videoId: string | null = null;
  private readonly disabledVideos = new Set<string>();
  private session: VideoSession | null = null;
  private status: SessionStatus = { state: 'idle' };
  private nextRequestId = 1;

  async init(): Promise<void> {
    this.settings = await loadSettings();
    onSettingsChanged((settings) => this.onSettings(settings));
    window.addEventListener('message', (event) => {
      const message = readBridge(event, 'isolated');
      if (!message) return;
      if (message.kind === 'video') {
        this.onVideo(typeof message.videoId === 'string' ? message.videoId : null);
      } else {
        this.session?.handleBridge(message);
      }
    });
    browser.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
      if (message.kind === 'set-video-enabled' && this.videoId) {
        if (message.enabled) this.disabledVideos.delete(this.videoId);
        else this.disabledVideos.add(this.videoId);
        this.restart();
      }
      if (message.kind === 'get-status' || message.kind === 'set-video-enabled') {
        const reply: TabStatusReply = {
          videoId: this.videoId,
          videoEnabled: this.videoId !== null && !this.disabledVideos.has(this.videoId),
          status: this.status,
        };
        sendResponse(reply);
      }
      return false;
    });
    postBridge('main', { kind: 'get-video' });
  }

  private onSettings(settings: Settings): void {
    const restart = translationSettingsKey(settings) !== translationSettingsKey(this.settings);
    this.settings = settings;
    if (restart) this.restart();
    else this.session?.updateSettings(settings);
  }

  private onVideo(videoId: string | null): void {
    if (videoId === this.videoId) return;
    this.videoId = videoId;
    this.restart();
  }

  private restart(): void {
    this.session?.dispose();
    this.session = null;
    const videoId = this.videoId;
    if (!videoId) {
      this.status = { state: 'idle' };
      return;
    }
    if (!this.settings.enabled || this.disabledVideos.has(videoId)) {
      this.status = { state: 'disabled' };
      return;
    }
    const session = new VideoSession(videoId, this.nextRequestId++, this.settings, (status) => {
      if (this.session === session) this.status = status;
    });
    this.session = session;
    session.start();
  }
}

export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  runAt: 'document_start',
  main() {
    void new Controller().init();
  },
});
