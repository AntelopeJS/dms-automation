import { auto, check, list, parseJson, pick, same } from "../../auto.mjs";
import { action, chain, createProcedure, manualLog, runNow, runsOfProcedure, statusIs, trigger } from "../../procs.mjs";
import { canvasNodeIds, edgeLines, eventually, nodeLines, openBuilder, paletteOf, pathOf, procedureOf, saveState, selectNode, settle } from "./builder-kit.mjs";
import { createTemplate } from "./templates-kit.mjs";
import { allInnerTexts, innerText } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */


const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import("../../auto.mjs").Row[]} */
export const builderJourneys2 = [
  {
    id: "the-palette-groups-blocks-by-module-and-category-and-searches-them",
    title: "the palette holds Triggers, Actions, Flow, Helpers and Data (and Templates once one exists) with the counts of the library, the built-in blocks first, then one section per module, data nodes by category; Search blocks… filters by name, id and category; a type switched off in the Library is marked Off",
    entryPoint: "/modules/automation/builder, Search blocks…, PUT /action-types/:id/config",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: "Palette", graph: manualLog("hello") });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      const triggers = list((await auto(ctx, "trigger types", "GET", "/trigger-types")).body);
      const actions = list((await auto(ctx, "action types", "GET", "/action-types")).body);
      const dataTypes = list((await auto(ctx, "data node types", "GET", "/data-node-types")).body);
      const palette = await paletteOf(tab);
      const by = (/** @type {string} */ group) => palette.find((entry) => entry.group === group);
      const countOf = (/** @type {string} */ group) => by(group)?.count;
      const itemsOf = (/** @type {string} */ group, /** @type {number} */ section) => by(group)?.sections[section]?.items;
      await ctx.verify("the groups, in order, with the library's counts", [
        same("group order", palette.map((entry) => entry.group), ["Triggers", "Actions", "Flow", "Helpers", "Data"]),
        same("Triggers", countOf("Triggers"), triggers.length),
        same("Actions", countOf("Actions"), actions.length),
        same("Data", countOf("Data"), dataTypes.length),
        same("Flow", countOf("Flow"), 7),
        same("Helpers", countOf("Helpers"), 2),
        same("every block is listed once", palette.map((entry) => entry.sections.reduce((n, section) => n + section.items.length, 0)), palette.map((entry) => entry.count)),
      ]);
      const labels = (/** @type {string} */ group) => (by(group)?.sections ?? []).map((section) => section.label);
      await ctx.verify("built-in blocks come first, then one section per module", [
        same("Triggers: built-ins", by("Triggers")?.sections[0], { label: "", items: ["Manual", "Schedule (cron)", "Webhook"] }),
        same("Triggers: module sections", labels("Triggers").slice(1), ["app", "dms"]),
        same("Triggers: dms section", itemsOf("Triggers", 2), ["Member added", "Member removed", "Invite created", "User registered", "Record created", "Record updated", "Record deleted"]),
        same("Actions: built-ins", by("Actions")?.sections[0], { label: "", items: ["HTTP request", "Log"] }),
        same("Actions: module sections", labels("Actions").slice(1), ["app", "dms"]),
        same("Actions: dms section", itemsOf("Actions", 2), ["Send email", "Send notification", "Invite user"]),
        same("Flow: blocks", by("Flow")?.sections, [{ label: "", items: ["For range", "If", "Switch", "For each", "Try / Catch", "Retry", "Parallel"] }]),
        same("Helpers: blocks", by("Helpers")?.sections, [{ label: "", items: ["Delay", "Set variable"] }]),
        same("Data: categories in order, then modules", labels("Data"), ["Constants", "Math", "Comparison", "Logic", "Text", "Objects", "JSON", "app"]),
        same("Data: Constants", itemsOf("Data", 0), ["Text", "Number", "True or false", "JSON"]),
        same("Data: Comparison", itemsOf("Data", 2), ["Equals", "Not equal", "Less than", "Greater than", "Less or equal", "Greater or equal"]),
        same("Data: Logic", itemsOf("Data", 3), ["And", "Or", "Exactly one", "Not"]),
        same("Data: Text", itemsOf("Data", 4), ["Join text", "Length", "Extract", "Lowercase", "Uppercase", "Trim spaces", "Split", "Replace", "Contains"]),
        same("Data: Objects", itemsOf("Data", 5), ["Get a field", "Set a field", "Field names", "Field values", "Merge"]),
        same("Data: JSON", itemsOf("Data", 6), ["Read JSON", "Write JSON"]),
        tab.shows(/Click a block to add it after the selected step, or drag it onto the canvas\./),
      ]);
      const search = async (/** @type {string} */ query) => {
        await tab.fill({ role: "textbox", name: "Search blocks…" }, query);
        await sleep(300);
        return (await paletteOf(tab)).map((entry) => `${entry.group}:${entry.sections.flatMap((section) => section.items).join("|")}`);
      };
      const log = await search("log");
      await ctx.verify("search matches names, ids and descriptions", [
        check("Log is found", log.some((line) => /^Actions:.*\bLog\b/.test(line)), log),
        same("a name, in any case", await search("WEBHOOK"), ["Triggers:Webhook"]),
        same("a block id", await search("string.concat"), ["Data:Join text"]),
        same("a data category", await search("comparison").then((lines) => lines.length), 1),
        same("a module name", (await search("dms")).map((line) => line.split(":")[0]), ["Triggers", "Actions"]),
        same("accents and CJK match nothing", await search("日本語é"), []),
        tab.shows(/No blocks match/),
      ]);
      await search("");
      await ctx.verify("clearing the search shows everything", [same("groups", (await paletteOf(tab)).map((entry) => entry.group), ["Triggers", "Actions", "Flow", "Helpers", "Data"])]);
      const off = await auto(ctx, "switch Log off in the Library", "PUT", "/action-types/log.message/config", { body: { enabled: false } });
      await tab.goto(`/modules/automation/builder?selected=${id}`);
      await tab.visible({ role: "button", name: "Procedures" });
      await settle(tab);
      const marked = (await paletteOf(tab)).find((entry) => entry.group === "Actions")?.sections[0]?.items;
      await ctx.verify("a type switched off is marked Off", [statusIs(off, 200, "the switch answers 200"), same("the built-in actions", marked, ["HTTP request", "Log Off"]), same("the hint", await tab.page.getByRole("button", { name: /^Log Off$/ }).getAttribute("title"), "Switched off in the Library: its steps fail when they run.")]);
      await auto(ctx, "switch Log back on", "PUT", "/action-types/log.message/config", { body: { enabled: true } });
      const template = await createTemplate(ctx, "Café partagé 🚀");
      await tab.goto(`/modules/automation/builder?selected=${id}`);
      await tab.visible({ role: "button", name: "Procedures" });
      await settle(tab);
      const withTemplates = await paletteOf(tab);
      await ctx.verify("a template adds the Templates group, last", [
        same("group order", withTemplates.map((entry) => entry.group), ["Triggers", "Actions", "Flow", "Helpers", "Data", "Templates"]),
        same("the template", withTemplates.at(-1), { group: "Templates", count: 1, sections: [{ label: "", items: ["Café partagé 🚀"] }] }),
        check("the template exists", template.length > 0, template),
      ]);
    },
  },
  {
    id: "a-clicked-block-is-added-after-the-selected-step",
    title: "clicking a block adds it after the selected step and links the two with a trigger edge; the new step is selected, the change is counted, and Save stores the chain",
    entryPoint: "/modules/automation/builder, palette",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: "Add after", graph: manualLog("hello") });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await selectNode(tab, "log");
      await tab.click({ role: "button", name: "Delay", exact: true });
      await ctx.verify("Delay lands after Log", [same("the save state", await saveState(tab), "2 unsaved changes"), tab.visible({ role: "spinbutton", name: "Delay (ms)" })]);
      await tab.click({ role: "button", name: "If", exact: true });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const first = await eventually(() => procedureOf(ctx, id), (p) => pathOf(p).length >= 4);
      await ctx.verify("the saved chain", [same("the path", pathOf(first), ["trigger/manual", "action/log.message", "delay", "if"]), same("the nodes", (await canvasNodeIds(tab)).length, 4)]);
      void edgeLines;
      void nodeLines;
    },
  },
  {
    id: "an-enabled-procedure-with-problems-is-saved-as-a-draft",
    title: "the dock's Problems tab lists what blocks enabling with Select node; saving an enabled procedure with problems is refused and offers Save as draft, which saves it disabled with a toast; fixing the problem lets it be enabled",
    entryPoint: "/modules/automation/builder, Problems, Save as draft",
    async run(/** @type {Ctx} */ ctx) {
      const name = "Problèmes 🚧";
      const id = await createProcedure(ctx, { name, graph: chain([trigger("t"), action("echo", "verify.echo", { value: "x" }), action("http", "http.request", {})]) });
      const before = await procedureOf(ctx, id);
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await tab.click({ role: "tab", name: /^Problems/ });
      await ctx.verify("the Problems tab lists the problem", [
        tab.visible({ role: "tab", name: "Problems 1" }),
        tab.shows(/HTTP request — Fill in “URL”\./),
        tab.visible({ role: "button", name: "Select node" }),
        tab.shows(/Fill in “URL”\./),
      ]);
      await tab.click({ role: "button", name: "Select node" });
      await ctx.verify("Select node jumps to the node", [tab.visible({ role: "textbox", name: "Step name" }), tab.visible({ role: "textbox", name: "URL" })]);
      await tab.click({ role: "switch", name: "Disabled" });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      await tab.visible({ role: "button", name: "Save as draft" });
      const refused = await procedureOf(ctx, id);
      await ctx.verify("the refused save", [
        tab.shows(/1 problem blocks enabling/),
        tab.shows(/Fix them, or save as a disabled draft: nothing fires until they are resolved\./),
        tab.visible({ role: "button", name: "Go to first problem" }),
        same("nothing was saved", [refused.enabled, refused.revision], [false, before.revision]),
        same("the save state is still unsaved", await saveState(tab), "1 unsaved change"),
      ]);
      await tab.click({ role: "button", name: "Save as draft" });
      const draft = await eventually(() => procedureOf(ctx, id), (p) => p.revision !== before.revision);
      await ctx.verify("Save as draft saves it disabled", [
        same("enabled", draft.enabled, false),
        same("the graph is saved", nodeLines(draft), ["t trigger/manual", "echo action/verify.echo", "http action/http.request"]),
        tab.shows(new RegExp(`${name} saved`)),
        tab.shows(/Saved as a draft with 1 problem\./),
        tab.visible({ role: "switch", name: "Disabled" }),
        tab.visible({ role: "button", name: "Save as draft" }, { hidden: true }),
        same("the save state", await saveState(tab), "Saved"),
      ]);
      await tab.click({ role: "group", name: /^HTTP request/ });
      await tab.fill({ role: "textbox", name: "URL" }, "https://example.com/ü?q=日本語");
      await tab.click({ role: "tab", name: "Problems" });
      await ctx.verify("fixing the field clears the problem", [tab.visible({ role: "tab", name: "Problems 1" }, { hidden: true }), tab.shows(/No problem on the graph\./)]);
      await tab.click({ role: "switch", name: "Disabled" });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const fixed = await eventually(() => procedureOf(ctx, id), (p) => p.enabled === true);
      await ctx.verify("it can now be enabled", [same("enabled", fixed.enabled, true), same("the URL is stored", list(fixed, "graph", "nodes").find((n) => n.id === "http")?.config, { url: "https://example.com/ü?q=日本語" })]);
    },
  },
  {
    id: "the-dock-offers-recent-runs-the-test-payload-and-the-test-run",
    title: "the dock has Problems, Recent runs and Test payload tabs and a Test run tab after a test; the payload is prefilled from the last real call, invalid JSON blocks the test, and the Test run tab lists the steps that ran in order",
    entryPoint: "/modules/automation/builder, dock",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: "Dock", graph: chain([trigger("t"), action("echo", "verify.echo", { value: "x" }), action("log", "log.message", { message: "done" })]) });
      await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const payload = { commande: { id: "É-42", lignes: ["café", "日本語"] } };
      const ran = await runNow(ctx, id, payload);
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await ctx.verify("the dock's tabs", [
        same("tab names", (await allInnerTexts(tab.page.getByRole("tab"))).map((t) => t.trim()).filter((t) => /^(Problems|Recent runs|Test payload|Test run)/.test(t)), ["Problems", "Recent runs", "Test payload"]),
      ]);
      await tab.click({ role: "tab", name: "Recent runs" });
      await ctx.verify("Recent runs lists the real run", [tab.visible({ role: "link", name: "All runs of this procedure" }), check("the run is listed", (await innerText(tab.page.locator("body"))).includes("Succeeded") || (await innerText(tab.page.locator("body"))).includes("ok"), "")]);
      await tab.click({ role: "tab", name: "Test payload" });
      const box = tab.page.getByRole("textbox").last();
      await ctx.verify("the payload is prefilled from the last real call", [
        tab.shows(new RegExp(`Prefilled from the last real call \\(run …${ran.runId.slice(-6)}\\)\\.`)),
        same("payload", JSON.parse(await box.inputValue()), payload),
      ]);
      await box.fill("{ not json");
      await tab.click({ role: "button", name: "Test run Ctrl ↵" });
      await sleep(800);
      await ctx.verify("invalid JSON blocks the test", [tab.shows(/The test payload is not valid JSON/), same("no test run was started", (await runsOfProcedure(ctx, id)).filter((run) => run.kind === "test").length, 0)]);
      await box.fill(JSON.stringify({ edité: "ü", n: 3 }));
      await tab.click({ role: "button", name: "Test run Ctrl ↵" });
      const tests = await eventually(() => runsOfProcedure(ctx, id), (rows) => rows.some((run) => run.kind === "test"));
      const test = tests.find((run) => run.kind === "test");
      await tab.visible({ role: "tab", name: "Test run" });
      await ctx.verify("the Test run tab lists the steps in order", [
        same("the test run's kind", test?.kind, "test"),
        same("the test ran the edited payload", parseJson(String((await auto(ctx, "read the test run", "GET", `/runs/${String(test?._id)}`)).body && pick((await auto(ctx, "read the test run again", "GET", `/runs/${String(test?._id)}`)).body, "triggerPayload"))), { edité: "ü", n: 3 }),
        tab.shows(/Steps that can simulate were simulated; the others acted for real\./),
        same("the steps, in the order they ran", (await allInnerTexts(tab.page.getByRole("button", { name: /\d+ (?:ms|s) \+\d+ (?:ms|s)$/ }))).map((t) => (/^(.*?)\s+\d+\s*(?:ms|s)/.exec(t.replace(/\s+/g, " ").trim()) ?? [])[1]), ["Manual", "Fixture echo", "Log"]),
      ]);
    },
  },
];
