import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cue } from '../captions/types';
import { VoiceoverController } from './controller';
import type { VoiceAudio } from './types';

const settings = { enabled: true, voice: 'Hải Đăng', volume: 1, originalVolume: 0.2 };
const audioReply: VoiceAudio = {
  mime: 'audio/wav',
  base64: 'UklGRg==',
  durationMs: 5000,
  engineVersion: 'test',
  voice: 'Hải Đăng',
};
const cues: Cue[] = [
  { id: 'a', startMs: 0, endMs: 5000, text: 'one', words: null },
  { id: 'b', startMs: 10_000, endMs: 15_000, text: 'two', words: null },
];
const translations = new Map([
  ['a', 'Câu thứ nhất.'],
  ['b', 'Câu thứ hai.'],
]);
function media<T extends HTMLMediaElement>(element: T, initiallyPaused: boolean) {
  let paused = initiallyPaused;
  Object.defineProperty(element, 'paused', { get: () => paused });
  Object.defineProperty(element, 'readyState', { get: () => 4 });
  element.play = vi.fn(async () => {
    if (paused) {
      paused = false;
      element.dispatchEvent(new Event('play'));
    }
    element.dispatchEvent(new Event('playing'));
  });
  element.pause = vi.fn(() => {
    if (!paused) {
      paused = true;
      element.dispatchEvent(new Event('pause'));
    }
  });
  element.load = vi.fn();
  return element;
}
function fixture(initiallyPaused = false) {
  const player = document.createElement('div');
  document.body.append(player);
  const video = media(document.createElement('video'), initiallyPaused);
  video.volume = 0.8;
  video.playbackRate = 1.5;
  player.append(video);
  const audio = media(document.createElement('audio'), true);
  const requests: Array<{
    text: string;
    signal?: AbortSignal;
    resolve: (audio: VoiceAudio) => void;
    reject: (error: Error) => void;
  }> = [];
  const client = {
    close: vi.fn(),
    synthesize: vi.fn(
      (text: string, _voice: string, signal?: AbortSignal) =>
        new Promise<VoiceAudio>((resolve, reject) => requests.push({ text, signal, resolve, reject })),
    ),
  };
  const controller = new VoiceoverController(
    player,
    video,
    settings,
    () => {},
    { videoId: 'vid', title: 'Video' },
    client,
    audio,
  );
  controller.setTimeline(cues, translations, true);
  return { controller, player, video, audio, requests, client };
}
const flush = () => vi.advanceTimersByTimeAsync(1);

