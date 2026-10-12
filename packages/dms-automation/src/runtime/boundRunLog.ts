import type { FireNode, LogEntry, RunLog } from "../types/runLog";

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
 * The order entries are kept in when a log is over budget: its errors first
 * (the failure must survive), then its start and its end, taken in turn, so
 * what is dropped is the middle of the run (typically the repeated iterations
 * of a long loop).
 */
function keepOrder(entries: readonly LogEntry[]): number[] {
  const errors = entries.flatMap((e, i) => (e.level === "error" ? [i] : []));
  const order = [...errors];
  let head = 0;
  let tail = entries.length - 1;
  while (head <= tail) {
    order.push(head++);
    if (head <= tail) order.push(tail--);
  }
  return order;
}

/**
 * Cap the persisted log at MAX_LOG_ENTRIES entries and MAX_LOG_BYTES. Every
 * error entry is kept, then the start and the end of the run; the middle is
 * dropped, counted in `truncated`, and announced by a final warn entry. Only
 * the fires the kept entries hang from (with their ancestors) are kept, and
 * they count against the byte budget: a loop of many iterations otherwise
 * stores a fire per iteration. A log within budget is returned unchanged.
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

  const fireById = new Map(log.fires.map((f) => [f.id, f]));
  const keptFires = new Set<string>();
  // The fires an entry needs that are not kept yet: its own and its ancestors.
  const missingFires = (fireId: string): FireNode[] => {
    const chain: FireNode[] = [];
    let fire = fireById.get(fireId);
    while (fire && !keptFires.has(fire.id)) {
      chain.push(fire);
      fire = fire.parentFireId ? fireById.get(fire.parentFireId) : undefined;
    }
    return chain;
  };

  const rootFire = log.fires.find((f) => f.parentFireId === null);
  // Leave room for the truncation notice itself.
  const maxKept = MAX_LOG_ENTRIES - 1;
  let budget = MAX_LOG_BYTES - 1024;
  if (rootFire) {
    keptFires.add(rootFire.id);
    budget -= byteSize(rootFire);
  }
  const keptIndexes = new Set<number>();
  for (const i of keepOrder(log.entries)) {
    if (keptIndexes.size >= maxKept) break;
    const entry = log.entries[i];
    if (!entry || keptIndexes.has(i)) continue;
    const fires = missingFires(entry.fireId);
    const size =
      (entrySizes[i] ?? 0) + fires.reduce((a, f) => a + byteSize(f), 0);
    // An entry too large for what is left is dropped; smaller ones still fit.
    if (size > budget) continue;
    keptIndexes.add(i);
    for (const f of fires) keptFires.add(f.id);
    budget -= size;
  }

  const kept = log.entries.filter((_, i) => keptIndexes.has(i));
  const dropped = log.entries.length - kept.length;
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
  return {
    fires: log.fires.filter((f) => keptFires.has(f.id)),
    entries: kept,
    truncated: dropped,
  };
}

/** The value a credential is stored and shown with. */
export const REDACTED = "[redacted]";

// Header and query parameter names whose value is a credential: these names,
// and any name matching the pattern (a token, a signature, an HMAC, a key…).
const SENSITIVE_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "auth",
  "key",
  "sig",
]);
const SENSITIVE_NAME_PATTERN =
  /token|secret|signature|hmac|passw(or)?d|session|api[-_]?key|access[-_]?key|^x-auth|[-_]key$/i;

/** More names the project marks as credentials (`runs.sensitiveNames`). */
let projectNames: string[] = [];

/**
 * Add the project's own credential names (`runs.sensitiveNames`): a header or
 * query parameter whose name contains one of them is redacted too.
 */
export function configureRedaction(names: readonly string[] | undefined): void {
  projectNames = (names ?? [])
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A header or query parameter that carries a credential: its value is never
 * stored, shown or replayed.
 */
export function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    SENSITIVE_NAMES.has(lower) ||
    SENSITIVE_NAME_PATTERN.test(lower) ||
    projectNames.some((n) => lower.includes(n))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * A copy of a set of headers (or query parameters) with the value of each
 * secret one replaced by {@link REDACTED}; anything but a plain object comes
 * back as it is.
 */
export function redactHeaders(headers: unknown): unknown {
  if (!isRecord(headers)) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSensitiveHeader(name) ? REDACTED : value,
    ]),
  );
}

/**
 * A trigger payload as it is stored and shown: the headers and query
 * parameters a webhook received keep their names, but not the value of a
 * credential (Authorization, Cookie, ?token=…). The run itself received them
 * in full.
 */
function redactPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  const redacted = { ...payload };
  if ("headers" in payload) redacted.headers = redactHeaders(payload.headers);
  if ("query" in payload) redacted.query = redactHeaders(payload.query);
  return redacted;
}

/** `text` as a regular expression matching it literally. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A database regular expression matching a stored payload whose headers or
 * query parameters hold a credential (see {@link isSensitiveHeader}) with any
 * value but {@link REDACTED}: one stored before it was redacted.
 */
export function clearCredentialPattern(): string {
  const project = projectNames.map(
    (n) => String.raw`|[^"]*${escapeRegex(n)}[^"]*`,
  );
  const name = String.raw`(authorization|proxy-authorization|cookie|set-cookie|auth|key|sig|x-auth[^"]*|[^"]*(token|secret|signature|hmac|passw(or)?d|session|api[-_]?key|access[-_]?key)[^"]*|[^"]*[-_]key${project.join("")})`;
  return String.raw`(?i)"(headers|query)":\{[^{}]*"${name}":(?!"\[redacted\]")`;
}

