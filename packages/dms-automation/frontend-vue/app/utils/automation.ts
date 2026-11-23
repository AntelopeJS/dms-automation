function randomUuid(): string | null {
  const cryptoApi: Partial<Crypto> | undefined = globalThis.crypto;
  return cryptoApi?.randomUUID?.() ?? null;
}

/**
 * Stable UUID for graph nodes and sentinel ids. Falls back to a short
 * pseudo-random id when crypto.randomUUID is unavailable (older browsers
 * over HTTP, jsdom in tests, …).
 */
export function newId(): string {
  return (
    randomUuid() ??
    `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
  );
}

/** What a route query holds for a key: one value, or a list for a repeated key. */
export type QueryValue = string | null | undefined | Array<string | null>;

/** A route query value as one non-empty string: the first of a list. */
export function queryString(value: QueryValue): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : null;
}
