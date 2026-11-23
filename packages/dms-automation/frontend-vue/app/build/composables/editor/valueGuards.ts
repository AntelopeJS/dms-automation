import type {
  GraphNode,
  GroupPort,
} from "../../../composables/useGraphConnect";

/** Whether a value read from untyped JSON is a string. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether a value read from untyped JSON is a boolean. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/** Whether a value is an object whose members are read as `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value read from untyped JSON is a number. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** The name a node's config carries, when it carries one. */
export function configName(node: GraphNode): string | undefined {
  const name = node.config?.name;
  return isString(name) ? name : undefined;
}

/** Whether a value read from untyped JSON is a port of a group. */
export function isGroupPort(value: unknown): value is GroupPort {
  return (
    isRecord(value) &&
    isString(value.name) &&
    (value.kind === "data" || value.kind === "trigger") &&
    (value.direction === "in" || value.direction === "out") &&
    (value.schema === undefined || isRecord(value.schema))
  );
}
