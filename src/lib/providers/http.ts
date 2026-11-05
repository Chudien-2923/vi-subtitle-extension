import { errorFromResponse, toProviderError } from './errors';

/** Fetches JSON; non-2xx responses and transport failures become ProviderError. */
export async function requestJson(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown; signal?: AbortSignal },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.body === undefined ? init.headers : { 'content-type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (error) {
    throw toProviderError(error);
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) throw errorFromResponse(response.status, response.headers, text);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw errorFromResponse(response.status, response.headers, `invalid JSON response: ${text}`);
  }
}
