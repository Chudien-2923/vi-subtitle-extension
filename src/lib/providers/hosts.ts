/** Origins each provider needs. Requested at runtime via `chrome.permissions.request`. */
export const PROVIDER_ORIGINS = {
  gemini: ['https://generativelanguage.googleapis.com/*'],
  openai: ['https://api.openai.com/*'],
  anthropic: ['https://api.anthropic.com/*'],
  openrouter: ['https://openrouter.ai/*'],
  ollama: ['http://localhost/*', 'http://127.0.0.1/*'],
} as const;

export const PROVIDER_HOST_PERMISSIONS: readonly string[] = Object.values(PROVIDER_ORIGINS).flat();
