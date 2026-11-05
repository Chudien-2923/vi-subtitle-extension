import { isRecord } from '../guards';
import { ProviderError } from './errors';
import { requestJson } from './http';
import type { CompletionRequest, LlmClient } from './types';

const BASE = 'https://api.anthropic.com/v1';

/** Structured output through a forced tool call. */
export function createAnthropicClient(apiKey: string, model: string): LlmClient {
  const headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Required for requests carrying an extension Origin header.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  return {
    async complete(request: CompletionRequest) {
      const data = await requestJson(`${BASE}/messages`, {
        method: 'POST',
        headers,
        signal: request.signal,
        body: {
          model,
          max_tokens: 8192,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
          tools: [
            {
              name: request.schemaName,
              description: 'Submit the result in the required structure.',
              input_schema: request.schema,
            },
          ],
          tool_choice: { type: 'tool', name: request.schemaName },
        },
      });
      if (isRecord(data) && data.stop_reason === 'max_tokens') {
        throw new ProviderError('bad-output', 'Output truncated (max_tokens)');
      }
      const blocks = isRecord(data) && Array.isArray(data.content) ? data.content : [];
      const toolUse = blocks.find((b) => isRecord(b) && b.type === 'tool_use');
      if (!isRecord(toolUse) || !isRecord(toolUse.input)) {
        throw new ProviderError('bad-output', 'Claude returned no tool call');
      }
      return JSON.stringify(toolUse.input);
    },
    async listModels(signal) {
      const data = await requestJson(`${BASE}/models?limit=1000`, { method: 'GET', headers, signal });
      const models = isRecord(data) && Array.isArray(data.data) ? data.data : [];
      return models.flatMap((m) => (isRecord(m) && typeof m.id === 'string' ? [m.id] : []));
    },
  };
}
