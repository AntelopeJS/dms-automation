import { auto, check, pick, raw, recordRaw, same } from "../../auto.mjs";
import { DAY, windowQuery } from "./overview-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @type {import("../../auto.mjs").Row[]} */
export const routeJourneys = [
  {
    id: "the-stats-routes-refuse-a-bad-period-and-an-unknown-figure",
    title: "the Overview's routes answer 400 with the reason for a date that is not one, a period that ends before it starts or spans more than a year, a 404 for a figure that is not one of the four cards, and no route accepts a write",
    entryPoint: "GET /stats/health, /stats/kpi/:metric, /stats/runs-per-day, /stats/attention",
    async run(/** @type {Ctx} */ ctx) {
      const now = Date.now();
      const iso = (/** @type {number} */ t) => new Date(t).toISOString();
      const answers = {
        notDate: await auto(ctx, "from is not a date", "GET", "/stats/health?from=yesterday-ish"),
        toNotDate: await auto(ctx, "to is not a date", "GET", `/stats/attention?from=${iso(now - DAY)}&to=soon`),
        backwards: await auto(ctx, "a period that ends before it starts", "GET", `/stats/health${windowQuery(now, now - DAY)}`),
        year: await auto(ctx, "a period of 367 days", "GET", `/stats/kpi/runs${windowQuery(now - 367 * DAY, now)}`),
        yearOk: await auto(ctx, "a period of 366 days", "GET", `/stats/kpi/runs${windowQuery(now - 366 * DAY, now)}`),
        comparedBackwards: await auto(ctx, "a compared period that ends before it starts", "GET", `/stats/kpi/runs${windowQuery(now - DAY, now, { compareFrom: now - DAY, compareTo: now - 2 * DAY })}`),
        comparedYear: await auto(ctx, "a compared period of 367 days", "GET", `/stats/runs-per-day${windowQuery(now - DAY, now, { compareFrom: now - 400 * DAY, compareTo: now - DAY })}`),
        metric: await auto(ctx, "an unknown figure", "GET", "/stats/kpi/revenue"),
      };
      await ctx.verify("the refusals", [
        same("from", [answers.notDate.status, pick(answers.notDate.body, "error")], [400, '"from" is not a date']),
        same("to", [answers.toNotDate.status, pick(answers.toNotDate.body, "error")], [400, '"to" is not a date']),
        same("backwards", [answers.backwards.status, pick(answers.backwards.body, "error")], [400, "the period ends before it starts"]),
        same("longer than a year", [answers.year.status, pick(answers.year.body, "error")], [400, "the period is longer than a year"]),
        same("366 days still answers", answers.yearOk.status, 200),
        same("compared backwards", [answers.comparedBackwards.status, pick(answers.comparedBackwards.body, "error")], [400, "the compared period ends before it starts"]),
        same("compared longer than a year", [answers.comparedYear.status, pick(answers.comparedYear.body, "error")], [400, "the compared period is longer than a year"]),
        same("unknown figure", [answers.metric.status, pick(answers.metric.body, "error")], [404, 'unknown metric "revenue"']),
      ]);
      for (const path of ["/stats/health", "/stats/attention", "/stats/recent-runs", "/stats/procedures", "/stats/triggers", "/stats/runs-per-day", "/stats/kpi/runs"]) {
        for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
          const answer = await raw(ctx, `${method} ${path}`, { method, path: `/api/automation${path}`, as: "admin", headers: { "content-type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });
          recordRaw(ctx, answer, [check(`${method} ${path} is not served`, answer.status === 404 || answer.status === 405, `status ${answer.status}: ${answer.text.slice(0, 120)}`)]);
        }
      }
    },
  },
];
