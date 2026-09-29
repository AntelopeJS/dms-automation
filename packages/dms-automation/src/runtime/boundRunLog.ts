import type { LogEntry, RunLog } from "../types/runLog";

/**
 * Budgets for what a single run persists. A run is stored as one document, so
 * an unbounded log or payload (a long foreach, a large webhook body) can exceed
 * the database's document size limit (16 MB on MongoDB) — the insert then
 * fails and the run leaves no record at all. These keep the document well
 * below that limit. They are a product choice, not a hard constraint.
 */
export const MAX_LOG_ENTRIES = 2000;
export const MAX_LOG_BYTES = 4 * 1024 * 1024;
export const MAX_TRIGGER_PAYLOAD_BYTES = 256 * 1024;

/** Characters of an oversized payload kept as a preview in its marker. */
const TRIGGER_PAYLOAD_PREVIEW_CHARS = 4096;

/**
 * Serialized size of a value in bytes, as an estimate of its stored size.
 * Values JSON can't encode (circular structures) count as over budget.
 */
function byteSize(value: unknown): number {
  try {
    const json = JSON.stringify(value, (_key, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    return json === undefined ? 0 : Buffer.byteLength(json);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Cap the persisted log at MAX_LOG_ENTRIES entries and MAX_LOG_BYTES. Entries
 * are kept in order up to the first one that doesn't fit; the rest are
 * dropped, counted in `truncated`, and announced by a final warn entry. The
 * fire tree is kept whole (the UI needs it to place entries) and its size
 * counts against the byte budget. A log within budget is returned unchanged.
 */
export function boundRunLog(log: RunLog): RunLog {
  const entrySizes = log.entries.map(byteSize);
  const entriesBytes = entrySizes.reduce((a, b) => a + b, 0);
  const firesBytes = byteSize(log.fires);
  if (
    log.entries.length <= MAX_LOG_ENTRIES &&
    firesBytes + entriesBytes <= MAX_LOG_BYTES
  ) {
    return log;
  }

  // Leave room for the truncation notice itself.
  const maxKept = MAX_LOG_ENTRIES - 1;
  let budget = MAX_LOG_BYTES - firesBytes - 1024;
  const kept: LogEntry[] = [];
  for (const [i, entry] of log.entries.entries()) {
    const size = entrySizes[i] ?? 0;
    if (kept.length >= maxKept || size > budget) break;
    kept.push(entry);
    budget -= size;
  }

  const dropped = log.entries.length - kept.length;
  const rootFire = log.fires.find((f) => f.parentFireId === null);
  const last = kept.at(-1);
  // reduce, not Math.max(...spread): an oversized log is exactly the case
  // where spreading every seq could exceed the engine's argument limit.
  const maxSeq = [...log.entries, ...log.fires].reduce(
    (max, e) => Math.max(max, e.seq),
    -1,
  );
  kept.push({
    fireId: rootFire?.id ?? last?.fireId ?? "",
    ts: last?.ts ?? 0,
    seq: maxSeq + 1,
    level: "warn",
    source: "exec",
    message: `log truncated: ${dropped} entries dropped`,
  });
  return { fires: log.fires, entries: kept, truncated: dropped };
}

/**
 * Serialize a trigger payload for storage. A payload over
 * MAX_TRIGGER_PAYLOAD_BYTES is replaced by a JSON marker carrying its original
 * size and a short preview, so the stored value stays valid JSON.
 */
export function serializeTriggerPayload(payload: unknown): string {
  const json = JSON.stringify(payload ?? null);
  const bytes = Buffer.byteLength(json);
  if (bytes <= MAX_TRIGGER_PAYLOAD_BYTES) return json;
  return JSON.stringify({
    truncated: true,
    originalBytes: bytes,
    preview: json.slice(0, TRIGGER_PAYLOAD_PREVIEW_CHARS),
  });
}
