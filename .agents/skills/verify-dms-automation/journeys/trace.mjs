import { guarded } from "../guard.mjs";
import { auto, check, list, pick, same, text } from "../auto.mjs";
import { chain, action, createEnabled, runNow, trigger } from "../procs.mjs";
import { bodyText, graphWithMessage, openPage, saveGraph, size, storedRun, textWhen, twoStepProcedure, withRuns } from "./parts/runs-common.mjs";
import { rerunJourneys } from "./parts/trace-rerun.mjs";
import { seededFailures } from "./parts/trace-seed.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

const flat = (/** @type {string} */ value) => value.replace(/\s+/g, " ").trim();

export const journeys = guarded([
  {
    id: "the-trace-header-and-figures-describe-a-succeeded-run",
    title: "the trace of /modules/automation/trace?run=<id> names the procedure, the run id and how the run started, offers Previous run and Next run with the outcome, and shows the Status, Duration, Trigger and Procedure version figures",
    entryPoint: "GET /runs/:id, /modules/automation/trace?run=",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Header ☕ 日本");
      const id = await twoStepProcedure(ctx, name);
      const first = (await runNow(ctx, id, { n: 1 })).runId;
      const second = (await runNow(ctx, id, { n: 2 })).runId;
      const third = (await runNow(ctx, id, { n: 3 })).runId;
      const run = await auto(ctx, "read the middle run", "GET", `/runs/${second}`);
      const body = run.body;
      const steps = list(body, "trace", "steps");
      await ctx.verify("the run as the API gives it", [
        same("previous and next", [pick(body, "previous", "runId"), pick(body, "previous", "status"), pick(body, "next", "runId"), pick(body, "next", "status")], [first, "ok", third, "ok"]),
        same("steps in order", steps.map((step) => [step.nodeId, step.status]), [["t", "ok"], ["a", "ok"], ["b", "ok"]]),
        same("the trigger step's output is the payload", pick(steps[0], "output"), { type: "object", value: { n: 2 } }),
        same("nothing skipped, both edges taken", [pick(body, "trace", "skipped"), size(body, "trace", "edgesTaken")], [[], 2]),
        same("procedure, version, kind, payload kept", [pick(body, "procedure", "name"), pick(body, "procedureVersion"), pick(body, "kind"), pick(body, "payloadKept"), pick(body, "graphOutdated")], [name, 1, "run", true, false]),
        same("no failure, no run in a row", [pick(body, "failedStep"), pick(body, "failuresInRow")], [null, 0]),
        same("the log count", pick(body, "logCount"), 8),
      ]);
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${second}`, /Run history/);
      const shown = flat(await textWhen(tab, /PROCEDURE VERSION/, 40_000));
      const instance = text(body, "instanceId").slice(0, 8);
      await ctx.verify("the header", [
        check("procedure, outcome, run id, start, trigger, instance", shown.includes(`${name} Succeeded ${second} Copy Started`) || shown.includes(`${name} Succeeded ${second} Started`), shown.slice(0, 600)),
        check("Started <date> · Manual", /Started [A-Z][a-z]{2} \d+, \d+:\d\d (AM|PM) · Manual/.test(shown), shown.slice(0, 600)),
        check("the instance is named by its first 8 characters", shown.includes(`instance ${instance}`), instance),
        check("Previous run and Next run, each with its outcome", /Previous run \(Succeeded\) Next run \(Succeeded\) Re-run with this payload Debug in builder/.test(shown), shown.slice(0, 600)),
        check("the four figures", /STATUS Succeeded 3 steps ran DURATION \d+ ms( [−+]\d+ ms vs usual)? TRIGGER Manual PROCEDURE VERSION v1 current/i.test(shown), shown.slice(0, 900)),
        check("tabs with counts", /Steps 3 Payload Logs 8/.test(shown), shown.slice(0, 900)),
        check("the path taken and the empty comparison", /PATH TAKEN[\s\S]*Manual Log Log COMPARED WITH THE LAST SUCCESS/i.test(shown), shown.slice(-400)),
        check("the earlier run is the last success to compare with", /COMPARED WITH THE LAST SUCCESS STEP LAST SUCCESS [A-Z][a-z]{2} \d+, \d+:\d\d [AP]M THIS RUN GAP/i.test(shown) && /Total \d+ ms \d+ ms/i.test(shown), shown.slice(-500)),
      ]);
      await tab.page.getByRole("button", { name: /^Previous run/ }).click();
      await ctx.verify("Previous run opens the run before", [await tab.at(/\/trace$/), await tab.shows(new RegExp(first))]);
      await ctx.verify("the url", [same("?run= is the previous run", new URL(tab.page.url()).searchParams.get("run"), first)]);
    },
  },
  {
    id: "a-failed-run-names-the-step-how-long-how-often-the-error-and-the-last-success",
    title: "the failure card names the step that failed, after how long, how many times in a row, its error and a link to the last success, with Open this step; the figures show the step reached, the duration against the usual one and the comparison with the last success, and name the steps never reached",
    entryPoint: "GET /runs/:id, /modules/automation/trace?run=",
    async run(/** @type {Ctx} */ ctx) {
      const seeded = await seededFailures(ctx);
      const { runs } = seeded;
      const got = await auto(ctx, "read the failed run", "GET", `/runs/${runs.f2}`);
      const body = got.body;
      await ctx.verify("the failed run as the API gives it", [
        same("failures in a row since the last success", pick(body, "failuresInRow"), 2),
        same("the usual duration is the mean of the successes around it", pick(body, "usualDurationMs"), 73),
        same("the last success and its step times", [pick(body, "lastSuccess", "runId"), pick(body, "lastSuccess", "durationMs"), pick(body, "lastSuccess", "stepDurations")], [runs.s1, 60, { t: 0, a: 10, boom: 20, c: 30 }]),
        same("previous is the failure before, next is none", [pick(body, "previous", "runId"), pick(body, "previous", "status"), pick(body, "next")], [runs.f1, "failed", null]),
        same("the skipped step is the one the failure stopped", list(body, "trace", "skipped").map((step) => [step.nodeId, step.reason]), [["c", "stopped"]]),
        same("steps and their status", list(body, "trace", "steps").map((step) => [step.nodeId, step.status, step.durationMs]), [["t", "ok", 0], ["a", "ok", 10], ["boom", "failed", 40]]),
        same("the failed step and error", [pick(body, "failedNodeId"), pick(body, "failedStep", "label"), pick(body, "errorMessage")], ["boom", "Charge card", "disk full"]),
        same("edges taken", size(body, "trace", "edgesTaken"), 2),
      ]);
      const first = await auto(ctx, "the first failure", "GET", `/runs/${runs.f1}`);
      const earliest = await auto(ctx, "the oldest success", "GET", `/runs/${runs.s2}`);
      await ctx.verify("the first failure and the first success", [same("one failure in a row", pick(first.body, "failuresInRow"), 1), same("the oldest run has no previous", pick(earliest.body, "previous"), null)]);
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${runs.f2}`, /Run history/);
      const shown = flat(await textWhen(tab, /COMPARED WITH THE LAST SUCCESS/i, 40_000));
      await ctx.verify("the failure card and the figures", [
        check("the card names step, time, streak, error", /Charge card failed After 50 ms\. Downstream steps were skipped\. Failed 2 times in a row\. Last success [^ ]+ [^ ]+ [^ ]+ ?[AP]?M? ?[0-9a-f]{8} disk full Open this step/.test(shown) || /Charge card failed After 50 ms\. Downstream steps were skipped\. Failed 2 times in a row\./.test(shown), shown.slice(0, 700)),
        check("the link to the last success carries its id", shown.includes(runs.s1.slice(0, 8)), runs.s1.slice(0, 8)),
        check("Status: Failed at step 3 of 4", /STATUS Failed at step 3 of 4/i.test(shown), shown.slice(0, 900)),
        check("Duration against the usual one", /DURATION 50 ms −23 ms vs usual/i.test(shown), shown.slice(0, 900)),
        check("Trigger and version", /TRIGGER Manual PROCEDURE VERSION v1 current/i.test(shown), shown.slice(0, 900)),
        check("tab Steps 3/4", /Steps 3\/4 Payload Logs 5/.test(shown), shown.slice(0, 900)),
        check("the step never reached", /Log not reached: the run stopped first skipped/.test(shown), shown.slice(0, 1200)),
        check("comparison rows: step, last success, now, gap", /Charge card 20 ms 40 ms \+20 ms/.test(shown) && /Log 30 ms not reached/.test(shown) && /Total 60 ms 50 ms −10 ms/.test(shown), shown.slice(-500)),
      ]);
      await tab.page.getByRole("button", { name: "Open this step" }).click();
      await tab.at(/\/builder$/);
      const url = new URL(tab.page.url());
      await ctx.verify("Open this step opens the builder on the failed step", [same("the procedure, the run and the step", [url.searchParams.get("selected"), url.searchParams.get("run"), url.searchParams.get("node")], [seeded.id, runs.f2, "boom"])]);
      await tab.goto(`/modules/automation/trace?run=${runs.f2}`);
      await textWhen(tab, /COMPARED WITH THE LAST SUCCESS/i, 40_000);
      await tab.page.getByRole("button", { name: "Debug in builder" }).click();
      await tab.at(/\/builder$/);
      const debug = new URL(tab.page.url());
      await ctx.verify("Debug in builder opens the procedure on the run", [same("the procedure and the run, no step", [debug.searchParams.get("selected"), debug.searchParams.get("run"), debug.searchParams.get("node")], [seeded.id, runs.f2, null])]);
    },
  },
  {
    id: "the-trace-tabs-show-steps-path-only-payload-and-logs",
    title: "Steps lays every step on a time line, Path only drops the steps never reached, Payload shows what the trigger received and Logs what each step logged; Open in builder shows the path on the graph",
    entryPoint: "/modules/automation/trace?run=",
    async run(/** @type {Ctx} */ ctx) {
      const seeded = await seededFailures(ctx);
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${seeded.runs.f2}`, /Run history/);
      const steps = flat(await textWhen(tab, /Log not reached/, 40_000));
      await ctx.verify("Steps", [check("the three steps that ran and the skipped one", /Manual[\s\S]*Log[\s\S]*Charge card disk full[\s\S]*Log not reached: the run stopped first skipped/.test(steps), steps.slice(0, 800))]);
      await tab.page.getByRole("switch", { name: "Path only" }).click();
      await tab.page.waitForTimeout(800);
      const pathOnly = flat(await bodyText(tab));
      await ctx.verify("Path only", [check("the step never reached is gone", !pathOnly.includes("not reached: the run stopped first"), pathOnly.slice(0, 900)), check("the steps that ran stay", pathOnly.includes("Charge card"), "Charge card")]);
      await tab.page.getByRole("tab", { name: /^Payload/ }).click();
      const payload = await textWhen(tab, /\{\s*\}/);
      await ctx.verify("Payload", [check("the trigger's payload, empty here", /\{\}/.test(payload.replace(/\s+/g, "")), payload.slice(-300))]);
      await tab.page.getByRole("tab", { name: /^Logs/ }).click();
      const logs = flat(await textWhen(tab, /run started/));
      await ctx.verify("Logs", [
        check("each entry with its offset, message and step", /\+0 ms run started exec \+0 ms executing Log \+10 ms executed Log \+10 ms executing Charge card \+50 ms disk full Charge card 6 entries/.test(logs) || /run started[\s\S]*executing[\s\S]*executed[\s\S]*disk full/.test(logs), logs.slice(0, 900)),
        check("the level filters", /All levels/.test(logs) && /Step messages only/.test(logs) && /First error/.test(logs), logs.slice(0, 500)),
      ]);
      await tab.page.getByRole("button", { name: "Open in builder" }).click();
      await tab.at(/\/builder$/);
      await ctx.verify("Open in builder", [same("on the procedure and the run", [new URL(tab.page.url()).searchParams.get("selected"), new URL(tab.page.url()).searchParams.get("run")], [seeded.id, seeded.runs.f2])]);
    },
  },
  {
    id: "a-run-of-an-older-version-and-a-re-run-are-bannered-in-the-trace",
    title: "a banner says when the run used an older version of the procedure, and when the run is a re-run with Open the original run; the run list says v1 · now v2",
    entryPoint: "/modules/automation/trace?run=, PUT /procedures/:id",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoStepProcedure(ctx, ctx.unique("Versions"));
      const original = (await runNow(ctx, id, {})).runId;
      const current = (await auto(ctx, "read", "GET", `/procedures/${id}`)).body;
      await saveGraph(ctx, "save version 2", id, current, graphWithMessage(current, "a", "version two"));
      const rerun = text((await auto(ctx, "re-run", "POST", `/runs/${original}/rerun`)).body, "runId");
      const old = (await auto(ctx, "the old run", "GET", `/runs/${original}`)).body;
      const fresh = (await auto(ctx, "the re-run", "GET", `/runs/${rerun}`)).body;
      await ctx.verify("the API", [
        same("the old run is of version 1 and its graph is flagged outdated", [pick(old, "procedureVersion"), pick(old, "graphOutdated")], [1, true]),
        same("the re-run is of version 2, not outdated, and names its origin", [pick(fresh, "procedureVersion"), pick(fresh, "graphOutdated"), pick(fresh, "rerunOf"), pick(fresh, "kind")], [2, false, original, "rerun"]),
      ]);
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${original}`, /Run history/);
      const oldPage = flat(await textWhen(tab, /PROCEDURE VERSION/i, 40_000));
      await ctx.verify("the old run's trace", [
        check("a banner says the graph of v1 was not kept and that steps are named from v2", /The graph of v1 wasn’t kept Steps are named from what the run kept, else from the current version \(v2\)\. The steps it skipped and the branches it left aside can’t be shown\./.test(oldPage), oldPage.slice(0, 900)),
        check("the version figure says v1, now v2", /PROCEDURE VERSION v1 now v2/i.test(oldPage), oldPage.slice(0, 900)),
      ]);
      await tab.goto(`/modules/automation/trace?run=${rerun}`);
      const rerunPage = flat(await textWhen(tab, /This run is a re-run/, 40_000));
      await ctx.verify("the re-run's trace", [check("the re-run banner with the way back", /This run is a re-run Open the original run/.test(rerunPage), rerunPage.slice(0, 700)), check("Re-run shows in the trigger figure", /TRIGGER Manual Re-run/i.test(rerunPage), rerunPage.slice(0, 900))]);
      await tab.page.getByRole("button", { name: "Open the original run" }).click();
      await tab.page.waitForTimeout(1500);
      await ctx.verify("Open the original run", [same("goes to the original", new URL(tab.page.url()).searchParams.get("run"), original)]);
    },
  },
  {
    id: "a-test-run-trace-disables-debug-in-builder-and-open-this-step",
    title: "for a test run Debug in builder and Open this step are disabled and say that the builder opens the saved procedure, not the draft the test ran; the trace says Draft, tested from the builder and flags the run as a Test",
    entryPoint: "POST /procedures/:id/test, /modules/automation/trace?run=",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await createEnabled(ctx, { name: ctx.unique("Draft"), graph: chain([trigger("t"), action("boom", "verify.fail", { message: "draft broke" })]) });
      const saved = (await auto(ctx, "read", "GET", `/procedures/${id}`)).body;
      const test = await auto(ctx, "test the draft", "POST", `/procedures/${id}/test`, { body: { graph: pick(saved, "graph"), confirmRealEffects: true } });
      const testId = text(test.body, "runId");
      const detail = (await auto(ctx, "the test", "GET", `/runs/${testId}`)).body;
      await ctx.verify("the test run", [same("kind, status and no version", [pick(detail, "kind"), pick(detail, "status"), pick(detail, "procedureVersion")], ["test", "failed", null]), check("the draft is kept so its graph is known", pick(detail, "graphOutdated") === false && list(detail, "graph", "nodes").length === 2, pick(detail, "graphOutdated"))]);
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${testId}`, /Run history/);
      const shown = flat(await textWhen(tab, /PROCEDURE VERSION/i, 40_000));
      await ctx.verify("the trace of a test", [
        check("Test badge and Draft version tile", /Failed Test /.test(shown) && /PROCEDURE VERSION Draft tested from the builder/i.test(shown), shown.slice(0, 700)),
        check("the hint under the failure", /The builder opens the saved procedure, not the draft this test ran\./.test(shown), shown.slice(0, 900)),
        await tab.enabled({ role: "button", name: "Debug in builder" }, { disabled: true }),
        await tab.enabled({ role: "button", name: "Open this step" }, { disabled: true }),
      ]);
      await storedGone(ctx, testId);
      await tab.reload();
      const gone = flat(await textWhen(tab, /The draft this test ran wasn’t kept/, 40_000));
      await ctx.verify("a test whose draft was not kept", [check("says so and that the graph is unknown", /The draft this test ran wasn’t kept/.test(gone), gone.slice(0, 900))]);
    },
  },
  {
    id: "the-trace-says-when-no-run-is-given-the-run-is-unknown-or-its-procedure-deleted",
    title: "without ?run= the trace says No run given; an unknown run says This run doesn’t exist; a run of a deleted procedure is badged Deleted and says procedure deleted",
    entryPoint: "/modules/automation/trace",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoStepProcedure(ctx, ctx.unique("Soon gone"));
      const ran = (await runNow(ctx, id, {})).runId;
      const { tab } = await openPage(ctx, "/modules/automation/trace", /Run history/);
      const none = flat(await textWhen(tab, /No run given/, 40_000));
      await tab.goto("/modules/automation/trace?run=does-not-exist");
      const unknown = flat(await textWhen(tab, /This run doesn’t exist/, 40_000));
      await ctx.verify("no run, unknown run", [
        check("No run given with the way to the history", /No run given\. Open a run from the run history to see its trace\./.test(none), none.slice(-300)),
        check("This run doesn’t exist, with why", /This run doesn’t exist It may have been deleted: runs are only kept for a limited time\./.test(unknown), unknown.slice(-300)),
      ]);
      await auto(ctx, "delete the procedure", "DELETE", `/procedures/${id}`);
      const detail = (await auto(ctx, "the run", "GET", `/runs/${ran}`)).body;
      await ctx.verify("the run of a deleted procedure", [same("no procedure, graph unknown", [pick(detail, "procedure"), pick(detail, "graph")], [null, null])]);
      await tab.goto(`/modules/automation/trace?run=${ran}`);
      const deleted = flat(await textWhen(tab, /procedure deleted/, 40_000));
      await ctx.verify("deleted", [check("Deleted badge and procedure deleted detail", /Succeeded Deleted /.test(deleted) && /PROCEDURE VERSION v1 procedure deleted/i.test(deleted), deleted.slice(0, 900)), check("no Re-run button when the procedure is gone", !/Re-run with this payload/.test(deleted), deleted.slice(0, 300))]);
    },
  },
  ...rerunJourneys,
]);

/**
 * Removes the saved draft of a test run, as a test stored without one reads.
 *
 * @param {Ctx} ctx The journey
 * @param {string} runId The test run
 * @returns {Promise<void>}
 */
async function storedGone(ctx, runId) {
  await withRuns(ctx, (runs) => runs.updateOne({ _id: runId }, { $unset: { graphSnapshot: "" } }));
  const row = await storedRun(ctx, runId);
  if (pick(row, "graphSnapshot")) throw new Error("the draft is still stored");
}
