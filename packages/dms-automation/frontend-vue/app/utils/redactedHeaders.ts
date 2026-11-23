import { isRecord } from "./json";

/** How a stored run writes a secret header's value (see the backend's REDACTED). */
const REDACTED = "[redacted]";

/** The names in a group of a payload (headers, query) whose value is hidden. */
function redactedNames(group: unknown): string[] {
  return isRecord(group)
    ? Object.entries(group)
        .filter(([, value]) => value === REDACTED)
        .map(([name]) => name)
    : [];
}

/**
 * The headers and query parameters of a payload, typed as JSON, whose value
 * was hidden when the run was stored: a payload prefilled from such a run must
 * say so until they are replaced. A query parameter reads `?token`. Empty for a
 * payload that is not JSON or holds neither.
 */
export function redactedHeadersOf(payloadJson: string): string[] {
  try {
    const payload: unknown = JSON.parse(payloadJson || "null");
    if (!isRecord(payload)) return [];
    return [
      ...redactedNames(payload.headers),
      ...redactedNames(payload.query).map((name) => `?${name}`),
    ];
  } catch {
    return [];
  }
}
