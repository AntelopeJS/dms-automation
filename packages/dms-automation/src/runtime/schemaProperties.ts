import type { JsonSchema } from "@antelopejs/interface-dms-automation";

/** What the runtime reads of one property of a node's JSON Schema. */
export type SchemaProperty = JsonSchema;

/** The `properties` of a node's JSON Schema, by property name. */
export function propertiesOf(
  schema: JsonSchema | undefined,
): Record<string, SchemaProperty> {
  return schema?.properties ?? {};
}
