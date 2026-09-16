import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

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
  // Promise.all rethrows the first rejection: any branch throwing aborts
  // the parallel as a whole.
  await Promise.all(ports.map((p) => ctx.fireTrigger(p)));
  // `main` auto-propagates after all configured ports settle.
}

// Parallel's fired ports are dynamic — they come from `node.config.ports`
// (mirrored by `dynamicTriggerOutsFromConfig` for rendering and
// divergence). Static `sidePorts` is empty by design; mayDiverge picks
// up the dynamic-config signal.
nodeKinds.register("parallel", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "Parallel",
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
      properties: { ports: { type: "array", items: { type: "string" } } },
    },
  },
});