describe('voiceover media transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let serial = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:voice-${serial++}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('holds for generation, follows rate changes mid-sentence and restores the latest source volume', async () => {
    const f = fixture();
    expect(f.video.paused).toBe(true);
    f.requests[0]?.resolve(audioReply);
    await flush();
    expect(f.video.paused).toBe(false);
    expect(f.audio.playbackRate).toBe(1.5);
    await vi.advanceTimersByTimeAsync(140);
    expect(f.video.volume).toBeCloseTo(0.16);
    f.video.playbackRate = 2;
    f.video.dispatchEvent(new Event('ratechange'));
    expect(f.audio.playbackRate).toBe(2);
    f.video.volume = 0.5;
    f.video.dispatchEvent(new Event('volumechange'));
    await vi.advanceTimersByTimeAsync(140);
    expect(f.video.volume).toBeCloseTo(0.1);
    f.controller.destroy();
    expect(f.video.volume).toBe(0.5);
  });

  it('drops stale synthesis after seek and does not resume over an explicit user pause', async () => {
    const f = fixture();
    const old = f.requests[0];
    f.video.dispatchEvent(new Event('seeking'));
    f.video.currentTime = 12;
    f.video.dispatchEvent(new Event('seeked'));
    expect(old?.signal?.aborted).toBe(true);
    old?.resolve(audioReply);
    await flush();
    expect(f.audio.play).not.toHaveBeenCalled();
    expect(f.requests[1]?.text).toBe('Câu thứ hai.');
    f.video.dispatchEvent(new Event('pause'));
    f.requests[1]?.resolve(audioReply);
    await flush();
    expect(f.video.paused).toBe(true);
    expect(f.audio.play).not.toHaveBeenCalled();
    f.controller.destroy();
  });

  it('finishes oversized speech using a source hold, not word skipping or unbounded speed', async () => {
    const f = fixture();
    f.requests[0]?.resolve({ ...audioReply, durationMs: 8000 });
    await flush();
    expect(f.audio.playbackRate).toBe(1.875);
    f.video.currentTime = 4.99;
    f.video.dispatchEvent(new Event('timeupdate'));
    expect(f.video.paused).toBe(true);
    expect(f.audio.paused).toBe(false);
    f.audio.dispatchEvent(new Event('ended'));
    expect(f.video.paused).toBe(false);
    expect(f.audio.src).toBe('');
    f.controller.destroy();
  });

  it('restores video playback after TTS failure and never speaks on an advertisement', async () => {
    const f = fixture();
    f.requests[0]?.reject(new Error('worker exited'));
    await flush();
    expect(f.video.paused).toBe(false);
    expect(f.video.volume).toBe(0.8);
    expect(f.audio.play).not.toHaveBeenCalled();
    f.controller.destroy();
    const g = fixture();
    g.player.classList.add('ad-showing');
    await flush();
    expect(g.requests[0]?.signal?.aborted).toBe(true);
    g.requests[0]?.resolve(audioReply);
    await flush();
    expect(g.audio.play).not.toHaveBeenCalled();
    g.controller.updateSettings({ ...settings, enabled: false });
    g.player.classList.remove('ad-showing');
    await flush();
    expect(g.player.querySelector<HTMLElement>('#chudin-voiceover')?.hidden).toBe(false);
    g.controller.destroy();
  });
  it('pauses speech for buffering and mute without turning the user sound back on', async () => {
    const f = fixture();
    f.requests[0]?.resolve(audioReply);
    await flush();
    f.video.dispatchEvent(new Event('waiting'));
    expect(f.audio.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(140);
    expect(f.video.volume).toBe(0.8);
    f.video.dispatchEvent(new Event('playing'));
    expect(f.audio.paused).toBe(false);
    f.video.muted = true;
    f.video.dispatchEvent(new Event('volumechange'));
    expect(f.audio.paused).toBe(true);
    f.controller.destroy();
    expect(f.video.muted).toBe(true);
    expect(f.video.volume).toBe(0.8);
  });

  it('keeps preparing translated speech while paused without playing audio or resuming the video', async () => {
    const f = fixture(true);
    expect(f.requests[0]?.text).toBe('Câu thứ nhất.');
    f.requests[0]?.resolve(audioReply);
    await flush();
    expect(f.requests[1]?.text).toBe('Câu thứ hai.');
    f.requests[1]?.resolve(audioReply);
    await flush();
    expect(f.video.paused).toBe(true);
    expect(f.video.play).not.toHaveBeenCalled();
    expect(f.audio.play).not.toHaveBeenCalled();
    await f.video.play();
    await flush();
    expect(f.audio.paused).toBe(false);
    expect(f.requests).toHaveLength(2);
    f.controller.destroy();
  });

  it('invalidates pending play when paused, so an old rejection cannot break resumed speech', async () => {
    const f = fixture();
    const playing = Promise.withResolvers<void>();
    const resumeAudio = f.audio.play;
    f.audio.play = vi
      .fn()
      .mockReturnValueOnce(playing.promise)
      .mockImplementation(() => resumeAudio());
    f.requests[0]?.resolve(audioReply);
    await flush();
    // Repeated media ticks must not schedule duplicate play calls while the first is pending.
    f.video.dispatchEvent(new Event('timeupdate'));
    expect(f.audio.play).toHaveBeenCalledTimes(1);
    f.video.pause();
    await f.video.play();
    await flush();
    playing.reject(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
    await flush();
    expect(f.client.close).not.toHaveBeenCalled();
    expect(f.audio.paused).toBe(false);
    f.controller.destroy();
  });

  it('still reports a real autoplay rejection instead of swallowing all play errors', async () => {
    const f = fixture();
    f.audio.play = vi.fn().mockRejectedValue(new DOMException('User gesture required', 'NotAllowedError'));
    f.requests[0]?.resolve(audioReply);
    await flush();
    expect(f.client.close).toHaveBeenCalledTimes(1);
    expect(f.video.paused).toBe(false);
    expect(f.video.volume).toBe(0.8);
    f.controller.destroy();
  });

  it('prepares newly translated cues during pause but never queues beyond the lookahead limit', async () => {
    const f = fixture(true);
    const list = Array.from(
      { length: 14 },
      (_, index): Cue => ({
        id: `p${index}`,
        text: `source ${index}`,
        words: null,
        startMs: index * 6000,
        endMs: (index + 1) * 6000,
      }),
    );
    f.controller.setTimeline(list, new Map(), false);
    const old = f.requests[0];
    expect(old?.signal?.aborted).toBe(true);
    f.controller.setTimeline(list, new Map(list.map((cue, index) => [cue.id, `Câu đã dịch ${index}.`])), true);
    for (let i = 0; i < 12; i++) {
      expect(f.requests[i + 1]?.text).toBe(`Câu đã dịch ${i}.`);
      f.requests[i + 1]?.resolve(audioReply);
      await flush();
    }
    expect(f.requests).toHaveLength(13); // The cancelled original plus twelve prepared sentences.
    expect(f.audio.play).not.toHaveBeenCalled();
    expect(f.video.play).not.toHaveBeenCalled();
    f.controller.destroy();
  });
});
