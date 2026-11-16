import { guarded } from "../guard.mjs";
import { auto, check, list, pick, raw, same, text } from "../auto.mjs";
import { action, chain, clearLedger, createProcedure, graph, ledger, manualLog, runNow, runsOfProcedure, statusIs, tedge, trigger } from "../procs.mjs";
import { payloadOf, runDetail, summaryOf } from "./parts/triggers-common.mjs";
import { steps, test } from "./parts/test-runs-kit.mjs";
import { effectsJourneys } from "./parts/test-runs-effects.mjs";
import { builderJourneys } from "./parts/test-runs-builder.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

export const journeys = guarded([
  ...effectsJourneys,
  {
    id: "a-test-run-is-kept-as-a-test-run-of-the-draft-and-never-counts",
    title: "a test runs the unsaved draft without saving it, is stored with its trace as a test (no saved version), and never counts in the procedure's states, runs, last runs, KPIs, charts or Needs attention, even when it fails; Run now counts",
    entryPoint: "POST /procedures/:id/test, GET /runs/:id, GET /procedures/summary, GET /stats/*",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Counting");
      const saved = manualLog("the saved graph");
      const id = await createProcedure(ctx, { name, graph: saved });
      const before = await auto(ctx, "read the procedure", "GET", `/procedures/${id}`);
      const draft = steps([["note", "log.message", { message: "the DRAFT 日本 😀" }]]);
      const ok = await test(ctx, id, draft, { payload: { sample: "é" } });
      const okRun = await runDetail(ctx, text(ok.body, "runId"));
      const logs = list((await auto(ctx, "test logs", "GET", `/runs/${text(ok.body, "runId")}/logs`)).body, "entries").map((entry) => text(entry, "message"));
      const after = await auto(ctx, "read the procedure again", "GET", `/procedures/${id}`);
      await ctx.verify("the test", [
        statusIs(ok, 200, "the test answers 200"),
        same("it ran the draft, not the saved graph", [logs.includes("the DRAFT 日本 😀"), logs.includes("the saved graph")], [true, false]),
        same("kind", okRun.kind, "test"),
        same("no saved version", okRun.procedureVersion, null),
        same("it kept the draft's graph", list(okRun, "graph", "nodes").map((node) => node.id), ["t", "note"]),
        same("the payload it received", payloadOf(okRun), { sample: "é" }),
        same("the trace lists the steps", list(okRun, "trace", "steps").map((step) => step.nodeId), ["t", "note"]),
        same("the saved procedure did not change", [pick(after.body, "version"), pick(after.body, "revision"), JSON.stringify(pick(after.body, "graph"))], [pick(before.body, "version"), pick(before.body, "revision"), JSON.stringify(pick(before.body, "graph"))]),
      ]);

      const failing = steps([["boom", "verify.fail", { message: "a failing test" }]]);
      const bad = await test(ctx, id, failing, { confirmRealEffects: true });
      const badRun = await runDetail(ctx, text(bad.body, "runId"));
      const row = await summaryOf(ctx, id);
      const attention = list((await auto(ctx, "needs attention", "GET", "/stats/attention")).body, "items");
      const health = (await auto(ctx, "health", "GET", "/stats/health")).body;
      const recent = list((await auto(ctx, "recent runs", "GET", "/stats/recent-runs")).body, "items");
      const kpi = (await auto(ctx, "runs kpi", "GET", "/stats/kpi/runs?preset=24h")).body;
      const chartTotal = async (/** @type {string} */ label) => {
        const chart = (await auto(ctx, label, "GET", "/stats/runs-per-day?preset=24h")).body;
        return [pick(chart, "value"), list(chart, "series").flatMap((series) => list(series, "data")).reduce((sum, point) => sum + Number(point.y), 0)];
      };
      const chart = await chartTotal("runs chart");
      const listed = await runsOfProcedure(ctx, id);
      await ctx.verify("tests, failing ones included, never count", [
        same("a failing test answers 200 with its status", [statusIs(bad, 200).pass, pick(bad.body, "status")], [true, "failed"]),
        same("the failed test's error", badRun.errorMessage, "a failing test"),
        same("the procedure is still a draft", [row.status, row.runs, row.failed, row.lastRunId, row.lastRuns, row.successRate], ["draft", 0, 0, null, [], null]),
        same("no attention", attention, []),
        same("the health banner has nothing to report", pick(health, "title", "key"), "dms_automation.health.idle"),
        same("no recent run", recent, []),
        same("the runs KPI", pick(kpi, "value"), 0),
        same("the runs chart's total and bars", chart, [0, 0]),
        same("the procedure's own runs list shows the tests", listed.map((run) => String(run.kind)).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)), ["test", "test"]),
      ]);

      await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const real = await runNow(ctx, id, {});
      const counted = await summaryOf(ctx, id);
      const kpiAfter = (await auto(ctx, "runs kpi after", "GET", "/stats/kpi/runs?preset=24h")).body;
      const recentAfter = list((await auto(ctx, "recent runs after", "GET", "/stats/recent-runs")).body, "items");
      await ctx.verify("Run now counts", [
        same("one run", [counted.runs, counted.failed, counted.status], [1, 0, "healthy"]),
        same("the last run is the real one", counted.lastRunId, real.runId),
        same("the KPI counts it", pick(kpiAfter, "value"), 1),
        same("the chart counts it", await chartTotal("runs chart after"), [1, 1]),
        same("the recent runs list it alone", recentAfter.length, 1),
      ]);
      const anotherTest = await test(ctx, id, failing, { confirmRealEffects: true });
      const still = await summaryOf(ctx, id);
      await ctx.verify("a test after a real run changes nothing", [statusIs(anotherTest, 200, "the test answers 200"), same("runs, failed and state", [still.runs, still.failed, still.status], [1, 0, "healthy"])]);
    },
  },
  {
    id: "a-test-run-refuses-what-the-builder-would-not-let-through",
    title: "a test is refused before anything runs when the draft has errors (400 with the issues), no trigger, an unknown trigger node, a missing graph or an unknown procedure (404), and a test picks the Manual trigger by default or the trigger it is told to",
    entryPoint: "POST /procedures/:id/test",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: ctx.unique("Refusals"), graph: manualLog("x") });
      await clearLedger(ctx);
      const empty = await test(ctx, id, graph([]));
      const onlyAction = await test(ctx, id, graph([action("log", "log.message", { message: "x" })]));
      const unknownType = await test(ctx, id, chain([trigger("t", "manual"), action("a", "no.such.action")]));
      const unknownTrigger = await test(ctx, id, manualLog("x"), { triggerNodeId: "ghost" });
      const missing = await auto(ctx, "test without a graph", "POST", `/procedures/${id}/test`, { body: {} });
      const noProcedure = await auto(ctx, "test on an unknown procedure", "POST", "/procedures/nope/test", { body: { graph: manualLog("x") } });
      const getTest = await raw(ctx, "GET on the test route", { path: `/api/automation/procedures/${id}/test`, method: "GET", as: "admin" });
      const idle = await ledger(ctx);
      await ctx.verify("refusals", [
        statusIs(empty, 400, "an empty draft answers 400"),
        same("an empty draft's error", [text(empty.body, "error"), text(empty.body, "message")], ["the draft has no trigger to run from", "$dms_automation.api.noTriggerToRun"]),
        statusIs(onlyAction, 400, "a draft with no trigger answers 400"),
        statusIs(unknownType, 400, "an unknown action type answers 400"),
        same("the issue", list(unknownType.body, "issues").map((issue) => `${text(issue, "code")} ${text(issue, "message")}`), ['unknownType action node "a" references unknown type "no.such.action"']),
        same("the message", text(unknownType.body, "message"), "$dms_automation.api.graphHasErrors"),
        statusIs(unknownTrigger, 404, "an unknown trigger node answers 404"),
        same("its error", text(unknownTrigger.body, "error"), 'trigger "ghost" is not in the draft'),
        statusIs(missing, 400, "a body without a graph answers 400"),
        statusIs(noProcedure, 404, "an unknown procedure answers 404"),
        same("its error text", text(noProcedure.body, "error"), 'procedure "nope" not found'),
        same("GET is not the test route", getTest.status === 404 || getTest.status === 405, true),
        same("nothing ran", [idle.entries, (await runsOfProcedure(ctx, id)).length], [[], 0]),
      ]);

      const odd = [];
      /** @type {[string, string[]][]} */
      const routes = [
        [`/api/automation/procedures/${id}/test`, ["GET", "PUT", "PATCH", "DELETE", "HEAD"]],
        [`/api/automation/procedures/${id}/test-effects`, ["GET", "PUT", "PATCH", "DELETE", "HEAD"]],
        [`/api/automation/procedures/${id}/run-now`, ["GET", "PUT", "PATCH", "DELETE", "HEAD"]],
        [`/api/automation/procedures/${id}/last-payload`, ["POST", "PUT", "PATCH", "DELETE"]],
        [`/api/automation/procedures/${id}/triggers`, ["POST", "PUT", "PATCH", "DELETE"]],
        ["/api/automation/library/webhook-base", ["POST", "PUT", "PATCH", "DELETE"]],
      ];
      for (const [path, methods] of routes) {
        for (const method of methods) {
          const answer = await raw(ctx, `${method} ${path}`, { path, method, as: "admin", headers: { "content-type": "application/json" }, body: method === "HEAD" || method === "GET" ? undefined : JSON.stringify({ graph: steps([["tick", "verify.tick", { key: "odd" }]]), confirmRealEffects: true }) });
          odd.push(check(`${method} ${path.replace(id, "<id>")} is not served`, answer.status === 404 || answer.status === 405, answer.status));
        }
      }
      const afterOdd = await ledger(ctx);
      await ctx.verify("a route answers only its documented method", [...odd, same("nothing ran", [afterOdd.entries, (await runsOfProcedure(ctx, id)).length], [[], 0])]);

      const two = graph([trigger("web", "webhook", { path: "/webhooks/tr/two" }), trigger("manual", "manual"), action("tick", "verify.tick", { key: "picked" })], [tedge("web", "tick"), tedge("manual", "tick")]);
      const byDefault = await test(ctx, id, two, { payload: { n: 1 }, confirmRealEffects: true });
      const chosen = await test(ctx, id, two, { payload: { n: 2 }, triggerNodeId: "web", confirmRealEffects: true });
      const firstOnly = await test(ctx, id, graph([trigger("web", "webhook", { path: "/webhooks/tr/one" }), action("tick", "verify.tick", { key: "picked" })], [tedge("web", "tick")]), { confirmRealEffects: true });
      const byDefaultRun = await runDetail(ctx, text(byDefault.body, "runId"));
      const chosenRun = await runDetail(ctx, text(chosen.body, "runId"));
      const firstRun = await runDetail(ctx, text(firstOnly.body, "runId"));
      await ctx.verify("which trigger a test starts from", [
        same("the Manual trigger by default", [byDefaultRun.triggerNodeId, payloadOf(byDefaultRun)], ["manual", { n: 1 }]),
        same("the trigger it is told to", [chosenRun.triggerNodeId, payloadOf(chosenRun)], ["web", { n: 2 }]),
        same("the first trigger when there is no Manual one, with {} as the default payload", [firstRun.triggerNodeId, payloadOf(firstRun)], ["web", {}]),
      ]);
    },
  },
  {
    id: "the-test-payload-comes-from-the-last-real-run",
    title: "Run now and the test payload default to the trigger's last real payload (test runs excluded), or {} when there is none; an explicit payload wins",
    entryPoint: "GET /procedures/:id/last-payload, POST /procedures/:id/run-now, POST /procedures/:id/test",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: ctx.unique("Payloads"), graph: chain([trigger("t", "manual"), action("tick", "verify.tick", { key: "p" })]) });
      const none = await auto(ctx, "last payload with no run", "GET", `/procedures/${id}/last-payload`);
      const first = await runNow(ctx, id);
      const emptyRun = await runDetail(ctx, first.runId);
      await ctx.verify("with no earlier run", [same("nothing to offer", [pick(none.body, "last"), pick(none.body, "tooLarge")], [null, false]), same("Run now sends {}", payloadOf(emptyRun), {})]);

      const real = await runNow(ctx, id, { real: "run", n: [1, 2], text: "Zoë" });
      const afterReal = await auto(ctx, "last payload after a real run", "GET", `/procedures/${id}/last-payload`);
      const testOnly = await test(ctx, id, steps([["tick", "verify.tick", { key: "p" }]]), { payload: { only: "a test" }, confirmRealEffects: true });
      const afterTest = await auto(ctx, "last payload after a test", "GET", `/procedures/${id}/last-payload`);
      const defaulted = await auto(ctx, "run now without a payload", "POST", `/procedures/${id}/run-now`, { body: {} });
      const defaultedRun = await runDetail(ctx, text(defaulted.body, "runId"));
      const explicit = await runNow(ctx, id, { explicit: true });
      const bare = await auto(ctx, "run now without a body", "POST", `/procedures/${id}/run-now`);
      const bareRun = await runDetail(ctx, text(bare.body, "runId"));
      await ctx.verify("the last real payload", [
        same("it is the real run's", [pick(afterReal.body, "last", "runId"), pick(afterReal.body, "last", "payload")], [real.runId, { real: "run", n: [1, 2], text: "Zoë" }]),
        statusIs(testOnly, 200, "the test answers 200"),
        same("a test does not replace it", pick(afterTest.body, "last", "payload"), { real: "run", n: [1, 2], text: "Zoë" }),
        same("Run now without a payload re-sends it", payloadOf(defaultedRun), { real: "run", n: [1, 2], text: "Zoë" }),
        same("an explicit payload wins", payloadOf(await runDetail(ctx, explicit.runId)), { explicit: true }),
        same("Run now without a body re-sends the last real payload", payloadOf(bareRun), { explicit: true }),
        same("the last payload now", pick((await auto(ctx, "last payload again", "GET", `/procedures/${id}/last-payload`)).body, "last", "payload"), { explicit: true }),
      ]);

      const web = graph([trigger("w", "webhook", { path: "/webhooks/tr/last" }), trigger("m", "manual"), action("tick", "verify.tick", { key: "q" })], [tedge("w", "tick"), tedge("m", "tick")]);
      const multi = await createProcedure(ctx, { name: ctx.unique("Two triggers"), graph: web });
      await auto(ctx, "run from the webhook", "POST", `/procedures/${multi}/run-now`, { body: { payload: { from: "w" }, triggerNodeId: "w" } });
      await auto(ctx, "run from the manual trigger", "POST", `/procedures/${multi}/run-now`, { body: { payload: { from: "m" }, triggerNodeId: "m" } });
      const forW = await auto(ctx, "last payload of the webhook", "GET", `/procedures/${multi}/last-payload?triggerNodeId=w`);
      const forM = await auto(ctx, "last payload of the manual trigger", "GET", `/procedures/${multi}/last-payload?triggerNodeId=m`);
      const missingNode = await auto(ctx, "last payload of a node that never ran", "GET", `/procedures/${multi}/last-payload?triggerNodeId=zzz`);
      const unknownProcedure = await auto(ctx, "last payload of an unknown procedure", "GET", "/procedures/nope/last-payload");
      await ctx.verify("the last payload of each trigger", [
        same("the webhook's", pick(forW.body, "last", "payload"), { from: "w" }),
        same("the Manual trigger's", pick(forM.body, "last", "payload"), { from: "m" }),
        same("a trigger that never ran", pick(missingNode.body, "last"), null),
        statusIs(unknownProcedure, 404, "an unknown procedure answers 404"),
      ]);
    },
  },
  ...builderJourneys,
]);
