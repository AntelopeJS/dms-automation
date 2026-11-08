const assert = require("node:assert/strict");
const { test } = require("node:test");
const automation = require("@antelopejs/interface-dms-automation");

const QUEUE_LIMIT = 1000;

/** @type {ReadonlyArray<[string, () => Promise<unknown>]>} */
const CALLS = [
  ["ListTriggerTypes", () => automation.ListTriggerTypes()],
  ["ListActionTypes", () => automation.ListActionTypes()],
  ["ListDataNodeTypes", () => automation.ListDataNodeTypes()],
  ["InvokeProcedure", () => automation.InvokeProcedure("demo.procedure")],
  ["RunProcedure", () => automation.RunProcedure("demo.procedure")],
  [
    "DeclareProcedure",
    () =>
      automation.DeclareProcedure({
        id: "demo.procedure",
        name: "Demo",
        graph: { nodes: [], triggerEdges: [], dataEdges: [] },
        enabled: false,
      }),
  ],
];

/**
 * @param {Promise<unknown>} call
 * @returns {Promise<string>}
 */
function settlement(call) {
  const outcome = call.then(
    () => "resolved",
    /** @param {unknown} error */
    (error) => (error instanceof Error ? error.name : "rejected"),
  );
  const stillPending = new Promise((resolve) =>
    setImmediate(() => resolve("pending")),
  );
  return Promise.race([outcome, stillPending]);
}

for (const [name, call] of CALLS) {
  void test(`${name} waits for an implementation and refuses the call past the queue limit`, async () => {
    const queued = Array.from({ length: QUEUE_LIMIT }, call);
    const outcomes = await Promise.all(
      [queued[0], queued[QUEUE_LIMIT - 1], call()].map(settlement),
    );

    assert.deepEqual(outcomes, [
      "pending",
      "pending",
      "ProviderQueueFullError",
    ]);
  });
}
