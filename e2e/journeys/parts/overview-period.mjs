import { check } from "../../auto.mjs";
import { allInnerTexts, innerText, isChecked } from "./overview-page.mjs";
import { draft, open, shows } from "./overview-kit.mjs";
import { withConfig } from "../../procs.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */

const OVERVIEW = "/modules/automation/overview";
const RUNS = "/modules/automation/runs";

/**
 * @param {Tab} tab The tab
 * @param {string} label The preset's accessible name
 * @returns {Promise<boolean>} Whether that preset is the checked one
 */
async function checked(tab, label) {
  return isChecked(tab.page.getByRole("radio", { name: label })).catch(() => false);
}

/**
 * Waits for a preset to become the checked one.
 *
 * @param {Tab} tab The tab
 * @param {string} label The preset's accessible name
 * @returns {Promise<boolean>} Whether it did
 */
async function becomesChecked(tab, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await checked(tab, label)) return true;
    await tab.page.waitForTimeout(300);
  }
  return false;
}

/**
 * The comparison menu's entries.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string[]>} The names of its items
 */
async function comparisons(tab) {
  await tab.page.getByRole("button", { name: /^Comparison:/ }).first().click();
  await tab.page.getByRole("menuitem").first().waitFor({ state: "visible", timeout: 10_000 });
  const names = await allInnerTexts(tab.page.getByRole("menuitem"));
  await tab.page.keyboard.press("Escape");
  return names.map((name) => name.trim());
}

/** @type {import("../../auto.mjs").Row[]} */
export const periodJourneys = [
  {
    id: "the-period-bar-holds-24h-7d-30d-says-when-it-starts-and-carries-over-to-the-run-history",
    title: "the bar holds the period 24H, 7D or 30D and says when the window starts; its comparison menu offers vs previous period (the default) and No comparison; the Run history uses the same period and comparison, so a choice made on one page carries over to the other",
    entryPoint: "/modules/automation/overview, /modules/automation/runs",
    async run(/** @type {Ctx} */ ctx) {
      await draft(ctx, "A procedure");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await open(tab, OVERVIEW);
      await ctx.verify("the bar by default", [
        check("24H is checked", await becomesChecked(tab, "Last 24 hours"), "24H"),
        await tab.visible({ role: "radio", name: "Last 7 days" }),
        await tab.visible({ role: "radio", name: "Last 30 days" }),
        await tab.visible({ role: "button", name: /^Comparison: vs previous period/ }),
        check("the 24 hour window starts yesterday at the current time", /since yesterday \d{2}:\d{2} (AM|PM)/.test(await innerText(tab.page.locator("body"))), "since yesterday"),
        check("the comparison menu", JSON.stringify(await comparisons(tab)) === JSON.stringify(["vs previous period", "No comparison"]), JSON.stringify(await comparisons(tab))),
      ]);
      await tab.click({ role: "radio", name: "Last 7 days" });
      await ctx.verify("7D", [
        check("7D is checked", await becomesChecked(tab, "Last 7 days"), "7D"),
        await tab.shows(/since [A-Z][a-z]{2} 12:00 AM/),
      ]);
      await tab.click({ role: "radio", name: "Last 30 days" });
      await ctx.verify("30D", [check("30D is checked", await becomesChecked(tab, "Last 30 days"), "30D"), await tab.shows(/since [A-Z][a-z]{2} \d{1,2}, 12:00 AM/)]);
      await tab.click({ role: "button", name: /^Comparison:/ });
      await tab.click({ role: "menuitem", name: "No comparison" });
      await tab.visible({ role: "button", name: "Comparison: No comparison" });
      await open(tab, RUNS);
      await ctx.verify("the run history keeps the choice", [
        check("30D is checked there", await becomesChecked(tab, "Last 30 days"), "30D"),
        await tab.visible({ role: "button", name: "Comparison: No comparison" }),
      ]);
      await tab.click({ role: "radio", name: "Last 24 hours" });
      await tab.click({ role: "button", name: /^Comparison:/ });
      await tab.click({ role: "menuitem", name: "vs previous period" });
      await open(tab, OVERVIEW);
      await ctx.verify("and the overview keeps the run history's", [
        check("24H is checked again", await becomesChecked(tab, "Last 24 hours"), "24H"),
        await tab.visible({ role: "button", name: /^Comparison: vs previous period/ }),
      ]);
    },
  },
  {
    id: "vs-previous-year-is-offered-only-when-runs-are-kept-395-days-or-forever",
    title: "the comparison menu offers vs previous year too when the project keeps runs long enough to reach the same window a year earlier: a runs.retentionDays of 395 or more, or 0 to keep every run; the default of 30 days and 394 do not",
    entryPoint: "runs.retentionDays, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      await draft(ctx, "A procedure");
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      const menu = async () => {
        await open(tab, OVERVIEW);
        await becomesChecked(tab, "Last 24 hours");
        return comparisons(tab);
      };
      const seen = { default: await menu() };
      await withConfig(ctx, { VERIFY_AUTO_RETENTION_DAYS: "394" }, async () => {
        seen.d394 = await menu();
      });
      await withConfig(ctx, { VERIFY_AUTO_RETENTION_DAYS: "395" }, async () => {
        seen.d395 = await menu();
      });
      await withConfig(ctx, { VERIFY_AUTO_RETENTION_DAYS: "0" }, async () => {
        seen.d0 = await menu();
      });
      const two = ["vs previous period", "No comparison"];
      const three = ["vs previous period", "vs previous year", "No comparison"];
      await ctx.verify("the menu", [
        check("30 days (default) offers two", JSON.stringify(seen.default) === JSON.stringify(two), JSON.stringify(seen.default)),
        check("394 days offers two", JSON.stringify(seen.d394) === JSON.stringify(two), JSON.stringify(seen.d394)),
        check("395 days offers three", JSON.stringify(seen.d395) === JSON.stringify(three), JSON.stringify(seen.d395)),
        check("0 (keep every run) offers three", JSON.stringify(seen.d0) === JSON.stringify(three), JSON.stringify(seen.d0)),
      ]);
      void shows;
    },
  },
];
