import { isRecord } from '../guards';
import { ProviderError } from './errors';
import { requestJson } from './http';
import type { CompletionRequest, LlmClient } from './types';

/** Chat Completions API with `json_schema` output; used by OpenAI and OpenRouter. */
export function createChatCompletionsClient(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}): LlmClient {
  const headers = { authorization: `Bearer ${options.apiKey}`, ...options.extraHeaders };
  return {
    async complete(request: CompletionRequest) {
      const data = await requestJson(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: request.signal,
        body: {
          model: options.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: request.schemaName, strict: true, schema: request.schema },
          },
        },
      });
      const choice = isRecord(data) && Array.isArray(data.choices) ? data.choices[0] : undefined;
      const message = isRecord(choice) ? choice.message : undefined;
      if (isRecord(message) && typeof message.refusal === 'string' && message.refusal) {
        throw new ProviderError('bad-output', `Model refused: ${message.refusal}`);
      }
      const content = isRecord(message) ? message.content : undefined;
      if (typeof content !== 'string' || !content) {
        throw new ProviderError('bad-output', 'Model returned no content');
      }
      return content;
    },
    async listModels(signal) {
      const data = await requestJson(`${options.baseUrl}/models`, { method: 'GET', headers, signal });
      const models = isRecord(data) && Array.isArray(data.data) ? data.data : [];
      return models.flatMap((m) => (isRecord(m) && typeof m.id === 'string' ? [m.id] : [])).sort();
    },
  };
}
