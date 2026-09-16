import type {
  DataNodeType,
  JsonSchema,
} from "@antelopejs/interface-dms-automation";

/**
 * Constant nodes emit a single value typed into the node — the way to wire a
 * literal (a string, a number, a flag) into a downstream port without an
 * upstream source. The value lives in `configSchema` (edited in the inspector),
 * NOT `inputSchema`, so the node has no data-in port to wire: `inputSchema` is
 * empty. `resolveInputs` merges the node's config into the evaluate input, so
 * `value` arrives on `input.value` and is echoed straight to the `value` port.
 */
function constant(
  id: string,
  name: string,
  description: string,
  icon: string,
  valueSchema: JsonSchema,
): DataNodeType {
  return {
    id,
    category: "constant",
    name,
    description,
    icon,
    inputSchema: { type: "object", properties: {} },
    configSchema: { type: "object", properties: { value: valueSchema } },
    outputSchema: { type: "object", properties: { value: valueSchema } },
    evaluate: (input) => ({ value: (input as { value: unknown }).value }),
  };
}

export const constantNodes: DataNodeType[] = [
  constant("const.string", "String", "A constant text value", "i-ph-text-aa", {
    type: "string",
    default: "",
  }),
  constant("const.number", "Number", "A constant numeric value", "i-ph-hash", {
    type: "number",
    default: 0,
  }),
  constant(
    "const.boolean",
    "Boolean",
    "A constant true/false value",
    "i-ph-toggle-left",
    { type: "boolean", default: false },
  ),
  constant(
    "const.json",
    "JSON",
    "A constant JSON value (object, array, or any literal)",
    "i-ph-brackets-curly",
    // `default: null` (not an empty schema) so a freshly-dropped, unedited
    // JSON constant emits an explicit null rather than `undefined`.
    { default: null },
  ),
];
