import { browser } from 'wxt/browser';
import type { CacheVideoContext } from '../cache/types';
import type { Cue } from '../captions/types';
import type { VoiceoverSettings } from '../settings/settings';
import { unlockVoiceAudio, VoiceClient, voiceAudioBlob } from './client';
import { activeSpeech, type SpeechCue, speechRate, speechTimeline } from './timeline';
import type { VoiceAudio } from './types';
import { SourceVolume } from './volume';

interface Playing {
  cue: SpeechCue;
  url: string;
  durationMs: number;
  anchorMs: number;
}
type Hold = 'translation' | 'synthesis' | 'overflow';

/** One player, one audio element, one inference at a time. The video clock owns cue selection. */
export class VoiceoverController {
  private settings: VoiceoverSettings;
  private readonly sourceVolume: SourceVolume;
  private readonly host: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly cleanups: Array<() => void> = [];
  private readonly observer: MutationObserver;
  private timeline: SpeechCue[] = [];
  private translationDone = false;
  private readonly spoken = new Set<string>();
  private readonly ready = new Map<string, VoiceAudio>();
  private loading: { text: string; abort: AbortController } | null = null;
  private active: Playing | null = null;
  private playAttempt: { active: Playing } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hold: Hold | null = null;
  private expectedPauses = 0;
  private desiredPlaying: boolean;
  private buffering: boolean;
  private silent = false;
  private failed = false;
  private destroyed = false;
  private epoch = 0;
  private lastAd = false;

