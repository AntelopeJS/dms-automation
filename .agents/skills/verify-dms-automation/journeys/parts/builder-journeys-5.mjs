import { auto, check, list, same } from "../../auto.mjs";
import { action, chain, createProcedure, trigger } from "../../procs.mjs";
import { canvasNodeIds, connect, dataLines, edgeLines, eventually, openBuilder, procedureOf, saveState, selectNode, spread } from "./builder-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */


const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import("../../auto.mjs").Row[]} */
export const builderJourneys5 = [
  {
    id: "the-inspector-names-the-step-and-shows-its-settings-docs-and-last-run",
    title: "the inspector shows the selected step's Step name, Settings generated from its schema and Docs; a typed name labels the node and is saved; a schedule trigger shows its next run; after a test a Last run tab shows what the step did, titled This run failed when it failed",
    entryPoint: "/modules/automation/builder, inspector",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: "Inspecteur", graph: spread(chain([trigger("t", "schedule.cron", { cron: "0 9 * * 1" }), action("log", "log.message", { message: "hello" }), action("fail", "verify.fail", { message: "Boom ☕" })])) });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await selectNode(tab, "log");
      await ctx.verify("a selected step shows Settings from its schema", [
        same("the Step name placeholder is the type's name", await tab.page.getByRole("textbox", { name: "Step name" }).getAttribute("placeholder"), "Log"),
        tab.visible({ role: "tab", name: "Settings" }),
        tab.visible({ role: "tab", name: "Docs" }),
        tab.visible({ role: "tab", name: "Last run" }, { hidden: true }),
        same("Message", await tab.value({ role: "textbox", name: "Message" }), "hello"),
        same("Level", await tab.page.getByRole("combobox", { name: "Level" }).innerText(), "info"),
        tab.visible({ role: "textbox", name: "String, number, true/false, null or JSON" }),
        tab.shows(/If it fails/),
        tab.shows(/The run stops here and downstream steps are skipped\./),
      ]);
      await tab.click({ role: "tab", name: "Docs" });
      await ctx.verify("Docs shows the block's description", [tab.shows(/Writes a message \(and an optional value\) to the run log/)]);
      await tab.click({ role: "tab", name: "Settings" });
      await tab.fill({ role: "textbox", name: "Step name" }, "Étape de journal ☕ 日本語");
      await tab.page.getByRole("textbox", { name: "Step name" }).press("Tab");
      await ctx.verify("a typed name labels the node on the canvas", [
        same("the node's title", await tab.page.locator('.vue-flow__node[data-id="log"] .text-highlighted').first().innerText(), "Étape de journal ☕ 日本語"),
        same("the save state", await saveState(tab), "1 unsaved change"),
      ]);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const saved = await eventually(() => procedureOf(ctx, id), (p) => list(p, "graph", "nodes").find((n) => n.id === "log")?.label !== undefined);
      await ctx.verify("the name is saved as the node's label", [same("label", list(saved, "graph", "nodes").find((n) => n.id === "log")?.label, "Étape de journal ☕ 日本語")]);
      await selectNode(tab, "t");
      await ctx.verify("a schedule trigger shows its next run", [tab.shows(/Next run: .+ \(.+\)/), same("its setting", await tab.value({ role: "textbox", name: "Schedule (cron)" }), "0 9 * * 1")]);
      await selectNode(tab, "fail");
      await tab.click({ role: "button", name: "Test run Ctrl ↵" });
      await tab.click({ role: "button", name: "Test for real" });
      await tab.visible({ role: "tab", name: "Test run" });
      await selectNode(tab, "fail");
      await ctx.verify("after a test the failed step's tab is titled This run failed and names the error", [
        tab.shows(/Failed at Fixture failure/),
        tab.visible({ role: "tab", name: "This run failed", selected: true }),
        tab.visible({ role: "tab", name: "Last run" }, { hidden: true }),
        tab.shows(/Failed\s+\d+ ms/),
        tab.shows(/Test run · /),
        tab.shows(/Boom ☕/),
        check("Open trace links to the test run", ((await tab.page.getByRole("link", { name: "Open trace" }).first().getAttribute("href")) ?? "").startsWith("/modules/automation/trace?run="), ""),
      ]);
      await selectNode(tab, "log");
      await tab.click({ role: "tab", name: "Last run" });
      await ctx.verify("a step that worked shows what it did", [tab.visible({ role: "tab", name: "Last run", selected: true }), tab.visible({ role: "tab", name: "This run failed" }, { hidden: true }), tab.shows(/Succeeded|OK|\d+ ms/i), tab.shows(/hello/)]);
    },
  },
  {
    id: "a-draft-says-nothing-fires-until-it-is-enabled-and-offers-to-enable-it",
    title: "an open draft shows a banner: {name} is a draft, what starts it, that nothing fires until it is enabled, and an Enable button that enables and saves it; a missing procedure link and a first-time builder explain themselves",
    entryPoint: "/modules/automation/builder, banner",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await openBuilder(ctx, "", { tab });
      await ctx.verify("with no procedure the builder says so", [tab.shows(/No procedure yet/), tab.shows(/Create a procedure to start building\./)]);
      await openBuilder(ctx, "?selected=00000000-0000-4000-8000-000000000000", { tab });
      await ctx.verify("a link to a deleted procedure explains itself", [
        tab.shows(/This procedure no longer exists/),
        tab.shows(/The link points to a procedure that was deleted\. Pick another one, or create one\./),
        tab.shows(/Choose a procedure/),
      ]);
      const cron = await createProcedure(ctx, { name: "Hebdo 📅", graph: chain([trigger("t", "schedule.cron", { cron: "0 9 * * 1" }), action("log", "log.message", { message: "x" })]) });
      await openBuilder(ctx, `?selected=${cron}`, { tab });
      await ctx.verify("a scheduled draft says when it would fire", [
        tab.shows(/Hebdo 📅 is a draft/),
        tab.shows(/Schedule: Mondays at 09:00 \(.+\)\. Nothing fires until you enable it \(otherwise next at .+\)\. Test run tries it without counting as a run\./),
        tab.visible({ role: "button", name: "Enable" }),
      ]);
      await tab.click({ role: "button", name: "Enable" });
      const enabled = await eventually(() => procedureOf(ctx, cron), (p) => p.enabled === true);
      await ctx.verify("Enable enables and saves it", [same("enabled", enabled.enabled, true), tab.visible({ role: "button", name: "Enable" }, { hidden: true }), tab.visible({ role: "switch", name: "Enabled" })]);
      const manual = await createProcedure(ctx, { name: "À la demande", graph: chain([trigger("t", "webhook", { path: "/webhooks/reveil", method: "POST" }), action("log", "log.message", { message: "x" })]) });
      await openBuilder(ctx, `?selected=${manual}`, { tab });
      await ctx.verify("a webhook draft says it won't fire", [tab.shows(/À la demande is a draft/), tab.shows(/won’t fire until you enable it\. Test run tries it without counting as a run\./)]);
      await auto(ctx, "enable it", "PUT", `/procedures/${manual}/enabled`, { body: { enabled: true } });
      await auto(ctx, "pause it", "PUT", `/procedures/${manual}/enabled`, { body: { enabled: false } });
      await openBuilder(ctx, `?selected=${manual}`, { tab });
      await ctx.verify("a paused procedure says it is paused", [tab.shows(/À la demande is paused/), tab.visible({ role: "button", name: "Enable" })]);
    },
  },
  {
    id: "wires-are-drawn-between-matching-ports-replaced-and-unwired",
    title: "a trigger port (blue) links only to a trigger port and a data port (green) only to a data port; drawing over a link replaces it and says so; a loop or a step linked to itself is refused; the inspector shows From <step · port> with Unwire, which removes the link",
    entryPoint: "/modules/automation/builder, canvas ports, Unwire",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, {
        name: "Fils",
        graph: spread(
          chain([trigger("t"), action("a", "verify.echo", { value: "x" }), action("b", "verify.echo", {})]),
        ),
      });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await tab.click({ role: "button", name: "Text", exact: true });
      const ids = await canvasNodeIds(tab);
      const constId = ids.find((n) => !["t", "a", "b"].includes(n)) ?? "";
      await tab.click({ role: "button", name: "Fit view" });
      const colours = await tab.page.evaluate(() => {
        const probe = (variable) => {
          const el = document.createElement("div");
          el.style.background = `var(${variable})`;
          document.body.appendChild(el);
          const colour = getComputedStyle(el).backgroundColor;
          el.remove();
          return colour;
        };
        const handle = (node, id) => {
          const el = document.querySelector(`.vue-flow__handle[data-nodeid="${node}"][data-handleid="${id}"]`);
          return el ? { colour: getComputedStyle(el).backgroundColor, width: getComputedStyle(el).width } : null;
        };
        return { info: probe("--ui-info"), success: probe("--ui-success"), triggerOut: handle("t", "trigger-out-main"), triggerIn: handle("a", "trigger-in"), dataOut: handle("a", "data-out-value"), dataIn: handle("b", "data-in-value") };
      });
      await ctx.verify("trigger ports are blue and data ports green", [
        same("a trigger output", colours.triggerOut?.colour, colours.info),
        same("a trigger input", colours.triggerIn?.colour, colours.info),
        same("a data output", colours.dataOut?.colour, colours.success),
        same("a data input", colours.dataIn?.colour, colours.success),
        check("the two colours differ", colours.info !== colours.success, colours),
      ]);
      await connect(tab, ["t", "trigger-out-main"], ["b", "data-in-value"]);
      await connect(tab, ["a", "data-out-value"], ["b", "trigger-in"]);
      await ctx.verify("a trigger port does not link to a data port", [
        same("nothing changed", await saveState(tab), "1 unsaved change"),
      ]);
      await tab.snapshot("after the mismatched drags");
      await connect(tab, ["a", "data-out-value"], ["b", "data-in-value"]);
      await selectNode(tab, "b");
      await ctx.verify("a data link shows From <step · port> with Unwire", [
        tab.shows(/From Fixture echo · value/),
        tab.visible({ role: "button", name: "Unwire" }),
        same("the save state", await saveState(tab), "2 unsaved changes"),
      ]);
      await connect(tab, [constId, "data-out-value"], ["b", "data-in-value"]);
      await ctx.verify("drawing over a link replaces it and says so", [tab.shows(/Link replaced/), tab.shows(/value of Fixture echo #b now reads Text · value instead of Fixture echo #a · value\./)]);
      await tab.click({ role: "button", name: "Unwire" });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const saved = await eventually(() => procedureOf(ctx, id), (p) => p.revision !== undefined && list(p, "graph", "nodes").length === 4);
      await ctx.verify("Unwire removes the link; the rest is saved", [
        same("data edges", dataLines(saved), []),
        same("trigger edges", edgeLines(saved), ["t>a", "a>b"]),
        tab.visible({ role: "button", name: "Unwire" }, { hidden: true }),
      ]);
      await connect(tab, ["b", "trigger-out-main"], ["a", "trigger-in"]);
      await sleep(400);
      await ctx.verify("a link that would make a loop is refused", [same("nothing changed", await saveState(tab), "Saved")]);
      await connect(tab, ["t", "trigger-out-main"], ["b", "trigger-in"]);
      await tab.shows(/Link replaced/);
      await ctx.verify("a trigger port has one outgoing link: a new one replaces the old", [tab.shows(/Manual now leads to Fixture echo #b instead of Fixture echo #a\./)]);
    },
  },
  {
    id: "wrap-in-retry-puts-a-step-inside-a-retry",
    title: "Wrap in Retry in the inspector puts the selected step inside a Retry in one click, keeping the step wired before and after",
    entryPoint: "/modules/automation/builder, Wrap in Retry",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: "Réessai", graph: spread(chain([trigger("t"), action("a", "verify.flaky", {}), action("log", "log.message", { message: "after" })])) });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await selectNode(tab, "a");
      await tab.click({ role: "button", name: "Wrap in Retry" });
      await sleep(600);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const saved = await eventually(() => procedureOf(ctx, id), (p) => list(p, "graph", "nodes").some((n) => n.kind === "retry"));
      await ctx.verify("the step now sits inside a Retry", [
        same("the kinds", list(saved, "graph", "nodes").map((n) => String(n.kind)).sort(), ["action", "action", "retry", "trigger"]),
        same("trigger edges", edgeLines(saved).map((line) => line.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "R")), ["t>R", "R.main>log", "R.body>a"]),
      ]);
    },
  },
];
