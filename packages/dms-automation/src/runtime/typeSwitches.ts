import { GetModel } from "@antelopejs/interface-database-decorators";
import { TypeSwitchModel } from "../db/models/type_switch.model";
import type {
  SwitchableKind,
  TypeSwitch,
} from "../db/tables/type_switch.table";
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

function disabledIds(
  rows: readonly TypeSwitch[],
  kind: SwitchableKind,
): Set<string> {
  return new Set(
    rows.filter((r) => r.kind === kind && !r.enabled).map((r) => r.typeId),
  );
}

export async function refreshTypeSwitches(): Promise<void> {
  const rows = await GetModel(TypeSwitchModel, DATABASE_NAME).getAll();
  disabled.triggers = disabledIds(rows, "trigger");
  disabled.actions = disabledIds(rows, "action");
}

export function isTriggerTypeDisabled(typeId: string): boolean {
  return disabled.triggers.has(typeId);
}

export function isActionTypeDisabled(typeId: string): boolean {
  return disabled.actions.has(typeId);
}
