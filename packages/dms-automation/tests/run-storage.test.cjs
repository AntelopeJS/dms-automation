const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  DatumStaticMetadata,
  getMetadata,
} = require("@antelopejs/interface-database-decorators");
const {
  MAX_LOG_BYTES,
  MAX_LOG_ENTRIES,
  MAX_TRIGGER_PAYLOAD_BYTES,
  boundRunLog,
  serializeTriggerPayload,
} = require("../dist/runtime/boundRunLog.js");
const { ProcedureRun } = require("../dist/db/tables/procedure_run.table.js");

const ROOT = {
  id: "f0",
  parentFireId: null,
  sourceNodeId: "t",
  port: null,
  ts: 0,
  seq: 0,
};

function entry(seq, message = `m${seq}`, value) {
  const e = {
    fireId: "f0",
    ts: seq,
    seq,
    level: "info",
    source: "exec",
    message,
  };
  if (value !== undefined) e.value = value;
  return e;
}

function entries(n, value) {
  return Array.from({ length: n }, (_, i) => entry(i + 1, undefined, value));
}

test("procedure_runs indexes serve the startedAt sort and per-procedure history", () => {
  const { indexes } = getMetadata(ProcedureRun, DatumStaticMetadata);
  assert.deepEqual(indexes.startedAt, ["startedAt"]);
  // Order matters: equality on procedureId first, then the sort key.
  assert.deepEqual(indexes.procedureId_startedAt, ["procedureId", "startedAt"]);
  assert.equal(indexes.procedureId, undefined);
});

test("a log within budget is returned unchanged", () => {
  const log = { fires: [ROOT], entries: entries(MAX_LOG_ENTRIES) };
  assert.equal(boundRunLog(log), log);
});

test("too many entries are cut to the entry budget with a notice", () => {
  const total = MAX_LOG_ENTRIES + 500;
  const bounded = boundRunLog({ fires: [ROOT], entries: entries(total) });

  assert.equal(bounded.entries.length, MAX_LOG_ENTRIES);
  assert.equal(bounded.truncated, total - (MAX_LOG_ENTRIES - 1));
  // Head entries are kept in order.
  assert.deepEqual(
    bounded.entries.slice(0, 3).map((e) => e.seq),
    [1, 2, 3],
  );
  const notice = bounded.entries.at(-1);
  assert.equal(notice.level, "warn");
  assert.equal(notice.source, "exec");
  assert.equal(notice.fireId, "f0");
  assert.equal(notice.seq, total + 1);
  assert.match(
    notice.message,
    new RegExp(`${bounded.truncated} entries dropped`),
  );
  assert.deepEqual(bounded.fires, [ROOT]);
});

test("large entry values are cut to the byte budget", () => {
  const big = "x".repeat(64 * 1024);
  const log = { fires: [ROOT], entries: entries(200, big) };
  const bounded = boundRunLog(log);

  assert.ok(bounded.truncated > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= MAX_LOG_BYTES);
  assert.equal(bounded.entries.length, 200 - bounded.truncated + 1);
});

test("an unserializable value counts as over budget instead of throwing", () => {
  const circular = {};
  circular.self = circular;
  const log = {
    fires: [ROOT],
    entries: [entry(1), entry(2, "loop", circular), entry(3)],
  };
  const bounded = boundRunLog(log);

  assert.deepEqual(
    bounded.entries.map((e) => e.message),
    ["m1", "log truncated: 2 entries dropped"],
  );
});

test("a trigger payload within budget is stored as plain JSON", () => {
  assert.equal(serializeTriggerPayload({ a: 1 }), '{"a":1}');
  assert.equal(serializeTriggerPayload(undefined), "null");
});

test("an oversized trigger payload is replaced by a JSON marker", () => {
  const payload = { body: "y".repeat(MAX_TRIGGER_PAYLOAD_BYTES) };
  const stored = serializeTriggerPayload(payload);
  const marker = JSON.parse(stored);

  assert.equal(marker.truncated, true);
  assert.equal(
    marker.originalBytes,
    Buffer.byteLength(JSON.stringify(payload)),
  );
  assert.ok(stored.length < MAX_TRIGGER_PAYLOAD_BYTES);
  assert.ok(marker.preview.startsWith('{"body":"yyy'));
});
