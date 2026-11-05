import { browser } from 'wxt/browser';
import { isLocalProvider, type ProviderId, type Secrets, type Settings } from '../settings/settings';
import { createAnthropicClient } from './anthropic';
import { ProviderError } from './errors';
import { createGeminiClient } from './gemini';
import { PROVIDER_ORIGINS } from './hosts';
import { asLocalClient } from './local';
import { createOllamaClient } from './ollama';
import { createChatCompletionsClient } from './openai-compatible';
import type { ClientConfig, LlmClient } from './types';

export const PROVIDER_INFO: Record<ProviderId, { label: string; keyUrl: string | null }> = {
  gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey' },
  openai: { label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic Claude', keyUrl: 'https://console.anthropic.com/settings/keys' },
  openrouter: { label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys' },
  omp: { label: 'Oh My Pi (tài khoản trên máy)', keyUrl: null },
  ollama: { label: 'Ollama (model chạy trên máy)', keyUrl: null },
};

export const REPO_URL = 'https://github.com/Chudien-2923/vi-subtitle-extension';

/** Bridge script users run next to Oh My Pi; see bridge/omp-bridge.mjs. */
export const OMP_BRIDGE_URL = `${REPO_URL}/blob/main/bridge/omp-bridge.mjs`;

export function createClient(config: ClientConfig): LlmClient {
  const localUrl = (config.localUrl ?? '').replace(/\/+$/, '');
  if (config.provider === 'omp') {
    return asLocalClient(
      createChatCompletionsClient({ baseUrl: `${localUrl}/v1`, model: config.model }),
      'Oh My Pi bridge',
    );
  }
  if (config.provider === 'ollama') return asLocalClient(createOllamaClient(localUrl, config.model), 'Ollama');
  if (!config.apiKey) throw new ProviderError('missing-key', `No API key for ${config.provider}`);
  switch (config.provider) {
    case 'gemini':
      return createGeminiClient(config.apiKey, config.model);
    case 'anthropic':
      return createAnthropicClient(config.apiKey, config.model);
    case 'openai':
      return createChatCompletionsClient({
        baseUrl: 'https://api.openai.com/v1',
        apiKey: config.apiKey,
        model: config.model,
      });
    case 'openrouter':
      return createChatCompletionsClient({
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: config.apiKey,
        model: config.model,
        extraHeaders: { 'HTTP-Referer': REPO_URL, 'X-Title': 'CHUDIN VI SUBTITLE' },
      });
  }
}

/** Client settings for `provider` (defaults to the active one) from stored settings and keys. */
export function clientConfigFor(settings: Settings, secrets: Secrets, provider = settings.provider): ClientConfig {
  return {
    provider,
    model: settings.models[provider],
    apiKey: isLocalProvider(provider) ? undefined : secrets[provider],
    localUrl: isLocalProvider(provider) ? settings.localUrls[provider] : undefined,
  };
}

export function providerOrigins(provider: ProviderId): string[] {
  return [...PROVIDER_ORIGINS[provider]];
}

export async function hasProviderPermission(provider: ProviderId): Promise<boolean> {
  return browser.permissions.contains({ origins: providerOrigins(provider) });
}

/** Must run inside a user gesture (button click) on an extension page. */
export async function requestProviderPermission(provider: ProviderId): Promise<boolean> {
  return browser.permissions.request({ origins: providerOrigins(provider) });
}
