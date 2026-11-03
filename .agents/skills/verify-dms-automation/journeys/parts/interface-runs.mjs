import { auto, check, pick, same, text } from "../../auto.mjs";
import { createProcedure, runOf, runsOfProcedure, statusIs } from "../../procs.mjs";
import { actionNode, chainGraph, invokeProcedure, runProcedure, stepOf, triggerNode, valueOf } from "./interface-calls.mjs";
import { twoTriggerGraph, ranWith } from "./interface-runs-shared.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const runJourneys = [
  {
    id: "invoke-procedure-rejects-404-and-400-and-returns-the-id-of-a-failed-run",
    title: "InvokeProcedure runs the first manual trigger and resolves to the stored run id, even for a failed run; 404 for an unknown procedure; 400 for a graph without a manual trigger",
    entryPoint: "InvokeProcedure(id, payload), GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const missing = await invokeProcedure(ctx, "no-such-procedure");
      await ctx.verify("an unknown procedure", [same("status", missing.status, 404), same("message", pick(missing.body, "error"), 'procedure "no-such-procedure" not found')]);
      const noManual = await createProcedure(ctx, {
        graph: chainGraph([triggerNode("ev", "verify.event", { topic: "x" }), actionNode("log", "log.message", { message: "x" })]),
      });
      const refused = await invokeProcedure(ctx, noManual);
      await ctx.verify("a graph without a manual trigger", [same("status", refused.status, 400), same("message", pick(refused.body, "error"), `procedure "${noManual}" has no manual trigger node`), same("no run was stored", (await runsOfProcedure(ctx, noManual)).length, 0)]);
      const failing = await createProcedure(ctx, {
        graph: chainGraph([triggerNode("t"), actionNode("boom", "verify.fail", { message: "échec 日本 😀" })]),
      });
      const first = await invokeProcedure(ctx, failing, { orderId: "10477" });
      const second = await invokeProcedure(ctx, failing, { orderId: "10477" });
      const run = await runOf(ctx, text(first.result, "runId"));
      await ctx.verify("a failed run still returns its id", [
        check("the call resolved to a string id", first.ok && text(first.result, "runId").length > 0, first.raw),
        check("a second call is another run: no idempotency key", text(second.result, "runId") !== text(first.result, "runId") && text(second.result, "runId").length > 0, [first.raw, second.raw]),
        same("the run failed", run.status, "failed"),
        same("its error message", run.errorMessage, "échec 日本 😀"),
        same("it ran from the manual trigger with the payload", [run.triggerNodeId, valueOf(stepOf(run, "t").output)], ["t", { orderId: "10477" }]),
        check("the failed step is named", pick(run, "failedStep") !== null, pick(run, "failedStep")),
        same("both runs are in the procedure's history", (await runsOfProcedure(ctx, failing)).length, 2),
      ]);
      const twoManual = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("ev", "verify.event", { topic: "x" }), triggerNode("m1"), triggerNode("m2"), actionNode("log", "log.message", { message: "x" })],
          triggerEdges: ["ev", "m1", "m2"].map((from) => ({
            id: `e-${from}`,
            from: { node: from },
            to: { node: "log" },
          })),
          dataEdges: [],
        },
      });
      const picked = await invokeProcedure(ctx, twoManual, { which: "first" });
      const pickedRun = await runOf(ctx, text(picked.result, "runId"));
      await ctx.verify("the first manual trigger of the graph", [same("trigger", pickedRun.triggerNodeId, "m1")]);
      const draft = await auto(ctx, "the procedure is a disabled draft", "GET", `/procedures/${failing}`);
      await ctx.verify("a procedure that is not enabled is invoked too", [same("it is disabled", pick(draft.body, "enabled"), false), same("the run exists", run.procedureId, failing)]);
    },
  },
  {
    id: "run-procedure-payload-defaults-to-the-newest-real-run-among-the-last-50",
    title: "RunProcedure without payload replays the payload of the newest stored run that kept one, test runs excluded, among the procedure's last 50 runs; with triggerNodeId only that trigger's runs count; else {}",
    entryPoint: "RunProcedure(id, options), POST /procedures/:id/test, GET /procedures/:id/last-payload",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { graph: twoTriggerGraph() });
      const none = await ranWith(ctx, id, undefined);
      await ctx.verify("no run kept a payload", [same("the payload is {}", none.payload, {})]);
      await ranWith(ctx, id, { payload: { first: "é 日本" } });
      const replay = await ranWith(ctx, id, undefined);
      await ctx.verify("the newest run's payload is replayed", [same("payload", replay.payload, { first: "é 日本" })]);
      const graph = twoTriggerGraph();
      const test = await auto(ctx, "a test run with its own payload", "POST", `/procedures/${id}/test`, { body: { graph, payload: { fromTest: true } } });
      const afterTest = await ranWith(ctx, id, undefined);
      await ctx.verify("a test run is not a payload source", [statusIs(test, 200, "the test run answered 200"), same("payload", afterTest.payload, { first: "é 日本" })]);
      await ranWith(ctx, id, { payload: { second: 2 } });
      await ranWith(ctx, id, { payload: { viaT2: "ü" }, triggerNodeId: "t2" });
      const anyTrigger = await ranWith(ctx, id, undefined);
      const t1 = await ranWith(ctx, id, { triggerNodeId: "t1" });
      const t2 = await ranWith(ctx, id, { triggerNodeId: "t2" });
      await ctx.verify("the trigger filter", [
        same("without triggerNodeId the newest run of any trigger counts, and the manual trigger starts", [anyTrigger.payload, anyTrigger.trigger], [{ viaT2: "ü" }, "t1"]),
        same("t1 replays its own newest payload", [t1.payload, t1.trigger], [{ viaT2: "ü" }, "t1"]),
        same("t2 replays its own newest payload", [t2.payload, t2.trigger], [{ viaT2: "ü" }, "t2"]),
      ]);
      const falsy = await ranWith(ctx, id, { payload: null });
      const afterNull = await auto(ctx, "last payload after a null payload", "GET", `/procedures/${id}/last-payload`);
      await ctx.verify("an explicit null payload is a payload", [same("the run received null", falsy.payload, null), same("the last payload is null", pick(afterNull.body, "last", "payload"), null)]);
      for (const depth of [50, 51]) {
        const deep = await createProcedure(ctx, { graph: twoTriggerGraph() });
        await runProcedure(ctx, deep, {
          payload: { deep: depth },
          triggerNodeId: "t1",
        });
        for (let index = 0; index < depth - 1; index += 1)
          await runProcedure(ctx, deep, {
            payload: { filler: index },
            triggerNodeId: "t2",
          });
        const found = await ranWith(ctx, deep, { triggerNodeId: "t1" });
        await ctx.verify(`the payload ${depth} runs back`, [same(depth === 50 ? "the 50th newest run is still looked at" : "the 51st newest run is not looked at", found.payload, depth === 50 ? { deep: 50 } : {})]);
      }
    },
  },
  {
    id: "run-procedure-picks-the-trigger-and-answers-404-for-unknown-ones",
    title: "RunProcedure starts from triggerNodeId, else the manual trigger, else the graph's first trigger; an unknown trigger node or procedure answers 404",
    entryPoint: "RunProcedure(id, { triggerNodeId })",
    async run(/** @type {Ctx} */ ctx) {
      const manualSecond = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("ev", "verify.event", { topic: "x" }), triggerNode("man"), actionNode("log", "log.message", { message: "x" })],
          triggerEdges: [
            { id: "e1", from: { node: "ev" }, to: { node: "log" } },
            { id: "e2", from: { node: "man" }, to: { node: "log" } },
          ],
          dataEdges: [],
        },
      });
      const firstTrigger = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("listed-first", "verify.leader-event", { topic: "y" }), triggerNode("listed-second", "verify.event", { topic: "x" }), actionNode("log", "log.message", { message: "x" })],
          triggerEdges: [
            { id: "e1", from: { node: "listed-second" }, to: { node: "log" } },
            { id: "e2", from: { node: "listed-first" }, to: { node: "log" } },
          ],
          dataEdges: [],
        },
      });
      const manual = await ranWith(ctx, manualSecond, { payload: 1 });
      const viaNamed = await ranWith(ctx, manualSecond, {
        payload: 2,
        triggerNodeId: "ev",
      });
      const first = await ranWith(ctx, firstTrigger, { payload: 3 });
      const named = await ranWith(ctx, firstTrigger, {
        payload: 4,
        triggerNodeId: "listed-second",
      });
      await ctx.verify("which trigger starts", [
        same("the manual trigger even when it is second", [manual.trigger, manual.payload], ["man", 1]),
        same("triggerNodeId picks a non-manual trigger", [viaNamed.trigger, viaNamed.payload], ["ev", 2]),
        same("with no manual trigger the first trigger of the graph", [first.trigger, first.payload], ["listed-first", 3]),
        same("triggerNodeId picks the second", [named.trigger, named.payload], ["listed-second", 4]),
      ]);
      const unknownTrigger = await runProcedure(ctx, manualSecond, {
        triggerNodeId: "zzz",
      });
      const actionAsTrigger = await runProcedure(ctx, manualSecond, {
        triggerNodeId: "log",
      });
      const unknownProcedure = await runProcedure(ctx, "no-such-procedure");
      const viaHttp = await auto(ctx, "Run now over HTTP with the same unknown trigger", "POST", `/procedures/${manualSecond}/run-now`, { body: { triggerNodeId: "zzz" } });
      await ctx.verify("the 404s", [
        same("an unknown trigger node: status", unknownTrigger.status, 404),
        same("an unknown trigger node: message", pick(unknownTrigger.body, "error"), `trigger "zzz" is not in procedure "${manualSecond}"`),
        same("the HTTP Run now route answers the same", [pick(viaHttp.body, "error")], [`trigger "zzz" is not in procedure "${manualSecond}"`]),
        same("the HTTP Run now route answers the same status", viaHttp.status, 404),
        same("a node that is not a trigger: status", actionAsTrigger.status, 404),
        same("a node that is not a trigger: message", pick(actionAsTrigger.body, "error"), `trigger "log" is not in procedure "${manualSecond}"`),
        same("an unknown procedure: status", unknownProcedure.status, 404),
        same("an unknown procedure: message", pick(unknownProcedure.body, "error"), 'procedure "no-such-procedure" not found'),
        same("a refused call stored no extra run", (await runsOfProcedure(ctx, manualSecond)).length, 2),
      ]);
    },
  },
];
