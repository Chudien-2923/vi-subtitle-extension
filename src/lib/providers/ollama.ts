import { isRecord } from '../guards';
import { ProviderError } from './errors';
import { requestJson } from './http';
import type { CompletionRequest, LlmClient } from './types';

/**
 * Ollama answers 403 to origins outside OLLAMA_ORIGINS; that is a setup
 * problem on the user's machine, not a bad key.
 */
async function withOriginHint<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'invalid-key') {
      throw new ProviderError('permission', `Ollama rejected the extension origin: ${error.message}`);
    }
    throw error;
  }
}

export function createOllamaClient(baseUrl: string, model: string): LlmClient {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    complete(request: CompletionRequest) {
      return withOriginHint(async () => {
        const data = await requestJson(`${base}/api/chat`, {
          method: 'POST',
          headers: {},
          signal: request.signal,
          body: {
            model,
            stream: false,
            format: request.schema,
            options: { temperature: 0.3 },
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
          },
        });
        const message = isRecord(data) ? data.message : undefined;
        const content = isRecord(message) ? message.content : undefined;
        if (typeof content !== 'string' || !content) {
          throw new ProviderError('bad-output', 'Ollama returned no content');
        }
        return content;
      });
    },
    listModels(signal) {
      return withOriginHint(async () => {
        const data = await requestJson(`${base}/api/tags`, { method: 'GET', headers: {}, signal });
        const models = isRecord(data) && Array.isArray(data.models) ? data.models : [];
        return models.flatMap((m) => (isRecord(m) && typeof m.name === 'string' ? [m.name] : []));
      });
    },
  };
}
