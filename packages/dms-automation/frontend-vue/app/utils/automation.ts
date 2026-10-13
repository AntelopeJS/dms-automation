/**
 * Stable UUID for graph nodes and sentinel ids. Falls back to a short
 * pseudo-random id when crypto.randomUUID is unavailable (older browsers
 * over HTTP, jsdom in tests, …).
 */
export function newId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  )
    return globalThis.crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/**
 * Backend list endpoints return one of:
 *   - a plain T[]
 *   - { results: T[] }
 *   - { items: T[] }
 * This shrinks the per-call envelope-unwrap noise.
 */
export interface ListEnvelope<T> {
  results?: T[];
  items?: T[];
}

export function unwrapList<T>(
  data: T[] | ListEnvelope<T> | null | undefined,
): T[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as ListEnvelope<T>).results))
    return (data as ListEnvelope<T>).results ?? [];
  if (data && Array.isArray((data as ListEnvelope<T>).items))
    return (data as ListEnvelope<T>).items ?? [];
  return [];
}
