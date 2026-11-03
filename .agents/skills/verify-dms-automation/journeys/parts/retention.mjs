import { auto, check, parseJson, pick, same, text } from "../../auto.mjs";
import { chain, action, createProcedure, manualLog, runNow, trigger, until, withConfig } from "../../procs.mjs";
import { alphabetical, insertRuns, MS_PER_DAY, MS_PER_HOUR, openPage, runDocument, runTable, storedRunIds, textWhen } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * Stores runs of a procedure at given ages, one of each kind per age.
 *
 * @param {Ctx} ctx The journey
 * @param {string} procedureId The procedure
 * @param {Record<string, number>} agesMs Age in ms by label
 * @returns {Promise<Record<string, string>>} The run id by label
 */
async function seedAges(ctx, procedureId, agesMs) {
  const docs = Object.entries(agesMs).map(([label, age]) => runDocument({ procedureId, procedureName: "Aged", startedAt: new Date(Date.now() - age), kind: label.includes("test") ? "test" : label.includes("rerun") ? "rerun" : "run" }));
  await insertRuns(ctx, docs);
  return Object.fromEntries(Object.keys(agesMs).map((label, index) => [label, String(docs[index]?._id)]));
}

/**
 * Restarts the backend, as the module starts and purges, then waits for the purge to settle.
 *
 * @param {Ctx} ctx The journey
 * @param {number} expected How many runs should be left
 * @returns {Promise<string[]>} The ids left
 */
async function afterStart(ctx, expected) {
  return await until(() => storedRunIds(ctx), (ids) => ids.length === expected, 30_000);
}

export const retentionJourneys = [
  {
    id: "runs-older-than-the-retention-are-deleted-when-the-module-starts",
    title: "the leader instance deletes the runs older than runs.retentionDays when the module starts: 30 days by default, tests and re-runs too, the procedure stays; 0 keeps every run; another value N keeps the last N days",
    entryPoint: "runs.retentionDays, module start",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: ctx.unique("Aged"), graph: manualLog("aged") });
      const day = MS_PER_DAY;
      const hour = MS_PER_HOUR;
      const recent = (await runNow(ctx, id, {})).runId;
      const defaults = await seedAges(ctx, id, { "30d+2h": 30 * day + 2 * hour, "30d+2h test": 30 * day + 2 * hour, "30d+2h rerun": 30 * day + 2 * hour, "29d22h": 30 * day - 2 * hour, "29d22h test": 30 * day - 2 * hour, "100d": 100 * day });
      await ctx.restartBackend();
      const left = await afterStart(ctx, 3);
      await ctx.verify("default: 30 days", [
        same("the runs kept", left.sort(alphabetical), [recent, defaults["29d22h"], defaults["29d22h test"]].sort(alphabetical)),
        same("the list says the same", (await runTable(ctx)).total, 3),
        same("a deleted run is gone for the API", (await auto(ctx, "deleted run", "GET", `/runs/${defaults["100d"]}`)).status, 404),
        same("the procedure stays", (await auto(ctx, "procedure", "GET", `/procedures/${id}`)).status, 200),
      ]);
      await withConfig(ctx, { VERIFY_AUTO_RETENTION_DAYS: "7" }, async () => {
        const week = await seedAges(ctx, id, { "7d+2h": 7 * day + 2 * hour, "6d22h": 7 * day - 2 * hour });
        await ctx.restartBackend();
        const kept = await afterStart(ctx, 2);
        await ctx.verify("retentionDays 7", [same("only the last 7 days are kept: the recent run and the 6d22h one", kept.sort(alphabetical), [recent, week["6d22h"]].sort(alphabetical))]);
      });
      await withConfig(ctx, { VERIFY_AUTO_RETENTION_DAYS: "0" }, async () => {
        const forever = await seedAges(ctx, id, { "400d": 400 * day, "3000d": 3000 * day });
        await ctx.restartBackend();
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const kept = await storedRunIds(ctx);
        await ctx.verify("retentionDays 0 keeps every run, however old", [check("the recent run, 400d and 3000d are kept", [recent, forever["400d"], forever["3000d"]].every((id) => kept.includes(id)), kept.length), same("and nothing else was added or removed", kept.length, 4)]);
      });
    },
  },
  {
    id: "a-payload-over-256-kb-is-kept-as-a-preview-and-cannot-be-re-run",
    title: "a payload of 256 KB is kept, one byte more is replaced by a marker with its size and a preview of 4096 characters: the trace says The payload was too large to keep, Run now offers an older payload, and the run cannot be re-run",
    entryPoint: "POST /procedures/:id/run-now, GET /runs/:id, /modules/automation/trace",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: ctx.unique("Big payload"), graph: chain([trigger("t"), action("l", "log.message", { message: "big" })]) });
      const exact = { pad: "x".repeat(262_134) };
      const over = { pad: "x".repeat(262_135) };
      const okRun = await runNow(ctx, id, exact);
      const bigRun = await runNow(ctx, id, over);
      const kept = (await auto(ctx, "exactly 256 KB", "GET", `/runs/${okRun.runId}`)).body;
      const big = (await auto(ctx, "one byte more", "GET", `/runs/${bigRun.runId}`)).body;
      const marker = parseJson(text(big, "triggerPayload"));
      const last = (await auto(ctx, "last payload", "GET", `/procedures/${id}/last-payload`)).body;
      await ctx.verify("the limit", [
        same("exactly 262144 bytes is kept", [pick(kept, "payloadKept"), JSON.stringify(parseJson(text(kept, "triggerPayload"))).length], [true, 262_144]),
        same("one byte more is not", [pick(big, "payloadKept"), pick(marker, "truncated"), pick(marker, "originalBytes"), text(marker, "preview").length], [false, true, 262_145, 4096]),
        same("the preview is the start of the payload", text(marker, "preview").slice(0, 20), '{"pad":"xxxxxxxxxxxx'),
        same("Run now offers the newest payload that was kept, and says a newer one was too large", [pick(last, "last", "runId"), pick(last, "tooLarge")], [okRun.runId, true]),
        same("the run itself ran", [bigRun.status, pick(big, "status")], ["ok", "ok"]),
      ]);
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${bigRun.runId}`, /Run history/);
      await textWhen(tab, /PROCEDURE VERSION/i, 40_000);
      await tab.page.getByRole("tab", { name: /^Payload/ }).click();
      const shown = (await textWhen(tab, /too large to keep/, 20_000)).replace(/\s+/g, " ");
      await ctx.verify("the trace", [
        check("a warning says the payload was too large to keep and why", /The payload was too large to keep Only a preview is stored, so this run can’t be re-run with it\./.test(shown), shown.slice(0, 900)),
        check("the preview line gives the characters and the size", /Preview: the first 4096 characters of 256 kB/.test(shown), shown.slice(0, 900)),
      ]);
      const refused = await auto(ctx, "re-run", "POST", `/runs/${bigRun.runId}/rerun`);
      await ctx.verify("no re-run", [same("409", [refused.status, text(refused.body, "message")], [409, "$dms_automation.runs.rerunBlocked.payloadTooLarge"])]);
    },
  },
];
