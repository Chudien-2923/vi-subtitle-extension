import type { Appearance } from '../settings/settings';

/** Reference player height that Appearance pixel values are expressed in. */
export const REFERENCE_HEIGHT = 1080;
const MIN_FONT_PX = 11;

/** Text outline drawn as a ring of hard shadows plus a soft halo (works for any font). */
export function outlineShadow(widthPx: number): string {
  const shadows: string[] = [];
  if (widthPx > 0) {
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const x = (Math.cos(angle) * widthPx).toFixed(2);
      const y = (Math.sin(angle) * widthPx).toFixed(2);
      shadows.push(`${x}px ${y}px 0 #000`);
    }
  }
  shadows.push(`0 0 ${Math.max(2, widthPx * 2).toFixed(1)}px rgba(0,0,0,0.75)`);
  return shadows.join(', ');
}

/** CSS custom properties for a player of `playerHeight` px. */
export function subtitleVariables(appearance: Appearance, playerHeight: number): Record<string, string> {
  const scale = playerHeight / REFERENCE_HEIGHT;
  const px = (value: number) => `${Math.max(MIN_FONT_PX, value * scale).toFixed(2)}px`;
  return {
    '--vi-size': px(appearance.viFontPx),
    '--en-size': px(appearance.enFontPx),
    '--vi-weight': appearance.viBold ? '700' : '400',
    '--en-weight': appearance.enBold ? '700' : '400',
    '--vi-color': appearance.viColor,
    '--en-color': appearance.enColor,
    '--vi-shadow': outlineShadow(appearance.viOutlinePx * scale),
    '--en-shadow': outlineShadow(appearance.enOutlinePx * scale),
    '--bottom-pct': `${appearance.bottomPct}%`,
    '--bg': String(appearance.bgOpacity),
    '--gap': `${(8 * scale).toFixed(2)}px`,
  };
}

/** Shadow-root stylesheet shared by the YouTube overlay and the options preview. */
export const SUBTITLE_CSS = `
:host { all: initial; }
.stack {
  position: absolute;
  left: 50%;
  bottom: calc(var(--bottom-pct) + var(--controls-offset, 0px));
  transform: translateX(-50%);
  width: 92%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--gap);
  text-align: center;
  font-family: Arial, 'Helvetica Neue', Roboto, sans-serif;
  transition: bottom 0.15s ease;
  pointer-events: none;
}
.line { max-width: 100%; line-height: 1.25; text-wrap: balance; }
.line:empty { display: none; }
.line > span {
  background: rgba(0, 0, 0, var(--bg));
  padding: 0.05em 0.3em;
  border-radius: 0.18em;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}
.vi { font-size: var(--vi-size); font-weight: var(--vi-weight); color: var(--vi-color); text-shadow: var(--vi-shadow); }
.en { font-size: var(--en-size); font-weight: var(--en-weight); color: var(--en-color); text-shadow: var(--en-shadow); }
.en .pending { visibility: hidden; }
.badge {
  position: absolute;
  top: 12px;
  left: 12px;
  max-width: 60%;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font: 500 13px/1.35 Arial, Roboto, sans-serif;
  pointer-events: auto;
}
.badge[hidden] { display: none; }
.badge.error { background: rgba(168, 16, 26, 0.92); cursor: pointer; }
.badge .brand { font-weight: 700; margin-right: 6px; color: #ffd23f; }
`;
