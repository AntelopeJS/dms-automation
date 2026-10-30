import { setImmediate as nextTick } from "node:timers/promises";
import { type NodeExecute, nodeKinds } from "../../nodeKinds";

/**
 * The most iterations a loop runs. Every iteration is logged and the run is
 * kept as one document, so a longer loop loses most of its log anyway; a job
 * that needs more belongs in batches.
 */
export const MAX_FOR_RANGE_ITERATIONS = 10_000;

/** Iterations run between two yields to the event loop. */
const ITERATIONS_PER_YIELD = 50;

/**
 * Runs the loop body once per value. A range over the iteration limit is
 * refused before the first iteration, rather than after the limit's worth of
 * them. A long loop of fast steps would otherwise hold the server, so the
 * loop lets the other requests through now and then. `main` auto-propagates
 * after execute returns. `start`, `end` and `step` are data-ins that execute
 * defaults to 0, 0 and 1 itself, so the kind needs no configSchema and no
 * defaultConfig.
 */
const execute: NodeExecute = async (_node, inputs, ctx) => {
  const start = Number(inputs.start ?? 0);
  const end = Number(inputs.end ?? 0);
  const step = Number(inputs.step ?? 1);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(step)
  ) {
    ctx.log(
      "warn",
      `forRange has non-finite input(s) (start=${start}, end=${end}, step=${step}); iterating zero times`,
    );
    return;
  }
  if (step === 0) {
    throw new Error("forRange: step must be non-zero");
  }

  const iterations = Math.max(0, Math.ceil((end - start) / step));
  if (iterations > MAX_FOR_RANGE_ITERATIONS) {
    throw new Error(
      `forRange would run ${iterations} iterations, more than the ${MAX_FOR_RANGE_ITERATIONS} allowed`,
    );
  }

  let value = start;
  let i = 0;
  const goingUp = step > 0;
  while (goingUp ? value < end : value > end) {
    ctx.setOutputs({ value, index: i });
    await ctx.fireTrigger("body", { iteration: i });
    value += step;
    i += 1;
    if (i % ITERATIONS_PER_YIELD === 0) await nextTick();
  }
};

nodeKinds.register("forRange", execute, {
  continuationPorts: ["main"],
  sidePorts: ["body"],
  ui: {
    label: "$dms_automation.nodes.kinds.forRange",
    icon: "i-ph-arrow-clockwise",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: ["body"],
    staticDataIns: [
      { name: "start", type: "number" },
      { name: "end", type: "number" },
      { name: "step", type: "number" },
    ],
    staticDataOuts: [
      { name: "value", type: "number" },
      { name: "index", type: "number" },
    ],
  },
});
