import { auto, check, parseJson, pick, same } from "../../auto.mjs";
import { action, clearLedger, dedge, graph, ledger, runNow, tedge, trigger, until } from "../../procs.mjs";
import { openPage, saveGraph, textWhen, runTable } from "./runs-common.mjs";
import { effectProcedure, executed, flat } from "./trace-rerun.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const headerRerunJourneys = [
  {
    id: "re-run-with-this-payload-in-the-trace-runs-the-saved-procedure-and-opens-the-new-run",
    title: "Re-run with this payload beside the trace's header asks Re-run with the same payload?, runs nothing on Cancel, and on Re-run runs the current saved procedure once with the payload of the run, then opens the new run's trace bannered as a re-run",
    entryPoint: "/modules/automation/trace?run=, Re-run with this payload",
    async run(/** @type {Ctx} */ ctx) {
      const name = "Rejouer ☕";
      const id = await effectProcedure(ctx, name);
      const original = await runNow(ctx, id, { who: "Zoë 日本" });
      const saved = (await auto(ctx, "read the procedure", "GET", `/procedures/${id}`)).body;
      await saveGraph(ctx, "add a second effect step", id, saved, graph([trigger("t"), action("eff1", "verify.effect"), action("eff2", "verify.effect", { label: "second" })], [tedge("t", "eff1"), tedge("eff1", "eff2")], [dedge("t", "who", "eff1", "label")]));
      const { tab } = await openPage(ctx, `/modules/automation/trace?run=${original.runId}`, /Re-run with this payload/);
      await tab.page.getByRole("button", { name: "Re-run with this payload" }).click();
      const asked = flat(await textWhen(tab, /Re-run with the same payload\?/, 20_000));
      await ctx.verify("the confirmation", [check("Re-run with the same payload? warns that side effects are real", /Re-run with the same payload\? Runs the saved version of the procedure again, from the same trigger, with the payload this run received\. Side effects are real\./.test(asked), asked.slice(-700))]);
      await tab.page.getByRole("button", { name: "Cancel" }).click();
      await tab.page.waitForTimeout(800);
      await ctx.verify("Cancel runs nothing", [same("one run", (await runTable(ctx)).total, 1)]);
      await clearLedger(ctx);
      await tab.page.getByRole("button", { name: "Re-run with this payload" }).click();
      await textWhen(tab, /Re-run with the same payload\?/, 20_000);
      await tab.page.getByRole("button", { name: "Re-run", exact: true }).last().click();
      await tab.at(/\/trace$/, { timeoutMs: 30_000 });
      const newId = await until(async () => new URL(tab.page.url()).searchParams.get("run") ?? "", (run) => run !== original.runId, 20_000);
      const shown = flat(await textWhen(tab, /This run is a re-run/, 20_000));
      const stored = (await auto(ctx, "the new run", "GET", `/runs/${newId}`)).body;
      await ctx.verify("Re-run in the trace", [
        check("opens the trace of the new run", newId !== "" && newId !== original.runId, tab.page.url()),
        same("the new run is a re-run of this one with its payload", [pick(stored, "kind"), pick(stored, "rerunOf"), parseJson(String(pick(stored, "triggerPayload")))], ["rerun", original.runId, { who: "Zoë 日本" }]),
        same("the current saved graph ran, both effect steps, once", executed((await ledger(ctx)).entries), [["verify.effect", "Zoë 日本"], ["verify.effect", "second"]]),
        same("two runs in all", (await runTable(ctx)).total, 2),
        check("the new trace is bannered as a re-run", /This run is a re-run Open the original run/.test(shown), shown.slice(0, 700)),
      ]);
    },
  },
];
