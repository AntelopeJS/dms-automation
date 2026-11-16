import { check, list, same, text } from "../../auto.mjs";
import { action, clearLedger, createProcedure, dedge, flow, graph, runNow, tedge, trigger } from "../../procs.mjs";
import { endedAs, inputValue, ledgerOf, outputValue, ranOrder, runGraph, stepsOfNode, userLogs, userMessages } from "./runtime-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * @param {string} id The node id
 * @param {string} key The tick key
 * @returns {import("../../procs.mjs").GraphNode} A tick action
 */
const tick = (id, key) => action(id, "verify.tick", { key });

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function parallelChecks(ctx) {
  await clearLedger(ctx);
  const overlap = graph(
    [
      trigger("t"),
      flow("p", "parallel", { ports: ["a", "b", "c"] }),
      action("sa", "verify.sleep", { ms: 500, key: "a" }),
      action("sb", "verify.sleep", { ms: 500, key: "b" }),
      action("sc", "verify.sleep", { ms: 500, key: "c" }),
      tick("after", "after"),
    ],
    [tedge("t", "p"), tedge("p", "sa", "a"), tedge("p", "sb", "b"), tedge("p", "sc", "c"), tedge("p", "after")],
  );
  const ran = await runGraph(ctx, overlap);
  const starts = (await ledgerOf(ctx, "sleep-start")).map((entry) => Number(entry.at));
  const ends = (await ledgerOf(ctx, "sleep-end")).map((entry) => Number(entry.at));
  const after = (await ledgerOf(ctx, "tick")).map((entry) => Number(entry.at));
  const checks = [
    endedAs("three branches", ran, "ok"),
    same("every branch ran once", [starts.length, ends.length], [3, 3]),
    check("every branch started before any branch ended", Math.max(...starts) < Math.min(...ends), JSON.stringify({ starts, ends })),
    check("the three sleeps took about one sleep, not three", Math.max(...ends) - Math.min(...starts) < 1300, JSON.stringify({ starts, ends })),
    same("the main branch ran once", after.length, 1),
    check("the main branch waited for all of them", after.length === 1 && after[0] >= Math.max(...ends), JSON.stringify({ after, ends })),
  ];

  await clearLedger(ctx);
  const failing = graph(
    [
      trigger("t"),
      flow("p", "parallel", { ports: ["a", "b"] }),
      action("fa", "verify.fail", { message: "branch a failed" }),
      action("sb", "verify.sleep", { ms: 400, key: "b" }),
      tick("bdone", "bdone"),
      tick("after", "after"),
    ],
    [tedge("t", "p"), tedge("p", "fa", "a"), tedge("p", "sb", "b"), tedge("sb", "bdone"), tedge("p", "after")],
  );
  const ranFail = await runGraph(ctx, failing);
  const counters = (await ledgerOf(ctx, "tick")).map((entry) => entry.key);
  checks.push(endedAs("a failing branch", ranFail, "failed"));
  checks.push(same("a failing branch: the parallel fails with its error", ranFail.error, "branch a failed"));
  checks.push(same("a failing branch: the failing step is named", ranFail.failedNodeId, "fa"));
  checks.push(same("a failing branch: the other branch ran to its end", counters, ["bdone"]));
  checks.push(check("a failing branch: main did not run", !ranOrder(ranFail).includes("after"), ranOrder(ranFail).join(",")));

  await clearLedger(ctx);
  const both = graph(
    [
      trigger("t"),
      flow("p", "parallel", { ports: ["a", "b"] }),
      action("sa", "verify.sleep", { ms: 300, key: "a" }),
      action("fa", "verify.fail", { message: "late failure" }),
      action("fb", "verify.fail", { message: "early failure" }),
    ],
    [tedge("t", "p"), tedge("p", "sa", "a"), tedge("sa", "fa"), tedge("p", "fb", "b")],
  );
  const ranBoth = await runGraph(ctx, both);
  checks.push(same("two failing branches: the first failure in time is reported", ranBoth.error, "early failure"));

  const none = graph([trigger("t"), flow("p", "parallel", { ports: [] }), tick("after", "none-after")], [tedge("t", "p"), tedge("p", "after")]);
  const ranNone = await runGraph(ctx, none);
  checks.push(endedAs("no branches", ranNone, "ok"));
  checks.push(same("no branches: a warning and the main branch", userLogs(ranNone).map((entry) => [entry.level, entry.message]), [["warn", "parallel has no configured ports; nothing to run"]]));
  checks.push(check("no branches: main ran", ranOrder(ranNone).includes("after"), ranOrder(ranNone).join(",")));
  return checks;
}

