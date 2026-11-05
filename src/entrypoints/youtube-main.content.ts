import { defineContentScript } from 'wxt/utils/define-content-script';
import { type Json3, parseJson3Text } from '../lib/captions/json3';
import type { CaptionTrackInfo } from '../lib/captions/types';
import { type CaptionFailure, type MainToIsolated, postBridge, readBridge } from '../lib/messaging';
import { type PlayerInfo, parsePlayerResponse, pickEnglishTrack, type YtCaptionTrack } from '../lib/youtube/tracks';

interface YtPlayer extends HTMLElement {
  getPlayerResponse?: () => unknown;
  setOption?: (module: string, key: string, value: unknown) => void;
  loadModule?: (module: string) => void;
  unloadModule?: (module: string) => void;
}

interface CapturedTimedtext {
  url: URL;
  body: string;
}

const TIMEDTEXT_PATH = '/api/timedtext';
/** URL params that select a track; everything else on a player request is session/token state. */
const TRACK_PARAMS = ['lang', 'kind', 'name', 'tlang', 'fmt'];

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function currentVideoId(): string | null {
  return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
}

function isCaptureOf(capture: CapturedTimedtext, videoId: string, track?: CaptionTrackInfo): boolean {
  const params = capture.url.searchParams;
  if (params.get('v') !== videoId) return false;
  if (!track) return true;
  return (
    params.get('lang') === track.languageCode &&
    (params.get('kind') === 'asr') === (track.kind === 'asr') &&
    !params.get('tlang')
  );
}

/**
 * Runs in the page's JS world: it can read the YouTube player and observe the
 * player's own timedtext requests, which carry the proof-of-origin token that
 * direct fetches may lack. Holds no secrets and uses no extension APIs.
 */
