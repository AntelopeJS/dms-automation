import { auto, check, list, pick, same, text } from "../../auto.mjs";
import { createProcedure, runOf, runsOfProcedure } from "../../procs.mjs";
import { actionNode, chainGraph, logGraph, runProcedure, triggerNode } from "./interface-calls.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Row} Row */

export const moreRunJourneys = [
  {
    id: "run-procedure-answers-the-outcome-runs-a-paused-procedure-and-counts-in-health",
    title: "RunProcedure resolves to { runId, status, errorMessage? }, runs a paused procedure too, and stores an ordinary run that counts in the health figures",
    entryPoint: "RunProcedure(id), PUT /procedures/:id/enabled, GET /stats/health, GET /procedures/:id/runs",
    async run(/** @type {Ctx} */ ctx) {
      const ok = await createProcedure(ctx, {
        name: ctx.unique("Okay"),
        graph: logGraph("fine é"),
      });
      await auto(ctx, "enable", "PUT", `/procedures/${ok}/enabled`, {
        body: { enabled: true },
      });
      await auto(ctx, "pause", "PUT", `/procedures/${ok}/enabled`, {
        body: { enabled: false },
      });
      const paused = await runProcedure(ctx, ok, { payload: { p: 1 } });
      const pausedRun = await runOf(ctx, text(paused.result, "runId"));
      await ctx.verify("a paused procedure runs", [
        same("the outcome has exactly runId and status", Object.keys(paused.result).sort(), ["runId", "status"]),
        same("status", paused.result.status, "ok"),
        same("the stored run is an ordinary run", [pausedRun.kind, pausedRun.status, pausedRun.procedureId], ["run", "ok", ok]),
        same(
          "it appears in the procedure's runs",
          (await runsOfProcedure(ctx, ok)).map((row) => [row._id, row.kind]),
          [[text(paused.result, "runId"), "run"]],
        ),
        same("the procedure is still paused", pick((await auto(ctx, "read", "GET", `/procedures/${ok}`)).body, "enabled"), false),
      ]);
      const bad = await createProcedure(ctx, {
        name: ctx.unique("Broken"),
        graph: chainGraph([triggerNode("t"), actionNode("boom", "verify.fail", { message: "kaputt ß" })]),
      });
      await auto(ctx, "enable", "PUT", `/procedures/${bad}/enabled`, {
        body: { enabled: true },
      });
      const before = await auto(ctx, "health before", "GET", "/stats/health");
      const failed = await runProcedure(ctx, bad);
      const after = await auto(ctx, "health after", "GET", "/stats/health");
      await ctx.verify("a failed run", [
        same("the outcome", [failed.result.status, failed.result.errorMessage, Object.keys(failed.result).sort()], ["failed", "kaputt ß", ["errorMessage", "runId", "status"]]),
        same("health before", pick(before.body, "title", "key"), "dms_automation.health.healthy"),
        same("health after names the procedure as failing", [pick(after.body, "title", "key"), pick(after.body, "title", "params", "count", "value")], ["dms_automation.health.failing", 1]),
      ]);
      const procedures = await auto(ctx, "the procedure list", "GET", "/procedures");
      const row = list(procedures.body, "results").find((candidate) => candidate._id === bad) ?? {};
      await ctx.verify("the list", [check("the broken procedure is listed", row._id === bad, row)]);
    },
  },
  {
    id: "run-procedure-refuses-a-graph-with-an-unknown-type-and-lists-the-issues",
    title: "RunProcedure rejects a graph with blocking issues with 400 and lists the issues",
    entryPoint: "RunProcedure(id)",
    async run(/** @type {Ctx} */ ctx) {
      const id = await createProcedure(ctx, {
        graph: {
          nodes: [triggerNode("t"), actionNode("ghost", "verify.never-registered", {}), actionNode("ghost2", "verify.never-registered-either", {})],
          triggerEdges: [
            { id: "e1", from: { node: "t" }, to: { node: "ghost" } },
            { id: "e2", from: { node: "ghost" }, to: { node: "ghost2" } },
          ],
          dataEdges: [],
        },
      });
      const outcome = await runProcedure(ctx, id);
      await ctx.verify("the rejection", [
        same("status", outcome.status, 400),
        same("error", pick(outcome.body, "error"), "invalid graph"),
        same(
          "every blocking issue is listed",
          list(outcome.body, "issues").map((issue) => [issue.severity, issue.code, issue.nodeId, issue.message]),
          [
            ["error", "unknownType", "ghost", 'action node "ghost" references unknown type "verify.never-registered"'],
            ["error", "unknownType", "ghost2", 'action node "ghost2" references unknown type "verify.never-registered-either"'],
          ],
        ),
        same("no run was stored", (await runsOfProcedure(ctx, id)).length, 0),
      ]);
    },
  },
  {
    id: "run-procedure-refuses-a-graph-with-no-trigger-or-a-missing-setting",
    title: "RunProcedure rejects a graph with blocking issues such as no trigger or a step missing its settings with 400, and the rejection lists the issues",
    entryPoint: "RunProcedure(id)",
    async run(/** @type {Ctx} */ ctx) {
      const noTrigger = await createProcedure(ctx, {
        graph: {
          nodes: [actionNode("log", "log.message", { message: "x" })],
          triggerEdges: [],
          dataEdges: [],
        },
      });
      const refused = await runProcedure(ctx, noTrigger);
      await ctx.verify("no trigger", [same("status", refused.status, 400), check("the rejection lists the issues", list(refused.body, "issues").length > 0, refused.body), same("no run was stored", (await runsOfProcedure(ctx, noTrigger)).length, 0)]);
      const missing = await createProcedure(ctx, {
        graph: chainGraph([triggerNode("t"), actionNode("req", "http.request", {})]),
      });
      const missingRun = await runProcedure(ctx, missing);
      await ctx.verify("a step missing its settings", [same("status", missingRun.status, 400), check("the rejection lists the issues", list(missingRun.body, "issues").length > 0, missingRun.raw), same("no run was stored", (await runsOfProcedure(ctx, missing)).length, 0)]);
    },
  },
];
