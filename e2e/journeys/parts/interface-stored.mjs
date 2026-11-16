import { auto, check, same } from "../../auto.mjs";
import { invokeProcedure, runProcedure } from "./interface-calls.mjs";
import { withProcedures } from "./triggers-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

export const storedJourneys = [
  {
    id: "an-unparseable-stored-graph-is-refused-with-400-by-invoke-and-run",
    title: "InvokeProcedure and RunProcedure reject with 400 for a stored graph that cannot be parsed, as does the Run now route, and store no run",
    entryPoint: "InvokeProcedure, RunProcedure, POST /procedures/:id/run-now",
    async run(/** @type {Ctx} */ ctx) {
      const id = ctx.unique("broken").replace(/\s+/g, "-");
      const now = new Date();
      await withProcedures(ctx, (procedures) =>
        procedures.insertOne({ _id: id, _instance: "dms-automation", name: "Broken graph", description: "", enabled: false, graph: "{not json", version: 1, revision: 1, created_at: now, updated_at: now }),
      );
      const invoked = await invokeProcedure(ctx, id);
      const ran = await runProcedure(ctx, id);
      const routed = await auto(ctx, "Run now of the broken procedure", "POST", `/procedures/${id}/run-now`, { body: { payload: {} } });
      const runs = await auto(ctx, "the runs of the broken procedure", "GET", `/procedures/${id}/runs`);
      await ctx.verify("an invalid stored graph", [
        same("InvokeProcedure rejects with 400", [invoked.ok, invoked.status], [false, 400]),
        same("RunProcedure rejects with 400", [ran.ok, ran.status], [false, 400]),
        same("Run now answers 400", routed.status, 400),
        check("the rejection names the procedure", JSON.stringify(routed.body).includes(id), routed.body),
        same("no run was stored", Array.isArray(runs.body) ? runs.body.length : -1, 0),
      ]);
    },
  },
];
