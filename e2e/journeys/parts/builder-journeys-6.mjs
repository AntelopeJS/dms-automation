import { auto, check, list, same, text } from "../../auto.mjs";
import { createProcedure, manualLog } from "../../procs.mjs";
import { eventually, openBuilder, pathOf, procedureOf, selectNode } from "./builder-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * @param {import("../../auto.mjs").Row} procedure A stored procedure
 * @returns {string} The message of its Log step
 */
function messageOf(procedure) {
  const log = list(procedure, "graph", "nodes").find((node) => node.typeId === "log.message");
  return text(log, "config", "message");
}

/** @type {import("../../auto.mjs").Row[]} */
export const builderJourneys6 = [
  {
    id: "saving-over-a-change-made-elsewhere-asks-keep-editing-reload-or-overwrite",
    title: "saving a procedure that was saved elsewhere since it was opened asks in a dialog titled with its name: Keep editing leaves it unsaved, Reload saved version brings the other version in, and Overwrite with mine stores this tab's graph",
    entryPoint: "/modules/automation/builder, Save, PUT /procedures/:id",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Stale");
      const id = await createProcedure(ctx, { name, graph: manualLog("mine") });
      const tab = await openBuilder(ctx, `?selected=${id}`);
      await selectNode(tab, "log");
      await tab.click({ role: "button", name: "Delay", exact: true });
      const opened = await procedureOf(ctx, id);
      await auto(ctx, "saved elsewhere", "PUT", `/procedures/${id}`, { body: { name, description: "", enabled: false, graph: manualLog("theirs"), expectedRevision: opened.revision } });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      const asked = await tab.visible({ role: "dialog", name: `“${name}” was changed elsewhere` }, { timeoutMs: 15_000 });
      await ctx.verify("the dialog", [
        check("the dialog is titled with the procedure's name", asked.pass, asked.detail),
        await tab.shows(/Someone saved it since you opened it \(in another tab, or paused it from the list\)\. Reload it to get that version, losing your changes here, or overwrite it with yours\./),
        await tab.visible({ role: "button", name: "Keep editing" }),
        await tab.visible({ role: "button", name: "Reload saved version" }),
        await tab.visible({ role: "button", name: "Overwrite with mine" }),
        same("the other save stands, nothing of this tab was stored", pathOf(await procedureOf(ctx, id)), ["trigger/manual", "action/log.message"]),
        same("the stored message is the other one", messageOf(await procedureOf(ctx, id)), "theirs"),
      ]);
      await tab.click({ role: "button", name: "Keep editing" });
      await ctx.verify("Keep editing", [asked.pass ? await tab.visible({ role: "dialog", name: `“${name}” was changed elsewhere` }, { hidden: true }) : check("the dialog closed", false, "never opened"), same("still only the other version stored", messageOf(await procedureOf(ctx, id)), "theirs")]);
      await tab.click({ role: "button", name: "Save Ctrl S" });
      await tab.visible({ role: "button", name: "Reload saved version" });
      await tab.click({ role: "button", name: "Reload saved version" });
      const reloaded = await eventually(() => procedureOf(ctx, id), (p) => pathOf(p).length === 2);
      await ctx.verify("Reload saved version", [same("the stored graph is still the other version", [pathOf(reloaded), messageOf(reloaded)], [["trigger/manual", "action/log.message"], "theirs"]), await tab.shows(/1 unsaved change/, { not: true, timeoutMs: 4000 })]);
      await selectNode(tab, "log");
      await tab.click({ role: "button", name: "Delay", exact: true });
      const again = await procedureOf(ctx, id);
      await auto(ctx, "saved elsewhere again", "PUT", `/procedures/${id}`, { body: { name, description: "", enabled: false, graph: manualLog("theirs again"), expectedRevision: again.revision } });
      await tab.click({ role: "button", name: "Save Ctrl S" });
      await tab.visible({ role: "button", name: "Overwrite with mine" });
      await tab.click({ role: "button", name: "Overwrite with mine" });
      const mine = await eventually(() => procedureOf(ctx, id), (p) => pathOf(p).length >= 3);
      await ctx.verify("Overwrite with mine", [same("this tab's graph, the reloaded one plus a Delay, is stored over the later save", [pathOf(mine), messageOf(mine)], [["trigger/manual", "action/log.message", "delay"], "theirs"])]);
    },
  },
];
