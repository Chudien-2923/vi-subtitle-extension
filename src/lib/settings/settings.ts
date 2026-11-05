import { browser } from 'wxt/browser';
import { isRecord } from '../guards';

export const PROVIDER_IDS = ['gemini', 'openai', 'anthropic', 'openrouter', 'omp', 'ollama'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
/** Providers running on the user's machine: configured by URL, no API key. */
export const LOCAL_PROVIDER_IDS = ['omp', 'ollama'] as const;
export type LocalProviderId = (typeof LOCAL_PROVIDER_IDS)[number];
export type KeyedProviderId = Exclude<ProviderId, LocalProviderId>;
export const KEYED_PROVIDER_IDS: readonly KeyedProviderId[] = ['gemini', 'openai', 'anthropic', 'openrouter'];

export function isLocalProvider(id: ProviderId): id is LocalProviderId {
  return id === 'omp' || id === 'ollama';
}

/** Sizes are pixels at a 1080px-tall player; they scale with the real player height. */
export interface Appearance {
  viFontPx: number;
  enFontPx: number;
  viBold: boolean;
  enBold: boolean;
  viOutlinePx: number;
  enOutlinePx: number;
  viColor: string;
  enColor: string;
  /** Distance from the player bottom, percent of player height. */
  bottomPct: number;
  /** Opacity 0–1 of the dark box behind the text. */
  bgOpacity: number;
}

export interface Settings {
  enabled: boolean;
  bilingual: boolean;
  provider: ProviderId;
  models: Record<ProviderId, string>;
  localUrls: Record<LocalProviderId, string>;
  reviewPass: boolean;
  concurrency: number;
  appearance: Appearance;
}

export type Secrets = Partial<Record<KeyedProviderId, string>>;

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  bilingual: true,
  provider: 'gemini',
  models: {
    gemini: 'gemini-3.8-flash',
    openai: 'gpt-5-mini',
    anthropic: 'claude-haiku-5-5',
    openrouter: 'google/gemini-3.8-flash',
    omp: '@smol',
    ollama: 'qwen3:8b',
  },
  localUrls: {
    omp: 'http://127.0.0.1:11435',
    ollama: 'http://localhost:11434',
  },
  reviewPass: false,
  concurrency: 2,
  appearance: {
    viFontPx: 48,
    enFontPx: 28,
    viBold: false,
    enBold: true,
    viOutlinePx: 2,
    enOutlinePx: 1.6,
    viColor: '#ffffff',
    enColor: '#ffe9a8',
    bottomPct: 7,
    bgOpacity: 0,
  },
};

const SETTINGS_KEY = 'settings';
const SECRETS_KEY = 'secrets';

/** Fills missing or wrongly-typed stored fields from defaults (stored data may predate new fields). */
export function mergeSettings(stored: unknown): Settings {
  if (!isRecord(stored)) return structuredClone(DEFAULT_SETTINGS);
  const pick = <T>(source: Record<string, unknown>, fallback: T): T => {
    const out: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
    for (const [key, def] of Object.entries(out)) {
      const value = source[key];
      if (isRecord(def)) {
        out[key] = pick(isRecord(value) ? value : {}, def);
      } else if (typeof value === typeof def) {
        out[key] = value;
      }
    }
    return out as T;
  };
  const merged = pick(stored, DEFAULT_SETTINGS);
  if (!PROVIDER_IDS.includes(merged.provider)) merged.provider = DEFAULT_SETTINGS.provider;
  merged.concurrency = Math.min(4, Math.max(1, Math.round(merged.concurrency)));
  return merged;
}

export async function loadSettings(): Promise<Settings> {
  const data = await browser.storage.local.get(SETTINGS_KEY);
  return mergeSettings(data[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function updateSettings(mutate: (draft: Settings) => void): Promise<Settings> {
  const settings = await loadSettings();
  mutate(settings);
  await saveSettings(settings);
  return settings;
}

export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[SETTINGS_KEY]) {
      callback(mergeSettings(changes[SETTINGS_KEY].newValue));
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** API keys. Read only by the background worker and the options page, never by content scripts. */
export async function loadSecrets(): Promise<Secrets> {
  const data = await browser.storage.local.get(SECRETS_KEY);
  const stored = data[SECRETS_KEY];
  const secrets: Secrets = {};
  if (!isRecord(stored)) return secrets;
  for (const id of KEYED_PROVIDER_IDS) {
    const value = stored[id];
    if (typeof value === 'string' && value) secrets[id] = value;
  }
  return secrets;
}

export async function saveSecret(provider: KeyedProviderId, apiKey: string): Promise<void> {
  const secrets = await loadSecrets();
  const trimmed = apiKey.trim();
  if (trimmed) secrets[provider] = trimmed;
  else delete secrets[provider];
  await browser.storage.local.set({ [SECRETS_KEY]: secrets });
}
