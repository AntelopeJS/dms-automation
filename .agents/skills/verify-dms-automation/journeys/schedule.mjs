import { guarded } from "../guard.mjs";
import { auto, check, isRow, list, pick, same, text } from "../auto.mjs";
import { action, chain, clearLedger, createProcedure, ledger, runsOfProcedure, statusIs, trigger, withConfig } from "../procs.mjs";
import { nextFire } from "./parts/cron-reference.mjs";
import { wordingJourneys } from "./parts/schedule-wording.mjs";
import { cronGraph, enabledProcedure, issueLines, issuesOf, payloadOf, runDetail, runsUntil, saveGraph, storeEnabled, summaryUntil, triggerGraph } from "./parts/triggers-common.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

const INVALID = (/** @type {string} */ cron) => `error cronInvalid invalid cron expression: "${cron}"`;

const VALID = ["* * * * *", "0 9 * * 1", "*/5 * * * *", "0 0 * * 0", "0 0 * * 7", "0 9 * * mon-fri", "0 9 * * MON", "0 0 1 jan *", "*/15 9-17 * * 1-5", "0,30 * * * *", "* * * * * *", "*/10 * * * * *", "0 0 0 * * *", " 0 9 * * 1 ", "  0   9   *   *   1  ", "0-59 * * * *", "1-5/2 * * * *", "0 12 31 * *", "0 9 * JAN-MAR *", "0 0 29 2 *"];
const BAD = ["nope", "* * * *", "* * * * * * *", "61 * * * *", "60 * * * * *", "99 * * * * *", "0 24 * * *", "0 0 32 * *", "0 0 0 * *", "0 0 * 13 *", "0 0 * 0 *", "0 9 * * 8", "-1 * * * *", "1.5 * * * *", "a b c d e", "*/0 * * * *", "1/0 * * * *", "? * * * *", "L * * * *", "0 0 30 2 *", "@weekly-ish", "0 9 * * 1\n", "0 9\t* * 1"];