export default defineContentScript({
  matches: ['*://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const nativeFetch = window.fetch.bind(window);
    const captured: CapturedTimedtext[] = [];
    const waiters = new Set<() => void>();
    let captionsTurnedOnByUs = false;

    const onTimedtext = (rawUrl: string, body: string) => {
      captured.push({ url: new URL(rawUrl, location.origin), body });
      if (captured.length > 20) captured.shift();
      for (const wake of waiters) wake();
    };

    window.fetch = async function patchedFetch(...args: Parameters<typeof fetch>) {
      const response = await nativeFetch(...args);
      const [input] = args;
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes(TIMEDTEXT_PATH)) {
        response
          .clone()
          .text()
          .then((body) => onTimedtext(url, body))
          .catch(() => undefined);
      }
      return response;
    };

    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(this: XMLHttpRequest, ...args: unknown[]) {
      const url = String(args[1]);
      if (url.includes(TIMEDTEXT_PATH)) {
        this.addEventListener('load', () => {
          if (this.responseType === '' || this.responseType === 'text') onTimedtext(url, this.responseText);
          else if (this.responseType === 'json') onTimedtext(url, JSON.stringify(this.response));
        });
      }
      return Reflect.apply(nativeOpen, this, args);
    };

    // #movie_player is YouTube's player element and exposes the methods in YtPlayer.
    const getPlayer = () => document.getElementById('movie_player') as YtPlayer | null;

    /** The player response can lag behind SPA navigation; wait until it matches the URL's video. */
    const waitForPlayerInfo = async (videoId: string): Promise<PlayerInfo | null> => {
      for (let attempt = 0; attempt < 60 && currentVideoId() === videoId; attempt++) {
        const info =
          parsePlayerResponse(getPlayer()?.getPlayerResponse?.(), videoId) ??
          parsePlayerResponse(Reflect.get(window, 'ytInitialPlayerResponse'), videoId);
        if (info) return info;
        await sleep(250);
      }
      return null;
    };

    const fetchJson3 = async (url: URL): Promise<Json3 | null> => {
      url.searchParams.set('fmt', 'json3');
      try {
        const response = await nativeFetch(url.toString(), { credentials: 'include' });
        const json3 = response.ok ? parseJson3Text(await response.text()) : null;
        return json3 && json3.events.length > 0 ? json3 : null;
      } catch {
        return null;
      }
    };

    const waitForCapture = async (videoId: string, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline && !captured.some((c) => isCaptureOf(c, videoId))) {
        const { promise, resolve } = Promise.withResolvers<void>();
        waiters.add(resolve);
        await Promise.race([promise, sleep(250)]);
        waiters.delete(resolve);
      }
    };

    const parsedCapture = (videoId: string, track: CaptionTrackInfo) => {
      const capture = captured.find((c) => isCaptureOf(c, videoId, track));
      return capture ? parseJson3Text(capture.body) : null;
    };

    /**
     * 1. reuse a response the player already fetched, 2. fetch the track URL
     * directly, 3. make the player load captions and reuse its request/token.
     */
    const loadJson3 = async (videoId: string, track: YtCaptionTrack): Promise<Json3 | null> => {
      const early = parsedCapture(videoId, track);
      if (early) return early;

      const direct = await fetchJson3(new URL(track.baseUrl, location.origin));
      if (direct) return direct;

      const player = getPlayer();
      if (!captured.some((c) => isCaptureOf(c, videoId)) && player?.setOption) {
        player.loadModule?.('captions');
        player.setOption('captions', 'track', {
          languageCode: track.languageCode,
          ...(track.kind === 'asr' ? { kind: 'asr' } : {}),
        });
        captionsTurnedOnByUs = true;
        await waitForCapture(videoId, 8000);
      }
      const exact = parsedCapture(videoId, track);
      if (exact) return exact;

      const sample = captured.find((c) => isCaptureOf(c, videoId));
      if (!sample) return null;
      const url = new URL(track.baseUrl, location.origin);
      for (const [key, value] of sample.url.searchParams) {
        if (!url.searchParams.has(key) && !TRACK_PARAMS.includes(key)) url.searchParams.set(key, value);
      }
      return fetchJson3(url);
    };

    const send = (message: MainToIsolated) => postBridge('isolated', message);

    const handleLoad = async (requestId: number, videoId: string) => {
      const fail = (reason: CaptionFailure) => send({ kind: 'captions-failed', requestId, videoId, reason });
      const info = await waitForPlayerInfo(videoId);
      if (!info) return fail('fetch-failed');
      const track = pickEnglishTrack(info.tracks);
      if (!track) return fail('no-captions');
      const json3 = await loadJson3(videoId, track);
      if (!json3) return fail('fetch-failed');
      const { baseUrl: _baseUrl, ...trackInfo } = track;
      send({ kind: 'captions', requestId, videoId, title: info.title, author: info.author, track: trackInfo, json3 });
    };

    window.addEventListener('message', (event) => {
      const message = readBridge(event, 'main');
      if (!message) return;
      if (message.kind === 'get-video') {
        send({ kind: 'video', videoId: currentVideoId() });
      } else if (
        message.kind === 'load-captions' &&
        typeof message.requestId === 'number' &&
        typeof message.videoId === 'string'
      ) {
        void handleLoad(message.requestId, message.videoId);
      } else if (message.kind === 'release-captions' && captionsTurnedOnByUs) {
        captionsTurnedOnByUs = false;
        getPlayer()?.unloadModule?.('captions');
      }
    });

    let lastVideoId: string | null | undefined;
    const announceVideo = () => {
      const videoId = currentVideoId();
      if (videoId === lastVideoId) return;
      lastVideoId = videoId;
      captionsTurnedOnByUs = false;
      send({ kind: 'video', videoId });
    };
    document.addEventListener('yt-navigate-finish', announceVideo);
    window.addEventListener('popstate', announceVideo);
    // Fallback for navigations that fire no event we listen to.
    setInterval(announceVideo, 1000);
    announceVideo();
  },
});
