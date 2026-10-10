import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  ActionTypeConfigModel,
  TriggerTypeConfigModel,
} from "../db/models/type_config.model";
import { DATABASE_NAME } from "../types/constants";

/**
 * The trigger and action types switched off in the library. A disabled
 * trigger type is not armed for any procedure; a disabled action type fails
 * the step that calls it. Read from the database on every reconcile, which
 * every instance runs after a change, so the switches agree across a cluster.
 */
const disabled = {
  triggers: new Set<string>(),
  actions: new Set<string>(),
};

interface TypeSwitchRow {
  typeId: string;
  enabled: boolean;
}

function disabledIds(rows: readonly TypeSwitchRow[]): Set<string> {
  return new Set(rows.filter((r) => r.enabled === false).map((r) => r.typeId));
}

export async function refreshTypeSwitches(): Promise<void> {
  const [triggers, actions] = await Promise.all([
    GetModel(TriggerTypeConfigModel, DATABASE_NAME).getAll(),
    GetModel(ActionTypeConfigModel, DATABASE_NAME).getAll(),
  ]);
  disabled.triggers = disabledIds(triggers);
  disabled.actions = disabledIds(actions);
}

export function isTriggerTypeDisabled(typeId: string): boolean {
  return disabled.triggers.has(typeId);
}

export function isActionTypeDisabled(typeId: string): boolean {
  return disabled.actions.has(typeId);
}
