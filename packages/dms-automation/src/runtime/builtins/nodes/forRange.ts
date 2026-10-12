import { setImmediate as nextTick } from "node:timers/promises";
import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

/**
 * The most iterations a loop runs. Every iteration is logged and the run is
 * kept as one document, so a longer loop loses most of its log anyway; a job
 * that needs more belongs in batches.
 */
export const MAX_FOR_RANGE_ITERATIONS = 10_000;

/** Iterations run between two yields to the event loop. */
const ITERATIONS_PER_YIELD = 50;

async function execute(
  _node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
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

  // Refused before the first iteration, rather than after the limit's worth.
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
    // A long loop of fast steps would otherwise hold the server: let the
    // other requests through now and then.
    if (i % ITERATIONS_PER_YIELD === 0) await nextTick();
  }
  // `main` auto-propagates after execute returns.
}

nodeKinds.register("forRange", execute, {
  continuationPorts: ["main"],
  sidePorts: ["body"],
  ui: {
    label: "For range",
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
    // start/end/step are data-ins; execute defaults missing ones to
    // 0/0/1 itself, so no configSchema and no defaultConfig needed.
  },
});
