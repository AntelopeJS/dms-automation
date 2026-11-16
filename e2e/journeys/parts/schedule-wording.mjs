import { auto, check, isNumber, isRow, isText, list, pick, text } from "../../auto.mjs";
import { createProcedure, withConfig } from "../../procs.mjs";
import { cronGraph } from "./triggers-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

/** [expression, the words the Starts when column shows in UTC] */
/** @type {[string, string][]} */
const WORDING = [
  ["* * * * * *", "Every second"],
  ["*/10 * * * * *", "Every 10 seconds"],
  ["*/1 * * * * *", "Every 1 seconds"],
  ["* * * * *", "Every minute"],
  ["*/15 * * * *", "Every 15 minutes"],
  ["*/1 * * * *", "Every 1 minutes"],
  ["0 * * * *", "Every hour at :00"],
  ["5 * * * *", "Every hour at :05"],
  ["59 * * * *", "Every hour at :59"],
  ["0 */2 * * *", "Every 2 hours"],
  ["30 */3 * * *", "Every 3 hours at :30"],
  ["0 2 * * *", "Every day at 02:00 (UTC)"],
  ["5 14 * * *", "Every day at 14:05 (UTC)"],
  ["0 0 0 * * *", "Every day at 00:00 (UTC)"],
  ["0 */5 * * * *", "Every 5 minutes"],
  ["0 8 * * 1-5", "Weekdays at 08:00 (UTC)"],
  ["0 9 * * 1", "Mondays at 09:00 (UTC)"],
  ["0 9 * * 2", "Tuesdays at 09:00 (UTC)"],
  ["0 9 * * 3", "Wednesdays at 09:00 (UTC)"],
  ["0 9 * * 4", "Thursdays at 09:00 (UTC)"],
  ["30 17 * * 5", "Fridays at 17:30 (UTC)"],
  ["0 9 * * 6", "Saturdays at 09:00 (UTC)"],
  ["0 0 * * 0", "Sundays at 00:00 (UTC)"],
  ["0 0 * * 7", "Sundays at 00:00 (UTC)"],
  ["0 9 1 * *", "0 9 1 * *"],
  ["0 9 * * mon", "0 9 * * mon"],
  ["*/5 9 * * *", "*/5 9 * * *"],
  ["0 9,10 * * *", "0 9,10 * * *"],
  ["0 9 * 6 *", "0 9 * 6 *"],
  ["0 9 * * 1,3", "0 9 * * 1,3"],
  ["5 0 9 * * 1", "5 0 9 * * 1"],
];

/**
 * @param {Row} params The parameters of a composed text
 * @param {string} name One parameter
 * @returns {string} The parameter as text
 */
function shown(params, name) {
  const value = params[name];
  if (isText(value)) return value;
  return isNumber(value) ? String(value) : "?";
}

const DAYS = new Map([
  ["dms_automation.cron.days.sun", "Sundays"],
  ["dms_automation.cron.days.mon", "Mondays"],
  ["dms_automation.cron.days.tue", "Tuesdays"],
  ["dms_automation.cron.days.wed", "Wednesdays"],
  ["dms_automation.cron.days.thu", "Thursdays"],
  ["dms_automation.cron.days.fri", "Fridays"],
  ["dms_automation.cron.days.sat", "Saturdays"],
]);

/**
 * The English words of a composed cron text, as the dashboard's locale composes them.
 *
 * @param {string} key The message key
 * @param {Row} p The message parameters
 * @returns {string | undefined} The words, undefined for a key the locale does not know
 */
