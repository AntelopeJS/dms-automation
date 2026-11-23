import type {
  GraphNode,
  GroupPort,
  JsonSchema,
} from "../../../composables/useGraphConnect";
import {
  isAbsentOr,
  isList,
  isRecord,
  isString,
  isStringList,
} from "../../../utils/json";

/** The name a node's config carries, when it carries one. */
export function configName(node: GraphNode): string | undefined {
  const name = node.config?.name;
  return isString(name) ? name : undefined;
}

function isSchemaType(value: unknown): value is string | string[] {
  return isString(value) || isStringList(value);
}

function isSchemaProperties(
  value: unknown,
): value is Record<string, JsonSchema> {
  return isRecord(value) && Object.values(value).every(isJsonSchema);
}

/** Whether a value read from untyped JSON is a JSON schema, checked to its nested properties. */
export function isJsonSchema(value: unknown): value is JsonSchema {
  return (
    isRecord(value) &&
    isAbsentOr(value.type, isSchemaType) &&
    isAbsentOr(value.title, isString) &&
    isAbsentOr(value.description, isString) &&
    isAbsentOr(value.enum, isList) &&
    isAbsentOr(value.properties, isSchemaProperties) &&
    isAbsentOr(value.required, isStringList)
  );
}

/** Whether a value read from untyped JSON is a port of a group. */
export function isGroupPort(value: unknown): value is GroupPort {
  return (
    isRecord(value) &&
    isString(value.name) &&
    (value.kind === "data" || value.kind === "trigger") &&
    (value.direction === "in" || value.direction === "out") &&
    isAbsentOr(value.schema, isJsonSchema)
  );
}
