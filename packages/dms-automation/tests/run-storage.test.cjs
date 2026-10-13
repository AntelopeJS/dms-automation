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
  REDACTED,
  boundRunLog,
  clearCredentialPattern,
  configureRedaction,
  isSensitiveHeader,
  readTriggerPayload,
  redactStoredPayload,
  redactedStoredRun,
  scrubSecrets,
  secretsOf,
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
    ["m1", "m3", "log truncated: 1 entries dropped"],
  );
});

test("an oversized log keeps its errors, its start and its end", () => {
  const total = MAX_LOG_ENTRIES * 2;
  const log = { fires: [ROOT], entries: entries(total) };
  log.entries[total / 2].level = "error";
  log.entries[total / 2].message = "boom";
  const bounded = boundRunLog(log);
  const seqs = bounded.entries.map((e) => e.seq);

  assert.equal(bounded.entries.length, MAX_LOG_ENTRIES);
  // The failure in the middle survives, so does the end of the run.
  assert.ok(seqs.includes(total / 2 + 1));
  assert.ok(seqs.includes(total));
  assert.ok(seqs.includes(1));
  // Entries stay in the order they were written, the notice last.
  assert.deepEqual(
    seqs.slice(0, -1),
    seqs.slice(0, -1).sort((a, b) => a - b),
  );
  assert.match(bounded.entries.at(-1).message, /entries dropped/);
});

test("an oversized log keeps only the fires its kept entries hang from", () => {
  // One fire per iteration, under the root, one entry each: a long loop.
  const total = MAX_LOG_ENTRIES * 3;
  const fires = [ROOT];
  const log = { fires, entries: [] };
  for (let i = 1; i <= total; i += 1) {
    fires.push({
      id: `f${i}`,
      parentFireId: "f0",
      sourceNodeId: "loop",
      port: "body",
      ts: i,
      seq: i * 2,
      iteration: i - 1,
    });
    log.entries.push({ ...entry(i * 2 + 1), fireId: `f${i}` });
  }
  const bounded = boundRunLog(log);
  const kept = new Set(bounded.fires.map((f) => f.id));

  assert.ok(bounded.fires.length <= MAX_LOG_ENTRIES);
  assert.ok(kept.has("f0"));
  for (const e of bounded.entries) assert.ok(kept.has(e.fireId), e.fireId);
});

test("a webhook payload is stored without the value of its credential headers", () => {
  const payload = {
    method: "POST",
    headers: {
      authorization: "Bearer SUPER-SECRET",
      cookie: "session=abc",
      "x-api-key": "k",
      "stripe-signature": "t=1,v1=x",
      "content-type": "application/json",
    },
    body: { token: "kept: a body field, not a header" },
  };
  const stored = readTriggerPayload(serializeTriggerPayload(payload));

  assert.equal(stored.kept, true);
  assert.deepEqual(stored.payload.headers, {
    authorization: REDACTED,
    cookie: REDACTED,
    "x-api-key": REDACTED,
    "stripe-signature": REDACTED,
    "content-type": "application/json",
  });
  assert.deepEqual(stored.payload.body, payload.body);
  // The run itself received them in full.
  assert.equal(payload.headers.authorization, "Bearer SUPER-SECRET");
  assert.doesNotMatch(serializeTriggerPayload(payload), /SUPER-SECRET|abc/);
});

