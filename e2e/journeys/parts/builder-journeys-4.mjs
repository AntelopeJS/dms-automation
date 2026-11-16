import { auto, check, isRow, list, pick, same, text } from "../../auto.mjs";
import { action, chain, createProcedure, dedge, runNow, runOf, stepsOf, trigger } from "../../procs.mjs";
import { canvasNodeIds, dataLines, edgeLines, eventually, openBuilder, paletteOf, procedureOf, saveState, selectNode, settle, spread } from "./builder-kit.mjs";
import { port } from "./templates-kit.mjs";
import { byText } from "./overview-page.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/** @typedef {import("../../auto.mjs").Row} Row */

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import("../../auto.mjs").Row[]} */
export const builderJourneys4 = [
  {
    id: "selected-steps-fold-into-a-group-with-ports-that-keeps-the-procedure-running",
    title: "selecting several steps and choosing Group (N) folds them into one node with its own ports inferred from the wires crossing it; Group ports edits them, Enter group opens the steps inside, and the grouped procedure runs as before",
    entryPoint: "/modules/automation/builder, Group (N), Enter group, Group ports",
    async run(/** @type {Ctx} */ ctx) {
      const graph0 = spread(chain([trigger("t"), action("a", "verify.echo", { value: "x" }), action("b", "verify.echo", {}), action("log", "log.message", { message: "m" })], [dedge("a", "value", "b", "value"), dedge("b", "value", "log", "value")]));
      const id = await createProcedure(ctx, { name: "Groupes 📦", graph: graph0 });
      await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const before = await runNow(ctx, id, {});
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await selectNode(tab, "a");
      await selectNode(tab, "b", ["Control"]);
      await ctx.verify("two steps selected", [tab.shows(/2 selected/), tab.visible({ role: "button", name: "Group (2)" })]);
      await tab.click({ role: "button", name: "Group (2)" });
      await sleep(800);
      await ctx.verify("the steps fold into one group node", [
        same("canvas nodes", (await canvasNodeIds(tab)).length, 3),
        tab.visible({ role: "button", name: "Enter group" }),
        tab.visible({ role: "button", name: "Save as template" }),
        tab.shows(/Group ports/),
        tab.visible({ role: "tab", name: "Data ports" }),
        tab.visible({ role: "tab", name: "Trigger ports" }),
        tab.shows(/No inputs\./),
        tab.visible({ role: "button", name: "Add input" }),
        tab.visible({ role: "button", name: "Add output" }),
        same("the output port inferred from the wire", await tab.value({ role: "textbox", name: "Port name" }), "value"),
      ]);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const saved = await eventually(() => procedureOf(ctx, id), (p) => list(p, "graph", "nodes").some((n) => n.kind === "group"));
      const group = list(saved, "graph", "nodes").find((n) => n.kind === "group") ?? {};
      const inner = isRow(group.subgraph) ? group.subgraph : {};
      await ctx.verify("the stored group", [
        same("top-level steps", list(saved, "graph", "nodes").map((n) => text(n, "kind")).sort(byText), ["action", "group", "trigger"]),
        same("ports inferred from the crossing wires", group.ports, [port("main", "trigger", "in"), port("main", "trigger", "out"), port("value", "data", "out", {})]),
        same("the steps inside", list(inner, "nodes").map((n) => `${String(n.id)}:${String(n.kind)}`).filter((x) => !/groupInput|groupOutput/.test(x)), ["a:action", "b:action"]),
        same("a groupInput and a groupOutput inside", list(inner, "nodes").map((n) => text(n, "kind")).filter((k) => /group/.test(k)).sort(byText), ["groupInput", "groupOutput"]),
        same("the step wire inside is kept", list(inner, "dataEdges").filter((e) => pick(e, "from", "node") === "a").length, 1),
        same("outer trigger edges lead through the group", edgeLines(saved).map((line) => line.replace(String(group.id), "G")), ["t>G.main", "G.main>log"]),
        same("the outer data edge leaves the group port", dataLines(saved).map((line) => line.replace(String(group.id), "G")), ["G.value>log.value"]),
      ]);
      const after = await runNow(ctx, id, {});
      const steps = stepsOf(await runOf(ctx, after.runId));
      const stepsBefore = stepsOf(await runOf(ctx, before.runId));
      await ctx.verify("the grouped procedure still runs and feeds Log the same value", [
        same("status", [before.status, after.status], ["ok", "ok"]),
        same("Log receives the value", steps.log?.inputs && pick(steps.log.inputs, "value"), stepsBefore.log?.inputs && pick(stepsBefore.log.inputs, "value")),
        same("the inner steps ran", Object.keys(steps).filter((k) => /__/.test(k)).map((k) => k.split("__").slice(1).join("__")), ["a", "b"]),
      ]);
      await tab.page.getByRole("button", { name: "Enter group" }).first().click();
      await sleep(900);
      await tab.snapshot("inside the group");
      await ctx.verify("Enter group shows the steps inside", [
        same("nodes on the canvas", (await canvasNodeIds(tab)).filter((n) => n === "a" || n === "b").length, 2),
        same("and the two sentinels", (await canvasNodeIds(tab)).length, 4),
        tab.visible({ role: "navigation", name: "breadcrumb" }),
      ]);
      await tab.page.keyboard.press("Escape");
      await sleep(600);
      await ctx.verify("Escape leaves the group", [same("nodes on the canvas", (await canvasNodeIds(tab)).length, 3)]);
      await selectNode(tab, String(group.id));
      await tab.fill({ role: "textbox", name: "Port name" }, "résultat");
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const renamed = await eventually(() => procedureOf(ctx, id), (p) => JSON.stringify(list(p, "graph", "nodes").find((n) => n.kind === "group")?.ports).includes("résultat"));
      await ctx.verify("Group ports renames a port and the wire follows", [
        same("the port", list(renamed, "graph", "nodes").find((n) => n.kind === "group")?.ports, [port("main", "trigger", "in"), port("main", "trigger", "out"), port("résultat", "data", "out", {})]),
      ]);
    },
  },
  {
    id: "a-group-saved-as-a-template-is-linked-read-only-and-forkable",
    title: "Save as template stores the group as a template and the group becomes a Linked instance with read-only ports, Edit template and Fork to local group; Fork makes a private copy; the palette's Templates group adds an instance",
    entryPoint: "/modules/automation/builder, Save as template, Fork to local group, Edit template",
    async run(/** @type {Ctx} */ ctx) {
      const graph0 = spread(chain([trigger("t"), action("a", "verify.echo", { value: "x" }), action("b", "verify.echo", {}), action("log", "log.message", { message: "m" })], [dedge("a", "value", "b", "value"), dedge("b", "value", "log", "value")]));
      const id = await createProcedure(ctx, { name: "Modèle", graph: graph0 });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await selectNode(tab, "a");
      await selectNode(tab, "b", ["Control"]);
      await tab.click({ role: "button", name: "Group (2)" });
      await sleep(600);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      await eventually(() => saveState(tab), (state) => state === "Saved", 6000);
      await tab.click({ role: "button", name: "Save as template" });
      const dialog = tab.page.getByRole("dialog", { name: "Save as template" });
      await dialog.waitFor();
      await ctx.verify("the Save as template dialog", [
        same("the name defaults to the group's name", await dialog.getByRole("textbox").first().inputValue(), "Group"),
        tab.shows(/Ports inferred from the wires crossing the group/),
        tab.visible({ role: "button", name: "Save template" }),
        tab.visible({ role: "button", name: "Cancel" }),
      ]);
      await dialog.getByRole("textbox").first().fill("");
      await dialog.getByRole("button", { name: "Save template" }).click();
      await ctx.verify("a name is required", [tab.shows(/Give the template a name\./)]);
      await dialog.getByRole("textbox").first().fill("Écho partagé 🚀");
      await dialog.getByRole("textbox").nth(1).fill("Fait écho 日本語");
      await dialog.getByRole("button", { name: "Save template" }).click();
      const templates = await eventually(async () => list((await auto(ctx, "list templates", "GET", "/templates")).body, "results"), (rows) => rows.length > 0);
      const tpl = templates[0] ?? {};
      const tid = text(tpl, "_id");
      await ctx.verify("the template is stored with the group's ports and steps", [
        same("name", tpl.name, "Écho partagé 🚀"),
        same("description", tpl.description, "Fait écho 日本語"),
        same("icon", tpl.icon, "i-ph-package"),
        same("ports", tpl.ports, [port("main", "trigger", "in"), port("main", "trigger", "out"), port("value", "data", "out", {})]),
        same("steps", list(tpl, "subgraph", "nodes").map((n) => `${String(n.id)}:${String(n.kind)}`).filter((x) => !/group/.test(x)), ["a:action", "b:action"]),
        tab.shows(/Écho partagé 🚀 saved/),
      ]);
      const linked = await eventually(() => procedureOf(ctx, id), (p) => list(p, "graph", "nodes").some((n) => n.templateId === tid && tid !== ""));
      const instanceNode = list(linked, "graph", "nodes").find((n) => n.templateId === tid) ?? {};
      await ctx.verify("the procedure now links to the template", [
        same("templateId", instanceNode.templateId, tid),
        same("no steps stored in the procedure", instanceNode.subgraph, undefined),
        same("usages", (await auto(ctx, "usages", "GET", `/templates/${tid}/usages`)).body, { procedures: [{ procedureId: id, nodeId: instanceNode.id, groupPath: [] }], templates: [] }),
      ]);
      await selectNode(tab, String(instanceNode.id));
      await tab.snapshot("the linked instance selected");
      await ctx.verify("the linked instance", [
        tab.shows(/linked/i),
        same("Edit template links to the template", await tab.page.getByRole("link", { name: "Edit template" }).getAttribute("href"), `/modules/automation/builder?template=${tid}`),
        tab.visible({ role: "button", name: "Fork to local group" }),
        tab.shows(/Its steps and ports come from the template: edits made there apply here\./),
        tab.shows(/These ports come from the template: change them in the template\./),
        tab.visible({ role: "button", name: "Add output" }, { hidden: true }),
        tab.visible({ role: "button", name: "Save as template" }, { hidden: true }),
      ]);
      await tab.click({ role: "button", name: "Fork to local group" });
      const fork = tab.page.getByRole("dialog", { name: "Fork to local group" });
      await fork.waitFor();
      await ctx.verify("the fork dialog", [tab.shows(/This template instance becomes a local group: later edits of the template no longer change this copy\./), tab.visible({ role: "button", name: "Cancel" })]);
      await fork.getByRole("button", { name: "Fork to local group" }).click();
      await sleep(900);
      await tab.snapshot("after the fork");
      await ctx.verify("forking makes a local group", [tab.shows(/Group is now a local group/), tab.visible({ role: "button", name: "Save as template" })]);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const forked = await eventually(() => procedureOf(ctx, id), (p) => list(p, "graph", "nodes").some((n) => n.kind === "group" && !n.templateId));
      const own = list(forked, "graph", "nodes").find((n) => n.kind === "group") ?? {};
      await ctx.verify("the saved copy is private", [
        same("no template id", own.templateId, undefined),
        same("it holds the template's steps", list(own, "subgraph", "nodes").map((n) => text(n, "id")).sort(byText), list(tpl, "subgraph", "nodes").map((n) => text(n, "id")).sort(byText)),
        same("the template is untouched and unused", (await auto(ctx, "usages after fork", "GET", `/templates/${tid}/usages`)).body, { procedures: [], templates: [] }),
        same("the template still exists", (await auto(ctx, "template after fork", "GET", `/templates/${tid}`)).status, 200),
      ]);
      await tab.goto(`/modules/automation/builder?selected=${id}`);
      await tab.visible({ role: "button", name: "Procedures" });
      await settle(tab);
      const palette = await paletteOf(tab);
      await ctx.verify("the palette lists the template last", [same("the Templates group", palette.at(-1), { group: "Templates", count: 1, sections: [{ label: "", items: ["Écho partagé 🚀"] }] })]);
      await selectNode(tab, "log");
      await tab.click({ role: "button", name: "Écho partagé 🚀" });
      await sleep(600);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const placed = await eventually(() => procedureOf(ctx, id), (p) => list(p, "graph", "nodes").some((n) => n.templateId === tid));
      const again = list(placed, "graph", "nodes").find((n) => n.templateId === tid) ?? {};
      await ctx.verify("a palette template is added as a linked instance after the selected step", [
        same("the instance links the template", again.templateId, tid),
        same("it declares the template's ports", again.ports, tpl.ports),
        same("the usages", list((await auto(ctx, "usages again", "GET", `/templates/${tid}/usages`)).body, "procedures").map((u) => u.nodeId), [again.id]),
        check("it follows Log in the trigger edges", edgeLines(placed).some((line) => /^log(\.main)?>/.test(line)), edgeLines(placed)),
      ]);
      await selectNode(tab, String(again.id));
      await tab.click({ role: "link", name: "Edit template" });
      await tab.at(/\/modules\/automation\/builder$/);
      await ctx.verify("Edit template opens the template in the builder", [
        same("the URL", new URL(tab.page.url()).searchParams.get("template"), tid),
        tab.visible({ role: "textbox", name: "Template name" }),
        tab.shows(/Template/),
        same("its name", await tab.value({ role: "textbox", name: "Template name" }), "Écho partagé 🚀"),
        tab.visible({ role: "link", name: "Library" }),
      ]);
    },
  },
];
