import { auto, text } from "../../auto.mjs";
import { action, chain, createEnabled, trigger } from "../../procs.mjs";
import { insertRuns, MS_PER_HOUR, runDocument } from "./runs-common.mjs";

/** @typedef {import("../../auto.mjs").Ctx} Ctx */

/**
 * A procedure that runs a, boom (labelled Charge card) and c, and five stored runs of it: three successes of 60, 60 and
 * 100 ms, then two failures at boom. The last success took 10, 20 and 30 ms for a, boom and c.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ id: string, name: string, runs: Record<"s2" | "s3" | "s1" | "f1" | "f2", string> }>} The procedure and its runs by name, oldest first
 */
export async function seededFailures(ctx) {
  const name = ctx.unique("Nightly ☕");
  const { id } = await createEnabled(ctx, {
    name,
    graph: chain([trigger("t"), action("a", "log.message", { message: "before" }), { ...action("boom", "verify.fail", { message: "disk full" }), label: "Charge card" }, action("c", "log.message", { message: "after" })]),
  });
  const now = Date.now();
  const at = (/** @type {number} */ hoursBack) => new Date(now - hoursBack * MS_PER_HOUR);
  const base = { procedureId: id, procedureName: name };
  const good = [{ id: "a", durationMs: 10 }, { id: "boom", durationMs: 20 }, { id: "c", durationMs: 30 }];
  const bad = [{ id: "a", durationMs: 10 }, { id: "boom", durationMs: 40, error: "disk full" }];
  const failedStep = { nodeId: "boom", kind: "action", label: "Charge card" };
  const docs = {
    s2: runDocument({ ...base, startedAt: at(5), durationMs: 60, steps: good }),
    s3: runDocument({ ...base, startedAt: at(4), durationMs: 100, steps: good }),
    s1: runDocument({ ...base, startedAt: at(3), durationMs: 60, steps: good }),
    f1: runDocument({ ...base, startedAt: at(2), durationMs: 50, status: "failed", steps: bad, failedStep }),
    f2: runDocument({ ...base, startedAt: at(1), durationMs: 50, status: "failed", steps: bad, failedStep }),
  };
  await insertRuns(ctx, Object.values(docs));
  const read = await auto(ctx, "read the procedure", "GET", `/procedures/${id}`);
  return { id, name: text(read.body, "name"), runs: { s2: String(docs.s2._id), s3: String(docs.s3._id), s1: String(docs.s1._id), f1: String(docs.f1._id), f2: String(docs.f2._id) } };
}
