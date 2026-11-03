import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { action, chain, clearLedger, createProcedure, ledger, manualLog, runNow, runsOfProcedure, statusIs, trigger } from "../../procs.mjs";
import { ofKind, payloadOf, runDetail, saveGraph } from "./triggers-common.mjs";
import { steps, test } from "./test-runs-kit.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const builderJourneys = [
  {
    id: "a-test-run-can-be-run-again-and-is-stored-as-a-test",
    title: "re-running a test runs again the draft that test ran, not the saved graph, from the same trigger with the same payload, stored as a test; its confirmation names the steps that act for real",
    entryPoint: "GET /runs/:id/rerun-confirm, POST /runs/:id/rerun",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, { name: ctx.unique("Retest"), graph: manualLog("saved") });
      const draft = steps([["pay", "verify.effect-nodry", { label: "retest" }, "Pay"], ["note", "log.message", { message: "the draft" }]]);
      const first = await test(ctx, id, draft, { payload: { attempt: 1 }, confirmRealEffects: true });
      const firstId = text(first.body, "runId");
      const confirm = await auto(ctx, "re-run confirmation", "GET", `/runs/${firstId}/rerun-confirm`);
      await saveGraph(ctx, id, manualLog("edited since"), { name: text((await auto(ctx, "name", "GET", `/procedures/${id}`)).body, "name") });
      await clearLedger(ctx);
      const again = await auto(ctx, "re-run the test", "POST", `/runs/${firstId}/rerun`);
      const secondId = text(again.body, "runId");
      const second = await runDetail(ctx, secondId);
      const afterwards = await ledger(ctx);
      const logs = list((await auto(ctx, "logs", "GET", `/runs/${secondId}/logs`)).body, "entries").map((entry) => text(entry, "message"));
      await ctx.verify("the re-run of a test", [
        statusIs(confirm, 200, "the confirmation answers 200"),
        same("it is worded as a test re-run", [pick(confirm.body, "title"), pick(confirm.body, "confirmLabel")], ["$dms_automation.runs.retestConfirmTitle", "$dms_automation.runs.retest"]),
        same("it names the step that acts for real", JSON.stringify(pick(confirm.body, "impact")).includes("Fixture verify.effect-nodry"), true),
        statusIs(again, 200, "the re-run answers 200"),
        check("it is a new run", secondId !== "" && secondId !== firstId, secondId),
        same("it is stored as a test", second.kind, "test"),
        same("it ran the draft, not the edited graph", [logs.includes("the draft"), logs.includes("edited since")], [true, false]),
        same("with the same payload and trigger", [payloadOf(second), second.triggerNodeId], [{ attempt: 1 }, "t"]),
        same("the step that acts for real ran with ctx.dryRun true", ofKind(afterwards.entries, "execute").map((entry) => [entry.label, entry.ctxDryRun]), [["retest", true]]),
      ]);
    },
  },
  {
    id: "the-builder-asks-before-it-tests-for-real-and-prefills-the-test-payload",
    title: "in the Builder, Test run lists the steps that act for real in Test with real effects? and starts only after Test for real (Cancel runs nothing); a draft with nothing acting for real tests at once; the Test run tab lists the steps that ran; the Test payload is prefilled from the last real call",
    entryPoint: "/modules/automation/builder, POST /procedures/:id/test",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Builder test");
      const graph1 = chain([trigger("t", "manual"), { ...action("pay", "verify.effect-nodry", { label: "from the builder" }), label: "Charge" }, action("log", "log.message", { message: "done" })]);
      const id = await createProcedure(ctx, { name, graph: graph1 });
      const real = await runNow(ctx, id, { a: 1, name: "Zoë" });
      await clearLedger(ctx);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(`/modules/automation/builder?selected=${id}`);
      await tab.visible({ role: "button", name: "Test run" }, { timeoutMs: 40_000 });
      let dialog = await tab.visible({ role: "dialog", name: "Test with real effects?" }, { timeoutMs: 1000 });
      for (let attempt = 0; attempt < 8 && !dialog.pass; attempt += 1) {
        if ((await tab.page.getByRole("dialog").count()) > 0) break;
        await tab.click({ role: "button", name: "Test run" });
        dialog = await tab.visible({ role: "dialog", name: "Test with real effects?" }, { timeoutMs: 3000 });
      }
      await ctx.verify("Test run asks first", [
        check("the dialog is titled Test with real effects?", dialog.pass, dialog.detail),
        await tab.shows(/This test acts for real: 1 step below changes something outside the run \(sends, writes, calls a service\) and can’t be simulated\. Steps that can simulate are simulated\./),
        await tab.shows(/Fixture verify\.effect-nodry\s+Charge/),
        await tab.visible({ role: "button", name: "Cancel" }),
        await tab.visible({ role: "button", name: "Test for real" }),
      ]);
      await tab.click({ role: "button", name: "Cancel" });
      const closed = await tab.visible({ role: "dialog", name: "Test with real effects?" }, { hidden: true });
      const afterCancel = await ledger(ctx);
      await ctx.verify("Cancel runs nothing", [closed, same("no step ran", afterCancel.entries, []), same("only the Run now run exists", (await runsOfProcedure(ctx, id)).length, 1)]);

      await tab.click({ role: "button", name: "Test run" });
      await tab.click({ role: "button", name: "Test for real" });
      const dockTab = await tab.visible({ role: "tab", name: "Test run" }, { timeoutMs: 20_000 });
      const forReal = await ledger(ctx);
      const runs = await runsOfProcedure(ctx, id);
      await ctx.verify("Test for real runs the draft and lists its steps", [
        dockTab,
        await tab.shows(/Steps that can simulate were simulated; the others acted for real\./),
        await tab.visible({ role: "button", name: "Charge" }),
        await tab.visible({ role: "button", name: "Log" }),
        same("the step executed with ctx.dryRun true", ofKind(forReal.entries, "execute").map((entry) => [entry.label, entry.ctxDryRun]), [["from the builder", true]]),
        same("the runs, newest first", runs.map((run) => run.kind), ["test", "run"]),
      ]);

      await tab.click({ role: "tab", name: "Test payload" });
      await ctx.verify("the Test payload is prefilled from the last real call", [
        await tab.shows(new RegExp(`Prefilled from the last real call \\(run …${real.runId.slice(-6)}\\)\\.`)),
        same("the payload field holds the payload", (await tab.value({ role: "textbox", nth: 2 })).replace(/\s+/g, " ").trim(), '{ "a": 1, "name": "Zoë" }'),
      ]);

      const safeId = await createProcedure(ctx, { name: ctx.unique("Builder safe test"), graph: chain([trigger("t", "manual"), action("log", "log.message", { message: "safe" })]) });
      await tab.goto(`/modules/automation/builder?selected=${safeId}`);
      await tab.visible({ role: "button", name: "Test run" }, { timeoutMs: 40_000 });
      let ran = await tab.visible({ role: "tab", name: "Test run" }, { timeoutMs: 1000 });
      for (let attempt = 0; attempt < 8 && !ran.pass; attempt += 1) {
        await tab.click({ role: "button", name: "Test run" });
        ran = await tab.visible({ role: "tab", name: "Test run" }, { timeoutMs: 3000 });
      }
      await ctx.verify("a draft with nothing acting for real tests at once", [ran, await tab.shows(/Test with real effects\?/, { not: true, timeoutMs: 1500 }), same("one test run", (await runsOfProcedure(ctx, safeId)).map((run) => run.kind), ["test"])]);
    },
  },
];
