import { readFileSync } from "node:fs";
import { auto, check, isRow, parseJson, pick, same, text } from "../../auto.mjs";
import { action, chain, clearLedger, createProcedure, ledger, manualLog, runsOfProcedure, statusIs, trigger } from "../../procs.mjs";
import { eventually, openBuilder, procedureOf, saveState, settle } from "./builder-kit.mjs";
import { allInnerTexts, byText, innerText, suggestedFilename } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */


const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import("../../auto.mjs").Row[]} */
export const builderJourneys3 = [
  {
    id: "a-test-that-would-act-for-real-asks-first-and-runs-nothing-if-cancelled",
    title: "Test run lists the steps that cannot be simulated in Test with real effects? (steps that declare a dry run are simulated, pure ones run as is); Cancel runs nothing; Test for real runs the draft",
    entryPoint: "/modules/automation/builder, Test run",
    async run(/** @type {Ctx} */ ctx) {
      const steps = [trigger("t"), action("a", "verify.effect", { label: "a" }), action("b", "verify.effect-nodry", { label: "b" }), action("c", "verify.effect-pure", { label: "c" }), action("log", "log.message", { message: "x" })];
      const id = await createProcedure(ctx, { name: "Effets réels", graph: chain(steps) });
      await clearLedger(ctx);
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await tab.click({ role: "button", name: "Test run Ctrl ↵" });
      const asked = await tab.visible({ role: "dialog", name: "Test with real effects?" }, { timeoutMs: 15_000 });
      await ctx.verify("the confirmation dialog", [check("the dialog is titled Test with real effects?", asked.pass, asked.detail)], { critical: true });
      const dialog = tab.page.getByRole("dialog", { name: "Test with real effects?" });
      await ctx.verify("the confirmation names the step that acts for real", [
        same("the sentence", (await dialog.locator("p").first().innerText()).trim(), "This test acts for real: 1 step below changes something outside the run (sends, writes, calls a service) and can’t be simulated. Steps that can simulate are simulated."),
        same("the listed steps", (await allInnerTexts(dialog.getByRole("listitem"))).map((t) => t.trim()), ["Fixture verify.effect-nodry"]),
        tab.visible({ role: "button", name: "Cancel" }),
        tab.visible({ role: "button", name: "Test for real" }),
        tab.shows(/esc\s+to cancel/i),
      ]);
      await tab.click({ role: "button", name: "Cancel" });
      await sleep(800);
      const afterCancel = await ledger(ctx);
      await ctx.verify("Cancel runs nothing", [
        same("no run", (await runsOfProcedure(ctx, id)).length, 0),
        same("the ledger is empty", afterCancel.entries.length, 0),
        tab.visible({ role: "dialog", name: "Test with real effects?" }, { hidden: true }),
        tab.visible({ role: "tab", name: "Test run" }, { hidden: true }),
      ]);
      await tab.click({ role: "button", name: "Test run Ctrl ↵" });
      await tab.click({ role: "button", name: "Test for real" });
      const runs = await eventually(() => runsOfProcedure(ctx, id), (rows) => rows.length > 0);
      const after = await ledger(ctx);
      await ctx.verify("Test for real runs the draft: simulated where possible", [
        same("one run, a test", runs.map((run) => run.kind), ["test"]),
        same("what the fixture saw, in order", after.entries.map((entry) => `${String(entry.kind)}:${String(entry.type)}:${String(entry.label)}:${String(entry.ctxDryRun)}`), ["dry-run:verify.effect:a:true", "execute:verify.effect-nodry:b:true", "execute:verify.effect-pure:c:true"]),
        tab.visible({ role: "tab", name: "Test run" }),
      ]);
      await tab.click({ role: "button", name: "Exit debug Esc" });
      await auto(ctx, "two steps that act for real", "PUT", `/procedures/${id}`, { body: { name: "Effets réels", description: "", enabled: false, graph: chain([trigger("t"), action("b", "verify.effect-nodry", { label: "1" }), action("c", "verify.effect-nodry", { label: "2" })]), expectedRevision: (await procedureOf(ctx, id)).revision } });
      await tab.goto(`/modules/automation/builder?selected=${id}`);
      await tab.visible({ role: "button", name: "Procedures" });
      await settle(tab);
      await tab.click({ role: "button", name: "Test run Ctrl ↵" });
      const askedAgain = await tab.visible({ role: "dialog", name: "Test with real effects?" }, { timeoutMs: 15_000 });
      await ctx.verify("the confirmation dialog", [check("the dialog is titled Test with real effects?", askedAgain.pass, askedAgain.detail)], { critical: true });
      const plural = tab.page.getByRole("dialog", { name: "Test with real effects?" });
      await ctx.verify("several steps read in the plural, in graph order", [
        same("the sentence", (await plural.locator("p").first().innerText()).trim(), "This test acts for real: 2 steps below change something outside the run (send, write, call a service) and can’t be simulated. Steps that can simulate are simulated."),
        same("the listed steps", (await allInnerTexts(plural.getByRole("listitem"))).map((t) => t.trim()), ["Fixture verify.effect-nodry", "Fixture verify.effect-nodry"]),
      ]);
      await tab.click({ role: "button", name: "Cancel" });
    },
  },
  {
    id: "run-now-runs-the-saved-version-and-asks-about-unsaved-changes",
    title: "Run now opens a dialog with an editable payload that defaults to the last real call, refuses invalid JSON, and runs the saved procedure for real; with unsaved changes it first asks whether to run the saved version or test the draft",
    entryPoint: "/modules/automation/builder, Run now",
    async run(/** @type {Ctx} */ ctx) {
      const name = "Maintenant ⚡";
      const id = await createProcedure(ctx, { name, graph: manualLog("hello") });
      await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await tab.click({ role: "button", name: "Run now" });
      const dialog = tab.page.getByRole("dialog", { name: `Run “${name}”` });
      await dialog.waitFor();
      await ctx.verify("the dialog before any call", [
        tab.shows(/Runs the saved version with this payload\./),
        tab.shows(/No past call: edit the payload by hand\./),
        tab.shows(/Side effects are real: the services it calls receive the data\./),
        same("the default payload", (await dialog.getByRole("textbox").innerText()).trim(), "{}"),
        tab.visible({ role: "button", name: "Run", exact: true }),
        tab.visible({ role: "button", name: "Cancel" }),
      ]);
      await dialog.getByRole("textbox").fill("{ broken");
      await dialog.getByRole("button", { name: "Run", exact: true }).click();
      await sleep(800);
      await ctx.verify("invalid JSON is refused", [tab.shows(/The payload is not valid JSON: /), same("no run", (await runsOfProcedure(ctx, id)).length, 0)]);
      const payload = { client: "Zoë 日本語", total: 12.5, tags: ["a", "b"] };
      await dialog.getByRole("textbox").fill(JSON.stringify(payload));
      await dialog.getByRole("button", { name: "Run", exact: true }).click();
      const runs = await eventually(() => runsOfProcedure(ctx, id), (rows) => rows.length > 0);
      await ctx.verify("Run runs the saved procedure with the payload", [
        same("one run, a real one", runs.map((run) => run.kind), ["run"]),
        same("its payload", parseJson(String(pick((await auto(ctx, "read the run", "GET", `/runs/${String(runs[0]?._id)}`)).body, "triggerPayload"))), payload),
        tab.shows(new RegExp(`${name} ran`)),
        tab.visible({ role: "dialog", name: `Run “${name}”` }, { hidden: true }),
      ]);
      await tab.click({ role: "button", name: "Run now" });
      const reopened = tab.page.getByRole("dialog", { name: `Run “${name}”` });
      await reopened.waitFor();
      await ctx.verify("the payload defaults to the last call", [
        same("the payload", await eventually(async () => parseJson((await innerText(reopened.getByRole("textbox"))) || "null"), (v) => isRow(v) && "client" in v, 5000), payload),
        tab.shows(new RegExp(`Prefilled from the last real call \\(run …${String(runs[0]?._id).slice(-6)}\\)\\.`)),
      ]);
      await tab.click({ role: "button", name: "Cancel" });
      await tab.fill({ role: "textbox", name: "Procedure name" }, "Brouillon non sauvé");
      await tab.click({ role: "button", name: "Run now" });
      const question = tab.page.getByRole("dialog", { name: "Run the saved version?" });
      await question.waitFor();
      await ctx.verify("unsaved changes raise the question", [
        same("the sentence", (await question.locator("p").last().innerText()).trim(), "Run now runs what is saved: your 1 unsaved change won’t be included. Test run tries the draft without saving it."),
        tab.visible({ role: "button", name: "Cancel" }),
        tab.visible({ role: "button", name: "Test run the draft" }),
        tab.visible({ role: "button", name: "Run saved version" }),
      ]);
      await tab.click({ role: "button", name: "Test run the draft" });
      const withTest = await eventually(() => runsOfProcedure(ctx, id), (rows) => rows.some((run) => run.kind === "test"));
      await ctx.verify("Test run the draft tests without saving", [
        same("run kinds, newest first", withTest.map((run) => run.kind), ["test", "run"]),
        same("the name is still unsaved", (await procedureOf(ctx, id)).name, name),
        same("the save state", await saveState(tab), "1 unsaved change"),
      ]);
      await tab.click({ role: "button", name: "Exit debug Esc" });
      await tab.click({ role: "button", name: "Run now" });
      await tab.click({ role: "button", name: "Run saved version" });
      await ctx.verify("Run saved version opens the Run dialog of the saved name", [tab.visible({ role: "dialog", name: `Run “${name}”` })]);
    },
  },
  {
    id: "export-json-downloads-the-procedure-and-import-recreates-it",
    title: "More actions > Export JSON downloads a .json file holding the procedure's name, description and graph, which Import JSON re-creates as a disabled draft",
    entryPoint: "/modules/automation/builder, More actions > Export JSON",
    async run(/** @type {Ctx} */ ctx) {
      const name = "Exporté « é » 日本語 🚀";
      const id = await createProcedure(ctx, { name, description: "Une description\navec ligne", graph: chain([trigger("t"), action("log", "log.message", { message: "Héllo 🌍", level: "warn" })]) });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await tab.click({ role: "button", name: "More actions" });
      const [download] = await Promise.all([tab.page.waitForEvent("download"), tab.page.getByRole("menuitem", { name: "Export JSON" }).click()]);
      const path = await download.path();
      const content = readFileSync(path ?? "", "utf8");
      const stored = await procedureOf(ctx, id);
      const parsed = parseJson(content);
      await ctx.verify("the downloaded file", [
        check("it is a .json file", suggestedFilename(download).endsWith(".json"), suggestedFilename(download)),
        same("its keys", Object.keys(isRow(parsed) ? parsed : {}).sort(byText), ["description", "graph", "name"]),
        same("the name", pick(parsed, "name"), name),
        same("the description", pick(parsed, "description"), "Une description\navec ligne"),
        same("the graph is the stored one", pick(parsed, "graph"), stored.graph),
      ]);
      const imported = await auto(ctx, "import the exported file", "POST", "/procedures/import", { body: { json: content } });
      const copy = await procedureOf(ctx, text(imported.body, "_id"));
      await ctx.verify("importing it re-creates the procedure as a disabled draft", [
        statusIs(imported, 200, "import answers 200"),
        same("a disabled draft", copy.enabled, false),
        same("the same graph", copy.graph, stored.graph),
        same("the same description", copy.description, "Une description\navec ligne"),
        same("the name", copy.name, name),
      ]);
    },
  },
];
