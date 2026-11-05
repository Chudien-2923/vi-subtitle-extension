import { describe, expect, it } from 'vitest';
import { IS_FATAL, ProviderError } from './errors';
import { asLocalClient } from './local';
import type { LlmClient } from './types';

const failing = (error: ProviderError): LlmClient => ({
  complete: async () => {
    throw error;
  },
  listModels: async () => {
    throw error;
  },
});

const request = { system: '', user: '', schema: { type: 'object' as const }, schemaName: 's' };

describe('asLocalClient', () => {
  it('turns "nothing listening" into a fatal, actionable local-offline error', async () => {
    const client = asLocalClient(failing(new ProviderError('network', 'Failed to fetch')), 'Ollama');
    await expect(client.complete(request)).rejects.toMatchObject({ code: 'local-offline' });
    await expect(client.listModels()).rejects.toMatchObject({ code: 'local-offline' });
    expect(IS_FATAL['local-offline']).toBe(true);
  });

  it('reports a rejected origin as a permission problem, not a bad key', async () => {
    const client = asLocalClient(failing(new ProviderError('invalid-key', 'HTTP 403')), 'Ollama');
    await expect(client.complete(request)).rejects.toMatchObject({ code: 'permission' });
  });

  it('passes other errors through unchanged', async () => {
    const original = new ProviderError('bad-model', 'HTTP 404');
    await expect(asLocalClient(failing(original), 'Ollama').complete(request)).rejects.toBe(original);
  });
});