  constructor(
    private readonly player: HTMLElement,
    private readonly video: HTMLVideoElement,
    settings: VoiceoverSettings,
    private readonly onEnabled: (enabled: boolean) => void,
    private readonly cacheVideo: CacheVideoContext,
    private readonly client: Pick<VoiceClient, 'synthesize' | 'close'> = new VoiceClient(),
    private readonly audio = document.createElement('audio'),
  ) {
    this.settings = { ...settings };
    this.desiredPlaying = !video.paused;
    this.buffering = video.readyState < 3;
    this.sourceVolume = new SourceVolume(video, settings.originalVolume);
    this.audio.preservesPitch = true;
    this.audio.preload = 'auto';
    this.host = document.createElement('div');
    this.host.id = 'chudin-voiceover';
    Object.assign(this.host.style, {
      position: 'absolute',
      right: '12px',
      top: '48px',
      zIndex: '42',
      maxWidth: 'min(90%, 520px)',
    });
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{font:12px system-ui;color:white}div{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px;border-radius:6px;background:#111d}button{font:inherit;color:inherit;border:1px solid #888;background:#222;border-radius:4px;padding:5px;cursor:pointer}button[aria-pressed=true]{border-color:#53bbbd}span{max-width:350px;white-space:pre-wrap}audio,[hidden]{display:none!important}';
    const bar = document.createElement('div');
    this.toggle = document.createElement('button');
    this.toggle.type = 'button';
    this.retry = document.createElement('button');
    this.retry.type = 'button';
    this.retry.textContent = 'Cho phép / Thử lại';
    this.retry.hidden = true;
    const options = document.createElement('button');
    options.type = 'button';
    options.textContent = 'Cài đặt giọng';
    this.label = document.createElement('span');
    this.label.setAttribute('role', 'status');
    bar.append(this.toggle, this.retry, options, this.label);
    bar.addEventListener('click', (event) => event.stopPropagation());
    bar.addEventListener('keydown', (event) => event.stopPropagation());
    root.append(style, bar, audio);
    player.append(this.host);
    this.toggle.addEventListener('click', () => {
      const enabled = !this.settings.enabled;
      if (enabled) {
        const permission = unlockVoiceAudio(this.audio);
        void permission
          .then(() => {
            if (this.destroyed) return;
            this.updateSettings({ ...this.settings, enabled: true });
            this.onEnabled(true);
          })
          .catch((error: unknown) => this.fail(error));
      } else {
        this.updateSettings({ ...this.settings, enabled: false });
        this.onEnabled(false);
      }
    });
    this.retry.addEventListener('click', () => {
      this.failed = false;
      this.retry.hidden = true;
      void unlockVoiceAudio(this.audio)
        .then(() => {
          if (this.destroyed) return;
          if (!this.settings.enabled) {
            this.updateSettings({ ...this.settings, enabled: true });
            this.onEnabled(true);
          } else this.tick();
        })
        .catch((error: unknown) => this.fail(error));
    });
    options.addEventListener('click', () => {
      void browser.runtime.sendMessage({ kind: 'open-options' });
    });
    this.listen(video, 'play', () => {
      this.desiredPlaying = true;
      this.tick();
    });
    this.listen(video, 'playing', () => {
      this.buffering = false;
      this.tick();
    });
    this.listen(video, 'pause', () => {
      if (this.expectedPauses > 0) {
        this.expectedPauses--;
        return;
      }
      this.desiredPlaying = false;
      this.hold = null;
      this.pauseAudio();
      this.tick();
    });
    this.listen(video, 'waiting', () => {
      this.buffering = true;
      this.pauseAudio();
      this.tick();
    });
    this.listen(video, 'seeking', () => {
      const wasHeld = this.hold !== null;
      this.resetAudio();
      this.spoken.clear();
      this.hold = wasHeld && this.desiredPlaying ? 'synthesis' : null;
    });
    this.listen(video, 'seeked', () => {
      this.buffering = video.readyState < 3;
      this.tick();
    });
    this.listen(video, 'ratechange', () => {
      this.applyRate();
      this.tick();
    });
    this.listen(video, 'timeupdate', () => this.tick());
    this.listen(video, 'volumechange', () => this.tick());
    this.listen(video, 'ended', () => {
      this.desiredPlaying = false;
      this.resetAudio();
      this.releaseHold();
    });
    this.listen(video, 'emptied', () => {
      this.buffering = true;
      this.resetAudio();
      this.spoken.clear();
      this.releaseHold();
    });
    this.listen(audio, 'playing', () => {
      // The gesture-unlock helper briefly plays silence without an active cue.
      if (!this.active) return;
      if (!this.desiredPlaying || this.buffering || video.muted || this.sourceVolume.userVolume === 0) {
        this.pauseAudio();
      } else this.sourceVolume.setReading(true);
    });
    this.listen(audio, 'ended', () => {
      if (!this.active) return;
      this.spoken.add(this.active.cue.key);
      this.stopAudio();
      this.releaseHold();
      this.tick();
    });
    this.listen(audio, 'error', () => {
      if (this.active) this.fail(new Error('Không phát được audio. Kiểm tra trợ lý trong Cài đặt.'));
    });
    this.observer = new MutationObserver(() => this.tick());
    this.observer.observe(player, { attributes: true, attributeFilter: ['class'] });
    this.renderToggle();
    this.tick();
  }

  setTimeline(cues: readonly Cue[], translations: ReadonlyMap<string, string>, done: boolean): void {
    this.timeline = speechTimeline(cues, translations);
    this.translationDone = done;
    if (this.active) {
      const current = this.timeline.find((cue) => cue.key === this.active?.cue.key);
      if (current) this.active.cue = current;
      else this.resetAudio();
    }
    this.tick();
  }

  updateSettings(settings: VoiceoverSettings): void {
    const reset = settings.voice !== this.settings.voice || settings.enabled !== this.settings.enabled;
    this.settings = { ...settings };
    this.sourceVolume.setFactor(settings.originalVolume);
    this.audio.volume = settings.volume;
    if (reset) {
      this.failed = false;
      this.retry.hidden = true;
      this.resetAudio();
      this.ready.clear();
      this.spoken.clear();
      if (!settings.enabled) {
        this.releaseHold();
        this.client.close();
      }
    }
    this.renderToggle();
    this.tick();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.timer);
    this.resetAudio();
    this.releaseHold();
    this.client.close();
    for (const remove of this.cleanups) remove();
    this.observer.disconnect();
    this.sourceVolume.destroy();
    this.host.remove();
  }

