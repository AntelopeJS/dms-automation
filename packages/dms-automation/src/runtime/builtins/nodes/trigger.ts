import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";

// Trigger nodes are entry points only: the top-level run preloads the seed
// output before firing, so a trigger never reaches this path. Reaching it
// means a trigger node sits mid-graph, which `validateGraph` rejects.
async function execute(
  node: GraphNode,
  _inputs: Record<string, unknown>,
  _ctx: NodeCtx,
): Promise<void> {
  throw new Error(
    `trigger node "${node.id}" cannot run mid-graph: triggers are entry points and must have no incoming trigger edge`,
  );
}

nodeKinds.register("trigger", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "Trigger",
    icon: "i-ph-lightning",
    category: "trigger",
    hasTriggerIn: false,
    hasMainTriggerOut: true,
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [],
    typeRegistry: "triggers",
    dataOutsFromTypeSchema: "outputSchema",
    labelFromType: true,
    iconFromType: true,
  },
});
