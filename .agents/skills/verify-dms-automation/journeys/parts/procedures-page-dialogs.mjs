import { auto, check, list, same } from "../../auto.mjs";
import { createProcedure, graph, manualLog, runNow, chain, trigger, action } from "../../procs.mjs";
import { EMPTY_GRAPH, procedureOf } from "./procedures-common.mjs";

import { dialogText, flat, innerOf, openDialog, openPage, rowsWhen, tableRows } from "./procedures-page-ui.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */



export const journeys = [
  {
    id: "new-procedure-dialog-creates-a-disabled-draft-and-opens-the-builder",
    title: "New procedure asks for a name, what starts it (A webhook is called, On a schedule, I run it) and a description, and Create and open the builder makes a disabled draft with the trigger in place",
    entryPoint: "/modules/automation/procedures, New procedure",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openPage(ctx);
      await openDialog(tab, "New procedure");
      const shown = await dialogText(tab);
      const dialog = tab.page.getByRole("dialog").last();
      await dialog.getByRole("button", { name: "Create and open the builder" }).click();
      await tab.page.waitForTimeout(1200);
      const stayed = await dialogText(tab);
      await dialog.getByRole("textbox", { name: /^Name/ }).fill("Café 日本 ☕");
      await dialog.getByText("I run it", { exact: true }).click();
      await dialog.getByRole("textbox", { name: /^Description/ }).fill("From the dialog é");
      await dialog.getByRole("button", { name: "Create and open the builder" }).click();
      const opened = await tab.at(/\/builder$/, { timeoutMs: 20_000 });
      const id = new URL(tab.page.url()).searchParams.get("selected") ?? "";
      const saved = await procedureOf(ctx, id);
      await ctx.verify("the dialog", [
        check("title, subtitle, fields and the three starters with their hints", /^New procedure Name it and pick what starts it\. It starts as a disabled draft: nothing fires until you enable it\. Name \* Starts when \* A webhook is called An HTTP call from Stripe, Shopify or any service On a schedule Every hour, every Monday at 09:00… I run it With Run now, or from the API Description \* Required fields Cancel Create and open the builder$/.test(shown), shown),
        check("without a name nothing is created and the dialog stays", /New procedure/.test(stayed), stayed),
        same("creating opens the builder on the new draft", [opened.pass, id.length > 0], [true, true]),
        same("the draft: name, description, disabled, one manual trigger", [saved.name, saved.description, saved.enabled, list(saved.graph, "nodes").map((n) => n.typeId)], ["Café 日本 ☕", "From the dialog é", false, ["manual"]]),
      ]);
    },
  },
  {
    id: "import-json-dialog-creates-a-draft-or-says-why-not",
    title: "Import JSON takes the exported file's content, Import and open the builder creates a disabled draft; JSON that is not an exported procedure, or uses a step kind this installation lacks, is refused with the reason under the field",
    entryPoint: "/modules/automation/procedures, Import JSON",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openPage(ctx);
      await openDialog(tab, "Import JSON");
      const dialog = tab.page.getByRole("dialog").last();
      const shown = await dialogText(tab);
      const editor = tab.page.locator('[role="dialog"] [contenteditable="true"]').first();
      const attempt = async (/** @type {string} */ content) => {
        await editor.click();
        await tab.page.keyboard.press("Control+A");
        await tab.page.keyboard.insertText(content);
        await dialog.getByRole("button", { name: "Import and open the builder" }).click();
        await tab.page.waitForTimeout(1800);
        if (!(await dialog.isVisible())) return `(dialog closed) ${tab.page.url()}`;
        return flat(await dialog.evaluate((element) => element.innerText));
      };
      const node = { id: "a", kind: "wat", config: {}, position: { x: 0, y: 0 } };
      const notJson = await attempt("{nope");
      const notProcedure = await attempt(JSON.stringify({ graph: EMPTY_GRAPH }));
      const unknownKind = await attempt(JSON.stringify({ name: "x", graph: graph([node]) }));
      const invalidGraph = await attempt(JSON.stringify({ name: "x", graph: { nodes: 3 } }));
      const sentGraph = manualLog("imported log");
      const exported = JSON.stringify({ name: "Imported é 日本", description: "from the dialog", graph: sentGraph });
      await attempt(exported);
      const opened = await tab.at(/\/builder$/, { timeoutMs: 20_000 });
      const id = new URL(tab.page.url()).searchParams.get("selected") ?? "";
      const saved = await procedureOf(ctx, id);
      await ctx.verify("the dialog", [
        check("title, subtitle, field label and hint, the buttons", shown.startsWith("Import JSON Paste a procedure exported from a builder. It is imported as a disabled draft. Procedure JSON * Paste the content of the file “Export JSON” downloads (name, description and graph).") && shown.endsWith("Import and open the builder"), shown),
        check("not JSON: This isn’t valid JSON.", notJson.includes("This isn’t valid JSON."), notJson),
        check("no name: the needs-a-name-and-a-graph text", notProcedure.includes("This JSON is not an exported procedure: it needs a name and a graph."), notProcedure),
        check("unknown kind: install the module or remove the step", unknownKind.includes("This procedure uses a kind of step this installation doesn’t have: install the module it comes from, or remove the step."), unknownKind),
        check("graph of another shape: export it again", invalidGraph.includes("This JSON is a procedure, but its graph is not valid: export it again and paste it unchanged."), invalidGraph),
        same("a valid export opens the builder on the new draft", [opened.pass, id.length > 0], [true, true]),
        same("the draft is disabled and keeps name, description and graph", [saved.name, saved.description, saved.enabled, saved.graph], ["Imported é 日本", "from the dialog", false, sentGraph]),
      ]);
    },
  },
  {
    id: "live-and-pause-hold-the-rows-and-count-the-changes",
    title: "the list says when it was updated and follows runs and changes live; Pause keeps the rows as they stand and N new · Show counts the changes since",
    entryPoint: "/modules/automation/procedures, Live / Pause",
    async run(/** @type {Ctx} */ ctx) {
      const first = await createProcedure(ctx, { name: "First", graph: chain([trigger("t"), action("f", "verify.fail", { message: "live boom" })]) });
      await auto(ctx, "enable", "PUT", `/procedures/${first}/enabled`, { body: { enabled: true } });
      const tab = await openPage(ctx, /First/);
      await rowsWhen(tab, 1);
      const before = flat(await innerOf(tab, "body"));
      await tab.page.getByRole("button", { name: "Live", exact: true }).waitFor({ state: "visible" });
      const healthyRow = (await tableRows(tab))[0];
      await runNow(ctx, first, {});
      let failingRow = (await tableRows(tab))[0];
      for (let attempt = 0; attempt < 40 && !failingRow?.startsWith("First Failing"); attempt += 1) {
        await tab.page.waitForTimeout(500);
        failingRow = (await tableRows(tab))[0];
      }
      await createProcedure(ctx, { name: "Second live", graph: manualLog("x") });
      const liveRows = await rowsWhen(tab, 2, 20_000);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await tab.page.getByRole("button", { name: "Pause", exact: true }).click();
        if (await tab.page.getByRole("button", { name: "Resume", exact: true }).waitFor({ state: "visible", timeout: 1500 }).then(() => true, () => false)) break;
      }
      await createProcedure(ctx, { name: "Third held", graph: manualLog("x") });
      await tab.shows(/1 new · Show/, { timeoutMs: 20_000 });
      const held = await tableRows(tab);
      const heldText = flat(await innerOf(tab, "body"));
      await tab.page.getByRole("button", { name: "Show", exact: true }).click();
      const shown = await rowsWhen(tab, 3, 15_000);
      await ctx.verify("live and pause", [
        check("the bar says Updated N s ago with Live and Pause", /Updated \d+ s ago Live Pause/.test(before), before.slice(0, 400)),
        check("a procedure that has not run is Healthy with No run yet", (healthyRow ?? "").startsWith("First Healthy No run yet"), healthyRow),
        check("while Live, a run moves its row to Failing with the reason, without a reload", /^First Failing .*live boom/.test(failingRow), failingRow),
        same("while Live, a new procedure appears by itself", liveRows.length, 2),
        same("Paused: the rows stay as they stand", held.length, 2),
        check("Paused shows the count of changes: Paused · 1 new, 1 new · Show", /Paused · 1 new/.test(heldText) && /1 new · Show/.test(heldText), heldText.slice(0, 600)),
        same("Show brings the new row in", shown.length, 3),
      ]);
    },
  },
  {
    id: "an-empty-list-offers-the-first-procedure",
    title: "with no procedure the page says No procedures yet and what procedures are for",
    entryPoint: "/modules/automation/procedures on a fresh installation",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await openPage(ctx);
      const text1 = await tab.shows(/No procedures yet/, { timeoutMs: 20_000 });
      const body = flat(await innerOf(tab, "body"));
      await ctx.verify("empty", [
        text1,
        check("the hint reads as documented", body.includes("Procedures run actions when something happens — a webhook, a schedule or a click."), body.slice(-300)),
        check("both buttons are there", body.includes("Import JSON") && body.includes("New procedure"), body.slice(0, 400)),
      ]);
    },
  },
];