  private listen(target: EventTarget, type: string, listener: () => void): void {
    target.addEventListener(type, listener);
    this.cleanups.push(() => target.removeEventListener(type, listener));
  }
  private renderToggle(): void {
    this.toggle.textContent = `Đọc VI: ${this.settings.enabled ? 'Bật' : 'Tắt'}`;
    this.toggle.setAttribute('aria-pressed', String(this.settings.enabled));
    if (!this.settings.enabled && !this.failed) this.label.textContent = '';
  }
  private stopAudio(): void {
    const active = this.active;
    this.pauseAudio();
    this.active = null;
    this.audio.removeAttribute('src');
    this.audio.load();
    if (active) URL.revokeObjectURL(active.url);
    this.sourceVolume.setReading(false);
  }
  private resetAudio(): void {
    this.epoch++;
    this.loading?.abort.abort();
    this.loading = null;
    this.stopAudio();
  }
  private pauseAudio(): void {
    // Invalidate before pause(): its pending play promise can reject on a later task,
    // even after playback has resumed. Only the current attempt may report an error.
    this.playAttempt = null;
    if (this.active) this.audio.pause();
    this.sourceVolume.setReading(false);
  }
  private pauseVideo(reason: Hold): void {
    if (!this.desiredPlaying) return;
    this.hold = reason;
    if (!this.video.paused) {
      this.expectedPauses++;
      this.video.pause();
    }
  }
  private releaseHold(): void {
    if (!this.hold) return;
    this.hold = null;
    if (this.desiredPlaying && this.video.paused && !this.video.ended) {
      void this.video.play().catch(() => {
        this.desiredPlaying = false;
      });
    }
  }
  private applyRate(): void {
    if (!this.active) return;
    this.audio.playbackRate = speechRate(
      this.video.playbackRate,
      this.active.durationMs,
      this.active.cue.endMs - this.active.anchorMs,
    );
  }
  private playAudio(): void {
    if (!this.active || !this.audio.paused || this.playAttempt) return;
    const attempt = { active: this.active };
    this.playAttempt = attempt;
    void this.audio
      .play()
      .then(() => {
        if (this.playAttempt === attempt) this.playAttempt = null;
      })
      .catch((error: unknown) => {
        if (this.playAttempt !== attempt) return;
        this.playAttempt = null;
        if (this.active === attempt.active && !this.destroyed) this.fail(error);
      });
  }
  private fail(error: unknown): void {
    if (this.destroyed) return;
    this.failed = true;
    this.resetAudio();
    this.releaseHold();
    this.client.close();
    this.retry.hidden = false;
    const detail = error instanceof Error ? error.message : String(error);
    this.label.textContent = `Giọng đọc tạm dừng: ${detail}. Bấm thử lại hoặc mở Cài đặt giọng.`;
  }

