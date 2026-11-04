import { auto, check, list, same, pick, text } from "../../auto.mjs";
import { action, chain, createEnabled, manualLog, trigger } from "../../procs.mjs";
import { pageContent } from "./overview-page.mjs";
import { DAY, HOUR, OVERVIEW, open, seedRuns, shows, thisHour, windowQuery } from "./overview-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const FAILED = new Set([2, 9, 16]);

/**
 * The twenty runs of the figures journeys: run i starts i hours after the 21.5 hours before the hour, lasts (i + 1) * 10 ms, and runs 2, 9 and 16 fail.
 *
 * @param {number} hour The current hour
 * @returns {{ at: number, durationMs: number, failed: boolean }[]} The specs
 */
export function twentyRuns(hour) {
  return Array.from({ length: 20 }, (_, i) => ({ at: hour - 22 * HOUR + i * HOUR + HOUR / 2, durationMs: (i + 1) * 10, failed: FAILED.has(i) }));
}

/**
 * Twelve successful runs of 100 ms in the day before the twenty, and one run before the compared window.
 *
 * @param {number} hour The current hour
 * @returns {{ at: number, durationMs: number, failed: boolean }[]} The specs
 */
export function comparedRuns(hour) {
  return [hour - 50 * HOUR, ...Array.from({ length: 12 }, (_, i) => hour - 40 * HOUR + i * HOUR)].map((at) => ({ at, durationMs: 100, failed: false }));
}

