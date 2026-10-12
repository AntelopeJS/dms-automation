const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  claimRerun,
  historyOf,
  rerunPlanFor,
} = require("../dist/routes/runs.js");

const PROCEDURE = "p1";
const MINUTE = 60_000;

let seq = 0;
function run(minute, fields = {}) {
  seq += 1;
  return {
    _id: `r${seq}`,
    procedureId: PROCEDURE,
    startedAt: new Date(minute * MINUTE),
    endedAt: new Date(minute * MINUTE + 100),
    status: "ok",
    kind: "run",
    triggerNodeId: "t",
    triggerPayload: "{}",
    ...fields,
  };
}

// The model's history reads, over runs held in memory: the queries the
// database answers, so the route's logic is what is tested.
function fakeModel(runs) {
  const matches = (r, procedureId, { tests, after, before, status }) =>
    r.procedureId === procedureId &&
    (tests ? r.kind === "test" : r.kind !== "test") &&
    (!after || r.startedAt > after) &&
    (!before || r.startedAt < before) &&
    (!status || r.status === status);
  const byStart = (dir) =>
    [...runs].sort((a, b) => (a.startedAt - b.startedAt) * dir);
  return {
    get: async (id) => runs.find((r) => r._id === id),
    newest: async (id, q) => byStart(-1).find((r) => matches(r, id, q)),
    oldest: async (id, q) => byStart(1).find((r) => matches(r, id, q)),
    countHistory: async (id, q) => runs.filter((r) => matches(r, id, q)).length,
    successTimings: async (id, q, limit) =>
      byStart(-1)
        .filter((r) => matches(r, id, { ...q, status: "ok" }))
        .slice(0, limit),
  };
}

test("a trace compares with the last success however far back, and its neighbours", async () => {
  const lastSuccess = run(0);
  // 120 failures since: far more than the 50 runs the history used to read.
  const failures = Array.from({ length: 120 }, (_, i) =>
    run(1 + i, { status: "failed" }),
  );
  const current = run(200, { status: "failed" });
  const test = run(201, { kind: "test", status: "ok" });
  const next = run(202, { status: "failed" });
  const runs = [lastSuccess, ...failures, current, test, next];

  const history = await historyOf(current, fakeModel(runs));

  assert.equal(history.lastSuccess._id, lastSuccess._id);
  assert.equal(history.failuresInRow, 121);
  assert.equal(history.previous.runId, failures.at(-1)._id);
  // The next production run: the test in between is not one.
  assert.equal(history.next.runId, next._id);
  assert.equal(history.usualDurationMs, 100);
});

test("a test is compared with the tests of its procedure only", async () => {
  const production = run(0, { status: "failed" });
  const firstTest = run(1, { kind: "test", status: "failed" });
  const current = run(2, { kind: "test", status: "failed" });
  const runs = [production, firstTest, current];

  const history = await historyOf(current, fakeModel(runs));

  assert.equal(history.previous.runId, firstTest._id);
  assert.equal(history.failuresInRow, 2);
  assert.equal(history.lastSuccess, undefined);
  assert.equal(history.next, null);
});

const GRAPH = JSON.stringify({
  nodes: [{ id: "t", kind: "trigger", typeId: "manual" }],
  triggerEdges: [],
  dataEdges: [],
});
const procedure = { _id: PROCEDURE, name: "Sync", graph: GRAPH, enabled: true };

test("a run cannot be re-run when its procedure, payload, draft or trigger is gone", () => {
  assert.deepEqual(rerunPlanFor(run(0), undefined), {
    blocked: "$dms_automation.runs.rerunBlocked.deleted",
    status: 404,
  });
  const tooLarge = JSON.stringify({ truncated: true, originalBytes: 300_000 });
  assert.equal(
    rerunPlanFor(run(0, { triggerPayload: tooLarge }), procedure).blocked,
    "$dms_automation.runs.rerunBlocked.payloadTooLarge",
  );
  assert.equal(
    rerunPlanFor(run(0, { kind: "test" }), procedure).blocked,
    "$dms_automation.runs.rerunBlocked.draftNotKept",
  );
  assert.equal(
    rerunPlanFor(run(0, { triggerNodeId: "gone" }), procedure).blocked,
    "$dms_automation.runs.rerunBlocked.triggerGone",
  );
});

test("a test re-runs the draft it tested; a run, the saved procedure", () => {
  const draft = { nodes: [], triggerEdges: [], dataEdges: [] };
  const retest = rerunPlanFor(
    run(0, { kind: "test", graphSnapshot: JSON.stringify(draft) }),
    procedure,
  );
  assert.deepEqual(retest.draft, draft);
  const rerun = rerunPlanFor(
    run(0, { triggerPayload: '{"headers":{"authorization":"Bearer x"}}' }),
    procedure,
  );
  assert.equal(rerun.draft, undefined);
  // What is replayed is the redacted payload.
  assert.equal(rerun.payload.headers.authorization, "[redacted]");
});

test("a second re-run of the same run right after the first is refused", () => {
  const release = claimRerun("double-click");
  assert.throws(
    () => claimRerun("double-click"),
    (err) => JSON.stringify(err).includes("rerunBusy"),
  );
  release();
  // Still refused a moment after the first one ended.
  assert.throws(() => claimRerun("double-click"));
  // Another run is not held up.
  claimRerun("another")();
});
