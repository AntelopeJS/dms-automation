import { auto, list, num, pick, same, text } from "../../auto.mjs";
import { createEnabled, manualLog } from "../../procs.mjs";
import { insertRuns, MS_PER_DAY, MS_PER_HOUR, runDocument } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} id The procedure
 * @returns {Promise<import("../../auto.mjs").Row>} Its row of the summary
 */
async function summaryRow(ctx, id) {
  const answer = await auto(ctx, "summary", "GET", "/procedures/summary");
  return list(answer.body).find((row) => text(row, "procedureId") === id) ?? {};
}

export const journeys = [
  {
    id: "avg-is-the-average-run-duration-not-the-newest",
    title: "the Avg column is the average duration of the procedure's runs: runs of 100, 200 and 600 ms (the newest the slowest) average 300 ms",
    entryPoint: "GET /procedures/summary, Procedures page Avg column",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Average");
      const { id } = await createEnabled(ctx, { name, graph: manualLog("x") });
      const now = Date.now();
      const base = { procedureId: id, procedureName: name };
      await insertRuns(ctx, [
        runDocument({ ...base, startedAt: new Date(now - 3 * MS_PER_HOUR), durationMs: 100 }),
        runDocument({ ...base, startedAt: new Date(now - 2 * MS_PER_HOUR), durationMs: 200 }),
        runDocument({ ...base, startedAt: new Date(now - MS_PER_HOUR), durationMs: 600 }),
      ]);
      const row = await summaryRow(ctx, id);
      await ctx.verify("the average", [
        same("three runs", num(row, "runs"), 3),
        same("avgDurationMs is the mean, 300", num(row, "avgDurationMs"), 300),
      ]);
    },
  },
  {
    id: "the-delete-confirmation-counts-only-the-runs-of-this-week",
    title: "the delete confirmation of an enabled procedure says how often it ran this week: runs 6 days ago and an hour ago count, a run 8 days ago does not",
    entryPoint: "GET /procedures/:id/delete-confirm",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Weekly");
      const { id } = await createEnabled(ctx, { name, graph: manualLog("x") });
      const now = Date.now();
      const base = { procedureId: id, procedureName: name };
      await insertRuns(ctx, [
        runDocument({ ...base, startedAt: new Date(now - 8 * MS_PER_DAY) }),
        runDocument({ ...base, startedAt: new Date(now - 6 * MS_PER_DAY) }),
        runDocument({ ...base, startedAt: new Date(now - MS_PER_HOUR) }),
      ]);
      const answer = await auto(ctx, "delete confirmation", "GET", `/procedures/${id}/delete-confirm`);
      await ctx.verify("this week only", [same("two runs this week", num(pick(answer.body, "params"), "count"), 2), same("the name", text(answer.body, "params", "name"), name)]);
    },
  },
];
