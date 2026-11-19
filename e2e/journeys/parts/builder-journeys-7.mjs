import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { createEnabled, createProcedure, graph, logsOf, manualLog, messages, runNow, runOf, runsOfProcedure } from "../../procs.mjs";
import { canvasNodeIds, eventually, openBuilder, pathOf, procedureOf, saveState } from "./builder-kit.mjs";
import { allInnerTexts, innerText } from "./overview-page.mjs";
import { textWhen } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const MESSAGE = "Hello from my first procedure";

/**
 * @param {import("../../auto.mjs").Row} procedure A stored procedure
 * @returns {string} The message of its Log step
 */
function messageOf(procedure) {
  const log = list(procedure, "graph", "nodes").find((node) => node.typeId === "log.message");
  return text(log, "config", "message");
}

/** @type {import("../../auto.mjs").Row[]} */
export const builderJourneys7 = [
  {
    id: "a-two-step-procedure-is-built-from-the-palette-tested-saved-and-run",
    title: "on an empty procedure, a Manual trigger and a Log action clicked in from the palette are joined by an edge; with {} as the Test payload, Test run runs the unsaved draft, Save stores the two steps, the test's trace holds the message in its Logs tab, and Run now runs the saved version for real",
    entryPoint: "/modules/automation/builder, palette, Test payload, Test run, Save, Open trace, Run now",
    async run(/** @type {Ctx} */ ctx) {
      const name = "Premier pas ☕";
      const id = await createProcedure(ctx, { name, graph: graph([]) });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await tab.click({ role: "button", name: "Manual", exact: true });
      await tab.click({ role: "button", name: "Log", exact: true });
      await tab.fill({ role: "textbox", name: "Message" }, MESSAGE);
      await ctx.verify("two blocks from the palette", [
        same("two steps on the canvas", (await canvasNodeIds(tab)).length, 2),
        tab.visible({ role: "group", name: "Manual → Log" }),
        same("Level is info by default", (await tab.page.getByRole("combobox", { name: "Level" }).innerText()).trim(), "info"),
        check("the changes are unsaved", /^\d+ unsaved changes?$/.test(await saveState(tab)), await saveState(tab)),
        same("nothing is stored yet", list(await procedureOf(ctx, id), "graph", "nodes").length, 0),
      ]);
      await tab.click({ role: "tab", name: "Test payload" });
      await ctx.verify("the Test payload", [same("is {} with no past call", (await tab.page.getByRole("textbox").last().inputValue()).trim(), "{}")]);
      await tab.click({ role: "button", name: "Test run Ctrl ↵" });
      const tests = await eventually(() => runsOfProcedure(ctx, id), (rows) => rows.some((row) => row.kind === "test"), 20_000);
      const testId = text(tests.find((row) => row.kind === "test"), "_id");
      await tab.visible({ role: "tab", name: "Test run" });
      const tested = await runOf(ctx, testId);
      await ctx.verify("Test run runs the draft", [
        same("one test run, succeeded", [tests.map((row) => row.kind), pick(tested, "status")], [["test"], "ok"]),
        check("the message is in the test's log", messages(await logsOf(ctx, testId)).includes(MESSAGE), testId),
        same("the Test run tab lists the steps that ran", (await allInnerTexts(tab.page.getByRole("button", { name: /\d+ (?:ms|s) \+\d+ (?:ms|s)$/ }))).map((t) => (/^(.*?)\s+\d+\s*(?:ms|s)/.exec(t.replace(/\s+/g, " ").trim()) ?? [])[1]), ["Manual", "Log"]),
        same("the test saved nothing", list(await procedureOf(ctx, id), "graph", "nodes").length, 0),
      ]);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const saved = await eventually(() => procedureOf(ctx, id), (p) => pathOf(p).length === 2);
      await ctx.verify("Save stores the two steps", [
        same("the path", pathOf(saved), ["trigger/manual", "action/log.message"]),
        same("the message", messageOf(saved), MESSAGE),
        same("still a disabled draft", saved.enabled, false),
        same("the save state", await eventually(() => saveState(tab), (state) => state === "Saved"), "Saved"),
      ]);
      await tab.click({ role: "button", name: "Open trace" });
      await tab.at(/\/modules\/automation\/trace$/);
      await tab.page.getByRole("tab", { name: /^Logs/ }).click();
      const logs = await textWhen(tab, new RegExp(MESSAGE));
      await ctx.verify("the test's trace", [same("Open trace opens the test", new URL(tab.page.url()).searchParams.get("run"), testId), check("the Logs tab holds the message", logs.includes(MESSAGE), logs.slice(-600))]);
      await openBuilder(ctx, `?selected=${id}`, { tab });
      await tab.click({ role: "button", name: "Run now" });
      const dialog = tab.page.getByRole("dialog", { name: `Run “${name}”` });
      await dialog.waitFor();
      await dialog.getByRole("button", { name: "Run", exact: true }).click();
      const runs = await eventually(() => runsOfProcedure(ctx, id), (rows) => rows.some((row) => row.kind === "run"), 20_000);
      const realId = text(runs.find((row) => row.kind === "run"), "_id");
      const real = await runOf(ctx, realId);
      await ctx.verify("Run now runs the saved version", [
        same("a real run, succeeded, of the saved version", [pick(real, "kind"), pick(real, "status"), pick(real, "procedureVersion")], ["run", "ok", saved.version]),
        check("the message is in the run's log", messages(await logsOf(ctx, realId)).includes(MESSAGE), realId),
        tab.shows(new RegExp(`${name} ran`)),
      ]);
    },
  },
  {
    id: "more-actions-view-all-runs-opens-its-runs-and-delete-procedure-asks-first",
    title: "in the builder's More actions, View all runs opens the Run history on this procedure, and Delete procedure asks first, telling an enabled procedure how often it ran this week, offering Pause and asking for its name; Cancel keeps it, and confirming deletes the graph, keeps its runs and leaves the deleted procedure",
    entryPoint: "/modules/automation/builder, More actions > View all runs, More actions > Delete procedure",
    async run(/** @type {Ctx} */ ctx) {
      const name = "À supprimer";
      const { id } = await createEnabled(ctx, { name, graph: manualLog("bye") });
      const first = await runNow(ctx, id, {});
      await runNow(ctx, id, {});
      await createProcedure(ctx, { name: "Reste là", graph: manualLog("stay") });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await tab.click({ role: "button", name: "More actions" });
      await tab.click({ role: "menuitem", name: "View all runs" });
      await tab.at(/\/modules\/automation\/runs$/);
      await ctx.verify("View all runs", [same("opens the Run history on this procedure", new URL(tab.page.url()).searchParams.get("procedure"), id), tab.shows(new RegExp(`Runs of ${name}`))]);
      await openBuilder(ctx, `?selected=${id}`, { tab });
      await tab.click({ role: "button", name: "More actions" });
      await tab.click({ role: "menuitem", name: "Delete procedure" });
      const dialog = tab.page.getByRole("dialog", { name: `Delete “${name}”?` });
      await dialog.waitFor();
      const asked = (await innerText(dialog)).replace(/\s+/g, " ");
      await ctx.verify("Delete procedure asks first", [
        check("it says how often the enabled procedure ran this week and offers Pause", /This procedure is enabled and ran 2 times this week\. Only need it to stop\? Pause it instead/.test(asked), asked),
        check("it says the graph is deleted for good", /can’t be undone/.test(asked), asked),
        check("an enabled procedure must have its name typed", asked.includes(`Type ${name} to confirm`), asked),
      ]);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 10_000 });
      await ctx.verify("Cancel keeps it", [same("the procedure is still there", (await auto(ctx, "read after cancel", "GET", `/procedures/${id}`)).status, 200)]);
      await tab.click({ role: "button", name: "More actions" });
      await tab.click({ role: "menuitem", name: "Delete procedure" });
      await dialog.waitFor();
      await dialog.getByRole("textbox").fill(name);
      await dialog.getByRole("button", { name: "Delete procedure" }).click();
      const gone = await eventually(async () => (await auto(ctx, "read the deleted procedure", "GET", `/procedures/${id}`)).status, (status) => status === 404);
      await ctx.verify("confirming deletes it", [
        same("the API answers 404", gone, 404),
        tab.shows(new RegExp(`${name} deleted`)),
        same("its runs stay", (await auto(ctx, "read a run of the deleted procedure", "GET", `/runs/${first.runId}`)).status, 200),
        check("the builder left the deleted procedure", !(await eventually(async () => tab.page.url(), (url) => !url.includes(id))).includes(id), tab.page.url()),
      ]);
    },
  },
];
