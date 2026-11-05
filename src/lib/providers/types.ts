import type { ProviderId } from '../settings/settings';

/** The JSON Schema subset used for structured output; every provider accepts it. */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'integer';
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
}

export interface CompletionRequest {
  system: string;
  user: string;
  schema: JsonSchema;
  schemaName: string;
  signal?: AbortSignal;
}

export interface LlmClient {
  /** Returns the model's JSON output as text (validated by the caller). */
  complete(request: CompletionRequest): Promise<string>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}

export interface ClientConfig {
  provider: ProviderId;
  model: string;
  apiKey: string | undefined;
  /** Base URL of the user's Ollama server. */
  ollamaUrl: string | undefined;
}
