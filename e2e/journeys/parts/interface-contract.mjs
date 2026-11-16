import { auto, check, fixture, isText, list, pick, same, text } from "../../auto.mjs";
import { clearLedger, createProcedure, ledger, runNow, runOf, runsOfProcedure, until } from "../../procs.mjs";
import { actionNode, chainGraph, defineType, invokeProcedure, runProcedure, stepOf, triggerNode, valueOf } from "./interface-calls.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const contractJourneys = [
  {
    id: "run-now-triggers-invoke-and-run-always-call-execute",
    title: "Run now, a trigger's emit, InvokeProcedure and RunProcedure always call execute, never dryRun, and ctx.dryRun is false",
    entryPoint: "POST /procedures/:id/run-now, InvokeProcedure, RunProcedure, emit",
    async run(/** @type {Ctx} */ ctx) {
      await clearLedger(ctx);
      const topic = ctx.unique("exec").replace(/\W+/g, "-");
      const id = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("man"), triggerNode("ev", "verify.event", { topic }), actionNode("fx", "verify.effect", { label: "real é" }), actionNode("ctxn", "verify.context")],
          triggerEdges: [
            { id: "e1", from: { node: "man" }, to: { node: "fx" } },
            { id: "e2", from: { node: "ev" }, to: { node: "fx" } },
            { id: "e3", from: { node: "fx" }, to: { node: "ctxn" } },
          ],
          dataEdges: [],
        },
      });
      await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, {
        body: { enabled: true },
      });
      const viaRunNow = await runNow(ctx, id);
      const viaInvoke = await invokeProcedure(ctx, id);
      const viaRun = await runProcedure(ctx, id);
      await fixture(ctx, "emit", "POST", "/emit", {
        topic,
        payload: { topic, value: "x" },
      });
      await until(
        () => runsOfProcedure(ctx, id),
        (rows) => rows.length >= 4,
      );
      const entries = (await ledger(ctx)).entries.filter((entry) => entry.type === "verify.effect");
      await ctx.verify("execute, never dryRun", [
        same("four runs", (await runsOfProcedure(ctx, id)).length, 4),
        same(
          "the action executed four times and never simulated",
          entries.map((entry) => [entry.kind, entry.ctxDryRun, entry.label]),
          Array.from({ length: 4 }, () => ["execute", false, "real é"]),
        ),
        same("every entry carries the ids of its run", new Set(entries.map((entry) => entry.procedureId)).size, 1),
      ]);
      const run = await runOf(ctx, viaRunNow.runId);
      await ctx.verify("the trace shows a real execution", [
        same("the output is the executed one", valueOf(stepOf(run, "fx").output), { mode: "executed", label: "real é" }),
        same("ctx.dryRun is false in the context action", pick(stepOf(run, "ctxn").output, "value", "dryRun"), false),
        same("no simulation notice in the logs", JSON.stringify((await auto(ctx, "logs", "GET", `/runs/${viaRunNow.runId}/logs`)).body).includes("Simulated (test run)"), false),
        check("the other starters produced ok runs too", viaInvoke.ok && viaRun.result.status === "ok", [viaInvoke.raw, viaRun.raw]),
      ]);
    },
  },
  {
    id: "a-test-run-follows-the-sideeffects-and-dryrun-declarations",
    title: "a test run calls dryRun instead of execute, runs sideEffects:false actions as is (even with a dryRun), executes the rest for real after the user confirmed, and ctx.dryRun is true throughout",
    entryPoint: "POST /procedures/:id/test-effects, POST /procedures/:id/test, ctx.dryRun",
    async run(/** @type {Ctx} */ ctx) {
      const stamp = Date.now().toString(36);
      const both = `verify.both-${stamp}`;
      await defineType(ctx, {
        kind: "action",
        id: both,
        name: "Both",
        sideEffects: false,
        output: { via: "execute" },
        dryRunOutput: { via: "dryRun" },
      });
      const graph = chainGraph([triggerNode("t"), actionNode("sim", "verify.effect", { label: "simulate me" }), actionNode("real", "verify.effect-nodry", { label: "act for real é" }), actionNode("pure", "verify.effect-pure", { label: "pure" }), actionNode("win", both), actionNode("ctxn", "verify.context")]);
      const id = await createProcedure(ctx, { graph });
      await clearLedger(ctx);
      const effects = await auto(ctx, "what a test would do for real", "POST", `/procedures/${id}/test-effects`, { body: { graph } });
      await ctx.verify("the steps a test would run for real", [
        same(
          "only the action with neither member",
          list(effects.body, "realEffects").map((step) => [step.nodeId, step.typeId]),
          [["real", "verify.effect-nodry"]],
        ),
      ]);
      const refused = await auto(ctx, "a test without confirmation", "POST", `/procedures/${id}/test`, { body: { graph } });
      const afterRefusal = await ledger(ctx);
      await ctx.verify("the API refuses the test until the user confirms", [
        same("status", refused.status, 409),
        same("the error", pick(refused.body, "error"), "the draft has steps a test runs for real: confirm them first"),
        same(
          "the steps are listed",
          list(refused.body, "realEffects").map((step) => step.nodeId),
          ["real"],
        ),
        same("nothing ran", afterRefusal.entries.length, 0),
        same("no run was stored", (await runsOfProcedure(ctx, id)).length, 0),
      ]);
      const falseConfirm = await auto(ctx, "a test with confirmRealEffects false", "POST", `/procedures/${id}/test`, { body: { graph, confirmRealEffects: false } });
      await ctx.verify("only true confirms", [same("status", falseConfirm.status, 409)]);
      const tested = await auto(ctx, "a confirmed test", "POST", `/procedures/${id}/test`, { body: { graph, confirmRealEffects: true, payload: { a: "é" } } });
      const run = await runOf(ctx, text(tested.body, "runId"));
      const notes = (await ledger(ctx)).entries;
      await ctx.verify("what the test did", [
        same("status 200 and ok", [tested.status, pick(tested.body, "status")], [200, "ok"]),
        same("the run is a test", run.kind, "test"),
        same(
          "dryRun ran instead of execute",
          notes.filter((entry) => entry.label === "simulate me").map((entry) => [entry.kind, entry.ctxDryRun]),
          [["dry-run", true]],
        ),
        same(
          "the action without dryRun executed for real, with ctx.dryRun true",
          notes.filter((entry) => entry.label === "act for real é").map((entry) => [entry.kind, entry.ctxDryRun]),
          [["execute", true]],
        ),
        same(
          "sideEffects:false wins over dryRun",
          notes.filter((entry) => entry.label === "pure").map((entry) => [entry.kind, entry.ctxDryRun]),
          [["execute", true]],
        ),
        same("the defined action with sideEffects:false executed", [valueOf(stepOf(run, "win").output), notes.some((entry) => entry.kind === "defined-dry-run")], [{ via: "execute" }, false]),
        same("the simulated output continues the run", valueOf(stepOf(run, "sim").output), { mode: "simulated", label: "simulate me" }),
        same("the executed output", valueOf(stepOf(run, "real").output), {
          mode: "executed",
          label: "act for real é",
        }),
        same("ctx.dryRun is true for a step without dryRun", pick(stepOf(run, "ctxn").output, "value", "dryRun"), true),
      ]);
      const logs = await auto(ctx, "logs", "GET", `/runs/${text(tested.body, "runId")}/logs`);
      const simulated = list(logs.body, "entries").filter((entry) => entry.message === "Simulated (test run): no effect");
      await ctx.verify("the trace logs the simulation", [
        same(
          "once, on the simulated step",
          simulated.map((entry) => entry.nodeId),
          ["sim"],
        ),
      ]);
      const safe = chainGraph([triggerNode("t"), actionNode("sim", "verify.effect", { label: "only simulated" }), actionNode("pure", "verify.effect-pure", { label: "pure" })]);
      const safeSave = await createProcedure(ctx, { graph: safe });
      const safeTest = await auto(ctx, "a test with nothing real asks nothing", "POST", `/procedures/${safeSave}/test`, { body: { graph: safe } });
      await ctx.verify("no confirmation when nothing acts for real", [same("status", safeTest.status, 200)]);
      await clearLedger(ctx);
      const real = await runNow(ctx, id);
      const executed = (await ledger(ctx)).entries;
      await ctx.verify("Run now after the test executes everything", [
        same("status", real.status, "ok"),
        same(
          "every labelled action executed, none simulated, ctx.dryRun false",
          executed.filter((entry) => isText(entry.label)).map((entry) => [entry.kind, entry.label, entry.ctxDryRun]),
          [
            ["execute", "simulate me", false],
            ["execute", "act for real é", false],
            ["execute", "pure", false],
          ],
        ),
      ]);
    },
  },
];
