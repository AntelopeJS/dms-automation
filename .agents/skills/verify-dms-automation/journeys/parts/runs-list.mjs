import { auto, check, same, text, num, pick } from "../../auto.mjs";
import { action, chain, createEnabled, createProcedure, manualLog, runNow, trigger } from "../../procs.mjs";
import { graphWithMessage, idsOf, insertRuns, MS_PER_DAY, runDocument, runMany, runTable, saveGraph, twoStepProcedure } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} name The procedure name
 * @param {string} [label] A label for the failing step
 * @returns {Promise<string>} The id of an enabled procedure that fails at its second step
 */
async function failingProcedure(ctx, name, label) {
  const boom = action("boom", "verify.fail", { message: "disk full ☕ 日本" });
  if (label) boom.label = label;
  const { id } = await createEnabled(ctx, {
    name,
    graph: chain([trigger("t"), action("a", "log.message", { message: "before" }), boom, action("c", "log.message", { message: "after" })]),
  });
  return id;
}

export const listJourneys = [
  {
    id: "the-run-list-serves-pages-of-25-newest-first",
    title: "the Run history lists every run of every procedure, newest first, 25 to a page, with the total",
    entryPoint: "GET /tables/runs/list, GET /tables/runs/count",
    async run(/** @type {Ctx} */ ctx) {
      const first = await twoStepProcedure(ctx, ctx.unique("List A"));
      const second = await createProcedure(ctx, { name: ctx.unique("List B"), graph: manualLog("b") });
      const ids = await runMany(ctx, first, 20);
      const other = await runNow(ctx, second, {});
      ids.push(other.runId);
      ids.push(...(await runMany(ctx, first, 6)));
      const newest = [...ids].reverse();
      const page0 = await runTable(ctx, { limit: 25, offset: 0, sortKey: "startedAt", sortDirection: "desc" });
      const page1 = await runTable(ctx, { limit: 25, offset: 25, sortKey: "startedAt", sortDirection: "desc" });
      const count = await auto(ctx, "count", "GET", "/tables/runs/count");
      await ctx.verify("27 runs of two procedures in pages of 25", [
        same("total", page0.total, 27),
        same("page 1 holds the 25 newest, newest first", idsOf(page0.rows), newest.slice(0, 25)),
        same("page 2 holds the 2 oldest, newest of them first", idsOf(page1.rows), newest.slice(25)),
        same("the count route", pick(count.body, "total"), 27),
        same("the other procedure's run is in the list", page0.rows.find((row) => row._id === other.runId)?.procedureId, second),
      ]);
      const oldest = await runTable(ctx, { limit: 3, sortKey: "startedAt", sortDirection: "asc" });
      await ctx.verify("ascending order", [same("the three oldest", idsOf(oldest.rows), ids.slice(0, 3))]);
    },
  },
  {
    id: "the-tabs-and-filters-narrow-the-list-by-outcome-kind-and-procedure",
    title: "the tabs Failed, Succeeded and Tests, the Kind and Procedure filters and the Outcome filter narrow the list to exactly the matching runs",
    entryPoint: "GET /tables/runs/list?filter_status=..., filter_kind=..., filter_procedureId=...",
    async run(/** @type {Ctx} */ ctx) {
      const good = await twoStepProcedure(ctx, ctx.unique("Tabs good"));
      const bad = await failingProcedure(ctx, ctx.unique("Tabs bad"));
      const okRun = (await runNow(ctx, good, {})).runId;
      const failedRun = (await runNow(ctx, bad, {})).runId;
      const rerun = await auto(ctx, "re-run the ok run", "POST", `/runs/${okRun}/rerun`);
      const saved = await auto(ctx, "read the draft", "GET", `/procedures/${good}`);
      const test = await auto(ctx, "test run", "POST", `/procedures/${good}/test`, { body: { graph: pick(saved.body, "graph") } });
      const testRun = text(test.body, "runId");
      const rerunId = text(rerun.body, "runId");
      const idsFor = async (/** @type {Record<string, string>} */ query) => idsOf((await runTable(ctx, { limit: 50, sortKey: "startedAt", sortDirection: "asc", ...query })).rows);
      const everything = await idsFor({});
      await ctx.verify("filters", [
        same("all four runs", everything, [okRun, failedRun, rerunId, testRun]),
        same("Failed tab: filter status is failed", await idsFor({ filter_status: "is:failed" }), [failedRun]),
        same("Succeeded tab: filter status is ok", await idsFor({ filter_status: "is:ok" }), [okRun, rerunId, testRun]),
        same("Tests tab: filter kind is test", await idsFor({ filter_kind: "is:test" }), [testRun]),
        same("Kind Re-run", await idsFor({ filter_kind: "is:rerun" }), [rerunId]),
        same("Kind Run", await idsFor({ filter_kind: "is:run" }), [okRun, failedRun]),
        same("Procedure filter is", await idsFor({ filter_procedureId: `is:${bad}` }), [failedRun]),
        same("Procedure filter is not", await idsFor({ filter_procedureId: `is_not:${bad}` }), [okRun, rerunId, testRun]),
        same("a blank procedure filter filters nothing", (await idsFor({ filter_procedureId: "is:" })).length, 4),
        same("Trigger type filter", (await idsFor({ filter_triggerType: "is:manual" })).length, 4),
        same("Trigger type filter with another type", await idsFor({ filter_triggerType: "is:webhook" }), []),
      ]);
      const rows = (await runTable(ctx, { limit: 50 })).rows;
      const byId = Object.fromEntries(rows.map((row) => [text(row, "_id"), row]));
      await ctx.verify("what each row says", [
        same("kinds", [okRun, failedRun, rerunId, testRun].map((id) => text(byId[id], "kind")), ["run", "run", "rerun", "test"]),
        same("statuses", [okRun, failedRun, rerunId, testRun].map((id) => text(byId[id], "status")), ["ok", "failed", "ok", "ok"]),
        same("the failed run's error text", text(byId[failedRun], "errorText"), "disk full ☕ 日本"),
        same("the failed step is named by its type", pick(byId[failedRun], "failedStep", "typeName"), "Fixture failure"),
        same("the ok run has no error text", pick(byId[okRun], "errorText"), null),
      ]);
    },
  },
  {
    id: "search-finds-procedures-errors-steps-paths-and-run-ids",
    title: "the search of the Run history matches the procedure name, the error, the failed step's name, the trigger path and the run id or the start of it, case-insensitively",
    entryPoint: "GET /tables/runs/list?search=...",
    async run(/** @type {Ctx} */ ctx) {
      const named = ctx.unique("Zürich Ünïcode 日本");
      const failing = await failingProcedure(ctx, named, "Charge the card");
      const hooked = await createProcedure(ctx, { name: ctx.unique("Hooked"), graph: chain([trigger("t", "webhook", { path: "/orders/incoming-7f3", method: "POST" }), action("l", "log.message", { message: "x" })]) });
      const quiet = await twoStepProcedure(ctx, ctx.unique("Quiet"));
      const failedRun = (await runNow(ctx, failing, {})).runId;
      const hookRun = (await runNow(ctx, hooked, {})).runId;
      const quietRun = (await runNow(ctx, quiet, {})).runId;
      const find = async (/** @type {string} */ search) => idsOf((await runTable(ctx, { search, limit: 50, sortKey: "startedAt", sortDirection: "asc" })).rows);
      await ctx.verify("search", [
        same("by procedure name (accents, CJK)", await find(named.toLowerCase()), [failedRun]),
        same("by the error message (emoji and CJK)", await find("DISK FULL ☕ 日本"), [failedRun]),
        same("by the failed step's label", await find("charge the"), [failedRun]),
        same("by the trigger path", await find("incoming-7f3"), [hookRun]),
        same("by the whole run id", await find(quietRun), [quietRun]),
        same("by the start of a run id", await find(quietRun.slice(0, 13)), [quietRun]),
        same("by the middle of a run id finds nothing", await find(quietRun.slice(9, 20)), []),
        same("a text nothing holds", await find("no-such-text-anywhere"), []),
      ]);
    },
  },
  {
    id: "view-runs-opens-the-list-on-one-procedure-with-a-banner",
    title: "?procedure=<id> names the procedure in a banner with Show all runs, says the figures count every procedure, still names a deleted procedure, and says nothing for an empty or unknown id",
    entryPoint: "GET /runs/scope/banner, /modules/automation/runs?procedure=",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Scoped ☕");
      const id = await twoStepProcedure(ctx, name);
      await runNow(ctx, id, {});
      const banner = async (/** @type {string} */ query) => (await auto(ctx, `banner ${query}`, "GET", `/runs/scope/banner${query}`)).body;
      const scoped = await banner(`?procedure=${id}`);
      await ctx.verify("the banner of one procedure", [
        same("title", pick(scoped, "title"), { key: "dms_automation.runs.scopedTo", params: { name } }),
        same("description", pick(scoped, "description"), "$dms_automation.runs.scopedKpis"),
        same("tone and size", [pick(scoped, "tone"), pick(scoped, "size")], ["info", "sm"]),
        same("Show all runs goes back to every run", pick(scoped, "actions"), [{ label: "$dms_automation.runs.showAllRuns", to: "/modules/automation/runs", icon: "i-ph-x", variant: "ghost" }]),
        same("no procedure, no banner", await banner(""), {}),
        same("an empty id, no banner", await banner("?procedure="), {}),
        same("a blank id, no banner", await banner("?procedure=%20%20"), {}),
        same("an unknown id", pick(await banner("?procedure=nope"), "title"), "$dms_automation.runs.scopedToMissing"),
      ]);
      await auto(ctx, "delete the procedure", "DELETE", `/procedures/${id}`);
      const gone = await banner(`?procedure=${id}`);
      await ctx.verify("a deleted procedure is still named by its runs", [same("title", pick(gone, "title"), { key: "dms_automation.runs.scopedTo", params: { name } })]);
    },
  },
  {
    id: "runs-are-stored-with-the-columns-the-list-draws",
    title: "each run carries its start, outcome, procedure, trigger words, failed step, duration, kind, trigger type, end time, re-run origin and version; a version older than the saved one reads v1 · now v2",
    entryPoint: "GET /tables/runs/list, PUT /procedures/:id",
    async run(/** @type {Ctx} */ ctx) {
      const id = await failingProcedure(ctx, ctx.unique("Columns"));
      const first = (await runNow(ctx, id, {})).runId;
      const saved = await auto(ctx, "read", "GET", `/procedures/${id}`);
      const put = await saveGraph(ctx, "save a new version", id, saved.body, graphWithMessage(saved.body, "a", "changed"));
      const second = (await runNow(ctx, id, {})).runId;
      const rerun = text((await auto(ctx, "re-run", "POST", `/runs/${first}/rerun`)).body, "runId");
      const { rows } = await runTable(ctx, { limit: 10, sortKey: "startedAt", sortDirection: "asc" });
      const row = (/** @type {string} */ runId) => rows.find((r) => r._id === runId) ?? {};
      await ctx.verify("columns", [
        same("the save made version 2", num(put.body, "version"), 2),
        same("the first run says it is of an older version", pick(row(first), "versionText"), { key: "dms_automation.runs.olderVersion", params: { version: 1, current: 2 } }),
        same("the second run is of the current version", [row(second).procedureVersion, row(second).versionText], [2, null]),
        same("the re-run carries the run it re-ran", text(row(rerun), "kind"), "rerun"),
        same("trigger words and type", [row(first).triggerText, row(first).triggerTypeText, row(first).triggerType], ["$dms_automation.types.manual.name", null, "manual"]),
        check("end time and duration agree", Date.parse(text(row(first), "endedAt")) - Date.parse(text(row(first), "startedAt")) === row(first).durationMs, [row(first).startedAt, row(first).endedAt, row(first).durationMs]),
        same("failed step is the node that failed", pick(row(first), "failedStep", "nodeId"), "boom"),
      ]);
      const old = new Date(Date.now() - 3 * MS_PER_DAY);
      await insertRuns(ctx, [runDocument({ procedureId: id, procedureName: "x", startedAt: old, procedureVersion: 1 })]);
      await ctx.verify("seeded", [same("the list now holds 4 runs", (await runTable(ctx)).total, 4)]);
    },
  },
];
