import type { ActionType } from "@antelopejs/interface-dms-automation";
import { isPropertyBag } from "../../../types/guards";
import { type NodeExecute, nodeKinds } from "../../nodeKinds";
import { registry } from "../../registry";
import { isActionTypeDisabled } from "../../typeSwitches";

const execute: NodeExecute = async (node, inputs, ctx) => {
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
  const output: unknown = await (simulate && actionType.dryRun
    ? actionType.dryRun(inputs, ctx)
    : actionType.execute(inputs, ctx));
  if (output === undefined) {
    ctx.setOutputs({});
    return;
  }
  if (!isPropertyBag(output) || Array.isArray(output)) {
    throw new Error(
      `action type "${typeId}" must resolve with an object or nothing`,
    );
  }
  ctx.setOutputs(output);
};

/** An action that declares a `dryRun` function: a plugin may leave it out or set something else. */
function canSimulate(
  type: ActionType,
): type is ActionType & { dryRun: NonNullable<ActionType["dryRun"]> } {
  return typeof type.dryRun === "function";
}

/**
 * Whether a test run simulates the action instead of executing it: it acts
 * outside the run and says how to pretend (see `ActionType.dryRun`).
 */
function simulates(type: ActionType): boolean {
  return type.sideEffects !== false && canSimulate(type);
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
