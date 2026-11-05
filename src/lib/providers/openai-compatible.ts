import { isRecord } from '../guards';
import { ProviderError } from './errors';
import { requestJson } from './http';
import type { CompletionRequest, LlmClient } from './types';

/** `path` is relative to the API root, e.g. `/chat/completions`; resolves to the parsed JSON body. */
export type JsonTransport = (
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal },
) => Promise<unknown>;

export function httpTransport(baseUrl: string, headers: Record<string, string>): JsonTransport {
  return (path, init) => requestJson(`${baseUrl}${path}`, { ...init, headers });
}

/** Chat Completions API with `json_schema` output; used by OpenAI, OpenRouter and the Oh My Pi helper. */
export function createChatCompletionsClient(transport: JsonTransport, model: string): LlmClient {
  return {
    async complete(request: CompletionRequest) {
      const data = await transport('/chat/completions', {
        method: 'POST',
        signal: request.signal,
        body: {
          model,
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
      const data = await transport('/models', { method: 'GET', signal });
      const models = isRecord(data) && Array.isArray(data.data) ? data.data : [];
      return models.flatMap((m) => (isRecord(m) && typeof m.id === 'string' ? [m.id] : [])).sort();
    },
  };
}