/** Shorter values are too common to be told from other text. */
const MIN_SECRET_LENGTH = 6;

// The forms a credential is copied in: whole, its token after the scheme
// ("Bearer <token>"), and each value of a cookie ("a=<value>; b=<value>").
function secretForms(value: string): string[] {
  const forms = [value, value.split(" ").at(-1) ?? ""];
  for (const pair of value.split(";")) forms.push(pair.split("=")[1] ?? "");
  return forms.map((f) => f.trim());
}

/** The string values of the credentials in a set of headers or parameters. */
function credentialValues(group: unknown): string[] {
  if (!isRecord(group)) return [];
  return Object.entries(group)
    .filter(([name]) => isSensitiveHeader(name))
    .flatMap(([, value]) => [value].flat())
    .filter((value): value is string => typeof value === "string");
}

/**
 * The credentials a trigger payload carries, in every form a step may have
 * copied them in, so they can be scrubbed from what the run logged.
 */
export function secretsOf(payload: unknown): string[] {
  if (!isRecord(payload)) return [];
  const forms = [payload.headers, payload.query]
    .flatMap(credentialValues)
    .flatMap(secretForms)
    .filter((form) => form.length >= MIN_SECRET_LENGTH && form !== REDACTED);
  // Longest first, so a whole value goes before the token inside it.
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
}

/**
 * `value` with every occurrence of the given secrets replaced by
 * {@link REDACTED}, in its strings at any depth (a step's inputs and output, a
 * log message). Returned as it is when there is no secret.
 */
export function scrubSecrets<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") {
      return secrets.reduce((text, s) => text.replaceAll(s, REDACTED), v);
    }
    if (Array.isArray(v)) return v.map(scrub);
    if (isRecord(v)) {
      return Object.fromEntries(
        Object.entries(v).map(([k, item]) => [k, scrub(item)]),
      );
    }
    return v;
  };
  return scrub(value) as T;
}

/**
 * The credentials a stored payload still holds in clear: those of a run
 * stored before payloads were redacted, to scrub from its log when it is
 * read.
 */
export function storedSecretsOf(stored: string | undefined): string[] {
  try {
    return secretsOf(stored ? JSON.parse(stored) : null);
  } catch {
    return [];
  }
}

/**
 * Serialize a trigger payload for storage, its secret headers redacted. A
 * payload over MAX_TRIGGER_PAYLOAD_BYTES is replaced by a JSON marker carrying
 * its original size and a short preview, so the stored value stays valid JSON.
 */
export function serializeTriggerPayload(payload: unknown): string {
  const json = JSON.stringify(redactPayload(payload) ?? null);
  const bytes = Buffer.byteLength(json);
  if (bytes <= MAX_TRIGGER_PAYLOAD_BYTES) return json;
  return JSON.stringify({
    truncated: true,
    originalBytes: bytes,
    preview: json.slice(0, TRIGGER_PAYLOAD_PREVIEW_CHARS),
  });
}

/** A stored trigger payload, read back: the payload, or the marker of one too large to keep. */
export type StoredPayload =
  | { kept: true; payload: unknown }
  | { kept: false; originalBytes: number };

/**
 * Read a payload stored by {@link serializeTriggerPayload}, its credentials
 * redacted: a payload stored before they were is redacted on read, for the
 * trace, a re-run and Run now alike.
 */
export function readTriggerPayload(stored: string | undefined): StoredPayload {
  let parsed: unknown = null;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    return { kept: true, payload: stored };
  }
  const marker = parsed as { truncated?: unknown; originalBytes?: unknown };
  if (
    marker &&
    typeof marker === "object" &&
    marker.truncated === true &&
    typeof marker.originalBytes === "number"
  ) {
    return { kept: false, originalBytes: marker.originalBytes };
  }
  return { kept: true, payload: redactPayload(parsed) };
}

/**
 * A stored payload as it may be shown: one stored before credentials were
 * redacted is redacted now. A marker or a value that is not JSON comes back as
 * it is.
 */
export function redactStoredPayload(
  stored: string | undefined,
): string | undefined {
  const read = readTriggerPayload(stored);
  if (!read.kept || !stored) return stored;
  try {
    JSON.parse(stored);
  } catch {
    return stored;
  }
  return JSON.stringify(read.payload ?? null);
}

/** The fields of a stored run that may hold a credential it received. */
export interface StoredRunSecrets {
  triggerPayload?: string;
  errorMessage?: string;
  logs?: RunLog;
}

/**
 * The fields of a run stored before credentials were redacted, rewritten
 * without them: its payload redacted, and the values its payload holds in
 * clear scrubbed from its error and its log. `undefined` when there is
 * nothing to rewrite, so a second pass changes nothing.
 */
export function redactedStoredRun(
  run: StoredRunSecrets,
): StoredRunSecrets | undefined {
  const triggerPayload = redactStoredPayload(run.triggerPayload);
  const secrets = storedSecretsOf(run.triggerPayload);
  if (triggerPayload === run.triggerPayload && secrets.length === 0) {
    return undefined;
  }
  return {
    triggerPayload,
    errorMessage: scrubSecrets(run.errorMessage, secrets),
    logs: scrubSecrets(run.logs, secrets),
  };
}
