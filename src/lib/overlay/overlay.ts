import type { Cue, Word } from '../captions/types';
import type { Appearance } from '../settings/settings';
import { SUBTITLE_CSS, subtitleVariables } from './style';
import { type EnglishLine, englishLineAt, findActiveCue, splitPhrases } from './timeline';

const HIDE_NATIVE_CAPTIONS_ID = 'chudin-vi-hide-native-captions';
const CONTROLS_OFFSET_PX = 52;
const FULLSCREEN_CONTROLS_OFFSET_PX = 72;

/** Writes one subtitle line; English words not yet spoken stay in the layout but invisible. */
export function renderLine(element: HTMLElement, text: string | EnglishLine | null): void {
  element.replaceChildren();
  if (text === null) return;
  const span = document.createElement('span');
  if (typeof text === 'string') {
    if (!text) return;
    span.textContent = text;
  } else {
    if (text.words.length === 0) return;
    text.words.forEach((word, i) => {
      if (i > 0) span.append(' ');
      const w = document.createElement('span');
      w.textContent = word;
      if (i >= text.visible) w.className = 'pending';
      span.append(w);
    });
  }
  element.append(span);
}

export interface BadgeOptions {
  error?: boolean;
  onClick?: () => void;
}

/** Bilingual subtitle layer mounted inside `#movie_player`. */
export class SubtitleOverlay {
  private readonly player: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly host: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private readonly viLine: HTMLDivElement;
  private readonly enLine: HTMLDivElement;
  private readonly badge: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly classObserver: MutationObserver;
  private readonly cleanups: Array<() => void> = [];
  private cues: Cue[] = [];
  private phrases = new Map<string, Word[][]>();
  private translations = new Map<string, string>();
  private appearance: Appearance;
  private bilingual: boolean;
  private badgeClick: (() => void) | undefined;
  private frame = 0;
  private lastKey = '';

  constructor(player: HTMLElement, video: HTMLVideoElement, appearance: Appearance, bilingual: boolean) {
    this.player = player;
    this.video = video;
    this.appearance = appearance;
    this.bilingual = bilingual;

    this.host = document.createElement('div');
    this.host.id = 'chudin-vi-subtitle';
    Object.assign(this.host.style, { position: 'absolute', inset: '0', zIndex: '41', pointerEvents: 'none' });
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = SUBTITLE_CSS;
    this.stack = document.createElement('div');
    this.stack.className = 'stack';
    this.viLine = document.createElement('div');
    this.viLine.className = 'line vi';
    this.enLine = document.createElement('div');
    this.enLine.className = 'line en';
    this.stack.append(this.viLine, this.enLine);
    this.badge = document.createElement('div');
    this.badge.className = 'badge';
    this.badge.hidden = true;
    this.badge.addEventListener('click', () => this.badgeClick?.());
    root.append(style, this.stack, this.badge);
    player.append(this.host);

    this.hideNativeCaptions(true);
    this.resizeObserver = new ResizeObserver(() => this.applyAppearance());
    this.resizeObserver.observe(player);
    this.classObserver = new MutationObserver(() => this.applyControlsOffset());
    this.classObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
    this.applyAppearance();
    this.applyControlsOffset();

    const onTimeChange = () => this.render();
    const onPlay = () => this.loop();
    for (const type of ['seeked', 'timeupdate', 'pause', 'ratechange'] as const) {
      video.addEventListener(type, onTimeChange);
      this.cleanups.push(() => video.removeEventListener(type, onTimeChange));
    }
    video.addEventListener('play', onPlay);
    this.cleanups.push(() => video.removeEventListener('play', onPlay));
    this.loop();
  }

  setCues(cues: Cue[]): void {
    this.cues = cues;
    this.phrases = new Map(cues.flatMap((c) => (c.words ? [[c.id, splitPhrases(c.words)]] : [])));
    this.invalidate();
  }

  addTranslations(entries: Array<[string, string]>): void {
    for (const [id, vi] of entries) this.translations.set(id, vi);
    this.invalidate();
  }

  setAppearance(appearance: Appearance, bilingual: boolean): void {
    this.appearance = appearance;
    this.bilingual = bilingual;
    this.applyAppearance();
    this.invalidate();
  }

  setBadge(text: string | null, options: BadgeOptions = {}): void {
    this.badge.hidden = text === null;
    this.badge.replaceChildren();
    if (text === null) return;
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = 'CHUDIN VI';
    this.badge.append(brand, text);
    this.badge.classList.toggle('error', options.error === true);
    this.badgeClick = options.onClick;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    for (const cleanup of this.cleanups) cleanup();
    this.resizeObserver.disconnect();
    this.classObserver.disconnect();
    this.hideNativeCaptions(false);
    this.host.remove();
  }

  private hideNativeCaptions(hide: boolean): void {
    document.getElementById(HIDE_NATIVE_CAPTIONS_ID)?.remove();
    if (!hide) return;
    const style = document.createElement('style');
    style.id = HIDE_NATIVE_CAPTIONS_ID;
    style.textContent = '#movie_player .ytp-caption-window-container { display: none !important; }';
    document.documentElement.append(style);
  }

  private applyAppearance(): void {
    const height = this.player.clientHeight || this.video.clientHeight || 360;
    for (const [name, value] of Object.entries(subtitleVariables(this.appearance, height))) {
      this.stack.style.setProperty(name, value);
    }
  }

  private applyControlsOffset(): void {
    const classes = this.player.classList;
    const offset = classes.contains('ytp-autohide')
      ? 0
      : classes.contains('ytp-fullscreen')
        ? FULLSCREEN_CONTROLS_OFFSET_PX
        : CONTROLS_OFFSET_PX;
    this.stack.style.setProperty('--controls-offset', `${offset}px`);
    this.stack.style.visibility = classes.contains('ad-showing') ? 'hidden' : 'visible';
  }

  private invalidate(): void {
    this.lastKey = '';
    this.render();
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      this.render();
      if (!this.video.paused && !this.video.ended) this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private render(): void {
    const timeMs = this.video.currentTime * 1000;
    const index = findActiveCue(this.cues, timeMs);
    const cue = index === -1 ? undefined : this.cues[index];
    if (!cue) {
      if (this.lastKey !== 'none') {
        renderLine(this.viLine, null);
        renderLine(this.enLine, null);
        this.lastKey = 'none';
      }
      return;
    }
    const vi = this.translations.get(cue.id) ?? null;
    // English only when the viewer asked for it; untranslated cues stay blank otherwise.
    const en = this.bilingual ? englishLineAt(cue, this.phrases.get(cue.id) ?? null, timeMs) : null;
    const key = `${cue.id}|${vi ?? ''}|${en ? `${en.words.length}:${en.visible}:${en.words[0] ?? ''}` : '-'}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    renderLine(this.viLine, vi);
    renderLine(this.enLine, en);
  }
}
