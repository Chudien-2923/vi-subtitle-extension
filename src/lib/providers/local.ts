import { ProviderError } from './errors';
import type { LlmClient } from './types';

function translate(error: unknown, service: string): unknown {
  if (!(error instanceof ProviderError)) return error;
  // Nothing listening on localhost: a setup problem, not worth retrying for a minute.
  if (error.code === 'network')
    return new ProviderError('local-offline', `${service} is not reachable: ${error.message}`);
  // Local servers answer 403 to origins they do not allow (e.g. OLLAMA_ORIGINS).
  if (error.code === 'invalid-key')
    return new ProviderError('permission', `${service} rejected the extension: ${error.message}`);
  return error;
}

/** Maps transport/403 failures of a server on the user's machine to actionable errors. */
export function asLocalClient(client: LlmClient, service: string): LlmClient {
  return {
    async complete(request) {
      try {
        return await client.complete(request);
      } catch (error) {
        throw translate(error, service);
      }
    },
    async listModels(signal) {
      try {
        return await client.listModels(signal);
      } catch (error) {
        throw translate(error, service);
      }
    },
  };
}
