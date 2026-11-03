import { guarded } from "../guard.mjs";
import { auto, check, flag, list, pick, same, text } from "../auto.mjs";
import { createProcedure, logsOf, manualLog, messages, runNow, runOf, stepsOf, statusIs } from "../procs.mjs";

/** @typedef {import("../auto.mjs").Ctx} Ctx */

const MESSAGE = "Hello from my first procedure";

/** The fixed journey every verdict runs: the Builder page's "A two-step procedure". */
export const journeys = guarded([
  {
    id: "a-manual-trigger-and-a-log-action-run-and-are-traced",
    title: "a Manual trigger joined to a Log action runs with {} as its payload, the message is in the run's Logs and trace, and the run is in the history and the procedure's runs",
    entryPoint: "POST /procedures/import, PUT /procedures/:id/enabled, POST /procedures/:id/run-now, GET /runs/:id, /modules/automation/trace",
    async run(/** @type {Ctx} */ ctx) {
      const name = ctx.unique("Smoke");
      const id = await createProcedure(ctx, { name, graph: manualLog(MESSAGE) });
      const created = await auto(ctx, "read the draft", "GET", `/procedures/${id}`);
      await ctx.verify("the import is a disabled draft", [
        check("the procedure has an id", id.length > 0, id),
        same("it is disabled", flag(created.body, "enabled"), false),
        same("it keeps its name", text(created.body, "name"), name),
      ]);
      const enabled = await auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled: true } });
      const ran = await runNow(ctx, id, {});
      const run = await runOf(ctx, ran.runId);
      const steps = stepsOf(run);
      const entries = await logsOf(ctx, ran.runId);
      await ctx.verify("the run", [
        statusIs(enabled, 200, "enabling answers 200"),
        same("Run now answers ok", ran.status, "ok"),
        same("the run's status", run.status, "ok"),
        same("the run's kind", run.kind, "run"),
        same("the trigger is the manual one", text(run, "trigger", "typeId"), "manual"),
        same("the steps are the trigger then the log", Object.keys(steps), ["t", "log"]),
        same("the log step received the message", pick(steps.log, "inputs", "message"), { type: "string", value: MESSAGE }),
        same("the level defaults to info", pick(steps.log, "inputs", "level"), { type: "string", value: "info" }),
        check("the message is in the run's Logs", messages(entries).includes(MESSAGE), messages(entries)),
      ]);
      const history = await auto(ctx, "run history", "GET", `/procedures/${id}/runs`);
      await ctx.verify("the history", [same("the procedure's runs are this one", list(history.body).map((row) => row._id), [ran.runId])]);
      const tab = await ctx.tab("admin");
      await tab.signIn("admin");
      await tab.goto(`/modules/automation/trace?run=${ran.runId}`);
      await ctx.verify("the trace page", [await tab.shows(new RegExp(name)), await tab.shows(/Hello from my first procedure|Log/)]);
    },
  },
]);
