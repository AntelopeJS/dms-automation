import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const ms = Number(node.config.ms ?? 0);
  if (ms > 0) {
    await new Promise<void>((resolve, reject) => {
      if (ctx.signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const t = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  ctx.setOutputs(inputs);
}

nodeKinds.register("delay", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "Delay",
    icon: "i-ph-clock",
    category: "helper",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [],
    defaultConfig: { ms: 1000 },
    configSchema: {
      type: "object",
      properties: { ms: { type: "number" } },
    },
  },
});
