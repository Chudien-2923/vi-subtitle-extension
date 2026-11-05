export type ErrorCode =
  | 'missing-key'
  | 'invalid-key'
  | 'permission'
  | 'bad-model'
  | 'quota'
  | 'rate-limit'
  | 'server'
  | 'network'
  | 'local-offline'
  | 'helper-missing'
  | 'bad-output'
  | 'aborted';

/** Fatal errors stop the whole translation session; the rest are retried per chunk. */
export const IS_FATAL: Record<ErrorCode, boolean> = {
  'missing-key': true,
  'invalid-key': true,
  permission: true,
  'bad-model': true,
  quota: true,
  aborted: true,
  'local-offline': true,
  'helper-missing': true,
  'rate-limit': false,
  server: false,
  network: false,
  'bad-output': false,
};

export class ProviderError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | undefined;

  constructor(code: ErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * 429 bodies from Gemini and OpenAI both say "exceeded your current quota" for
 * per-minute limits too, so only daily quotas / no-credit codes count as quota.
 */
const QUOTA_429 = /insufficient_quota|PerDay/i;
const QUOTA_OTHER = /credit balance|insufficient credits|insufficient_quota/i;
const INVALID_KEY = /API[_ ]key[_ ]not[_ ]valid|API_KEY_INVALID|invalid[_ ]api[_ ]key|invalid x-api-key/i;
const BAD_MODEL = /model.*(not found|does not exist|not supported|is not a valid)|unknown model|no endpoints found/i;

/** Reads `Retry-After` (seconds) or Gemini's `"retryDelay": "36s"`. */
function parseRetryAfterMs(headers: Headers, body: string): number | undefined {
  const header = headers.get('retry-after')?.trim();
  if (header && /^\d+(\.\d+)?$/.test(header)) return Math.ceil(Number(header) * 1000);
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)?.[1];
  return delay ? Math.ceil(Number(delay) * 1000) : undefined;
}

/** Maps a failed HTTP response from any provider to a ProviderError. */
export function errorFromResponse(status: number, headers: Headers, body: string): ProviderError {
  const message = `HTTP ${status}: ${body.slice(0, 300)}`;
  if (status === 401 || status === 403 || INVALID_KEY.test(body)) {
    return new ProviderError('invalid-key', message);
  }
  if (status === 429) {
    return QUOTA_429.test(body)
      ? new ProviderError('quota', message)
      : new ProviderError('rate-limit', message, parseRetryAfterMs(headers, body));
  }
  if (status === 402 || QUOTA_OTHER.test(body)) return new ProviderError('quota', message);
  if (status === 404 || BAD_MODEL.test(body)) return new ProviderError('bad-model', message);
  if (status >= 500) return new ProviderError('server', message, parseRetryAfterMs(headers, body));
  return new ProviderError('bad-output', message);
}

/** Normalizes anything thrown during a provider call. */
export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ProviderError('aborted', 'aborted');
  }
  return new ProviderError('network', error instanceof Error ? error.message : String(error));
}
