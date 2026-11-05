/** Canonical plain-object guard for untrusted data (storage, network, postMessage). Fields stay `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