export const THROWN = [
  { kind: "string", message: "plain string failure" },
  { kind: "number", message: "42" },
  { kind: "object", message: "[object Object]" },
  { kind: "null", message: "null" },
  { kind: "undefined", message: "undefined" },
  { kind: "empty-string", message: "" },
  { kind: "array", message: "a,b" },
];

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function tryCatchChecks(ctx) {
  await clearLedger(ctx);
  const caught = graph(
    [
      trigger("t"),
      flow("tc", "tryCatch"),
      tick("one", "try1"),
      action("boom", "verify.fail", { message: "oops é日🚀" }),
      tick("never", "never"),
      action("handler", "log.message", { message: "handler" }),
      tick("main", "main"),
    ],
    [tedge("t", "tc"), tedge("tc", "one", "try"), tedge("one", "boom"), tedge("boom", "never"), tedge("tc", "handler", "catch"), tedge("tc", "main")],
    [dedge("tc", "error", "handler", "message"), dedge("tc", "name", "handler", "value")],
  );
  const ran = await runGraph(ctx, caught);
  const ticks = (await ledgerOf(ctx, "tick")).map((entry) => entry.key);
  const checks = [
    endedAs("a failing try", ran, "ok"),
    same("steps before the failure ran, the rest of try did not, main ran after the catch", ticks, ["try1", "main"]),
    same("the catch receives the error text and name", [stepsOfNode(ran, "handler")[0]?.inputs?.message?.value, stepsOfNode(ran, "handler")[0]?.inputs?.value?.value], ["oops é日🚀", "Error"]),
    same("the Try / Catch records the error and name", outputValue(stepsOfNode(ran, "tc")[0]), { error: "oops é日🚀", name: "Error" }),
    same("a warning says what was caught", userLogs(ran).filter((entry) => entry.level === "warn").map((entry) => entry.message), ["caught Error: oops é日🚀"]),
    same("the failed step is marked as handled", stepsOfNode(ran, "boom")[0]?.handled, true),
    same("the failed step belongs to the try port", stepsOfNode(ran, "boom")[0]?.port, "try"),
    same("the catch step belongs to the catch port", stepsOfNode(ran, "handler")[0]?.port, "catch"),
  ];

  await clearLedger(ctx);
  const fine = graph(
    [trigger("t"), flow("tc", "tryCatch"), tick("one", "try1"), tick("handler", "catch"), tick("main", "main")],
    [tedge("t", "tc"), tedge("tc", "one", "try"), tedge("tc", "handler", "catch"), tedge("tc", "main")],
  );
  const ranFine = await runGraph(ctx, fine);
  checks.push(same("a try that succeeds skips catch and goes on to main", (await ledgerOf(ctx, "tick")).map((entry) => entry.key), ["try1", "main"]));
  checks.push(endedAs("a try that succeeds", ranFine, "ok"));

  const catchFails = graph(
    [trigger("t"), flow("tc", "tryCatch"), action("boom", "verify.fail", { message: "first" }), action("again", "verify.fail", { message: "second" }), tick("main", "after-failing-catch")],
    [tedge("t", "tc"), tedge("tc", "boom", "try"), tedge("tc", "again", "catch"), tedge("tc", "main")],
  );
  const ranCatchFails = await runGraph(ctx, catchFails);
  checks.push(endedAs("a catch that fails", ranCatchFails, "failed"));
  checks.push(same("a catch that fails: the run carries the catch error", ranCatchFails.error, "second"));

  const nested = graph(
    [
      trigger("t"),
      flow("outer", "tryCatch"),
      flow("inner", "tryCatch"),
      action("boom", "verify.fail", { message: "inner only" }),
      action("innerCatch", "log.message", { message: "inner caught" }),
      action("outerCatch", "log.message", { message: "outer caught" }),
    ],
    [tedge("t", "outer"), tedge("outer", "inner", "try"), tedge("inner", "boom", "try"), tedge("inner", "innerCatch", "catch"), tedge("outer", "outerCatch", "catch")],
  );
  const ranNested = await runGraph(ctx, nested);
  checks.push(endedAs("nested try", ranNested, "ok"));
  checks.push(check("nested try: only the inner catch runs", userMessages(ranNested).includes("inner caught") && !userMessages(ranNested).includes("outer caught"), userMessages(ranNested).join("|")));

  for (const one of THROWN) {
    const graphOf = (guarded) =>
      guarded
        ? graph(
            [trigger("t"), flow("tc", "tryCatch"), action("x", "verify.throw", { kind: one.kind }), action("handler", "log.message", {})],
            [tedge("t", "tc"), tedge("tc", "x", "try"), tedge("tc", "handler", "catch")],
            [dedge("tc", "error", "handler", "message"), dedge("tc", "name", "handler", "value")],
          )
        : graph([trigger("t"), action("x", "verify.throw", { kind: one.kind })], [tedge("t", "x")]);
    const ranGuarded = await runGraph(ctx, graphOf(true));
    checks.push(same(`thrown ${one.kind}: the catch reads error and name`, [stepsOfNode(ranGuarded, "handler")[0]?.inputs?.message?.value, stepsOfNode(ranGuarded, "handler")[0]?.inputs?.value?.value], [one.message, "Error"]));
    const ranOpen = await runGraph(ctx, graphOf(false));
    checks.push(endedAs(`thrown ${one.kind} unguarded`, ranOpen, "failed"));
    checks.push(same(`thrown ${one.kind} unguarded: the run's error is its text`, ranOpen.error, one.message));
    checks.push(same(`thrown ${one.kind} unguarded: the step is named`, ranOpen.failedNodeId, "x"));
  }
  return checks;
}

