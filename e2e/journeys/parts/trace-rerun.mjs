import { auto, check, list, parseJson, pick, same, text } from "../../auto.mjs";
import { action, chain, clearLedger, createEnabled, dedge, graph, ledger, runNow, tedge, trigger } from "../../procs.mjs";
import { openPage, saveGraph, storedRun, textWhen, withRuns, runTable } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

const flat = (/** @type {string} */ value) => value.replace(/\s+/g, " ").trim();

/**
 * A procedure whose effect step logs the `who` of its payload in the fixture's ledger.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The name
 * @returns {Promise<string>} Its id
 */
async function effectProcedure(ctx, name) {
  const { id } = await createEnabled(ctx, { name, graph: graph([trigger("t"), action("eff1", "verify.effect")], [tedge("t", "eff1")], [dedge("t", "who", "eff1", "label")]) });
  return id;
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} runId The run
 * @returns {Promise<unknown>} The answer of the re-run confirmation
 */
async function confirmOf(ctx, runId) {
  return (await auto(ctx, "rerun confirmation", "GET", `/runs/${runId}/rerun-confirm`)).body;
}

const executed = (/** @type {Record<string, unknown>[]} */ entries) => entries.filter((e) => e.kind === "execute").map((e) => [e.type, e.label]);

export const rerunJourneys = [
  {
    id: "a-re-run-runs-the-current-saved-graph-with-the-stored-payload",
    title: "Re-run runs the procedure's current saved graph, not a historical copy, from the same trigger with the original payload, and is stored as a Re-run of that run; a second re-run of the same run within moments is refused",
    entryPoint: "POST /runs/:id/rerun",
    async run(/** @type {Ctx} */ ctx) {
      const id = await effectProcedure(ctx, ctx.unique("Rerun graph"));
      const original = await runNow(ctx, id, { who: "Zoë ☕ 日本" });
      const saved = (await auto(ctx, "read", "GET", `/procedures/${id}`)).body;
      const next = graph([trigger("t"), action("eff1", "verify.effect"), action("eff2", "verify.effect", { label: "second step" })], [tedge("t", "eff1"), tedge("eff1", "eff2")], [dedge("t", "who", "eff1", "label")]);
      const put = await saveGraph(ctx, "save version 2", id, saved, next);
      await clearLedger(ctx);
      const rerun = await auto(ctx, "re-run", "POST", `/runs/${original.runId}/rerun`);
      const again = await auto(ctx, "re-run again at once", "POST", `/runs/${original.runId}/rerun`);
      const entries = (await ledger(ctx)).entries;
      const newId = text(rerun.body, "runId");
      const fresh = (await auto(ctx, "the re-run", "GET", `/runs/${newId}`)).body;
      const old = (await auto(ctx, "the original", "GET", `/runs/${original.runId}`)).body;
      await ctx.verify("the re-run", [
        same("the save made version 2", pick(put.body, "version"), 2),
        same("answer", [rerun.status, pick(rerun.body, "status")], [200, "ok"]),
        same("the current graph ran: both effect steps, the first with the original payload", executed(entries), [["verify.effect", "Zoë ☕ 日本"], ["verify.effect", "second step"]]),
        same("stored as a re-run of the original, version 2, same trigger and payload", [pick(fresh, "kind"), pick(fresh, "rerunOf"), pick(fresh, "procedureVersion"), pick(fresh, "triggerNodeId"), pick(fresh, "triggerPayload")], ["rerun", original.runId, 2, "t", JSON.stringify({ who: "Zoë ☕ 日本" })]),
        same("the original is untouched: one effect step, version 1", [pick(old, "kind"), pick(old, "procedureVersion"), list(old, "trace", "steps").map((step) => step.nodeId)], ["run", 1, ["t", "eff1"]]),
        same("a second re-run at once is refused", [again.status, pick(again.body, "error"), pick(again.body, "message")], [409, "this run is being re-run already", "$dms_automation.runs.rerunBusy"]),
        same("and ran nothing", executed((await ledger(ctx)).entries).length, 2),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 5500));
      const third = await auto(ctx, "re-run after the wait", "POST", `/runs/${original.runId}/rerun`);
      await ctx.verify("after about 5 seconds", [same("it runs again", [third.status, pick(third.body, "status")], [200, "ok"])]);
    },
  },
  {
    id: "a-re-run-of-a-paused-procedure-runs-once-and-a-failed-one-warns",
    title: "a paused procedure still runs once on Re-run and stays paused, the confirmation says so, and a re-run that fails answers with a warning",
    entryPoint: "GET /runs/:id/rerun-confirm, POST /runs/:id/rerun",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Paused ☕");
      const id = await effectProcedure(ctx, name);
      const original = await runNow(ctx, id, { who: "first" });
      const pause = await auto(ctx, "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled: false } });
      const confirm = await confirmOf(ctx, original.runId);
      await clearLedger(ctx);
      const rerun = await auto(ctx, "re-run the paused procedure", "POST", `/runs/${original.runId}/rerun`);
      const after = (await auto(ctx, "read", "GET", `/procedures/${id}`)).body;
      await ctx.verify("paused", [
        same("paused", pause.status, 200),
        same("the confirmation", [pick(confirm, "title"), pick(confirm, "description"), pick(confirm, "params"), pick(confirm, "confirmLabel"), pick(confirm, "color"), pick(confirm, "blocked")], ["$dms_automation.runs.rerunConfirmTitle", "$dms_automation.runs.rerunConfirmDescription", { name, headers: "" }, "$dms_automation.runs.rerun", "warning", undefined]),
        same("it lists the pause", pick(confirm, "impact"), [{ icon: "i-ph-pause-circle", label: "$dms_automation.runs.rerunPaused" }]),
        same("the re-run ran the procedure once", executed((await ledger(ctx)).entries), [["verify.effect", "first"]]),
        same("and the procedure is still paused", pick(after, "enabled"), false),
        same("the run is a re-run", pick((await auto(ctx, "run", "GET", `/runs/${text(rerun.body, "runId")}`)).body, "kind"), "rerun"),
      ]);
      const failing = await createEnabled(ctx, { name: ctx.unique("Fails"), graph: chain([trigger("t"), action("boom", "verify.fail", { message: "still broken" })]) });
      const bad = await runNow(ctx, failing.id, {});
      const failedRerun = await auto(ctx, "re-run a failing run", "POST", `/runs/${bad.runId}/rerun`);
      await ctx.verify("a failing re-run", [same("answers the new run, failed, with a warning", [failedRerun.status, pick(failedRerun.body, "status"), pick(failedRerun.body, "warning"), text(failedRerun.body, "runId") !== bad.runId], [200, "failed", "$dms_automation.runs.rerunFailed", true])]);
    },
  },
  {
    id: "a-re-run-is-refused-for-a-deleted-procedure-a-missing-trigger-a-large-payload-and-a-lost-draft",
    title: "Re-run is refused (404 when the procedure was deleted, 409 otherwise) when the procedure was deleted, the trigger that started the run is no longer in it, the payload was too large to keep, or the run is a test whose draft was not kept; the confirmation says it cannot be re-run, in words",
    entryPoint: "GET /runs/:id/rerun-confirm, POST /runs/:id/rerun, /modules/automation/runs",
    async run(/** @type {Ctx} */ ctx) {
      const cases = [];
      const make = async (/** @type {string} */ label) => {
        const id = await effectProcedure(ctx, ctx.unique(label));
        return { id, name: label };
      };
      const gone = await make("Deleted");
      const goneRun = await runNow(ctx, gone.id, { who: "x" });
      await auto(ctx, "delete the procedure", "DELETE", `/procedures/${gone.id}`);
      cases.push({ label: "deleted", runId: goneRun.runId, status: 404, key: "deleted" });
      const noTrigger = await make("No trigger");
      const noTriggerRun = await runNow(ctx, noTrigger.id, { who: "x" });
      const saved = (await auto(ctx, "read", "GET", `/procedures/${noTrigger.id}`)).body;
      const renamed = graph([trigger("t2"), action("eff1", "verify.effect")], [tedge("t2", "eff1")], []);
      await saveGraph(ctx, "replace the trigger", noTrigger.id, saved, renamed);
      cases.push({ label: "trigger gone", runId: noTriggerRun.runId, status: 409, key: "triggerGone", procedure: noTrigger.id });
      const large = await make("Large");
      const largeRun = await runNow(ctx, large.id, { who: "x", pad: "y".repeat(262_144) });
      cases.push({ label: "payload too large", runId: largeRun.runId, status: 409, key: "payloadTooLarge", procedure: large.id });
      const lost = await make("Lost draft");
      const savedLost = (await auto(ctx, "read", "GET", `/procedures/${lost.id}`)).body;
      const test = await auto(ctx, "test", "POST", `/procedures/${lost.id}/test`, { body: { graph: pick(savedLost, "graph"), payload: { who: "t" }, confirmRealEffects: true } });
      const testId = text(test.body, "runId");
      await withRuns(ctx, (runs) => runs.updateOne({ _id: testId }, { $unset: { graphSnapshot: "" } }));
      cases.push({ label: "draft not kept", runId: testId, status: 409, key: "draftNotKept", procedure: lost.id });
      await clearLedger(ctx);
      for (const one of cases) {
        const confirm = await confirmOf(ctx, one.runId);
        const refused = await auto(ctx, `re-run ${one.label}`, "POST", `/runs/${one.runId}/rerun`);
        await ctx.verify(`refused: ${one.label}`, [
          same("the confirmation is blocked and says why", [pick(confirm, "title"), pick(confirm, "description"), pick(confirm, "blocked"), pick(confirm, "icon")], ["$dms_automation.runs.rerunBlockedTitle", `$dms_automation.runs.rerunBlocked.${one.key}`, true, "i-ph-prohibit"]),
          same("the re-run is refused", [refused.status, pick(refused.body, "error"), pick(refused.body, "message")], [one.status, "this run cannot be re-run", `$dms_automation.runs.rerunBlocked.${one.key}`]),
        ]);
      }
      await ctx.verify("nothing ran", [same("the ledger holds no execution", executed((await ledger(ctx)).entries), [])]);
      const marker = parseJson(text(await storedRun(ctx, largeRun.runId), "triggerPayload"));
      await ctx.verify("the large payload is stored as a marker", [same("marker fields", [pick(marker, "truncated"), (pick(marker, "originalBytes") ?? 0) > 262_144], [true, true])]);
      /** @type {Record<string, string>} */
      const texts = {
        "trigger gone": "The trigger that started this run is no longer in the procedure.",
        "payload too large": "The payload was too large to keep, so the run can’t be replayed with it.",
        "draft not kept": "This test ran a draft that wasn’t kept. Test the procedure again from the builder.",
      };
      for (const one of cases.filter((c) => c.procedure)) {
        const { tab } = await openPage(ctx, `/modules/automation/runs?procedure=${one.procedure}`, /Run history/);
        await textWhen(tab, /Page 1 of 1/, 40_000);
        await tab.page.getByRole("button", { name: "Re-run" }).first().click();
        const dialog = flat(await textWhen(tab, /can’t be re-run/, 20_000));
        await ctx.verify(`the dialog for ${one.label}`, [
          check("title", /This run can’t be re-run/.test(dialog), dialog.slice(-400)),
          check("reason", dialog.includes(texts[one.label] ?? ""), dialog.slice(-400)),
        ]);
        await tab.close();
      }
      await runTable(ctx);
    },
  },
  {
    id: "the-re-run-confirmation-warns-in-the-words-of-the-run",
    title: "the confirmation Re-run with the same payload? warns that side effects are real, names the paused procedure and the headers sent as [redacted], runs only when confirmed, then opens the new run's trace",
    entryPoint: "/modules/automation/runs, Re-run",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Confirm ☕");
      const id = await effectProcedure(ctx, name);
      const original = await runNow(ctx, id, { who: "w", headers: { Authorization: "Bearer confirm-secret-1", "x-api-key": "key-confirm-2", accept: "text/plain" }, query: { token: "tok-confirm-3", page: "2" } });
      await auto(ctx, "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled: false } });
      const confirm = await confirmOf(ctx, original.runId);
      await ctx.verify("the confirmation by API", [
        same("the headers are named, headers first, then the query, with their case", pick(confirm, "params"), { name, headers: "Authorization, x-api-key, token" }),
        same("pause then redaction", pick(confirm, "impact"), [{ icon: "i-ph-pause-circle", label: "$dms_automation.runs.rerunPaused" }, { icon: "i-ph-eye-slash", label: "$dms_automation.runs.rerunRedacted" }]),
      ]);
      const { tab } = await openPage(ctx, `/modules/automation/runs?procedure=${id}`, /Run history/);
      await textWhen(tab, /Page 1 of 1/, 40_000);
      await tab.page.getByRole("button", { name: "Re-run" }).first().click();
      const dialog = flat(await textWhen(tab, /Re-run with the same payload\?/, 20_000));
      await ctx.verify("the dialog", [
        check("title and description", /Re-run with the same payload\? Runs the saved version of the procedure again, from the same trigger, with the payload this run received\. Side effects are real\./.test(dialog), dialog.slice(-700)),
        check("paused line", dialog.includes(`${name} is paused: the re-run still runs it once.`), dialog.slice(-700)),
        check("redacted line names the headers", dialog.includes("Credentials weren’t kept and are sent as “[redacted]”: Authorization, x-api-key, token."), dialog.slice(-700)),
      ]);
      await tab.page.getByRole("button", { name: "Cancel" }).click();
      await tab.page.waitForTimeout(800);
      await ctx.verify("Cancel runs nothing", [same("one run", (await runTable(ctx)).total, 1)]);
      await tab.page.getByRole("button", { name: "Re-run" }).first().click();
      await textWhen(tab, /Re-run with the same payload\?/, 20_000);
      await clearLedger(ctx);
      await tab.page.getByRole("button", { name: "Re-run", exact: true }).last().click();
      const finished = flat(await textWhen(tab, /Re-run finished/, 30_000));
      const total = await runTable(ctx);
      const created = (await runTable(ctx, { sortKey: "startedAt", sortDirection: "desc", limit: 1 })).rows[0];
      await ctx.verify("Confirm in the list", [
        same("a second run exists", total.total, 2),
        check("the toast says Re-run finished", /Re-run finished/.test(finished), finished.slice(-200)),
        same("the effect step ran once with the original who", executed((await ledger(ctx)).entries), [["verify.effect", "w"]]),
        same("the new run is a re-run of the first", [pick(created, "kind"), pick(created, "rerunOf")], ["rerun", original.runId]),
      ]);
      await tab.goto(`/modules/automation/runs?record=${original.runId}`);
      await textWhen(tab, /Run \d of 2/, 40_000);
      await clearLedger(ctx);
      await tab.page.waitForTimeout(5500);
      await tab.page.getByRole("button", { name: "Re-run with this payload" }).click();
      await textWhen(tab, /Re-run with the same payload\?/, 20_000);
      await tab.page.getByRole("button", { name: "Re-run", exact: true }).last().click();
      await tab.at(/\/trace$/, { timeoutMs: 30_000 });
      const toast = flat(await textWhen(tab, new RegExp(`Re-ran ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), 20_000));
      await ctx.verify("Re-run with this payload in the drawer", [
        check("opens the trace of the new run", new URL(tab.page.url()).pathname.endsWith("/trace") && new URL(tab.page.url()).searchParams.get("run") !== original.runId, tab.page.url()),
        check("and the toast says Re-ran <name>", toast.includes(`Re-ran ${name}`), toast.slice(-300)),
      ]);
    },
  },
  {
    id: "a-re-run-of-a-test-runs-the-draft-again-and-is-stored-as-a-test",
    title: "Re-run of a test runs again the draft that test ran, not the saved graph, stores it as a test, and its confirmation (Run this test again?) names the steps that act for real",
    entryPoint: "GET /runs/:id/rerun-confirm, POST /runs/:id/rerun",
    async run(/** @type {Ctx} */ ctx) {
      const id = await effectProcedure(ctx, ctx.unique("Retest"));
      const saved = (await auto(ctx, "read", "GET", `/procedures/${id}`)).body;
      const draft = graph([trigger("t"), action("raw", "verify.effect-nodry", { label: "draft only" })], [tedge("t", "raw")], []);
      await clearLedger(ctx);
      const test = await auto(ctx, "test the draft", "POST", `/procedures/${id}/test`, { body: { graph: draft, payload: { who: "t" }, confirmRealEffects: true } });
      const testId = text(test.body, "runId");
      const confirm = await confirmOf(ctx, testId);
      const retest = await auto(ctx, "re-run the test", "POST", `/runs/${testId}/rerun`);
      const stored = (await auto(ctx, "the new test", "GET", `/runs/${text(retest.body, "runId")}`)).body;
      const entries = (await ledger(ctx)).entries;
      const after = (await auto(ctx, "read", "GET", `/procedures/${id}`)).body;
      await ctx.verify("the re-test", [
        same("the confirmation is for a test", [pick(confirm, "title"), pick(confirm, "description"), pick(confirm, "icon"), pick(confirm, "confirmLabel")], ["$dms_automation.runs.retestConfirmTitle", "$dms_automation.runs.retestConfirmDescription", "i-ph-flask", "$dms_automation.runs.retest"]),
        same("it names the step that acts for real, with its label", pick(confirm, "impact"), [{ icon: "i-ph-lightning", label: "Fixture verify.effect-nodry", count: undefined }].map(({ icon, label }) => ({ icon, label }))),
        same("the draft ran again, not the saved graph", executed(entries), [["verify.effect-nodry", "draft only"], ["verify.effect-nodry", "draft only"]]),
        same("stored as a test, not rerun, without a version", [pick(stored, "kind"), pick(stored, "procedureVersion"), list(stored, "graph", "nodes").map((node) => node.id)], ["test", null, ["t", "raw"]]),
        same("the saved procedure is untouched", pick(after, "graph"), pick(saved, "graph")),
        same("the new test is not counted in the figures", (await runTable(ctx, { filter_kind: "is:test" })).total, 2),
      ]);
    },
  },
];
