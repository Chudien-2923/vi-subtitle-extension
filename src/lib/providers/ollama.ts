import { isRecord } from '../guards';
import { ProviderError } from './errors';
import { requestJson } from './http';
import type { CompletionRequest, LlmClient } from './types';

export function createOllamaClient(baseUrl: string, model: string): LlmClient {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    async complete(request: CompletionRequest) {
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
    },
    async listModels(signal) {
      const data = await requestJson(`${base}/api/tags`, { method: 'GET', headers: {}, signal });
      const models = isRecord(data) && Array.isArray(data.models) ? data.models : [];
      return models.flatMap((m) => (isRecord(m) && typeof m.name === 'string' ? [m.name] : []));
    },
  };
}
