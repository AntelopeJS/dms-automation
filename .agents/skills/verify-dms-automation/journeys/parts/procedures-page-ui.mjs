import { check, list, same, text } from "../../auto.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Tab} Tab */

export const PAGE = "/modules/automation/procedures";
export const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** @param {string} value @returns {string} The text on one line */
export const flat = (value) => value.replace(/\s+/g, " ").trim();

/**
 * The rendered text of the first element a selector finds, waiting for it.
 *
 * @param {Tab} tab The tab
 * @param {string} selector A Playwright selector
 * @returns {Promise<string>} The text, as the browser lays it out
 */
export async function innerOf(tab, selector) {
  return tab.page.locator(selector).evaluate((element) => element.innerText);
}

/**
 * Opens the Procedures page as the owner and waits for a row.
 *
 * @param {Ctx} ctx The journey
 * @param {RegExp} [firstRow] A text that proves the list rendered
 * @returns {Promise<Tab>} The tab
 */
export async function openPage(ctx, firstRow) {
  const tab = await ctx.tab("admin");
  await tab.signIn("admin");
  await tab.goto(PAGE);
  if (firstRow) await tab.shows(firstRow, { timeoutMs: 20_000 });
  return tab;
}

/** @param {Tab} tab @returns {Promise<string[]>} The rows of the table, each on one line */
export async function tableRows(tab) {
  const rows = await tab.page.evaluate(() => Array.from(document.querySelectorAll("tbody tr"), (tr) => (tr instanceof HTMLElement ? tr.innerText : "")));
  return rows.map(flat);
}

/**
 * Waits until the table holds the given number of rows.
 *
 * @param {Tab} tab The tab
 * @param {number} count How many rows
 * @param {number} [timeoutMs] How long
 * @returns {Promise<string[]>} The rows
 */
export async function rowsWhen(tab, count, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let rows = await tableRows(tab);
  while (rows.length !== count && Date.now() < deadline) {
    await tab.page.waitForTimeout(300);
    rows = await tableRows(tab);
  }
  return rows;
}

/**
 * Opens the row menu of a procedure and returns its items, retrying while the page hydrates.
 *
 * @param {Tab} tab The tab
 * @param {string} name The procedure
 * @returns {Promise<string[]>} The menu items in order
 */
export async function openMenu(tab, name) {
  const trigger = tab.page.getByRole("button", { name: `Actions for ${name}`, exact: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await trigger.click();
    if (await tab.page.getByRole("menuitem").first().waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) break;
  }
  return tab.page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]'), (item) => (item.textContent ?? "").trim()));
}

/** @param {Tab} tab @param {string} name @param {string} item */
export async function pickMenuItem(tab, name, item) {
  await openMenu(tab, name);
  await tab.page.getByRole("menuitem", { name: item, exact: true }).click();
}

/**
 * The text of the open dialog on one line, once it shows.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The text
 */
export async function dialogText(tab) {
  const dialog = tab.page.getByRole("dialog").last();
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  await tab.page.waitForTimeout(600);
  return flat(await dialog.evaluate((element) => element.innerText));
}

/**
 * Clicks a header button until the dialog it opens shows (the page hydrates after load).
 *
 * @param {Tab} tab The tab
 * @param {string} name The button
 */
export async function openDialog(tab, name) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await tab.page.getByRole("button", { name, exact: true }).first().click();
    if (await tab.page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 2000 }).then(() => true, () => false)) return;
  }
}

/** @param {Tab} tab @param {RegExp} pattern @returns {Promise<string[]>} Text of the tab strip buttons */
export async function tabStrip(tab, pattern = /^(All|Failing|Degraded|Healthy|Paused|Drafts)/) {
  const names = await tab.page.evaluate(() =>
    Array.from(document.querySelectorAll('nav button, [role="navigation"] button'), (b) => {
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      const parts = [];
      while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? "");
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }),
  );
  return names.filter((name) => pattern.test(name));
}

export { check, list, same, text };
