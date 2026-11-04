import { check, same, text } from "../../auto.mjs";
import { createProcedure, chain, trigger, action } from "../../procs.mjs";
import { summaryOf } from "./procedures-common.mjs";
import { seedStates } from "./procedures-page-seed.mjs";
import { ZONE, flat, innerOf, openPage, rowsWhen, tabStrip, tableRows } from "./procedures-page-ui.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const WHEN = "(?:this minute|\\d+ (?:seconds?|minutes?) ago)";
const RECENT = "(?:This minute|\\d+ (?:seconds?|minutes?) ago)";


export const journeys = [
  {
    id: "the-list-shows-five-columns-with-each-state-and-its-reason",
    title: "the Procedures page lists Procedure, Status, Starts when, Last runs and Success: the name with its description, the state with its reason under it, the trigger in words with its type, the last runs and the success share",
    entryPoint: "/modules/automation/procedures",
    async run(/** @type {Ctx} */ ctx) {
      const ids = await seedStates(ctx);
      const tab = await openPage(ctx, /Okay one/);
      const rows = await rowsWhen(tab, 7);
      const headers = flat(await innerOf(tab, "thead"));
      const footer = flat(await innerOf(tab, "body"));
      const expected = [
        /^Arm one Failing Trigger not armed: This trigger could not start: the fixture refuses to arm Fixture trigger that cannot arm Never -$/,
        new RegExp(`^Bad one Failing ${WHEN} at “Fixture failure” · boom é Manual ${RECENT} 0%$`),
        new RegExp(`^Degraded one Degraded 1 of 2 failed in 7 days · flaky failure 1 Manual ${RECENT} 50%$`),
        /^Hook one Healthy No run yet POST \/hooks\/stripe Webhook Never -$/,
        new RegExp(`^Okay one does things Healthy Manual ${RECENT} 100%$`),
        new RegExp(`^Cron one Paused Weekdays at 08:00 \\(${ZONE.replace(/[/.]/g, "\\$&")}\\) Schedule \\(cron\\) · \\+1 more Never -$`),
        /^Draft one Draft No trigger yet Never -$/,
      ];
      const okayRow = tab.page.locator("tbody tr", { hasText: "Okay one" });
      const okay = await summaryOf(ctx, ids.okay);
      const mark = await okayRow.getByRole("link", { name: /^Succeeded/ }).getAttribute("href");
      const failedMark = await tab.page.locator("tbody tr", { hasText: "Bad one" }).getByRole("link", { name: /^Failed · .* · boom é$/ }).getAttribute("href");
      const bad = await summaryOf(ctx, ids.bad);
      await ctx.verify("the table", [
        same("the five columns, in order", headers, "PROCEDURE STATUS STARTS WHEN LAST RUNS SUCCESS"),
        same("seven rows, failing first, then degraded, healthy, paused, drafts, by name", rows.length, 7),
        ...expected.map((pattern, index) => check(`row ${index + 1} reads ${pattern.source.slice(0, 60)}`, pattern.test(rows[index] ?? ""), rows[index])),
        same("a success mark opens the trace of its run", mark, `/modules/automation/trace?run=${text(okay, "lastRunId")}`),
        same("a failed mark opens the trace of its run and says why", failedMark, `/modules/automation/trace?run=${text(bad, "lastRunId")}`),
        same("the footer counts them", /7 procedures/.test(footer), true),
        same("the footer says how to open one", /Click a name, or double-click a row, to open it in the builder/.test(footer), true),
        same("the bar says when the list was updated", /Updated \d+ s ago/.test(footer), true),
      ]);
    },
  },
  {
    id: "tabs-filter-by-state-and-show-their-counts",
    title: "the tabs Failing, Degraded, Healthy, Paused and Drafts filter by state and show their counts; the Trigger type filter and the search narrow the list further",
    entryPoint: "/modules/automation/procedures, GET /api/automation/tables/procedures/{list,count,count/batch}",
    async run(/** @type {Ctx} */ ctx) {
      await seedStates(ctx);
      await createProcedure(ctx, { name: "Crème de la crème", description: "dessert 日本", graph: chain([trigger("t", "schedule.cron", { cron: "*/5 * * * *" }), action("l", "log.message", { message: "x" })]) });
      const tab = await openPage(ctx, /Okay one/);
      await rowsWhen(tab, 8);
      const strip = await tabStrip(tab);
      await ctx.verify("the tab strip with its counts", [same("tabs and counts", strip, ["All 8", "Failing 2", "Degraded 1", "Healthy 2", "Paused 1", "Drafts 2"])]);
      const byTab = {};
      for (const label of ["Failing", "Degraded", "Healthy", "Paused", "Drafts", "All"]) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await tab.page.getByRole("navigation").getByRole("button", { name: new RegExp(`^${label}`) }).click();
          await tab.page.waitForTimeout(700);
          const current = await tab.page.getByRole("navigation").getByRole("button", { name: new RegExp(`^${label}`) }).getAttribute("aria-current");
          if (current === "true") break;
        }
        byTab[label] = (await tableRows(tab)).map((row) => row.split(" ").slice(0, 2).join(" "));
      }
      await ctx.verify("each tab lists its state", [
        same("Failing", byTab.Failing, ["Arm one", "Bad one"]),
        same("Degraded", byTab.Degraded, ["Degraded one"]),
        same("Healthy", byTab.Healthy, ["Hook one", "Okay one"]),
        same("Paused", byTab.Paused, ["Cron one"]),
        same("Drafts, by name", byTab.Drafts, ["Crème de", "Draft one"]),
        same("All, failing first, then degraded, healthy, paused and drafts", byTab.All, ["Arm one", "Bad one", "Degraded one", "Hook one", "Okay one", "Cron one", "Crème de", "Draft one"]),
      ]);
      const search = async (/** @type {string} */ query) => {
        const box = tab.page.locator('[placeholder*="Search procedures"]');
        if (!(await box.isVisible())) await tab.page.getByRole("button", { name: "Open search" }).click();
        await box.fill(query);
        await tab.page.waitForTimeout(1800);
        return (await tableRows(tab)).map((row) => row.split(" Failing ")[0].split(" Healthy ")[0]);
      };
      const byStripe = await search("stripe");
      const byBoom = await search("boom");
      const byAccent = await search("creme");
      const byCron = await search("*/5");
      const byNothing = await search("zzzz");
      const empty = flat(await innerOf(tab, "body"));
      await ctx.verify("search", [
        same("finds a webhook by its path", byStripe.length, 1),
        same("finds a procedure by its last error", byBoom.length, 1),
        same("ignores accents and case", byAccent.length, 1),
        same("finds a schedule by its expression", byCron.length, 1),
        same("no match says so", [byNothing.filter((row) => !/No matching procedure/.test(row)).length, /No matching procedure/.test(empty), /Nothing in this tab matches your search or filters\./.test(empty)], [0, true, true]),
      ]);
      await tab.page.locator('[placeholder*="Search procedures"]').fill("");
      await tab.page.waitForTimeout(1500);
      await tab.page.getByRole("button", { name: "Trigger type" }).click();
      await tab.page.getByRole("menuitem", { name: "Webhook" }).or(tab.page.getByRole("menuitemcheckbox", { name: "Webhook" })).first().click();
      await tab.page.waitForTimeout(1800);
      const webhooks = (await tableRows(tab)).map((row) => row.split(" ").slice(0, 2).join(" "));
      await ctx.verify("Trigger type filter", [same("Webhook keeps only the webhook procedure", webhooks, ["Hook one"])]);
    },
  },
  {
    id: "the-column-picker-adds-description-last-error-enabled-trigger-type-and-avg",
    title: "the column picker holds the five shown columns and adds Description, Last error, Enabled, Trigger type and Avg, and a column added shows its values",
    entryPoint: "/modules/automation/procedures, Table options > Columns",
    async run(/** @type {Ctx} */ ctx) {
      await seedStates(ctx);
      const tab = await openPage(ctx, /Okay one/);
      await rowsWhen(tab, 7);
      const banner = tab.page.locator('header:has(:is(h1, h2, h3):has-text("Procedures")), [role="banner"]:has(:is(h1, h2, h3):has-text("Procedures"))').first();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await banner.getByRole("button").last().click();
        if (await tab.page.getByText("Table options").first().waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) break;
      }
      await tab.page.getByRole("listitem").filter({ hasText: /^Columns$/ }).click();
      await tab.page.getByRole("checkbox", { name: "Procedure" }).waitFor({ state: "visible" });
      const boxes = await tab.page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        const last = dialogs[dialogs.length - 1];
        const items = last ? Array.from(last.querySelectorAll('[role="checkbox"], input[type="checkbox"]')) : [];
        return items.map((i) => [i.getAttribute("aria-label") ?? i.getAttribute("name") ?? "", i.getAttribute("aria-checked") ?? String(i instanceof HTMLInputElement && i.checked), i.getAttribute("data-state") ?? ""]);
      });
      const states = boxes.map(([name, checked, state]) => [name, checked === "true" || state === "checked"]);
      await ctx.verify("the picker", [same("the columns in order, the five shown first", states, [["Procedure", true], ["Status", true], ["Starts when", true], ["Last runs", true], ["Success", true], ["Description", false], ["Last error", false], ["Enabled", false], ["Trigger type", false], ["Avg", false]])]);
      for (const name of ["Description", "Last error", "Enabled", "Trigger type", "Avg"]) await tab.page.getByRole("checkbox", { name, exact: true }).click();
      await tab.page.keyboard.press("Escape");
      await tab.page.waitForTimeout(800);
      const headers = flat(await innerOf(tab, "thead"));
      const rows = await tableRows(tab);
      const hook = rows.find((row) => row.startsWith("Hook one")) ?? "";
      const bad = rows.find((row) => row.startsWith("Bad one")) ?? "";
      const okay = rows.find((row) => row.startsWith("Okay one")) ?? "";
      await ctx.verify("the added columns", [
        check("Description shows the description", okay.startsWith("Okay one does things") && okay.includes("does things"), okay),
        check("Last error shows the run's error", bad.includes("boom é"), bad),
        check("Trigger type names the type", hook.includes("Webhook"), hook),
        check("Avg shows a duration for a procedure that ran", /\d+\s?ms|\d+(\.\d+)?\s?s/.test(okay), okay),
        check("the headers include the five new ones", ["DESCRIPTION", "LAST ERROR", "ENABLED", "TRIGGER TYPE", "AVG"].every((h) => headers.includes(h)), headers),
      ]);
    },
  },
];
