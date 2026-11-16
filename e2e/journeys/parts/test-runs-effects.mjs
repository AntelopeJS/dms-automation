import { auto, fixture, isText, list, pick, same, text } from "../../auto.mjs";
import { action, chain, clearLedger, createProcedure, graph, ledger, manualLog, runNow, runOf, runsOfProcedure, statusIs, trigger } from "../../procs.mjs";
import { emit, enabledProcedure, ofKind, runsUntil } from "./triggers-common.mjs";
import { NEEDS_CONFIRM, steps, test } from "./test-runs-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const effectsJourneys = [
  {
    id: "a-test-run-asks-before-it-acts-for-real",
    title: "a test of a draft with a step that acts for real and cannot simulate it is refused with 409 and the list of those steps until confirmRealEffects is true; nothing runs before the confirmation, and the confirmed test runs the step with ctx.dryRun true",
    entryPoint: "POST /procedures/:id/test, GET /verify-auto/ledger",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: ctx.unique("Asks first"), graph: manualLog("saved graph") });
      const draft = steps([["pay", "verify.effect-nodry", { label: "charge 12.50 €" }, "Charge the card"], ["note", "log.message", { message: "after the charge" }]]);
      await clearLedger(ctx);
      const refused = await test(ctx, id, draft);
      const refusedFalse = await test(ctx, id, draft, { confirmRealEffects: false });
      const badConfirm = await test(ctx, id, draft, { confirmRealEffects: "yes" });
      const idle = await ledger(ctx);
      await ctx.verify("the unconfirmed test is refused and nothing ran", [
        statusIs(refused, 409, "an unconfirmed test answers 409"),
        same("the error", text(refused.body, "error"), NEEDS_CONFIRM),
        same("the message key", text(refused.body, "message"), "$dms_automation.api.testNeedsConfirm"),
        same("the steps it would run for real", pick(refused.body, "realEffects"), [{ nodeId: "pay", typeId: "verify.effect-nodry", typeName: "Fixture verify.effect-nodry", label: "Charge the card" }]),
        statusIs(refusedFalse, 409, "confirmRealEffects false answers 409"),
        same("the same steps", pick(refusedFalse.body, "realEffects"), pick(refused.body, "realEffects")),
        statusIs(badConfirm, 400, "a confirmation that is not a boolean answers 400"),
        same("no step ran", idle.entries, []),
        same("the procedure has no run", (await runsOfProcedure(ctx, id)).length, 0),
      ]);

      const confirmed = await test(ctx, id, draft, { confirmRealEffects: true });
      const after = await ledger(ctx);
      const run = await runOf(ctx, text(confirmed.body, "runId"));
      await ctx.verify("the confirmed test runs the step for real", [
        statusIs(confirmed, 200, "a confirmed test answers 200"),
        same("it answers how the run ended", [pick(confirmed.body, "status"), isText(pick(confirmed.body, "runId"))], ["ok", true]),
        same("the step executed once", ofKind(after.entries, "execute").map((entry) => [entry.type, entry.label, entry.ctxDryRun]), [["verify.effect-nodry", "charge 12.50 €", true]]),
        same("it was not simulated", ofKind(after.entries, "dry-run"), []),
        same("the run is stored as a test", run.kind, "test"),
        same("the run succeeded", run.status, "ok"),
        same("the saved graph is untouched", pick((await auto(ctx, "read the procedure", "GET", `/procedures/${id}`)).body, "version"), 1),
      ]);

      const safe = steps([["note", "log.message", { message: "no effect" }], ["echo", "verify.echo", { value: 1 }], ["sim", "verify.effect", { label: "simulated" }]]);
      await clearLedger(ctx);
      const direct = await test(ctx, id, safe);
      const safeLedger = await ledger(ctx);
      await ctx.verify("a draft with no step acting for real needs no confirmation", [
        statusIs(direct, 200, "an unconfirmed safe test answers 200"),
        same("the simulated step did not execute", ofKind(safeLedger.entries, "execute"), []),
        same("it was simulated", ofKind(safeLedger.entries, "dry-run").map((entry) => entry.label), ["simulated"]),
      ]);
      const unneeded = await test(ctx, id, safe, { confirmRealEffects: true });
      await ctx.verify("a confirmation nobody needed is harmless", [statusIs(unneeded, 200, "confirming a safe test answers 200")]);
    },
  },
  {
    id: "test-effects-lists-the-steps-a-test-would-run-for-real",
    title: "the steps a test runs for real are the actions that declare neither sideEffects: false nor a dryRun, listed in graph order with the action type's name and the step's name; nothing runs while listing",
    entryPoint: "POST /procedures/:id/test-effects",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: ctx.unique("Effects"), graph: manualLog("x") });
      await clearLedger(ctx);
      const draft = steps([
        ["log", "log.message", { message: "reads" }],
        ["sim", "verify.effect", { label: "a" }],
        ["real", "verify.effect-nodry", { label: "b" }, "Send the invoice"],
        ["pure", "verify.effect-pure", { label: "c" }],
        ["echo", "verify.echo", { value: 1 }],
        ["fail", "verify.fail", { message: "x" }],
        ["tick", "verify.tick", { key: "k" }],
        ["context", "verify.context"],
        ["http", "http.request", { url: "http://127.0.0.1:1/never" }, "Call the partner"],
      ]);
      const answer = await auto(ctx, "test effects", "POST", `/procedures/${id}/test-effects`, { body: { graph: draft } });
      const none = await auto(ctx, "test effects of a safe draft", "POST", `/procedures/${id}/test-effects`, { body: { graph: steps([["log", "log.message", { message: "x" }]]) } });
      const empty = await auto(ctx, "test effects of an empty graph", "POST", `/procedures/${id}/test-effects`, { body: { graph: graph([]) } });
      const unknown = await auto(ctx, "test effects of an unknown procedure", "POST", "/procedures/nope/test-effects", { body: { graph: draft } });
      const noGraph = await auto(ctx, "test effects without a graph", "POST", `/procedures/${id}/test-effects`, { body: {} });
      const afterwards = await ledger(ctx);
      await ctx.verify("the listing", [
        statusIs(answer, 200, "listing answers 200"),
        same("the steps, in graph order", list(answer.body, "realEffects").map((step) => [step.nodeId, step.typeId]), [["real", "verify.effect-nodry"], ["fail", "verify.fail"], ["tick", "verify.tick"], ["http", "http.request"]]),
        same("the step names", list(answer.body, "realEffects").map((step) => step.label ?? null), ["Send the invoice", null, null, "Call the partner"]),
        same("the type names", list(answer.body, "realEffects").slice(0, 3).map((step) => step.typeName), ["Fixture verify.effect-nodry", "Fixture failure", "Fixture tick"]),
        same("a safe draft lists nothing", pick(none.body, "realEffects"), []),
        same("an empty graph lists nothing", pick(empty.body, "realEffects"), []),
        statusIs(unknown, 404, "an unknown procedure answers 404"),
        statusIs(noGraph, 400, "a body without a graph answers 400"),
        same("listing ran no step", afterwards.entries, []),
      ]);
    },
  },
  {
    id: "a-test-run-calls-dry-run-instead-of-execute-and-sets-ctx-dry-run",
    title: "in a test run an action with a dryRun is simulated (dryRun runs instead of execute and the trace logs Simulated (test run): no effect), sideEffects: false wins over dryRun, ctx.dryRun is true for every step including actions without a dryRun, and Run now, triggers, InvokeProcedure and RunProcedure always call execute with ctx.dryRun false",
    entryPoint: "POST /procedures/:id/test, POST /procedures/:id/run-now, POST /verify-auto/invoke, POST /verify-auto/run, POST /verify-auto/emit",
    async run(/** @type {Ctx} */ ctx) {
      const body = [
        ["sim", "verify.effect", { label: "both" }],
        ["pure", "verify.effect-pure", { label: "pure" }],
        ["nodry", "verify.effect-nodry", { label: "nodry" }],
        ["ctx", "verify.context"],
      ];
      const draft = steps(body);
      const id = await createProcedure(ctx, { name: ctx.unique("Dry run"), graph: draft });
      await clearLedger(ctx);
      const tested = await test(ctx, id, draft, { confirmRealEffects: true });
      const testLedger = await ledger(ctx);
      const testRun = await runOf(ctx, text(tested.body, "runId"));
      const testSteps = Object.fromEntries(list(testRun, "trace", "steps").map((step) => [text(step, "nodeId"), step]));
      const logs = list((await auto(ctx, "test logs", "GET", `/runs/${text(tested.body, "runId")}/logs`)).body, "entries");
      const simulated = logs.filter((entry) => entry.message === "Simulated (test run): no effect");
      await ctx.verify("a test run", [
        statusIs(tested, 200, "the test answers 200"),
        same("the dry run ran for the step that declares one", ofKind(testLedger.entries, "dry-run").map((entry) => [entry.label, entry.ctxDryRun]), [["both", true]]),
        same("execute ran for the pure step and the step with neither member, with ctx.dryRun true", ofKind(testLedger.entries, "execute").map((entry) => [entry.label, entry.ctxDryRun]), [["pure", true], ["nodry", true]]),
        same("the simulated step's output", testSteps.sim?.output, { type: "object", value: { mode: "simulated", label: "both" } }),
        same("the pure step's output", testSteps.pure?.output, { type: "object", value: { mode: "executed", label: "pure" } }),
        same("the unflagged step's output", testSteps.nodry?.output, { type: "object", value: { mode: "executed", label: "nodry" } }),
        same("ctx.dryRun is true for an action without a dryRun", pick(testSteps.ctx, "output", "value", "dryRun"), true),
        same("the context carries the procedure and the node", [pick(testSteps.ctx, "output", "value", "procedureId"), pick(testSteps.ctx, "output", "value", "nodeId")], [id, "ctx"]),
        same("only the simulated step logs the notice", simulated.map((entry) => entry.nodeId), ["sim"]),
        same("at the info level", simulated.map((entry) => entry.level), ["info"]),
      ]);

      await clearLedger(ctx);
      const ran = await runNow(ctx, id, {});
      const runLedger = await ledger(ctx);
      const real = await runOf(ctx, ran.runId);
      const realSteps = Object.fromEntries(list(real, "trace", "steps").map((step) => [text(step, "nodeId"), step]));
      await ctx.verify("Run now calls execute with ctx.dryRun false", [
        same("status", ran.status, "ok"),
        same("every step executed", ofKind(runLedger.entries, "execute").map((entry) => [entry.label, entry.ctxDryRun]), [["both", false], ["pure", false], ["nodry", false]]),
        same("nothing was simulated", ofKind(runLedger.entries, "dry-run"), []),
        same("ctx.dryRun is false", pick(realSteps.ctx, "output", "value", "dryRun"), false),
        same("the run's kind", real.kind, "run"),
        same("the log has no simulation notice", list((await auto(ctx, "logs", "GET", `/runs/${ran.runId}/logs`)).body, "entries").filter((entry) => entry.message === "Simulated (test run): no effect").length, 0),
      ]);

      await clearLedger(ctx);
      const invoked = await fixture(ctx, "InvokeProcedure", "POST", "/invoke", { id, payload: {} });
      const viaRun = await fixture(ctx, "RunProcedure", "POST", "/run", { id });
      const viaCode = ofKind((await ledger(ctx)).entries, "execute");
      await ctx.verify("InvokeProcedure and RunProcedure call execute", [
        same("both answered", [pick(invoked.body, "ok"), pick(viaRun.body, "ok")], [true, true]),
        same("six executions, none a dry run", viaCode.map((entry) => entry.ctxDryRun), [false, false, false, false, false, false]),
        same("RunProcedure ended ok", pick(viaRun.body, "result", "status"), "ok"),
      ]);

      const eventId = (await enabledProcedure(ctx, { name: ctx.unique("Trigger run"), graph: chain([trigger("t", "verify.event", { topic: "dry" }), action("sim", "verify.effect", { label: "from a trigger" }), action("ctx", "verify.context")]) })).id;
      await clearLedger(ctx);
      await emit(ctx, "dry", { x: 1 });
      const [fired] = await runsUntil(ctx, eventId, 1);
      const triggered = await runOf(ctx, text(fired, "_id"));
      const fromTrigger = await ledger(ctx);
      await ctx.verify("a trigger's run calls execute", [
        same("executed, not simulated", [ofKind(fromTrigger.entries, "execute").map((entry) => [entry.label, entry.ctxDryRun]), ofKind(fromTrigger.entries, "dry-run").length], [[["from a trigger", false]], 0]),
        same("ctx.dryRun", pick(list(triggered, "trace", "steps").find((step) => step.nodeId === "ctx"), "output", "value", "dryRun"), false),
      ]);
    },
  },
];
