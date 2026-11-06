import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings } from './settings';

describe('mergeSettings', () => {
  it('returns defaults for missing or corrupt data', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings('oops')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored values and fills fields added in newer versions', () => {
    const merged = mergeSettings({
      provider: 'openai',
      models: { openai: 'my-model' },
      appearance: { viFontPx: 60 },
    });
    expect(merged.provider).toBe('openai');
    expect(merged.models.openai).toBe('my-model');
    expect(merged.models.gemini).toBe(DEFAULT_SETTINGS.models.gemini);
    expect(merged.appearance.viFontPx).toBe(60);
    expect(merged.appearance.enFontPx).toBe(DEFAULT_SETTINGS.appearance.enFontPx);
  });

  it('rejects wrongly typed and unknown values', () => {
    const merged = mergeSettings({ provider: 'skynet', enabled: 'yes', concurrency: 99 });
    expect(merged.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(merged.enabled).toBe(DEFAULT_SETTINGS.enabled);
    expect(merged.concurrency).toBe(4);
  });

  it('does not share nested objects with the defaults', () => {
    const merged = mergeSettings({});
    merged.appearance.viFontPx = 1;
    expect(DEFAULT_SETTINGS.appearance.viFontPx).toBe(48);
  });
});

describe('mergeSettings voiceover', () => {
  it('adds a disabled Hải Đăng voiceover to settings saved before the feature existed', () => {
    const merged = mergeSettings({ provider: 'openai', appearance: { viFontPx: 60 } });
    expect(merged.voiceover).toEqual({ enabled: false, voice: 'Hải Đăng', volume: 1, originalVolume: 0.2 });
    expect(merged.provider).toBe('openai');
  });

  it('keeps valid stored values and fills the rest of a partial voiceover object', () => {
    const merged = mergeSettings({ voiceover: { enabled: true, voice: '  Ngọc Huyền ', volume: 0.5 } });
    expect(merged.voiceover).toEqual({ enabled: true, voice: 'Ngọc Huyền', volume: 0.5, originalVolume: 0.2 });
  });

  it('clamps out-of-range volumes and replaces non-finite ones', () => {
    const merged = mergeSettings({ voiceover: { volume: 7, originalVolume: -3 } });
    expect(merged.voiceover.volume).toBe(1);
    expect(merged.voiceover.originalVolume).toBe(0);
    // NaN passes a typeof check, so it must be caught explicitly.
    expect(mergeSettings({ voiceover: { volume: Number.NaN } }).voiceover.volume).toBe(1);
    const infinite = mergeSettings({ voiceover: { originalVolume: Number.POSITIVE_INFINITY } });
    expect(infinite.voiceover.originalVolume).toBe(DEFAULT_SETTINGS.voiceover.originalVolume);
  });

  it('falls back to the default voice for blank or oversized names', () => {
    expect(mergeSettings({ voiceover: { voice: '   ' } }).voiceover.voice).toBe('Hải Đăng');
    expect(mergeSettings({ voiceover: { voice: 'x'.repeat(65) } }).voiceover.voice).toBe('Hải Đăng');
  });

  it('ignores a voiceover value that is not an object', () => {
    expect(mergeSettings({ voiceover: 'on' }).voiceover).toEqual(DEFAULT_SETTINGS.voiceover);
    expect(mergeSettings({ voiceover: { enabled: 'true', voice: 42 } }).voiceover).toEqual(DEFAULT_SETTINGS.voiceover);
  });
});
