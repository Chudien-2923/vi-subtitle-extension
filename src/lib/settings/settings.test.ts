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