test("credential headers are told by their name, whatever its case", () => {
  for (const name of [
    "X-Shopify-Hmac-Sha256",
    "X-Auth-User",
    "X-Access-Key",
    "x-client-key",
    "client_key",
    "token",
    "key",
    "Authorization",
    "Proxy-Authorization",
    "Set-Cookie",
    "X-Auth-Token",
    "X-Hub-Signature-256",
    "api_key",
    "X-Session-Id",
  ]) {
    assert.equal(isSensitiveHeader(name), true, name);
  }
  for (const name of ["content-type", "user-agent", "host", "x-request-id"]) {
    assert.equal(isSensitiveHeader(name), false, name);
  }
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

test("a webhook's secret query parameters are not stored either", () => {
  const stored = readTriggerPayload(
    serializeTriggerPayload({
      query: { token: "abcdef123", api_key: "k-123456", page: "2" },
    }),
  );
  assert.deepEqual(stored.payload.query, {
    token: REDACTED,
    api_key: REDACTED,
    page: "2",
  });
});

test("a credential a step copied from the trigger is scrubbed from its log", () => {
  const payload = {
    headers: {
      authorization: "Bearer tok-SECRET-1",
      cookie: "sid=cookie-SECRET-2; theme=dark",
    },
    query: { signature: "sig-SECRET-3" },
  };
  const secrets = secretsOf(payload);
  const log = {
    fires: [ROOT],
    entries: [
      entry(1, "got Bearer tok-SECRET-1", {
        inputs: { value: { type: "string", value: "tok-SECRET-1" } },
        output: {
          type: "object",
          value: { s: "cookie-SECRET-2", q: "sig-SECRET-3" },
        },
      }),
    ],
  };
  const scrubbed = JSON.stringify(scrubSecrets(log, secrets));
  assert.doesNotMatch(scrubbed, /SECRET/);
  assert.match(scrubbed, /got \[redacted\]/);
  // Short values (theme=dark) are too common to scrub.
  assert.ok(!secrets.includes("dark"));
  assert.equal(scrubSecrets(log, []), log);
});

test("the project names its own credentials", () => {
  assert.equal(isSensitiveHeader("X-Shop-Pin"), false);
  configureRedaction(["shop-pin"]);
  try {
    assert.equal(isSensitiveHeader("X-Shop-Pin"), true);
    assert.match(clearCredentialPattern(), /shop-pin/);
  } finally {
    configureRedaction(undefined);
  }
});

test("the error filter finds the payloads stored with a credential in clear", () => {
  const pattern = new RegExp(clearCredentialPattern().replace("(?i)", ""), "i");
  const clear = [
    { headers: { Authorization: "Bearer x" } },
    { headers: { host: "h", "x-shopify-hmac-sha256": "abc" } },
    { headers: { "set-cookie": ["a=b"] } },
    { query: { token: "abc" } },
    { headers: { authorization: REDACTED, cookie: "s=1" } },
  ];
  for (const payload of clear) {
    assert.ok(pattern.test(JSON.stringify(payload)), JSON.stringify(payload));
  }
  const clean = [
    { headers: { authorization: REDACTED, cookie: REDACTED, host: "h" } },
    { query: { token: REDACTED, page: "2" } },
    { body: { token: "a body field" }, headers: { host: "h" } },
    { headers: { host: "session-host.example" } },
  ];
  for (const payload of clean) {
    assert.ok(!pattern.test(JSON.stringify(payload)), JSON.stringify(payload));
  }
});

test("a payload stored before its name was sensitive is redacted when it is read", () => {
  const old = JSON.stringify({
    headers: { authorization: "Bearer OLD" },
    body: { a: 1 },
  });
  assert.equal(readTriggerPayload(old).payload.headers.authorization, REDACTED);
  assert.doesNotMatch(redactStoredPayload(old), /OLD/);
  assert.equal(redactStoredPayload("not json"), "not json");
});

test("a range loop refuses more than 10 000 iterations before the first one", async () => {
  require("../dist/runtime/builtins/nodes/forRange.js");
  const { nodeKinds } = require("../dist/runtime/nodeKinds.js");
  const { execute } = nodeKinds.get("forRange");
  let fired = 0;
  const ctx = {
    log() {},
    setOutputs() {},
    fireTrigger: async () => {
      fired += 1;
    },
  };
  await assert.rejects(
    execute({}, { start: 0, end: 100_000, step: 1 }, ctx),
    /would run 100000 iterations, more than the 10000 allowed/,
  );
  assert.equal(fired, 0);
  await execute({}, { start: 0, end: 10_000, step: 1 }, ctx);
  assert.equal(fired, 10_000);
});

test("a run read after a name became sensitive hides it in its payload, error and log", () => {
  const old = {
    triggerPayload: JSON.stringify({
      headers: { "x-api-key": "OLDSECRET99" },
      query: { token: "OLDQTOKEN77" },
    }),
    errorMessage: '"OLDSECRET99" is not a valid URL.',
    logs: {
      fires: [ROOT],
      entries: [entry(1, "fetch ?token=OLDQTOKEN77", { url: "OLDSECRET99" })],
    },
  };
  const rewritten = redactedStoredRun(old);

  assert.doesNotMatch(JSON.stringify(rewritten), /OLDSECRET99|OLDQTOKEN77/);
  assert.equal(rewritten.errorMessage, '"[redacted]" is not a valid URL.');
  // A run rewritten, or stored since, needs nothing.
  assert.equal(redactedStoredRun({ ...old, ...rewritten }), undefined);
  assert.equal(
    redactedStoredRun({
      triggerPayload: serializeTriggerPayload({
        headers: { cookie: "s=abcdef" },
      }),
      errorMessage: "boom",
    }),
    undefined,
  );
});
