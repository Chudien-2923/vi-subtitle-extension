import { browser } from 'wxt/browser';
import { isLocalProvider, type ProviderId, type Secrets, type Settings } from '../settings/settings';
import { createAnthropicClient } from './anthropic';
import { ProviderError } from './errors';
import { createGeminiClient } from './gemini';
import { PROVIDER_ORIGINS } from './hosts';
import { asLocalClient } from './local';
import { ompTransport } from './native';
import { createOllamaClient } from './ollama';
import { createChatCompletionsClient, httpTransport } from './openai-compatible';
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

/** One-time setup of the Oh My Pi helper (macOS / Linux); see bridge/install.sh. */
export function ompInstallCommand(extensionId: string): string {
  const url = 'https://raw.githubusercontent.com/Chudien-2923/vi-subtitle-extension/main/bridge/install.sh';
  return `curl -fsSL ${url} | sh -s -- ${extensionId}`;
}

export function createClient(config: ClientConfig): LlmClient {
  if (config.provider === 'omp') {
    return createChatCompletionsClient((path, init) => ompTransport(`/v1${path}`, init), config.model);
  }
  if (config.provider === 'ollama') {
    return asLocalClient(createOllamaClient((config.ollamaUrl ?? '').replace(/\/+$/, ''), config.model), 'Ollama');
  }
  if (!config.apiKey) throw new ProviderError('missing-key', `No API key for ${config.provider}`);
  switch (config.provider) {
    case 'gemini':
      return createGeminiClient(config.apiKey, config.model);
    case 'anthropic':
      return createAnthropicClient(config.apiKey, config.model);
    case 'openai':
      return createChatCompletionsClient(
        httpTransport('https://api.openai.com/v1', { authorization: `Bearer ${config.apiKey}` }),
        config.model,
      );
    case 'openrouter':
      return createChatCompletionsClient(
        httpTransport('https://openrouter.ai/api/v1', {
          authorization: `Bearer ${config.apiKey}`,
          'HTTP-Referer': REPO_URL,
          'X-Title': 'CHUDIN VI SUBTITLE',
        }),
        config.model,
      );
  }
}

/** Client settings for `provider` (defaults to the active one) from stored settings and keys. */
export function clientConfigFor(settings: Settings, secrets: Secrets, provider = settings.provider): ClientConfig {
  return {
    provider,
    model: settings.models[provider],
    apiKey: isLocalProvider(provider) ? undefined : secrets[provider],
    ollamaUrl: provider === 'ollama' ? settings.ollamaUrl : undefined,
  };
}

export function providerOrigins(provider: ProviderId): string[] {
  return [...PROVIDER_ORIGINS[provider]];
}

/** Oh My Pi talks to its helper via native messaging, which needs no host permission. */
export async function hasProviderPermission(provider: ProviderId): Promise<boolean> {
  const origins = providerOrigins(provider);
  return origins.length === 0 || browser.permissions.contains({ origins });
}

/** Must run inside a user gesture (button click) on an extension page. */
export async function requestProviderPermission(provider: ProviderId): Promise<boolean> {
  const origins = providerOrigins(provider);
  return origins.length === 0 || browser.permissions.request({ origins });
}