  private tick(): void {
    clearTimeout(this.timer);
    if (this.destroyed) return;
    const ad = this.player.classList.contains('ad-showing');
    if (ad !== this.lastAd) {
      this.lastAd = ad;
      this.resetAudio();
      this.spoken.clear();
      this.releaseHold();
    }
    this.host.hidden = ad;
    if (!this.settings.enabled || this.failed || ad || this.video.seeking || this.video.ended) return;
    const silent = this.video.muted || this.sourceVolume.userVolume === 0 || this.settings.volume === 0;
    if (silent) {
      if (!this.silent) {
        this.resetAudio();
        this.releaseHold();
      }
      this.silent = true;
      this.label.textContent = 'Đang tắt tiếng';
      return;
    }
    this.silent = false;
    const now = this.video.currentTime * 1000;
    // Preparation is independent of playback: a paused viewer can wait for the next
    // bounded window to become ready without granting autoplay or advancing video.
    this.prefetch(now);
    if (!this.desiredPlaying || this.buffering) {
      this.pauseAudio();
      const upcoming = this.upcoming(now);
      const prepared = upcoming.filter((cue) => cue.text && this.ready.has(cue.text)).length;
      const progress = upcoming.length
        ? `${prepared}/${upcoming.length} câu đã dịch trong cửa sổ kế tiếp`
        : this.translationDone
          ? 'Không còn câu đã dịch cần chuẩn bị ở vị trí này'
          : 'Chờ bản dịch tiếng Việt…';
      this.label.textContent = `${this.buffering && this.desiredPlaying ? 'Video đang tải' : 'Đang tạm dừng'} · ${this.loading ? 'Đang chuẩn bị giọng' : 'Giọng đã chuẩn bị'}: ${progress}`;
      return;
    }
    if (this.active) {
      this.applyRate();
      if (now >= this.active.cue.endMs - 20) {
        this.pauseVideo('overflow');
        this.label.textContent = 'Đọc hết câu rồi tiếp tục video…';
      } else this.label.textContent = `${this.settings.voice} · ${this.audio.playbackRate.toFixed(2)}×`;
      this.playAudio();
    } else {
      const current = activeSpeech(this.timeline, now);
      if (current && !this.spoken.has(current.key)) {
        if (!current.text) {
          if (!this.translationDone) {
            this.pauseVideo('translation');
            this.label.textContent = 'Chờ bản dịch tiếng Việt…';
          } else {
            this.spoken.add(current.key);
            this.releaseHold();
            this.label.textContent = 'Đoạn này chưa có bản dịch để đọc.';
          }
        } else {
          const audio = this.ready.get(current.text);
          if (!audio) {
            this.pauseVideo('synthesis');
            this.label.textContent = 'Đang tạo giọng đọc…';
          } else {
            const url = URL.createObjectURL(voiceAudioBlob(audio));
            this.active = { cue: current, url, durationMs: audio.durationMs, anchorMs: now };
            this.audio.src = url;
            this.audio.volume = this.settings.volume;
            this.applyRate();
            this.playAudio();
            this.releaseHold();
          }
        }
      } else {
        this.releaseHold();
        this.label.textContent = this.loading ? 'Đang chuẩn bị câu kế tiếp…' : 'Sẵn sàng';
      }
    }
    const boundary = this.active?.cue.endMs ?? this.timeline.find((cue) => cue.startMs > now)?.startMs;
    const delay =
      boundary === undefined
        ? 250
        : Math.max(20, Math.min(250, (boundary - now) / Math.max(this.video.playbackRate, 0.1)));
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private upcoming(now: number): SpeechCue[] {
    return this.timeline
      .filter(
        (cue) =>
          cue.endMs > now &&
          cue.startMs < now + 60_000 * this.video.playbackRate &&
          cue.text &&
          !this.spoken.has(cue.key),
      )
      .slice(0, 12);
  }

  private prefetch(now: number): void {
    const upcoming = this.upcoming(now);
    const wanted = new Set(upcoming.map((cue) => cue.text as string));
    for (const text of this.ready.keys())
      if (!wanted.has(text) && text !== this.active?.cue.text) this.ready.delete(text);
    if (this.loading && !wanted.has(this.loading.text)) {
      this.loading.abort.abort();
      this.loading = null;
    }
    if (this.loading) return;
    const next = upcoming.find((cue) => cue.text && !this.ready.has(cue.text));
    if (!next?.text) return;
    const text = next.text;
    const abort = new AbortController();
    const loading = { text, abort };
    this.loading = loading;
    const epoch = this.epoch;
    void this.client
      .synthesize(text, this.settings.voice, abort.signal, this.cacheVideo)
      .then((audio) => {
        if (this.destroyed || abort.signal.aborted || epoch !== this.epoch) return;
        this.ready.set(text, audio);
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted && epoch === this.epoch) this.fail(error);
      })
      .finally(() => {
        if (this.loading === loading) {
          this.loading = null;
          this.tick();
        }
      });
  }
}
