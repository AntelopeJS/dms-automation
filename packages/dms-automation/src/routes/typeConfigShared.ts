import { HTTPResult } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  ActionType,
  DataNodeType,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import { TypeSwitchModel } from "../db/models/type_switch.model";
import type { SwitchableKind } from "../db/tables/type_switch.table";
import {
  actionTypeOrigin,
  dataNodeTypeOrigin,
  type TypeOrigin,
  triggerTypeOrigin,
} from "../runtime/typeOrigin";
import { subscriptions } from "../runtime/subscriptions";
import { DATABASE_NAME } from "../types/constants";
import { parseBody } from "./requests";
import type { DataValue } from "../types/dataValue";

/** The body of a type-config PUT endpoint (action-types, trigger-types). */
const configBodySchema = z.object({ enabled: z.boolean() });

/** 404 for a type no module registered: there is nothing to configure. */
function assertRegistered(
  type: ActionType | TriggerType | undefined,
  id: string,
): void {
  if (!type) throw new HTTPResult(404, { error: `type "${id}" not found` });
}

/** The types of one kind as the library lists them, each with its switch. */
export async function listWithSwitches<T extends { id: string }, S>(
  kind: SwitchableKind,
  types: readonly T[],
  serialize: (type: T) => S,
): Promise<(S & { enabled: boolean })[]> {
  const model = GetModel(TypeSwitchModel, DATABASE_NAME);
  return await Promise.all(
    types.map(async (type) => ({
      ...serialize(type),
      enabled: await model.isEnabled(kind, type.id),
    })),
  );
}

/**
 * Switch a registered type on or off (`PUT /:id/config`).
 *
 * The switch takes effect on the next reconcile: run it now, here and on
 * every peer, so a disabled trigger type stops firing at once.
 */
export async function switchType(
  kind: SwitchableKind,
  type: ActionType | TriggerType | undefined,
  id: string,
  body: DataValue,
): Promise<{ id: string }> {
  assertRegistered(type, id);
  const { enabled } = parseBody(configBodySchema, body);
  await GetModel(TypeSwitchModel, DATABASE_NAME).setEnabled(kind, id, enabled);
  await subscriptions.onProcedureChange();
  return { id };
}

/**
 * Serialize a type-registry entry for the editor: strip the runtime function
 * field(s) — metadata only, no method bodies serialized as `{}` — and attach
 * the registering module (see runtime/typeOrigin), so the three list
 * endpoints (action-types, trigger-types, data-node-types) share one wire
 * shape and none ships a type without its origin.
 */
type SerializedActionType = Omit<ActionType, "execute"> & TypeOrigin;
type SerializedTriggerType = Omit<TriggerType, "activate" | "deactivate"> &
  TypeOrigin;
type SerializedDataNodeType = Omit<DataNodeType, "evaluate"> & TypeOrigin;

export function serializeAction(a: ActionType): SerializedActionType {
  const rest: Omit<ActionType, "execute"> &
    Partial<Pick<ActionType, "execute">> = { ...a };
  delete rest.execute;
  return { ...rest, ...actionTypeOrigin(a.id) };
}

export function serializeTrigger(t: TriggerType): SerializedTriggerType {
  const rest: Omit<TriggerType, "activate" | "deactivate"> &
    Partial<Pick<TriggerType, "activate" | "deactivate">> = { ...t };
  delete rest.activate;
  delete rest.deactivate;
  return { ...rest, ...triggerTypeOrigin(t.id) };
}

export function serializeDataNode(d: DataNodeType): SerializedDataNodeType {
  const rest: Omit<DataNodeType, "evaluate"> &
    Partial<Pick<DataNodeType, "evaluate">> = { ...d };
  delete rest.evaluate;
  return { ...rest, ...dataNodeTypeOrigin(d.id) };
}