/**
 * @param {Ctx} ctx The journey
 * @param {number} failTimes How many calls fail
 * @param {Record<string, unknown>} retryConfig The Retry's settings
 * @param {string} key The flaky key
 * @returns {Promise<import("./runtime-kit.mjs").Ran>} The run
 */
async function retryRun(ctx, failTimes, retryConfig, key) {
  return runGraph(
    ctx,
    graph(
      [
        trigger("t"),
        flow("r", "retry", retryConfig),
        action("mark", "log.message", { message: "attempt" }),
        action("flaky", "verify.flaky", { key, failTimes }),
        action("exhausted", "log.message", { message: "gave up" }),
        tick("main", `${key}-main`),
      ],
      [tedge("t", "r"), tedge("r", "mark", "body"), tedge("mark", "flaky"), tedge("r", "exhausted", "exhausted"), tedge("r", "main")],
      [dedge("r", "attempt", "mark", "value"), dedge("r", "error", "exhausted", "value")],
    ),
  );
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<import("../../auto.mjs").Check[]>} The checks
 */
export async function retryChecks(ctx) {
  await clearLedger(ctx);
  const checks = [];
  const cases = [
    { label: "fails twice, 3 attempts", fails: 2, config: { maxAttempts: 3 }, calls: 3, exhausted: false },
    { label: "fails 3 times, 4 attempts (N - 1 failures)", fails: 3, config: { maxAttempts: 4 }, calls: 4, exhausted: false },
    { label: "fails 4 times, 4 attempts (N failures)", fails: 4, config: { maxAttempts: 4 }, calls: 4, exhausted: true },
    { label: "no setting means 3 attempts", fails: 99, config: {}, calls: 3, exhausted: true },
    { label: "1 means one attempt", fails: 99, config: { maxAttempts: 1 }, calls: 1, exhausted: true },
    { label: "a fraction is rounded down", fails: 99, config: { maxAttempts: 2.9 }, calls: 2, exhausted: true },
    { label: "a number written as text", fails: 99, config: { maxAttempts: "5" }, calls: 5, exhausted: true },
    { label: "text that is not a number means 3 attempts", fails: 99, config: { maxAttempts: "many" }, calls: 3, exhausted: true },
    { label: "succeeds at once", fails: 0, config: { maxAttempts: 3 }, calls: 1, exhausted: false },
  ];
  let index = 0;
  for (const one of cases) {
    index += 1;
    const key = `retry-${index}`;
    const ran = await retryRun(ctx, one.fails, one.config, key);
    const calls = (await ledgerOf(ctx, "flaky")).filter((entry) => entry.key === key);
    const mains = (await ledgerOf(ctx, "tick")).filter((entry) => entry.key === `${key}-main`);
    checks.push(endedAs(one.label, ran, "ok"));
    checks.push(same(`${one.label}: the body ran this many times`, calls.length, one.calls));
    checks.push(same(`${one.label}: the exhausted branch ran`, stepsOfNode(ran, "exhausted").length === 1, one.exhausted));
    checks.push(same(`${one.label}: main runs only when an attempt succeeded`, mains.length, one.exhausted ? 0 : 1));
    checks.push(
      same(
        `${one.label}: a warning per failed attempt`,
        userLogs(ran).filter((entry) => entry.level === "warn").map((entry) => entry.message),
        Array.from({ length: Math.min(one.fails, one.calls) }, (_, i) => `attempt ${i + 1}/${one.calls} failed: flaky failure ${i + 1}`),
      ),
    );
    checks.push(same(`${one.label}: the body saw attempts counted from 0`, stepsOfNode(ran, "mark").map((step) => inputValue(step, "value")), Array.from({ length: one.calls }, (_, i) => i)));
    if (one.exhausted) {
      checks.push(same(`${one.label}: the error output is the last failure`, stepsOfNode(ran, "exhausted")[0]?.inputs?.value?.value, `flaky failure ${one.calls}`));
      checks.push(same(`${one.label}: the Retry's attempt output is the last attempt`, outputValue(stepsOfNode(ran, "r")[0]), { attempt: one.calls - 1, error: `flaky failure ${one.calls}`, name: "Error" }));
    }
  }
  for (const below of [0, -4]) {
    const id = await createProcedure(ctx, { graph: graph([trigger("t"), flow("r", "retry", { maxAttempts: below }), tick("body", "below")], [tedge("t", "r"), tedge("r", "body", "body")]) });
    const refused = await runNow(ctx, id, {});
    checks.push(same(`Max attempts ${below}: Run now is refused`, refused.answer.status, 400));
    checks.push(
      same(
        `Max attempts ${below}: the problem says the minimum`,
        list(refused.answer.body, "issues").filter((issue) => issue.severity === "error").map((issue) => [issue.code, issue.message, issue.nodeId]),
        [["belowMinimum", "Max attempts must be at least 1", "r"]],
      ),
    );
  }
  const flaky = await retryRun(ctx, 99, { maxAttempts: 2 }, "retry-handled");
  checks.push(same("a failed attempt is marked handled and numbered", stepsOfNode(flaky, "flaky").map((step) => [step.iteration, step.handled]), [[0, true], [1, true]]));
  checks.push(same("the Retry step records the branch it took", text(stepsOfNode(flaky, "r")[0], "branch"), "exhausted"));
  return checks;
}
