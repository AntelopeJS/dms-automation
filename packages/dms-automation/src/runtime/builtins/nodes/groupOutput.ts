import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

async function execute(
  _node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  // Never invoked at runtime: flattenGroups strips groupOutput sentinels
  // and rewires outer edges straight to the inner producer nodes. The kind
  // stays registered so graph validation (nodeKindZodSchema) accepts it;
  // identity behavior kept for safety.
  ctx.setOutputs(inputs);
}

nodeKinds.register("groupOutput", execute, {
  continuationPorts: [],
  sidePorts: [],
});
