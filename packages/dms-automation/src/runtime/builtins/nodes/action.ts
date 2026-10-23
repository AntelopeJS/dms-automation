import type { ActionType } from "@antelopejs/interface-dms-automation";
import type { GraphNode } from "../../../types/graph";
import { type NodeCtx, nodeKinds } from "../../nodeKinds";
import { registry } from "../../registry";
import { isActionTypeDisabled } from "../../typeSwitches";

async function execute(
  node: GraphNode,
  inputs: Record<string, unknown>,
  ctx: NodeCtx,
): Promise<void> {
  const typeId = node.typeId;
  if (!typeId) {
    throw new Error(`action node "${node.id}" is missing typeId`);
  }
  const actionType = registry.getAction(typeId);
  if (!actionType) {
    throw new Error(
      `action node "${node.id}" references unknown type "${typeId}"`,
    );
  }
  if (isActionTypeDisabled(typeId)) {
    throw new Error(`action type "${typeId}" is disabled in the library`);
  }
  const simulate = ctx.dryRun && simulates(actionType);
  if (simulate) ctx.log("info", "Simulated (test run): no effect");
  const output = (await (simulate && actionType.dryRun
    ? actionType.dryRun(inputs, ctx)
    : actionType.execute(inputs, ctx))) as Record<string, unknown> | undefined;
  ctx.setOutputs(output ?? {});
}

/**
 * Whether a test run simulates the action instead of executing it: it acts
 * outside the run and says how to pretend (see `ActionType.dryRun`).
 */
function simulates(type: ActionType): boolean {
  return type.sideEffects !== false && typeof type.dryRun === "function";
}

/** Whether a test run would really act through it: neither pure nor simulated. */
export function actsForReal(type: ActionType): boolean {
  return type.sideEffects !== false && !simulates(type);
}

nodeKinds.register("action", execute, {
  continuationPorts: ["main"],
  sidePorts: [],
  ui: {
    label: "$dms_automation.nodes.kinds.action",
    icon: "i-ph-gear",
    category: "action",
    hasTriggerIn: true,
    hasMainTriggerOut: true,
    staticTriggerOuts: [],
    staticDataIns: [],
    staticDataOuts: [],
    typeRegistry: "actions",
    dataInsFromTypeSchema: "inputSchema",
    dataOutsFromTypeSchema: "outputSchema",
    labelFromType: true,
    iconFromType: true,
  },
});
