import type { JsonSchema } from "@antelopejs/interface-dms-automation";
import type { DataValue } from "../types/dataValue";

/** What the runtime reads of one property of a node's JSON Schema. */
export interface SchemaProperty {
  title?: string;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  default?: DataValue;
  "x-redact"?: string;
}

/**
 * The `properties` of a node's JSON Schema, read as the runtime reads them.
 * `JsonSchema` is an open record, so the shape of what a plugin declared is
 * not checked.
 */
export function propertiesOf(
  schema: JsonSchema | undefined,
): Record<string, SchemaProperty> {
  return (schema?.properties ?? {}) as Record<string, SchemaProperty>;
}
