import { guarded } from "../guard.mjs";
import { auto, check, fixture, list, pick, same, text } from "../auto.mjs";
import { clearLedger, createProcedure, ledger, manualLog, runsOfProcedure, statusIs } from "../procs.mjs";
import { emit, enabledProcedure, ofKind, payloadOf, runDetail, runsUntil, saveGraph, summaryOf, summaryUntil, triggerGraph, eventGraph } from "./parts/triggers-common.mjs";
import { lifecycleJourneys } from "./parts/triggers-lifecycle.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "a-replicated-trigger-starts-a-run-with-the-payload-it-emits",
    title: "a replicated trigger (the module's Webhook and Manual are replicated; a module's own type is declared so) is armed with its settings, and each emit starts one run per armed procedure with the emitted JSON as payload, the trigger's output and the run's stored payload",
    entryPoint: "RegisterTriggerType (verify.event), POST /verify-auto/emit, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const one = (await enabledProcedure(ctx, { name: ctx.unique("Alpha one"), graph: eventGraph("alpha", "alpha") })).id;
      const two = (await enabledProcedure(ctx, { name: ctx.unique("Alpha two"), graph: eventGraph("alpha", "alpha") })).id;
      const beta = (await enabledProcedure(ctx, { name: ctx.unique("Beta"), graph: eventGraph("beta", "beta") })).id;
      const armed = await ledger(ctx);
      await ctx.verify("enabling arms each trigger with its own settings", [same("activations", ofKind(armed.entries, "activate").map((entry) => [entry.type, entry.topic]).sort((x, y) => String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0), [["verify.event", "alpha"], ["verify.event", "alpha"], ["verify.event", "beta"]])]);
      const payload = { topic: "alpha", value: "héllo 日本 😀", extra: { n: [1, 2.5, { a: null }], t: true } };
      const emitted = await emit(ctx, "alpha", payload);
      const [first] = await runsUntil(ctx, one, 1);
      const [second] = await runsUntil(ctx, two, 1);
      const none = await runsOfProcedure(ctx, beta);
      const detail = await runDetail(ctx, text(first, "_id"));
      await ctx.verify("an emit reaches the armed procedures of its topic", [
        same("two handles were fired", emitted, 2),
        same("first procedure ran once", (await runsOfProcedure(ctx, one)).length, 1),
        same("second procedure ran once", (await runsOfProcedure(ctx, two)).length, 1),
        same("the other topic did not run", none.length, 0),
        same("the stored payload", payloadOf(detail), payload),
        same("the run's trigger", [text(detail, "trigger", "typeId"), detail.kind, detail.status], ["verify.event", "run", "ok"]),
        same("the trigger step's output is the payload", list(detail, "trace", "steps")[0]?.output, { type: "object", value: payload }),
        same("the second run has the same payload", payloadOf(await runDetail(ctx, text(second, "_id"))), payload),
        same("the step ran once per run", (await ledger(ctx)).counters["tick:alpha"], 2),
      ]);

      const values = [["a string", "plain text é"], ["a number", 42], ["zero", 0], ["null", null], ["an array", [1, "two", [3]]], ["false", false], ["an empty object", {}], ["a long text", "x".repeat(5000)]];
      const stored = [];
      let count = 1;
      for (const [label, value] of values) {
        await emit(ctx, "alpha", value);
        count += 1;
        const runs = await runsUntil(ctx, one, count);
        stored.push(same(label, payloadOf(await runDetail(ctx, text(runs[0], "_id"))), value));
      }
      await ctx.verify("every JSON value is the payload as emitted", stored);
      const history = await runsOfProcedure(ctx, one);
      await ctx.verify("the runs are newest first", [same("started order", history.map((run) => new Date(String(run.startedAt)).getTime()), history.map((run) => new Date(String(run.startedAt)).getTime()).sort((a, b) => b - a))]);
    },
  },
  {
    id: "a-singleton-trigger-fires-once-in-standalone-mode-and-modes-are-shown",
    title: "a singleton trigger is armed on the single standalone instance and fires like any other; each trigger type shows its cluster mode (Manual and Webhook replicated, Schedule singleton) in the API and the Library",
    entryPoint: "RegisterTriggerType (verify.leader-event), GET /trigger-types, /modules/automation/library",
    async run(/** @type {Ctx} */ ctx) {
      const id = (await enabledProcedure(ctx, { name: ctx.unique("Leader"), graph: eventGraph("gamma", "gamma", "verify.leader-event") })).id;
      const emitted = await emit(ctx, "gamma", { topic: "gamma", value: "solo" });
      const runs = await runsUntil(ctx, id, 1);
      await ctx.verify("a singleton trigger fires on the sole instance", [same("one handle fired", emitted, 1), same("one run", runs.length, 1), same("its payload", payloadOf(await runDetail(ctx, text(runs[0], "_id"))), { topic: "gamma", value: "solo" })]);

      const types = list((await auto(ctx, "trigger types", "GET", "/trigger-types")).body);
      const modes = Object.fromEntries(types.map((type) => [text(type, "id"), type.cluster]));
      await ctx.verify("the cluster mode of each trigger type", [
        same("manual", modes.manual, "replicated"),
        same("webhook", modes.webhook, "replicated"),
        same("schedule.cron", modes["schedule.cron"], "singleton"),
        same("verify.event", modes["verify.event"], "replicated"),
        same("verify.leader-event", modes["verify.leader-event"], "singleton"),
      ]);

      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      const open = async (/** @type {string} */ name, /** @type {RegExp} */ expected) => {
        await tab.goto("/modules/automation/library?tab=triggers");
        let shown = await tab.shows(expected, { timeoutMs: 1000 });
        for (let attempt = 0; attempt < 6 && !shown.pass; attempt += 1) {
          await tab.click({ role: "button", name });
          shown = await tab.shows(expected, { timeoutMs: 4000 });
        }
        return shown;
      };
      await ctx.verify("the Library shows the mode after the id", [
        await open("Manual Started with Run now", /id · manual · cluster · replicated/),
        await open("Webhook Registers an HTTP endpoint", /id · webhook · cluster · replicated/),
        await open("Schedule (cron) Fires on a cron schedule", /id · schedule\.cron · cluster · singleton/),
        await open("Fixture leader event", /id · verify\.leader-event · cluster · singleton/),
      ]);
      await ctx.verify("and words it", [
        await open("Webhook Registers an HTTP endpoint", /Replicated across instances/i),
        await tab.shows(/Every automation instance listens; each call is handled by exactly one of them\./),
        await open("Schedule (cron) Fires on a cron schedule", /Runs on one instance/i),
        await tab.shows(/Only the leader instance runs it, so it fires once however many instances run\./),
      ]);
    },
  },
  {
    id: "a-trigger-that-cannot-arm-makes-its-procedure-failing-with-the-reason",
    title: "an enabled procedure whose trigger's activate throws is Failing, shows the thrown message after Trigger not armed:, has no run to open, and is back to normal once paused or fixed",
    entryPoint: "RegisterTriggerType (verify.bad-arm), GET /procedures/summary, /modules/automation/procedures, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Cannot arm");
      const { id, enabled } = await enabledProcedure(ctx, { name, graph: triggerGraph("verify.bad-arm", {}) });
      const row = await summaryUntil(ctx, id, (candidate) => candidate.status === "failing");
      await ctx.verify("the procedure is failing with the thrown message", [
        statusIs(enabled, 200, "enabling is accepted"),
        same("the state", row.status, "failing"),
        same("the last error", row.lastError, "the fixture refuses to arm"),
        same("the reason as the pages word it", row.statusDetail, { key: "dms_automation.procedures.detail.triggerError", params: { error: { key: "dms_automation.editor.problems.codes.armFailed", params: { error: "the fixture refuses to arm" } } } }),
        same("it never ran", [row.runs, row.lastRunId], [0, null]),
        same("activate was attempted", ofKind((await ledger(ctx)).entries, "activate-refused").length >= 1, true),
      ]);
      const attention = list((await auto(ctx, "needs attention", "GET", "/stats/attention")).body, "items");
      await ctx.verify("Needs attention", [
        same("the procedure", attention.map((item) => text(item, "name")), [name]),
        same("its state", attention.map((item) => item.state), ["failing"]),
        same("its arm error", pick(attention[0], "armError"), { code: "armFailed", params: { error: "the fixture refuses to arm" }, message: "the fixture refuses to arm" }),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/procedures");
      const procedures = await tab.shows(new RegExp(`${name}\\s+Failing\\s+Trigger not armed: This trigger could not start: the fixture refuses to arm`));
      await tab.goto("/modules/automation/overview");
      await ctx.verify("the pages", [
        procedures,
        await tab.shows(/1 procedure failing/),
        await tab.shows(new RegExp(`${name} · failing since — · Trigger not armed: This trigger could not start: the fixture refuses to arm`)),
        await tab.shows(/Open last failure/, { not: true, timeoutMs: 2000 }),
        await tab.shows(/Show failing procedures/, { not: true, timeoutMs: 2000 }),
      ]);
      const attempts = ofKind((await ledger(ctx)).entries, "activate-refused").length;
      await enabledProcedure(ctx, { name: ctx.unique("Any other change"), graph: manualLog("x") });
      const retried = ofKind((await ledger(ctx)).entries, "activate-refused").length;
      await ctx.verify("a failed activation is retried on the next reconcile", [check("activate was attempted again", retried > attempts, `${attempts} -> ${retried}`)]);
      const pause = await auto(ctx, "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled: false } });
      const paused = await summaryOf(ctx, id);
      const resume = await auto(ctx, "resume", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const failing = await summaryUntil(ctx, id, (candidate) => candidate.status === "failing");
      const fixed = await saveGraph(ctx, id, manualLog("now fine"), { enabled: true, name });
      const healthy = await summaryUntil(ctx, id, (candidate) => candidate.status === "healthy");
      await ctx.verify("pausing hides the reason, resuming brings it back, replacing the trigger clears it", [
        statusIs(pause, 200, "pausing answers 200"),
        same("paused", [paused.status, paused.lastError], ["paused", null]),
        statusIs(resume, 200, "resuming answers 200"),
        same("failing again", failing.status, "failing"),
        statusIs(fixed, 200, "saving a graph with a Manual trigger answers 200"),
        same("healthy", [healthy.status, healthy.lastError], ["healthy", null]),
      ]);
    },
  },
  {
    id: "a-trigger-type-that-is-not-available-reads-trigger-type-id-is-not-available-and-arms-when-it-registers",
    title: "when the module that registers a trigger type goes away, its enabled procedures are Failing with trigger type \"<id>\" is not available and their handles are deactivated; a type that registers late arms them as soon as it registers",
    entryPoint: "UnregisterTriggerType / RegisterTriggerType (verify.event), GET /procedures/summary, /modules/automation/procedures",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Late type");
      const { id } = await enabledProcedure(ctx, { name, graph: eventGraph("late", "late") });
      const healthy = await summaryOf(ctx, id);
      await clearLedger(ctx);
      await fixture(ctx, "unregister the trigger type", "POST", "/types/unregister", { kind: "trigger", id: "verify.event" });
      const rightAfter = await ledger(ctx);
      const row = await summaryUntil(ctx, id, (candidate) => candidate.status === "failing");
      const afterUnregister = await ledger(ctx);
      const emittedAway = await emit(ctx, "late", { n: 1 });
      await ctx.verify("the type is gone", [
        same("it was healthy before", healthy.status, "healthy"),
        same("the procedure is failing", row.status, "failing"),
        same("the reason", row.lastError, 'trigger type "verify.event" is not available'),
        same("the reason as the pages word it", row.statusDetail, { key: "dms_automation.procedures.detail.triggerError", params: { error: { key: "dms_automation.editor.problems.codes.unknownType", params: { type: "verify.event" } } } }),
        same("its handle was deactivated before the unregister call returned", ofKind(rightAfter.entries, "deactivate").map((entry) => entry.topic), ["late"]),
        same("and only once", ofKind(afterUnregister.entries, "deactivate").length, 1),
        same("nothing fires", emittedAway, 0),
        same("no run", (await runsOfProcedure(ctx, id)).length, 0),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/procedures");
      await ctx.verify("the Procedures page", [await tab.shows(new RegExp(`${name}\\s+Failing\\s+Trigger not armed: Unknown type “verify\\.event”: the module that provides it may be missing\\.`))]);

      const back = await fixture(ctx, "register the trigger type again", "POST", "/types/register", { kind: "trigger", id: "verify.event" });
      const recovered = await summaryUntil(ctx, id, (candidate) => candidate.status === "healthy");
      const fired = await emit(ctx, "late", { n: 2 });
      const runs = await runsUntil(ctx, id, 1);
      await ctx.verify("a type that registers late arms the procedure at once", [
        same("registration answered", pick(back.body, "ok"), true),
        same("the procedure is healthy", [recovered.status, recovered.lastError], ["healthy", null]),
        same("a new handle was activated", ofKind((await ledger(ctx)).entries, "activate").map((entry) => entry.topic), ["late"]),
        same("an emit fires it", fired, 1),
        same("a run started with the payload", payloadOf(await runDetail(ctx, text(runs[0], "_id"))), { n: 2 }),
      ]);

      const ghost = await createProcedure(ctx, { name: ctx.unique("Ghost"), graph: triggerGraph("ghost.type", {}) });
      const refused = await auto(ctx, "enable a procedure with an unknown trigger type", "PUT", `/procedures/${ghost}/enabled`, { body: { enabled: true } });
      await ctx.verify("an unknown type cannot be enabled from the API", [
        statusIs(refused, 400, "enabling answers 400"),
        same("the refusal", list(refused.body, "issues").map((issue) => `${text(issue, "code")} ${text(issue, "message")}`), ['unknownType trigger node "t" references unknown type "ghost.type"']),
      ]);
    },
  },
  ...lifecycleJourneys,
]);
