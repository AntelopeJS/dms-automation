/**
 * Shared handle styling for the editor's node Vue components. Trigger and
 * data handles use a fixed color and size; data handles can additionally
 * pick a per-JSON-schema-type color via `dataHandleStyle(port)` (keyed off
 * `port.schema`) for the group/sentinel node variants.
 */

import type {
  GroupPort,
  JsonSchema,
} from "../../../composables/useGraphConnect";

// Trigger (control-flow) handles use the DMS accent cyan so the procedure's
// main flow reads as the brand colour; data handles stay emerald (success).
export const triggerStyle = {
  background: "#2dc1cf",
  width: "10px",
  height: "10px",
};

export const dataStyle = {
  background: "#10b981",
  width: "8px",
  height: "8px",
};

// Per-JSON-schema-type color for data handles. Falls back to the
// emerald baseline (the data-port default) for unknown / missing types.
const TYPE_COLORS: Record<string, string> = {
  string: "#10b981", // emerald — matches DataNode default
  number: "#f59e0b", // amber
  integer: "#f59e0b", // amber
  boolean: "#ef4444", // red
  object: "#8b5cf6", // violet
  array: "#06b6d4", // cyan
  null: "#6b7280", // gray
};

function schemaType(schema: JsonSchema | undefined): string {
  if (!schema) return "";
  const t = schema.type;
  if (Array.isArray(t)) return typeof t[0] === "string" ? (t[0] as string) : "";
  return typeof t === "string" ? t : "";
}

export function dataHandleStyle(port: Pick<GroupPort, "schema">): {
  background: string;
  width: string;
  height: string;
} {
  const color = TYPE_COLORS[schemaType(port.schema)] ?? "#10b981";
  return { background: color, width: "8px", height: "8px" };
}
