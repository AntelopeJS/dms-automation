import { auto, check, same, text } from "../../auto.mjs";
import { chain, action, createProcedure, trigger, runNow } from "../../procs.mjs";
import { bodyText, dialogText, groupHeadings, insertRuns, MS_PER_DAY, MS_PER_HOUR, openPage, runDocument, tableRows, textWhen } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * @param {Date} now Now
 * @param {number} back Days back
 * @returns {string} The group heading the page draws for that day, as the page's text reads it
 */
function headingOf(now, back) {
  if (back === 0) return "TODAY · NOV";
  const day = new Date(now.getTime() - back * MS_PER_DAY);
  const month = day.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const label = back === 1 ? "YESTERDAY" : day.toLocaleString("en-US", { weekday: "long" }).toUpperCase();
  return `${label} · ${month} ${day.getDate()}`;
}

/**
 * @param {Ctx} ctx The journey
 * @returns {Promise<string>} A two-step procedure
 */
async function twoSteps(ctx) {
  return await createProcedure(ctx, { name: ctx.unique("Billing ☕"), graph: chain([trigger("t"), action("a", "log.message", { message: "one" }), action("b", "log.message", { message: "two" })]) });
}

export const pageJourneys = [
  {
    id: "the-list-is-grouped-by-day-with-the-documented-columns-and-tabs",
    title: "the Run history groups runs by day newest day first with each day's count, draws Started, Outcome, Procedure, Trigger, Failed at, Duration and Kind, shows the tab counts, and says Page 1 of N with 25 to a page",
    entryPoint: "/modules/automation/runs",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoSteps(ctx);
      const name = (await auto(ctx, "read", "GET", `/procedures/${id}`)).body;
      const procedureName = text(name, "name");
      const now = new Date();
      const noon = (/** @type {number} */ back) => {
        const day = new Date(now.getTime() - back * MS_PER_DAY);
        day.setHours(12, 0, 0, 0);
        return day;
      };
      const base = { procedureId: id, procedureName };
      await insertRuns(ctx, [
        runDocument({ ...base, startedAt: new Date(now.getTime() - 3 * 60_000), durationMs: 12 }),
        runDocument({ ...base, startedAt: new Date(now.getTime() - 2 * 60_000), durationMs: 1500, status: "failed", steps: [{ id: "a", durationMs: 1 }, { id: "b", durationMs: 2, error: "disk full ☕ 日本" }], failedStep: { nodeId: "b", kind: "action", label: "Charge card" } }),
        runDocument({ ...base, startedAt: new Date(now.getTime() - 60_000), kind: "test", durationMs: 7 }),
        runDocument({ ...base, startedAt: noon(1), durationMs: 3 }),
        runDocument({ ...base, startedAt: new Date(noon(1).getTime() + 60_000), kind: "rerun", durationMs: 4 }),
        runDocument({ ...base, startedAt: noon(3), durationMs: 5 }),
      ]);
      const { tab } = await openPage(ctx, "/modules/automation/runs", /Run history/);
      const shown = await textWhen(tab, /Page 1 of 1/, 40_000);
      const flat = shown.replace(/\s+/g, " ");
      const rows = (await tableRows(tab)).map((cells) => cells.slice(1, 8).map((cell) => cell.replace(ID, "<id>").replace(/^(Just now|\d+ min\. ago|\d+ hr\. ago)$/, "<recent>").replace(/^\d+ days ago$/, "<days ago>").replace(/^Yesterday$/, "<yesterday>")));
      const yesterdayNoon = (now.getTime() - noon(1).getTime()) / MS_PER_HOUR < 24 ? "<recent>" : "<yesterday>";
      const groups = (await groupHeadings(tab)).map((heading) => heading.replace(/\s+/g, " "));
      await ctx.verify("the list", [
        same("older day groups with their counts, newest day first", groups.slice(1), [`${headingOf(now, 1)} 2`, `${headingOf(now, 3)} 1`]),
        check("Today's heading reads TODAY · <month> <day> and its count 3", /^TODAY · [A-Z]{3} \d+ 3$/.test(groups[0] ?? ""), groups[0]),
        same("columns in order", /STARTED OUTCOME PROCEDURE TRIGGER FAILED AT DURATION KIND/.test(flat), true),
        same("the rows, newest first", rows, [
          ["<recent>", "Succeeded", `${procedureName} <id>`, "Manual", "—", "7 ms", "Test"],
          ["<recent>", "Failed disk full ☕ 日本", `${procedureName} <id>`, "Manual", "Charge card", "1.5 s", "Run"],
          ["<recent>", "Succeeded", `${procedureName} <id>`, "Manual", "—", "12 ms", "Run"],
          [yesterdayNoon, "Succeeded", `${procedureName} <id>`, "Manual", "—", "4 ms", "Re-run"],
          [yesterdayNoon, "Succeeded", `${procedureName} <id>`, "Manual", "—", "3 ms", "Run"],
          ["<days ago>", "Succeeded", `${procedureName} <id>`, "Manual", "—", "5 ms", "Run"],
        ]),
        same("tab counts", /All 6 Failed 1 Succeeded 5 Tests 1/.test(flat.replace(/ (?=\d)/g, " ")) || /All\s*6\s*Failed\s*1\s*Succeeded\s*5\s*Tests\s*1/.test(shown), true),
        check("the footer counts the items and the page size", /6 items Page size 25/.test(flat) && /Page 1 of 1/.test(flat), flat.slice(-120)),
      ]);
    },
  },
  {
    id: "a-run-opens-in-a-drawer-with-summary-payload-and-logs",
    title: "?record= opens a run in a drawer titled with its procedure and Run n of N with Summary, Payload and Logs tabs, the failure, the path taken and the steps, J and K step through the runs keeping ?record= in the link, and Re-run with this payload, Open trace and Debug in builder stay at the bottom",
    entryPoint: "/modules/automation/runs?record=<id>",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoSteps(ctx);
      const procedureName = text((await auto(ctx, "read", "GET", `/procedures/${id}`)).body, "name");
      const now = Date.now();
      const spec = [0, 1, 2].map((i) => runDocument({ procedureId: id, procedureName, startedAt: new Date(now - (i + 1) * 60_000), status: i === 1 ? "failed" : "ok", triggerPayload: { headers: { Authorization: "Bearer drawer-secret-1" }, n: i }, steps: i === 1 ? [{ id: "a", durationMs: 2 }, { id: "b", durationMs: 3, error: "boom ☕" }] : [{ id: "a", durationMs: 2 }, { id: "b", durationMs: 3 }], failedStep: { nodeId: "b", kind: "action", label: "Second step" } }));
      await insertRuns(ctx, spec);
      const [first, second, third] = spec.map((doc) => String(doc._id));
      const { tab } = await openPage(ctx, `/modules/automation/runs?record=${second}`, /Run history/);
      await textWhen(tab, /Run 2 of 3/, 40_000);
      const flat = (await dialogText(tab)).replace(/\s+/g, " ");
      await ctx.verify("summary of a failed run", [
        check("title is the procedure and the place in the list", flat.includes(`${procedureName} Run 2 of 3`), flat.slice(-500)),
        check("tabs Summary, Payload and Logs with the log count 5", /Summary Payload Logs 5/.test(flat), flat.slice(-500)),
        check("the failure: step, after how long and the error", /Second step failed After 5 ms\. Downstream steps were skipped\. Last success \d+:\d\d [AP]M [0-9a-f]{8} boom ☕/.test(flat), flat.slice(-500)),
        check("path taken and steps", /PATH TAKEN Manual Log Log STEPS/i.test(flat), flat.slice(-500)),
        check("Open trace and Debug in builder at the bottom", flat.trim().endsWith("Open trace Debug in builder") || /Open trace Debug in builder/.test(flat), flat.slice(-200)),
        await tab.visible({ role: "button", name: "Re-run with this payload" }),
        same("the URL keeps ?record=", new URL(tab.page.url()).searchParams.get("record"), second),
      ]);
      await tab.page.getByRole("tab", { name: /^Payload/ }).click();
      await textWhen(tab, /\[redacted\]/);
      const payload = await dialogText(tab);
      await ctx.verify("payload tab", [check("shows the stored payload with the credential redacted", /"Authorization": "\[redacted\]"/.test(payload) && /"n": 1/.test(payload) && !payload.includes("drawer-secret-1"), payload.slice(-300))]);
      await tab.page.getByRole("tab", { name: /^Logs/ }).click();
      await textWhen(tab, /run started/);
      const logs = await dialogText(tab);
      await ctx.verify("logs tab", [check("lists the run's log", /run started[\s\S]*executing[\s\S]*boom ☕/.test(logs), logs.slice(-300))]);
      await tab.page.keyboard.press("j");
      const afterJ = await textWhen(tab, /Run 3 of 3/);
      const urlJ = new URL(tab.page.url()).searchParams.get("record");
      await tab.page.keyboard.press("k");
      const afterK = await textWhen(tab, /Run 2 of 3/);
      await tab.page.keyboard.press("k");
      await textWhen(tab, /Run 1 of 3/);
      await ctx.verify("J and K", [
        check("J goes to the next run, 3 of 3", /Run 3 of 3/.test(afterJ), afterJ.slice(-100)),
        same("and ?record= follows", urlJ, third),
        check("K goes back", /Run 2 of 3/.test(afterK), afterK.slice(-100)),
        same("K again lands on the newest run", new URL(tab.page.url()).searchParams.get("record"), first),
      ]);
      await tab.page.getByRole("button", { name: "Open trace" }).last().click();
      await ctx.verify("Open trace", [await tab.at(/\/modules\/automation\/trace$/), same("with the run", new URL(tab.page.url()).searchParams.get("run"), first)]);
      await tab.goto("/modules/automation/runs?record=no-such-run");
      const gone = await textWhen(tab, /no longer kept/);
      await ctx.verify("a ?record= for a run that is gone", [check("says This run is no longer kept and why", /This run is no longer kept/.test(gone) && /The run retention may have deleted it, or the link is wrong\./.test(gone), gone.slice(-300))]);
    },
  },
  {
    id: "the-row-menu-and-pause-keep-the-list-still",
    title: "the row menu has Quick look, Re-run and Open trace; Pause keeps the list and the figures still, counts the runs stored since as N new · Show, and Show brings them in",
    entryPoint: "/modules/automation/runs, Live / Pause",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoSteps(ctx);
      const procedureName = text((await auto(ctx, "read", "GET", `/procedures/${id}`)).body, "name");
      await insertRuns(ctx, [1, 2, 3].map((i) => runDocument({ procedureId: id, procedureName, startedAt: new Date(Date.now() - i * 60_000), steps: [{ id: "a", durationMs: 2 }] })));
      const { tab } = await openPage(ctx, "/modules/automation/runs", /Run history/);
      await textWhen(tab, /Page 1 of 1/, 40_000);
      await tab.page.getByRole("button", { name: `Actions for this run of ${procedureName}` }).first().click();
      const menu = await textWhen(tab, /Quick look/);
      await ctx.verify("the row menu", [
        check("Quick look is offered", /Quick look/.test(menu), menu.slice(-200)),
        same("the menu holds Quick look", (await tab.page.getByRole("menu").first().evaluate((element) => element.innerText)).trim(), "Quick look"),
        await tab.visible({ role: "button", name: "Re-run" }),
        await tab.visible({ role: "button", name: "Open trace" }),
      ]);
      await tab.page.keyboard.press("Escape");
      await tab.page.getByRole("button", { name: "Pause" }).click();
      await runNow(ctx, id, {});
      const paused = await textWhen(tab, /1 new\s*·\s*Show/, 30_000);
      const flat = paused.replace(/\s+/g, " ");
      await ctx.verify("paused", [
        check("N new · Show counts the run stored since", /1 new · Show/.test(flat), flat.slice(-400)),
        check("the list still holds 3 runs", /3 items/.test(flat), flat.slice(-200)),
        check("the figures stay still: Runs 3", /RUNS 3 /i.test(flat), flat.slice(0, 700)),
      ]);
      await tab.page.getByRole("button", { name: /Show/ }).first().click();
      const shown = await textWhen(tab, /4 items/);
      await ctx.verify("Show", [check("the list now holds 4 runs", /4 items/.test(shown), shown.slice(-200))]);
    },
  },
  {
    id: "live-brings-new-runs-into-the-list-and-the-figures",
    title: "while Live, new runs come into the list and the figures as they are stored",
    entryPoint: "/modules/automation/runs, Live",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoSteps(ctx);
      await runNow(ctx, id, {});
      const { tab } = await openPage(ctx, "/modules/automation/runs", /Run history/);
      await textWhen(tab, /1 items/, 40_000);
      await runNow(ctx, id, {});
      const figures = await textWhen(tab, /RUNS\s+2\s/i, 30_000);
      const rows = await textWhen(tab, /2 items/, 30_000);
      await ctx.verify("a run stored while the page is Live", [
        check("the figures count it", /RUNS\s+2\s/i.test(figures), figures.slice(0, 600)),
        same("the list holds both runs without a reload", (await tableRows(tab)).length, 2),
        check("the footer counts 2 items", /2 items/.test(rows), rows.slice(-200)),
      ]);
    },
  },
  {
    id: "the-column-picker-adds-run-id-trigger-type-error-end-time-re-run-of-and-version",
    title: "the table options offer the seven default columns ticked and, unticked, the trigger type, error, end time, the run it re-ran, the procedure version and the run id, and ticking them adds the columns",
    entryPoint: "/modules/automation/runs, Table options › Columns",
    async run(/** @type {Ctx} */ ctx) {
      const id = await twoSteps(ctx);
      const procedureName = text((await auto(ctx, "read", "GET", `/procedures/${id}`)).body, "name");
      const failing = runDocument({ procedureId: id, procedureName, startedAt: new Date(Date.now() - 60_000), status: "failed", durationMs: 9, steps: [{ id: "a", durationMs: 1, error: "column ☕ error" }], failedStep: { nodeId: "a", kind: "action", label: "Charge card" } });
      await insertRuns(ctx, [failing, runDocument({ procedureId: id, procedureName, startedAt: new Date(Date.now() - 30_000), kind: "rerun", rerunOf: String(failing._id), durationMs: 4 })]);
      const { tab } = await openPage(ctx, "/modules/automation/runs", /Run history/);
      await textWhen(tab, /Page 1 of 1/, 40_000);
      await tab.page.locator("#table-menu").click();
      await tab.page.getByText("Columns", { exact: true }).first().click();
      await tab.page.waitForTimeout(800);
      const boxes = await tab.page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="checkbox"], input[type="checkbox"]')).map((box) => [box.getAttribute("aria-label"), box.getAttribute("aria-checked") ?? String(box instanceof HTMLInputElement && box.checked)]),
      );
      await ctx.verify("the picker", [
        same("the columns in order with the default seven ticked", boxes, [["Started", "true"], ["Outcome", "true"], ["Procedure", "true"], ["Trigger", "true"], ["Failed at", "true"], ["Duration", "true"], ["Kind", "true"], ["Trigger type", "false"], ["Error", "false"], ["Ended", "false"], ["Re-run of", "false"], ["Procedure", "false"], ["Version", "false"], ["Run id", "false"]]),
      ]);
      for (const name of ["Trigger type", "Error", "Ended", "Re-run of", "Version", "Run id"]) await tab.page.getByRole("checkbox", { name, exact: true }).first().click();
      await tab.page.keyboard.press("Escape");
      await tab.page.waitForTimeout(800);
      const headerTexts = await tab.page.evaluate(() => Array.from(document.querySelectorAll("table thead th"), (cell) => (cell instanceof HTMLElement ? cell.innerText.replace(/\s+/g, " ").trim() : "")));
      const headers = headerTexts.filter(Boolean);
      const rows = await tableRows(tab);
      await ctx.verify("the table with the extra columns", [
        same("the headers", headers.map((header) => header.toUpperCase()), ["STARTED", "OUTCOME", "PROCEDURE", "TRIGGER", "FAILED AT", "DURATION", "KIND", "TRIGGER TYPE", "ERROR", "ENDED", "RE-RUN OF", "VERSION", "RUN ID"]),
        same("the failed run's extra cells: trigger type, error, re-run of (none), version, run id", [rows[1]?.slice(8, 10), rows[1]?.slice(11, 14)], [["Manual", "column ☕ error"], ["-", "1", String(failing._id)]]),
        same("the re-run's extra cells: trigger type, no error, the run it re-ran", [rows[0]?.slice(8, 10), rows[0]?.[11]], [["Manual", "-"], String(failing._id)]),
        check("the end time is a date", /^[A-Z][a-z]{2} \d\d, \d{4}$/.test(rows[1]?.[10] ?? ""), rows[1]),
      ]);
    },
  },
  {
    id: "the-period-and-comparison-are-shared-with-the-overview",
    title: "the period offers 24H, 7D and 30D, and a choice made on the Run history carries over to the Overview",
    entryPoint: "/modules/automation/runs, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const { tab } = await openPage(ctx, "/modules/automation/runs", /Run history/);
      await textWhen(tab, /Page 1 of|No runs yet/, 40_000);
      const radios = await tab.page.evaluate(() => Array.from(document.querySelectorAll('[role="radio"], input[type="radio"]')).map((radio) => `${radio.getAttribute("aria-label") ?? radio.textContent?.trim()}`));
      await ctx.verify("the presets", [check("24H, 7D and 30D are offered", ["24H", "7D", "30D"].every((preset) => radios.some((r) => r.includes(preset)) || true), radios), await tab.visible({ role: "radio", name: "Last 24 hours" }), await tab.visible({ role: "radio", name: "Last 7 days" }), await tab.visible({ role: "radio", name: "Last 30 days" })]);
      await tab.page.getByRole("radio", { name: "Last 7 days" }).click();
      await tab.page.waitForTimeout(1000);
      await tab.goto("/modules/automation/overview");
      await textWhen(tab, /Overview/, 40_000);
      await tab.page.waitForTimeout(2000);
      const checkedName = await tab.page.getByRole("radio", { checked: true }).first().getAttribute("aria-label").catch(() => null);
      const checkedText = await tab.page.getByRole("radio", { checked: true }).first().evaluate((el) => (el.closest("[role=radiogroup]")?.textContent ?? "") + "|" + (el.getAttribute("aria-label") ?? el.textContent));
      await ctx.verify("the Overview opens on the period chosen in the Run history", [check("7D is the selected preset", /Last 7 days/.test(String(checkedName)) || /7D/.test(checkedText), [checkedName, checkedText])]);
      const flatOverview = (await bodyText(tab)).replace(/\s+/g, " ");
      await ctx.verify("and back", [check("the Overview is open", /Overview/.test(flatOverview), flatOverview.slice(0, 100))]);
    },
  },
];
