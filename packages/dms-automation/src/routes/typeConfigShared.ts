import { HTTPResult } from "@antelopejs/interface-api";
import type {
  ActionType,
  DataNodeType,
  TriggerType,
} from "@antelopejs/interface-dms-automation";
import { z } from "zod";
import {
  actionTypeOrigin,
  dataNodeTypeOrigin,
  type TypeOrigin,
  triggerTypeOrigin,
} from "../runtime/typeOrigin";

/**
 * Shared body schema for type-config PUT endpoints (action-types,
 * trigger-types). The two controllers are otherwise distinct because of
 * decorator-bound URLs, page-controllers, and models — but the body
 * validation is identical and centralizing it stops the two from
 * drifting.
 */
export const configBodySchema = z.object({
  enabled: z.boolean(),
  config: z.string(),
});

export type ConfigBody = z.infer<typeof configBodySchema>;

export function parseConfigBody(body: unknown): ConfigBody {
  const parsed = configBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPResult(400, {
      error: "invalid body",
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/**
 * Serialize a type-registry entry for the editor: strip the runtime function
 * field(s) — metadata only, no method bodies serialized as `{}` — and attach
 * the registering module (see runtime/typeOrigin). Three list endpoints
 * (action-types, trigger-types, data-node-types) had three different strip
 * strategies; this centralizes both halves so the wire shape stays uniform
 * and no endpoint can ship a type without its origin.
 */
type SerializedActionType = Omit<ActionType, "execute"> & TypeOrigin;
type SerializedTriggerType = Omit<TriggerType, "activate" | "deactivate"> &
  TypeOrigin;
type SerializedDataNodeType = Omit<DataNodeType, "evaluate"> & TypeOrigin;

export function serializeAction(a: ActionType): SerializedActionType {
  // The extracted binding exists only to drop the key from `rest`; it is
  // never called, so it cannot lose its `this`.
  // oxlint-disable-next-line typescript/unbound-method
  const { execute: _execute, ...rest } = a;
  return { ...rest, ...actionTypeOrigin(a.id) };
}

export function serializeTrigger(t: TriggerType): SerializedTriggerType {
  // The extracted binding exists only to drop the key from `rest`; it is
  // never called, so it cannot lose its `this`.
  // oxlint-disable-next-line typescript/unbound-method
  const { activate: _activate, deactivate: _deactivate, ...rest } = t;
  return { ...rest, ...triggerTypeOrigin(t.id) };
}

export function serializeDataNode(d: DataNodeType): SerializedDataNodeType {
  // The extracted binding exists only to drop the key from `rest`; it is
  // never called, so it cannot lose its `this`.
  // oxlint-disable-next-line typescript/unbound-method
  const { evaluate: _evaluate, ...rest } = d;
  return { ...rest, ...dataNodeTypeOrigin(d.id) };
}