function wordsOf(key, p) {
  switch (key) {
    case "dms_automation.cron.everySecond":
      return "Every second";
    case "dms_automation.cron.everySeconds":
      return `Every ${shown(p, "n")} seconds`;
    case "dms_automation.cron.everyMinute":
      return "Every minute";
    case "dms_automation.cron.everyMinutes":
      return `Every ${shown(p, "n")} minutes`;
    case "dms_automation.cron.hourly":
      return `Every hour at :${shown(p, "minute")}`;
    case "dms_automation.cron.everyHours":
      return `Every ${shown(p, "n")} hours`;
    case "dms_automation.cron.everyHoursAt":
      return `Every ${shown(p, "n")} hours at :${shown(p, "minute")}`;
    case "dms_automation.cron.daily":
      return `Every day at ${shown(p, "time")}`;
    case "dms_automation.cron.weekdays":
      return `Weekdays at ${shown(p, "time")}`;
    case "dms_automation.cron.weekly":
      return `${DAYS.get(text(p, "day", "key")) ?? "?"} at ${shown(p, "time")}`;
    default:
      return undefined;
  }
}

/**
 * Whether a composed text, as the API sends it, reads as the English words.
 *
 * @param {unknown} composed The trigger text of a summary row
 * @param {string} words The English words
 * @returns {boolean} Whether it composes to them
 */
function flatten(composed, words) {
  if (isText(composed)) return composed === words;
  const params = pick(composed, "params");
  return wordsOf(text(composed, "key"), isRow(params) ? params : {}) === words;
}

/**
 * @param {string} value Text
 * @returns {string} The text as a regular expression source
 */
function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const wordingJourneys = [
  {
    id: "the-starts-when-column-words-a-schedule-and-a-webhook",
    title: "the Starts when column describes a schedule in words (Every hour at :00, Weekdays at 08:00 (UTC), Mondays at 09:00 (UTC)) or shows the expression itself, a webhook as METHOD /path, and names the trigger type under a webhook or a schedule",
    entryPoint: "GET /procedures/summary, GET /procedures/:id/triggers, /modules/automation/procedures",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { TZ: "UTC" }, async () => {
        /** @type {[string, string][]} */
        const ids = [];
        for (const [index, [cron]] of WORDING.entries()) ids.push([cron, await createProcedure(ctx, { name: `Wording ${String(index).padStart(2, "0")}`, graph: cronGraph(cron) })]);
        const summary = list((await auto(ctx, "summary", "GET", "/procedures/summary")).body);
        const rowOf = (/** @type {string} */ id) => summary.find((row) => row.procedureId === id) ?? {};
        const api = ids.map(([cron, id], index) => {
          const row = rowOf(id);
          const expected = WORDING[index]?.[1] ?? "";
          const composed = isText(row.triggerText) || isRow(row.triggerText) ? row.triggerText : "";
          return { cron, expected, composed };
        });
        await ctx.verify("the summary carries the cron words as composed text", api.map(({ cron, expected, composed }) => check(`${cron} -> ${expected}`, JSON.stringify(composed) !== undefined && flatten(composed, expected), JSON.stringify(composed))));

        const tab = await ctx.tab("admin");
        await tab.signIn("admin");
        await tab.goto("/modules/automation/procedures");
        await tab.shows(/Wording 00/);
        const pending = new Map(WORDING.map(([cron, words], index) => [`Wording ${String(index).padStart(2, "0")}`, { cron, words }]));
        /** @type {import("../../auto.mjs").Check[]} */
        const pageChecks = [];
        for (let page = 0; page < 6 && pending.size > 0; page += 1) {
          await tab.shows(/Wording \d\d/, { timeoutMs: 8000 });
          for (const [row, { cron, words }] of pending) {
            if (!(await tab.shows(new RegExp(row), { timeoutMs: 400 })).pass) continue;
            pending.delete(row);
            const read = await tab.shows(new RegExp(`${row}\\s+Draft\\s+${escape(words)}\\s+Schedule \\(cron\\)`), { timeoutMs: 1500 });
            pageChecks.push(check(`${cron} reads ${words}`, read.pass, read.detail));
          }
          if (pending.size === 0) break;
          await tab.click({ role: "button", name: "Next page" });
          await tab.visible({ role: "button", name: "Previous page" });
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        for (const [row, { cron }] of pending) pageChecks.push(check(`${cron} was found on a page`, false, row));
        await ctx.verify("the Procedures page words each schedule", pageChecks);
      });
    },
  },
];
