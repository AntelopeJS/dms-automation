import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

/**
 * Every branch runs to its end, even when another fails: a branch left
 * running would outlive its run. The first failure then fails the
 * parallel as a whole.
 *
 * `main` auto-propagates after all configured ports settle.
 *
 * Parallel's fired ports are dynamic — they come from `node.config.ports`
 * (mirrored by `dynamicTriggerOutsFromConfig` for rendering and
 * divergence). Static `sidePorts` is empty by design; mayDiverge picks
 * up the dynamic-config signal.
 */
async function execute(
  node: GraphNode,
  _inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const raw = node.config.ports;
  const ports = Array.isArray(raw)
    ? raw.map(String).filter((p) => p.length > 0)
    : [];
  if (ports.length === 0) {
    ctx.log("warn", "parallel has no configured ports; nothing to run");
  }
  const failures: unknown[] = [];
  await Promise.all(
    ports.map((p) =>
      ctx.fireTrigger(p).catch((err: unknown) => {
        failures.push(err);
      }),
    ),
  );
  if (failures.length > 0) throw failures[0];
}

nodeKinds.register("parallel", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "$dms_automation.nodes.kinds.parallel",
    icon: "i-ph-flow-arrow",
    category: "flow",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    dynamicTriggerOutsFromConfig: "ports",
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [],
    defaultConfig: { ports: ["a", "b"] },
    configSchema: {
      type: "object",
      properties: {
        ports: { type: "array", title: "Branches", items: { type: "string" } },
      },
    },
  },
});
