import { auto, check, list, num, pick, same, text } from "../../auto.mjs";
import { createEnabled, manualLog } from "../../procs.mjs";
import { insertRuns, MS_PER_DAY, MS_PER_HOUR, runDocument } from "./runs-common.mjs";
import { openPage, rowsWhen } from "./procedures-page-ui.mjs";
import { ariaUntil, open, OVERVIEW } from "./overview-kit.mjs";

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
  {
    id: "a-failure-six-days-old-degrades-and-one-eight-days-old-does-not",
    title: "an enabled procedure whose last run succeeded is Degraded when a run failed in the last 7 days (1 of 2 failed in 7 days, Success 50%, counted in Procedures · last 7 days) and Healthy when its only failure is 8 days old",
    entryPoint: "GET /procedures/summary, GET /stats/procedures, Procedures page, Overview",
    async run(/** @type {Ctx} */ ctx) {
      const near = ctx.unique("Window six");
      const far = ctx.unique("Window eight");
      const nearProcedure = await createEnabled(ctx, { name: near, graph: manualLog("x") });
      const farProcedure = await createEnabled(ctx, { name: far, graph: manualLog("x") });
      const now = Date.now();
      const failure = (/** @type {string} */ id, /** @type {string} */ name, /** @type {number} */ days) =>
        runDocument({ procedureId: id, procedureName: name, startedAt: new Date(now - days * MS_PER_DAY), status: "failed", steps: [{ id: "log", durationMs: 1, error: "old failure" }] });
      const success = (/** @type {string} */ id, /** @type {string} */ name) => runDocument({ procedureId: id, procedureName: name, startedAt: new Date(now - MS_PER_HOUR) });
      await insertRuns(ctx, [failure(nearProcedure.id, near, 6), success(nearProcedure.id, near), failure(farProcedure.id, far, 8), success(farProcedure.id, far)]);
      const nearRow = await summaryRow(ctx, nearProcedure.id);
      const farRow = await summaryRow(ctx, farProcedure.id);
      const counts = await auto(ctx, "procedure counts", "GET", "/stats/procedures");
      const byId = Object.fromEntries(list(counts.body, "items").map((item) => [text(item, "id"), num(item, "value")]));
      await ctx.verify("the API", [
        same("six days ago: degraded", [text(nearRow, "status"), num(nearRow, "runs"), num(nearRow, "failed"), num(nearRow, "successRate")], ["degraded", 2, 1, 0.5]),
        same("eight days ago: healthy and the old failure is out of the window", [text(farRow, "status"), num(farRow, "runs"), num(farRow, "failed"), num(farRow, "successRate")], ["healthy", 1, 0, 1]),
        same("the card counts one degraded and one healthy", [byId.degraded, byId.healthy], [1, 1]),
      ]);
      const tab = await openPage(ctx, new RegExp(near));
      const rows = await rowsWhen(tab, 2);
      const nearText = rows.find((row) => row.startsWith(near)) ?? "";
      const farText = rows.find((row) => row.startsWith(far)) ?? "";
      await ctx.verify("the Procedures page", [
        check("six days: Degraded, 1 of 2 failed in 7 days, Success 50%", nearText.includes("Degraded 1 of 2 failed in 7 days") && nearText.endsWith("50%"), nearText),
        check("eight days: Healthy, Success 100%", farText.includes("Healthy") && !farText.includes("Degraded") && farText.endsWith("100%"), farText),
      ]);
      await open(tab, OVERVIEW);
      const card = await ariaUntil(tab, "dl", (snapshot) => snapshot.includes("Drafts"));
      await ctx.verify("the Overview card", [check("Procedures · last 7 days reads Degraded 1 and Healthy 1", /Degraded[\s\S]*1[\s\S]*Healthy[\s\S]*1/.test(card) && card.includes("/url: /modules/automation/procedures?tab=degraded"), card)]);
    },
  },
];
