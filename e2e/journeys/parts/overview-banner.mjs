import { auto, check, list, same, text, pick } from "../../auto.mjs";
import { runOf } from "../../procs.mjs";
import { DAY, OVERVIEW, degraded, draft, failing, healthy, open, pause, shows, unarmed, windowQuery } from "./overview-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const TRACE = "/modules/automation/trace";
const PROCEDURES = "/modules/automation/procedures";
const RUNS = "/modules/automation/runs";

/**
 * @param {unknown} banner A health answer
 * @returns {Record<string, unknown>[]} Its buttons
 */
function buttons(banner) {
  return list(banner, "actions");
}

/**
 * @param {import("../../auto.mjs").Row} button A banner button
 * @returns {string} Its label key, target, variant and colour
 */
function describeButton(button) {
  return `${text(button, "label")} -> ${text(button, "to")} (${text(button, "variant")}, ${text(button, "color")})`;
}

/** @type {import("../../auto.mjs").Row[]} */
export const bannerJourneys = [
  {
    id: "the-idle-and-healthy-banners-say-so-and-count-runs-and-procedures",
    title: "Nothing ran in this window (no buttons) while procedures exist but no run falls in the period; Every procedure is healthy with the runs, failed runs and enabled procedures of the period, and Show failed runs only when runs failed in the period, for example those of a procedure paused since",
    entryPoint: "GET /stats/health, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      await draft(ctx, "Only a draft");
      const idle = await auto(ctx, "banner with one draft", "GET", "/stats/health");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("idle", [
        same("tone", text(idle.body, "tone"), "info"),
        same("title", text(idle.body, "title", "key"), "dms_automation.health.idle"),
        same("the counts line", pick(idle.body, "description"), { key: "dms_automation.health.summaryCount", params: { count: { type: "count", value: 0 }, failed: 0, enabled: 0, total: 1 } }),
        same("no button", buttons(idle.body), []),
        await shows(tab, "title", "Nothing ran in this window"),
        await shows(tab, "the counts line", "0 runs, 0 failed · 0 of 1 procedures enabled"),
        await shows(tab, "no button", "Show failed runs", { not: true, timeoutMs: 1000 }),
      ]);
      await healthy(ctx, "Runs fine");
      const calm = await auto(ctx, "banner with a healthy procedure", "GET", "/stats/health");
      await open(tab, OVERVIEW);
      await ctx.verify("healthy", [
        same("tone", text(calm.body, "tone"), "success"),
        same("title", pick(calm.body, "title"), { key: "dms_automation.health.healthy" }),
        same("the counts line", pick(calm.body, "description", "params"), { count: { type: "count", value: 1 }, failed: 0, enabled: 1, total: 2 }),
        same("no button without a failed run", buttons(calm.body), []),
        await shows(tab, "title", "Every procedure is healthy"),
        await shows(tab, "the counts line", "1 run, 0 failed · 1 of 2 procedures enabled"),
      ]);
      const now = Date.now();
      const past = await auto(ctx, "banner over a window with no run", "GET", `/stats/health${windowQuery(now - 10 * DAY, now - 9 * DAY)}`);
      await ctx.verify("a window without runs is idle whatever the procedures", [
        same("title", text(past.body, "title", "key"), "dms_automation.health.idle"),
        same("the counts line", pick(past.body, "description", "params", "count"), { type: "count", value: 0 }),
      ]);
      const gone = await failing(ctx, "Failed then paused", 2, "gone wrong");
      await pause(ctx, gone.id);
      const after = await auto(ctx, "banner after the failing procedure is paused", "GET", `/stats/health?preset=last-7-days`);
      await open(tab, OVERVIEW);
      await ctx.verify("healthy with failed runs in the period", [
        same("title", text(after.body, "title", "key"), "dms_automation.health.healthy"),
        same("the counts line", pick(after.body, "description", "params"), { count: { type: "count", value: 3 }, failed: 2, enabled: 1, total: 3 }),
        same("only Show failed runs", buttons(after.body).map(describeButton), ["$dms_automation.health.showFailedRuns -> /modules/automation/runs?tab=failed&automation-runs.period=last-7-days (outline, neutral)"]),
        await shows(tab, "title", "Every procedure is healthy"),
        await shows(tab, "the counts line", "3 runs, 2 failed · 1 of 3 procedures enabled"),
        await tab.visible({ role: "link", name: "Show failed runs" }),
        await tab.visible({ role: "link", name: "Open last failure" }, { hidden: true, timeoutMs: 1000 }),
      ]);
      const noPreset = await auto(ctx, "banner without a preset", "GET", "/stats/health");
      await ctx.verify("without a preset the link carries no period", [same("link", buttons(noPreset.body).map((b) => text(b, "to")), [`${RUNS}?tab=failed`])]);
    },
  },
  {
    id: "the-degraded-banner-counts-runs-and-offers-the-last-failure-and-the-failed-runs",
    title: "Degraded: N procedures degraded, the runs and failed runs of the period and how many procedures are enabled under it, with Open last failure and Show failed runs",
    entryPoint: "GET /stats/health, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const one = await degraded(ctx, "Recovered once");
      const single = await auto(ctx, "banner with one degraded procedure", "GET", "/stats/health?preset=last-24h");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("one degraded procedure", [
        same("tone", text(single.body, "tone"), "warning"),
        same("title", pick(single.body, "title"), { key: "dms_automation.health.degraded", params: { count: { type: "count", value: 1 } } }),
        same("the counts line", pick(single.body, "description"), { key: "dms_automation.health.summaryCount", params: { count: { type: "count", value: 2 }, failed: 1, enabled: 1, total: 1 } }),
        same("its two buttons, the first quiet", buttons(single.body).map(describeButton), [
          `$dms_automation.health.inspectLastFailure -> ${TRACE}?run=${one.failedRunId} (outline, neutral)`,
          `$dms_automation.health.showFailedRuns -> ${RUNS}?tab=failed&automation-runs.period=last-24h (outline, neutral)`,
        ]),
        await shows(tab, "title", "1 procedure degraded"),
        await shows(tab, "the counts line", "2 runs, 1 failed · 1 of 1 procedures enabled"),
        await tab.visible({ role: "link", name: "Open last failure" }),
        await tab.visible({ role: "link", name: "Show failed runs" }),
        await tab.visible({ role: "link", name: "Show failing procedures" }, { hidden: true, timeoutMs: 1000 }),
      ]);
      const two = await degraded(ctx, "Recovered twice");
      const both = await auto(ctx, "banner with two degraded procedures", "GET", "/stats/health");
      await open(tab, OVERVIEW);
      await ctx.verify("two degraded procedures", [
        same("title count", pick(both.body, "title", "params", "count"), { type: "count", value: 2 }),
        same("the counts line", pick(both.body, "description", "params"), { count: { type: "count", value: 4 }, failed: 2, enabled: 2, total: 2 }),
        same("the last failure is the newest failed run", buttons(both.body).map((b) => text(b, "to"))[0], `${TRACE}?run=${two.failedRunId}`),
        await shows(tab, "title", "2 procedures degraded"),
        await shows(tab, "the counts line", "4 runs, 2 failed · 2 of 2 procedures enabled"),
      ]);
    },
  },
  {
    id: "the-failing-banner-names-the-most-urgent-procedure-and-its-last-error",
    title: "Failing: N procedures failing; the line names the most urgent procedure (longest run of failures), since when it fails, and the error of its last failure with the step; Open last failure opens that procedure's last failed run, then Show failed runs for one failing procedure, Show failing procedures for several",
    entryPoint: "GET /stats/health, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const message = "disk é full 日本 🚒";
      const long = await failing(ctx, "Long streak", 3, message);
      const newer = await degraded(ctx, "Newer failure");
      const first = await runOf(ctx, long.runIds[0] ?? "");
      const lastRun = long.runIds[2] ?? "";
      const one = await auto(ctx, "banner with one failing procedure", "GET", "/stats/health?preset=last-24h");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("one failing procedure", [
        same("tone", text(one.body, "tone"), "error"),
        same("title", pick(one.body, "title"), { key: "dms_automation.health.failing", params: { count: { type: "count", value: 1 } } }),
        same("the line", pick(one.body, "description"), {
          key: "dms_automation.health.failingDetail",
          params: {
            name: "Long streak",
            since: { type: "datetime", value: new Date(text(first, "startedAt")).toISOString(), format: "day" },
            cause: { key: "dms_automation.health.lastFailureAt", params: { error: message, step: "Fixture failure" } },
          },
        }),
        same("Open last failure is the procedure's own last run, not the newest failure of another", buttons(one.body).map(describeButton), [
          `$dms_automation.health.inspectLastFailure -> ${TRACE}?run=${lastRun} (solid, error)`,
          `$dms_automation.health.showFailedRuns -> ${RUNS}?tab=failed&automation-runs.period=last-24h (outline, neutral)`,
        ]),
        check("the newer failure exists", newer.failedRunId.length > 0 && newer.failedRunId !== lastRun, newer.failedRunId),
        await shows(tab, "title", "1 procedure failing"),
        await shows(tab, "the line starts with the name", "Long streak · failing since "),
        await shows(tab, "the line ends with the error and the step", ` · ${message} at Fixture failure`),
      ]);
      const short = await failing(ctx, "Short streak", 1, "other");
      const many = await auto(ctx, "banner with two failing procedures", "GET", "/stats/health?preset=last-24h");
      await open(tab, OVERVIEW);
      await ctx.verify("several failing procedures", [
        same("title count", pick(many.body, "title", "params", "count"), { type: "count", value: 2 }),
        same("the line key", text(many.body, "description", "key"), "dms_automation.health.failingDetailMany"),
        same("the most urgent is the longest streak", pick(many.body, "description", "params", "name"), "Long streak"),
        same("and one more", pick(many.body, "description", "params", "others"), { type: "count", value: 1 }),
        same("two buttons: the last failure then the failing list", buttons(many.body).map(describeButton), [
          `$dms_automation.health.inspectLastFailure -> ${TRACE}?run=${lastRun} (solid, error)`,
          `$dms_automation.health.showFailingProcedures -> ${PROCEDURES}?tab=failing (outline, neutral)`,
        ]),
        check("the shorter streak exists", short.runIds.length === 1, short.id),
        await shows(tab, "title", "2 procedures failing"),
        await shows(tab, "the line", "Long streak and 1 more · failing since "),
        await shows(tab, "the error", ` · ${message} at Fixture failure`),
        await tab.visible({ role: "link", name: "Show failing procedures" }),
        await tab.visible({ role: "link", name: "Show failed runs" }, { hidden: true, timeoutMs: 1000 }),
      ]);
    },
  },
  {
    id: "a-trigger-that-could-not-arm-gives-its-reason-and-no-run-to-open",
    title: "if the failing procedure's trigger could not be armed the line gives that reason instead of an error, and Open last failure is missing because there is no run to open",
    entryPoint: "GET /stats/health, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const id = await unarmed(ctx, "Never armed");
      const banner = await auto(ctx, "banner with an unarmed procedure", "GET", "/stats/health");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the reason replaces the error", [
        check("the procedure exists", id.length > 0, id),
        same("title", text(banner.body, "title", "key"), "dms_automation.health.failing"),
        same("the line key", text(banner.body, "description", "key"), "dms_automation.health.failingDetail"),
        same("no start date, since nothing ran", pick(banner.body, "description", "params", "since"), "—"),
        same("the cause is the arm refusal", pick(banner.body, "description", "params", "cause"), {
          key: "dms_automation.procedures.detail.triggerError",
          params: { error: { key: "dms_automation.editor.problems.codes.armFailed", params: { error: "the fixture refuses to arm" } } },
        }),
        same("no button at all", buttons(banner.body), []),
        await shows(tab, "title", "1 procedure failing"),
        await shows(tab, "the line", "Never armed · failing since — · Trigger not armed: This trigger could not start: the fixture refuses to arm"),
        await tab.visible({ role: "link", name: "Open last failure" }, { hidden: true, timeoutMs: 1000 }),
      ]);
      const paused = await failing(ctx, "Failed before the pause", 1, "old failure");
      await pause(ctx, paused.id);
      const withFailed = await auto(ctx, "banner when failed runs exist", "GET", "/stats/health");
      await ctx.verify("only the failed runs can be shown", [same("buttons", buttons(withFailed.body).map((b) => text(b, "label")), ["$dms_automation.health.showFailedRuns"])]);
    },
  },
  {
    id: "the-banner-buttons-open-the-trace-the-failing-tab-and-the-failed-runs",
    title: "Open last failure opens the run trace of the last failed run, Show failing procedures opens the Procedures list on its Failing tab, Show failed runs opens the Run history on its Failed tab over the same period",
    entryPoint: "/modules/automation/overview banner",
    async run(/** @type {Ctx} */ ctx) {
      const first = await failing(ctx, "Banner target one", 2, "first");
      const second = await failing(ctx, "Banner target two", 1, "second");
      const lastRun = first.runIds[1] ?? "";
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await tab.click({ role: "link", name: "Open last failure" });
      await ctx.verify("Open last failure", [
        await tab.at(/\/modules\/automation\/trace$/),
        check("it is the run of the most urgent procedure", new URL(tab.page.url()).searchParams.get("run") === lastRun, tab.page.url()),
        await shows(tab, "the trace names the procedure", "Banner target one"),
        await shows(tab, "and its error", "first"),
      ]);
      await open(tab, OVERVIEW);
      await tab.click({ role: "link", name: "Show failing procedures" });
      await ctx.verify("Show failing procedures", [
        await tab.at(/\/modules\/automation\/procedures$/),
        check("tab=failing", new URL(tab.page.url()).searchParams.get("tab") === "failing", tab.page.url()),
        await shows(tab, "both failing procedures", "Banner target two"),
        await shows(tab, "the other too", "Banner target one"),
      ]);
      await pause(ctx, first.id);
      await pause(ctx, second.id);
      await tab.page.goto(`${ctx.state.webUrl}${OVERVIEW}`);
      await tab.click({ role: "link", name: "Show failed runs" });
      await ctx.verify("Show failed runs", [
        await tab.at(/\/modules\/automation\/runs$/),
        check("tab=failed", new URL(tab.page.url()).searchParams.get("tab") === "failed", tab.page.url()),
        check("over the banner's period", /^last-24h$/.test(new URL(tab.page.url()).searchParams.get("automation-runs.period") ?? ""), tab.page.url()),
        await shows(tab, "the failed runs list", "Banner target two"),
      ]);
    },
  },
];
