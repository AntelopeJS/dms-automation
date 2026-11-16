import { auto, check, same, text } from "../../auto.mjs";
import { insertRuns, openPage, runDocument, tableRows, textWhen, twoStepProcedure } from "./runs-common.mjs";
import { runNow } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const holdJourneys = [
  {
    id: "the-list-keeps-its-rows-through-a-search-and-another-page-until-show",
    title: "while paused, a run stored since is counted as N new · Show and the list keeps the rows it had through a search and does not take the new run into another page; Show brings the run in",
    entryPoint: "/modules/automation/runs, Pause, Open search, Next page",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoStepProcedure(ctx, ctx.unique("Hold"));
      const procedureName = text((await auto(ctx, "read", "GET", `/procedures/${id}`)).body, "name");
      const now = Date.now();
      await insertRuns(ctx, Array.from({ length: 30 }, (_, index) => runDocument({ procedureId: id, procedureName, startedAt: new Date(now - (index + 2) * 60_000), durationMs: index + 1 })));
      const { tab } = await openPage(ctx, "/modules/automation/runs", /Run history/);
      await textWhen(tab, /Page 1 of 2/, 40_000);
      const rowsOf = async () => (await tableRows(tab)).map((cells) => cells.join(" | "));
      const before = await rowsOf();
      await tab.page.getByRole("button", { name: "Pause" }).click();
      await runNow(ctx, id, {});
      await textWhen(tab, /1 new\s*·\s*Show/, 30_000);
      const afterNew = await rowsOf();
      await ctx.verify("paused with a run stored since", [same("25 rows, unchanged", afterNew, before), check("the footer still counts 30 items", /30 items/.test(await textWhen(tab, /30 items/)), "")]);
      await tab.page.getByRole("button", { name: "Open search" }).click();
      await tab.page.getByRole("textbox", { name: "Search procedures, errors, steps, paths or run ids…", exact: true }).fill(procedureName);
      const searched = await textWhen(tab, /1 new\s*·\s*Show/, 20_000);
      await ctx.verify("after a search", [check("still 1 new · Show and 30 items", /1 new\s*·\s*Show/.test(searched) && /30 items/.test(searched), searched.slice(-300)), check("the new run is not among the rows", (await rowsOf()).length <= 25, "")]);
      await tab.page.getByRole("button", { name: "Next page" }).click();
      const second = await textWhen(tab, /Page 2 of 2/, 20_000);
      const secondRows = await rowsOf();
      await ctx.verify("on page 2", [
        check("page 2 does not hold the new run", secondRows.every((row) => !row.includes(" | Run") || !row.startsWith("Just now")), secondRows.join("\n")),
        check("page 2 is a page of this procedure's runs", secondRows.length >= 5, `${secondRows.length} rows`),
        check("1 new · Show remains", /1 new\s*·\s*Show/.test(second), second.replace(/\s+/g, " ").slice(0, 600)),
      ]);
      await tab.page.getByRole("button", { name: /^Show/ }).first().click();
      const shown = await textWhen(tab, /31 items/, 20_000);
      await ctx.verify("Show", [check("the list now holds 31 runs", /31 items/.test(shown), shown.slice(-200))]);
    },
  },
];