export const journeys = guarded([
  {
    id: "a-schedule-must-be-a-valid-cron-expression",
    title: "a schedule trigger accepts the standard cron syntax (five fields, or six with seconds first, lists, ranges, steps, names) and refuses anything else with invalid cron expression: \"<value>\"; an invalid schedule cannot be enabled but a draft can hold it",
    entryPoint: "POST /procedures/validate, POST /procedures/import, PUT /procedures/:id/enabled",
    async run(/** @type {Ctx} */ ctx) {
      const accepted = [];
      for (const cron of VALID) accepted.push(same(`valid ${JSON.stringify(cron)}`, issueLines(await issuesOf(ctx, cronGraph(cron), { enabled: true })), []));
      await ctx.verify("valid expressions raise no problem", accepted);
      const refused = [];
      for (const cron of BAD) refused.push(same(`invalid ${JSON.stringify(cron)}`, issueLines(await issuesOf(ctx, cronGraph(cron), { enabled: true })), [INVALID(cron)]));
      await ctx.verify("invalid expressions are refused with the documented message", refused);
      const empty = issueLines(await issuesOf(ctx, cronGraph(""), { enabled: true }));
      const emptyDraft = issueLines(await issuesOf(ctx, cronGraph(""), { enabled: false }));
      const numeric = issueLines(await issuesOf(ctx, chain([trigger("t", "schedule.cron", { cron: 5 }), action("log", "log.message", { message: "x" })]), { enabled: true }));
      const draftBad = issueLines(await issuesOf(ctx, cronGraph("nope"), { enabled: false }));
      await ctx.verify("empty, not text, and draft", [
        same("an empty schedule blocks enabling", empty, ["error missingField Schedule (cron expression) is empty"]),
        same("an empty schedule only warns on a draft", emptyDraft, ["warning missingField Schedule (cron expression) is empty"]),
        same("a number is not an expression", numeric, [INVALID("")]),
        same("an invalid expression is an error even on a draft", draftBad, [INVALID("nope")]),
      ]);
      const name = ctx.unique("Bad schedule");
      const id = await createProcedure(ctx, { name, graph: cronGraph("every day") });
      const refusal = await auto(ctx, "enable the invalid schedule", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const draft = await auto(ctx, "read the draft", "GET", `/procedures/${id}`);
      await ctx.verify("an invalid schedule cannot be enabled", [
        same("the draft keeps the expression", text(list(draft.body, "graph", "nodes")[0], "config", "cron"), "every day"),
        statusIs(refusal, 400, "enabling answers 400"),
        same("the refusal message", text(refusal.body, "message"), "$dms_automation.api.graphHasErrors"),
        same("the refusal lists the problem", issueLines(list(refusal.body, "issues")), [INVALID("every day")]),
        same("it is still a draft", pick(draft.body, "enabled"), false),
      ]);
      const fixed = await saveGraph(ctx, id, cronGraph("*/5 * * * *"), { enabled: true, name });
      const row = await summaryUntil(ctx, id, (candidate) => candidate.enabled === true);
      await ctx.verify("a valid expression saves enabled", [statusIs(fixed, 200, "saving answers 200"), same("enabled", row.enabled, true), same("healthy", row.status, "healthy")]);
    },
  },
  {
    id: "a-schedule-shows-its-next-run",
    title: "a saved schedule trigger reports the next time it fires (server time zone), and none when it never fires within a year",
    entryPoint: "GET /procedures/:id/triggers, /modules/automation/builder",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { TZ: "UTC" }, async () => {
        const crons = ["0 9 * * 1", "*/15 * * * *", "0 0 1 * *", "30 8 * * 1-5", "0 0 13 * 5", "0 0 * * 7", "15 14 1 jan *", "*/5 9-10 * * *"];
        const results = [];
        for (const cron of crons) {
          const id = await createProcedure(ctx, { name: ctx.unique("Next"), graph: cronGraph(cron) });
          const before = new Date();
          const answer = await auto(ctx, `triggers of ${cron}`, "GET", `/procedures/${id}/triggers`);
          const trig = list(answer.body, "triggers")[0] ?? {};
          const expected = nextFire(cron, before)?.toISOString() ?? null;
          const earliest = nextFire(cron, new Date(before.getTime() - 2000))?.toISOString() ?? null;
          results.push(check(`next run of ${cron}`, trig.nextAt === expected || trig.nextAt === earliest, `expected ${String(expected)}, got ${String(trig.nextAt)}`), same(`${cron} keeps its expression`, trig.cron, cron));
        }
        await ctx.verify("the next run follows the schedule", results);
        const sixId = await createProcedure(ctx, { name: ctx.unique("Next seconds"), graph: cronGraph("*/20 * * * * *") });
        const six = list((await auto(ctx, "triggers of seconds", "GET", `/procedures/${sixId}/triggers`)).body, "triggers")[0] ?? {};
        const when = new Date(String(six.nextAt));
        await ctx.verify("a six-field schedule counts seconds", [
          check("the next run is on a 20-second mark in the next 20 seconds", when.getUTCSeconds() % 20 === 0 && when.getTime() > Date.now() - 1000 && when.getTime() <= Date.now() + 21_000, String(six.nextAt)),
          same("the time zone is named", six.timeZone, "UTC"),
        ]);
        const noScheduleId = await createProcedure(ctx, { name: ctx.unique("No next"), graph: triggerGraph("manual", {}) });
        const manual = list((await auto(ctx, "triggers of a manual", "GET", `/procedures/${noScheduleId}/triggers`)).body, "triggers")[0] ?? {};
        await ctx.verify("a trigger that is not a schedule has no next run", [same("nextAt", manual.nextAt, null)]);

        const id = await createProcedure(ctx, { name: ctx.unique("Inspector"), graph: cronGraph("0 9 * * 1") });
        const next = nextFire("0 9 * * 1", new Date());
        const tab = await ctx.tab("admin");
        await tab.signIn("admin");
        await tab.goto(`/modules/automation/builder?selected=${id}`);
        await tab.visible({ role: "group", name: "Schedule (cron), Mondays at 09:00 (UTC)" }, { timeoutMs: 40_000 });
        let shown = await tab.shows(/Next run: /, { timeoutMs: 1500 });
        for (let attempt = 0; attempt < 6 && !shown.pass; attempt += 1) {
          await tab.click({ role: "group", name: "Schedule (cron), Mondays at 09:00 (UTC)" });
          shown = await tab.shows(/Next run: /, { timeoutMs: 4000 });
        }
        await ctx.verify("the builder shows the next run with its zone", [shown, await tab.shows(/Next run: .*\(UTC\)/), await tab.shows(/Schedule: Mondays at 09:00 \(UTC\)\. Nothing fires until you enable it \(otherwise next at [A-Z][a-z]{2} \d{1,2}, 9:00 AM\)/), check("the next occurrence exists", next !== null, String(next))]);
      });
    },
  },
  {
    id: "an-invalid-schedule-in-an-enabled-procedure-is-failing-with-the-reason",
    title: "an enabled procedure whose schedule cannot be armed is Failing, never ran, and the reason shows after Trigger not armed: on the Procedures page, the Overview and in the API; the Needs attention list has no run to open",
    entryPoint: "GET /procedures/summary, GET /stats/attention, GET /stats/health, /modules/automation/procedures, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      const bad = await storeEnabled(ctx, "Stored bad schedule", cronGraph("every day at nine"));
      const good = await storeEnabled(ctx, "Stored good schedule", cronGraph("0 9 * * 1"));
      await ctx.restartBackend();
      const row = await summaryUntil(ctx, bad, (candidate) => candidate.status === "failing");
      const fine = await summaryUntil(ctx, good, (candidate) => candidate.status !== undefined);
      await ctx.verify("the API", [
        same("the invalid schedule is failing", row.status, "failing"),
        same("its last error", row.lastError, 'invalid cron expression: "every day at nine"'),
        same("the reason as the pages word it", row.statusDetail, { key: "dms_automation.procedures.detail.triggerError", params: { error: { key: "dms_automation.editor.problems.codes.cronInvalid", params: { cron: "every day at nine" } } } }),
        same("it never ran", [row.runs, row.lastRunAt], [0, null]),
        same("the valid schedule is healthy", fine.status, "healthy"),
      ]);
      const attention = list((await auto(ctx, "needs attention", "GET", "/stats/attention")).body, "items");
      const health = (await auto(ctx, "health", "GET", "/stats/health")).body;
      await ctx.verify("Needs attention and the banner", [
        same("one procedure needs attention", attention.map((item) => text(item, "name")), ["Stored bad schedule"]),
        same("its arm error", pick(attention[0], "armError"), { code: "cronInvalid", params: { cron: "every day at nine" }, message: 'invalid cron expression: "every day at nine"' }),
        same("no last failure to open", pick(attention[0], "lastRunId"), null),
        same("the banner's title counts one", pick(health, "title", "key"), "dms_automation.health.failing"),
        same("the banner has nothing to open for a procedure that never ran", list(health, "actions").map((entry) => text(entry, "label")), []),
      ]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto("/modules/automation/procedures");
      await ctx.verify("the Procedures page", [
        await tab.shows(/Stored bad schedule\s+Failing\s+Trigger not armed: “every day at nine” is not a valid schedule \(cron expression\)\./),
        await tab.shows(/Stored good schedule\s+Healthy/),
      ]);
      await tab.goto("/modules/automation/overview");
      await ctx.verify("the Overview", [
        await tab.shows(/1 procedure failing/),
        await tab.shows(/Stored bad schedule · failing since — · Trigger not armed: “every day at nine” is not a valid schedule \(cron expression\)\./),
        await tab.shows(/Open last failure/, { not: true, timeoutMs: 2000 }),
      ]);
    },
  },
  {
    id: "the-schedule-recipe-places-a-monday-09-00-schedule",
    title: "the Send a scheduled digest recipe creates a disabled draft with a schedule on 0 9 * * 1, every Monday at 09:00",
    entryPoint: "POST /procedures/new, GET /procedures/:id/triggers, /modules/automation/overview",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { TZ: "UTC" }, async () => {
        const tab = await ctx.tab("admin");
        await tab.signIn("admin");
        await tab.goto("/modules/automation/overview");
        await ctx.verify("the empty overview offers the recipe", [await tab.visible({ role: "button", name: "Send a scheduled digest" })]);
        const created = await auto(ctx, "new schedule procedure", "POST", "/procedures/new", { body: { name: "Weekly digest", trigger: "schedule.cron" } });
        const id = text(created.body, "_id");
        const read = await auto(ctx, "read it", "GET", `/procedures/${id}`);
        const triggers = await auto(ctx, "its triggers", "GET", `/procedures/${id}/triggers`);
        const node = list(read.body, "graph", "nodes")[0] ?? {};
        await ctx.verify("the recipe's trigger", [
          statusIs(created, 200, "creating answers 200"),
          same("it is a disabled draft", pick(read.body, "enabled"), false),
          same("one trigger node", list(read.body, "graph", "nodes").length, 1),
          same("the node is a schedule", [node.kind, node.typeId], ["trigger", "schedule.cron"]),
          same("the schedule", pick(node, "config"), { cron: "0 9 * * 1" }),
          same("its words", pick(list(triggers.body, "triggers")[0], "text"), { key: "dms_automation.cron.weekly", params: { day: { key: "dms_automation.cron.days.mon" }, time: "09:00 (UTC)" } }),
          same("its next run", pick(list(triggers.body, "triggers")[0], "nextAt"), nextFire("0 9 * * 1", new Date())?.toISOString()),
        ]);
      });
    },
  },
  {
    id: "an-enabled-schedule-fires-runs-and-stops-when-paused-or-edited",
    title: "an enabled schedule starts a run on each occurrence with {firedAt} as its payload; pausing, deleting or editing it stops the old schedule",
    entryPoint: "PUT /procedures/:id/enabled, PUT /procedures/:id, GET /procedures/:id/runs, GET /runs/:id",
    async run(/** @type {Ctx} */ ctx) {
      const { id } = await enabledProcedure(ctx, { name: ctx.unique("Every two seconds"), graph: cronGraph("*/2 * * * * *") });
      const runs = await runsUntil(ctx, id, 2, 12_000);
      const first = await runDetail(ctx, text(runs.at(-1), "_id"));
      const parsed = payloadOf(first);
      const payload = isRow(parsed) ? parsed : {};
      const started = new Date(String(first.startedAt)).getTime();
      await ctx.verify("occurrences start runs", [
        check("two runs within 12 seconds", runs.length >= 2, runs.length),
        same("the payload holds firedAt only", Object.keys(payload), ["firedAt"]),
        check("firedAt is an ISO instant on an even second near the run", new Date(String(payload.firedAt)).getUTCSeconds() % 2 === 0 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(payload.firedAt)) && Math.abs(new Date(String(payload.firedAt)).getTime() - started) < 3000, String(payload.firedAt)),
        same("the trigger type", text(first, "trigger", "typeId"), "schedule.cron"),
        same("the run's kind", first.kind, "run"),
        same("it succeeded", first.status, "ok"),
        same("the occurrences are two seconds apart", [...new Set(runs.slice(0, 3).map((run, index, all) => (index === 0 ? 2000 : new Date(String(all[index - 1]?.startedAt)).getTime() - new Date(String(run.startedAt)).getTime())).map((gap) => Math.round(gap / 1000)))].sort((x, y) => x - y), [2]),
      ]);

      const pause = await auto(ctx, "pause", "PUT", `/procedures/${id}/enabled`, { body: { enabled: false } });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const frozen = (await runsOfProcedure(ctx, id)).length;
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const later = (await runsOfProcedure(ctx, id)).length;
      await ctx.verify("pausing stops the schedule", [statusIs(pause, 200, "pausing answers 200"), same("no run in five seconds", later, frozen)]);

      const resume = await auto(ctx, "resume", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      await runsUntil(ctx, id, frozen + 1, 8000);
      const edit = await saveGraph(ctx, id, cronGraph("0 0 1 1 *"), { enabled: true, name: text((await auto(ctx, "read name", "GET", `/procedures/${id}`)).body, "name") });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const afterEdit = (await runsOfProcedure(ctx, id)).length;
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const settled = (await runsOfProcedure(ctx, id)).length;
      await ctx.verify("editing the expression replaces the schedule", [statusIs(resume, 200, "resuming answers 200"), statusIs(edit, 200, "saving answers 200"), check("a run started after resuming", afterEdit > frozen, `${frozen} -> ${afterEdit}`), same("the old schedule no longer fires", settled, afterEdit)]);

      await clearLedger(ctx);
      const second = await enabledProcedure(ctx, { name: ctx.unique("Deleted schedule"), graph: chain([trigger("t", "schedule.cron", { cron: "*/2 * * * * *" }), action("tick", "verify.tick", { key: "deleted" })]) });
      await runsUntil(ctx, second.id, 1, 8000);
      const removed = await auto(ctx, "delete", "DELETE", `/procedures/${second.id}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const atDelete = Number((await ledger(ctx)).counters["tick:deleted"]);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const lateCount = Number((await ledger(ctx)).counters["tick:deleted"]);
      await ctx.verify("deleting stops the schedule", [statusIs(removed, 200, "delete answers 200"), check("it had fired", atDelete >= 1, atDelete), same("no step ran after the delete", lateCount, atDelete)]);
    },
  },
  ...wordingJourneys,
]);
