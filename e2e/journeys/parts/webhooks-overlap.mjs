import { auto, isText, same } from "../../auto.mjs";
import { runsOfProcedure, statusIs } from "../../procs.mjs";
import { callWebhook, enabledProcedure, runsUntil, summaryOf, summaryUntil, webhookGraph } from "./triggers-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */
/** @typedef {import("../../auto.mjs").Check} Check */

export const overlapJourneys = [
  {
    id: "two-paths-are-the-same-when-their-segments-are-equal-or-a-param",
    title: "two webhook paths count as the same when they have the same number of segments and each pair of segments is equal or one of the pair is a :param segment: the procedure that arms second is Failing with the reason, and the first keeps answering",
    entryPoint: "PUT /procedures/:id/enabled, GET /procedures/summary, POST /webhooks/...",
    async run(/** @type {Ctx} */ ctx) {
      const ownerName = ctx.unique("Param owner");
      const { id: ownerId } = await enabledProcedure(ctx, { name: ownerName, graph: webhookGraph("/webhooks/q/:id/items", "POST", "method") });
      const literalName = ctx.unique("Literal");
      const { id: literalId, enabled } = await enabledProcedure(ctx, { name: literalName, graph: webhookGraph("/webhooks/q/42/items", "POST", "method") });
      const samePath = await summaryUntil(ctx, literalId, (row) => row.status === "failing");
      await ctx.verify("a literal path under a :param path is Failing with the reason", [
        statusIs(enabled, 200, "enabling is accepted"),
        same("the literal one is failing", samePath.status, "failing"),
        same("its last error names the owner", samePath.lastError, `POST /webhooks/q/42/items already answers for the procedure "${ownerName}"`),
        same("the reason as the pages word it", samePath.statusDetail, { key: "dms_automation.procedures.detail.triggerError", params: { error: { key: "dms_automation.editor.problems.codes.webhookPathTaken", params: { method: "POST", path: "/webhooks/q/42/items", procedure: ownerName } } } }),
        same("the owner is not failing", (await summaryOf(ctx, ownerId)).status, "healthy"),
      ]);
      const call = await callWebhook(ctx, "call the shared route", { path: "/webhooks/q/42/items", headers: { "content-type": "application/json" }, body: "{}" });
      const ownerRuns = await runsUntil(ctx, ownerId, 1);
      const literalRuns = await runsOfProcedure(ctx, literalId);
      await ctx.verify("the first procedure answers, the second never runs", [
        same("the call is answered", call.status, 200),
        same("the owner ran once", ownerRuns.length, 1),
        same("the other did not run", literalRuns.length, 0),
      ]);
      /** @type {[string, string, string][]} */
      const probes = [
        ["/webhooks/q/:x/items", "POST", "a param against a param"],
        ["/webhooks/q/7/items", "POST", "another literal under the param"],
        ["/webhooks/q/8/items/", "POST", "a trailing slash"],
      ];
      /** @type {Check[]} */
      const failing = [];
      for (const [path, method, label] of probes) {
        const { id } = await enabledProcedure(ctx, { name: ctx.unique("Probe"), graph: webhookGraph(path, method) });
        const row = await summaryUntil(ctx, id, (candidate) => candidate.status === "failing");
        failing.push(same(label, [row.status, isText(row.lastError) && (row.lastError.endsWith(`already answers for the procedure "${ownerName}"`) || row.lastError.includes("already answers for the procedure"))], ["failing", true]));
      }
      await ctx.verify("every overlapping form fails to arm behind the owner", failing);
      /** @type {[string, string, string][]} */
      const apart = [
        ["/webhooks/q/7/items/more", "POST", "one segment more"],
        ["/webhooks/q/items", "POST", "one segment fewer"],
        ["/webhooks/q/7/other", "POST", "a different literal"],
        ["/webhooks/q/7/items", "PUT", "another method"],
      ];
      /** @type {Check[]} */
      const healthy = [];
      for (const [path, method, label] of apart) {
        const { id } = await enabledProcedure(ctx, { name: ctx.unique("Apart"), graph: webhookGraph(path, method) });
        const row = await summaryUntil(ctx, id, (candidate) => candidate.status === "failing", 3000);
        healthy.push(same(label, row.status, "healthy"));
      }
      await ctx.verify("paths that differ in segment count, a literal or the method arm fine", healthy);
      const pause = await auto(ctx, "pause the owner", "PUT", `/procedures/${ownerId}/enabled`, { body: { enabled: false } });
      const recovered = await summaryUntil(ctx, literalId, (row) => row.status !== "failing");
      const again = await callWebhook(ctx, "call the route after the owner paused", { path: "/webhooks/q/42/items", headers: { "content-type": "application/json" }, body: "{}" });
      const literalAfter = await runsUntil(ctx, literalId, 1);
      await ctx.verify("pausing the owner lets the other arm on the next reconcile", [
        statusIs(pause, 200, "pausing answers 200"),
        same("the literal one is no longer failing", recovered.status, "healthy"),
        same("it carries no trigger error", recovered.lastError, null),
        same("the call is answered", again.status, 200),
        same("the literal one ran", literalAfter.length, 1),
      ]);
    },
  },
];
