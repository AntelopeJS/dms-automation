import { auto, list, pick, same, text } from "../../auto.mjs";
import { createProcedure, logsOf, runNow } from "../../procs.mjs";
import { eventually, saveState, selectNode, settle } from "./builder-kit.mjs";
import { createTemplate, instance, runGroup } from "./templates-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * The level and message the Log step inside a placed Greeter logged in a run.
 *
 * @param {Ctx} ctx The journey
 * @param {string} runId The run
 * @returns {Promise<string[][]>} One `[level, message]` per entry of the step
 */
async function greeterLog(ctx, runId) {
  return (await logsOf(ctx, runId)).filter((entry) => entry.nodeId === "g1__log" && entry.source !== "exec").map((entry) => [String(entry.level), String(entry.message)]);
}

/** @type {import("../../auto.mjs").Row[]} */
export const templatesJourneys5 = [
  {
    id: "edit-graph-opens-the-template-in-the-builder-and-its-save-changes-every-procedure-placing-it",
    title: "Edit graph in the Library opens the template in the builder under its name; a step setting changed there and saved is stored on the template, and every procedure placing it runs the changed step",
    entryPoint: "/modules/automation/library?tab=templates, Edit graph, /modules/automation/builder?template=<id>, Save",
    async run(/** @type {Ctx} */ ctx) {
      const templateId = await createTemplate(ctx, "Partagé ☕");
      const procedures = [await createProcedure(ctx, { name: "Place un", graph: runGroup(instance("g1", templateId), "un") }), await createProcedure(ctx, { name: "Place deux", graph: runGroup(instance("g1", templateId), "deux") })];
      for (const id of procedures) await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const before = [];
      for (const id of procedures) before.push(await greeterLog(ctx, (await runNow(ctx, id, {})).runId));
      await ctx.verify("before the edit", [same("each procedure logs its text at info", before, [[["info", "un"]], [["info", "deux"]]])]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(`/modules/automation/library?tab=templates&template=${templateId}`);
      await tab.visible({ role: "heading", name: "Partagé ☕", level: 2 });
      await tab.click({ role: "button", name: "Edit graph" });
      await tab.at(/\/modules\/automation\/builder$/);
      await tab.visible({ role: "textbox", name: "Template name" });
      await settle(tab);
      await ctx.verify("the template in the builder", [
        same("the URL names the template", new URL(tab.page.url()).searchParams.get("template"), templateId),
        same("the bar holds its name", await tab.value({ role: "textbox", name: "Template name" }), "Partagé ☕"),
        tab.visible({ role: "link", name: "Library" }),
      ]);
      await selectNode(tab, "log");
      await tab.click({ role: "combobox", name: "Level" });
      const options = tab.page.getByRole("option");
      await options.first().waitFor({ timeout: 10_000 });
      await ctx.verify("the Level options", [same("the Level options read info, warn and error", (await options.allInnerTexts()).map((option) => option.trim()), ["info", "warn", "error"])]);
      await options.nth(2).click({ timeout: 10_000 });
      await ctx.verify("the Level is picked", [same("Level", (await tab.page.getByRole("combobox", { name: "Level" }).innerText()).trim(), "error")]);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const stored = await eventually(async () => (await auto(ctx, "read the template", "GET", `/templates/${templateId}`)).body, (body) => pick(list(body, "subgraph", "nodes").find((node) => node.id === "log"), "config", "level") === "error");
      await ctx.verify("Save stores the template", [
        same("the Log step inside is at error", pick(list(stored, "subgraph", "nodes").find((node) => node.id === "log"), "config", "level"), "error"),
        same("its name and ports are kept", [text(stored, "name"), list(stored, "ports").length], ["Partagé ☕", 4]),
        same("the save state", await eventually(() => saveState(tab), (state) => state === "Saved"), "Saved"),
      ]);
      const after = [];
      for (const id of procedures) after.push(await greeterLog(ctx, (await runNow(ctx, id, {})).runId));
      await ctx.verify("every procedure placing it runs the edit", [same("each procedure logs its text at error", after, [[["error", "un"]], [["error", "deux"]]])]);
    },
  },
];
