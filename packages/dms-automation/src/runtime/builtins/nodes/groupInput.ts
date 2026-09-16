import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  _node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  // Never invoked at runtime: flattenGroups strips groupInput sentinels
  // before execution. The kind stays registered so graph validation
  // (nodeKindZodSchema) accepts it; identity behavior kept for safety.
  ctx.setOutputs(inputs);
}

// Group + sentinels: own Vue components, no UI metadata.
nodeKinds.register("groupInput", execute, {
  continuationPorts: [],
  sidePorts: [],
});
