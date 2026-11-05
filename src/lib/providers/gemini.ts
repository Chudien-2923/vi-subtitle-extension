import { isRecord } from '../guards';
import { ProviderError } from './errors';
import { requestJson } from './http';
import type { CompletionRequest, JsonSchema, LlmClient } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini's `responseSchema` is an OpenAPI subset: upper-case types, no `additionalProperties`. */
function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  return out;
}

export function createGeminiClient(apiKey: string, model: string): LlmClient {
  const headers = { 'x-goog-api-key': apiKey };
  const modelId = model.replace(/^models\//, '');
  return {
    async complete(request: CompletionRequest) {
      const data = await requestJson(`${BASE}/models/${encodeURIComponent(modelId)}:generateContent`, {
        method: 'POST',
        headers,
        signal: request.signal,
        body: {
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(request.schema),
          },
        },
      });
      const candidate = isRecord(data) && Array.isArray(data.candidates) ? data.candidates[0] : undefined;
      const content = isRecord(candidate) ? candidate.content : undefined;
      const parts = isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
      const text = parts
        .filter((p): p is Record<string, unknown> => isRecord(p) && p.thought !== true)
        .map((p) => (typeof p.text === 'string' ? p.text : ''))
        .join('');
      if (!text) {
        const reason = isRecord(candidate) ? candidate.finishReason : undefined;
        throw new ProviderError('bad-output', `Gemini returned no text (${String(reason ?? 'no candidate')})`);
      }
      return text;
    },
    async listModels(signal) {
      const data = await requestJson(`${BASE}/models?pageSize=1000`, { method: 'GET', headers, signal });
      const models = isRecord(data) && Array.isArray(data.models) ? data.models : [];
      return models
        .filter(
          (m): m is Record<string, unknown> =>
            isRecord(m) &&
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent'),
        )
        .map((m) => String(m.name).replace(/^models\//, ''));
    },
  };
}