/** @type {import("../../auto.mjs").Row[]} */
export const figureJourneys = [
  {
    id: "the-four-cards-compute-runs-success-rate-failed-and-p95-with-sparklines-and-changes",
    title: "the four cards Runs, Success rate, Failed and p95 (ms) show the figures of the period: the count of runs, ok over ok plus failed in percent with one decimal, the failed count, the 95th percentile (nearest rank) of the durations in ms; each has a sparkline per hour and its change against the compared window",
    entryPoint: "GET /stats/kpi/:metric, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const hour = thisHour();
      await seedRuns(ctx, [...twentyRuns(hour), ...comparedRuns(hour)]);
      const from = hour - 24 * HOUR;
      const full = windowQuery(from, hour, { compareFrom: from - 24 * HOUR, compareTo: from });
      const kpi = async (/** @type {string} */ metric, /** @type {string} */ query) => (await auto(ctx, `kpi ${metric}`, "GET", `/stats/kpi/${metric}${query}`)).body;
      const runs = await kpi("runs", full);
      const rate = await kpi("success-rate", full);
      const failed = await kpi("failed", full);
      const p95 = await kpi("duration-p95", full);
      const perHour = (/** @type {(i: number) => number} */ f) => Array.from({ length: 24 }, (_, bucket) => (bucket >= 2 && bucket <= 21 ? f(bucket - 2) : 0));
      await ctx.verify("the figures of 24 hours against the day before", [
        same("Runs", pick(runs, "value"), 20),
        same("Runs compared", pick(runs, "previousValue"), 12),
        same("Runs change in percent, one decimal", pick(runs, "delta"), 66.7),
        same("Runs sparkline counts runs per hour", pick(runs, "sparkline"), perHour(() => 1)),
        same("Success rate: 17 ok of 20, in percent", pick(rate, "value"), 85),
        same("Success rate compared", pick(rate, "previousValue"), 100),
        same("Success rate change", pick(rate, "delta"), -15),
        same("Failed", pick(failed, "value"), 3),
        same("Failed sparkline", pick(failed, "sparkline"), perHour((i) => (FAILED.has(i) ? 1 : 0))),
        same("Failed has no change against 0", pick(failed, "delta") ?? null, null),
        same("p95 is the nearest rank of 20 durations", pick(p95, "value"), 190),
        same("p95 compared", pick(p95, "previousValue"), 100),
        same("p95 change", pick(p95, "delta"), 90),
        same("p95 sparkline carries the last value over empty hours", pick(p95, "sparkline"), [...Array.from({ length: 2 }, () => 10), ...Array.from({ length: 20 }, (_, i) => (i + 1) * 10), 200, 200].slice(0, 24)),
      ]);
      const small = windowQuery(from, from + 6 * HOUR);
      const smallRate = await kpi("success-rate", small);
      const smallP95 = await kpi("duration-p95", small);
      await ctx.verify("a window of four hours holds four runs", [
        same("Runs", pick(await kpi("runs", small), "value"), 4),
        same("Success rate rounds to one decimal: 3 of 4", pick(smallRate, "value"), 75),
        same("p95 of four durations is the fourth", pick(smallP95, "value"), 40),
        same("Failed", pick(await kpi("failed", small), "value"), 1),
      ]);
      const third = windowQuery(from + 2 * HOUR - 1, from + 5 * HOUR - 1);
      await ctx.verify("a rate with a repeating decimal", [same("2 ok of 3 is 66.7", pick(await kpi("success-rate", third), "value"), 66.7)]);
      const none = windowQuery(hour - 10 * 24 * HOUR, hour - 9 * 24 * HOUR);
      const empty = await kpi("success-rate", none);
      await ctx.verify("a rate over no run has no value", [same("no value", pick(empty, "value") ?? null, null), same("Runs is 0", pick(await kpi("runs", none), "value"), 0), same("p95 has no value", pick(await kpi("duration-p95", none), "value") ?? null, null)]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the page", [
        await shows(tab, "Runs card with its change and the compared figure", "RUNS 20 ▲ +66.7% vs 12"),
        await shows(tab, "Success rate card", "SUCCESS RATE 85% ▼ -15.0% vs 100%"),
        await shows(tab, "Failed card without a change", "FAILED 3 vs 0"),
        await shows(tab, "p95 card", "P95 (MS) 190 ▲ +90.0% vs 100"),
      ]);
    },
  },
  {
    id: "the-runs-chart-stacks-succeeded-and-failed-runs-per-hour-or-per-day",
    title: "the Runs chart stacks succeeded runs and failed runs, one bar per hour on 24H and one per day on 7D and 30D; with a comparison a dashed line draws the runs of the compared window bucket by bucket, the total sits above with its change and the compared total (vs 12), and the legend names Succeeded, Failed and Runs, compared period",
    entryPoint: "GET /stats/runs-per-day, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const hour = thisHour();
      await seedRuns(ctx, [...twentyRuns(hour), ...comparedRuns(hour)]);
      const from = hour - 24 * HOUR;
      const chart = await auto(ctx, "chart per hour", "GET", `/stats/runs-per-day${windowQuery(from, hour, { compareFrom: from - 24 * HOUR, compareTo: from })}`);
      const starts = Array.from({ length: 24 }, (_, b) => new Date(from + b * HOUR).toISOString());
      const bucket = (/** @type {number} */ b) => (b >= 2 && b <= 21 ? b - 2 : -1);
      await ctx.verify("hourly bars", [
        same("the total", pick(chart.body, "value"), 20),
        same("series names", list(chart.body, "series").map((s) => s.name), ["$dms_automation.overview.succeeded", "$dms_automation.overview.failedRuns"]),
        same("hour starts", list(list(chart.body, "series")[0], "data").map((p) => p.x), starts),
        same("succeeded per hour", list(list(chart.body, "series")[0], "data").map((p) => p.y), starts.map((_, b) => (bucket(b) >= 0 && !FAILED.has(bucket(b)) ? 1 : 0))),
        same("failed per hour", list(list(chart.body, "series")[1], "data").map((p) => p.y), starts.map((_, b) => (bucket(b) >= 0 && FAILED.has(bucket(b)) ? 1 : 0))),
        same("the compared total", pick(chart.body, "previousValue"), 12),
        same("its change", pick(chart.body, "delta"), 66.7),
        same("the compared series is a line named for the compared period", list(chart.body, "comparisonSeries").map((s) => `${text(s, "name")}/${text(s, "type")}`), ["$dms_automation.overview.comparedRuns/line"]),
        same("compared runs per hour of the window", list(list(chart.body, "comparisonSeries")[0], "data").map((p) => p.y), starts.map((_, b) => (b >= 8 && b <= 19 ? 1 : 0))),
        same("on the same hours as the bars", list(list(chart.body, "comparisonSeries")[0], "data").map((p) => p.x), starts),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the chart with a comparison", [
        await shows(tab, "the total, its change and the compared total", "RUNS 20 +66.7% vs 12"),
        await shows(tab, "the legend", "Succeeded Failed Runs, compared period"),
        check("the chart is stacked columns coloured success and error", /"stacked":true/.test(await pageContent(tab.page)) && /"color":\["success","error"\]/.test(await pageContent(tab.page)), "page definition"),
      ]);
      const old = hour - 14 * DAY;
      const specs = [
        { k: 0, failed: false },
        { k: 0, failed: false },
        { k: 2, failed: true },
        { k: 2, failed: false },
        { k: 6, failed: false },
        { k: 6, failed: false },
        { k: 6, failed: false },
      ];
      await seedRuns(ctx, specs.map((spec) => ({ at: old + spec.k * DAY + 6 * HOUR, durationMs: 5, failed: spec.failed })));
      const daily = await auto(ctx, "chart per day", "GET", `/stats/runs-per-day${windowQuery(old, old + 7 * DAY)}`);
      const days = Array.from({ length: 7 }, (_, d) => new Date(old + d * DAY).toISOString());
      await ctx.verify("daily bars", [
        same("the total", pick(daily.body, "value"), 7),
        same("day starts", list(list(daily.body, "series")[0], "data").map((p) => p.x), days),
        same("succeeded per day", list(list(daily.body, "series")[0], "data").map((p) => p.y), [2, 0, 1, 0, 0, 0, 3]),
        same("failed per day", list(list(daily.body, "series")[1], "data").map((p) => p.y), [0, 0, 1, 0, 0, 0, 0]),
        check("without a comparison there is no compared line nor change", pick(daily.body, "comparisonSeries") === undefined && pick(daily.body, "delta") === undefined && pick(daily.body, "previousValue") === undefined, JSON.stringify(daily.body).slice(0, 200)),
      ]);
    },
  },
  {
    id: "no-comparison-and-an-unkept-compared-window-show-no-change",
    title: "No comparison hides the changes under the figures and the dashed line; a change shows only when runs from the compared window are still kept, otherwise the line under the total reads Runs in the period",
    entryPoint: "GET /stats/kpi/:metric, /stats/runs-per-day, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const hour = thisHour();
      await seedRuns(ctx, twentyRuns(hour));
      const from = hour - 24 * HOUR;
      const compared = { compareFrom: from - 24 * HOUR, compareTo: from };
      const unkept = await auto(ctx, "kpi with nothing kept before the compared window", "GET", `/stats/kpi/runs${windowQuery(from, hour, compared)}`);
      const unkeptChart = await auto(ctx, "chart with nothing kept", "GET", `/stats/runs-per-day${windowQuery(from, hour, compared)}`);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("no run before the compared window", [
        same("the value stays", pick(unkept.body, "value"), 20),
        check("no compared value, no change", pick(unkept.body, "previousValue") === undefined && pick(unkept.body, "delta") === undefined, unkept.body),
        check("the chart has no compared line", pick(unkeptChart.body, "comparisonSeries") === undefined && pick(unkeptChart.body, "delta") === undefined, JSON.stringify(unkeptChart.body).slice(0, 200)),
        await shows(tab, "the line under the total", "20 Runs in the period"),
        await shows(tab, "no change on the cards", "▲", { not: true, timeoutMs: 1500 }),
        await shows(tab, "no compared series in the legend", "Runs, compared period", { not: true, timeoutMs: 1500 }),
      ]);
      await seedRuns(ctx, [{ at: from - 60 * HOUR, durationMs: 1 }]);
      const kept = await auto(ctx, "kpi with a run before the compared window", "GET", `/stats/kpi/runs${windowQuery(from, hour, compared)}`);
      await ctx.verify("a run before the compared window keeps it", [
        same("the compared value is now known", pick(kept.body, "previousValue"), 0),
        same("a change against nothing says nothing", pick(kept.body, "delta") ?? null, null),
      ]);
      await seedRuns(ctx, Array.from({ length: 12 }, (_, i) => ({ at: from - 20 * HOUR + i * HOUR, durationMs: 1 })));
      const both = await auto(ctx, "kpi with compared runs", "GET", `/stats/kpi/runs${windowQuery(from, hour, compared)}`);
      const none = await auto(ctx, "kpi with comparison=none", "GET", `/stats/kpi/runs${windowQuery(from, hour, { ...compared, comparison: "none" })}`);
      const noneChart = await auto(ctx, "chart with comparison=none", "GET", `/stats/runs-per-day${windowQuery(from, hour, { ...compared, comparison: "none" })}`);
      await open(tab, OVERVIEW);
      await ctx.verify("No comparison hides the change", [
        same("compared value of 12", pick(both.body, "previousValue"), 12),
        same("change", pick(both.body, "delta"), 66.7),
        same("comparison=none keeps the value", pick(none.body, "value"), 20),
        check("comparison=none drops the compared value and the change whatever the dates", pick(none.body, "previousValue") === undefined && pick(none.body, "delta") === undefined, none.body),
        check("and the chart's dashed line", pick(noneChart.body, "comparisonSeries") === undefined && pick(noneChart.body, "previousValue") === undefined, JSON.stringify(noneChart.body).slice(0, 200)),
        await shows(tab, "the page now compares", "RUNS 20 ▲ +66.7% vs 12"),
      ]);
      await tab.click({ role: "button", name: /^Comparison:/ });
      await tab.click({ role: "menuitem", name: "No comparison" });
      await ctx.verify("choosing No comparison", [
        await shows(tab, "the change is gone", "▲", { not: true }),
        await shows(tab, "the line under the total", "20 Runs in the period"),
        await shows(tab, "the compared series leaves the legend", "Runs, compared period", { not: true }),
        await shows(tab, "the cards still show the figures", "RUNS 20 SUCCESS RATE 85% FAILED 3"),
      ]);
    },
  },
  {
    id: "test-runs-never-count-in-the-figures-the-banner-the-counts-or-the-recent-runs",
    title: "test runs started from the builder never count in the run figures, the chart, the health banner, the procedure counts, Needs attention or the recent runs, even a failed one",
    entryPoint: "POST /procedures/:id/test, GET /stats/*",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await createEnabled(ctx, { name: "Counted once", graph: manualLog("real") });
      const real = await auto(ctx, "a real run", "POST", `/procedures/${id}/run-now`, { body: { payload: {} } });
      const failingGraph = chain([trigger("t"), action("f", "verify.fail", { message: "test failure" })]);
      const test = await auto(ctx, "a failing test run", "POST", `/procedures/${id}/test`, { body: { graph: failingGraph, payload: {}, confirmRealEffects: true } });
      const okTest = await auto(ctx, "a passing test run", "POST", `/procedures/${id}/test`, { body: { graph: manualLog("test"), payload: {} } });
      const testRun = await auto(ctx, "read the test run", "GET", `/runs/${text(test.body, "runId")}`);
      const hour = thisHour();
      const query = windowQuery(hour - DAY, hour + HOUR);
      const kpis = await Promise.all(["runs", "failed", "success-rate"].map((m) => auto(ctx, `kpi ${m}`, "GET", `/stats/kpi/${m}${query}`)));
      const chart = await auto(ctx, "chart", "GET", `/stats/runs-per-day${query}`);
      const banner = await auto(ctx, "banner", "GET", "/stats/health");
      const attention = await auto(ctx, "attention", "GET", "/stats/attention");
      const recent = await auto(ctx, "recent runs", "GET", "/stats/recent-runs");
      const counts = await auto(ctx, "counts", "GET", "/stats/procedures");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("only the real run counts", [
        same("the real run", text(real.body, "status"), "ok"),
        same("the failing test ran and failed", text(test.body, "status"), "failed"),
        same("the passing test ran", text(okTest.body, "status"), "ok"),
        same("it is stored as a test", text(testRun.body, "kind"), "test"),
        same("Runs", pick(kpis[0]?.body, "value"), 1),
        same("Failed", pick(kpis[1]?.body, "value"), 0),
        same("Success rate", pick(kpis[2]?.body, "value"), 100),
        same("chart total", pick(chart.body, "value"), 1),
        same("the banner is healthy", text(banner.body, "title", "key"), "dms_automation.health.healthy"),
        same("the banner counts one run", pick(banner.body, "description", "params", "count"), { type: "count", value: 1 }),
        same("nothing needs attention", pick(attention.body, "total"), 0),
        same("one recent run", list(recent.body, "items").map((item) => item.id), [text(real.body, "runId")]),
        same("the procedure is healthy", list(counts.body, "items").map((item) => `${text(item, "id")}=${String(item.value)}`), ["total=1", "failing=0", "degraded=0", "healthy=1", "paused=0", "draft=0"]),
        await shows(tab, "Every procedure is healthy", "Every procedure is healthy"),
        await shows(tab, "the cards", "RUNS 1"),
        await shows(tab, "no failure", "test failure", { not: true, timeoutMs: 1500 }),
      ]);
    },
  },
];
