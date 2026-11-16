import { auto, check, fixture, isText, list, pick, same, text } from "../../auto.mjs";
import { action, chain, createProcedure, graph, ledger, manualLog, runsOfProcedure, statusIs, tedge, trigger } from "../../procs.mjs";
import { emit, enabledProcedure, ofKind, payloadOf, runDetail, runsUntil, saveGraph, summaryOf, summaryUntil, triggerGraph, eventGraph } from "./triggers-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const lifecycleJourneys = [
  {
    id: "a-trigger-that-never-arms-gives-up-after-ten-seconds",
    title: "activate and deactivate each get 10 seconds: a trigger whose activate never settles is an arming failure after 10 seconds and the procedure is Failing with the timeout, while the module keeps working",
    entryPoint: "RegisterTriggerType (verify.hang-arm), PUT /procedures/:id/enabled, GET /procedures/summary",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Hangs");
      const id = await createProcedure(ctx, { name, graph: triggerGraph("verify.hang-arm", {}) });
      const started = Date.now();
      const enabled = await auto(ctx, "enable a trigger that never arms", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const elapsed = Date.now() - started;
      const row = await summaryUntil(ctx, id, (candidate) => candidate.status === "failing", 5000);
      await ctx.verify("the arming gave up after 10 seconds", [
        statusIs(enabled, 200, "enabling answers 200"),
        check("the call waited for the timeout (9.5 to 14 s)", elapsed >= 9500 && elapsed <= 14_000, `${elapsed} ms`),
        same("the procedure is failing", row.status, "failing"),
        check("the reason names the timeout", /^\[dms-automation\] activate verify\.hang-arm for .+#t timed out after 10000ms$/.test(String(row.lastError)), row.lastError),
      ]);
      const other = await enabledProcedure(ctx, { name: ctx.unique("Still works"), graph: manualLog("ok") });
      const second = await summaryOf(ctx, other.id);
      await ctx.verify("the module keeps working", [statusIs(other.enabled, 200, "another procedure enables"), same("it is healthy", second.status, "healthy")]);
    },
  },
  {
    id: "a-trigger-is-deactivated-when-its-procedure-is-paused-deleted-or-edited",
    title: "pausing, deleting or changing the settings of a trigger deactivates the old handle before anything else fires; an edit that leaves the trigger alone keeps the handle and applies at the next fire; a restart arms the enabled procedures again",
    entryPoint: "PUT /procedures/:id/enabled, PUT /procedures/:id, DELETE /procedures/:id, POST /verify-auto/emit",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Lifecycle");
      const { id } = await enabledProcedure(ctx, { name, graph: eventGraph("one", "first") });
      await emit(ctx, "one", { v: 1 });
      await runsUntil(ctx, id, 1);

      await auto(ctx, "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled: false } });
      const afterPause = await ledger(ctx);
      const pausedEmit = await emit(ctx, "one", { v: 2 });
      const forced = await emit(ctx, "one", { v: 3 }, { force: true });
      await new Promise((resolve) => setTimeout(resolve, 700));
      await ctx.verify("pausing deactivates the handle", [
        same("deactivated once", ofKind(afterPause.entries, "deactivate").length, 1),
        same("no active handle answers", pausedEmit, 0),
        same("a handle that was let go starts no run, even when it still emits", [forced, (await runsOfProcedure(ctx, id)).length], [1, 1]),
        same("the ticks", (await ledger(ctx)).counters["tick:first"], 1),
      ]);

      await auto(ctx, "resume", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const resumed = await emit(ctx, "one", { v: 4 });
      await runsUntil(ctx, id, 2);
      await ctx.verify("resuming arms it again", [same("one active handle", resumed, 1), same("two runs", (await runsOfProcedure(ctx, id)).length, 2), same("activations so far", ofKind((await ledger(ctx)).entries, "activate").length, 2)]);

      const before = ofKind((await ledger(ctx)).entries, "activate").length;
      const retopic = await saveGraph(ctx, id, eventGraph("two", "second"), { enabled: true, name });
      const oldTopic = await emit(ctx, "one", { v: 5 });
      const newTopic = await emit(ctx, "two", { v: 6 });
      await runsUntil(ctx, id, 3);
      const afterRetopic = await ledger(ctx);
      await ctx.verify("changing the trigger's settings replaces its handle", [
        statusIs(retopic, 200, "saving answers 200"),
        same("the old topic answers nothing", oldTopic, 0),
        same("the new topic fires", newTopic, 1),
        same("one more activation", ofKind(afterRetopic.entries, "activate").length - before, 1),
        same("the new step ran", afterRetopic.counters["tick:second"], 1),
        same("the old step did not run again", afterRetopic.counters["tick:first"], 2),
      ]);

      const activations = ofKind((await ledger(ctx)).entries, "activate").length;
      const graphOnly = await saveGraph(ctx, id, chain([trigger("t", "verify.event", { topic: "two" }), action("tick", "verify.tick", { key: "third" })]), { enabled: true, name });
      const emitted = await emit(ctx, "two", { v: 7 });
      await runsUntil(ctx, id, 4);
      const afterGraph = await ledger(ctx);
      await ctx.verify("an edit that leaves the trigger alone keeps its handle and applies at the next fire", [
        statusIs(graphOnly, 200, "saving answers 200"),
        same("no new activation", ofKind(afterGraph.entries, "activate").length, activations),
        same("the existing handle fired", emitted, 1),
        same("the edited step ran", afterGraph.counters["tick:third"], 1),
      ]);

      await ctx.restartBackend();
      const reArmed = await ledger(ctx);
      const afterRestart = await emit(ctx, "two", { v: 8 });
      await runsUntil(ctx, id, 5);
      await ctx.verify("a restart arms the enabled procedures again", [same("activations after the restart", ofKind(reArmed.entries, "activate").map((entry) => entry.topic), ["two"]), same("an emit fires", afterRestart, 1), same("five runs in all", (await runsOfProcedure(ctx, id)).length, 5)]);

      const removed = await auto(ctx, "delete", "DELETE", `/procedures/${id}`);
      const afterDelete = await ledger(ctx);
      const deletedEmit = await emit(ctx, "two", { v: 9 });
      await ctx.verify("deleting deactivates the handle", [statusIs(removed, 200, "delete answers 200"), same("deactivated", ofKind(afterDelete.entries, "deactivate").map((entry) => entry.topic), ["two"]), same("nothing answers", deletedEmit, 0)]);
    },
  },
  {
    id: "a-trigger-whose-deactivate-never-settles-is-retried-on-the-next-reconcile",
    title: "a deactivate that does not settle gives up after 10 seconds and its handle is kept; the next reconcile retries the deactivation",
    entryPoint: "RegisterTriggerType (verify.hang-disarm), PUT /procedures/:id/enabled",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await enabledProcedure(ctx, { name: ctx.unique("Hangs on exit"), graph: eventGraph("exit", "exit", "verify.hang-disarm") });
      const started = Date.now();
      const pause = await auto(ctx, "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled: false } });
      const elapsed = Date.now() - started;
      const first = ofKind((await ledger(ctx)).entries, "deactivate-start").length;
      await enabledProcedure(ctx, { name: ctx.unique("Any other change"), graph: manualLog("x") });
      const retried = ofKind((await ledger(ctx)).entries, "deactivate-start").length;
      await ctx.verify("the failed deactivation is retried", [
        statusIs(pause, 200, "pausing answers 200"),
        check("the call waited for the 10-second limit", elapsed >= 9500 && elapsed <= 14_000, `${elapsed} ms`),
        same("one attempt for the pause", first, 1),
        check("a later reconcile tried again", retried > first, `${first} -> ${retried}`),
      ]);
    },
  },
  {
    id: "the-manual-trigger-starts-a-run-only-when-asked",
    title: "a Manual trigger has no settings and starts a run only from Run now or the API: the run's payload is what was sent, {} by default, then the last real payload; its Starts when reads Manual",
    entryPoint: "POST /procedures/:id/run-now, POST /verify-auto/invoke, GET /procedures/:id/last-payload, /modules/automation/procedures",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Manual");
      const { id } = await enabledProcedure(ctx, { name, graph: manualLog("manual ran") });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const idle = await runsOfProcedure(ctx, id);
      const first = await auto(ctx, "run now without a payload", "POST", `/procedures/${id}/run-now`, { body: {} });
      const second = await auto(ctx, "run now with a payload", "POST", `/procedures/${id}/run-now`, { body: { payload: { who: "Zoë 日本", n: [1, 2] } } });
      const third = await auto(ctx, "run now remembers the last real payload", "POST", `/procedures/${id}/run-now`, { body: {} });
      const invoked = await fixture(ctx, "InvokeProcedure", "POST", "/invoke", { id, payload: { from: "code" } });
      const runs = await runsUntil(ctx, id, 4);
      const payloads = [];
      for (const run of [...runs].reverse()) payloads.push(payloadOf(await runDetail(ctx, text(run, "_id"))));
      const types = list((await auto(ctx, "trigger types", "GET", "/trigger-types")).body);
      const manual = types.find((type) => type.id === "manual") ?? {};
      await ctx.verify("a manual trigger runs on request only", [
        same("nothing ran by itself", idle.length, 0),
        same("run now answers ok", [pick(first.body, "status"), pick(second.body, "status"), pick(third.body, "status")], ["ok", "ok", "ok"]),
        same("InvokeProcedure returned a run id", isText(pick(invoked.body, "result")), true),
        same("the payloads in order", payloads, [{}, { who: "Zoë 日本", n: [1, 2] }, { who: "Zoë 日本", n: [1, 2] }, { from: "code" }]),
        same("the manual trigger has no settings", manual.configSchema, { type: "object", properties: {}, additionalProperties: false }),
        same("its outputs", manual.outputSchema, { type: "object" }),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/procedures");
      await ctx.verify("the Procedures page", [await tab.shows(new RegExp(`${name}[\\s\\S]{0,80}Manual`))]);
    },
  },
  {
    id: "the-starts-when-column-names-the-trigger-and-counts-the-others",
    title: "the Starts when column words a webhook as METHOD /path (POST by default) with its type under it, a schedule in words with its type, a DMS event or a Manual trigger by its name alone, and says how many more triggers a procedure has",
    entryPoint: "GET /procedures/summary, /modules/automation/procedures",
    async run(/** @type {Ctx} */ ctx) {
      const many = (/** @type {string} */ name, /** @type {[string, Record<string, unknown>][]} */ triggers) => createProcedure(ctx, {
        name,
        graph: graph([...triggers.map(([typeId, config], index) => trigger(`t${index}`, typeId, config)), action("log", "log.message", { message: "x" })], triggers.map((_, index) => tedge(`t${index}`, "log"))),
      });
      const three = await many("Multi three", [["webhook", { path: "/hooks/stripe" }], ["schedule.cron", { cron: "0 * * * *" }], ["manual", {}]]);
      const two = await many("Multi two", [["manual", {}], ["verify.event", { topic: "x" }]]);
      const event = await many("Event only", [["dms.user-registered", {}]]);
      const manual = await many("Manual only", [["manual", {}]]);
      const get = await many("Get only", [["webhook", { path: "/hooks/x", method: "GET" }]]);
      const rows = {};
      for (const [key, id] of Object.entries({ three, two, event, manual, get })) rows[key] = await summaryOf(ctx, id);
      await ctx.verify("the summary", [
        same("a webhook without a method", [rows.three.triggerText, rows.three.triggerTypeText, rows.three.triggerCount], ["POST /hooks/stripe", { key: "dms_automation.procedures.detail.moreTriggers", params: { type: { key: "dms_automation.types.webhook.name" }, count: { type: "count", value: 2 } } }, 3]),
        same("a webhook with a method", [rows.get.triggerText, rows.get.triggerTypeText, rows.get.triggerCount], ["GET /hooks/x", "$dms_automation.types.webhook.name", 1]),
        same("a Manual trigger is its own name", [rows.manual.triggerText, rows.manual.triggerTypeText, rows.manual.triggerCount], ["$dms_automation.types.manual.name", null, 1]),
        same("a DMS event is its own name", [rows.event.triggerText, rows.event.triggerTypeText], ["$dms.automation.triggers.userRegistered.name", null]),
        same("two triggers", [rows.two.triggerText, rows.two.triggerCount], ["$dms_automation.types.manual.name", 2]),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/procedures");
      await ctx.verify("the Procedures page", [
        await tab.shows(/Multi three\s+Draft\s+POST \/hooks\/stripe\s+Webhook · \+2 more/),
        await tab.shows(/Multi two\s+Draft\s+Manual\s+\+1 more trigger/),
        await tab.shows(/Event only\s+Draft\s+User registered/),
        await tab.shows(/Manual only\s+Draft\s+Manual\s+/),
        await tab.shows(/Get only\s+Draft\s+GET \/hooks\/x\s+Webhook/),
      ]);
    },
  },
];
