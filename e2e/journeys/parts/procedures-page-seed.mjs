import { auto } from "../../auto.mjs";
import { action, chain, createProcedure, graph, manualLog, runNow, tedge, trigger } from "../../procs.mjs";
import { EMPTY_GRAPH } from "./procedures-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * One procedure per state, in the shapes the docs describe.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<Record<string, string>>} The ids by key
 */
export async function seedStates(ctx) {
  const enable = (/** @type {string} */ id, enabled = true) => auto(ctx, "enable", "PUT", `/procedures/${id}/enabled`, { body: { enabled } });
  const ids = {
    arm: await createProcedure(ctx, { name: "Arm one", graph: graph([trigger("t", "verify.bad-arm")]) }),
    bad: await createProcedure(ctx, { name: "Bad one", graph: chain([trigger("t"), action("f", "verify.fail", { message: "boom é" })]) }),
    flaky: await createProcedure(ctx, { name: "Degraded one", graph: chain([trigger("t"), action("f", "verify.flaky", { key: ctx.unique("seed"), failTimes: 1 })]) }),
    hook: await createProcedure(ctx, { name: "Hook one", graph: chain([trigger("t", "webhook", { path: "/hooks/stripe", method: "POST" }), action("l", "log.message", { message: "x" })]) }),
    okay: await createProcedure(ctx, { name: "Okay one", description: "does things", graph: manualLog("hi") }),
    cron: await createProcedure(ctx, { name: "Cron one", graph: graph([trigger("t", "schedule.cron", { cron: "0 8 * * 1-5" }), trigger("t2", "schedule.cron", { cron: "0 * * * *" }), action("l", "log.message", { message: "x" })], [tedge("t", "l"), tedge("t2", "l")]) }),
    draft: await createProcedure(ctx, { name: "Draft one", graph: EMPTY_GRAPH }),
  };
  for (const id of [ids.arm, ids.bad, ids.flaky, ids.hook, ids.okay, ids.cron]) await enable(id);
  await runNow(ctx, ids.okay, {});
  await runNow(ctx, ids.bad, {});
  await runNow(ctx, ids.flaky, {});
  await runNow(ctx, ids.flaky, {});
  await enable(ids.cron, false);
  return ids;
}
